import {
  MODEL_BY_PROVIDER,
  runSingleAiProvider,
  type AiProviderName,
  type RouterResult,
} from '@/lib/ai/router'
import {
  buildDeliberationContext,
  buildFacilitatorInput,
  buildVerdictInput,
  countApproxTokens,
  type FacilitatorSummary,
  type SynodTurn,
} from '@/lib/synod/build-memory'
import { supabaseAdmin } from '@/lib/supabase/server'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import { deductCreditsBalance } from '@/lib/credits-server'

const VALID_PROVIDERS = new Set<AiProviderName>([
  'openai',
  'anthropic',
  'google',
  'xai',
  'deepseek',
  'mistral',
])

/** Brand names shown in deliberation context / facilitator input. */
const PROVIDER_TO_BRAND: Record<AiProviderName, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
}

/**
 * Debater models. openai/xai MUST override the router defaults (gpt-4o / grok-3
 * are outdated for SYNOD); the rest follow MODEL_BY_PROVIDER except google,
 * which is pinned per SYNOD spec.
 */
const DEBATER_MODEL: Record<AiProviderName, string> = {
  openai: 'gpt-5.4-mini',
  anthropic: 'claude-sonnet-4-6',
  google: 'gemini-3-flash-preview',
  xai: 'grok-4.3',
  deepseek: MODEL_BY_PROVIDER.deepseek,
  mistral: MODEL_BY_PROVIDER.mistral,
}

const FACILITATOR_PROVIDER: AiProviderName = 'openai'
const FACILITATOR_MODEL = 'gpt-5.4'
const VERDICT_PROVIDER: AiProviderName = 'anthropic'
const VERDICT_MODEL = 'claude-opus-4-8'

const ACTION_TAGS = ['AGREE', 'CHALLENGE', 'SUPPLEMENT', 'REFRAME'] as const
type SynodActionTag = (typeof ACTION_TAGS)[number]

// ──────────────────────────────────────────────────────────────────────────
// Output parsing helpers
// ──────────────────────────────────────────────────────────────────────────

/** Extracts the trailing "CLAIM: <one line>" and returns content without it. */
function parseClaim(raw: string): { content: string; claim: string | null } {
  const m = raw.match(/^CLAIM:\s*(.+)\s*$/im)
  if (!m) return { content: raw.trim(), claim: null }
  const claim = m[1]!.trim()
  const content = raw.replace(m[0], '').trim()
  return { content, claim: claim || null }
}

/** Extracts a leading "ACTION: <TAG>" line and returns content without it. */
function parseActionTag(raw: string): { content: string; tag: SynodActionTag | null } {
  const m = raw.match(/^ACTION:\s*(AGREE|CHALLENGE|SUPPLEMENT|REFRAME)\s*$/im)
  if (!m) return { content: raw.trim(), tag: null }
  const tag = m[1]!.toUpperCase() as SynodActionTag
  const content = raw.replace(m[0], '').trim()
  return { content, tag }
}

/** Strips ```json fences and parses JSON; returns null on any failure. */
function safeParseJson(raw: string): Record<string, unknown> | null {
  let text = raw.trim()
  // Tolerate a missing closing fence (truncated output).
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence && fence[1]) text = fence[1].trim()
  // Fall back to the outermost {...} block when the model added prose anyway.
  if (!text.startsWith('{')) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    text = text.slice(start, end + 1)
  }
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Last-resort verdict recovery: when the verdict JSON is truncated/malformed
 * (e.g. long Korean output hits the token cap and the closing brace is lost),
 * salvage the human-readable verdict text instead of failing the session.
 */
function cleanVerdictFallbackText(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence && fence[1]) text = fence[1].trim()
  // Pull the "verdict" string value out of a (possibly unterminated) JSON wrapper.
  const m = text.match(/"verdict"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"|"\s*}|$)/)
  if (m && m[1]) {
    return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim()
  }
  return text
}

