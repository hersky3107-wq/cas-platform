/**
 * 억부법 용신 — 일간 강약 (득령·득지·득세) then 용신/희신/기신.
 *
 * 십신 still label branches by 地支本氣. 통근 uses `HIDDEN_STEMS` (자평 배장).
 * 조후 / 병약 / 통관 are not implemented: 인월 갑목 신강 is 억부 용신 화 but
 * 조후 봄 목왕 would pick 금; 병약/통관 pick a 通關 오행 억부 never would.
 * Those schools conflict with this pass — we do not mix.
 *
 * Threshold (total = 득령 + 득지 + 득세), chosen so textbook 己卯월 무근
 * stays 신약 and 월령-only isolation stays 중화 rather than 신강:
 *   신약 ≤ 2 | 중화 3–4 | 신강 ≥ 5
 * 득령 왕=3 is the heaviest single factor but not enough alone (고립 월령).
 *
 * Source disagreements (this file picks one and does not blend):
 *   · 午 중기 己 — 자평 배장 keeps 己; some Korean primers list 午 as 丙·丁 only.
 *   · 신강 용신 — 설기 식상 first; some schools lead with 관성.
 *   · 토 통근 — 일간 천간이 지장간에 있어야 함 (戊 ≠ 己). 辰戌丑未 전부 토근
 *     으로 세는 느슨한 법과는 다름.
 *   · 종격 — 한 오행이 글자의 절반 이상이고 2 이상 앞설 때만 판정불가. Cutoff
 *     varies by primer; a wrong 용신 is worse than none.
 */
import { fiveElementBalance } from './five-elements'
import { HIDDEN_STEMS, STEMS, producedBy } from './tables'
import type {
  EokbuHelper,
  EokbuPillarKey,
  EokbuResult,
  EokbuRoot,
  EokbuRootRole,
  EokbuStrength,
  FiveElement,
  FourPillars,
  Pillar,
  StemInfo,
} from './types'

const PILLAR_ORDER: EokbuPillarKey[] = ['year', 'month', 'day', 'hour']
const ELEMENT_CYCLE: FiveElement[] = ['wood', 'fire', 'earth', 'metal', 'water']

const WEAK_MAX = 2
const STRONG_MIN = 5

function producerOf(element: FiveElement): FiveElement {
  const i = ELEMENT_CYCLE.indexOf(element)
  return ELEMENT_CYCLE[(i + 4) % 5]!
}

function outputOf(element: FiveElement): FiveElement {
  return producedBy(element)
}

function wealthOf(element: FiveElement): FiveElement {
  const i = ELEMENT_CYCLE.indexOf(element)
  return ELEMENT_CYCLE[(i + 2) % 5]!
}

function supportsDay(helper: FiveElement, day: FiveElement): boolean {
  return helper === day || producedBy(helper) === day
}

function hiddenOf(branchIndex: number) {
  return HIDDEN_STEMS[branchIndex] ?? []
}

function principalStem(branchIndex: number): StemInfo {
  const hidden = hiddenOf(branchIndex)
  const ben = hidden.find((h) => h.role === 'ben') ?? hidden[hidden.length - 1]!
  return STEMS[ben.stemIndex]!
}

function strongestRole(roles: EokbuRootRole[]): EokbuRootRole {
  if (roles.includes('ben')) return 'ben'
  if (roles.includes('zhong')) return 'zhong'
  return 'yu'
}

function pillarOf(pillars: FourPillars, key: EokbuPillarKey): Pillar | null {
  if (key === 'hour') return pillars.hour
  return pillars[key]
}

function deukryeongOf(day: FiveElement, month: Pillar): EokbuResult['deukryeong'] {
  const monthEl = month.branch.element
  const wang = monthEl === day
  const sheng = producedBy(monthEl) === day
  return {
    has: wang || sheng,
    score: wang ? 3 : sheng ? 2 : 0,
    relation: wang ? 'wang' : sheng ? 'sheng' : 'none',
    monthBranchHanja: month.branch.hanja,
  }
}

