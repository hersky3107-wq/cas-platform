import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiProviderName } from '@/lib/ai/router'
import type { SuitClientConfig } from '@/lib/ai/suit-types'
import {
  assignCounselOpponent,
  assignSpectatorCivil,
  assignSpectatorCriminal,
  assignWitness,
  JUDGE_MODEL_ID,
  runCounselOpponentTurn,
  runJudgeCounselOpening,
  runJudgeOpening,
  runJudgeVerdict,
  runSuitRound,
  type SuitTransportContext,
} from '@/lib/ai/suit-engine'
import type {
  RoleAssignment,
  SuitFormat,
  SuitMessage,
  SuitParticipationMode,
} from '@/lib/ai/suit-types'
import { createSupabaseWithToken } from '@/lib/supabase/server-client'
import { supabaseAdmin } from '@/lib/supabase/server'

async function insertWithFallback(
  supabase: SupabaseClient,
  table: string,
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
) {
  const a = await supabase.from(table).insert([primary])
  if (!a.error) return
  const b = await supabase.from(table).insert([fallback])
  if (b.error) console.warn(`[suit] ${table}:`, b.error.message)
}

function anthropicPlatformKey(): string | null {
  return process.env.ANTHROPIC_API_KEY ?? null
}

async function insertParticipants(supabase: SupabaseClient, sessionId: string, assignments: RoleAssignment[]) {
  for (const r of assignments) {
    if (r.role === 'judge') continue
    const name = r.provider === 'user' ? 'user' : r.provider
    await insertWithFallback(
      supabase,
      'session_participants',
      { session_id: sessionId, ai_name: name, model_name: r.model },
      { session_id: sessionId, ai_name: name, model_name: r.model }
    )
  }
  await insertWithFallback(
    supabase,
    'session_participants',
    { session_id: sessionId, ai_name: 'opus_judge', model_name: JUDGE_MODEL_ID },
    { session_id: sessionId, ai_name: 'opus_judge', model_name: JUDGE_MODEL_ID }
  )
}

async function insertUserDeb(supabase: SupabaseClient, sessionId: string, text: string) {
  const a = await supabase
    .from('debate_logs')
    .insert([{ session_id: sessionId, role: 'user', message_text: text }])
  if (!a.error) return
  const b = await supabase
    .from('debate_logs')
    .insert([{ session_id: sessionId, content: text, speaker: 'user' }])
  if (b.error) console.warn('[suit] debate_logs user:', b.error.message)
}

function isAiProviderName(x: unknown): x is AiProviderName {
  return (
    x === 'openai' ||
    x === 'anthropic' ||
    x === 'google' ||
    x === 'xai' ||
    x === 'deepseek' ||
    x === 'mistral'
  )
}

function buildAssignments(opts: {
  format: SuitFormat
  mode: SuitParticipationMode
  counselUserRole?: 'prosecutor' | 'defense' | 'counsel_a' | 'counsel_b'
  userCounselProvider?: AiProviderName
}): RoleAssignment[] {
  if (opts.mode === 'counsel' && opts.counselUserRole && opts.userCounselProvider) {
    return assignCounselOpponent({
      format: opts.format,
      userRole: opts.counselUserRole,
      userCounselProvider: opts.userCounselProvider,
    }).assignments
  }
  if (opts.mode === 'spectator') {
    return opts.format === 'criminal' ? assignSpectatorCriminal() : assignSpectatorCivil()
  }
  return assignWitness(opts.format)
}

