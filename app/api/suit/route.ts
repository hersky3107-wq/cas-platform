import type { SupabaseClient } from '@supabase/supabase-js'
import { MODEL_BY_PROVIDER, type AiProviderName } from '@/lib/ai/router'
import type { SuitClientConfig } from '@/lib/ai/suit-types'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import {
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
import { creditsForSuit } from '@/lib/credits'
import { deductCreditsBalance, getCreditsBalance } from '@/lib/credits-server'
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
  // Prefer server env keys; accept common fallbacks used in other routes/deploys.
  return (
    process.env.ANTHROPIC_API_KEY ??
    process.env.CLAUDE_API_KEY ??
    process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY ??
    null
  )
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
  sideA?: AiProviderName
  sideB?: AiProviderName
  opponentProvider?: AiProviderName
  counselUserRole?: 'prosecutor' | 'defense' | 'counsel_a' | 'counsel_b'
}): RoleAssignment[] {
  const all: AiProviderName[] = ['openai', 'anthropic', 'google', 'xai', 'deepseek', 'mistral']
  const a = opts.sideA && all.includes(opts.sideA) ? opts.sideA : all[0]!
  const b = opts.sideB && all.includes(opts.sideB) && opts.sideB !== a ? opts.sideB : all.find((x) => x !== a)!

  const judge: RoleAssignment = { provider: 'anthropic', model: JUDGE_MODEL_ID, role: 'judge', sideBucket: 'side_a' }

  if (opts.mode === 'counsel' && opts.counselUserRole) {
    const userSide =
      opts.format === 'criminal'
        ? (opts.counselUserRole === 'prosecutor' ? 'side_a' : 'side_b')
        : (opts.counselUserRole === 'counsel_a' ? 'side_a' : 'side_b')
    const userAssign: RoleAssignment = {
      provider: 'user',
      model: 'human',
      role: opts.counselUserRole,
      sideBucket: userSide,
    }
    const opponentProvider =
      opts.opponentProvider && all.includes(opts.opponentProvider)
        ? opts.opponentProvider
        : (userSide === 'side_a' ? b : a)
    const opponentRole: RoleAssignment['role'] =
      opts.format === 'criminal'
        ? (userSide === 'side_a' ? 'defense' : 'prosecutor')
        : (userSide === 'side_a' ? 'counsel_b' : 'counsel_a')
    const opponentBucket = userSide === 'side_a' ? 'side_b' : 'side_a'
    const opponent: RoleAssignment = {
      provider: opponentProvider,
      model: MODEL_BY_PROVIDER[opponentProvider],
      role: opponentRole,
      sideBucket: opponentBucket,
    }
    return [userAssign, opponent, judge]
  }

  const roleA: RoleAssignment['role'] = opts.format === 'criminal' ? 'prosecutor' : 'counsel_a'
  const roleB: RoleAssignment['role'] = opts.format === 'criminal' ? 'defense' : 'counsel_b'
  const teamA: RoleAssignment = { provider: a, model: MODEL_BY_PROVIDER[a], role: roleA, sideBucket: 'side_a' }
  const teamB: RoleAssignment = { provider: b, model: MODEL_BY_PROVIDER[b], role: roleB, sideBucket: 'side_b' }
  return [teamA, teamB, judge]
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

async function ensureSuitCreditsDeducted(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<
  | { ok: true; balance: number | null; skipped?: boolean }
  | { ok: false; balance: number; required: number; reason: 'insufficient' | 'update_failed' }
> {
  const { data: paid } = await supabase
    .from('user_selections')
    .select('id')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .eq('category', 'suit_credits_paid')
    .limit(1)
    .maybeSingle()

  if (paid?.id) {
    const balance = await getCreditsBalance(supabase, userId)
    return { ok: true, balance, skipped: true }
  }

  const required = creditsForSuit()
  const deduct = await deductCreditsBalance(supabase, userId, required)
  if (!deduct.ok) {
    return { ok: false, balance: deduct.balance, required, reason: deduct.reason }
  }

  await insertWithFallback(
    supabase,
    'user_selections',
    {
      session_id: sessionId,
      user_id: userId,
      category: 'suit_credits_paid',
      reason: `paid:${required}`,
    },
    // Include user_id so idempotency checks (same user + session) always find this row.
    { session_id: sessionId, user_id: userId, category: 'suit_credits_paid' }
  )

  return deduct
}

/** Paid opening already ran; do not deduct — used for round / witness / verdict suit_step. */
async function assertSuitSessionPaid(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<{ ok: true } | { ok: false }> {
  const { data: paid } = await supabase
    .from('user_selections')
    .select('id')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .eq('category', 'suit_credits_paid')
    .limit(1)
    .maybeSingle()

  return paid?.id ? { ok: true } : { ok: false }
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
  // Debug: track what the API is receiving (avoid logging secrets).
  console.log('[api/suit] action=', action, 'hasToken=', Boolean(token))
  if (action === 'start') {
    console.log('[api/suit:start] format=', body.format, 'mode=', body.participationMode)
    console.log('[api/suit:start] topic_len=', typeof body.topic === 'string' ? body.topic.length : null)
  }

  const { user, error: authErr, accessToken } = await resolveRouteAuth(req, body)
  const supabase = supabaseAdmin
  const tokenForRouter = accessToken || token || undefined
  if (authErr || !user) {
    console.log('[api/suit] auth failed:', authErr?.message ?? 'no_user')
    return Response.json({ error: 'Invalid session' }, { status: 401 })
  }

  // SUIT USER VOTE — zero credits (user-contributed pick only; never call deductCreditsBalance here)
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
    }

    const sideStep =
      (format === 'criminal' &&
        mode !== 'counsel' &&
        (body.userPreferredSide === 'prosecution' || body.userPreferredSide === 'defense')) ?
        body.userPreferredSide :
        undefined

    // userPreferredSide is optional (setup wizard no longer collects it).

    const opponentProvider = isAiProviderName(body.opponentProvider)
      ? (body.opponentProvider as AiProviderName)
      : null

    const sideA = isAiProviderName(body.sideA) ? (body.sideA as AiProviderName) : null
    const sideB = isAiProviderName(body.sideB) ? (body.sideB as AiProviderName) : null
    if (mode === 'counsel') {
      if (!opponentProvider) {
        return Response.json({ error: 'opponentProvider required for counsel mode' }, { status: 400 })
      }
    } else {
      if (!sideA || !sideB || sideA === sideB) {
        return Response.json({ error: 'sideA and sideB (two different AIs) required' }, { status: 400 })
      }
    }

    const assignments = buildAssignments({
      format: format as SuitFormat,
      mode,
      sideA: sideA ?? undefined,
      sideB: sideB ?? undefined,
      opponentProvider: opponentProvider ?? undefined,
      counselUserRole: counselRole ?? undefined,
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
        reason: JSON.stringify({ format, mode, sideA, sideB, opponentProvider }).slice(0, 2000),
      },
      { session_id: sessionId, category: 'suit_started' }
    )

    const out = { sessionId, assignments, config: { ...config, assignments } }
    console.log('[api/suit:start] ok sessionId=', sessionId, 'assignments=', assignments.length)
    return Response.json(out)
  }

  if (action === 'counsel_opening') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
    if (!sessionId || !topic) return Response.json({ error: 'invalid counsel_opening' }, { status: 400 })
    const { data: sess } = await supabase.from('sessions').select('mode').eq('id', sessionId).maybeSingle()
    if (!sess || sess.mode !== 'suit') return Response.json({ error: 'bad session' }, { status: 400 })
    const apiKey = anthropicPlatformKey()
    if (!apiKey) return Response.json({ error: 'Judge API missing' }, { status: 500 })
    const suitPay = await ensureSuitCreditsDeducted(supabase, user.id, sessionId)
    if (!suitPay.ok) {
      const insufficient = suitPay.reason === 'insufficient'
      return Response.json(
        {
          error: insufficient ? 'Insufficient credits' : 'Could not update credits',
          balance: suitPay.balance,
          required: suitPay.required,
        },
        { status: insufficient ? 402 : 500 }
      )
    }
    const ctx: SuitTransportContext = { supabase, sessionId, userId: user.id, supabaseAccessToken: tokenForRouter }
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

    const ctx: SuitTransportContext = { supabase, sessionId, userId: user.id, supabaseAccessToken: tokenForRouter }

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

    const ctx: SuitTransportContext = { supabase, sessionId, userId: user.id, supabaseAccessToken: tokenForRouter }

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

    return Response.json({ verdictText, messages })
  }

  if (action === 'suit_step') {
    const step = typeof body.step === 'string' ? body.step : ''
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
    const format = (body.format === 'civil' ? 'civil' : 'criminal') as SuitFormat
    const participationMode =
      body.participationMode === 'witness' ? 'witness' : 'spectator'
    const roundNumber = Number(body.roundNumber)
    const apiKey = anthropicPlatformKey()
    const assignments = parseAssignments(body.assignments)
    const messages = parseMessages(body.messages)
    const witnessTestimony =
      typeof body.witnessTestimony === 'string' ? body.witnessTestimony.trim().slice(0, 200) : ''

    if (!sessionId || !topic || !apiKey || !assignments.length) {
      return Response.json({ error: 'bad suit_step payload' }, { status: 400 })
    }
    const { data: sess } = await supabase.from('sessions').select('mode').eq('id', sessionId).maybeSingle()
    if (!sess || sess.mode !== 'suit') return Response.json({ error: 'bad session' }, { status: 400 })

    if (step === 'opening') {
      const suitPay = await ensureSuitCreditsDeducted(supabase, user.id, sessionId)
      if (!suitPay.ok) {
        const insufficient = suitPay.reason === 'insufficient'
        return Response.json(
          {
            error: insufficient ? 'Insufficient credits' : 'Could not update credits',
            balance: suitPay.balance,
            required: suitPay.required,
          },
          { status: insufficient ? 402 : 500 }
        )
      }
    } else {
      const paidOk = await assertSuitSessionPaid(supabase, user.id, sessionId)
      if (!paidOk.ok) {
        return Response.json(
          { error: 'Suit session is not paid. Run the opening step first.' },
          { status: 402 }
        )
      }
    }

    const ctx: SuitTransportContext = { supabase, sessionId, userId: user.id, supabaseAccessToken: tokenForRouter }
    const enc = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const emitBuffered = createEmitter(messages, enc, controller, messages.length)
        try {
          write(enc, controller, { type: 'meta', sessionId })
          if (step === 'opening') {
            await runJudgeOpening(topic, format, ctx, apiKey, messages)
            emitBuffered()
            write(enc, controller, { type: 'done' })
            return
          }
          if (step === 'round') {
            if (![1, 2, 3].includes(roundNumber)) {
              write(enc, controller, { type: 'error', error: 'roundNumber must be 1-3' })
              write(enc, controller, { type: 'done' })
              return
            }
            await runSuitRound(topic, format, participationMode, roundNumber, assignments, messages, ctx)
            emitBuffered()
            write(enc, controller, { type: 'done' })
            return
          }
          if (step === 'witness_exam') {
            if (!witnessTestimony) {
              write(enc, controller, { type: 'error', error: 'Witness testimony ≤200 characters' })
              write(enc, controller, { type: 'done' })
              return
            }
            messages.push({
              id: `w-${Date.now()}`,
              role: 'user',
              sideBucket: 'neutral',
              provider: 'user',
              displayName: 'Witness (You)',
              phase: 'witness_stand',
              content: witnessTestimony,
              createdAt: Date.now(),
            })
            await insertUserDeb(supabase, sessionId, `[witness] ${witnessTestimony}`)
            emitBuffered()
            await runSuitRound(topic, format, 'witness', 35, assignments, messages, ctx, witnessTestimony)
            emitBuffered()
            write(enc, controller, { type: 'done' })
            return
          }
          if (step === 'verdict') {
            const v = await runJudgeVerdict(topic, format, ctx, apiKey, messages)
            emitBuffered()
            await persistSuitVerdictResult(supabase, sessionId, v ?? '')
            write(enc, controller, { type: 'complete', verdictText: v })
            write(enc, controller, { type: 'done' })
            return
          }
          write(enc, controller, { type: 'error', error: 'Unknown step' })
          write(enc, controller, { type: 'done' })
        } catch (e: unknown) {
          write(enc, controller, { type: 'error', error: e instanceof Error ? e.message : String(e) })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  if (action === 'spectator_stream' || action === 'witness_stream_resume') {
    console.log('[suit:spectator_stream] starting stream')
    console.log('[suit:spectator_stream] body:', JSON.stringify(body))
    try {
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
        console.log('[suit:spectator_stream] 400 bad stream payload', {
          resume,
          sessionId_ok: Boolean(sessionId),
          topic_ok: Boolean(topic),
          assignments_len: assignments.length,
          apiKey_ok: Boolean(apiKey),
        })
        return Response.json({ error: 'bad stream payload' }, { status: 400 })
      }

      const { data: sess } = await supabase
        .from('sessions')
        .select('mode')
        .eq('id', sessionId)
        .maybeSingle()
      if (!sess || sess.mode !== 'suit') {
        console.log('[suit:spectator_stream] 400 bad session', {
          sessionId,
          sess_mode: sess?.mode ?? null,
        })
        return Response.json({ error: 'bad session' }, { status: 400 })
      }

      const suitPayStream = await ensureSuitCreditsDeducted(supabase, user.id, sessionId)
      if (!suitPayStream.ok) {
        const insufficient = suitPayStream.reason === 'insufficient'
        return Response.json(
          {
            error: insufficient ? 'Insufficient credits' : 'Could not update credits',
            balance: suitPayStream.balance,
            required: suitPayStream.required,
          },
          { status: insufficient ? 402 : 500 }
        )
      }

      const ctx: SuitTransportContext = {
        supabase,
        sessionId,
        userId: user.id,
        supabaseAccessToken: tokenForRouter,
      }
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

              // 3-round structure (1: opening, 2: evidence, 3: rebuttal) then verdict.
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

              await runSuitRound(topic, format, 'witness', 3, assignments, messages, ctx)
                emitBuffered()

                const v = await runJudgeVerdict(topic, format, ctx, apiKey, messages)
                emitBuffered()
                await persistSuitVerdictResult(supabase, sessionId, v ?? '')
                write(enc, controller, { type: 'complete', verdictText: v })
              }
            }

            write(enc, controller, { type: 'done' })
          } catch (e: unknown) {
            write(enc, controller, {
              type: 'error',
              error: e instanceof Error ? e.message : String(e),
            })
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
    } catch (err) {
      console.error('[suit:spectator_stream] error:', err)
      console.log('[suit:spectator_stream] 400 caught error returning', {
        errorString: String(err),
      })
      return new Response(JSON.stringify({ error: String(err) }), { status: 400 })
    }
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
