/**
 * Display-time politics copy. Stored rounds keep server-composed proposition
 * text; the card localizes from the ELECTION instrument like sports MATCH.
 */

import type { LeagueLocale } from './i18n/locales'
import {
  decodePoliticsInstrument,
  raceTitle,
  type PoliticsInstrumentParts,
} from './gateway/adapters/politics-catalog'
import type { PoliticsOffice } from './politics/markets'

const OFFICE_EN: Record<PoliticsOffice, string> = {
  president: 'President',
  senate: 'Senate',
  house: 'House',
  governor: 'Governor',
  mayor: 'Mayor',
  other: 'Election',
}

const STATE_EN: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  IA: 'Iowa',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  MA: 'Massachusetts',
  MD: 'Maryland',
  ME: 'Maine',
  MI: 'Michigan',
  MN: 'Minnesota',
  MO: 'Missouri',
  MS: 'Mississippi',
  MT: 'Montana',
  NC: 'North Carolina',
  ND: 'North Dakota',
  NE: 'Nebraska',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NV: 'Nevada',
  NY: 'New York',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VA: 'Virginia',
  VT: 'Vermont',
  WA: 'Washington',
  WI: 'Wisconsin',
  WV: 'West Virginia',
  WY: 'Wyoming',
  DC: 'District of Columbia',
}

const JURISDICTION_EN: Record<string, string> = {
  US: 'US',
  KR: 'South Korea',
  BR: 'Brazil',
  UK: 'UK',
  FR: 'France',
  DE: 'Germany',
  JP: 'Japan',
}

export function raceTitleEn(
  parts: Pick<PoliticsInstrumentParts, 'jurisdiction' | 'office' | 'cycle' | 'district'>,
): string {
  const where = JURISDICTION_EN[parts.jurisdiction] ?? parts.jurisdiction
  const office = OFFICE_EN[parts.office]
  if (parts.district && parts.district !== '_') {
    const house = parts.district.match(/^([A-Z]{2})-(\d+)$/)
    if (house) {
      const state = STATE_EN[house[1]!] ?? house[1]
      const districtNo = Number.parseInt(house[2]!, 10)
      const districtLabel = Number.isFinite(districtNo) ? String(districtNo) : house[2]
      return `${parts.cycle} ${where} ${state} ${districtLabel}th District ${office}`
    }
    const state = STATE_EN[parts.district] ?? parts.district
    return `${parts.cycle} ${where} ${state} ${office}`
  }
  return `${parts.cycle} ${where} ${office}`
}

export function raceTitleForLocale(
  parts: Pick<PoliticsInstrumentParts, 'jurisdiction' | 'office' | 'cycle' | 'district'>,
  locale: LeagueLocale,
): string {
  return locale === 'ko' ? raceTitle(parts) : raceTitleEn(parts)
}

/** Card headline instrument slot for binary_subject_outcome election rounds. */
export function electionHeadlineLabel(instrument: string, locale: LeagueLocale): string | null {
  const parts = decodePoliticsInstrument(instrument)
  if (!parts) return null
  const race = raceTitleForLocale(parts, locale)
  if (locale === 'ko') {
    return `${race} · ${parts.candidate} 당선`
  }
  return `${race} · ${parts.candidate} elected`
}

export function formatElectionPropositionLocalized(parts: PoliticsInstrumentParts, locale: LeagueLocale): string {
  const race = raceTitleForLocale(parts, locale)
  if (locale === 'ko') {
    return `${race} ${parts.candidate} 당선`
  }
  return `Will ${parts.candidate} be elected in the ${race}?`
}

/** Card / locked-panel proposition. Falls back to stored text unless it looks like a raw instrument id. */
export function politicsPropositionDisplay(instrument: string, stored: string, locale: LeagueLocale): string {
  const parts = decodePoliticsInstrument(instrument) ?? decodePoliticsInstrument(stored)
  if (!parts) return stored
  return formatElectionPropositionLocalized(parts, locale)
}
