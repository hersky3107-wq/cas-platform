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
  AI_PROVIDER_LABEL,
  VERDICT_VOTE_AI_ORDER,
  buildVerdictVoteSystemPrompt,
  parseVerdictVoteResponse,
  stripMarkdownFormattingForVote,
} from '@/lib/verdict-vote'

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
  if (b.error) console.warn('[verdict-vote] debate_logs user insert:', b.error.message)
}

async function insertVote(
  supabase: SupabaseClient,
  sessionId: string,
  payload: { userId?: string; aiName?: string; choice: string; category: string }
) {
  const { userId, aiName, choice, category } = payload
  const primary: Record<string, unknown> = {
    session_id: sessionId,
    category,
    ...(userId != null ? { user_id: userId } : {}),
    ...(aiName != null ? { ai_name: aiName } : {}),
    vote_choice: choice,
  }
  const fallback: Record<string, unknown> = {
    session_id: sessionId,
    category,
    ...(aiName != null ? { ai_name: aiName } : {}),
    choice,
    ...(userId != null ? { user_id: userId } : {}),
  }
  const r = await insertWithFallback(supabaseAdmin, 'votes', primary, fallback)
  if (!r.ok) {
    const fb2: Record<string, unknown> = {
      session_id: sessionId,
      response: choice,
      speaker: aiName ?? 'user',
    }
    const r2 = await insertWithFallback(supabaseAdmin, 'votes', fb2, {
      session_id: sessionId,
      content: choice,
    })
    if (!r2.ok) console.warn('[verdict-vote] votes insert:', r.primaryError, r.fallbackError, r2)
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const question = typeof body.question === 'string' ? body.question.trim() : ''
  const userVoteRaw = typeof body.userVote === 'string' ? body.userVote.toLowerCase() : ''
  const sessionIdIn = typeof body.sessionId === 'string' ? body.sessionId : null
  const token = typeof body.supabaseAccessToken === 'string' ? body.supabaseAccessToken : undefined

  if (!question) {
    return Response.json({ error: 'question is required' }, { status: 400 })
  }
  if (userVoteRaw !== 'yes' && userVoteRaw !== 'no' && userVoteRaw !== 'skip') {
    return Response.json({ error: 'userVote must be yes, no, or skip' }, { status: 400 })
  }

  const providers = [...VERDICT_VOTE_AI_ORDER] as AiProviderName[]
  const systemPrompt = buildVerdictVoteSystemPrompt()
  const userLogText = `${question}\n\n[User vote: ${userVoteRaw}]`

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
      .insert([{ mode: 'verdict_vote', prompt: userLogText }])
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
      if (pe) console.warn('[verdict-vote] session_participants:', pe.message)
    }
  } else {
    const { data: existing, error: exErr } = await supabaseAdmin
      .from('sessions')
      .select('id, mode')
      .eq('id', sessionIdIn)
      .maybeSingle()

    if (exErr || !existing || existing.mode !== 'verdict_vote') {
      return Response.json({ error: 'Invalid session' }, { status: 400 })
    }
    sessionId = existing.id
  }

  await insertUserDebateEntry(supabaseAdmin, sessionId, userLogText)

  await insertVote(supabaseAdmin, sessionId, {
    userId: user.id,
    choice: userVoteRaw,
    category: 'verdict_vote_user',
  })

  const voteLog = `User vote: ${userVoteRaw}`
  const vl = await supabaseAdmin.from('debate_logs').insert([{ session_id: sessionId, role: 'user', message_text: voteLog }])
  if (vl.error) {
    await supabaseAdmin.from('debate_logs').insert([{ session_id: sessionId, content: voteLog, speaker: 'user' }])
  }

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
          prompt: question,
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

        const aiYes: string[] = []
        const aiNo: string[] = []

        for (const r of collected) {
          const plain =
            r.text != null && !r.error ? stripMarkdownFormattingForVote(r.text) : r.text
          const { verdict } = parseVerdictVoteResponse(plain)
          const label = AI_PROVIDER_LABEL[r.provider]
          if (verdict === 'yes') {
            aiYes.push(label)
            await insertVote(supabaseAdmin, sessionId, {
              aiName: r.provider,
              choice: 'yes',
              category: 'verdict_vote_ai',
            })
          } else if (verdict === 'no') {
            aiNo.push(label)
            await insertVote(supabaseAdmin, sessionId, {
              aiName: r.provider,
              choice: 'no',
              category: 'verdict_vote_ai',
            })
          }
        }

        let yesTotal = aiYes.length
        let noTotal = aiNo.length
        if (userVoteRaw === 'yes') yesTotal += 1
        if (userVoteRaw === 'no') noTotal += 1

        let outcome: 'yes' | 'no' | 'tie'
        if (yesTotal > noTotal) outcome = 'yes'
        else if (noTotal > yesTotal) outcome = 'no'
        else outcome = 'tie'

        const summaryPayload = {
          mode: 'verdict_vote',
          userVote: userVoteRaw,
          aiYes,
          aiNo,
          outcome,
          yesTotal,
          noTotal,
        }
        const summaryStr = JSON.stringify(summaryPayload)
        const winnerField =
          summaryStr.length > 8000 ? summaryStr.slice(0, 7997) + '...' : summaryStr

        const sr1 = await supabaseAdmin.from('session_results').insert([
          {
            session_id: sessionId,
            category: 'verdict_vote_final',
            winner_ai_name: winnerField,
          },
        ])
        if (sr1.error) {
          const sr2 = await supabaseAdmin.from('session_results').insert([
            {
              session_id: sessionId,
              winner_ai_name: outcome === 'tie' ? 'TIE' : outcome.toUpperCase(),
            },
          ])
          if (sr2.error) console.warn('[verdict-vote] session_results:', sr2.error.message)
        }

        const sel = await supabaseAdmin.from('user_selections').insert([
          {
            session_id: sessionId,
            user_id: user.id,
            category: 'verdict_vote_complete',
            reason: `outcome:${outcome}`,
          },
        ])
        if (sel.error) {
          await supabaseAdmin.from('user_selections').insert([
            {
              session_id: sessionId,
              category: 'verdict_vote_complete',
              reason: 'verdict_vote',
            },
          ])
        }

        const yesNamesWithUser =
          userVoteRaw === 'yes' ? [...aiYes, 'You'] : [...aiYes]
        const noNamesWithUser =
          userVoteRaw === 'no' ? [...aiNo, 'You'] : [...aiNo]

        writeJson({
          type: 'verdict_vote_final',
          sessionId,
          userVote: userVoteRaw,
          aiYes,
          aiNo,
          yesNamesWithUser,
          noNamesWithUser,
          outcome,
          yesTotal,
          noTotal,
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
