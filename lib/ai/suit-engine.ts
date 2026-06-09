import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MODEL_BY_PROVIDER,
  runSingleAiProvider,
  type AiProviderName,
} from '@/lib/ai/router'
import {
  buildCounselExchangeUserPrompt,
  buildCounselSystemPrompt,
  roundInstructionUser,
  SUIT_JUDGE_SYSTEM_PROMPT,
  suitCounselSelectorMeta,
  suitCounselModeOppositionPrefix,
  suitJudgeCounselOpeningSystem,
  suitJudgeCounselOpeningUser,
  suitJudgeOpeningSystem,
  suitJudgeOpeningUser,
  suitJudgeVerdictUser,
  suitWitnessExaminationPrompt,
} from '@/lib/ai/suit-prompts'
import type {
  RoleAssignment,
  RoundResult,
  SuitFormat,
  SuitLegalRole,
  SuitMessage,
  SuitParticipationMode,
} from '@/lib/ai/suit-types'

export const JUDGE_MODEL_ID = 'claude-opus-4-7'

const ALL_PROVIDERS: AiProviderName[] = [
  'openai',
  'xai',
  'anthropic',
  'mistral',
  'google',
  'deepseek',
]

export type SuitTransportContext = {
  supabase: SupabaseClient
  sessionId: string
  userId: string | null
  supabaseAccessToken?: string
}