function deukjiOf(dayStem: StemInfo, pillars: FourPillars): EokbuResult['deukji'] {
  const roots: EokbuRoot[] = []
  for (const key of PILLAR_ORDER) {
    const pillar = pillarOf(pillars, key)
    if (!pillar) continue
    const roles = hiddenOf(pillar.branch.index)
      .filter((h) => h.stemIndex === dayStem.index)
      .map((h) => h.role)
    if (roles.length === 0) continue
    roots.push({ pillar: key, branchHanja: pillar.branch.hanja, role: strongestRole(roles) })
  }
  return { score: roots.length, roots }
}

function deukseOf(day: FiveElement, pillars: FourPillars): EokbuResult['deukse'] {
  const helpers: EokbuHelper[] = []
  const countedHanja = new Set<string>()

  for (const key of ['year', 'month', 'hour'] as const) {
    const pillar = pillarOf(pillars, key)
    if (!pillar) continue
    if (!supportsDay(pillar.stem.element, day)) continue
    helpers.push({ kind: 'stem', pillar: key, hanja: pillar.stem.hanja })
    countedHanja.add(pillar.stem.hanja)
  }

  for (const key of ['year', 'day', 'hour'] as const) {
    const pillar = pillarOf(pillars, key)
    if (!pillar) continue
    const ben = principalStem(pillar.branch.index)
    if (!supportsDay(ben.element, day)) continue
    if (countedHanja.has(ben.hanja)) continue
    helpers.push({ kind: 'benqi', pillar: key, hanja: ben.hanja })
    countedHanja.add(ben.hanja)
  }

  return { score: helpers.length, helpers }
}

function dominantElement(pillars: FourPillars): { element: FiveElement; count: number; second: number; chars: number } {
  const counts = fiveElementBalance(pillars)
  const chars = (['wood', 'fire', 'earth', 'metal', 'water'] as const)
    .map((element) => ({ element, count: counts[element] }))
    .sort((a, b) => b.count - a.count)
  const charsTotal = Object.values(counts).reduce((sum, n) => sum + n, 0)
  return { element: chars[0]!.element, count: chars[0]!.count, second: chars[1]?.count ?? 0, chars: charsTotal }
}

function isJonggyeok(pillars: FourPillars): EokbuResult['inapplicable'] {
  const { element, count, second, chars } = dominantElement(pillars)
  if (count >= Math.ceil(chars / 2) && count - second >= 2) {
    return { code: 'jonggyeok_dominant', element, count, chars }
  }
  return null
}

function labelOf(total: number): EokbuStrength {
  if (total <= WEAK_MAX) return 'weak'
  if (total >= STRONG_MIN) return 'strong'
  return 'balanced'
}

function yongsinSet(
  strength: EokbuStrength,
  day: FiveElement,
): { yongsin: FiveElement; huisin: FiveElement; gisin: FiveElement } {
  // 억부 직결만. 신약: 용신=인성, 희신=비겁, 기신=재성.
  // 신강: 용신=식상 (설기), 희신=재성, 기신=인성. 관성 우선 파는 다른 학교.
  if (strength === 'weak') {
    return { yongsin: producerOf(day), huisin: day, gisin: wealthOf(day) }
  }
  return { yongsin: outputOf(day), huisin: wealthOf(day), gisin: producerOf(day) }
}

export function eokbu(pillars: FourPillars): EokbuResult {
  const dayStem = pillars.day.stem
  const day = dayStem.element
  const deukryeong = deukryeongOf(day, pillars.month)
  const deukji = deukjiOf(dayStem, pillars)
  const deukse = deukseOf(day, pillars)
  const total = deukryeong.score + deukji.score + deukse.score
  const hourUnknown = pillars.hourUnknown || pillars.hour === null
  const jong = isJonggyeok(pillars)

  if (jong) {
    return {
      school: 'eokbu',
      strength: null,
      deukryeong,
      deukji,
      deukse,
      total,
      yongsin: null,
      huisin: null,
      gisin: null,
      inapplicable: jong,
      hourUnknown,
    }
  }

  const strength = labelOf(total)
  const gods = strength === 'balanced' ? null : yongsinSet(strength, day)
  return {
    school: 'eokbu',
    strength,
    deukryeong,
    deukji,
    deukse,
    total,
    yongsin: gods?.yongsin ?? null,
    huisin: gods?.huisin ?? null,
    gisin: gods?.gisin ?? null,
    inapplicable: null,
    hourUnknown,
  }
}

export const EOKBU_THRESHOLD = { weakMax: WEAK_MAX, strongMin: STRONG_MIN } as const
