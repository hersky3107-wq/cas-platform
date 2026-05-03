import type { SupabaseClient } from '@supabase/supabase-js'
import {
  iterateCompareProviderResults,
  MODEL_BY_PROVIDER,
  type AiProviderName,
  type RouterResult,
} from '@/lib/ai/router'
import { createSupabaseWithToken } from '@/lib/supabase/server-client'
import { creditsPerMessage, deductCreditsBalance } from '@/lib/credits'
import {
  VERDICT_SCORE_AI_ORDER,
  buildVerdictScoreSystemPrompt,
  computeOlympicTrim,
  parseVerdictScoreResponse,
} from '@/lib/verdict-score'

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
  if (b.error) console.warn('[verdict-score] debate_logs user insert:', b.error.message)
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const contentToScore = typeof body.contentToScore === 'string' ? body.contentToScore : ''
  const scoringCriteria =
    typeof body.scoringCriteria === 'string' ? body.scoringCriteria.slice(0, 500) : ''
  const sessionIdIn = typeof body.sessionId === 'string' ? body.sessionId : null
  const token = typeof body.supabaseAccessToken === 'string' ? body.supabaseAccessToken : undefined

  if (!token) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!contentToScore.trim()) {
    return Response.json({ error: 'contentToScore is required' }, { status: 400 })
  }

  const providers = [...VERDICT_SCORE_AI_ORDER] as AiProviderName[]
  const systemPrompt = buildVerdictScoreSystemPrompt(scoringCriteria)
  const userLogText = `Scoring criteria: ${scoringCriteria.trim() || '(none)'}\n\n---\n\n${contentToScore}`

  const supabase = createSupabaseWithToken(token)
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
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
      .insert([{ mode: 'verdict_score', prompt: userLogText }])
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
      if (pe) console.warn('[verdict-score] session_participants:', pe.message)
    }
  } else {
    const { data: existing, error: exErr } = await supabase
      .from('sessions')
      .select('id, mode')
      .eq('id', sessionIdIn)
      .maybeSingle()

    if (exErr || !existing || existing.mode !== 'verdict_score') {
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
          prompt: contentToScore.trim(),
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

        const judges = collected.map((r) => {
          const plain = r.text
          const { score, review } = parseVerdictScoreResponse(plain)
          return {
            provider: r.provider,
            score,
            review,
            ms: r.responseTimeMs,
            error: r.error,
            rawText: plain,
          }
        })

        const olympic = computeOlympicTrim(
          judges.map((j) => ({ provider: j.provider, score: j.score }))
        )

        const judgesWithFlags = judges.map((j) => ({
          ...j,
          isHighest: olympic.highestProvider === j.provider,
          isLowest: olympic.lowestProvider === j.provider,
        }))

        for (const j of judgesWithFlags) {
          if (j.score == null) continue
          const primary: Record<string, unknown> = {
            session_id: sessionId,
            ai_name: j.provider,
            score_value: j.score,
            category: 'verdict_judge_score',
            is_highest: j.isHighest,
            is_lowest: j.isLowest,
          }
          const fallback: Record<string, unknown> = {
            session_id: sessionId,
            ai_name: j.provider,
            points: j.score,
            category: 'verdict_judge_score',
          }
          const r = await insertWithFallback(supabase, 'scores', primary, fallback)
          if (!r.ok) {
            const fb2: Record<string, unknown> = {
              session_id: sessionId,
              ai_name: j.provider,
              score_value: j.score,
              category: 'verdict_judge',
            }
            await insertWithFallback(supabase, 'scores', fb2, {
              session_id: sessionId,
              ai_name: j.provider,
              points: j.score,
            })
          }
        }

        if (olympic.average != null) {
          const avgRounded = Math.round(olympic.average * 100) / 100
          const sr1 = await supabase.from('session_results').insert([
            {
              session_id: sessionId,
              category: 'verdict_olympic_score',
              winner_ai_name: String(avgRounded),
            },
          ])
          if (sr1.error) {
            const sr2 = await supabase.from('session_results').insert([
              {
                session_id: sessionId,
                winner_ai_name: String(avgRounded),
              },
            ])
            if (sr2.error) console.warn('[verdict-score] session_results:', sr2.error.message)
          }
        }

        const sel = await supabase.from('user_selections').insert([
          {
            session_id: sessionId,
            user_id: user.id,
            category: 'verdict_score_complete',
            reason:
              olympic.average != null
                ? `olympic_avg:${olympic.average.toFixed(2)}`
                : 'verdict_score_complete',
          },
        ])
        if (sel.error) {
          await supabase.from('user_selections').insert([
            {
              session_id: sessionId,
              category: 'verdict_score_complete',
              reason: 'verdict_score',
            },
          ])
        }

        writeJson({
          type: 'verdict_olympic',
          sessionId,
          finalAverage: olympic.average,
          highestProvider: olympic.highestProvider,
          lowestProvider: olympic.lowestProvider,
          judges: judgesWithFlags,
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
