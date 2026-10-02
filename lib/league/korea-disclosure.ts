/**
 * Korea stock lane mandatory disclosures under the Capital Markets Act
 * (자본시장과 금융투자업에 관한 법률 — 유사투자자문업 규정).
 *
 * EXACT Korean copy — do not paraphrase, do not translate (the Korean lane is ko-only).
 * Placeholders stay literal and are filled by `fillDisclosure(text, vars)`.
 */

/** Pre-registration copy when `KR_ADVISORY_REG_NO` is unset (never show `{REG_NO}` / `{BIZ_NO}`). */
export const KR_DISCLOSURE_PRE_REGISTRATION = Object.freeze({
  laneBanner:
    'PRAY(아이마니)는 유사투자자문업 신고 절차를 진행 중이며, 투자자문업·투자일임업 등록을 한 정식 금융투자업자가 아닙니다. 개별적인 투자상담과 자금운용은 불가능합니다. 모든 투자에는 원금손실 가능성이 있으며, 투자 결과와 손실은 투자자 본인에게 귀속됩니다.',
  laneBannerReg: '유사투자자문업 신고번호는 신고 수리 후 표시됩니다.',
} as const)

export const KR_DISCLOSURE = Object.freeze({
  laneBanner:
    'PRAY(아이마니)는 금융위원회에 신고한 유사투자자문업자이며, 투자자문업·투자일임업 등록을 한 정식 금융투자업자가 아닙니다. 개별적인 투자상담과 자금운용은 불가능합니다. 모든 투자에는 원금손실 가능성이 있으며, 투자 결과와 손실은 투자자 본인에게 귀속됩니다.',
  laneBannerReg:
    '유사투자자문업 신고번호 {REG_NO} · 신고 여부는 금융감독원 파인(fine.fss.or.kr)에서 확인할 수 있습니다.',
  card:
    '이 화면은 여러 AI 모델이 공개 정보를 바탕으로 생성한 예측을 모든 이용자에게 동일하게 제공하는 참고 자료이며, 특정인에 대한 투자 권유나 매수·매도 추천이 아닙니다. 예측은 틀릴 수 있고 원금손실 가능성이 있으며, 투자 판단과 결과의 책임은 투자자 본인에게 있습니다.',
  confidence:
    '확신도는 각 AI 모델이 스스로 밝힌 수치로, 실제 상승·하락 확률이나 수익을 보장하지 않습니다. 여러 AI의 의견이 한쪽으로 모여도 결과가 확실하다는 뜻은 아닙니다.',
  trackRecord:
    '적중 기록은 집계 시작일({START_DATE})부터 채점된 모든 라운드({N}건)를 기간 선별 없이 반영한 과거 결과이며, 미래의 적중이나 수익을 보장하지 않습니다. 적중률은 투자 수익률이 아닙니다.',
  generate:
    '종목과 기간만 선택할 수 있으며, 개인별 질문이나 상담은 받지 않습니다. 같은 종목·기간에는 모든 이용자에게 같은 예측이 제공됩니다.',
  deep:
    '이 분석은 채점되지 않는 AI 논평으로, 공개 정보를 요약·해석한 참고 자료입니다. 매수·매도 시점이나 가격을 제시하는 투자 권유가 아니며, 개별 투자상담을 대신하지 않습니다.',
  crowding:
    '수급 쏠림은 공개된 거래 통계에 나타난 패턴이며, 특정 주체의 시세조종이나 불공정거래를 의미하거나 단정하지 않습니다.',
  credits:
    '크레딧은 AI 분석 콘텐츠 이용 대가입니다. 예측 적중 여부와 관계없이 이용 요금은 같으며, 투자 손실을 보전하거나 수익을 보장하지 않습니다.',
  data:
    '가격·거래 데이터는 지연되거나 오류가 있을 수 있으며, 실제 거래 화면의 시세와 다를 수 있습니다.',
  footer:
    '상호 PRAY · 대표 허민재 · 사업자등록번호 {BIZ_NO} · 유사투자자문업 신고번호 {REG_NO}. 투자 관련 개별 문의에는 답변하지 않습니다.',
  usageNotice: Object.freeze([
    'AI 모델들의 예측 능력을 비교·기록하는 콘텐츠입니다.',
    '이 화면은 모든 이용자에게 같은 내용을 일방향으로 제공합니다. 채팅·댓글·질문 입력 기능이 없으며, 이용자와 개별적으로 연락하거나 소통하지 않습니다.',
    '투자 성향, 보유 종목, 자산 규모 등 개인의 투자 정보를 묻지 않으며, 이용자를 대신해 매매하거나 자금을 운용하지 않습니다.',
    '어떠한 경우에도 수익을 보장하거나 손실을 보전하지 않습니다. 적중 기록은 과거 결과이며 투자 수익률이 아닙니다.',
    'PRAY(아이마니)는 카카오톡·텔레그램·문자 등으로 종목을 추천하거나 유료 회원방을 운영하지 않습니다. 이를 사칭한 연락에 주의하세요.',
  ] as const),
} as const)

