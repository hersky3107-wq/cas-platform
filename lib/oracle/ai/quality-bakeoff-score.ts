/**
 * Mechanical quality scoring for oracle layer-1 bakeoff.
 * No LLM judging — string/lexicon matching only.
 */

export type BakeoffRunRow = {
  brand: string
  run: number
  narrative: string
  one_line: string
  direction: string | null
  focus: string | null
  axis_emphasis: string[]
  contentTokens: number | null
  ms: number
  costUsd: number | null
  parsed: boolean
}

export type BrandScore = {
  brand: string
  groundingCount: number
  groundingMatches: string[]
  fabrications: string[]
  /** Raw machine codes found in narrative/one_line (dotted paths / snake_case). */
  machineCodeLeaks: string[]
  /** True when any leak was found — disqualifies from a reader seat. */
  disqualified: boolean
  genericShare: number
  localeOk: boolean
  oneLineBudgetOk: boolean
  directionConsistent: boolean
  focusConsistent: boolean
  /** null when payload has no phase tie; else whether narrative reported the tie. */
  tieHandled: boolean | null
  lengthChars: [number, number]
  costUsdTotal: number
}

const ELEMENT_KO: Record<string, string[]> = {
  wood: ['wood', '목', '木'],
  fire: ['fire', '화', '火'],
  earth: ['earth', '토', '土'],
  metal: ['metal', '금', '金'],
  water: ['water', '수', '水'],
}

const TRAIT_KO: Record<string, string[]> = {
  drive: ['drive', '추진', '추진력'],
  stability: ['stability', '안정', '안정성'],
  relation: ['relation', '관계', '대인'],
  control: ['control', '통제', '조율'],
  exploration: ['exploration', '탐색', '개방'],
  reflection: ['reflection', '성찰', '내면'],
}

const TEN_GOD_NAMES = [
  '비견',
  '겁재',
  '식신',
  '상관',
  '편재',
  '정재',
  '편관',
  '정관',
  '편인',
  '정인',
] as const

const TEN_GOD_GROUPS_KO = ['비겁', '식상', '재성', '관성', '인성'] as const

const STEMS_HANJA = '甲乙丙丁戊己庚辛壬癸'.split('')
const BRANCHES_HANJA = '子丑寅卯辰巳午未申酉戌亥'.split('')
const BRANCH_ANIMALS = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'] as const

const PILLAR_TERMS = ['년주', '월주', '일주', '시주', '대운', '세운', '월운', '일운'] as const

const TIE_MARKERS =
  /균등|반반|동률|동점|팽팽|균형|양립|50\s*[:：]\s*50|50\s*대\s*50|tie|tied|deadlock|stalemate|둘\s*다|양쪽|전진과\s*유지|유지와\s*전진|advance\s*(?:and|&|\/)\s*hold|hold\s*(?:and|&|\/)\s*advance/i

const DOTTED_CODE_RE = /\b[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+\b/g
const SNAKE_CODE_RE = /\b[a-z]+(?:_[a-z0-9]+)+\b/g

/** Axis keys allowed as human vocabulary; not counted as leakage. */
const ALLOWED_AXIS_WORDS = new Set([
  'drive',
  'stability',
  'relation',
  'control',
  'exploration',
  'reflection',
  'wood',
  'fire',
  'earth',
  'metal',
  'water',
  'advance',
  'hold',
  'release',
  'work',
  'money',
  'love',
  'social',
  'energy',
  'traits',
  'elements',
  'phase',
  'saju',
  'astro',
  'tarot',
  'ziwei',
  'iching',
  'prism',
])

function collectLabels(payload: Record<string, unknown>): Set<string> {
  const labels = new Set<string>()
  const walk = (value: unknown): void => {
    if (value == null) return
    if (typeof value === 'string') return
    if (Array.isArray(value)) {
      // Parallel labels arrays are string[]; collect those from a parent key check below
      value.forEach(walk)
      return
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>
      if (typeof record.label === 'string' && record.label.trim()) labels.add(record.label.trim())
      // Compact payload: top-level or nested `labels: { traits: string[], ... }`
      if (record.labels && typeof record.labels === 'object') {
        for (const arr of Object.values(record.labels as Record<string, unknown>)) {
          if (Array.isArray(arr)) {
            for (const item of arr) {
              if (typeof item === 'string' && item.trim()) labels.add(item.trim())
            }
          }
        }
      }
      for (const nested of Object.values(record)) walk(nested)
    }
  }
  walk(payload)
  // Also accept top-level labels when walk started from payload root
  const top = payload.labels
  if (top && typeof top === 'object') {
    for (const arr of Object.values(top as Record<string, unknown>)) {
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (typeof item === 'string' && item.trim()) labels.add(item.trim())
        }
      }
    }
  }
  return labels
}

