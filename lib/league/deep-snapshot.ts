/**
 * Client-safe, sanitized view of a deep run's persisted pipeline state.
 *
 * The durable runner saves the full pipeline state after every hop; this
 * module projects that state into what the card UI may render — plan
 * seats, the shared briefing, per-model analyses as they land, debate
 * rounds/turns, the ballot, and the chair verdict — and drops the packet
 * context, research snapshot, and prompt internals.
 *
 * PURE module: no 'server-only', no async_hooks. The builder runs
 * server-side (deep-http); the client imports only the types plus
 * `deepBrandLabel`. Brand labels are duplicated from deep-prompts because
 * that module pulls the output-language ALS (node:async_hooks) and must
 * never enter a client bundle.
 */

export type DeepSeatSnapshot = {
  roleId: string
  roleLabel: string
  provider: string
  brand: string
  /** Open product: the seat's assigned sub-question. */
  subQuestion?: string
  /** Debate product: the seat's mandate. */
  mandate?: string
}

export type DeepAnalysisSnapshot = {
  roleId: string
  roleLabel: string
  provider: string
  brand: string
  content: string | null
  ok: boolean
  error?: string
}

export type DeepTurnSnapshot = {
  roleLabel: string
  provider: string
  brand: string
  position: string | null
  concedes: string | null
  holds: string | null
  ok: boolean
}

export type DeepRoundSnapshot = {
  roundNumber: number
  consensusScore: number
  summary: string
  turns: DeepTurnSnapshot[]
}

export type DeepVoteSnapshot = {
  approve: number
  conditional: number
  oppose: number
  abstain: number
  summary: string
  votes: { provider: string; brand: string; choice: string | null; reason: string | null; ok: boolean }[]
}

export type DeepVerdictSnapshot = {
  judgment: string | null
  keyIssues: string | null
  minorityReport: string | null
  consensusScore: number | null
}

export type DeepOpenSnapshot = {
  kind: 'open'
  instrument: string | null
  proposition: string | null
  plan: DeepSeatSnapshot[] | null
  briefing: string | null
  analyses: DeepAnalysisSnapshot[]
  synthesis: string | null
}

export type DeepDebateSnapshot = {
  kind: 'debate'
  instrument: string | null
  proposition: string | null
  plan: DeepSeatSnapshot[] | null
  briefing: string | null
  rounds: DeepRoundSnapshot[]
  vote: DeepVoteSnapshot | null
  verdict: DeepVerdictSnapshot | null
}

export type DeepSnapshot = DeepOpenSnapshot | DeepDebateSnapshot

/** Duplicated from deep-prompts' LEAGUE_DEEP_BRAND_LABEL (see module doc). */
const BRAND_LABEL: Record<string, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  solar: 'Solar',
  'glm-5.2': 'GLM',
  perplexity: 'Perplexity',
  meta: 'Llama',
}

export function deepBrandLabel(provider: string): string {
  return BRAND_LABEL[provider] ?? provider
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

function seatFrom(raw: Record<string, unknown>, kind: 'open' | 'debate'): DeepSeatSnapshot {
  const provider = str(raw.provider) ?? 'unknown'
  return {
    roleId: str(raw.roleId) ?? provider,
    roleLabel: str(raw.roleLabel) ?? 'Analyst',
    provider,
    brand: deepBrandLabel(provider),
    ...(kind === 'open' ? { subQuestion: str(raw.subQuestion) ?? str(raw.mandate) ?? undefined } : {}),
    ...(kind === 'debate' ? { mandate: str(raw.mandate) ?? undefined } : {}),
  }
}

function planSeats(plan: unknown, kind: 'open' | 'debate'): DeepSeatSnapshot[] | null {
  if (!plan || typeof plan !== 'object') return null
  const roles = (plan as { roles?: unknown }).roles
  if (!Array.isArray(roles) || roles.length === 0) return null
  return roles
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => seatFrom(r, kind))
}

function turnsFrom(raw: unknown): DeepTurnSnapshot[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => {
      const provider = str(t.provider) ?? 'unknown'
      return {
        roleLabel: str(t.roleLabel) ?? 'Analyst',
        provider,
        brand: deepBrandLabel(provider),
        position: str(t.position),
        concedes: str(t.concedes),
        holds: str(t.holds),
        ok: t.ok === true,
      }
    })
}

function roundsFrom(raw: unknown): DeepRoundSnapshot[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      roundNumber: typeof r.roundNumber === 'number' ? r.roundNumber : 0,
      consensusScore: typeof r.consensusScore === 'number' ? r.consensusScore : -1,
      summary: str(r.summary) ?? '',
      turns: turnsFrom(r.turns),
    }))
}

