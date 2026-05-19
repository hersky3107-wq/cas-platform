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
  VERDICT_FACTCHECK_AI_ORDER,
  buildVerdictFactcheckSystemPrompt,
  emptyFactVerdictCounts,
  FACT_VERDICT_DISPLAY,
  majorityFactVerdict,
  parseVerdictFactcheckResponse,
  stripMarkdownFormattingForFactcheck,
  type FactVerdict,
} from '@/lib/verdict-factcheck'

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

async function insertUserDebateEntry(supabase: SupabaseClient, sessionId: string, prompt: string) {
  const a = await supabase
    .from('debate_logs')
    .insert([{ session_id: sessionId, role: 'user', message_text: prompt }])
  if (!a.error) return
  const b = await supabase
    .from('debate_logs')
    .insert([{ session_id: sessionId, content: prompt, speaker: 'user' }])
  if (b.error) console.warn('[verdict-factcheck] debate_logs user insert:', b.error.message)
}

async function insertFactcheckVote(
  supabase: SupabaseClient,
  sessionId: string,
  payload: { aiName?: string; choice: string; category: string }
) {
  const { aiName, choice, category } = payload
  const primary: Record<string, unknown> = {
    session_id: sessionId,
    category,
    ...(aiName != null ? { ai_name: aiName } : {}),
    vote_choice: choice,
  }
  const fallback: Record<string, unknown> = {
    session_id: sessionId,
    category,
    ...(aiName != null ? { ai_name: aiName } : {}),
    choice,
  }
  const r = await insertWithFallback(supabase, 'votes', primary, fallback)
  if (!r.ok) {
    const fb2: Record<string, unknown> = {
      session_id: sessionId,
      response: choice,
      speaker: aiName ?? 'user',
    }
    const r2 = await insertWithFallback(supabase, 'votes', fb2, {
      session_id: sessionId,
      content: choice,
    })
    if (!r2.ok) {
      console.warn('[verdict-factcheck] votes insert:', r.primaryError, r.fallbackError, r2)
    }
  }
}

function resolveVerdictForResult(r: RouterResult, plain: string | null | undefined): FactVerdict {
  if (r.error || plain == null || plain === '') return 'uncertain'
  const { verdict } = parseVerdictFactcheckResponse(plain)
  return verdict ?? 'uncertain'
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const claim = typeof body.claim === 'string' ? body.claim.trim() : ''
  const sessionIdIn = typeof body.sessionId === 'string' ? body.sessionId : null
  const token = typeof body.supabaseAccessToken === 'string' ? body.supabaseAccessToken : undefined

  if (!claim) {
    return Response.json({ error: 'claim is required' }, { status: 400 })
  }

  const providers = [...VERDICT_FACTCHECK_AI_ORDER] as AiProviderName[]
  const systemPrompt = buildVerdictFactcheckSystemPrompt('')
  const userLogText = claim

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
      .insert([{ mode: 'verdict_factcheck', prompt: userLogText }])
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
      if (pe) console.warn('[verdict-factcheck] session_participants:', pe.message)
    }
  } else {
    const { data: existing, error: exErr } = await supabase
      .from('sessions')
      .select('id, mode')
      .eq('id', sessionIdIn)
      .maybeSingle()

    if (exErr || !existing || existing.mode !== 'verdict_factcheck') {
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
          prompt: claim,
          systemPrompt,
          providers,
          sessionId,
          supabaseAccessToken: token,
          saveCompareArtifacts: true,
          temperature: 0.5,
          maxCompletionTokens: 600,
        })

        for await (const result of gen) {
          collected.push(result)
          writeJson({ type: 'result', result })
        }

        const counts = emptyFactVerdictCounts()
        const judgeSummaries: {
          provider: AiProviderName
          ms: number
          error?: string
          verdict: FactVerdict
          evidence: string
        }[] = []

        for (const r of collected) {
          const plain =
            r.text != null && !r.error ? stripMarkdownFormattingForFactcheck(r.text) : r.text
          const verdict = resolveVerdictForResult(r, plain)
          const { evidence } =
            plain != null && !r.error ? parseVerdictFactcheckResponse(plain) : { evidence: '' }

          counts[verdict] += 1

          await insertFactcheckVote(supabase, sessionId, {
            aiName: r.provider,
            choice: FACT_VERDICT_DISPLAY[verdict].label,
            category: 'verdict_factcheck_ai',
          })

          judgeSummaries.push({
            provider: r.provider,
            ms: r.responseTimeMs,
            error: r.error,
            verdict,
            evidence: r.error ? '' : evidence,
          })
        }

        const { winner, tie } = majorityFactVerdict(counts)
        const divided = tie

        const summaryPayload = {
          mode: 'verdict_factcheck',
          counts,
          winner: divided ? null : winner,
          divided,
          judges: judgeSummaries.map((j) => ({
            provider: j.provider,
            verdict: j.verdict,
            ms: j.ms,
            error: j.error,
          })),
        }
        const summaryStr = JSON.stringify(summaryPayload)
        const winnerField =
          summaryStr.length > 8000 ? summaryStr.slice(0, 7997) + '...' : summaryStr

        const sr1 = await supabase.from('session_results').insert([
          {
            session_id: sessionId,
            category: 'verdict_factcheck_final',
            winner_ai_name: winnerField,
          },
        ])
        if (sr1.error) {
          const shortWinner = divided
            ? 'DIVIDED'
            : winner != null
              ? FACT_VERDICT_DISPLAY[winner].label
              : 'UNCERTAIN'
          const sr2 = await supabase.from('session_results').insert([
            {
              session_id: sessionId,
              winner_ai_name: shortWinner,
            },
          ])
          if (sr2.error) console.warn('[verdict-factcheck] session_results:', sr2.error.message)
        }

        const sel = await supabase.from('user_selections').insert([
          {
            session_id: sessionId,
            user_id: user.id,
            category: 'verdict_factcheck_complete',
            reason: divided
              ? 'verdict_factcheck:divided'
              : `verdict_factcheck:${winner != null ? FACT_VERDICT_DISPLAY[winner].label : 'none'}`,
          },
        ])
        if (sel.error) {
          await supabase.from('user_selections').insert([
            {
              session_id: sessionId,
              category: 'verdict_factcheck_complete',
              reason: 'verdict_factcheck',
            },
          ])
        }

        writeJson({
          type: 'verdict_factcheck_final',
          sessionId,
          counts,
          winner: divided ? null : winner,
          divided,
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