function write(enc: TextEncoder, controller: ReadableStreamDefaultController<Uint8Array>, obj: unknown) {
  controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`))
}

function parseAssignments(raw: unknown): RoleAssignment[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(Boolean) as RoleAssignment[]
}

function parseMessages(raw: unknown): SuitMessage[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(Boolean) as SuitMessage[]
}

async function persistSuitVerdictResult(supabase: SupabaseClient, sessionId: string, verdict: string) {
  const winning = verdict.match(/RULING:\s*([^\n]+)/i)?.[1]?.trim().slice(0, 240) ?? 'suit_verdict'
  await insertWithFallback(
    supabase,
    'session_results',
    {
      session_id: sessionId,
      winner_ai_name: winning,
      category: 'suit_verdict',
      verdict_text: verdict.slice(0, 8000),
      result_type: 'suit_verdict',
    } as Record<string, unknown>,
    { session_id: sessionId, winner_ai_name: winning, category: 'suit_verdict' } as Record<string, unknown>
  )
}

function createEmitter(
  messages: SuitMessage[],
  enc: TextEncoder,
  ctrl: ReadableStreamDefaultController<Uint8Array>,
  startCursor = 0
) {
  let cursor = startCursor
  return () => {
    while (cursor < messages.length) {
      write(enc, ctrl, { type: 'suit_message', message: messages[cursor]! })
      cursor++
    }
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const token = typeof body.supabaseAccessToken === 'string' ? body.supabaseAccessToken : ''
  const action = typeof body.action === 'string' ? body.action : ''

  if (!token) return Response.json({ error: 'Authentication required' }, { status: 401 })

  const supabaseAuth = createSupabaseWithToken(token)
  const supabase = supabaseAdmin
  const {
    data: { user },
    error: authErr,
  } = await supabaseAuth.auth.getUser()
  if (authErr || !user) return Response.json({ error: 'Invalid session' }, { status: 401 })

  if (action === 'vote') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const agree = typeof body.agreeJudge === 'boolean' ? body.agreeJudge : null
    if (!sessionId || agree === null) {
      return Response.json({ error: 'sessionId and agreeJudge required' }, { status: 400 })
    }
    const choice = agree ? 'suit_agree_ruling' : 'suit_disagree_ruling'
    await insertWithFallback(supabase, 'votes', {
      session_id: sessionId,
      user_id: user.id,
      category: 'suit_spectator',
      vote_choice: choice,
    }, {
      session_id: sessionId,
      category: 'suit_spectator',
      choice,
    })
    return Response.json({ ok: true })
  }

  if (action === 'start') {
    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
    const format = body.format === 'civil' ? 'civil' : body.format === 'criminal' ? 'criminal' : ''
    const mode =
      body.participationMode === 'spectator' ||
      body.participationMode === 'witness' ||
      body.participationMode === 'counsel'
        ? (body.participationMode as SuitParticipationMode)
        : ''
    if (!topic || !format || !mode) {
      return Response.json({ error: 'topic, format, participationMode required' }, { status: 400 })
    }

    let counselRole: 'prosecutor' | 'defense' | 'counsel_a' | 'counsel_b' | null = null
    if (mode === 'counsel') {
      const r = body.counselUserRole
      if (
        r === 'prosecutor' ||
        r === 'defense' ||
        r === 'counsel_a' ||
        r === 'counsel_b'
      ) {
        counselRole = r
      }
      if (!counselRole) {
        return Response.json({ error: 'counselUserRole required for counsel mode' }, { status: 400 })
      }
      const aiPick = body.counselAiProvider
      if (!isAiProviderName(aiPick)) {
        return Response.json(
          {
            error:
              'counselAiProvider required for counsel mode (openai | anthropic | google | xai | deepseek | mistral)',
          },
          { status: 400 }
        )
      }
    }

    const sideStep =
      (format === 'criminal' &&
        mode !== 'counsel' &&
        (body.userPreferredSide === 'prosecution' || body.userPreferredSide === 'defense')) ?
        body.userPreferredSide :
        undefined

    if (format === 'criminal' && (mode === 'spectator' || mode === 'witness') && !sideStep) {
      return Response.json({
        error: 'userPreferredSide prosecution|defense required (criminal spectator/witness)',
      }, { status: 400 })
    }

    const counselAi: AiProviderName | undefined =
      mode === 'counsel' && isAiProviderName(body.counselAiProvider)
        ? body.counselAiProvider
        : undefined

    const assignments = buildAssignments({
      format: format as SuitFormat,
      mode,
      counselUserRole: counselRole ?? undefined,
      userCounselProvider: counselAi,
    })

    const ins = await supabase
      .from('sessions')
      .insert([
        {
          mode: 'suit',
          prompt: topic.slice(0, 8000),
          status: 'active',
        },
      ])
      .select()
      .single()

    if (ins.error || !ins.data?.id) {
      return Response.json({ error: ins.error?.message ?? 'session failed' }, { status: 500 })
    }

    const sessionId = ins.data.id
    await insertParticipants(supabase, sessionId, assignments)
    await insertUserDeb(supabase, sessionId, `[suit setup] ${topic}`)

    const config: SuitClientConfig = {
      topic,
      format: format as SuitFormat,
      participationMode: mode,
      assignments,
    }
    if (sideStep) config.userPreferredSide = sideStep
    if (counselRole) config.userCounselRole = counselRole
    if (mode === 'counsel') {
      if (counselAi) config.userCounselProvider = counselAi
      const o = assignments.find((x) => x.provider !== 'user' && x.role !== 'judge')
      if (o) config.opponentProvider = o.provider as AiProviderName
    }

    await insertWithFallback(
      supabase,
      'user_selections',
      {
        session_id: sessionId,
        user_id: user.id,
        category: 'suit_started',
        reason: JSON.stringify({ format, mode, counselAi: counselAi ?? null }).slice(0, 2000),
      },
      { session_id: sessionId, category: 'suit_started' }
    )

    return Response.json({ sessionId, assignments, config: { ...config, assignments } })
  }

  if (action === 'counsel_opening') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
    if (!sessionId || !topic) return Response.json({ error: 'invalid counsel_opening' }, { status: 400 })
    const { data: sess } = await supabase.from('sessions').select('mode').eq('id', sessionId).maybeSingle()
    if (!sess || sess.mode !== 'suit') return Response.json({ error: 'bad session' }, { status: 400 })
    const apiKey = anthropicPlatformKey()
    if (!apiKey) return Response.json({ error: 'Judge API missing' }, { status: 500 })
    const ctx: SuitTransportContext = { supabase, sessionId, userId: user.id, supabaseAccessToken: token }
    const messages: SuitMessage[] = []
    await runJudgeCounselOpening(topic, ctx, apiKey, messages)
    return Response.json({ messages })
  }

  if (action === 'counsel_turn') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
    const format = (body.format === 'civil' ? 'civil' : 'criminal') as SuitFormat
    const exchangeNum = Number(body.exchangeNum)
    const userText = typeof body.userText === 'string' ? body.userText.trim() : ''
    const assignments = parseAssignments(body.assignments)
    const messages = parseMessages(body.messages)
    const opp = assignments.find((x) => x.role !== 'judge' && x.provider !== 'user')
    const userAssign = assignments.find((x) => x.provider === 'user')
    if (!sessionId || !topic || !opp || !userAssign || exchangeNum < 1 || exchangeNum > 4 || userText.length < 2) {
      return Response.json({ error: 'invalid counsel_turn' }, { status: 400 })
    }
    const { data: sess } = await supabase.from('sessions').select('mode').eq('id', sessionId).maybeSingle()
    if (!sess || sess.mode !== 'suit') return Response.json({ error: 'bad session' }, { status: 400 })

    const ctx: SuitTransportContext = { supabase, sessionId, userId: user.id, supabaseAccessToken: token }

    const roleLabel =
      format === 'criminal'
        ? userAssign.role === 'prosecutor'
          ? 'Prosecutor'
          : 'Defense Counsel'
        : userAssign.role === 'counsel_a'
          ? 'Counsel A'
          : 'Counsel B'

    messages.push({
      id: `u-${Date.now()}`,
      role: userAssign.role,
      sideBucket: userAssign.sideBucket,
      provider: 'user',
      displayName: `You (${roleLabel})`,
      phase: `counsel_exchange_${exchangeNum}_user`,
      content: userText,
      createdAt: Date.now(),
    })
    await insertUserDeb(supabase, sessionId, `[counsel ${exchangeNum}] ${userText}`)

    const res = await runCounselOpponentTurn({
      topic,
      format,
      userRoleLabel: roleLabel,
      exchangeNum: exchangeNum as 1 | 2 | 3 | 4,
      opponent: opp,
      history: messages,
      ctx,
      userLastMessage: userText,
    })

    return Response.json({ ai: res.text, error: res.error, messages })
  }

  if (action === 'counsel_verdict') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
    const format = (body.format === 'civil' ? 'civil' : 'criminal') as SuitFormat
    const assignments = parseAssignments(body.assignments)
    let messages = parseMessages(body.messages)
    const userAssign = assignments.find((x) => x.provider === 'user')
    const apiKey = anthropicPlatformKey()

    if (!sessionId || !topic || !apiKey || !messages.length || !assignments.length) {
      return Response.json({ error: 'invalid counsel_verdict' }, { status: 400 })
    }
    const { data: sess } = await supabase.from('sessions').select('mode').eq('id', sessionId).maybeSingle()
    if (!sess || sess.mode !== 'suit') return Response.json({ error: 'bad session' }, { status: 400 })

    const ctx: SuitTransportContext = { supabase, sessionId, userId: user.id, supabaseAccessToken: token }

    const userRole =
      format === 'criminal'
        ? userAssign?.role === 'prosecutor'
          ? 'Prosecution'
          : 'Defense'
        : userAssign?.role === 'counsel_a'
          ? 'Counsel A'
          : 'Counsel B'

    const footer =
      `[COUNSEL MODE] Evaluate advocacy effectiveness for "${userRole}" (human). ` +
      `Name strongest and weakest tactic in FINDING; still enforce binary RULING for this format.`

    const verdictText = await runJudgeVerdict(topic, format, ctx, apiKey, messages, { suit_mode: 'counsel' }, footer)
    messages = [...messages]

    await persistSuitVerdictResult(supabase, sessionId, verdictText ?? '')

    const vlow = verdictText?.toLowerCase() ?? ''
    const humanPrevails =
      (userAssign?.role === 'prosecutor' && /prosecution prevails/i.test(vlow)) ||
      (userAssign?.role === 'defense' && /defense prevails/i.test(vlow)) ||
      (userAssign?.role === 'counsel_a' && /counsel a prevails/i.test(vlow)) ||
      (userAssign?.role === 'counsel_b' && /counsel b prevails/i.test(vlow))

    return Response.json({ verdictText, messages, humanPrevails })
  }

  if (action === 'spectator_stream' || action === 'witness_stream_resume') {
    const resume = action === 'witness_stream_resume'
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
    const format = (body.format === 'civil' ? 'civil' : 'criminal') as SuitFormat
    const participationMode =
      body.participationMode === 'witness' ? 'witness' : 'spectator'

    let messages = parseMessages(body.messages)
    const assignments = parseAssignments(body.assignments)
    const apiKey = anthropicPlatformKey()

    if (!sessionId || !topic || !assignments.length || !apiKey) {
      return Response.json({ error: 'bad stream payload' }, { status: 400 })
    }

    const { data: sess } = await supabase.from('sessions').select('mode').eq('id', sessionId).maybeSingle()
    if (!sess || sess.mode !== 'suit') {
      return Response.json({ error: 'bad session' }, { status: 400 })
    }

    const ctx: SuitTransportContext = { supabase, sessionId, userId: user.id, supabaseAccessToken: token }
    const enc = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        const emitBuffered = createEmitter(messages, enc, controller, resume ? messages.length : 0)
        try {
          write(enc, controller, { type: 'meta', sessionId })

          if (!resume) {
            messages.length = 0
            await runJudgeOpening(topic, format, ctx, apiKey, messages)
            emitBuffered()

            for (const rnd of [1, 2, 3] as const) {
              await runSuitRound(topic, format, participationMode, rnd, assignments, messages, ctx)
              emitBuffered()
            }

            if (participationMode === 'witness') {
              write(enc, controller, { type: 'need_witness' })
              write(enc, controller, {
                type: 'partial',
                messages,
              })
            } else {
              await runSuitRound(topic, format, participationMode, 4, assignments, messages, ctx)
              emitBuffered()
              const v = await runJudgeVerdict(topic, format, ctx, apiKey, messages)
              emitBuffered()
              await persistSuitVerdictResult(supabase, sessionId, v ?? '')
              write(enc, controller, { type: 'complete', verdictText: v })
            }
          } else {
            const wt = typeof body.witnessTestimony === 'string' ? body.witnessTestimony.trim() : ''
            if (!wt || wt.length > 200) {
              write(enc, controller, { type: 'error', error: 'Witness testimony ≤200 characters' })
            } else {
              messages.push({
                id: `w-${Date.now()}`,
                role: 'user',
                sideBucket: 'neutral',
                provider: 'user',
                displayName: 'Witness (You)',
                phase: 'witness_stand',
                content: wt.slice(0, 200),
                createdAt: Date.now(),
              })
              await insertUserDeb(supabase, sessionId, `[witness] ${wt}`)
              emitBuffered()

              await runSuitRound(topic, format, 'witness', 35, assignments, messages, ctx, wt.slice(0, 200))
              emitBuffered()

              await runSuitRound(topic, format, 'witness', 4, assignments, messages, ctx)
              emitBuffered()

              const v = await runJudgeVerdict(topic, format, ctx, apiKey, messages)
              emitBuffered()
              await persistSuitVerdictResult(supabase, sessionId, v ?? '')
              write(enc, controller, { type: 'complete', verdictText: v })
            }
          }

          write(enc, controller, { type: 'done' })
        } catch (e: unknown) {
          write(enc, controller, { type: 'error', error: e instanceof Error ? e.message : String(e) })
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

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