function collectMachineCodes(payload: Record<string, unknown>): Set<string> {
  const codes = new Set<string>()
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.includes('.') || value.includes('_')) codes.add(value)
      return
    }
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      if (typeof record.code === 'string') codes.add(record.code)
      for (const nested of Object.values(record)) walk(nested)
    }
  }
  walk(payload)
  return codes
}

function flattenPayloadValues(payload: Record<string, unknown>): Set<string> {
  const out = new Set<string>()
  const walk = (value: unknown): void => {
    if (value == null) return
    if (typeof value === 'string') {
      out.add(value)
      return
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      out.add(String(value))
      out.add(value.toFixed(0))
      out.add(value.toFixed(1))
      return
    }
    if (typeof value === 'boolean') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (typeof value === 'object') {
      for (const nested of Object.values(value as Record<string, unknown>)) walk(nested)
    }
  }
  walk(payload)
  return out
}

/** Human-facing tokens used for grounding (labels, numbers, locale aliases). Not raw codes. */
function payloadGroundingTokens(payload: Record<string, unknown>): Set<string> {
  const tokens = new Set<string>()
  for (const label of collectLabels(payload)) tokens.add(label)
  for (const value of flattenPayloadValues(payload)) {
    if (/^\d+(?:\.\d+)?$/.test(value)) tokens.add(value)
  }

  const phase = payload.phase as Record<string, number> | null | undefined
  const elements = payload.elements as Record<string, number> | null | undefined
  const traits = payload.traits as Record<string, number> | null | undefined

  for (const [axis, labels] of Object.entries(ELEMENT_KO)) {
    if (elements && axis in elements) for (const label of labels) tokens.add(label)
  }
  for (const [axis, labels] of Object.entries(TRAIT_KO)) {
    if (traits && axis in traits) for (const label of labels) tokens.add(label)
  }
  if (phase) {
    for (const axis of Object.keys(phase)) tokens.add(axis)
  }

  // Synonyms for common labelled ten-god groups
  for (const label of collectLabels(payload)) {
    if (label === '비견') tokens.add('비겁')
  }

  return tokens
}

function payloadAllowedTerms(payload: Record<string, unknown>): Set<string> {
  const allowed = payloadGroundingTokens(payload)
  for (const code of collectMachineCodes(payload)) {
    allowed.add(code)
    for (const part of code.split(/[._]/)) {
      if (part.length >= 2) allowed.add(part)
    }
  }
  for (const label of collectLabels(payload)) {
    if (label.includes('대운')) allowed.add('대운')
    if (label.includes('세운')) allowed.add('세운')
  }
  return allowed
}

function containsStandaloneTerm(text: string, term: string): boolean {
  if (term.length < 1) return false
  if (/^[\u4e00-\u9fff]$/.test(term)) return text.includes(term)
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const particle = /[\uAC00-\uD7A3]/.test(term) ? '(?:[은는이가을를의와과도]?)?' : ''
  return new RegExp(`(?<![\\uAC00-\\uD7A3A-Za-z0-9])${escaped}${particle}(?![\\uAC00-\\uD7A3A-Za-z0-9])`, 'u').test(
    text,
  )
}

export function scoreGrounding(
  narrative: string,
  payload: Record<string, unknown>,
): { count: number; matches: string[] } {
  const tokens = payloadGroundingTokens(payload)
  const matches: string[] = []
  for (const token of tokens) {
    if (containsStandaloneTerm(narrative, token) || (token.length >= 2 && narrative.includes(token))) {
      matches.push(token)
    }
  }
  return { count: matches.length, matches: [...new Set(matches)].sort() }
}