function coerceFacilitatorSummary(
  obj: Record<string, unknown>,
  roundNumber: number
): FacilitatorSummary | null {
  const consensusRaw = Array.isArray(obj.consensusPoints) ? obj.consensusPoints : null
  const issuesRaw = Array.isArray(obj.openIssues) ? obj.openIssues : null
  const score = Number(obj.roundConsensusScore)
  const directive = typeof obj.nextDirective === 'string' ? obj.nextDirective : ''
  if (!consensusRaw || !issuesRaw || !Number.isFinite(score)) return null

  const consensusPoints: FacilitatorSummary['consensusPoints'] = []
  for (const item of consensusRaw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (typeof o.point !== 'string') continue
    const agreedBy = Array.isArray(o.agreedBy)
      ? o.agreedBy.filter((x): x is string => typeof x === 'string')
      : []
    consensusPoints.push({ point: o.point, agreedBy })
  }

  const openIssues: FacilitatorSummary['openIssues'] = []
  for (const item of issuesRaw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (typeof o.issue !== 'string') continue
    const positions = Array.isArray(o.positions)
      ? o.positions
          .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
          .map((p) => ({
            ai: typeof p.ai === 'string' ? p.ai : 'unknown',
            stance: typeof p.stance === 'string' ? p.stance : '',
          }))
      : []
    openIssues.push({ issue: o.issue, positions })
  }

  return {
    roundNumber,
    consensusPoints,
    openIssues,
    roundConsensusScore: Math.max(0, Math.min(100, Math.round(score))),
    nextDirective: directive,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// DB loaders (synod_rounds / synod_turns → pure types)
// ──────────────────────────────────────────────────────────────────────────

async function loadPriorSummaries(sessionId: string): Promise<FacilitatorSummary[]> {
  // synod_rounds intentionally stores the summary as SEPARATE columns (not one
  // JSONB) for later data-mining queries — reconstruct FacilitatorSummary here.
  const { data, error } = await supabaseAdmin
    .from('synod_rounds')
    .select('round_number, consensus_points, open_issues, round_consensus_score, next_directive')
    .eq('session_id', sessionId)
    .order('round_number', { ascending: true })
  if (error || !data) return []

  const out: FacilitatorSummary[] = []
  for (const row of data) {
    const summary = coerceFacilitatorSummary(
      {
        consensusPoints: row.consensus_points,
        openIssues: row.open_issues,
        roundConsensusScore: row.round_consensus_score,
        nextDirective: row.next_directive,
      },
      Number(row.round_number)
    )
    if (summary) out.push(summary)
  }
  return out
}

async function loadRoundTurns(sessionId: string, roundNumber: number): Promise<SynodTurn[]> {
  const { data, error } = await supabaseAdmin
    .from('synod_turns')
    .select('round_number, ai_name, action_tag, claim, content, is_red_team, created_at')
    .eq('session_id', sessionId)
    .eq('round_number', roundNumber)
    .order('created_at', { ascending: true })
  if (error || !data) return []

  return data.map((row) => {
    const provider = row.ai_name as AiProviderName
    const tag =
      typeof row.action_tag === 'string' &&
      (ACTION_TAGS as readonly string[]).includes(row.action_tag)
        ? (row.action_tag as SynodActionTag)
        : undefined
    return {
      roundNumber: Number(row.round_number),
      aiName: PROVIDER_TO_BRAND[provider] ?? String(row.ai_name),
      actionTag: tag,
      claim: typeof row.claim === 'string' && row.claim ? row.claim : undefined,
      content: String(row.content ?? ''),
      isRedTeam: row.is_red_team === true,
    }
  })
}

// ──────────────────────────────────────────────────────────────────────────
// System prompts
// ──────────────────────────────────────────────────────────────────────────

/** Deliberation difficulty mode. Stored on the session; default 'easy'. */
type SynodMode = 'easy' | 'expert'

function parseSynodMode(raw: unknown): SynodMode {
  return raw === 'expert' ? 'expert' : 'easy'
}

/**
 * Reads the session's stored mode so resumed sessions keep their difficulty
 * (never trust the client per-call). Falls back to 'easy' on any read failure.
 */
async function loadSessionMode(sessionId: string): Promise<SynodMode> {
  const { data, error } = await supabaseAdmin
    .from('synod_sessions')
    .select('mode')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error || !data) return 'easy'
  return parseSynodMode(data.mode)
}

const OUTPUT_TAIL_RULE = `End your response with exactly one final line in this format (this line is mandatory):
CLAIM: <one sentence distilling your core claim>`

/** Per-debater voice. Applies in BOTH easy and expert modes — persona is about voice, not difficulty. */
const PERSONA: Record<AiProviderName, string> = {
  openai:
    'You explain things like a great teacher — you take whatever others said and make it crystal clear and easy, using simple everyday examples. You are the one who makes the hard stuff click.',
  anthropic:
    'You are the reflective one who questions assumptions — you often step back and ask whether the question itself is framed wrong, and propose a better angle. Thoughtful, a little contrarian about premises.',
  google:
    "You are the balanced mediator — calm, neutral, fact- and evidence-focused. You find the middle ground and point to what's actually known.",
  xai:
    'You are the cool, slightly cheeky rebel — you push back against the forming consensus with a bit of attitude and wit, but you genuinely want the best answer, not just to be difficult.',
  deepseek:
    'You are sharp, efficient, no-fluff. You cut straight to the point with cold logic. Short and incisive.',
  mistral:
    'You are the playful, artistic one — you bring humor, vivid metaphors, and a creative angle others miss.',
}

/**
 * Voice rules for all debaters, both modes. The "name the other AI by brand"
 * line is omitted in the opening round, where referencing others is forbidden.
 */
function voiceRules(hasPriorParticipants: boolean): string {
  return `VOICE RULES (all modes):
- Write in a lively, human, spoken voice. NO report/essay tone (ban stiff endings like "~할 수 있습니다", "~한 측면이 있습니다", "~한 편이 더 정확합니다" and their equivalents in any language).
- Use concrete examples and real situations, not abstract generalities.
- You must sound DIFFERENT from the other participants — that is the point of personas. Sounding identical = failure.
${hasPriorParticipants ? `- When reacting, name the other AI by brand and hit their point directly: e.g. "GPT는 X라고 했는데, 그건 핵심을 놓쳤어 — 왜냐면...".\n` : ''}- IMPORTANT: personas add flavor but everyone still argues toward the BEST answer. This is a cooperative search for truth, not a fight. Push back with wit, never hostility.`
}

/** Convergence push for late rounds: partial agreement, not fake unanimity. */
const LATE_ROUND_RULE = `This is a LATE round — start converging. Acknowledge what others got right and move toward a shared answer. BUT do NOT fake agreement: if you genuinely still disagree on a specific point, say so clearly and hold that point ("I agree with X, but I still don't buy Y because..."). Honest partial agreement is better than hollow unanimity. Only fully agree if you are actually convinced.`

/**
 * Mode-specific difficulty rules, layered ON TOP of the base rules.
 * `hasPriorParticipants` is false for the opening round (round 0), where the
 * "react to a prior participant" rule would contradict the opening's
 * "do not reference others" rule — that single line is omitted there.
 */
function modeStyleBlock(mode: SynodMode, hasPriorParticipants: boolean): string {
  if (mode === 'expert') {
    return `WRITING STYLE (EXPERT MODE):
- Technical depth and academic concepts are allowed; argue rigorously.
- But control length: 8–10 sentences max. Do NOT turn this into an essay with many headings.
- No dry report tone — keep your persona's voice while arguing rigorously.
${hasPriorParticipants ? `- React directly to a specific prior participant's claim first, before adding anything new.\n` : ''}- HALLUCINATION GUARD (critical in this mode): do NOT invent study names, author names, journal names, years, or precise numbers (effect sizes, sample sizes, percentages). Cite specifics ONLY if you are certain. When uncertain, write "a study suggests" without fake citations. Fabricated citations are a serious failure.`
  }
  return `WRITING STYLE (EASY MODE — strict):
- Write so a MIDDLE-SCHOOL student or a busy parent with no background fully gets it on first read.
- Short, punchy sentences. Everyday words only. If a hard idea is needed, explain it with a simple everyday example.
- Do NOT use foreign loanwords or academic jargon (e.g. eudaimonic, biopsychosocial).
- Do NOT use headings, numbered lists, or tables. Write 1–2 natural paragraphs.
- Keep it short: 5–6 sentences maximum.
- Make it ENJOYABLE to read — a little personality, not a dry summary.
${hasPriorParticipants ? `- React directly to ONE specific prior participant's point (name it, then agree/refute/build on it). Do not just pile on new concepts.\n` : ''}- Do NOT fabricate study names, author names, or precise statistics (SD, n=, %). If unsure, say "some research suggests" in plain terms.`
}

function openingSystemPrompt(provider: AiProviderName, mode: SynodMode): string {
  return `You are participating in SYNOD, a structured multi-AI deliberation. You are ${PROVIDER_TO_BRAND[provider]}.

PERSONA — your voice (stay in character while arguing substantively):
${PERSONA[provider]}

This is the OPENING round. Give your own independent, well-reasoned opinion on the user's question.
Rules:
- Do NOT reference, imagine, or speculate about any other participant's answer. You have not seen any.
- Take a clear position. Hedging on every point is a failure.
- Respond in the same language as the question.
- Keep it focused: your strongest reasoning only, no filler.

${voiceRules(false)}

${modeStyleBlock(mode, false)}

${OUTPUT_TAIL_RULE}`
}

function turnSystemPrompt(
  provider: AiProviderName,
  isRedTeam: boolean,
  mode: SynodMode,
  roundNumber: number
): string {
  const lateBlock = roundNumber >= 4 ? `\n${LATE_ROUND_RULE}\n` : ''
  if (isRedTeam) {
    return `You are participating in SYNOD, a structured multi-AI deliberation. You are ${PROVIDER_TO_BRAND[provider]}. This round you are the RED TEAM.

PERSONA — your voice (stay in character while arguing substantively):
${PERSONA[provider]}

Your SOLE job this round: find and articulate the STRONGEST objection to the forming consensus shown in the deliberation context. Do not be agreeable. Do not soften. If the consensus has a fatal flaw, expose it; if it merely has weak points, press the weakest one hard.
Rules:
- You MUST begin your response with exactly one line: "ACTION: CHALLENGE"
- Attack the consensus on its merits — evidence, logic, missing perspectives — not on style.
- Respond in the same language as the question.
${lateBlock}
${voiceRules(true)}

${modeStyleBlock(mode, true)}

${OUTPUT_TAIL_RULE}`
  }
  return `You are participating in SYNOD, a structured multi-AI deliberation. You are ${PROVIDER_TO_BRAND[provider]}. Other participants have spoken; their positions and the facilitator's summary are in the context. Address them by brand name.

You MUST begin your response with exactly one line declaring your move:
"ACTION: AGREE" | "ACTION: CHALLENGE" | "ACTION: SUPPLEMENT" | "ACTION: REFRAME"
- AGREE: you endorse the forming consensus (say precisely what convinced you).
- CHALLENGE: you attack a specific claim (quote or paraphrase it, then refute it).
- SUPPLEMENT: you add a materially new argument, evidence, or dimension.
- REFRAME: you argue the question itself is being approached wrongly and propose a better frame.

Be STUBBORN about your own reasoning: do not abandon a position you previously took unless the context contains a genuinely stronger argument — and if you do concede, name exactly which argument changed your mind. Drifting toward the majority without cause is a failure.
Respond in the same language as the question.
${lateBlock}
${voiceRules(true)}

${modeStyleBlock(mode, true)}

${OUTPUT_TAIL_RULE}`
}

const FACILITATOR_SYSTEM = `You are the neutral Facilitator of SYNOD, a multi-AI deliberation. You never argue a position yourself.

Read this round's turns and produce a compressed structured summary.

OUTPUT FORMAT — STRICT JSON ONLY. No prose, no markdown fences, no commentary. Exactly this shape:
{
  "consensusPoints": [{ "point": "string", "agreedBy": ["participant name"] }],
  "openIssues": [{ "issue": "string", "positions": [{ "ai": "participant name", "stance": "string" }] }],
  "roundConsensusScore": 0,
  "nextDirective": "string"
}
- roundConsensusScore: integer 0-100 — how close the participants are to one shared answer.
- nextDirective: the single most productive focus for the next round.
- Be faithful: only record consensus that actually exists in the turns. Never invent agreement.`

const VERDICT_SYSTEM_BASE = [
  'You are the Verdict Chair of SYNOD, a multi-AI deliberation. You are Claude Opus 4.8.',
  'Participants are anonymized; judge ideas strictly on their merits. Write the final synthesis of the deliberation — the best consensus answer the group reached, strengthened by your own judgment.',
  'You MUST preserve dissent: if any participant maintained a serious unresolved objection, it belongs in the minority report. Erasing dissent is a failure.',
  'OUTPUT FORMAT — STRICT JSON ONLY. No prose outside the JSON, no markdown fences. Exactly this shape:',
  '{ "verdict": "string — full final synthesis in the question\'s language, ending with sign-off: — Claude Opus 4.8", "minorityReport": [{ "ai": "participant label", "dissent": "string", "reason": "string" }], "finalScore": 0 }',
  '- finalScore: integer 0-100 — the final consensus strength. This is the SINGLE authoritative score shown to the user (the gauge reads finalScore, not the last facilitator round score). Set it consistent with the deliberation: it should reflect where the group actually landed and must NOT diverge wildly from the last facilitator roundConsensusScore unless the final round genuinely shifted consensus.',
  '- minorityReport may be an empty array ONLY if no genuine dissent remained.',
].join('\n\n')

function verdictSystemPrompt(mode: SynodMode): string {
  const modeRule =
    mode === 'expert'
      ? `MODE (EXPERT): Technical depth is fine, but do not fabricate citations or statistics; keep the synthesis tight.`
      : `MODE (EASY): Write the verdict so a non-expert fully understands — plain language, no jargon, and add a one-line plain-language summary at the very top before the detailed synthesis.`
  return `${VERDICT_SYSTEM_BASE}

${modeRule}

DISCLAIMER (mandatory, both modes): at the very END of the "verdict" string, append this one-line disclaimer, translated into the language of the question: "(이 합의는 AI들의 토론에 기반하며, 통계·연구 인용은 검증이 필요합니다.)" — i.e. "This consensus is based on a deliberation between AIs; statistics and study citations require verification."`
}

// ──────────────────────────────────────────────────────────────────────────
// Route
// ──────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  console.error('[SYNOD] action:', body?.action, 'isFirst:', body?.isFirst)

  // Outer guard: any uncaught error in the handler is logged with its real cause.
  try {
    return await handleSynodPost(req, body)
  } catch (err: unknown) {
    console.error('[SYNOD] TOP-LEVEL ERROR:', err)
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    )
  }
}

