import type { SupabaseClient } from '@supabase/supabase-js'
import {
  iterateCompareProviderResults,
  MODEL_BY_PROVIDER,
  type AiProviderName,
  type RouterResult,
} from '@/lib/ai/router'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import { creditsPerMessage } from '@/lib/credits'
import { deductCreditsBalance } from '@/lib/credits-server'
import {
  VERDICT_RANK_AI_ORDER,
  buildVerdictRankSystemPrompt,
  computeBordaFinal,
  extractItemsFromUserInput,
  parseVerdictRankResponse,
  rankClientOriginalsMatchExtracted,
  routerResultToJudgeRanking,
  stripMarkdownFormattingForRank,
} from '@/lib/verdict-rank'

async function insertWithFallback(
  supabase: SupabaseClient,
  table: string,
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
) {
  const primaryRes = await supabase.from(table).insert([primary])
  if (!primaryRes.error) return { ok: true as const }
  const fallbackRes = await supabase.from(table).insert([fallback])
  if (!fallbackRes.error) return { ok: true as const }
  return {
    ok: false as const,
    primaryError: primaryRes.error.message,
    fallbackError: fallbackRes.error.message,
  }
}

function sanitizeScoreAiName(key: string): string {
  const s = key.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')
  const base = s || 'item'
  return `borda_${base}`.slice(0, 100)
}

