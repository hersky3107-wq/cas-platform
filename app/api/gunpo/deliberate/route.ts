import { supabaseAdmin } from '@/lib/supabase/server'
import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { gatherJejuSnapshot, buildBriefingContext, FIXED_GUNPO_COUNCIL_MODE, type JejuSnapshot } from '@/lib/gunpo/brief'
import {
  planJejuMeeting,
  summarizeAvailableData,
  renderChairVerdict,
  runJejuMotionVote,
  JEJU_DEEP_DELIBERATION_TUNING,
  type JejuMeetingPlan,
  type JejuExecutedSearch,
  type JejuRevisedAnalysis,
  type JejuDeliberationTurn,
  type JejuRoundResult,
  type JejuDeliberation,
  type JejuDeliberationStopReason,
  type JejuVerdict,
  type JejuVoteResult,
} from '@/lib/gunpo/deep'
import { generateJejuPreReport } from '@/lib/gunpo/pre-report'
import {
  sanitizeMotieSupplements,
  buildMotieSupplementBlock,
  type MotieSupplement,
} from '@/lib/gunpo/supplements'
import { MOTIE_FLAGSHIP_BY_PROVIDER } from '@/lib/gunpo/models'
import {
  isMotieLocalProvider,
  callMotieLocalProvider,
  type MotieProvider,
} from '@/lib/gunpo/local-providers'
import { callMotieDeepseekChat } from '@/lib/gunpo/deepseek-chat'
import {
  SYNOD_DEBATERS,
  PROVIDER_TO_BRAND,
  openingSystemPrompt,
  turnSystemPrompt,
  facilitatorSystemPrompt,
  buildDeliberationContext,
  buildFacilitatorInput,
  parseClaim,
  parseActionTag,
  safeParseJson,
  type SynodTurn,
  type SynodDebaterProvider,
  type FacilitatorSummary,
  type DebaterRole,
} from '@/lib/gunpo/synod-debate'

export const runtime = 'nodejs'
export const maxDuration = 300

// TODO: credit/auth gating before public launch (governance demo — open for now).

// ─────────────────────────────────────────────────────────────────────────────
// JEJU Mode B — yes/no DELIBERATION route (SEPARATE from app/api/jeju/deep).
//
// Assembly (all pieces REUSED/COPIED, nothing reimplemented here):
//   JEJU front  : gatherJejuSnapshot + buildBriefingContext + planJejuMeeting  (brief.ts / deep.ts)
//   report      : generateJejuPreReport(mode:'deliberation')                   (pre-report.ts)
//   debate loop : SYNOD opening/turn/facilitator prompts + memory builders     (synod-debate.ts)
//   vote        : runJejuMotionVote (8-AI JEJU_VOTE_PANEL)                      (deep.ts)
//   chair       : renderChairVerdict (6-section Korean governance verdict)      (deep.ts)
//
// Isolation: NO import from app/api/synod/* (the SYNOD core was copied into
// lib/jeju/synod-debate.ts in step 1). State lives in the EXISTING
// motie_deep_sessions.state JSONB — no new columns/migration needed.
//
// Chunked-action discipline (mirror of app/api/jeju/deep/route.ts): one POST
// advances ONE stage so no single call exceeds ~250s. The per-round 'turn'
// action runs the SYNOD_DEBATERS of ONE round only (serial flow), never all
// rounds. Budget note: the round is SERIAL by design (each debater must read the
// prior speakers), so its wall-clock is the sum of 8 calls — exaone alone can
// take ~80s (see MOTIE_LOCAL_PROVIDER_CONFIG). Watch this against maxDuration.
// ─────────────────────────────────────────────────────────────────────────────

const {
  MIN_CONVERGENCE_ROUNDS,
  MAX_CONVERGENCE_ROUNDS,
  CONSENSUS_TARGET,
  STALL_DELTA,
  CONSENSUS_SCORE_UNAVAILABLE,
  CONSENSUS_VOTE_THRESHOLD,
} = JEJU_DEEP_DELIBERATION_TUNING

const TABLE = 'motie_deep_sessions'

/**
 * Completion caps — Korean needs headroom; turns are 8–10 sentences.
 * Raised 1100 → 1600 for B2G depth (flagship debaters, cost not a concern).
 */
const OPENING_MAX_TOKENS = 1600
const TURN_MAX_TOKENS = 1600
/**
 * The facilitator emits a structured JSON summary of EVERY debater's turn
 * (consensusPoints + per-issue positions + nextDirective), in Korean. Korean +
 * JSON is token-heavy: at 1600 the JSON was truncated mid-output → unparseable →
 * the round scored as "unmeasurable" and the whole run died after round 1. A
 * 6-turn round needed ~3.7k chars complete and 4096 covered it; the roster is
 * now 8 seats (~33% more positions to summarize), so the cap is raised in
 * proportion. Truncation here is a hard stage failure, so keep the headroom.
 */
const FACILITATOR_MAX_TOKENS = 6000

/** The facilitator is neutral (not a debater); a strong reasoning brand runs it. */
const FACILITATOR_PROVIDER: ExtendedAiProviderName = 'anthropic'