/**
 * Numbers that count as payload evidence for fabrication checks.
 * Includes numeric JSON values AND digits embedded in label strings
 * (e.g. numerology "개인년 8" / "personal year 8" — the year lives in the
 * label, not as a bare number field).
 */
function payloadNumbers(payload: Record<string, unknown>): number[] {
  const nums: number[] = []
  const walk = (value: unknown): void => {
    if (typeof value === 'number' && Number.isFinite(value)) nums.push(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') {
      for (const nested of Object.values(value as Record<string, unknown>)) walk(nested)
    }
  }
  walk(payload)
  for (const label of collectLabels(payload)) {
    for (const raw of label.match(/\d{1,3}(?:\.\d+)?/g) ?? []) {
      const n = Number.parseFloat(raw)
      if (Number.isFinite(n)) nums.push(n)
    }
  }
  return nums
}

function numberInPayload(num: number, payloadNums: number[]): boolean {
  return payloadNums.some((p) => Math.abs(p - num) <= 1 || Math.abs(p - num) <= Math.max(1, p * 0.05))
}

export function detectFabrications(narrative: string, payload: Record<string, unknown>): string[] {
  const allowed = payloadAllowedTerms(payload)
  const found: string[] = []

  const checkTerm = (term: string, label: string): void => {
    if (!containsStandaloneTerm(narrative, term)) return
    for (const alias of allowed) {
      if (alias.includes(term) || term.includes(alias)) return
    }
    found.push(label)
  }

  for (const name of TEN_GOD_NAMES) checkTerm(name, `ten_god:${name}`)
  for (const group of TEN_GOD_GROUPS_KO) checkTerm(group, `tengod_group:${group}`)
  for (const stem of STEMS_HANJA) checkTerm(stem, `stem:${stem}`)
  for (const branch of BRANCHES_HANJA) checkTerm(branch, `branch:${branch}`)
  for (const pillar of PILLAR_TERMS) checkTerm(pillar, `pillar:${pillar}`)
  for (const animal of BRANCH_ANIMALS) checkTerm(animal, `animal:${animal}`)

  const ganzhiRe = /[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]/g
  for (const match of narrative.match(ganzhiRe) ?? []) {
    if (!allowed.has(match)) found.push(`ganzhi:${match}`)
  }

  const numRe = /\d{1,3}(?:\.\d+)?%?/g
  const payloadNums = payloadNumbers(payload)
  for (const raw of narrative.match(numRe) ?? []) {
    const num = Number.parseFloat(raw.replace('%', ''))
    if (!Number.isFinite(num)) continue
    if (!numberInPayload(num, payloadNums)) found.push(`number:${raw}`)
  }

  return [...new Set(found)]
}

/** Count raw machine codes leaked into user-facing prose. */
export function detectMachineCodeLeaks(text: string, payload: Record<string, unknown>): string[] {
  const known = collectMachineCodes(payload)
  const found: string[] = []

  for (const match of text.match(DOTTED_CODE_RE) ?? []) {
    if (ALLOWED_AXIS_WORDS.has(match)) continue
    found.push(match)
  }
  for (const match of text.match(SNAKE_CODE_RE) ?? []) {
    if (ALLOWED_AXIS_WORDS.has(match)) continue
    // Only count snake_case that appears in payload codes or looks like a reason key
    const inPayload = [...known].some((code) => code === match || code.endsWith(`.${match}`) || code.includes(match))
    if (inPayload || /_(dominant|pillars|sewoon|daewoon|reflected|matrix)/.test(match)) {
      found.push(match)
    }
  }
  return [...new Set(found)]
}

export function phaseHasTie(payload: Record<string, unknown>): boolean {
  const phase = payload.phase
  if (!phase || typeof phase !== 'object') return false
  const values = Object.values(phase as Record<string, number>).filter((n) => typeof n === 'number')
  if (values.length < 2) return false
  const max = Math.max(...values)
  return values.filter((n) => n === max).length >= 2 && max > 0
}

export function narrativeReportsTie(narrative: string): boolean {
  return TIE_MARKERS.test(narrative)
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。])\s+|[\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
}

