import 'server-only'

import type { FestivalProvider } from '@/lib/festival/types'
import { FESTIVAL_DEBATE_SEATS } from '@/lib/festival/roster'

/**
 * FESTIVAL debate core — SYNOD-style multi-AI deliberation, COPIED (not imported)
 * from lib/motie/synod-debate.ts and PINNED to festival (Korean-only, 6 merged
 * debate seats, no meta/Llama, no vote path).
 *
 * ISOLATION INVARIANT (non-negotiable):
 *   - Depends ONLY on lib/festival/{types,roster}. NEVER imports lib/motie/* or
 *     lib/jeju/* (not even the shared SYNOD copy or the Korean directives — those
 *     are re-declared locally below so festival owns its own copy).
 *   - Deleting lib/festival/* leaves MOTIE + AX Jeju byte-for-byte identical.
 *
 * WHAT WAS COPIED/ADAPTED (all pure string/regex/array transforms):
 *   - parse/JSON helpers, the opening/turn/facilitator prompt builders, and the
 *     memory builders (deliberation context + facilitator input).
 * PINS APPLIED:
 *   - Korean-only lock hardcoded (festival is Korean-only).
 *   - Debaters are the 6 festival DEBATE SEATS (Perplexity never debates).
 *   - Each seat argues AS its festival investigator lens (role identity).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Local Korean directives (COPIED — festival owns its own, no lib/motie import).
// ─────────────────────────────────────────────────────────────────────────────

/** Hard Korean-only output lock, injected into every festival debate/verdict prompt. */
export const FESTIVAL_KOREAN_ONLY_DIRECTIVE =
  '언어 규칙(매우 중요, 반드시 준수): 출력은 100% 깨끗한 표준 한국어여야 합니다. 중국어·일본어 한자나 다른 언어 글자, 혼종·오염 표기를 절대 섞지 마십시오. 브랜드명 등 불가피한 고유명사를 제외하고는 한자·외국어 글자를 쓰지 말고, 모든 문장을 자연스러운 한국어로만 작성하십시오.'

/** Truth-seeking directive — the panel seeks the best forecast, not to win. */
export const FESTIVAL_TRUTH_SEEKING_DIRECTIVE =
  '이 심의의 목적은 당신의 입장을 관철하는 것이 아니라, 패널 전체가 함께 이 축제의 흥행·타당성을 가장 객관적으로 전망하는 것입니다. 당신의 전문 렌즈는 그 전망을 찾기 위한 재료이지, 반드시 이겨야 할 주장이 아닙니다. 다른 조사관의 더 나은 근거가 있으면 정직하게 인정하고 입장을 조정하되, 단지 합의를 위해 약한 근거에 동조하지도 마십시오 — 목표는 "가짜 합의"가 아니라 "정직한 최적 전망"입니다.'

// ─────────────────────────────────────────────────────────────────────────────
// Debate roster — one debater per merged DEBATE SEAT (Perplexity excluded).
// ─────────────────────────────────────────────────────────────────────────────

/** A festival debate seat mapped to the model that voices it in the debate. */
export type FestivalDebateSeatVoice = {
  seatId: string
  /** Korean seat label shown in the debate transcript (the "brand"). */
  labelKo: string
  provider: FestivalProvider
  /** Optional flagship override for this seat (e.g. safety → Opus). */
  modelOverride?: string
  /** The lens/mandate this seat argues from (drives the identity block). */
  mandate: string
}

/**
 * The 6 debate seats, each voiced by ONE model. The merged external_inflow seat
 * (접근성·연계관광 + 글로벌관광) is voiced by DeepSeek. Perplexity never debates.
 * Consumers MUST read .length, never a hardcoded 6.
 */
