/**
 * Welfare matching engine (region-agnostic) for the 동반자 (care) app.
 *
 * Reads the `care_welfare_services` table with region IN (userRegion, 'national'):
 *   - userRegion — the residence-derived slug (residence.welfareRegionKey), e.g.
 *     'seoul' / 'gyeonggi' / 'cheju'. Local-government welfare is stored per slug.
 *   - 'national' — central-government welfare (surfaces for everyone).
 */

import { supabaseAdmin } from '@/lib/supabase/server'

// ── Types ─────────────────────────────────────────────────────────────────────

export type WelfareProfile = {
  isElderly: boolean | null // 65세 이상
  hasDisability: boolean | null // 장애
  isLowIncome: boolean | null // 저소득
  livesAlone: boolean | null // 독거
  seeksJob: boolean | null // 일자리
  needsCare: boolean | null // 돌봄/간병
}

/** A row as stored in the care_welfare_services table. */
interface WelfareRow {
  id: number | string
  region: string
  source: string
  seq: string
  name: string | null
  support: string | null
  contents: string | null
  application: string | null
  all_loc: boolean | null
  province_loc: boolean | null
  seogwipo_loc: boolean | null
  target: string[] | null
  life_cycle: string | null
  situation: string[] | null
  min_age: number | null
  is_elderly_relevant: boolean | null
  one_line_summary: string | null
  eligibility_plain: string[] | null
  benefit_plain: string | null
  prepare_plain: string[] | null
  apply_where_plain: string | null
}

export interface WelfareMatch {
  seq: string
  name: string
  oneLineSummary: string | null
  target: string[]
  situation: string[]
  application: string | null
  contact: string | null
  /** Weighted relevance score (higher = more relevant). Useful for debugging/UX. */
  score: number
  /** Source identifier — e.g. 'local-d01' or 'national'. Useful for UI labelling. */
  source: string
  eligibilityPlain: string[]
  benefitPlain: string | null
  preparePlain: string[]
  applyWherePlain: string | null
}

// ── Contact extraction ─────────────────────────────────────────────────────────

const PHONE_RE = /(?:☎|전화|문의|연락처|번호)[^\d]{0,10}(\d{2,4}[-\s]?\d{3,4}[-\s]?\d{4})/g
const BARE_PHONE_RE = /(\d{2,3}[-\s]\d{3,4}[-\s]\d{4})/g
const OFFICE_RE =
  /([가-힣]{1,10}(?:행정복지센터|주민센터|읍사무소|면사무소|동사무소|보건소|복지관|군청|시청|도청))/g

/**
 * Extract a contact string (phone and/or office name) from free text.
 * Returns null when nothing is found — never invents a contact.
 */
function extractContact(text: string | null | undefined): string | null {
  if (!text) return null

  const phones = new Set<string>()
  let m: RegExpExecArray | null

  PHONE_RE.lastIndex = 0
  while ((m = PHONE_RE.exec(text)) !== null) {
    if (m[1]) phones.add(m[1].replace(/\s+/g, '-'))
  }
  BARE_PHONE_RE.lastIndex = 0
  while ((m = BARE_PHONE_RE.exec(text)) !== null) {
    if (m[1]) phones.add(m[1].replace(/\s+/g, '-'))
  }

  const offices = new Set<string>()
  OFFICE_RE.lastIndex = 0
  while ((m = OFFICE_RE.exec(text)) !== null) {
    if (m[1]) offices.add(m[1])
  }

  const parts: string[] = []
  if (offices.size > 0) parts.push(Array.from(offices).slice(0, 2).join(', '))
  if (phones.size > 0) parts.push(Array.from(phones).slice(0, 2).join(', '))

  return parts.length > 0 ? parts.join(' · ') : null
}

// ── Scoring ─────────────────────────────────────────────────────────────────────

const CHILD_STAGES = ['영유아', '아동', '청소년']

function mentions(row: WelfareRow, keywords: string[], fields: (keyof WelfareRow)[]): boolean {
  const haystack = fields
    .map((f) => (typeof row[f] === 'string' ? (row[f] as string) : ''))
    .join(' ')
    .toLowerCase()
  return keywords.some((k) => haystack.includes(k.toLowerCase()))
}

function scoreRow(profile: WelfareProfile, row: WelfareRow): number {
  const target = row.target ?? []
  const situation = row.situation ?? []
  let score = 0

  // isElderly
  if (profile.isElderly === true) {
    if (
      row.is_elderly_relevant === true ||
      target.includes('노인') ||
      (row.min_age != null && row.min_age <= 65)
    ) {
      score += 3
    }
  }

  // hasDisability
  if (profile.hasDisability === true && target.includes('장애인')) {
    score += 3
  }

  // isLowIncome
  if (profile.isLowIncome === true && target.includes('저소득')) {
    score += 2
  }

  // livesAlone → keyword match in name/support/contents
  if (
    profile.livesAlone === true &&
    mentions(row, ['독거', '홀로', '혼자'], ['name', 'support', 'contents'])
  ) {
    score += 2
  }

  // seeksJob
  if (profile.seeksJob === true && situation.includes('일자리')) {
    score += 2
  }

  // needsCare
  if (
    profile.needsCare === true &&
    (situation.includes('돌봄') ||
      situation.includes('의료비') ||
      mentions(row, ['간병', '돌봄', '요양'], ['name', 'support']))
  ) {
    score += 2
  }

  // Tie-breaker: bias slightly toward elderly-appropriate services.
  if (row.is_elderly_relevant === true) {
    score += 0.5
  }

  // Soft demotion: elderly user shouldn't see maternity/childcare services.
  if (
    profile.isElderly === true &&
    row.life_cycle != null &&
    CHILD_STAGES.includes(row.life_cycle) &&
    !target.includes('노인') &&
    !target.includes('장애인') &&
    !target.includes('저소득')
  ) {
    score -= 2
  }

  return score
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function matchWelfare(
  profile: WelfareProfile,
  region = 'national',
  limit = 8
): Promise<WelfareMatch[]> {
  let rows: WelfareRow[] = []

  try {
    const { data, error } = await supabaseAdmin
      .from('care_welfare_services')
      .select(
        'source, seq, name, support, contents, application, target, life_cycle, situation, min_age, is_elderly_relevant, one_line_summary, eligibility_plain, benefit_plain, prepare_plain, apply_where_plain'
      )
      .in('region', [region, 'national'])

    if (error) {
      throw new Error(`Supabase select error: ${error.message}`)
    }
    rows = (data ?? []) as unknown as WelfareRow[]
  } catch (e) {
    console.error('[matchWelfare] failed to read welfare rows:', e)
    throw e
  }

  const scored = rows
    .map((row) => ({ row, score: scoreRow(profile, row) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return scored.map(({ row, score }) => ({
    seq: row.seq,
    name: row.name ?? '',
    oneLineSummary: row.one_line_summary ?? null,
    target: row.target ?? [],
    situation: row.situation ?? [],
    application: row.application ?? null,
    contact: extractContact(row.application) ?? extractContact(row.support),
    score,
    source: row.source ?? '',
    eligibilityPlain: row.eligibility_plain ?? [],
    benefitPlain: row.benefit_plain ?? null,
    preparePlain: row.prepare_plain ?? [],
    applyWherePlain: row.apply_where_plain ?? null,
  }))
}
