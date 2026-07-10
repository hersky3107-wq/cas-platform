/**
 * Fuzzy cross-reference: Perplexity-found clinic names → HIRA fact list.
 * Lenient matching to attach verified phone/address, but never when ambiguous.
 */

import type { MedicalFacility } from '@/lib/care/hira'

const CORP_MARKERS =
  /의료법인|사회복지법인|재단법인|학교법인|주식회사|\(주\)|㈜|재단/gi

/** Longest-first so e.g. 치과의원 strips before 의원. */
const NAME_SUFFIXES = [
  '상급종합병원',
  '종합병원',
  '대학병원',
  '요양병원',
  '치과의원',
  '한의원',
  '병원',
  '의원',
  '클리닉',
  'clinic',
  '약국',
  '의료원',
  '메디칼',
  '센터',
]

/** Minimum score to consider a candidate at all. */
const MIN_SCORE = 220
/** If the runner-up is within this fraction of the top score → ambiguous. */
const AMBIGUITY_RATIO = 0.88
/** Absolute score gap below which we treat top two as tied. */
const AMBIGUITY_GAP = 35

/** Strip corporate noise, parens, whitespace/punctuation, and generic suffixes. */
export function coreName(s: string): string {
  let t = s
    .replace(/\([^)]*\)/g, '')
    .replace(/（[^）]*）/g, '')
    .replace(/[\s·,.\-_/\\'"`]+/g, '')
    .toLowerCase()

  for (let i = 0; i < 4; i++) {
    const before = t
    t = t.replace(CORP_MARKERS, '')
    t = t.replace(/^(the|dr|doctor)/i, '')
    if (t === before) break
  }

  for (const suf of NAME_SUFFIXES) {
    if (t.endsWith(suf.toLowerCase())) {
      t = t.slice(0, -suf.length)
      break
    }
  }

  return t
}

/** Hangul / alphanumeric runs of 2+ chars for distinctive-token matching. */
function distinctiveTokens(name: string): string[] {
  const core = coreName(name)
  const runs = core.match(/[가-힣a-z0-9]{2,}/gi) ?? []
  const out = new Set<string>()
  for (const r of runs) {
    const t = r.toLowerCase()
    if (t.length >= 2) out.add(t)
  }
  if (core.length >= 2) out.add(core)
  return [...out].sort((a, b) => b.length - a.length)
}

function longestCommonSubstring(a: string, b: string): string {
  if (!a || !b) return ''
  let best = ''
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++
      if (k > best.length) best = a.slice(i, i + k)
    }
  }
  return best
}

function areaBoost(areaHint: string | undefined, facility: MedicalFacility): number {
  if (!areaHint?.trim() || !facility.sgguCdNm) return 0
  const a = areaHint.trim().replace(/\s+/g, '')
  const s = facility.sgguCdNm.replace(/\s+/g, '')
  if (s.includes(a) || a.includes(s)) return 60
  // Partial dong/gu token, e.g. "종로" in "종로구"
  if (a.length >= 2 && s.startsWith(a.slice(0, 2))) return 25
  return 0
}

interface Scored {
  facility: MedicalFacility
  score: number
}

function scorePair(
  target: string,
  hc: string,
  queryName: string,
  facility: MedicalFacility,
  areaHint?: string
): number {
  if (target.length < 2 || hc.length < 2) return 0

  let score = 0

  if (target === hc) {
    score = 1000
  } else if (hc.includes(target)) {
    // Perplexity short name inside HIRA full name (e.g. "눈사랑" ⊂ "눈사랑안과")
    const overlap = target.length / hc.length
    score = 520 + target.length * 12 + overlap * 120
  } else if (target.includes(hc)) {
    // HIRA core inside longer Perplexity name
    const overlap = hc.length / target.length
    score = 480 + hc.length * 12 + overlap * 100
  } else {
    const lcs = longestCommonSubstring(target, hc)
    if (lcs.length >= 2) {
      const minLen = Math.min(target.length, hc.length)
      const ratio = lcs.length / minLen
      if (lcs.length >= 3 || ratio >= 0.55) {
        score = 240 + lcs.length * 18 + ratio * 80
      }
    }
  }

  // Distinctive token: e.g. "눈사랑" in query vs "눈사랑안과의원" in HIRA
  if (score < 500) {
    for (const tok of distinctiveTokens(queryName)) {
      if (tok.length < 2) continue
      if (hc.includes(tok) || target.includes(tok)) {
        const tokScore = 300 + tok.length * 15
        if (tok.length >= 3 || tok === target || tok === hc) {
          score = Math.max(score, tokScore)
        }
      }
    }
  }

  if (score > 0) score += areaBoost(areaHint, facility)
  return score
}

export interface FindInHiraOptions {
  /** 시·군·구 hint from Perplexity extraction — boosts same-area HIRA rows. */
  areaHint?: string
}

/**
 * Match a Perplexity-found name to one HIRA row, or null if none / ambiguous.
 * Never returns a guess when multiple hospitals score similarly.
 */
export function findInHira(
  queryName: string,
  hira: MedicalFacility[],
  opts: FindInHiraOptions = {}
): MedicalFacility | null {
  const target = coreName(queryName)
  if (target.length < 2) return null

  const scored: Scored[] = []
  for (const h of hira) {
    const hc = coreName(h.name)
    const s = scorePair(target, hc, queryName, h, opts.areaHint)
    if (s >= MIN_SCORE) scored.push({ facility: h, score: s })
  }

  if (scored.length === 0) return null

  scored.sort((a, b) => b.score - a.score)
  const top = scored[0]!
  const second = scored[1]

  if (second) {
    if (top.score === second.score) return null
    if (second.score >= top.score * AMBIGUITY_RATIO) return null
    if (top.score - second.score < AMBIGUITY_GAP) return null
  }

  // Short token-only matches must be clearly alone above threshold
  if (top.score < 400 && target.length < 3) {
    const rivals = scored.filter((c) => c.score >= MIN_SCORE && c !== top)
    if (rivals.length > 0) return null
  }

  return top.facility
}