export const FESTIVAL_DEBATE_ROSTER: readonly FestivalDebateSeatVoice[] = [
  {
    seatId: 'demand',
    labelKo: '수요예측 대표',
    provider: 'openai',
    mandate: '방문 수요의 현실성(예상 관객·집객권·계절성·경쟁 여가 옵션)을 근거로 흥행 가능성을 논증한다.',
  },
  {
    seatId: 'budget',
    labelKo: '예산타당성 대표',
    provider: 'google',
    mandate: '예산 구조·재원 조달·손익분기·집행 리스크 관점에서 실행 타당성을 논증한다.',
  },
  {
    seatId: 'safety_reputation',
    labelKo: '안전·평판 대표',
    provider: 'anthropic',
    modelOverride: 'claude-opus-4-8',
    mandate: '공공안전·군중/교통/기상 리스크·인허가·평판 하방 리스크 관점에서 논증한다.',
  },
  {
    seatId: 'program_diff',
    labelKo: '프로그램·차별성 대표',
    provider: 'xai',
    mandate: '프로그램의 매력도·독창성, 인근/동시기 축제 대비 차별성 관점에서 논증한다.',
  },
  {
    seatId: 'marketing',
    labelKo: '마케팅·홍보 대표',
    provider: 'mistral',
    mandate: '인지도·전환(채널 믹스·타이밍·메시지·전환 경로) 관점에서 흥행 가능성을 논증한다.',
  },
  {
    seatId: 'external_inflow',
    labelKo: '외부 유입·연계관광 대표',
    provider: 'deepseek',
    mandate: '접근성·숙박·연계관광 및 외국인/외지 방문객 유입(국내외 유입) 관점에서 통합적으로 논증한다.',
  },
]

// Sanity: the debate roster must align 1:1 with FESTIVAL_DEBATE_SEATS ids.
// (Pure compile-time-ish guard; kept as a runtime dev assertion, cheap.)
if (FESTIVAL_DEBATE_ROSTER.length !== FESTIVAL_DEBATE_SEATS.length) {
  // eslint-disable-next-line no-console
  console.warn('[festival] debate roster/seat count mismatch')
}

// ─────────────────────────────────────────────────────────────────────────────
// Types (copied shapes from SynodTurn / FacilitatorSummary, festival-scoped)
// ─────────────────────────────────────────────────────────────────────────────

export const FESTIVAL_ACTION_TAGS = ['AGREE', 'CHALLENGE', 'SUPPLEMENT', 'REFRAME'] as const
export type FestivalActionTag = (typeof FESTIVAL_ACTION_TAGS)[number]

/** A single seat's contribution within one debate round. */
export type FestivalTurn = {
  roundNumber: number
  /** Debate seat label (the "brand" shown to peers), e.g. "수요예측 대표". */
  seatLabel: string
  /** Stable seat id (for mapping back to investigators). */
  seatId: string
  actionTag?: FestivalActionTag
  claim?: string
  content: string
  isRedTeam?: boolean
}

