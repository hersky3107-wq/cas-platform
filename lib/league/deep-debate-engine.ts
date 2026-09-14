import { LEAGUE_VOTE_BRAND_LABEL, LEAGUE_VOTE_PANEL } from './deep-open-replacement-policy'
import { callLeagueDeepModel, parseJsonObject } from './deep-model'
import {
  LEAGUE_DEEP_DEBATE_ROSTER,
  fallbackDebateRoles,
  leagueChairSystemPrompt,
  leagueConsensusSystemPrompt,
  leagueDebateOrchestratorSystemPrompt,
  leagueDeliberationSystemPrompt,
  leagueVoteSystemPrompt,
} from './deep-prompts'
import {
  LEAGUE_CONSENSUS_TARGET,
  LEAGUE_CONSENSUS_UNAVAILABLE,
  LEAGUE_DELIBERATION_MAX_ROUNDS,
  LEAGUE_DELIBERATION_MIN_ROUNDS,
  LEAGUE_STALL_DELTA,
  type LeagueChairVerdict,
  type LeagueDebateMeetingPlan,
  type LeagueDeepRole,
  type LeagueDeliberation,
  type LeagueDeliberationStopReason,
  type LeagueDeliberationTurn,
  type LeagueRoundResult,
  type LeagueVote,
  type LeagueVoteChoice,
  type LeagueVoteResult,
} from './deep-types'

const DEBATE_SET = new Set<string>(LEAGUE_DEEP_DEBATE_ROSTER)

export function fallbackDebatePlan(question: string): LeagueDebateMeetingPlan {
  const defaults = fallbackDebateRoles()
  return {
    ok: true,
    question,
    rationale: 'Fixed independent-analyst debate lineup; no ministry seating.',
    roles: defaults.map((role, i) => ({
      ...role,
      provider: LEAGUE_DEEP_DEBATE_ROSTER[i] ?? 'anthropic',
    })),
  }
}

export async function planLeagueDebateMeeting(params: {
  question: string
  availableDataSummary: string
}): Promise<LeagueDebateMeetingPlan> {
  const question = params.question.trim()
  if (!question) return { ok: false, question, roles: [], rationale: '', error: 'empty question' }

  const called = await callLeagueDeepModel({
    provider: 'anthropic',
    systemPrompt: leagueDebateOrchestratorSystemPrompt(),
    userPrompt: [
      '[Proposition]',
      question,
      '',
      '[Packets already on this round]',
      params.availableDataSummary || '(none)',
      '',
      'Assign one private-analyst seat per brand. JSON only.',
    ].join('\n'),
    maxCompletionTokens: 3000,
    modelOverride: 'claude-opus-4-8',
  })

  if (called.error || !called.text) {
    return { ...fallbackDebatePlan(question), rationale: `orchestrator fallback: ${called.error ?? 'empty'}` }
  }

  const parsed = parseJsonObject(called.text)
  const rawRoles = Array.isArray(parsed?.roles) ? parsed.roles : []
  const used = new Set<string>()
  const roles: LeagueDeepRole[] = []
  for (const item of rawRoles) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const provider = typeof o.provider === 'string' && DEBATE_SET.has(o.provider) ? o.provider : ''
    if (!provider || used.has(provider)) continue
    used.add(provider)
    roles.push({
      roleId: typeof o.roleId === 'string' && o.roleId.trim() ? o.roleId.trim() : provider,
      roleLabel: typeof o.roleLabel === 'string' && o.roleLabel.trim() ? o.roleLabel.trim() : 'Independent analyst',
      mandate:
        typeof o.mandate === 'string' && o.mandate.trim()
          ? o.mandate.trim()
          : 'Weigh both sides from this lens using the league packets only.',
      provider,
      isRedTeam: false,
    })
  }

  if (roles.length !== LEAGUE_DEEP_DEBATE_ROSTER.length) {
    return fallbackDebatePlan(question)
  }

  return {
    ok: true,
    question,
    roles,
    rationale: typeof parsed?.rationale === 'string' ? parsed.rationale : '',
  }
}

function parseDeliberationOutput(raw: string): { position: string; concedes: string; holds: string } {
  const parsed = parseJsonObject(raw)
  if (!parsed) return { position: raw.trim(), concedes: '', holds: '' }
  return {
    position: typeof parsed.position === 'string' && parsed.position.trim() ? parsed.position.trim() : raw.trim(),
    concedes: typeof parsed.concedes === 'string' ? parsed.concedes.trim() : '',
    holds: typeof parsed.holds === 'string' ? parsed.holds.trim() : '',
  }
}

