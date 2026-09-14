import { callPlatformModel } from '@/lib/ai/platform-providers'
import { userQuestionLabel } from '@/lib/motie/persona'
import {
  buildDeliberationSystemPrompt,
  buildVoteSystemPrompt,
  buildVoteUserPrompt,
  buildVoterTranscript,
  formatContestedForVote,
  formatPriorRound,
  JEJU_DEEP_DELIBERATION_TUNING,
  measureConsensus,
  parseDeliberationOutput,
  parseVoteResponse,
  runDeliberationRound,
  runOneVote,
  sanitizeVoteReason,
  type JejuCouncilMode,
  type JejuDeliberation,
  type JejuDeliberationStopReason,
  type JejuDeliberationTurn,
  type JejuExpertRole,
  type JejuRevisedAnalysis,
  type JejuRoundResult,
  type JejuVote,
  type JejuVoteResult,
  type MotieProvider,
} from '@/lib/motie/deep'
import {
  isLeagueOpenReplacementSeat,
  LEAGUE_OPEN_REPLACEMENT_PLATFORM_ID,
  LEAGUE_OPEN_REPLACEMENT_PROVIDER,
  LEAGUE_VOTE_BRAND_LABEL,
  LEAGUE_VOTE_PANEL,
} from './deep-open-replacement-policy'

export {
  LEAGUE_VOTE_BRAND_LABEL,
  LEAGUE_VOTE_PANEL,
  remapOpenPlanExaone,
} from './deep-open-replacement-policy'

const DELIBERATION_MAX_TOKENS = 1200

type LeagueDebateRole = Omit<JejuExpertRole, 'provider'> & { provider: string }

function asMotieRole(role: LeagueDebateRole): JejuExpertRole {
  return { ...role, provider: role.provider as JejuExpertRole['provider'] }
}

function buildDeliberationResult(
  rounds: JejuRoundResult[],
  stoppedReason: JejuDeliberationStopReason,
  error?: string
): JejuDeliberation {
  const last = rounds.length > 0 ? rounds[rounds.length - 1]! : undefined
  const ok = rounds.some((r) => r.ok && r.consensusScore !== JEJU_DEEP_DELIBERATION_TUNING.CONSENSUS_SCORE_UNAVAILABLE)
  return {
    rounds,
    finalScore: last ? last.consensusScore : JEJU_DEEP_DELIBERATION_TUNING.CONSENSUS_SCORE_UNAVAILABLE,
    roundsRun: rounds.length,
    stoppedReason,
    agreedPoints: last ? last.agreedPoints : [],
    contestedPoints: last ? last.contestedPoints : [],
    summary: last ? last.summary : '',
    ok,
    ...(error ? { error } : {}),
  }
}

/**
 * League debate loop. Same stop rules as MOTIE `runDeliberation`, but the
 * remapped GLM seat is called on OpenRouter and the other seats stay on MOTIE.
 */
