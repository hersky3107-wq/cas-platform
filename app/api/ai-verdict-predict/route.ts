import type { SupabaseClient } from '@supabase/supabase-js'
import {
  iterateCompareProviderResults,
  MODEL_BY_PROVIDER,
  type AiProviderName,
  type RouterResult,
} from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import { creditsPerMessage } from '@/lib/credits'
import { deductCreditsBalance } from '@/lib/credits-server'
import {
  VERDICT_PREDICT_AI_ORDER,
  averagePredictionsAllForecasters,
  buildVerdictPredictSystemPrompt,
  parseVerdictPredictResponse,
  probabilityLabel,
  stripMarkdownFormattingForPredict,
} from '@/lib/verdict-predict'

async function insertWithFallback(
  supabase: SupabaseClient,
  table: string,
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
) {
  const primaryRes = await supabaseAdmin.from(table).insert([primary])
  if (!primaryRes.error) return { ok: true as const }
  const fallbackRes = await supabaseAdmin.from(table).insert([fallback])
  if (!fallbackRes.error) return { ok: true as const }
  return {
    ok: false as const,
    primaryError: primaryRes.error.message,
    fallbackError: fallbackRes.error.message,
  }
}

async function insertUserDebateEntry(supabase: SupabaseClient, sessionId: string, prompt: string) {
  const a = await supabaseAdmin
    .from('debate_logs')
    .insert([{ session_id: sessionId, role: 'user', message_text: prompt }])
  if (!a.error) return
  const b = await supabaseAdmin
    .from('debate_logs')
    .insert([{ session_id: sessionId, content: prompt, speaker: 'user' }])
  if (b.error) console.warn('[verdict-predict] debate_logs user insert:', b.error.message)
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const topic = typeof body.predictionTopic === 'string' ? body.predictionTopic.trim() : ''
  const sessionIdIn = typeof body.sessionId === 'string' ? body.sessionId : null
  const token = typeof body.supabaseAccessToken === 'string' ? body.supabaseAccessToken : undefined

  if (!topic) {
    return Response.json({ error: 'predictionTopic is required' }, { status: 400 })
  }

  const providers = [...VERDICT_PREDICT_AI_ORDER] as AiProviderName[]
  const systemPrompt = buildVerdictPredictSystemPrompt()

  const { user, error: authErr } = await resolveRouteAuth(req, body)
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

  const deduct = await deductCreditsBalance(supabaseAdmin, user.id, cost)
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
    const ins = await supabaseAdmin
      .from('sessions')
      .insert([{ mode: 'verdict_predict', prompt: topic }])
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
      const { error: pe } = await supabaseAdmin.from('session_participants').insert([
        {
          session_id: sessionId,
          ai_name: p,
          model_name: MODEL_BY_PROVIDER[p],
        },
      ])
      if (pe) console.warn('[verdict-predict] session_participants:', pe.message)
    }
  } else {
    const { data: existing, error: exErr } = await supabaseAdmin
      .from('sessions')
      .select('id, mode')
      .eq('id', sessionIdIn)
      .maybeSingle()

    if (exErr || !existing || existing.mode !== 'verdict_predict') {
      return Response.json({ error: 'Invalid session' }, { status: 400 })
    }
    sessionId = existing.id
  }

  await insertUserDebateEntry(supabaseAdmin, sessionId, topic)

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
          prompt: topic,
          systemPrompt,
          providers,
          sessionId,
          supabaseAccessToken: token,
          persistSupabase: supabaseAdmin,
          saveCompareArtifacts: true,
          temperature: 0.7,
          maxCompletionTokens: 900,
        })

        for await (const result of gen) {
          collected.push(result)
          writeJson({ type: 'result', result })
        }

        const judges = collected.map((r) => {
          const plain =
            r.text != null && !r.error ? stripMarkdownFormattingForPredict(r.text) : r.text
          const { probability, reasoning } = parseVerdictPredictResponse(plain)
          return {
            provider: r.provider,
            probability,
            reasoning,
            ms: r.responseTimeMs,
            error: r.error,
          }
        })

        for (const j of judges) {
          if (j.probability == null) continue
          const primary: Record<string, unknown> = {
            session_id: sessionId,
            ai_name: j.provider,
            score_value: j.probability,
            category: 'verdict_predict_ai',
          }
          const fallback: Record<string, unknown> = {
            session_id: sessionId,
            ai_name: j.provider,
            points: j.probability,
            category: 'verdict_predict_ai',
          }
          const ins = await insertWithFallback(supabaseAdmin, 'scores', primary, fallback)
          if (!ins.ok) {
            console.warn('[verdict-predict] scores insert:', ins.primaryError, ins.fallbackError)
          }
        }

        const probs = judges.map((j) => j.probability)
        const avg = averagePredictionsAllForecasters(probs)
        const avgRounded = avg != null ? Math.round(avg * 100) / 100 : null
        const avgLabel = avgRounded != null ? probabilityLabel(avgRounded) : ''

        const summaryStr = JSON.stringify({
          mode: 'verdict_predict',
          average: avgRounded,
          label: avgLabel,
          judges: judges.map((j) => ({
            provider: j.provider,
            probability: j.probability,
          })),
        })
        const winnerField =
          summaryStr.length > 8000 ? summaryStr.slice(0, 7997) + '...' : summaryStr

        const sr1 = await supabaseAdmin.from('session_results').insert([
          {
            session_id: sessionId,
            category: 'verdict_predict_avg',
            winner_ai_name: avgRounded != null ? String(avgRounded) : winnerField,
          },
        ])
        if (sr1.error) {
          const sr2 = await supabaseAdmin.from('session_results').insert([
            {
              session_id: sessionId,
              winner_ai_name: avgRounded != null ? String(avgRounded) : 'verdict_predict',
            },
          ])
          if (sr2.error) console.warn('[verdict-predict] session_results:', sr2.error.message)
        }

        const sel = await supabaseAdmin.from('user_selections').insert([
          {
            session_id: sessionId,
            user_id: user.id,
            category: 'verdict_predict_complete',
            reason:
              avgRounded != null
                ? `predict_avg:${avgRounded.toFixed(2)}`
                : 'verdict_predict_complete',
          },
        ])
        if (sel.error) {
          await supabaseAdmin.from('user_selections').insert([
            {
              session_id: sessionId,
              category: 'verdict_predict_complete',
              reason: 'verdict_predict',
            },
          ])
        }

        writeJson({
          type: 'verdict_predict_final',
          sessionId,
          average: avgRounded,
          averageLabel: avgLabel,
          judges,
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