function formatTurns(turns: LeagueDeliberationTurn[]): string {
  return turns
    .filter((t) => t.ok && t.position)
    .map((t) => {
      const lines = [`[${t.roleLabel}]`, `입장: ${t.position!.trim()}`]
      if (t.concedes) lines.push(`수용: ${t.concedes}`)
      if (t.holds) lines.push(`견지: ${t.holds}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

function formatSeed(seed: { roleLabel: string; revised: string | null; ok: boolean }[]): string {
  return seed
    .filter((s) => s.ok && s.revised?.trim())
    .map((s) => `[${s.roleLabel}]\n입장: ${s.revised!.trim()}`)
    .join('\n\n')
}

async function measureConsensus(turns: LeagueDeliberationTurn[]): Promise<{
  consensusScore: number
  agreedPoints: string[]
  contestedPoints: string[]
  summary: string
  ok: boolean
}> {
  const usable = turns.filter((t) => t.ok && t.position?.trim())
  if (usable.length === 0) {
    return { consensusScore: LEAGUE_CONSENSUS_UNAVAILABLE, agreedPoints: [], contestedPoints: [], summary: '', ok: false }
  }
  const called = await callLeagueDeepModel({
    provider: 'anthropic',
    systemPrompt: leagueConsensusSystemPrompt(),
    userPrompt: [`LIVE responders: ${usable.length}`, formatTurns(usable), '', 'JSON only.'].join('\n'),
    maxCompletionTokens: 1200,
  })
  const parsed = called.text ? parseJsonObject(called.text) : null
  const score = typeof parsed?.score === 'number' ? Math.max(0, Math.min(100, Math.round(parsed.score))) : LEAGUE_CONSENSUS_UNAVAILABLE
  return {
    consensusScore: score,
    agreedPoints: Array.isArray(parsed?.agreedPoints) ? parsed.agreedPoints.filter((x): x is string => typeof x === 'string') : [],
    contestedPoints: Array.isArray(parsed?.contestedPoints)
      ? parsed.contestedPoints.filter((x): x is string => typeof x === 'string')
      : [],
    summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
    ok: score !== LEAGUE_CONSENSUS_UNAVAILABLE,
  }
}

function buildDeliberationResult(
  rounds: LeagueRoundResult[],
  stoppedReason: LeagueDeliberationStopReason,
  error?: string
): LeagueDeliberation {
  const last = rounds[rounds.length - 1]
  return {
    rounds,
    finalScore: last ? last.consensusScore : LEAGUE_CONSENSUS_UNAVAILABLE,
    roundsRun: rounds.length,
    stoppedReason,
    agreedPoints: last?.agreedPoints ?? [],
    contestedPoints: last?.contestedPoints ?? [],
    summary: last?.summary ?? '',
    ok: rounds.some((r) => r.ok && r.consensusScore !== LEAGUE_CONSENSUS_UNAVAILABLE),
    ...(error ? { error } : {}),
  }
}

export async function runLeagueDeliberation(params: {
  question: string
  roles: LeagueDeepRole[]
  seedAnalyses: { roleId: string; roleLabel: string; ok: boolean; revised: string | null }[]
  maxRounds?: number
}): Promise<LeagueDeliberation> {
  const maxRounds = Math.max(
    LEAGUE_DELIBERATION_MIN_ROUNDS,
    Math.min(LEAGUE_DELIBERATION_MAX_ROUNDS, params.maxRounds ?? LEAGUE_DELIBERATION_MAX_ROUNDS)
  )
  const rounds: LeagueRoundResult[] = []

  try {
    for (let roundNumber = 1; roundNumber <= maxRounds; roundNumber += 1) {
      const prior = roundNumber > 1 ? rounds[rounds.length - 1]!.turns : []
      const peerContext = prior.length > 0 ? formatTurns(prior) : formatSeed(params.seedAnalyses)

      const settled = await Promise.allSettled(
        params.roles.map(async (role) => {
          const ownPrior =
            prior.find((t) => t.roleId === role.roleId && t.ok && t.position)?.position ??
            params.seedAnalyses.find((s) => s.roleId === role.roleId && s.ok)?.revised ??
            ''
          const called = await callLeagueDeepModel({
            provider: role.provider,
            systemPrompt: leagueDeliberationSystemPrompt({
              roleLabel: role.roleLabel,
              mandate: role.mandate,
              question: params.question,
              roundNumber,
            }),
            userPrompt: [
              '[Proposition]',
              params.question,
              '',
              '[Your prior position]',
              ownPrior || '(none)',
              '',
              '[Peer positions]',
              peerContext || '(none)',
              '',
              'JSON only.',
            ].join('\n'),
            maxCompletionTokens: 1200,
          })
          const base: LeagueDeliberationTurn = {
            roleId: role.roleId,
            roleLabel: role.roleLabel,
            provider: role.provider,
            isRedTeam: role.isRedTeam === true,
            ok: false,
            position: null,
            concedes: null,
            holds: null,
          }
          if (called.error || !called.text || called.text.length < 20) {
            return { ...base, error: called.error ?? 'empty deliberation turn' }
          }
          const parsed = parseDeliberationOutput(called.text)
          if (!parsed.position) return { ...base, error: 'no position' }
          return { ...base, ok: true, position: parsed.position, concedes: parsed.concedes, holds: parsed.holds }
        })
      )

      const turns = settled.map((s, i) => {
        if (s.status === 'fulfilled') return s.value
        const role = params.roles[i]!
        return {
          roleId: role.roleId,
          roleLabel: role.roleLabel,
          provider: role.provider,
          isRedTeam: role.isRedTeam === true,
          ok: false,
          position: null,
          concedes: null,
          holds: null,
          error: s.reason instanceof Error ? s.reason.message : 'turn rejected',
        }
      })

      const consensus = await measureConsensus(turns)
      const round: LeagueRoundResult = {
        roundNumber,
        turns,
        consensusScore: consensus.consensusScore,
        agreedPoints: consensus.agreedPoints,
        contestedPoints: consensus.contestedPoints,
        summary: consensus.summary,
        ok: turns.some((t) => t.ok),
        ...(turns.some((t) => t.ok) ? {} : { error: 'no live turns' }),
      }
      rounds.push(round)

      if (!round.ok || round.consensusScore === LEAGUE_CONSENSUS_UNAVAILABLE) {
        return buildDeliberationResult(rounds, 'error', round.error ?? 'consensus failed')
      }
      if (roundNumber >= LEAGUE_DELIBERATION_MIN_ROUNDS) {
        if (round.consensusScore >= LEAGUE_CONSENSUS_TARGET) {
          return buildDeliberationResult(rounds, 'target_reached')
        }
        const prev = rounds[rounds.length - 2]?.consensusScore ?? round.consensusScore
        if (round.consensusScore - prev < LEAGUE_STALL_DELTA) {
          return buildDeliberationResult(rounds, 'stalled')
        }
      }
    }
    return buildDeliberationResult(rounds, 'max_rounds')
  } catch (e: unknown) {
    return buildDeliberationResult(rounds, 'error', e instanceof Error ? e.message : 'deliberation threw')
  }
}

function parseVoteChoice(raw: string): LeagueVoteChoice | null {
  const t = raw.trim().toLowerCase()
  if (t === '조건부 찬성' || t === 'conditional') return 'conditional'
  if (t === '찬성' || t === 'approve') return 'approve'
  if (t === '반대' || t === 'oppose') return 'oppose'
  if (t === '기권' || t === 'abstain') return 'abstain'
  return null
}

function parseVoteResponse(text: string): { choice: LeagueVoteChoice | null; reason: string | null } {
  const cMatch = text.match(/(?:표결|Vote):\s*(조건부 찬성|찬성|반대|기권|approve|conditional|oppose|abstain)/i)
  const choice = cMatch ? parseVoteChoice(cMatch[1]!) : null
  const rMatch = text.match(/(?:이유|Reason):\s*([\s\S]+)/i)
  return { choice, reason: rMatch ? rMatch[1]!.trim() : null }
}

function voterTranscript(deliberation: LeagueDeliberation, provider: string): string {
  const lines: string[] = []
  for (const round of deliberation.rounds) {
    for (const turn of round.turns) {
      if (turn.provider !== provider || !turn.ok || !turn.position) continue
      lines.push(`R${round.roundNumber} ${turn.roleLabel}: ${turn.position}`)
    }
  }
  return lines.join('\n') || '(no prior turns)'
}

export async function runLeagueMotionVote(params: {
  question: string
  deliberation: LeagueDeliberation
}): Promise<LeagueVoteResult> {
  const question = params.question.trim()
  if (!question) {
    return {
      votes: [],
      approveCount: 0,
      conditionalCount: 0,
      opposeCount: 0,
      abstainCount: 0,
      summary: 'no proposition',
      ok: false,
    }
  }

  const contested = params.deliberation.contestedPoints.map((p) => `• ${p}`).join('\n') || '(none)'
  const settled = await Promise.allSettled(
    LEAGUE_VOTE_PANEL.map(async (provider) => {
      const called = await callLeagueDeepModel({
        provider,
        systemPrompt: leagueVoteSystemPrompt(),
        userPrompt: [
          '[Motion — league proposition]',
          question,
          '',
          '[Unresolved points]',
          contested,
          '',
          '[Your own transcript]',
          voterTranscript(params.deliberation, provider),
        ].join('\n'),
        maxCompletionTokens: 700,
      })
      const base: LeagueVote = { provider, ok: false, choice: null, reason: null }
      if (called.error || !called.text) {
        return { ...base, error: called.error ?? 'empty vote' }
      }
      const parsed = parseVoteResponse(called.text)
      if (!parsed.choice) return { ...base, reason: parsed.reason, error: 'unparsed vote' }
      return { ...base, ok: true, choice: parsed.choice, reason: parsed.reason }
    })
  )

  const votes = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value
    return {
      provider: LEAGUE_VOTE_PANEL[i]!,
      ok: false,
      choice: null,
      reason: null,
      error: s.reason instanceof Error ? s.reason.message : 'vote rejected',
    }
  })

  let approveCount = 0
  let conditionalCount = 0
  let opposeCount = 0
  let abstainCount = 0
  for (const v of votes) {
    if (!v.ok || !v.choice) continue
    if (v.choice === 'approve') approveCount += 1
    else if (v.choice === 'conditional') conditionalCount += 1
    else if (v.choice === 'oppose') opposeCount += 1
    else abstainCount += 1
  }

  const yes = approveCount + conditionalCount
  const outcome = yes > opposeCount ? 'majority yes' : opposeCount > yes ? 'majority no' : 'tied'
  return {
    votes,
    approveCount,
    conditionalCount,
    opposeCount,
    abstainCount,
    summary: `yes ${approveCount} · conditional ${conditionalCount} · abstain ${abstainCount} · no ${opposeCount} — ${outcome}`,
    ok: approveCount + conditionalCount + opposeCount + abstainCount > 0,
  }
}

function parseChairSections(text: string): { judgment: string | null; keyIssues: string | null; minorityReport: string | null } {
  const result = { judgment: null as string | null, keyIssues: null as string | null, minorityReport: null as string | null }
  const parts = text.split(/^\s*##\s+/m)
  for (const part of parts) {
    const nl = part.indexOf('\n')
    if (nl === -1) continue
    const heading = part.slice(0, nl).trim().toLowerCase()
    const body = part.slice(nl + 1).trim()
    if (!body) continue
    if (heading.includes('judgment') || heading.includes('판단')) result.judgment = body
    else if (heading.includes('key') || heading.includes('쟁점')) result.keyIssues = body
    else if (heading.includes('minority') || heading.includes('소수')) result.minorityReport = body
  }
  return result
}

export async function renderLeagueChairVerdict(params: {
  question: string
  briefing: string | null
  context: string
  deliberation: LeagueDeliberation
  vote: LeagueVoteResult
}): Promise<LeagueChairVerdict> {
  const minorityFallback =
    params.deliberation.contestedPoints.length > 0
      ? params.deliberation.contestedPoints.map((p) => `• ${p}`).join('\n')
      : null

  const called = await callLeagueDeepModel({
    provider: 'anthropic',
    systemPrompt: leagueChairSystemPrompt(),
    userPrompt: [
      '# Proposition',
      params.question,
      '',
      '# Packets',
      params.context,
      '',
      '# Briefing',
      params.briefing ?? '(none)',
      '',
      '# Debate summary',
      params.deliberation.summary || '(none)',
      `Agreed: ${params.deliberation.agreedPoints.join(' / ') || '(none)'}`,
      `Contested: ${params.deliberation.contestedPoints.join(' / ') || '(none)'}`,
      '',
      '# Advisory ballot (non-binding)',
      params.vote.summary,
      '',
      'Write the three headed sections.',
    ].join('\n'),
    maxCompletionTokens: 4000,
    modelOverride: 'claude-opus-4-8',
  })

  if (called.error || !called.text) {
    return {
      ok: false,
      judgment: null,
      keyIssues: null,
      minorityReport: minorityFallback,
      consensusScore: params.deliberation.finalScore,
      error: called.error ?? 'empty chair verdict',
    }
  }

  const parsed = parseChairSections(called.text)
  return {
    ok: true,
    judgment: parsed.judgment ?? called.text,
    keyIssues: parsed.keyIssues,
    minorityReport: parsed.minorityReport ?? minorityFallback,
    consensusScore: params.deliberation.finalScore,
  }
}

export function voteBrandLabel(provider: string): string {
  return LEAGUE_VOTE_BRAND_LABEL[provider] ?? provider
}