export async function runLeagueDeliberation(params: {
  question: string
  roles: LeagueDebateRole[]
  seedAnalyses: JejuRevisedAnalysis[]
  maxRounds?: number
}): Promise<JejuDeliberation> {
  const { question, roles, seedAnalyses } = params
  const maxRounds = Math.max(
    JEJU_DEEP_DELIBERATION_TUNING.MIN_CONVERGENCE_ROUNDS,
    Math.min(
      JEJU_DEEP_DELIBERATION_TUNING.MAX_CONVERGENCE_ROUNDS,
      params.maxRounds ?? JEJU_DEEP_DELIBERATION_TUNING.MAX_CONVERGENCE_ROUNDS
    )
  )

  const liveRoles = roles.filter((role) => !isLeagueOpenReplacementSeat(role.provider)).map(asMotieRole)
  const swapRoles = roles.filter((role) => isLeagueOpenReplacementSeat(role.provider))

  const rounds: JejuRoundResult[] = []

  try {
    for (let roundNumber = 1; roundNumber <= maxRounds; roundNumber += 1) {
      const priorTurns = roundNumber > 1 ? rounds[rounds.length - 1]!.turns : []
      const peerContext =
        priorTurns.length > 0 ? formatPriorRound(priorTurns) : formatLeagueSeedAnalyses(seedAnalyses)

      const [live, swapped] = await Promise.all([
        liveRoles.length > 0
          ? runDeliberationRound({
              question,
              roles: liveRoles,
              roundNumber,
              priorTurns,
              ...(roundNumber === 1 ? { seedAnalyses } : {}),
              councilMode: 'warroom',
            })
          : Promise.resolve(null),
        Promise.all(
          swapRoles.map((role) =>
            runReplacementDeliberationTurn({
              role,
              question,
              roundNumber,
              ownPrior: ownPriorFor(role, priorTurns, seedAnalyses),
              peerContext,
            })
          )
        ),
      ])

      const byRoleId = new Map<string, JejuDeliberationTurn>()
      for (const turn of [...(live?.turns ?? []), ...swapped]) byRoleId.set(turn.roleId, turn)
      const turns = roles.map((role) => {
        const hit = byRoleId.get(role.roleId)
        if (hit) return hit
        return {
          roleId: role.roleId,
          roleLabel: role.roleLabel,
          provider: LEAGUE_OPEN_REPLACEMENT_PROVIDER as JejuDeliberationTurn['provider'],
          isRedTeam: role.isRedTeam === true,
          ok: false,
          position: null,
          concedes: null,
          holds: null,
          error: 'replacement seat produced no turn',
        }
      })

      const consensus = await measureConsensus(turns, 'warroom')
      const anyTurnOk = turns.some((t) => t.ok)
      const round: JejuRoundResult = {
        roundNumber,
        turns,
        consensusScore: consensus.consensusScore,
        agreedPoints: consensus.agreedPoints,
        contestedPoints: consensus.contestedPoints,
        summary: consensus.summary,
        ok: anyTurnOk,
        ...(anyTurnOk ? {} : { error: '유효한 토론 발언이 하나도 없습니다.' }),
      }
      rounds.push(round)

      if (!round.ok || round.consensusScore === JEJU_DEEP_DELIBERATION_TUNING.CONSENSUS_SCORE_UNAVAILABLE) {
        return buildDeliberationResult(rounds, 'error', round.error ?? '라운드 측정 실패로 토론을 중단합니다.')
      }

      if (roundNumber >= JEJU_DEEP_DELIBERATION_TUNING.MIN_CONVERGENCE_ROUNDS) {
        if (round.consensusScore >= JEJU_DEEP_DELIBERATION_TUNING.CONSENSUS_TARGET) {
          return buildDeliberationResult(rounds, 'target_reached')
        }
        const prevScore = rounds[rounds.length - 2]?.consensusScore ?? round.consensusScore
        if (round.consensusScore - prevScore < JEJU_DEEP_DELIBERATION_TUNING.STALL_DELTA) {
          return buildDeliberationResult(rounds, 'stalled')
        }
      }

      if (roundNumber >= maxRounds) {
        return buildDeliberationResult(rounds, 'max_rounds')
      }
    }

    return buildDeliberationResult(rounds, 'max_rounds')
  } catch (e: unknown) {
    return buildDeliberationResult(
      rounds,
      'error',
      `토론 루프 실패: ${e instanceof Error ? e.message : 'unknown error'}`
    )
  }
}

function formatLeagueSeedAnalyses(seed: JejuRevisedAnalysis[]): string {
  const usable = seed.filter((s) => s.ok && s.revised && s.revised.trim() !== '')
  if (usable.length === 0) return ''
  return usable
    .map((s) => {
      const tag = s.isRedTeam ? ' [레드팀]' : ''
      return `[${s.roleLabel}]${tag}\n입장: ${s.revised!.trim()}`
    })
    .join('\n\n')
}

function ownPriorFor(
  role: LeagueDebateRole,
  priorTurns: JejuDeliberationTurn[],
  seedAnalyses: JejuRevisedAnalysis[]
): string {
  const prior = priorTurns.find((t) => t.roleId === role.roleId)
  if (prior && prior.ok && prior.position) return prior.position
  const seed = seedAnalyses.find((s) => s.roleId === role.roleId)
  if (seed && seed.ok && seed.revised) return seed.revised
  return ''
}

async function runReplacementDeliberationTurn(params: {
  role: LeagueDebateRole
  question: string
  roundNumber: number
  ownPrior: string
  peerContext: string
}): Promise<JejuDeliberationTurn> {
  const labeled = asMotieRole({
    ...params.role,
    provider: LEAGUE_OPEN_REPLACEMENT_PROVIDER,
  })
  const base: JejuDeliberationTurn = {
    roleId: params.role.roleId,
    roleLabel: params.role.roleLabel,
    provider: labeled.provider,
    isRedTeam: params.role.isRedTeam === true,
    ok: false,
    position: null,
    concedes: null,
    holds: null,
  }

  const userPrompt = [
    `[${userQuestionLabel('warroom')}]`,
    params.question,
    '',
    '[당신의 직전 입장]',
    params.ownPrior || '(직전 입장 없음)',
    '',
    params.roundNumber <= 1
      ? '## 직전 라운드 전문가 입장 (1차 수렴 라운드 — 각자의 조사 반영 분석에서 출발)'
      : '## 직전 라운드 전문가 입장',
    params.peerContext,
    '',
    '위 입장들을 검토하고, 받아들일 점은 받아들이고 지킬 점은 반박하며 당신의 입장을 갱신하세요. 스키마에 맞는 순수 JSON만 출력하세요.',
  ].join('\n')

  try {
    const called = await callPlatformModel({
      id: LEAGUE_OPEN_REPLACEMENT_PLATFORM_ID,
      systemPrompt: buildDeliberationSystemPrompt(labeled, params.question, params.roundNumber, 'warroom'),
      userPrompt,
      maxCompletionTokens: DELIBERATION_MAX_TOKENS,
      timeoutMs: 120_000,
    })
    const text = called.text?.trim() ?? ''
    if (called.error || text.length < 20) {
      return { ...base, error: called.error ?? 'replacement debater returned empty text' }
    }
    const parsed = parseDeliberationOutput(text)
    if (!parsed.position) {
      return { ...base, error: 'replacement debater returned no position' }
    }
    return {
      ...base,
      ok: true,
      position: parsed.position,
      concedes: parsed.concedes,
      holds: parsed.holds,
    }
  } catch (e: unknown) {
    return { ...base, error: e instanceof Error ? e.message : 'replacement debater threw' }
  }
}