async function insertWithFallback(
  supabase: SupabaseClient,
  table: string,
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
) {
  const primaryRes = await supabase.from(table).insert([primary])
  if (!primaryRes.error) return
  const fallbackRes = await supabase.from(table).insert([fallback])
  if (fallbackRes.error) {
    console.warn(`[suit] ${table} insert:`, primaryRes.error.message, fallbackRes.error.message)
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

function ra(
  provider: AiProviderName,
  role: Exclude<SuitLegalRole, 'user'>,
  side: 'side_a' | 'side_b'
): RoleAssignment {
  return {
    provider,
    model: MODEL_BY_PROVIDER[provider],
    role,
    sideBucket: side,
  }
}

/** Judge participant row (Opus-only; calls bypass router temperature). */
export function judgeAssignment(): RoleAssignment {
  return {
    provider: 'anthropic',
    model: JUDGE_MODEL_ID,
    role: 'judge',
    sideBucket: 'side_a',
  }
}

/** SPECTATOR + CRIMINAL */
export function assignSpectatorCriminal(): RoleAssignment[] {
  const geminiSide: 'side_a' | 'side_b' = Math.random() < 0.5 ? 'side_a' : 'side_b'
  const pros: RoleAssignment[] = [
    ra('openai', 'prosecutor', 'side_a'),
    ra('xai', 'prosecutor', 'side_a'),
  ]
  const def: RoleAssignment[] = [
    ra('anthropic', 'defense', 'side_b'),
    ra('mistral', 'defense', 'side_b'),
  ]
  const floaterRole: SuitLegalRole = geminiSide === 'side_a' ? 'prosecutor' : 'defense'
  const gemRow = ra('google', floaterRole, geminiSide)
  const j = judgeAssignment()
  return [...pros, gemRow, ...def, j]
}

/** SPECTATOR + CIVIL — 4 random counsel (2 vs 2), 2 benched */
export function assignSpectatorCivil(): RoleAssignment[] {
  const pick = shuffle(ALL_PROVIDERS)
  const a = pick.slice(0, 2).map((p) => ra(p, 'counsel_a', 'side_a'))
  const b = pick.slice(2, 4).map((p) => ra(p, 'counsel_b', 'side_b'))
  const j = judgeAssignment()
  return [...a, ...b, j]
}

/** WITNESS + CRIMINAL / CIVIL */
export function assignWitness(format: SuitFormat): RoleAssignment[] {
  const pick = shuffle(ALL_PROVIDERS)
  const p = pick[0]!
  const q = pick[1]!
  if (format === 'criminal') {
    return [ra(p, 'prosecutor', 'side_a'), ra(q, 'defense', 'side_b'), judgeAssignment()]
  }
  return [ra(p, 'counsel_a', 'side_a'), ra(q, 'counsel_b', 'side_b'), judgeAssignment()]
}

/** COUNSEL — user's chosen AI counsel; opposing counsel random among the other five providers. */
export function assignCounselOpponent(opts: {
  format: SuitFormat
  userRole: 'prosecutor' | 'defense' | 'counsel_a' | 'counsel_b'
  userCounselProvider: AiProviderName
}): { opponent: AiProviderName; assignments: RoleAssignment[] } {
  const pool = ALL_PROVIDERS.filter((x) => x !== opts.userCounselProvider)
  const opponent = pool[Math.floor(Math.random() * pool.length)]!
  let oppRole: Exclude<SuitLegalRole, 'judge' | 'user'>
  let oppBucket: 'side_a' | 'side_b'

  if (opts.format === 'criminal') {
    if (opts.userRole === 'prosecutor') {
      oppRole = 'defense'
      oppBucket = 'side_b'
    } else {
      oppRole = 'prosecutor'
      oppBucket = 'side_a'
    }
  } else {
    if (opts.userRole === 'counsel_a') {
      oppRole = 'counsel_b'
      oppBucket = 'side_b'
    } else {
      oppRole = 'counsel_a'
      oppBucket = 'side_a'
    }
  }

  const oppAssign = ra(opponent, oppRole, oppBucket)
  const userAssign: RoleAssignment = {
    provider: 'user',
    model: 'human',
    role: opts.userRole,
    sideBucket: oppBucket === 'side_a' ? 'side_b' : 'side_a',
  }
  return {
    opponent,
    assignments: [userAssign, oppAssign, judgeAssignment()],
  }
}

/** Counsel speeches only (excluding judge rows). */
export function counselAssignments(config: RoleAssignment[]): RoleAssignment[] {
  return config.filter((x) => x.role !== 'judge')
}

export function formatAssignmentsForJudge(format: SuitFormat): string {
  if (format === 'criminal') {
    return 'This is a CRIMINAL format. Verdict labels: Prosecution prevails OR Defense prevails.'
  }
  return 'This is a CIVIL format. Verdict labels: Counsel A prevails OR Counsel B prevails.'
}

export function formatTranscript(messages: SuitMessage[]): string {
  return messages
    .map((m) => `[${m.phase}] ${m.displayName}: ${m.content}`)
    .join('\n\n')
}

function formatTranscriptForJudgeVerdict(messages: SuitMessage[]): string {
  const witness = messages.find((m) => m.phase === 'witness_stand' && m.provider === 'user')
  if (!witness) return formatTranscript(messages)

  const r2 = [...messages].reverse().find((m) => m.phase === 'round_2')
  const r3 = messages.find((m) => m.phase === 'round_3')
  if (!r2 || !r3) return formatTranscript(messages)

  const out: string[] = []
  for (const m of messages) {
    if (m === r3) {
      out.push(
        `[WITNESS TESTIMONY]\n"${witness.content}"`,
        ''
      )
    }
    if (m.phase === 'witness_stand') continue
    out.push(`[${m.phase}] ${m.displayName}: ${m.content}`, '')
  }
  return out.join('\n').trim()
}

async function persistDebateLog(
  supabase: SupabaseClient,
  sessionId: string,
  text: string,
  meta: { role?: string; round?: number; turn?: number; phase?: string }
) {
  const json = JSON.stringify({ mode: 'suit', ...meta, message: text.slice(0, 12000) })
  await insertWithFallback(supabase, 'debate_logs', {
    session_id: sessionId,
    role: 'assistant',
    message_text: json,
    ai_name: 'suit',
  }, {
    session_id: sessionId,
    content: json,
    speaker: 'suit',
  })
}

/**
 * Claude Opus 4.7 — NO temperature/top_p/top_k (Anthropic rejects).
 */
export async function runJudgeOpus47(params: {
  apiKey: string
  systemPrompt: string
  userPrompt: string
  ctx: SuitTransportContext
  phaseTag: string
  aiResponseExtras?: Record<string, unknown>
}): Promise<{
  text: string | null
  responseTimeMs: number
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  error?: string
}> {
  const started = Date.now()
  const todayStr = new Date().toISOString().split('T')[0]
  const body: Record<string, unknown> = {
    model: JUDGE_MODEL_ID,
    max_tokens: 1024,
    system: `Today's date is ${todayStr}.\n\n${params.systemPrompt}`,
    messages: [{ role: 'user', content: params.userPrompt }],
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': params.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const responseTimeMs = Date.now() - started
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return {
        text: null,
        responseTimeMs,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        error: `Judge HTTP ${res.status}: ${errText.slice(0, 400)}`,
      }
    }
    const json = (await res.json()) as {
      content?: { text?: string }[]
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    const text =
      Array.isArray(json?.content)
        ? json!.content!.map((b) => b?.text).filter(Boolean).join('\n')
        : null
    const promptTokens =
      typeof json?.usage?.input_tokens === 'number' ? json.usage.input_tokens : null
    const completionTokens =
      typeof json?.usage?.output_tokens === 'number' ? json.usage.output_tokens : null

    const { supabase, sessionId } = params.ctx
    const extras = params.aiResponseExtras ?? {}
    await insertWithFallback(supabase, 'ai_responses', {
      session_id: sessionId,
      ai_name: 'opus_judge',
      model_name: JUDGE_MODEL_ID,
      response_text: text,
      response_time_ms: responseTimeMs,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens:
        promptTokens != null && completionTokens != null
          ? promptTokens + completionTokens
          : null,
      ...extras,
      suit_phase: params.phaseTag,
    }, {
      session_id: sessionId,
      ai_name: 'opus_judge',
      model_name: JUDGE_MODEL_ID,
      response_text: text,
    })
    await insertWithFallback(supabase, 'model_cost_logs', {
      session_id: sessionId,
      ai_name: 'opus_judge',
      model_name: JUDGE_MODEL_ID,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens:
        promptTokens != null && completionTokens != null
          ? promptTokens + completionTokens
          : null,
      response_time_ms: responseTimeMs,
      cost_usd: 0,
    }, {
      session_id: sessionId,
      model_name: JUDGE_MODEL_ID,
      total_tokens:
        promptTokens != null && completionTokens != null
          ? promptTokens + completionTokens
          : null,
    })
    await persistDebateLog(supabase, sessionId, text ?? '', {
      role: 'judge',
      phase: params.phaseTag,
    })

    return {
      text: typeof text === 'string' && text.length ? text : null,
      responseTimeMs,
      promptTokens,
      completionTokens,
      totalTokens:
        promptTokens != null && completionTokens != null
          ? promptTokens + completionTokens
          : null,
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return {
      text: null,
      responseTimeMs: Date.now() - started,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      error: msg,
    }
  }
}

function displayNameFor(
  format: SuitFormat,
  a: RoleAssignment,
  short: boolean
): string {
  if (a.role === 'judge') return 'Judge'
  if (a.provider === 'user') return 'You'
  const meta = suitCounselSelectorMeta(a.provider as AiProviderName)
  const name = meta?.nameEn ?? String(a.provider)
  const epi = meta?.epithetKo ? ` (${meta.epithetKo})` : ''
  return short ? `${name}${epi}` : `${name}${epi}`
}

function pushMessage(
  messages: SuitMessage[],
  m: Omit<SuitMessage, 'id' | 'createdAt'> & { id?: string }
) {
  messages.push({
    ...m,
    id: m.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: Date.now(),
  })
}

/** Speaking order: all side_a (shuffled) then side_b (shuffled). */
function orderForRound(assignments: RoleAssignment[], format: SuitFormat): RoleAssignment[] {
  const counsel = assignments.filter((x) => x.role !== 'judge' && x.provider !== 'user')
  const a = shuffle(counsel.filter((x) => x.sideBucket === 'side_a'))
  const b = shuffle(counsel.filter((x) => x.sideBucket === 'side_b'))
  return [...a, ...b]
}

function buildUserPromptForCounsel(
  topic: string,
  format: SuitFormat,
  round: number,
  history: SuitMessage[],
  witnessTestimony?: string
): string {
  const lines = [
    `CASE TOPIC:\n"""${topic}"""`,
    formatAssignmentsForJudge(format),
    roundInstructionUser(round, format),
    ``,
    `RECORD SO FAR:\n${formatTranscript(history)}`,
  ]
  if (witnessTestimony && round === 35) {
    lines.push(
      suitWitnessExaminationPrompt(format, witnessTestimony),
      `\nSpeaking order this phase: SIDE A (${format === 'criminal' ? 'Prosecution' : 'Counsel A'}) addresses the testimony FIRST (critical examination). Then SIDE B (${format === 'criminal' ? 'Defense' : 'Counsel B'}) SECOND (supportive or corroborative angle). Explicitly identify your stance in your first clause.`
    )
  }
  return lines.join('\n')
}

export async function runCounselOpponentTurn(opts: {
  topic: string
  format: SuitFormat
  userRoleLabel: string
  exchangeNum: 1 | 2 | 3 | 4
  opponent: RoleAssignment
  history: SuitMessage[]
  ctx: SuitTransportContext
  userLastMessage: string | null
}): Promise<RoundResult> {
  const { opponent, ctx, exchangeNum } = opts
  const opp = opponent.provider as AiProviderName
  const system = `${suitCounselModeOppositionPrefix(opts.userRoleLabel)}\n\n${buildCounselSystemPrompt(opp, opts.format, opponent.role, opponent.sideBucket, opts.topic, exchangeNum === 2 ? 120 : 100)}`
  console.log('[suit:counsel_system]', {
    provider: opp,
    format: opts.format,
    role: opponent.role,
    phase: `counsel_exchange_${exchangeNum}`,
    system_preview: system.slice(0, 260),
  })
  const user = buildCounselExchangeUserPrompt(
    exchangeNum,
    formatTranscript(opts.history),
    opts.userLastMessage,
    opts.userRoleLabel
  )
  const res = await runSingleAiProvider({
    supabase: ctx.supabase,
    sessionId: ctx.sessionId,
    userId: ctx.userId,
    provider: opp,
    prompt: user,
    systemPrompt: system,
    supabaseAccessToken: ctx.supabaseAccessToken,
    maxCompletionTokens: exchangeNum === 2 ? 450 : 360,
    temperature: 0.65,
    aiResponseExtras: {
      suit_exchange: exchangeNum,
      suit_role: opponent.role,
      suit_mode: 'counsel',
    },
  })
  pushMessage(opts.history, {
    role: opponent.role,
    sideBucket: opponent.sideBucket,
    provider: opp,
    displayName: displayNameFor(opts.format, opponent, false),
    phase: `counsel_exchange_${exchangeNum}`,
    content: res.text ?? res.error ?? '[No response]',
    responseTimeMs: res.responseTimeMs,
  })
  await persistDebateLog(ctx.supabase, ctx.sessionId, res.text ?? res.error ?? '', {
    phase: `counsel_ex_${exchangeNum}`,
    role: opponent.role,
  })
  return {
    assignment: opponent,
    round: exchangeNum,
    phase: `counsel_exchange_${exchangeNum}`,
    text: res.text,
    responseTimeMs: res.responseTimeMs,
    error: res.error,
  }
}

/**
 * Run one numbered round for spectator/witness modes (sequential counsel calls).
 * Use round=35 with witnessTestimony for witness examination step.
 */
export async function runSuitRound(
  topic: string,
  format: SuitFormat,
  participationMode: SuitParticipationMode,
  round: number,
  assignments: RoleAssignment[],
  conversationHistory: SuitMessage[],
  ctx: SuitTransportContext,
  witnessTestimony?: string
): Promise<RoundResult[]> {
  const results: RoundResult[] = []
  const counsel = assignments.filter((x) => x.role !== 'judge' && x.provider !== 'user')
  const ordered =
    round === 35 && witnessTestimony
      ? orderForRound(assignments, format)
      : orderForRound(assignments, format)

  const maxWords: 100 | 120 = round === 2 ? 120 : 100

  for (const a of ordered) {
    const system = buildCounselSystemPrompt(
      a.provider as AiProviderName,
      format,
      a.role,
      a.sideBucket,
      topic,
      maxWords
    )
    console.log('[suit:counsel_system]', {
      provider: a.provider as AiProviderName,
      format,
      role: a.role,
      round,
      system_preview: system.slice(0, 260),
    })
    const user = buildUserPromptForCounsel(
      topic,
      format,
      round,
      conversationHistory,
      round === 35 ? witnessTestimony : undefined
    )

    const res = await runSingleAiProvider({
      supabase: ctx.supabase,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      provider: a.provider as AiProviderName,
      prompt: user,
      systemPrompt: system,
      supabaseAccessToken: ctx.supabaseAccessToken,
      maxCompletionTokens: maxWords === 120 ? 400 : 320,
      temperature: 0.65,
      aiResponseExtras: {
        suit_round: round,
        suit_role: a.role,
        suit_side: a.sideBucket,
      },
    })

    const text = res.text
    const phase =
      round === 35 ? 'witness_exam' : `round_${round}`

    pushMessage(conversationHistory, {
      role: a.role,
      sideBucket: a.sideBucket,
      provider: a.provider as AiProviderName,
      displayName: displayNameFor(format, a, false),
      phase,
      round,
      content: text ?? res.error ?? '[No response]',
      responseTimeMs: res.responseTimeMs,
    })

    await persistDebateLog(ctx.supabase, ctx.sessionId, text ?? res.error ?? '', {
      role: a.role,
      round,
      phase,
    })

    results.push({
      assignment: a,
      round,
      phase,
      text,
      responseTimeMs: res.responseTimeMs,
      error: res.error,
    })
  }

  void participationMode
  return results
}

export async function runJudgeCounselOpening(
  topic: string,
  ctx: SuitTransportContext,
  apiKey: string,
  messages: SuitMessage[]
): Promise<string | null> {
  const out = await runJudgeOpus47({
    apiKey,
    systemPrompt: suitJudgeCounselOpeningSystem(),
    userPrompt: suitJudgeCounselOpeningUser(topic),
    ctx,
    phaseTag: 'counsel_opening',
    aiResponseExtras: { suit_phase: 'counsel_opening' },
  })
  pushMessage(messages, {
    role: 'judge',
    sideBucket: 'neutral',
    provider: 'opus_judge',
    displayName: 'Judge (Opus 4.7)',
    phase: 'counsel_opening',
    content: out.text ?? out.error ?? '[No opening]',
    responseTimeMs: out.responseTimeMs,
  })
  return out.text
}

export async function runJudgeOpening(
  topic: string,
  format: SuitFormat,
  ctx: SuitTransportContext,
  apiKey: string,
  messages: SuitMessage[]
): Promise<string | null> {
  const sys = `${suitJudgeOpeningSystem()}\n\n${formatAssignmentsForJudge(format)}`
  const user = suitJudgeOpeningUser(topic)
  const out = await runJudgeOpus47({
    apiKey,
    systemPrompt: sys,
    userPrompt: user,
    ctx,
    phaseTag: 'opening',
    aiResponseExtras: { suit_phase: 'opening' },
  })
  pushMessage(messages, {
    role: 'judge',
    sideBucket: 'neutral',
    provider: 'opus_judge',
    displayName: 'Judge (Opus 4.7)',
    phase: 'opening',
    content: out.text ?? out.error ?? '[No ruling]',
    responseTimeMs: out.responseTimeMs,
  })
  return out.text
}

function suitJudgeVerdictWrapper(format: SuitFormat): string {
  return `${SUIT_JUDGE_SYSTEM_PROMPT}\n\n${formatAssignmentsForJudge(format)}`
}

export async function runJudgeVerdict(
  topic: string,
  format: SuitFormat,
  ctx: SuitTransportContext,
  apiKey: string,
  messages: SuitMessage[],
  extras?: Record<string, unknown>,
  transcriptFooter?: string
): Promise<string | null> {
  const base = formatTranscriptForJudgeVerdict(messages)
  const user = suitJudgeVerdictUser(
    topic,
    transcriptFooter ? `${base}\n\n---\n${transcriptFooter}` : base
  )
  const out = await runJudgeOpus47({
    apiKey,
    systemPrompt: suitJudgeVerdictWrapper(format),
    userPrompt: user,
    ctx,
    phaseTag: 'verdict',
    aiResponseExtras: { suit_phase: 'verdict', ...extras },
  })
  pushMessage(messages, {
    role: 'judge',
    sideBucket: 'neutral',
    provider: 'opus_judge',
    displayName: 'Judge (Opus 4.7)',
    phase: 'verdict',
    content: out.text ?? out.error ?? '[No verdict]',
    responseTimeMs: out.responseTimeMs,
  })
  return out.text
}