/**
 * Builds the sanitized snapshot from a run row's `state`. Returns null
 * for the pre-seed placeholder (nothing to show yet).
 */
export function buildDeepSnapshot(
  product: 'open' | 'debate',
  state: Record<string, unknown> | null | undefined
): DeepSnapshot | null {
  if (!state || typeof state !== 'object') return null
  if ((state as { __unseeded?: unknown }).__unseeded === true) return null
  return product === 'open' ? buildOpenSnapshot(state) : buildDebateSnapshot(state)
}

function buildOpenSnapshot(state: Record<string, unknown>): DeepOpenSnapshot {
  const analysesRaw = Array.isArray(state.analyses) ? state.analyses : []
  const result = (state.result ?? null) as { synthesis?: unknown } | null
  return {
    kind: 'open',
    instrument: str(state.instrument),
    proposition: str(state.proposition),
    plan: planSeats(state.plan, 'open'),
    briefing: str(state.report),
    analyses: analysesRaw
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .map((a) => {
        const provider = str(a.provider) ?? 'unknown'
        return {
          roleId: str(a.roleId) ?? provider,
          roleLabel: str(a.roleLabel) ?? 'Analyst',
          provider,
          brand: deepBrandLabel(provider),
          content: str(a.analysis),
          ok: a.ok === true,
          ...(str(a.error) ? { error: str(a.error)! } : {}),
        }
      }),
    synthesis: result ? str(result.synthesis) : null,
  }
}

function buildDebateSnapshot(state: Record<string, unknown>): DeepDebateSnapshot {
  const deliberation = (state.deliberation ?? null) as { rounds?: unknown; finalScore?: unknown } | null
  const result = (state.result ?? null) as {
    consensusScore?: unknown
    vote?: { approve?: unknown; oppose?: unknown; conditional?: unknown; abstain?: unknown; summary?: unknown } | null
    verdict?: { judgment?: unknown; keyIssues?: unknown; minorityReport?: unknown } | null
  } | null

  // New pipeline persists rounds incrementally; pre-split rows only have
  // them inside the assembled deliberation. Prefer the live list.
  const rounds = roundsFrom(Array.isArray(state.rounds) ? state.rounds : deliberation?.rounds)

  const voteState = (state.vote ?? null) as {
    votes?: unknown
    approveCount?: unknown
    conditionalCount?: unknown
    opposeCount?: unknown
    abstainCount?: unknown
    summary?: unknown
  } | null

  let vote: DeepVoteSnapshot | null = null
  if (voteState && typeof voteState === 'object') {
    const votesRaw = Array.isArray(voteState.votes) ? voteState.votes : []
    vote = {
      approve: typeof voteState.approveCount === 'number' ? voteState.approveCount : 0,
      conditional: typeof voteState.conditionalCount === 'number' ? voteState.conditionalCount : 0,
      oppose: typeof voteState.opposeCount === 'number' ? voteState.opposeCount : 0,
      abstain: typeof voteState.abstainCount === 'number' ? voteState.abstainCount : 0,
      summary: str(voteState.summary) ?? '',
      votes: votesRaw
        .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
        .map((v) => {
          const provider = str(v.provider) ?? 'unknown'
          return {
            provider,
            brand: deepBrandLabel(provider),
            choice: str(v.choice),
            reason: str(v.reason),
            ok: v.ok === true,
          }
        }),
    }
  } else if (result?.vote && typeof result.vote === 'object') {
    // Terminal rows from before the vote hop split: counts only.
    const rv = result.vote
    vote = {
      approve: typeof rv.approve === 'number' ? rv.approve : 0,
      conditional: typeof rv.conditional === 'number' ? rv.conditional : 0,
      oppose: typeof rv.oppose === 'number' ? rv.oppose : 0,
      abstain: typeof rv.abstain === 'number' ? rv.abstain : 0,
      summary: str(rv.summary) ?? '',
      votes: [],
    }
  }

  const verdict: DeepVerdictSnapshot | null =
    result?.verdict && typeof result.verdict === 'object'
      ? {
          judgment: str(result.verdict.judgment),
          keyIssues: str(result.verdict.keyIssues),
          minorityReport: str(result.verdict.minorityReport),
          consensusScore:
            typeof result.consensusScore === 'number'
              ? result.consensusScore
              : typeof deliberation?.finalScore === 'number'
                ? deliberation.finalScore
                : null,
        }
      : null

  return {
    kind: 'debate',
    instrument: str(state.instrument),
    proposition: str(state.proposition),
    plan: planSeats(state.plan, 'debate'),
    briefing: str(state.report),
    rounds,
    vote,
    verdict,
  }
}