async function handleSynodPost(req: Request, body: Record<string, unknown>): Promise<Response> {
  const action = typeof body.action === 'string' ? body.action : ''
  const { user, error: authErr } = await resolveRouteAuth(req, body)
  const supabase = supabaseAdmin
  if (authErr || !user) {
    console.error('[SYNOD] auth step failed:', authErr)
    return Response.json({ error: 'Invalid session' }, { status: 401 })
  }

  // ---- ACTION 0: load — resume support. Returns all persisted progress for a
  // session so the client can hydrate and continue from the first missing step.
  // Read-only; requires no question; owner-gated. ----
  if (action === 'load') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    if (!sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 })
    }

    const { data: sess, error: sessErr } = await supabase
      .from('synod_sessions')
      .select('session_id, user_id, question, status, total_rounds, consensus_score')
      .eq('session_id', sessionId)
      .maybeSingle()
    if (sessErr || !sess) {
      return Response.json({ error: 'Session not found' }, { status: 404 })
    }
    if (sess.user_id && sess.user_id !== user.id) {
      return Response.json({ error: 'Not your session' }, { status: 403 })
    }

    const [turnsRes, roundsRes, resultRes] = await Promise.all([
      supabase
        .from('synod_turns')
        .select('round_number, ai_name, action_tag, claim, content, is_red_team, ms, created_at')
        .eq('session_id', sessionId)
        .order('round_number', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('synod_rounds')
        .select(
          'round_number, consensus_points, open_issues, round_consensus_score, next_directive, challenge_missing'
        )
        .eq('session_id', sessionId)
        .order('round_number', { ascending: true }),
      supabase
        .from('synod_session_results')
        .select('verdict, minority_report, final_score')
        .eq('session_id', sessionId)
        .maybeSingle(),
    ])

    const turns = (turnsRes.data ?? []).map((row) => ({
      roundNumber: Number(row.round_number),
      ai: String(row.ai_name),
      actionTag: typeof row.action_tag === 'string' ? row.action_tag : null,
      claim: typeof row.claim === 'string' ? row.claim : null,
      content: String(row.content ?? ''),
      isRedTeam: row.is_red_team === true,
      ms: typeof row.ms === 'number' ? row.ms : null,
    }))

    const rounds = (roundsRes.data ?? [])
      .map((row) => {
        const summary = coerceFacilitatorSummary(
          {
            consensusPoints: row.consensus_points,
            openIssues: row.open_issues,
            roundConsensusScore: row.round_consensus_score,
            nextDirective: row.next_directive,
          },
          Number(row.round_number)
        )
        if (!summary) return null
        return { roundNumber: summary.roundNumber, summary, challengeMissing: row.challenge_missing === true }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    const resultRow = resultRes.data
    const result = resultRow
      ? {
          verdict: String(resultRow.verdict ?? ''),
          minorityReport: Array.isArray(resultRow.minority_report) ? resultRow.minority_report : [],
          finalScore: typeof resultRow.final_score === 'number' ? resultRow.final_score : 0,
        }
      : null

    return Response.json({
      ok: true,
      session: {
        id: String(sess.session_id),
        question: String(sess.question ?? ''),
        status: String(sess.status ?? 'running'),
        totalRounds: typeof sess.total_rounds === 'number' ? sess.total_rounds : 0,
        consensusScore: typeof sess.consensus_score === 'number' ? sess.consensus_score : null,
      },
      turns,
      rounds,
      result,
    })
  }

  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question) {
    return Response.json({ error: 'question is required' }, { status: 400 })
  }

  // ---- ACTION 1: opening — one debater's independent round-0 opinion. ----
  if (action === 'opening') {
    const provider = body.provider as AiProviderName
    if (typeof provider !== 'string' || !VALID_PROVIDERS.has(provider)) {
      return Response.json({ error: 'Invalid provider' }, { status: 400 })
    }
    const isFirst = body.isFirst === true
    const uiLocale = typeof body.ui_locale === 'string' ? body.ui_locale : null

    let sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    let creditsRemaining: number | undefined
    let mode: SynodMode = parseSynodMode(body.mode)

    if (isFirst) {
      const ins = await supabase
        .from('synod_sessions')
        .insert([{ user_id: user.id, question, status: 'running', ui_locale: uiLocale, mode }])
        .select()
        .single()
      // synod_sessions PK is `session_id` (NOT `id`).
      if (ins.error || !ins.data?.session_id) {
        console.error('[SYNOD] session insert failed:', ins.error)
        return Response.json(
          { error: ins.error?.message ?? 'Could not start session' },
          { status: 500 }
        )
      }
      sessionId = String(ins.data.session_id)

      const synodCredits = mode === 'expert' ? 25 : 20

      // SYNOD CREDIT DEDUCTION — once per session, on the first opening call.
      const deduct = await deductCreditsBalance(supabase, user.id, synodCredits, 'synod_session')
      if (!deduct.ok) {
        console.error('[SYNOD] credit deduct failed:', deduct)
        const insufficient = deduct.reason === 'insufficient'
        return Response.json(
          {
            error: insufficient ? 'Insufficient credits' : 'Could not update credits',
            balance: deduct.balance,
            required: synodCredits,
          },
          { status: insufficient ? 402 : 500 }
        )
      }
      // deduct.skipped (admin / dev without credits table) is ok:true — proceed.
      creditsRemaining = deduct.balance ?? undefined
    }

    if (!sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 })
    }

    // Non-first opening calls: trust the stored session mode, not the client.
    if (!isFirst) {
      mode = await loadSessionMode(sessionId)
    }

    let r: RouterResult
    try {
      r = await runSingleAiProvider({
        supabase,
        sessionId: null,
        userId: null,
        provider,
        prompt: `QUESTION:\n${question}`,
        systemPrompt: openingSystemPrompt(provider, mode),
        // Korean uses ~2-3x more tokens than English; keep headroom.
        maxCompletionTokens: 2500,
        modelOverride: DEBATER_MODEL[provider],
      })
      console.error(
        '[SYNOD opening] provider:',
        provider,
        'model used:',
        DEBATER_MODEL[provider],
        'result:',
        JSON.stringify(r)?.slice(0, 500)
      )
      if (r.error || !r.text) {
        console.error('[SYNOD opening] runSingleAiProvider .error:', r?.error)
        return Response.json(
          { ok: false, error: r.error ?? 'Empty response' },
          { status: 500 }
        )
      }
    } catch (err: unknown) {
      console.error('[SYNOD opening] CAUGHT ERROR:', err)
      const msg = err instanceof Error ? err.message : 'AI call failed'
      return Response.json({ ok: false, error: msg }, { status: 500 })
    }

    const { content, claim } = parseClaim(r.text)

    // Insert immediately after the AI call — the resume point for mobile polling.
    const turnIns = await supabase.from('synod_turns').insert([
      {
        session_id: sessionId,
        round_number: 0,
        ai_name: provider,
        action_tag: null,
        content,
        claim,
        is_red_team: false,
        ms: r.responseTimeMs,
      },
    ])
    if (turnIns.error) {
      console.error('[SYNOD opening] db insert failed:', turnIns?.error)
      return Response.json({ ok: false, error: turnIns.error.message }, { status: 500 })
    }

    const turn = {
      roundNumber: 0,
      aiName: provider,
      actionTag: null,
      claim,
      content,
      isRedTeam: false,
      ms: r.responseTimeMs,
    }
    return Response.json({ ok: true, sessionId, creditsRemaining, turn })
  }

  // ---- ACTION 2: turn — one debater's serial deliberation turn. ----
  else if (action === 'turn') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const provider = body.provider as AiProviderName
    const roundNumber = typeof body.roundNumber === 'number' ? body.roundNumber : NaN
    if (!sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 })
    }
    if (typeof provider !== 'string' || !VALID_PROVIDERS.has(provider)) {
      return Response.json({ error: 'Invalid provider' }, { status: 400 })
    }
    if (!Number.isFinite(roundNumber) || roundNumber < 1) {
      return Response.json({ error: 'Invalid roundNumber' }, { status: 400 })
    }
    // Red team stays active through round 4; off only in the final round (5).
    // Prevents an abrupt consensus spike when red team disappears mid-deliberation.
    const isRedTeam = roundNumber >= 5 ? false : body.isRedTeam === true

    const [priorSummaries, currentRoundTurns, mode] = await Promise.all([
      loadPriorSummaries(sessionId),
      loadRoundTurns(sessionId, roundNumber),
      loadSessionMode(sessionId),
    ])

    // Compressed context (latest summary full, older one-liners) — never raw history.
    // anonymize: false — debaters see and address each other by BRAND NAME.
    // Only the verdict chair gets an anonymized input (self-preference guard).
    const ctx = buildDeliberationContext({
      question,
      priorSummaries,
      currentRoundTurns,
      anonymize: false,
    })
    console.log(`[synod] turn ctx ~${countApproxTokens(ctx.text)} tokens (r${roundNumber}, ${provider})`)

    let r: RouterResult
    try {
      r = await runSingleAiProvider({
        supabase,
        sessionId: null,
        userId: null,
        provider,
        prompt: ctx.text,
        systemPrompt: turnSystemPrompt(provider, isRedTeam, mode, roundNumber),
        // Korean uses ~2-3x more tokens than English; keep headroom.
        maxCompletionTokens: 2500,
        modelOverride: DEBATER_MODEL[provider],
      })
      if (r.error || !r.text) {
        console.error('[SYNOD turn] runSingleAiProvider failed:', provider, r?.error ?? r)
        return Response.json(
          { ok: false, error: r.error ?? 'Empty response' },
          { status: 500 }
        )
      }
    } catch (e: unknown) {
      console.error('[SYNOD turn] CAUGHT ERROR:', provider, e)
      const msg = e instanceof Error ? e.message : 'AI call failed'
      return Response.json({ ok: false, error: msg }, { status: 500 })
    }

    const tagged = parseActionTag(r.text)
    const { content, claim } = parseClaim(tagged.content)
    const actionTag: SynodActionTag = tagged.tag ?? (isRedTeam ? 'CHALLENGE' : 'SUPPLEMENT')

    // Insert immediately after the AI call — the resume point for mobile polling.
    const turnIns = await supabase.from('synod_turns').insert([
      {
        session_id: sessionId,
        round_number: roundNumber,
        ai_name: provider,
        action_tag: actionTag,
        content,
        claim,
        is_red_team: isRedTeam,
        ms: r.responseTimeMs,
      },
    ])
    if (turnIns.error) {
      console.error('[SYNOD turn] db insert failed:', turnIns?.error)
      return Response.json({ ok: false, error: turnIns.error.message }, { status: 500 })
    }

    const turn = {
      roundNumber,
      aiName: provider,
      actionTag,
      claim,
      content,
      isRedTeam,
      ms: r.responseTimeMs,
    }
    return Response.json({ ok: true, turn })
  }

  // ---- ACTION 3: facilitate — GPT-5.4 compresses the round into a summary. ----
  else if (action === 'facilitate') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const roundNumber = typeof body.roundNumber === 'number' ? body.roundNumber : NaN
    if (!sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 })
    }
    if (!Number.isFinite(roundNumber) || roundNumber < 0) {
      return Response.json({ error: 'Invalid roundNumber' }, { status: 400 })
    }

    const [priorSummaries, allTurnsThisRound] = await Promise.all([
      loadPriorSummaries(sessionId),
      loadRoundTurns(sessionId, roundNumber),
    ])
    if (!allTurnsThisRound.length) {
      return Response.json({ error: 'No turns to facilitate' }, { status: 400 })
    }

    const input = buildFacilitatorInput({
      question,
      roundNumber,
      allTurnsThisRound,
      priorSummaries,
    })
    console.log(`[synod] facilitate input ~${countApproxTokens(input)} tokens (r${roundNumber})`)

    let r: RouterResult
    try {
      r = await runSingleAiProvider({
        supabase,
        sessionId: null,
        userId: null,
        provider: FACILITATOR_PROVIDER,
        prompt: input,
        systemPrompt: FACILITATOR_SYSTEM,
        // Structured JSON summary; Korean stances need extra room.
        maxCompletionTokens: 4000,
        modelOverride: FACILITATOR_MODEL,
      })
      if (r.error || !r.text) {
        console.error('[SYNOD facilitate] runSingleAiProvider failed:', FACILITATOR_PROVIDER, r?.error ?? r)
        return Response.json(
          { ok: false, error: r.error ?? 'Empty response' },
          { status: 500 }
        )
      }
    } catch (e: unknown) {
      console.error('[SYNOD facilitate] CAUGHT ERROR:', e)
      const msg = e instanceof Error ? e.message : 'Facilitator call failed'
      return Response.json({ ok: false, error: msg }, { status: 500 })
    }

    const parsed = safeParseJson(r.text)
    const summary = parsed ? coerceFacilitatorSummary(parsed, roundNumber) : null
    if (!summary) {
      console.error('[SYNOD facilitate] JSON parse failed. raw:', r.text?.slice(0, 500))
      return Response.json(
        { ok: false, error: 'Facilitator returned invalid JSON' },
        { status: 500 }
      )
    }

    // Zero CHALLENGE turns this round → client must force a red-team round next.
    const challengeMissing = !allTurnsThisRound.some((t) => t.actionTag === 'CHALLENGE')

    // Insert immediately after the AI call — the resume point for mobile polling.
    // NOTE: separate columns by design (data-mining); do NOT collapse into one JSONB.
    const roundIns = await supabase.from('synod_rounds').insert([
      {
        session_id: sessionId,
        round_number: roundNumber,
        consensus_points: summary.consensusPoints,
        open_issues: summary.openIssues,
        round_consensus_score: summary.roundConsensusScore,
        next_directive: summary.nextDirective,
        challenge_missing: challengeMissing,
      },
    ])
    if (roundIns.error) {
      console.error('[SYNOD facilitate] db insert failed:', roundIns?.error)
      return Response.json({ ok: false, error: roundIns.error.message }, { status: 500 })
    }

    const upd = await supabase
      .from('synod_sessions')
      .update({ total_rounds: roundNumber })
      .eq('session_id', sessionId)
    if (upd.error) console.warn('[synod] total_rounds update failed:', upd.error.message)

    return Response.json({ ok: true, summary, challengeMissing })
  }

  // ---- ACTION 4: verdict — Claude Opus 4.8 writes the final synthesis. ----
  else if (action === 'verdict') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    if (!sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 })
    }

    // Idempotency: a session has exactly one verdict. On resume/refresh, return
    // the stored result (already de-anonymized at save time) — never re-run the
    // AI or re-insert (was failing with a duplicate-key error).
    const existing = await supabase
      .from('synod_session_results')
      .select('verdict, minority_report, final_score')
      .eq('session_id', sessionId)
      .maybeSingle()
    if (existing.data) {
      const row = existing.data
      return Response.json({
        ok: true,
        result: {
          verdict: String(row.verdict ?? ''),
          minorityReport: Array.isArray(row.minority_report) ? row.minority_report : [],
          finalScore: typeof row.final_score === 'number' ? row.final_score : 0,
        },
      })
    }

    const [allSummaries, mode] = await Promise.all([
      loadPriorSummaries(sessionId),
      loadSessionMode(sessionId),
    ])
    if (!allSummaries.length) {
      return Response.json({ error: 'No rounds to judge' }, { status: 400 })
    }
    const finalRoundNumber = Math.max(...allSummaries.map((s) => s.roundNumber))
    const lastFacilitatorScore =
      allSummaries.find((s) => s.roundNumber === finalRoundNumber)?.roundConsensusScore ?? 0
    const finalRoundTurns = await loadRoundTurns(sessionId, finalRoundNumber)

    // ALWAYS anonymized — the chair must not recognize (or favor) any brand.
    const { text, labelMap } = buildVerdictInput({
      question,
      allSummaries,
      finalRoundTurns,
      anonymize: true,
    })
    const verdictPrompt =
      text +
      `\n\nSCORING NOTE: The last facilitator round consensus score was ${lastFacilitatorScore} out of 100. Your finalScore must reflect the deliberation outcome and stay broadly consistent with this score — do not set finalScore wildly higher or lower unless the final round genuinely shifted consensus. finalScore is the single number the user will see.`
    console.log(`[synod] verdict input ~${countApproxTokens(verdictPrompt)} tokens`)

    let r: RouterResult
    try {
      r = await runSingleAiProvider({
        supabase,
        sessionId: null,
        userId: null,
        provider: VERDICT_PROVIDER,
        prompt: verdictPrompt,
        systemPrompt: verdictSystemPrompt(mode),
        // Full Korean JSON verdict was being truncated mid-string at lower caps.
        maxCompletionTokens: 8000,
        modelOverride: VERDICT_MODEL,
      })
      if (r.error || !r.text) {
        console.error('[SYNOD verdict] runSingleAiProvider failed:', VERDICT_PROVIDER, r?.error ?? r)
        return Response.json(
          { ok: false, error: r.error ?? 'Empty response' },
          { status: 500 }
        )
      }
    } catch (e: unknown) {
      console.error('[SYNOD verdict] CAUGHT ERROR:', e)
      const msg = e instanceof Error ? e.message : 'Verdict call failed'
      return Response.json({ ok: false, error: msg }, { status: 500 })
    }

    const parsed = safeParseJson(r.text)

    let result: { verdict: string; minorityReport: { ai: string; dissent: string; reason: string }[]; finalScore: number }
    if (!parsed || typeof parsed.verdict !== 'string') {
      // Structured parse failed (typically a truncated long-language JSON).
      // Salvage the raw text as the verdict body instead of killing the session.
      console.error('[SYNOD verdict] JSON parse failed. raw:', r.text?.slice(0, 500))
      console.warn('[SYNOD verdict] falling back to raw-text verdict (unstructured output)')
      const lastFacilitatorScore =
        allSummaries.find((s) => s.roundNumber === finalRoundNumber)?.roundConsensusScore ?? 0
      result = {
        verdict: cleanVerdictFallbackText(r.text),
        minorityReport: [],
        finalScore: lastFacilitatorScore,
      }
    } else {
      const finalScoreRaw = Number(parsed.finalScore)
      const finalScore = Number.isFinite(finalScoreRaw)
        ? Math.max(0, Math.min(100, Math.round(finalScoreRaw)))
        : 0

      // De-anonymize minority report labels ("Participant A" → real name) before saving.
      const minorityReport = (Array.isArray(parsed.minorityReport) ? parsed.minorityReport : [])
        .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
        .map((m) => {
          const label = typeof m.ai === 'string' ? m.ai : ''
          return {
            ai: labelMap[label] ?? label,
            dissent: typeof m.dissent === 'string' ? m.dissent : '',
            reason: typeof m.reason === 'string' ? m.reason : '',
          }
        })

      result = {
        verdict: parsed.verdict,
        minorityReport,
        finalScore,
      }
    }

    // Insert immediately after the AI call — the resume point for mobile polling.
    // Upsert on session_id: if two verdict calls race, the loser updates instead
    // of throwing a duplicate-key error.
    const resIns = await supabase.from('synod_session_results').upsert(
      [
        {
          session_id: sessionId,
          verdict: result.verdict,
          minority_report: result.minorityReport,
          final_score: result.finalScore,
        },
      ],
      { onConflict: 'session_id' }
    )
    if (resIns.error) {
      console.error('[SYNOD verdict] db insert failed:', resIns?.error)
      return Response.json({ ok: false, error: resIns.error.message }, { status: 500 })
    }

    const upd = await supabase
      .from('synod_sessions')
      .update({ status: 'done', consensus_score: result.finalScore })
      .eq('session_id', sessionId)
    if (upd.error) console.warn('[synod] session done update failed:', upd.error.message)

    return Response.json({ ok: true, result })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