export function genericSentenceShare(narrative: string, payload: Record<string, unknown>): number {
  const sentences = splitSentences(narrative)
  if (sentences.length === 0) return 1
  const tokens = payloadGroundingTokens(payload)
  let generic = 0
  for (const sentence of sentences) {
    let grounded = false
    for (const token of tokens) {
      if (containsStandaloneTerm(sentence, token) || (token.length >= 2 && sentence.includes(token))) {
        grounded = true
        break
      }
    }
    if (!grounded) generic += 1
  }
  return generic / sentences.length
}

const LOCALE_EN_TOKENS =
  /\b(advance|hold|release|work|money|love|social|energy|drive|stability|relation|control|exploration|reflection|wood|fire|earth|metal|water|peer|output|wealth|officer|resource|saju|tarot)\b/gi

export function isMostlyKorean(text: string): boolean {
  const stripped = text.replace(LOCALE_EN_TOKENS, '')
  const hangul = (stripped.match(/[\uAC00-\uD7A3]/g) ?? []).length
  const letters = (stripped.match(/[A-Za-z\uAC00-\uD7A3]/g) ?? []).length
  if (hangul >= 20) return true
  if (letters === 0) return hangul > 0
  return hangul / letters >= 0.55
}

export function scoreBrand(
  brand: string,
  runs: BakeoffRunRow[],
  payload: Record<string, unknown>,
): BrandScore {
  const brandRuns = runs.filter((r) => r.brand === brand)
  const parsed = brandRuns.filter((r) => r.parsed && r.narrative.length > 0)

  const groundingMatches = new Set<string>()
  for (const run of parsed) {
    for (const match of scoreGrounding(run.narrative, payload).matches) groundingMatches.add(match)
  }

  const fabrications = [
    ...new Set(parsed.flatMap((r) => detectFabrications(r.narrative, payload))),
  ].sort()

  const machineCodeLeaks = [
    ...new Set(
      parsed.flatMap((r) => [
        ...detectMachineCodeLeaks(r.narrative, payload),
        ...detectMachineCodeLeaks(r.one_line, payload),
      ]),
    ),
  ].sort()

  const genericShares = parsed.map((r) => genericSentenceShare(r.narrative, payload))
  const genericShare =
    genericShares.length > 0 ? genericShares.reduce((a, b) => a + b, 0) / genericShares.length : 1

  const localeOk = parsed.every((r) => isMostlyKorean(r.narrative))
  const oneLineBudgetOk = parsed.every((r) => r.one_line.length <= 80)

  const directions = parsed.map((r) => r.direction).filter(Boolean)
  const focuses = parsed.map((r) => r.focus).filter(Boolean)
  const directionConsistent = directions.length === 2 && directions[0] === directions[1]
  const focusConsistent = focuses.length === 2 && focuses[0] === focuses[1]

  const tied = phaseHasTie(payload)
  const tieHandled = tied
    ? parsed.length > 0 && parsed.every((r) => narrativeReportsTie(r.narrative))
    : null

  const lengthChars: [number, number] = [
    parsed[0]?.narrative.length ?? 0,
    parsed[1]?.narrative.length ?? 0,
  ]

  const costUsdTotal = brandRuns.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)

  return {
    brand,
    groundingCount: groundingMatches.size,
    groundingMatches: [...groundingMatches].sort(),
    fabrications,
    machineCodeLeaks,
    disqualified: machineCodeLeaks.length > 0,
    genericShare,
    localeOk,
    oneLineBudgetOk,
    directionConsistent,
    focusConsistent,
    tieHandled,
    lengthChars,
    costUsdTotal,
  }
}

/** Eligible brands first (no leakage), then by fabrication ↑, grounding ↓. */
export function rankBrands(scores: BrandScore[]): BrandScore[] {
  return [...scores].sort((a, b) => {
    if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1
    if (a.fabrications.length !== b.fabrications.length) {
      return a.fabrications.length - b.fabrications.length
    }
    if (a.machineCodeLeaks.length !== b.machineCodeLeaks.length) {
      return a.machineCodeLeaks.length - b.machineCodeLeaks.length
    }
    if (a.groundingCount !== b.groundingCount) {
      return b.groundingCount - a.groundingCount
    }
    return a.brand.localeCompare(b.brand)
  })
}