/**
 * Reverse of PROVIDER_TO_BRAND, so a stored brand label maps back to a
 * provider. Sessions persist the brand STRING in their turns, so every form
 * solar/exaone have ever been addressed by must keep resolving — a run started
 * before a rename would otherwise lose those seats' turn attribution mid-flight.
 * Aliases, oldest first: the original bare tags ('Solar', 'EXAONE'), then the
 * in-debate forms used before this rename ('Upstage Solar'), then the display
 * labels briefly used here during the UI label unification ('Upstage (솔라)',
 * 'LG (엑사원)'). Any brand NOT found is resolved by resolveBrandToProvider()
 * to null, never to a guessed provider — see that function's doc for why a
 * silent default would be unsafe.
 */
const BRAND_TO_PROVIDER: Record<string, MotieProvider> = {
  ...(Object.fromEntries(
    (Object.entries(PROVIDER_TO_BRAND) as [MotieProvider, string][]).map(([p, b]) => [b, p])
  ) as Record<string, MotieProvider>),
  Solar: 'solar',
  EXAONE: 'exaone',
  'Upstage Solar': 'solar',
  'Upstage (솔라)': 'solar',
  'LG (엑사원)': 'exaone',
}

/**
 * Per-call flagship override, guarded for MOTIE-LOCAL providers: 'solar'/'exaone'
 * have exactly one pinned model each inside lib/motie/local-providers.ts, so they
 * must NOT be looked up in (or overridden by) the shared-router flagship map.
 */
function flagshipOverrideFor(provider: MotieProvider): string | undefined {
  if (isMotieLocalProvider(provider)) return undefined
  return MOTIE_FLAGSHIP_BY_PROVIDER[provider] ?? undefined
}

// ── Persisted Mode B state (opaque JSONB blob in motie_deep_sessions.state) ────
type DeliberateState = {
  question: string
  /** AX COUNCIL mode — plumbed through; engine branching lands next step. */
  councilMode?: 'trade' | 'warroom'
  /**
   * User-submitted reference material (첨부·추가 자료). Optional and only ever
   * written when the client sent something usable, so a run with no attachments
   * persists byte-identical state. Injected into every debater's prompt and the
   * chair's case file as provenance-fenced, untrusted DATA.
   */
  supplements?: MotieSupplement[]
  // beat 1 (start)
  snapshot?: JejuSnapshot
  context?: string
  plan?: JejuMeetingPlan
  questionType?: 'binary' | 'openEnded'
  // beat 2 (report)
  report?: string | null
  reportSearches?: JejuExecutedSearch[]
  leadAnalysis?: string | null
  // beats 3+4 (open + turn) — every debate turn, tagged with its 1-indexed round.
  turns?: SynodTurn[]
  // beat 5 (facilitate) — one summary per round, index 0 == round 1.
  summaries?: FacilitatorSummary[]
  deliberationDone?: boolean
  stoppedReason?: JejuDeliberationStopReason
  // beats 6+7 (vote + verdict)
  vote?: JejuVoteResult
  verdict?: JejuVerdict
}

type Stage =
  | 'start'
  | 'report'
  | 'open'
  | 'turn'
  | 'facilitate'
  | 'vote'
  | 'verdict'
  | 'done'

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function fail(stage: string, error: string, status = 500): Response {
  return json({ ok: false, stage, error }, status)
}

async function loadSession(
  sessionId: string
): Promise<{ state: DeliberateState; stage: Stage } | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('state, stage')
    .eq('id', sessionId)
    .maybeSingle()
  if (error || !data) return null
  return { state: (data.state ?? {}) as DeliberateState, stage: (data.stage ?? 'start') as Stage }
}