/**
 * League motion vote. Same rules as MOTIE `runJejuMotionVote`, but the
 * dead EXAONE seat is remapped to GLM-5.2 and routed through OpenRouter,
 * while the other 8 seats stay on MOTIE.
 */
export async function runLeagueMotionVote(params: {
  question: string
  deliberation: JejuDeliberation
  councilMode?: JejuCouncilMode
}): Promise<JejuVoteResult> {
  const councilMode: JejuCouncilMode = params.councilMode ?? 'warroom'
  const question = params.question?.trim() ?? ''
  if (!question) {
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
      summary: '표결할 안건이 없어 표결을 건너뜁니다.',
    }
  }

  const systemPrompt = buildVoteSystemPrompt('motion', councilMode)
  const unresolvedIssues = formatContestedForVote(params.deliberation.contestedPoints)

  const userPromptFor = (provider: string): string =>
    buildVoteUserPrompt({
      mode: 'motion',
      question,
      proposition: question,
      unresolvedIssues,
      ownTranscript: buildVoterTranscript(params.deliberation, provider),
    })

  const settled = await Promise.allSettled(
    LEAGUE_VOTE_PANEL.map((p) => {
      if (isLeagueOpenReplacementSeat(p)) {
        return runReplacementVote(systemPrompt, userPromptFor(p))
      }
      return runOneVote(p as MotieProvider, systemPrompt, userPromptFor(p))
    })
  )

  const votes: JejuVote[] = settled.map((s, i) => {
    const provider = LEAGUE_VOTE_PANEL[i]!
    if (s.status === 'fulfilled') return s.value
    return {
      provider: provider as JejuVote['provider'],
      ok: false,
      choice: null,
      reason: null,
      error: `표결 처리 실패: ${s.reason instanceof Error ? s.reason.message : 'unknown error'}`,
    }
  })

  const approveProviders: string[] = []
  const conditionalProviders: string[] = []
  const opposeProviders: string[] = []
  const abstainProviders: string[] = []

  for (const v of votes) {
    if (!v.ok || v.choice == null) continue
    const label = LEAGUE_VOTE_BRAND_LABEL[v.provider] ?? v.provider
    if (v.choice === 'approve') approveProviders.push(label)
    else if (v.choice === 'conditional') conditionalProviders.push(label)
    else if (v.choice === 'oppose') opposeProviders.push(label)
    else if (v.choice === 'abstain') abstainProviders.push(label)
  }

  const approveCount = approveProviders.length
  const conditionalCount = conditionalProviders.length
  const opposeCount = opposeProviders.length
  const abstainCount = abstainProviders.length

  const yesSide = approveCount + conditionalCount
  let outcome: 'approved' | 'rejected' | 'divided'
  if (yesSide > opposeCount) outcome = 'approved'
  else if (opposeCount > yesSide) outcome = 'rejected'
  else outcome = 'divided'

  const outcomeLabel =
    outcome === 'approved' ? '다수 승인' : outcome === 'rejected' ? '다수 반대' : '찬반 동수'
  const summary = `찬성 ${approveCount} · 조건부 찬성 ${conditionalCount} · 기권 ${abstainCount} · 반대 ${opposeCount} — ${outcomeLabel}`
  const ok = approveCount + conditionalCount + opposeCount + abstainCount > 0

  return {
    votes,
    approveCount,
    conditionalCount,
    opposeCount,
    abstainCount,
    approveProviders,
    conditionalProviders,
    opposeProviders,
    abstainProviders,
    outcome,
    ok,
    summary,
  }
}

async function runReplacementVote(
  systemPrompt: string,
  userPrompt: string
): Promise<JejuVote> {
  const provider = LEAGUE_OPEN_REPLACEMENT_PROVIDER as JejuVote['provider']
  try {
    const called = await callPlatformModel({
      id: LEAGUE_OPEN_REPLACEMENT_PLATFORM_ID,
      systemPrompt,
      userPrompt,
      maxCompletionTokens: 700,
      timeoutMs: 120_000,
    })
    if (called.error || !called.text) {
      return {
        provider,
        ok: false,
        choice: null,
        reason: null,
        error: called.error ?? '표결 응답이 비어 있습니다.',
      }
    }
    const parsed = parseVoteResponse(called.text)
    const choice = parsed.choice
    const reason = sanitizeVoteReason(parsed.reason)
    if (choice == null) {
      return {
        provider,
        ok: false,
        choice: null,
        reason,
        error: '표결을 해석할 수 없습니다(형식 불일치).',
      }
    }
    return { provider, ok: true, choice, reason }
  } catch (e: unknown) {
    return {
      provider,
      ok: false,
      choice: null,
      reason: null,
      error: `표결 호출 실패: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }
}