export type KrDisclosureKey = keyof typeof KR_DISCLOSURE

/**
 * Fills literal placeholders like `{REG_NO}` and `{BIZ_NO}`.
 * Placeholders with missing or empty values stay literal.
 */
export function fillDisclosure(
  text: string,
  vars?: Record<string, string | number | null | undefined>
): string {
  if (!vars) return text
  return text.replace(/\{([A-Z0-9_]+)\}/g, (match, key) => {
    const val = vars[key]
    return val !== undefined && val !== null && String(val).trim().length > 0
      ? String(val)
      : match
  })
}

/**
 * Registration gate: read env KR_ADVISORY_REG_NO and KR_BIZ_NO server-side only.
 * The Korean stock lane is public-ready only when the advisory registration number is present.
 */
export function isKrLanePublicReady(): boolean {
  if (typeof process === 'undefined') return false
  const regNo = process.env.KR_ADVISORY_REG_NO?.trim()
  return Boolean(regNo && regNo.length > 0)
}

export function getKrAdvisoryRegNo(): string {
  if (typeof process === 'undefined') return ''
  return process.env.KR_ADVISORY_REG_NO?.trim() ?? ''
}

export function getKrBizNo(): string {
  if (typeof process === 'undefined') return ''
  return process.env.KR_BIZ_NO?.trim() ?? ''
}

export function resolveKrLaneBanner(regNo?: string | null): { main: string; regLine: string } {
  const reg = regNo?.trim() ?? ''
  if (reg.length > 0) {
    return {
      main: KR_DISCLOSURE.laneBanner,
      regLine: fillDisclosure(KR_DISCLOSURE.laneBannerReg, { REG_NO: reg }),
    }
  }
  return {
    main: KR_DISCLOSURE_PRE_REGISTRATION.laneBanner,
    regLine: KR_DISCLOSURE_PRE_REGISTRATION.laneBannerReg,
  }
}

/**
 * Footer without literal `{REG_NO}` / `{BIZ_NO}` when values are missing.
 * When both are set, matches the registered `KR_DISCLOSURE.footer` template exactly.
 */
export function resolveKrLaneFooter(regNo?: string | null, bizNo?: string | null): string {
  const reg = regNo?.trim() ?? ''
  const biz = bizNo?.trim() ?? ''
  if (reg && biz) {
    return fillDisclosure(KR_DISCLOSURE.footer, { REG_NO: reg, BIZ_NO: biz })
  }
  let line = '상호 PRAY · 대표 허민재'
  if (biz) line += ` · 사업자등록번호 ${biz}`
  if (reg) line += ` · 유사투자자문업 신고번호 ${reg}`
  return `${line}. 투자 관련 개별 문의에는 답변하지 않습니다.`
}

/**
 * Track-record copy for Korean-lane leaderboard / record room.
 * Omits placeholder clauses when `startDate` or `n` is unknown.
 */
export function formatKrTrackRecord(vars: {
  startDate?: string | null
  n?: number | null
}): string {
  const start = vars.startDate?.trim() ?? ''
  const hasStart = start.length > 0
  const hasN = vars.n != null && Number.isFinite(vars.n)

  let middle: string
  if (hasStart && hasN) {
    middle = `집계 시작일(${start})부터 채점된 모든 라운드(${vars.n}건)를 기간 선별 없이 반영한 과거 결과`
  } else if (hasN) {
    middle = `채점된 모든 라운드(${vars.n}건)를 기간 선별 없이 반영한 과거 결과`
  } else if (hasStart) {
    middle = `집계 시작일(${start})부터 채점된 라운드를 기간 선별 없이 반영한 과거 결과`
  } else {
    middle = '채점된 라운드를 기간 선별 없이 반영한 과거 결과'
  }
  return `${middle}이며, 미래의 적중이나 수익을 보장하지 않습니다. 적중률은 투자 수익률이 아닙니다.`
}

/** Format ISO resolved/open date for track-record disclosure (YYYY-MM-DD). */
export function formatKrTrackRecordStartDate(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return d.toISOString().slice(0, 10)
  } catch {
    return null
  }
}

/** Earliest graded round date and graded-round count from a record-room page payload. */
export function trackRecordVarsFromRecordRoom(rounds: readonly { resolved_at: string; gradedCount: number }[]): {
  startDate: string | null
  n: number
} {
  let earliest: string | null = null
  let n = 0
  for (const row of rounds) {
    if (row.gradedCount <= 0) continue
    n += 1
    const start = formatKrTrackRecordStartDate(row.resolved_at)
    if (start && (!earliest || start < earliest)) earliest = start
  }
  return { startDate: earliest, n }
}