async function insertUserDebateEntry(supabase: SupabaseClient, sessionId: string, prompt: string) {
  const a = await supabase
    .from('debate_logs')
    .insert([{ session_id: sessionId, role: 'user', message_text: prompt }])
  if (!a.error) return
  const b = await supabase
    .from('debate_logs')
    .insert([{ session_id: sessionId, content: prompt, speaker: 'user' }])
  if (b.error) console.warn('[verdict-rank] debate_logs user insert:', b.error.message)
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const itemsToRank = typeof body.itemsToRank === 'string' ? body.itemsToRank : ''
  const rankingCriteria =
    typeof body.rankingCriteria === 'string' ? body.rankingCriteria.slice(0, 500) : ''
  const sessionIdIn = typeof body.sessionId === 'string' ? body.sessionId : null
  const token = typeof body.supabaseAccessToken === 'string' ? body.supabaseAccessToken : undefined

  const trimmed = itemsToRank.trim()
  if (!trimmed) {
    return Response.json({ error: 'itemsToRank is required' }, { status: 400 })
  }

  const extracted = extractItemsFromUserInput(trimmed)
  if (extracted.length < 2 || extracted.length > 10) {
    return Response.json(
      { error: 'Provide between 2 and 10 distinct items to rank (comma, semicolon, or line breaks).' },
      { status: 400 }
    )
  }

  const rawOrig = body.originalItems
  let bordaOriginals = extracted
  if (Array.isArray(rawOrig) && rawOrig.every((x) => typeof x === 'string')) {
    const fromClient = rawOrig.map((x) => String(x).trim()).filter(Boolean)
    if (rankClientOriginalsMatchExtracted(fromClient, extracted)) {
      bordaOriginals = fromClient
    }
  }

  const providers = [...VERDICT_RANK_AI_ORDER] as AiProviderName[]
  const systemPrompt = buildVerdictRankSystemPrompt(rankingCriteria)
  const userLogText = `Ranking criteria: ${rankingCriteria.trim() || '(none)'}\n\n---\n\n${trimmed}`

  const { user, supabase, error: authErr } = await resolveRouteAuth(req, body)
  if (authErr || !user) {
    return Response.json({ error: 'Invalid session' }, { status: 401 })
  }

  let cost: number
  try {
    cost = creditsPerMessage(providers.length)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Invalid AI count'
    return Response.json({ error: msg }, { status: 400 })
  }

  const deduct = await deductCreditsBalance(supabase, user.id, cost)
  if (!deduct.ok) {
    const insufficient = deduct.reason === 'insufficient'
    return Response.json(
      {
        error: insufficient ? 'Insufficient credits' : 'Could not update credits',
        balance: deduct.balance,
        required: cost,
      },
      { status: insufficient ? 402 : 500 }
    )
  }
  const creditsRemaining = deduct.balance

  let sessionId: string

  if (!sessionIdIn) {
    const ins = await supabase
      .from('sessions')
      .insert([{ mode: 'verdict_rank', prompt: userLogText }])
      .select()
      .single()

    if (ins.error || !ins.data?.id) {
      return Response.json(
        { error: ins.error?.message ?? 'Could not start session' },
        { status: 500 }
      )
    }
    sessionId = ins.data.id

    for (const p of providers) {
      const { error: pe } = await supabase.from('session_participants').insert([
        {
          session_id: sessionId,
          ai_name: p,
          model_name: MODEL_BY_PROVIDER[p],
        },
      ])
      if (pe) console.warn('[verdict-rank] session_participants:', pe.message)
    }
  } else {
    const { data: existing, error: exErr } = await supabase
      .from('sessions')
      .select('id, mode')
      .eq('id', sessionIdIn)
      .maybeSingle()

    if (exErr || !existing || existing.mode !== 'verdict_rank') {
      return Response.json({ error: 'Invalid session' }, { status: 400 })
    }
    sessionId = existing.id
  }

  await insertUserDebateEntry(supabase, sessionId, userLogText)

  const enc = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const writeJson = (obj: unknown) => {
        controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`))
      }

      try {
        writeJson({
          type: 'meta',
          sessionId,
          creditsRemaining,
          cost,
        })

        const collected: RouterResult[] = []
        const gen = iterateCompareProviderResults({
          prompt: trimmed,
          systemPrompt,
          providers,
          sessionId,
          supabaseAccessToken: token,
          saveCompareArtifacts: true,
          temperature: 0.7,
          maxCompletionTokens: 900,
        })

        for await (const result of gen) {
          collected.push(result)
          writeJson({ type: 'result', result })
        }

        const judgesParsed = collected.map((r) =>
          routerResultToJudgeRanking(r.provider, r.text, r.error)
        )

        const judgeSummaries = collected.map((r) => {
          const plain =
            r.text != null && !r.error ? stripMarkdownFormattingForRank(r.text) : r.text
          const lines = plain ? parseVerdictRankResponse(plain).entries : []
          return {
            provider: r.provider,
            ms: r.responseTimeMs,
            error: r.error,
            lines: lines.map((l) => ({ rank: l.rank, item: l.item, reason: l.reason })),
          }
        })

        const final = computeBordaFinal(judgesParsed, bordaOriginals)

        for (const row of final) {
          const primary: Record<string, unknown> = {
            session_id: sessionId,
            ai_name: sanitizeScoreAiName(row.itemKey),
            score_value: row.totalPoints,
            category: 'verdict_rank_borda',
          }
          const fallback: Record<string, unknown> = {
            session_id: sessionId,
            ai_name: sanitizeScoreAiName(row.itemKey),
            points: row.totalPoints,
            category: 'verdict_rank_borda',
          }
          const ins = await insertWithFallback(supabase, 'scores', primary, fallback)
          if (!ins.ok) {
            console.warn('[verdict-rank] scores insert:', ins.primaryError, ins.fallbackError)
          }
        }

        const summaryPayload = {
          method: 'borda_count',
          judgeCount: providers.length,
          ranking: final.map((r, i) => ({
            position: i + 1,
            item: r.itemLabel,
            bordaPoints: r.totalPoints,
          })),
        }
        const summaryStr = JSON.stringify(summaryPayload)
        const winnerField = summaryStr.length > 8000 ? summaryStr.slice(0, 7997) + '...' : summaryStr

        const sr1 = await supabase.from('session_results').insert([
          {
            session_id: sessionId,
            category: 'verdict_rank_borda',
            winner_ai_name: winnerField,
          },
        ])
        if (sr1.error) {
          const sr2 = await supabase.from('session_results').insert([
            {
              session_id: sessionId,
              winner_ai_name: winnerField,
            },
          ])
          if (sr2.error) console.warn('[verdict-rank] session_results:', sr2.error.message)
        }

        const sel = await supabase.from('user_selections').insert([
          {
            session_id: sessionId,
            user_id: user.id,
            category: 'verdict_rank_complete',
            reason:
              final.length > 0
                ? `borda_winner:${final[0]!.itemLabel}`
                : 'verdict_rank_complete',
          },
        ])
        if (sel.error) {
          await supabase.from('user_selections').insert([
            {
              session_id: sessionId,
              category: 'verdict_rank_complete',
              reason: 'verdict_rank',
            },
          ])
        }

        writeJson({
          type: 'verdict_rank_final',
          sessionId,
          finalRanking: final.map((r, i) => ({
            position: i + 1,
            itemLabel: r.itemLabel,
            totalPoints: r.totalPoints,
          })),
          judgeSummaries,
        })

        writeJson({ type: 'done' })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown error'
        writeJson({ type: 'error', error: msg })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