/** The facilitator's compressed, structured summary of one round. */
export type FestivalFacilitatorSummary = {
  roundNumber: number
  consensusPoints: { point: string; agreedBy: string[] }[]
  openIssues: { issue: string; positions: { ai: string; stance: string }[] }[]
  /** 0–100; how aligned the seats are on the festival's success direction. */
  roundConsensusScore: number
  nextDirective: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Output parsing helpers (copied verbatim, festival-scoped)
// ─────────────────────────────────────────────────────────────────────────────

/** Extracts the trailing "CLAIM: <one line>" and returns content without it. */
export function parseClaim(raw: string): { content: string; claim: string | null } {
  const m = raw.match(/^CLAIM:\s*(.+)\s*$/im)
  if (!m) return { content: raw.trim(), claim: null }
  const claim = m[1]!.trim()
  const content = raw.replace(m[0], '').trim()
  return { content, claim: claim || null }
}

/** Extracts a leading "ACTION: <TAG>" line and returns content without it. */
export function parseActionTag(raw: string): { content: string; tag: FestivalActionTag | null } {
  const m = raw.match(/^ACTION:\s*(AGREE|CHALLENGE|SUPPLEMENT|REFRAME)\s*$/im)
  if (!m) return { content: raw.trim(), tag: null }
  const tag = m[1]!.toUpperCase() as FestivalActionTag
  const content = raw.replace(m[0], '').trim()
  return { content, tag }
}

/** Strips ```json fences and parses JSON; returns null on any failure. */
export function safeParseJson(raw: string): Record<string, unknown> | null {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence && fence[1]) text = fence[1].trim()
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

// ─────────────────────────────────────────────────────────────────────────────
// System-prompt constants (copied + adapted for festival)
// ─────────────────────────────────────────────────────────────────────────────

const OUTPUT_TAIL_RULE = `반드시 응답의 맨 마지막 줄을 정확히 이 형식으로 끝내십시오(필수):
CLAIM: <당신의 핵심 주장을 한 문장으로>`

const SINGLE_TURN_RULE =
  '당신은 당신 본인의 발언만 작성합니다. 다른 좌석의 발언을 대신 생성하거나 재구성하지 마십시오. 다른 좌석을 언급할 때는 그들의 실제 발언을 짧게 참조만 하고, 당신의 분석만 제시하십시오.'

const LATE_ROUND_RULE =
  '지금은 후반 라운드입니다 — 수렴을 시작하십시오. 다른 좌석이 옳게 본 지점을 인정하고 공통된 전망으로 나아가되, 거짓 합의는 금지입니다. 특정 지점에서 여전히 이견이 있으면 분명히 밝히고 그 지점을 지키십시오("X에는 동의하지만 Y는 아직 못 받아들이겠다 — 왜냐하면…"). 정직한 부분 합의가 공허한 만장일치보다 낫습니다.'

const FESTIVAL_FACILITATOR_SYSTEM = `당신은 축제 흥행 예측 심의(SYNOD 방식)의 중립 진행자(Facilitator)입니다. 당신은 스스로 어떤 입장도 주장하지 않습니다.

이번 라운드의 발언들을 읽고 압축된 구조화 요약을 생성하십시오.

출력 형식 — 엄격한 JSON만. 산문·마크다운 펜스·군더더기 금지. 정확히 이 형태:
{
  "consensusPoints": [{ "point": "문자열", "agreedBy": ["좌석 이름"] }],
  "openIssues": [{ "issue": "문자열", "positions": [{ "ai": "좌석 이름", "stance": "문자열" }] }],
  "roundConsensusScore": 0,
  "nextDirective": "문자열"
}
- roundConsensusScore: 0–100 정수 — 이 축제의 "흥행·추진 방향"에 대한 좌석 간 수렴도를 측정하십시오(개최/조건부/보류 방향과 핵심 근거에 얼마나 정렬됐는지). 미해결 세부사항의 개수가 아닙니다.
  • 방향(핵심 결론)에 대체로 합의하면 세부 실행·우선순위가 열려 있어도 점수를 높게 주십시오.
  • 방향 자체(흥행 유망 vs 위험, 개최 vs 보류)가 갈릴 때만 점수를 낮추십시오.
- openIssues: 미해결 항목을 (1) 방향적 이견(점수 하락)과 (2) 방향은 같지만 남은 실행·우선순위 과제(점수 하락 아님)로 구분하십시오.
- nextDirective: 다음 라운드에서 다룰 가장 생산적인 초점 한 가지.
- 정직하게: 실제로 존재하는 합의만 기록하고 없는 합의를 지어내지 마십시오.`

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builders (copied + adapted; Korean-pinned, seat-identity)
// ─────────────────────────────────────────────────────────────────────────────

function identityBlock(seat: FestivalDebateSeatVoice): string {
  return `전문가 정체성 — 당신은 이 심의에서 다음 전문가 좌석을 맡습니다:
- 좌석: ${seat.labelKo}
- 임무: ${seat.mandate}
이 좌석의 전문성과 관점에서 논증하세요 — 일반 감상이 아니라 해당 렌즈의 전문가로서 데이터·근거로 말합니다. (말투는 생생하고 직설적으로; 딱딱한 보고서 문체는 금지.)`
}

function voiceRules(hasPriorParticipants: boolean): string {
  const reactRule = hasPriorParticipants
    ? '\n- 반응할 때는 상대 좌석 이름을 부르고 그 지점을 직접 치십시오: 예 "수요예측 대표는 X라고 했는데, 그건 핵심을 놓쳤다 — 왜냐면…".'
    : ''
  return `발언 규칙:
- 생동감 있는 구어체로 쓰십시오. 보고서·에세이 톤 금지(딱딱한 종결 "~할 수 있습니다", "~한 측면이 있습니다" 지양).
- 추상론이 아니라 구체적 사례·상황으로 말하십시오.
- 다른 좌석과 분명히 다르게 들려야 합니다 — 좌석 렌즈가 다른 것이 요점입니다.${reactRule}
- 페르소나는 향미일 뿐, 모두 최선의 전망을 향해 협력합니다. 위트로 반박하되 적대는 금지.`
}

function styleBlock(hasPriorParticipants: boolean): string {
  return `작성 스타일:
- 전문적 깊이를 허용하되 분량을 통제: 최대 8~10문장. 소제목 남발 금지.
${hasPriorParticipants ? '- 먼저 특정 좌석의 주장에 직접 반응한 뒤 새 내용을 더하십시오.\n' : ''}- 환각 방지(핵심): 연구명·저자·연도·정확한 수치(관객 수·매출·비율)를 지어내지 마십시오. 확실할 때만 구체 수치를 쓰고, 불확실하면 "[AI 추정]"으로 표기하거나 정성적으로 서술하십시오. 지어낸 인용·수치는 심각한 실패입니다.`
}

/** Opening-round system prompt for one debate seat. */
export function openingSystemPrompt(seat: FestivalDebateSeatVoice): string {
  return `당신은 축제 흥행 예측 심의(SYNOD 방식)의 참가자입니다. 당신은 "${seat.labelKo}"입니다.

${FESTIVAL_TRUTH_SEEKING_DIRECTIVE}

${identityBlock(seat)}

지금은 개회(OPENING) 라운드입니다. 이 축제 기획에 대해 당신 좌석의 독립적이고 근거 있는 전망을 제시하십시오.
규칙:
- 다른 참가자의 답을 참조·상상·추측하지 마십시오. 당신은 아직 아무것도 보지 못했습니다.
- 명확한 입장을 취하십시오. 모든 지점을 얼버무리면 실패입니다.
- 당신 렌즈에서 가장 강한 근거만, 군더더기 없이.

${voiceRules(false)}

${styleBlock(false)}

${OUTPUT_TAIL_RULE}

${FESTIVAL_KOREAN_ONLY_DIRECTIVE}`
}

/** Per-round debate-turn system prompt (red-team branch preserved). */
export function turnSystemPrompt(
  seat: FestivalDebateSeatVoice,
  isRedTeam: boolean,
  roundNumber: number
): string {
  const lateBlock = roundNumber >= 3 ? `\n${LATE_ROUND_RULE}\n` : ''
  if (isRedTeam) {
    return `당신은 축제 흥행 예측 심의(SYNOD 방식)의 참가자입니다. 당신은 "${seat.labelKo}"이며, 이번 라운드에는 스트레스 테스터(품질 관리)입니다.

${FESTIVAL_TRUTH_SEEKING_DIRECTIVE}

${identityBlock(seat)}

이번 라운드 당신의 임무는 품질 관리이지 반대가 아닙니다. 개최/보류 어느 편을 연기하지 말고, 다른 좌석들의 논증에서 진짜 약점(검증 안 된 가정·근거 부족·논리 허점·간과된 리스크·2차 효과)을 찾아 가장 중요한 하나를 정확히 압박하십시오.
규칙:
- 반드시 첫 줄을 정확히 "ACTION: CHALLENGE"로 시작하십시오.
- 정직하게 살펴봐도 논증이 타당하면 그렇다고 말하고 다듬는 것을 도우십시오 — 억지 반대를 만들면 실패입니다.
- 스타일이 아니라 논증의 실질(근거·논리·맹점)을 겨냥하십시오.
${SINGLE_TURN_RULE}
${lateBlock}
${voiceRules(true)}

${styleBlock(true)}

${OUTPUT_TAIL_RULE}

${FESTIVAL_KOREAN_ONLY_DIRECTIVE}`
  }
  return `당신은 축제 흥행 예측 심의(SYNOD 방식)의 참가자입니다. 당신은 "${seat.labelKo}"입니다. 다른 좌석들이 이미 발언했고, 그들의 입장과 진행자 요약이 맥락에 있습니다. 좌석 이름으로 그들을 부르십시오.

${FESTIVAL_TRUTH_SEEKING_DIRECTIVE}

${identityBlock(seat)}

반드시 첫 줄에 당신의 행동을 선언하십시오:
"ACTION: AGREE" | "ACTION: CHALLENGE" | "ACTION: SUPPLEMENT" | "ACTION: REFRAME"
- AGREE: 형성 중인 합의를 지지(무엇이 당신을 설득했는지 정확히).
- CHALLENGE: 특정 주장을 공격(인용/요약 후 반박).
- SUPPLEMENT: 실질적으로 새로운 논거·근거·차원을 추가.
- REFRAME: 질문 자체의 접근이 틀렸다고 보고 더 나은 프레임을 제안.

데이터와 당신 렌즈에서 정직하게 판단하되, 자기 근거에는 끈질기게 — 맥락에 진짜 더 강한 논거가 없으면 이전 입장을 버리지 말고, 바꾼다면 무엇이 마음을 바꿨는지 명시하십시오. 근거 없이 다수로 표류하면 실패입니다.
${SINGLE_TURN_RULE}
${lateBlock}
${voiceRules(true)}

${styleBlock(true)}

${OUTPUT_TAIL_RULE}

${FESTIVAL_KOREAN_ONLY_DIRECTIVE}`
}

/** Facilitator system prompt. */
export function facilitatorSystemPrompt(): string {
  return `${FESTIVAL_FACILITATOR_SYSTEM}

${FESTIVAL_KOREAN_ONLY_DIRECTIVE}
참고: 이 언어 규칙은 JSON의 문자열 값(각 "point"·"issue"·"stance"·"nextDirective")에 적용됩니다. JSON 필드 이름은 위 스키마대로 영어 그대로 두십시오.`
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory / rendering builders (copied + adapted) — PURE
// ─────────────────────────────────────────────────────────────────────────────

function renderSummaryFull(s: FestivalFacilitatorSummary): string {
  const lines: string[] = []
  lines.push(`라운드 ${s.roundNumber} 진행자 요약 — 수렴 점수 ${s.roundConsensusScore}/100`)
  if (s.consensusPoints.length) {
    lines.push('합의 지점:')
    for (const cp of s.consensusPoints) {
      const by = cp.agreedBy.join(', ') || '미상'
      lines.push(`  - ${cp.point} (동의: ${by})`)
    }
  } else {
    lines.push('합의 지점: 아직 없음.')
  }
  if (s.openIssues.length) {
    lines.push('미해결 쟁점:')
    for (const oi of s.openIssues) {
      lines.push(`  - ${oi.issue}`)
      for (const p of oi.positions) lines.push(`      • ${p.ai}: ${p.stance}`)
    }
  } else {
    lines.push('미해결 쟁점: 없음.')
  }
  lines.push(`다음 초점: ${s.nextDirective}`)
  return lines.join('\n')
}

function renderSummaryOneLine(s: FestivalFacilitatorSummary): string {
  const headlines = s.consensusPoints.map((cp) => cp.point).join('; ') || '(기록된 합의 없음)'
  return `라운드 ${s.roundNumber} (점수 ${s.roundConsensusScore}/100): ${headlines}`
}

function renderTurn(t: FestivalTurn): string {
  const tags: string[] = []
  if (t.isRedTeam) tags.push('스트레스테스트')
  if (t.actionTag) tags.push(t.actionTag)
  const tagStr = tags.length ? ` (${tags.join(' · ')})` : ''
  const head = `[${t.seatLabel}${tagStr}]`
  const claimLine = t.claim ? `\n핵심주장: ${t.claim}` : ''
  return `${head}${claimLine}\n${t.content.trim()}`
}

/**
 * Context injected into each seat's turn prompt: latest facilitator summary in
 * full, older summaries one line each, and this round's turns so far (serial).
 */
export function buildDeliberationContext(params: {
  question: string
  priorSummaries: FestivalFacilitatorSummary[]
  currentRoundTurns: FestivalTurn[]
}): string {
  const { question, priorSummaries, currentRoundTurns } = params
  const sorted = [...priorSummaries].sort((a, b) => a.roundNumber - b.roundNumber)
  const sections: string[] = []
  sections.push(`심의 안건:\n${question.trim()}`)

  if (sorted.length) {
    const historyLines: string[] = [
      '심의 이력(토큰 절약을 위해 이전 라운드는 한 줄, 최신 진행자 요약만 전문 표시):',
      '',
    ]
    const older = sorted.slice(0, -1)
    for (const s of older) historyLines.push(renderSummaryOneLine(s))
    const latest = sorted[sorted.length - 1]!
    if (older.length) historyLines.push('')
    historyLines.push(renderSummaryFull(latest))
    sections.push(historyLines.join('\n'))
  } else {
    sections.push('심의 이력:\n(첫 라운드 — 이전 요약 없음.)')
  }

  if (currentRoundTurns.length) {
    const turnLines = ['이번 라운드 현재까지(순차 — 이미 나온 발언을 읽고 반응하십시오):']
    for (const t of currentRoundTurns) {
      turnLines.push('')
      turnLines.push(renderTurn(t))
    }
    sections.push(turnLines.join('\n'))
  } else {
    sections.push('이번 라운드 현재까지:\n(당신이 이번 라운드 첫 발언자입니다.)')
  }

  return sections.join('\n\n')
}

/** Builds the input the facilitator reads to summarize `roundNumber`. */
export function buildFacilitatorInput(params: {
  question: string
  roundNumber: number
  allTurnsThisRound: FestivalTurn[]
  priorSummaries: FestivalFacilitatorSummary[]
}): string {
  const { question, roundNumber, allTurnsThisRound, priorSummaries } = params
  const sections: string[] = []
  sections.push(`심의 안건:\n${question.trim()}`)

  const sorted = [...priorSummaries].sort((a, b) => a.roundNumber - b.roundNumber)
  if (sorted.length) {
    const recap = sorted.map((s) => `라운드 ${s.roundNumber}: 수렴 점수 ${s.roundConsensusScore}/100`).join('\n')
    sections.push(`이전 라운드(점수 요약만):\n${recap}`)
  } else {
    sections.push('이전 라운드(점수 요약만):\n(없음 — 이번이 라운드 1.)')
  }

  const turnLines = [`라운드 ${roundNumber} — 전체 발언(전문, 이것을 요약하십시오):`]
  for (const t of allTurnsThisRound) {
    turnLines.push('')
    turnLines.push(renderTurn(t))
  }
  sections.push(turnLines.join('\n'))

  sections.push(
    [
      '작업:',
      '이 라운드의 FacilitatorSummary를 생성하십시오: consensusPoints(누가 동의했는지 포함),',
      'openIssues(각 좌석의 입장), roundConsensusScore(0–100), 그리고 다음 라운드를 위한 nextDirective.',
      '',
      '점수 지침: roundConsensusScore는 축제 흥행·추진 "방향"에 대한 수렴도를 반영합니다 —',
      '모든 실행 세부가 정리됐는지가 아닙니다. 방향에 합의하되 우선순위·전제가 갈리면 점수를 높게 두고',
      '그것들을 남은 과제로 나열하십시오. 방향 자체(유망 vs 위험)가 갈릴 때만 점수를 낮추십시오.',
    ].join('\n')
  )

  return sections.join('\n\n')
}