async function saveSession(
  sessionId: string,
  state: DeliberateState,
  stage: Stage,
  status: 'running' | 'done' | 'error'
): Promise<void> {
  await supabaseAdmin
    .from(TABLE)
    .update({ state, stage, status, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
}

// ── AI call wrapper — sessionId/userId null ⇒ router does NO DB writes. ────────
async function callProvider(params: {
  provider: MotieProvider
  systemPrompt: string
  prompt: string
  maxCompletionTokens: number
  modelOverride?: string
}): Promise<{ text: string | null; error?: string | null }> {
  // MOTIE-LOCAL providers ('solar'/'exaone' — now live SYNOD debaters). Their
  // endpoint/model/thinking-off handling lives in lib/motie/local-providers.ts.
  // Everything below this check is the pre-existing runSingleAiProvider path,
  // unchanged for the six shared-router brands.
  if (isMotieLocalProvider(params.provider)) {
    return callMotieLocalProvider({
      provider: params.provider,
      systemPrompt: params.systemPrompt,
      userPrompt: params.prompt,
      maxCompletionTokens: params.maxCompletionTokens,
    })
  }

  // DeepSeek V4 runs with thinking ON by default and bills those reasoning
  // tokens against the SAME completion budget as the answer, so a debate turn
  // capped at TURN_MAX_TOKENS came back truncated mid-sentence (and, as the
  // prompt grew each round, empty). The shared router has no way to send
  // DeepSeek's thinking toggle, so debate statements go through a motie-local
  // call that disables thinking and floors the budget. See lib/motie/deepseek-chat.ts.
  if (params.provider === 'deepseek') {
    return callMotieDeepseekChat({
      systemPrompt: params.systemPrompt,
      userPrompt: params.prompt,
      maxCompletionTokens: params.maxCompletionTokens,
      ...(params.modelOverride ? { model: params.modelOverride } : {}),
    })
  }

  const r = await runSingleAiProvider({
    supabase: supabaseAdmin,
    sessionId: null,
    userId: null,
    provider: params.provider,
    prompt: params.prompt,
    systemPrompt: params.systemPrompt,
    maxCompletionTokens: params.maxCompletionTokens,
    modelOverride: params.modelOverride,
  })
  return { text: r.text, error: r.error }
}

/**
 * One debate statement, retried ONCE, and never allowed to vanish.
 *
 * The previous loops did `const { text } = await callProvider(...)` and then
 * `if (!text) continue` — the `error` field was destructured away, nothing was
 * logged, and the seat simply produced no turn. A dropped panelist was then
 * indistinguishable from one that never existed (observed live: DeepSeek was
 * absent from rounds 3-5 with no error anywhere). Callers now get an explicit
 * reason and emit {@link noResponseTurn} instead of skipping.
 */
async function callDebateStatement(params: {
  provider: MotieProvider
  systemPrompt: string
  prompt: string
  maxCompletionTokens: number
  modelOverride?: string
  roundNumber: number
}): Promise<{ text: string | null; error: string | null }> {
  const attempt = async (): Promise<{ text: string | null; error?: string | null }> => {
    try {
      return await callProvider(params)
    } catch (e: unknown) {
      // Both callProvider branches already turn throws into an `error` field;
      // this guards any future path so one seat can never kill the round.
      return { text: null, error: e instanceof Error ? e.message : 'unknown error' }
    }
  }

  const first = await attempt()
  if (first.text && first.text.trim()) return { text: first.text, error: null }

  const firstReason = first.error || '빈 응답'
  console.warn(
    `[motie/deliberate] round ${params.roundNumber} — ${params.provider} gave no usable statement (${firstReason}); retrying once.`
  )

  const second = await attempt()
  if (second.text && second.text.trim()) return { text: second.text, error: null }

  const reason = second.error || firstReason
  console.warn(
    `[motie/deliberate] round ${params.roundNumber} — ${params.provider} failed twice (${reason}); emitting a visible placeholder turn.`
  )
  return { text: null, error: reason }
}

/**
 * A visible stand-in for a seat that produced nothing. Carries no actionTag and
 * no claim, and is flagged `failed` so downstream consumers exclude it from
 * anything that reads a turn as a position (see SynodTurn.failed).
 */
function noResponseTurn(params: {
  /** A debate seat specifically — PROVIDER_TO_BRAND only covers the roster. */
  provider: SynodDebaterProvider
  roundNumber: number
  isRedTeam: boolean
  reason: string
}): SynodTurn {
  const brand = PROVIDER_TO_BRAND[params.provider]
  return {
    roundNumber: params.roundNumber,
    aiName: brand,
    content: `⚠️ ${brand} 좌석은 이번 라운드에 응답하지 않았습니다 (사유: ${params.reason}). 재시도 후에도 발언을 받지 못해, 이 좌석의 이번 라운드 입장은 기록되지 않았습니다.`,
    isRedTeam: params.isRedTeam,
    failed: true,
  }
}

/**
 * The governance expert role assigned (1:1) to a debate brand by planJejuMeeting,
 * shaped for the SYNOD opening/turn prompt builders. Returns undefined if the
 * plan somehow lacks a role for that brand (the builders then fall back safely).
 */
function roleForProvider(
  plan: JejuMeetingPlan | undefined,
  provider: string
): DebaterRole | undefined {
  const r = plan?.roles?.find((x) => x.provider === provider)
  return r ? { roleLabel: r.roleLabel, mandate: r.mandate } : undefined
}

/** Prepends the step-2 pre-debate report to a debater's USER prompt (seeding). */
function reportPreamble(report: string | null | undefined): string {
  if (!report || !report.trim()) return ''
  return ['[사전 분석 리포트 — 토론 전 반드시 숙지할 기초 자료]', report.trim(), '', '---', ''].join('\n')
}

/**
 * The 첨부·추가 자료 block for a debater's USER prompt — the SAME
 * provenance-fenced rendering the open-brief analysts get, so user material is
 * treated identically in both flows (reference data, never instructions).
 * Returns '' when there are no supplements, which the prompt assembly filters
 * out, keeping a no-attachment run's prompts unchanged.
 */
function supplementPreamble(supplements: MotieSupplement[] | undefined): string {
  return buildMotieSupplementBlock(supplements).trim()
}

/** Clamp a model-supplied consensus score to 0–100, else mark unmeasurable. */
function clampScore(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return CONSENSUS_SCORE_UNAVAILABLE
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** Parses the facilitator's strict-JSON output into a FacilitatorSummary. */
function parseFacilitatorSummary(raw: string, roundNumber: number): FacilitatorSummary | null {
  const parsed = safeParseJson(raw)
  if (!parsed) return null

  const consensusPoints: FacilitatorSummary['consensusPoints'] = Array.isArray(parsed.consensusPoints)
    ? parsed.consensusPoints
        .map((cp): FacilitatorSummary['consensusPoints'][number] | null => {
          if (!cp || typeof cp !== 'object') return null
          const o = cp as Record<string, unknown>
          const point = typeof o.point === 'string' ? o.point.trim() : ''
          if (!point) return null
          const agreedBy = Array.isArray(o.agreedBy)
            ? o.agreedBy.filter((x): x is string => typeof x === 'string')
            : []
          return { point, agreedBy }
        })
        .filter((x): x is FacilitatorSummary['consensusPoints'][number] => x !== null)
    : []

  const openIssues: FacilitatorSummary['openIssues'] = Array.isArray(parsed.openIssues)
    ? parsed.openIssues
        .map((oi): FacilitatorSummary['openIssues'][number] | null => {
          if (!oi || typeof oi !== 'object') return null
          const o = oi as Record<string, unknown>
          const issue = typeof o.issue === 'string' ? o.issue.trim() : ''
          if (!issue) return null
          const positions = Array.isArray(o.positions)
            ? o.positions
                .map((p): { ai: string; stance: string } | null => {
                  if (!p || typeof p !== 'object') return null
                  const po = p as Record<string, unknown>
                  const ai = typeof po.ai === 'string' ? po.ai.trim() : ''
                  const stance = typeof po.stance === 'string' ? po.stance.trim() : ''
                  if (!ai || !stance) return null
                  return { ai, stance }
                })
                .filter((x): x is { ai: string; stance: string } => x !== null)
            : []
          return { issue, positions }
        })
        .filter((x): x is FacilitatorSummary['openIssues'][number] => x !== null)
    : []

  const nextDirective = typeof parsed.nextDirective === 'string' ? parsed.nextDirective.trim() : ''

  return {
    roundNumber,
    consensusPoints,
    openIssues,
    roundConsensusScore: clampScore(parsed.roundConsensusScore),
    nextDirective,
  }
}

// ── SYNOD debate state → JEJU chair input adapters (glue, not engine logic) ────

/**
 * Resolves a stored SYNOD brand tag (e.g. 'ChatGPT', legacy 'Solar') to its
 * MotieProvider. Returns null — NEVER a guessed/default provider — when the
 * brand is unrecognized, and warns so the mismatch is visible in logs.
 *
 * Rationale (do not "fix" this by adding a fallback provider): the resolved
 * value is later used to attribute a debate turn to a voter as THEIR OWN
 * record in the ballot prompt (buildVoterTranscript in deep.ts). Defaulting
 * an unmatched brand to some provider would silently inject one AI's
 * statements into a DIFFERENT AI's own-record context — that is strictly
 * worse than showing that voter no record at all, which is what returning
 * null achieves (the turn's `provider` field ends up undefined and is
 * excluded from every voter's transcript, see JejuDeliberationTurn's doc).
 */
function resolveBrandToProvider(brand: string): MotieProvider | null {
  const resolved = BRAND_TO_PROVIDER[brand]
  if (!resolved) {
    console.warn(
      `[motie/deliberate] Unrecognized debate brand "${brand}" — cannot attribute this turn to a known provider. It will be excluded from every voter's own-record ballot context (fail-safe, not defaulted).`
    )
    return null
  }
  return resolved
}

/** Maps the SYNOD turns + facilitator summaries into a JEJU JejuDeliberation. */
function buildModeBDeliberation(
  turns: SynodTurn[],
  summaries: FacilitatorSummary[],
  stoppedReason: JejuDeliberationStopReason
): JejuDeliberation {
  const rounds: JejuRoundResult[] = summaries.map((s) => {
    const roundTurns: JejuDeliberationTurn[] = turns
      // A placeholder ("no response") turn still needs a roundTurns ENTRY —
      // ok:false, no position — so buildVoterTranscript (deep.ts) can surface
      // the gap explicitly to that seat's own ballot prompt (STEP9 [1]-b)
      // instead of the round silently vanishing. formatDeliberationForChair
      // already filters on `t.ok && position`, so the chair's case file is
      // unaffected by including these. A genuinely empty non-failed turn
      // (content.trim() === '' with failed:false — should not occur, but kept
      // as a defensive drop) is still excluded.
      .filter(
        (t) => t.roundNumber === s.roundNumber && (t.failed || t.content.trim() !== '')
      )
      .map((t) => {
        const resolvedProvider = resolveBrandToProvider(t.aiName)
        if (t.failed) {
          return {
            roleId: resolvedProvider ?? t.aiName,
            roleLabel: t.aiName,
            ...(resolvedProvider ? { provider: resolvedProvider } : {}),
            isRedTeam: t.isRedTeam === true,
            ok: false,
            position: null,
            concedes: null,
            holds: null,
            error: '이 라운드 응답 실패 — 불참',
          }
        }
        return {
          roleId: resolvedProvider ?? t.aiName,
          roleLabel: t.aiName,
          // Omitted (not defaulted) when unresolved — see resolveBrandToProvider.
          ...(resolvedProvider ? { provider: resolvedProvider } : {}),
          isRedTeam: t.isRedTeam === true,
          ok: true,
          position: t.content.trim(),
          concedes: null,
          holds: null,
          // Carried so the ballot can show each voter its OWN record verbatim
          // (buildVoterTranscript in deep.ts). Dropping them here would leave the
          // vote's stance-consistency rule with nothing to check against.
          ...(t.actionTag ? { actionTag: t.actionTag } : {}),
          ...(t.claim ? { claim: t.claim } : {}),
        }
      })
    return {
      roundNumber: s.roundNumber,
      turns: roundTurns,
      consensusScore: s.roundConsensusScore,
      agreedPoints: s.consensusPoints.map((cp) => cp.point),
      contestedPoints: s.openIssues.map((oi) => oi.issue),
      summary: s.nextDirective,
      ok: s.roundConsensusScore !== CONSENSUS_SCORE_UNAVAILABLE,
    }
  })

  const last = summaries.length > 0 ? summaries[summaries.length - 1]! : undefined
  const ok = rounds.some((r) => r.ok)
  return {
    rounds,
    finalScore: last ? last.roundConsensusScore : CONSENSUS_SCORE_UNAVAILABLE,
    roundsRun: rounds.length,
    stoppedReason,
    agreedPoints: last ? last.consensusPoints.map((cp) => cp.point) : [],
    contestedPoints: last ? last.openIssues.map((oi) => oi.issue) : [],
    summary: last ? last.nextDirective : '',
    ok,
  }
}

/** Packs the step-2 report as ONE synthetic analysis so the chair reads it. */
function preReportAsAnalysis(report: string | null | undefined): JejuRevisedAnalysis[] {
  if (!report || !report.trim()) return []
  return [
    {
      roleId: 'pre-report',
      roleLabel: '사전 분석 리포트',
      provider: 'anthropic',
      isRedTeam: false,
      ok: true,
      firstPass: null,
      revised: report.trim(),
      changed: false,
    },
  ]
}

/**
 * STEP9 [1]-c: providers to drop from the closing ballot — a SYNOD debate seat
 * that spoke in at least one round but got `failed:true` in EVERY round it
 * appeared in has no real position to vote from (unlike Perplexity, which
 * never debates by design and votes from its search findings instead). A
 * provider that never appears at all in `turns` is left alone here — it is
 * simply not a debate seat (e.g. this function is never asked about
 * 'perplexity'), not a failure case.
 */
function fullyFailedDebaters(turns: SynodTurn[]): MotieProvider[] {
  const excluded: MotieProvider[] = []
  for (const provider of SYNOD_DEBATERS) {
    const brand = PROVIDER_TO_BRAND[provider]
    const own = turns.filter((t) => t.aiName === brand)
    if (own.length > 0 && own.every((t) => t.failed)) {
      excluded.push(provider as MotieProvider)
    }
  }
  return excluded
}

/** No-ballot result (shape-faithful to deep.ts's emptyVoteResult). */
function emptyVote(summary: string): JejuVoteResult {
  return {
    votes: [],
    approveCount: 0,
    conditionalCount: 0,
    opposeCount: 0,
    abstainCount: 0,
    approveProviders: [],
    conditionalProviders: [],
    opposeProviders: [],
    abstainProviders: [],
    outcome: 'divided',
    ok: false,
    summary,
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // empty body tolerated; `action` validated below
  }

  const action = typeof body.action === 'string' ? body.action : ''

  // ── ACTION: start — beat 1 (snapshot → context → plan). ──────────────────────
  if (action === 'start') {
    try {
      const question =
        typeof body.question === 'string' && body.question.trim() ? body.question.trim() : ''
      if (!question) return fail('start', '질문이 비어 있습니다.', 400)

      const orchestratorProvider =
        typeof body.orchestratorProvider === 'string' ? body.orchestratorProvider : undefined
      // STEP12: mode toggle removed — always use the fixed single mode.
      const councilMode: 'trade' | 'warroom' = FIXED_GUNPO_COUNCIL_MODE
      void body.councilMode
      // Malformed entries are dropped (never a 400) and the result is undefined
      // when nothing usable arrived — see sanitizeMotieSupplements.
      const supplements = sanitizeMotieSupplements(body.supplements)

      const snapshot = await gatherJejuSnapshot(councilMode)
      const context = buildBriefingContext(snapshot, councilMode)
      const availableDataSummary = await summarizeAvailableData(councilMode)
      const plan = await planJejuMeeting({
        question,
        availableDataSummary,
        // Mode B: pin a 1:1 governance role to each SYNOD debate brand (8 today),
        // so every debater argues AS a professional expert.
        debateBrands: [...SYNOD_DEBATERS],
        ...(orchestratorProvider ? { provider: orchestratorProvider } : {}),
      })

      const state: DeliberateState = {
        question,
        councilMode,
        ...(supplements ? { supplements } : {}),
        snapshot,
        context,
        plan,
        // 찬반형 flow: mode is ground truth, not LLM text-inference. Entering this
        // route IS the 찬반형 choice (only caller passing debateBrands); open-ended
        // has its own brief route. Force binary so the ballot always runs when
        // consensus < 85. plan.questionType is left untouched on the plan object.
        questionType: 'binary',
      }

      const ins = await supabaseAdmin
        .from(TABLE)
        .insert([{ question, status: plan.ok ? 'running' : 'error', stage: 'start', state }])
        .select('id')
        .single()
      if (ins.error || !ins.data?.id) {
        return fail('start', ins.error?.message ?? 'could not create session')
      }
      const sessionId = String(ins.data.id)

      if (!plan.ok) {
        return json({
          ok: false,
          stage: 'start',
          sessionId,
          done: true,
          error: plan.error ?? '회의 소집(분석 계획) 단계에 실패했습니다.',
          plan,
        })
      }

      return json({
        ok: true,
        stage: 'start',
        sessionId,
        nextAction: 'report',
        // Mirror the forced state value so the client badge matches engine behavior.
        questionType: state.questionType,
        // The orchestrator's roster (for transparency); Mode B debate itself runs
        // the SYNOD reasoning brands below, not these analytic seats.
        roles: plan.roles.map((r) => ({
          roleId: r.roleId,
          roleLabel: r.roleLabel,
          mandate: r.mandate,
          provider: r.provider,
          isRedTeam: r.isRedTeam === true,
        })),
        rationale: plan.rationale,
        debaters: SYNOD_DEBATERS.map((p) => ({ provider: p, brand: PROVIDER_TO_BRAND[p] })),
      })
    } catch (e: unknown) {
      return fail('start', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // All remaining actions require an existing session.
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!sessionId) return fail(action || 'unknown', 'sessionId is required', 400)

  const loaded = await loadSession(sessionId)
  if (!loaded) return fail(action || 'unknown', 'session not found', 404)
  const { state } = loaded

  // ── ACTION: report — beat 2 (pre-debate analysis report, REUSE step 2). ──────
  if (action === 'report') {
    try {
      if (!state.context) return fail('report', '데이터 컨텍스트가 없어 리포트를 만들 수 없습니다.', 409)
      const pre = await generateJejuPreReport({
        question: state.question,
        snapshot: state.snapshot ?? { ok: false, sources: [] },
        context: state.context,
        mode: 'deliberation',
        councilMode: state.councilMode,
      })
      state.report = pre.report
      state.reportSearches = pre.searches
      state.leadAnalysis = pre.leadAnalysis
      await saveSession(sessionId, state, 'report', 'running')
      return json({
        ok: pre.ok,
        stage: 'report',
        sessionId,
        nextAction: 'open',
        report: pre.report,
        leadAnalysis: pre.leadAnalysis,
        searches: pre.searches,
        droppedSearchCount: pre.droppedSearchCount,
        ...(pre.error ? { reportError: pre.error } : {}),
      })
    } catch (e: unknown) {
      return fail('report', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: open — beat 3 (round 1: all debaters give independent opinions). ─
  if (action === 'open') {
    try {
      const preamble = reportPreamble(state.report)
      const supplementBlock = supplementPreamble(state.supplements)
      const results = await Promise.all(
        SYNOD_DEBATERS.map(async (provider) => {
          const userPrompt = [
            preamble,
            '[심의 안건]',
            state.question,
            '',
            '위 안건에 대해, 사전 분석 리포트를 근거로 당신의 독립적이고 명확한 의견을 제시하세요.',
            // Appended ONLY when the user attached material, so a run without
            // attachments produces the exact prompt it did before.
            ...(supplementBlock ? ['', supplementBlock] : []),
          ].join('\n')
          const { text, error } = await callDebateStatement({
            provider,
            systemPrompt: openingSystemPrompt(provider, roleForProvider(state.plan, provider)),
            prompt: userPrompt,
            maxCompletionTokens: OPENING_MAX_TOKENS,
            modelOverride: flagshipOverrideFor(provider),
            roundNumber: 1,
          })
          return { provider, text, error }
        })
      )

      const turns: SynodTurn[] = []
      for (const { provider, text, error } of results) {
        if (!text || !text.trim()) {
          turns.push(
            noResponseTurn({
              provider,
              roundNumber: 1,
              isRedTeam: false,
              reason: error || '빈 응답',
            })
          )
          continue
        }
        const a = parseActionTag(text)
        const c = parseClaim(a.content)
        turns.push({
          roundNumber: 1,
          aiName: PROVIDER_TO_BRAND[provider],
          ...(a.tag ? { actionTag: a.tag } : {}),
          ...(c.claim ? { claim: c.claim } : {}),
          content: c.content,
          isRedTeam: false,
        })
      }

      state.turns = turns
      await saveSession(sessionId, state, 'open', 'running')
      return json({
        // Placeholders always fill the array now, so `ok` asks whether anyone
        // ACTUALLY spoke rather than whether the array is non-empty.
        ok: turns.some((t) => !t.failed),
        stage: 'open',
        sessionId,
        roundNumber: 1,
        nextAction: 'facilitate',
        turns,
      })
    } catch (e: unknown) {
      return fail('open', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: turn — beat 4 (ONE debate round, all debaters SERIAL so each reacts).
  if (action === 'turn') {
    try {
      const summaries = state.summaries ?? []
      const priorTurns = state.turns ?? []
      // Round N is the first round not yet summarized: summaries cover 1..len.
      const roundNumber = summaries.length + 1
      if (roundNumber < 2) {
        return fail('turn', '먼저 개회 라운드(open)와 정리(facilitate)가 필요합니다.', 409)
      }

      // Rotate the stress-tester seat each round so the forming consensus is
      // pressure-tested from a different brand every time — EXCEPT the final
      // round, where it is turned OFF so the panel can genuinely converge
      // (SYNOD-faithful: red team is active through the penultimate round and
      // off in the last, preventing an artificial late drop in consensus).
      const isFinalRound = roundNumber >= MAX_CONVERGENCE_ROUNDS
      const redTeamProvider = isFinalRound
        ? null
        : SYNOD_DEBATERS[roundNumber % SYNOD_DEBATERS.length]!

      // '' when nothing was attached, and the prompt assembly drops empty parts.
      const supplementBlock = supplementPreamble(state.supplements)

      const currentRoundTurns: SynodTurn[] = []
      for (const provider of SYNOD_DEBATERS) {
        const isRedTeam = redTeamProvider !== null && provider === redTeamProvider
        // anonymize:false — debaters see and address each other by REAL brand name
        // (so they engage directly and never rebut themselves). Faithful to SYNOD,
        // where only the verdict chair gets an anonymized input.
        const ctx = buildDeliberationContext({
          question: state.question,
          priorSummaries: summaries,
          currentRoundTurns,
          anonymize: false,
        })
        const userPrompt = [reportPreamble(state.report), ctx.text, supplementBlock]
          .filter((s) => s !== '')
          .join('\n')
        const { text, error } = await callDebateStatement({
          provider,
          systemPrompt: turnSystemPrompt(provider, isRedTeam, roundNumber, roleForProvider(state.plan, provider)),
          prompt: userPrompt,
          maxCompletionTokens: TURN_MAX_TOKENS,
          modelOverride: flagshipOverrideFor(provider),
          roundNumber,
        })
        if (!text || !text.trim()) {
          currentRoundTurns.push(
            noResponseTurn({ provider, roundNumber, isRedTeam, reason: error || '빈 응답' })
          )
          continue
        }
        const a = parseActionTag(text)
        const c = parseClaim(a.content)
        currentRoundTurns.push({
          roundNumber,
          aiName: PROVIDER_TO_BRAND[provider],
          ...(a.tag ? { actionTag: a.tag } : {}),
          ...(c.claim ? { claim: c.claim } : {}),
          content: c.content,
          isRedTeam,
        })
      }

      state.turns = [...priorTurns, ...currentRoundTurns]
      await saveSession(sessionId, state, 'turn', 'running')
      return json({
        // Placeholders always fill the array now — ask whether anyone spoke.
        ok: currentRoundTurns.some((t) => !t.failed),
        stage: 'turn',
        sessionId,
        roundNumber,
        nextAction: 'facilitate',
        turns: currentRoundTurns,
      })
    } catch (e: unknown) {
      return fail('turn', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: facilitate — beat 5 (ONE facilitator call + loop control). ───────
  if (action === 'facilitate') {
    try {
      const summaries = state.summaries ?? []
      const allTurns = state.turns ?? []
      // Summarize the latest round that has turns but no summary yet.
      const roundNumber = summaries.length + 1
      const allTurnsThisRound = allTurns.filter((t) => t.roundNumber === roundNumber)
      // Placeholder ("no response") turns are not statements — a round made up
      // solely of them has nothing to summarize, same as an empty round.
      if (allTurnsThisRound.every((t) => t.failed)) {
        return fail('facilitate', `라운드 ${roundNumber}의 토론 발언이 없어 정리할 수 없습니다.`, 409)
      }

      const input = buildFacilitatorInput({
        question: state.question,
        roundNumber,
        allTurnsThisRound,
        priorSummaries: summaries,
      })
      const { text } = await callProvider({
        provider: FACILITATOR_PROVIDER,
        systemPrompt: facilitatorSystemPrompt(),
        prompt: input,
        maxCompletionTokens: FACILITATOR_MAX_TOKENS,
      })

      const parsedSummary = text ? parseFacilitatorSummary(text, roundNumber) : null

      // EXPLICIT FAILURE (do not hide it): the facilitator returned nothing
      // parseable, or a score we can't read (UNAVAILABLE only ever means a
      // parse/format failure, never a legitimate 0). Previously this fell back to
      // a -1 summary and was silently treated as `done` → the run slid to verdict
      // with a green progress strip over a dead debate. Surface it instead so the
      // client stops on the failing stage. (Past cause: the JSON was truncated at
      // a too-low token cap — now raised; this guards any residual hiccup.)
      if (!parsedSummary || parsedSummary.roundConsensusScore === CONSENSUS_SCORE_UNAVAILABLE) {
        await saveSession(sessionId, state, 'facilitate', 'error')
        return json({
          ok: false,
          stage: 'facilitate',
          sessionId,
          roundNumber,
          error: `라운드 ${roundNumber} 합의도 정리(facilitator) 응답을 해석하지 못했습니다.`,
        })
      }

      const summary = parsedSummary
      summaries.push(summary)
      state.summaries = summaries

      // Loop control — SYNOD's monotonic facilitator-scored loop (faithful to the
      // deep route's deliberate stop logic, but driven by the facilitator score).
      // `score` is guaranteed measurable here (UNAVAILABLE handled above).
      const roundsRun = summaries.length
      const score = summary.roundConsensusScore
      let done = false
      let stoppedReason: JejuDeliberationStopReason | undefined

      if (roundsRun >= MIN_CONVERGENCE_ROUNDS) {
        if (score >= CONSENSUS_TARGET) {
          done = true
          stoppedReason = 'target_reached'
        } else {
          const prevScore = summaries[summaries.length - 2]?.roundConsensusScore ?? score
          if (score - prevScore < STALL_DELTA) {
            done = true
            stoppedReason = 'stalled'
          }
        }
      }
      if (!done && roundsRun >= MAX_CONVERGENCE_ROUNDS) {
        done = true
        stoppedReason = 'max_rounds'
      }

      if (done) {
        state.deliberationDone = true
        state.stoppedReason = stoppedReason
      }
      await saveSession(sessionId, state, 'facilitate', 'running')

      return json({
        ok: true,
        stage: 'facilitate',
        sessionId,
        roundNumber,
        consensusScore: score,
        summary,
        done,
        ...(done ? { stoppedReason, nextAction: 'vote' } : { nextAction: 'turn' }),
      })
    } catch (e: unknown) {
      return fail('facilitate', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: vote — beat 6 (motion ballot ONLY if consensus < threshold). ─────
  if (action === 'vote') {
    try {
      const summaries = state.summaries ?? []
      if (summaries.length === 0) {
        return fail('vote', '토론 정리 결과가 없어 표결할 수 없습니다.', 409)
      }

      const stoppedReason: JejuDeliberationStopReason = state.stoppedReason ?? 'max_rounds'
      const deliberation = buildModeBDeliberation(state.turns ?? [], summaries, stoppedReason)
      const finalScore = deliberation.finalScore
      const questionType = state.questionType ?? 'openEnded'

      // The 2x2 gate (same as the deep route): vote ONLY for a binary question
      // whose measured consensus is below the threshold.
      const measurable = finalScore >= 0
      const highConsensus = measurable && finalScore >= CONSENSUS_VOTE_THRESHOLD
      const doVote =
        questionType === 'binary' && measurable && finalScore < CONSENSUS_VOTE_THRESHOLD

      const noVoteSummary =
        questionType !== 'binary'
          ? '개방형 질문으로 표결 생략'
          : !measurable
            ? '합의도 측정 불가로 표결 생략(안전 경로)'
            : highConsensus
              ? `${CONSENSUS_VOTE_THRESHOLD}점 이상 합의로 표결 생략`
              : '표결 생략'

      // Machine-readable skip reason so the client renders an accurate notice
      // (never re-using the runtime consensus as a "target"). Additive; the
      // doVote gate itself is unchanged (binary + measurable + <85 → vote).
      const voteSkipReason: 'none' | 'open_ended' | 'unmeasurable' | 'high_consensus' =
        doVote
          ? 'none'
          : questionType !== 'binary'
            ? 'open_ended'
            : !measurable
              ? 'unmeasurable'
              : 'high_consensus'

      let vote: JejuVoteResult = emptyVote(noVoteSummary)
      if (doVote) {
        const excludeProviders = fullyFailedDebaters(state.turns ?? [])
        if (excludeProviders.length > 0) {
          console.warn(
            `[motie/deliberate] excluding seat(s) from the ballot — every round failed: ${excludeProviders.join(', ')}`
          )
        }
        vote = await runJejuMotionVote({ question: state.question, deliberation, excludeProviders })
      }
      state.vote = vote
      await saveSession(sessionId, state, 'vote', 'running')

      return json({
        ok: true,
        stage: 'vote',
        sessionId,
        nextAction: 'verdict',
        voted: doVote,
        voteSkipReason,
        vote,
        consensusScore: finalScore,
      })
    } catch (e: unknown) {
      return fail('vote', e instanceof Error ? e.message : 'unknown error')
    }
  }

  // ── ACTION: verdict — beat 7 (JEJU chair renders the final ruling). ──────────
  if (action === 'verdict') {
    try {
      const summaries = state.summaries ?? []
      if (summaries.length === 0) {
        return fail('verdict', '토론 결과가 없어 판결을 내릴 수 없습니다.', 409)
      }

      // Idempotent: one verdict per session.
      if (state.verdict) {
        return json({
          ok: state.verdict.ok,
          stage: 'done',
          sessionId,
          done: true,
          questionType: state.questionType ?? 'openEnded',
          consensusScore: state.verdict.consensusScore,
          verdict: state.verdict,
          vote: state.vote ?? emptyVote('표결 없음'),
        })
      }

      const stoppedReason: JejuDeliberationStopReason = state.stoppedReason ?? 'max_rounds'
      const deliberation = buildModeBDeliberation(state.turns ?? [], summaries, stoppedReason)
      const finalScore = deliberation.finalScore
      const questionType = state.questionType ?? 'openEnded'
      const brief = finalScore >= 0 && finalScore >= CONSENSUS_VOTE_THRESHOLD
      const vote = state.vote ?? emptyVote('표결 없음')

      const verdict = await renderChairVerdict({
        question: state.question,
        snapshot: state.snapshot ?? { ok: false, sources: [] },
        // No JEJU analytic seats in Mode B — the pre-report is fed as the analysis.
        analyses: [],
        searches: state.reportSearches ?? [],
        revised: preReportAsAnalysis(state.report),
        // The SYNOD debate is carried in `deliberation.rounds`, not as separate
        // rebuttals, so nothing to feed here (avoids double-counting the debate).
        rebuttals: [],
        deliberation,
        brief,
        vote,
        councilMode: state.councilMode,
        ...(state.supplements ? { supplements: state.supplements } : {}),
      })

      state.verdict = verdict
      await saveSession(sessionId, state, 'done', verdict.ok ? 'done' : 'error')

      return json({
        ok: verdict.ok,
        stage: 'done',
        sessionId,
        done: true,
        questionType,
        consensusScore: verdict.consensusScore,
        verdict: {
          keyIssues: verdict.keyIssues,
          judgment: verdict.judgment,
          beat1Summary: verdict.beat1Summary,
          beat2Summary: verdict.beat2Summary,
          beat3Summary: verdict.beat3Summary,
          minorityReport: verdict.minorityReport,
          mediaRisk: verdict.mediaRisk,
          disclaimer: verdict.disclaimer,
          provider: verdict.provider,
          ...(verdict.error ? { error: verdict.error } : {}),
        },
        vote,
        deliberation: {
          finalScore: deliberation.finalScore,
          roundsRun: deliberation.roundsRun,
          stoppedReason: deliberation.stoppedReason,
          agreedPoints: deliberation.agreedPoints,
          contestedPoints: deliberation.contestedPoints,
          summary: deliberation.summary,
        },
      })
    } catch (e: unknown) {
      return fail('verdict', e instanceof Error ? e.message : 'unknown error')
    }
  }

  return fail(action || 'unknown', `unknown action: ${action || '(none)'}`, 400)
}
