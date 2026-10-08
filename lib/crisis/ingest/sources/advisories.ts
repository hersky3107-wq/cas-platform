import { buildDedupeKey } from '../dedupe'
import { asArray, asRecord, finiteNumber, isoTime, politeFetch } from '../fetch'
import { toIso3 } from '../iso'
import { extractXmlTag, parseXmlItems } from '../xml'
import type {
  CrisisSource,
  IngestFetchResult,
  NormalizedAdvisory,
  NormalizedAdvisoryHistory,
  NormalizedSignal,
} from '../types'

export const STATE_RSS_URL = 'https://travel.state.gov/_res/rss/TAsTWs.xml'
export const FCDO_INDEX_URL = 'https://www.gov.uk/api/content/foreign-travel-advice'
export const ADVISORY_DIVERGE_LEVELS = 2
export const ADVISORY_STALE_MS = 72 * 3600 * 1000

export interface ParsedAdvisory {
  country_iso3: string
  source: 'us_state' | 'uk_fcdo'
  level: number
  level_text: string
  updated_at: string | null
  title: string | null
}

export function mapStateLevel(raw: string | null | undefined): { level: number; text: string } | null {
  if (!raw) return null
  const levelMatch = /Level\s*([1-4])/i.exec(raw)
  if (levelMatch) {
    const level = Number(levelMatch[1])
    return { level, text: raw.trim() }
  }
  const lower = raw.toLowerCase()
  if (/do not travel/.test(lower)) return { level: 4, text: raw.trim() }
  if (/reconsider travel/.test(lower)) return { level: 3, text: raw.trim() }
  if (/increased caution/.test(lower)) return { level: 2, text: raw.trim() }
  if (/normal precautions/.test(lower)) return { level: 1, text: raw.trim() }
  return null
}

export function mapFcdoLevel(statuses: string[] | null | undefined, body?: string | null): { level: number; text: string } {
  const joined = [...(statuses ?? []), body ?? ''].join(' ').toLowerCase()
  const allTravel = /avoid_all_travel(?!_to_parts)|advise against all travel(?! to parts)/i.test(joined)
  const essential = /avoid_all_but_essential|advise against all but essential/i.test(joined)
  const parts = /_to_parts|to parts of/.test(joined)
  if (allTravel && !parts) return { level: 4, text: statuses?.join(',') || 'advise against all travel' }
  if (essential && !parts) return { level: 3, text: statuses?.join(',') || 'advise against all but essential travel' }
  if (allTravel || essential || parts) return { level: 2, text: statuses?.join(',') || 'partial' }
  return { level: 1, text: statuses?.length ? statuses.join(',') : 'none' }
}

const STATE_NAME_ISO3: Record<string, string> = {
  afghanistan: 'AFG', albania: 'ALB', algeria: 'DZA', angola: 'AGO', argentina: 'ARG',
  armenia: 'ARM', australia: 'AUS', austria: 'AUT', azerbaijan: 'AZE', bahrain: 'BHR',
  bangladesh: 'BGD', belarus: 'BLR', belgium: 'BEL', belize: 'BLZ', benin: 'BEN',
  bolivia: 'BOL', 'bosnia and herzegovina': 'BIH', botswana: 'BWA', brazil: 'BRA',
  bulgaria: 'BGR', 'burkina faso': 'BFA', burundi: 'BDI', cambodia: 'KHM', cameroon: 'CMR',
  canada: 'CAN', 'central african republic': 'CAF', chad: 'TCD', chile: 'CHL', china: 'CHN',
  colombia: 'COL', 'costa rica': 'CRI', "cote d'ivoire": 'CIV', 'ivory coast': 'CIV',
  croatia: 'HRV', cuba: 'CUB', cyprus: 'CYP', czechia: 'CZE', 'czech republic': 'CZE',
  'democratic republic of the congo': 'COD', 'congo (kinshasa)': 'COD',
  'republic of the congo': 'COG', denmark: 'DNK', djibouti: 'DJI', ecuador: 'ECU',
  egypt: 'EGY', 'el salvador': 'SLV', eritrea: 'ERI', estonia: 'EST', eswatini: 'SWZ',
  ethiopia: 'ETH', fiji: 'FJI', finland: 'FIN', france: 'FRA', gabon: 'GAB',
  gambia: 'GMB', 'the gambia': 'GMB', georgia: 'GEO', germany: 'DEU', ghana: 'GHA',
  greece: 'GRC', guatemala: 'GTM', guinea: 'GIN', haiti: 'HTI', honduras: 'HND',
  hungary: 'HUN', iceland: 'ISL', india: 'IND', indonesia: 'IDN', iran: 'IRN',
  iraq: 'IRQ', ireland: 'IRL', israel: 'ISR', italy: 'ITA', jamaica: 'JAM',
  japan: 'JPN', jordan: 'JOR', kazakhstan: 'KAZ', kenya: 'KEN', kuwait: 'KWT',
  kyrgyzstan: 'KGZ', laos: 'LAO', latvia: 'LVA', lebanon: 'LBN', liberia: 'LBR',
  libya: 'LBY', lithuania: 'LTU', luxembourg: 'LUX', madagascar: 'MDG', malawi: 'MWI',
  malaysia: 'MYS', mali: 'MLI', mauritania: 'MRT', mexico: 'MEX', moldova: 'MDA',
  mongolia: 'MNG', montenegro: 'MNE', morocco: 'MAR', mozambique: 'MOZ',
  myanmar: 'MMR', burma: 'MMR', 'myanmar (burma)': 'MMR', namibia: 'NAM', nepal: 'NPL',
  netherlands: 'NLD', nicaragua: 'NIC', niger: 'NER', nigeria: 'NGA',
  'north korea': 'PRK', 'north macedonia': 'MKD', norway: 'NOR', oman: 'OMN',
  pakistan: 'PAK', panama: 'PAN', 'papua new guinea': 'PNG', paraguay: 'PRY',
  peru: 'PER', philippines: 'PHL', poland: 'POL', portugal: 'PRT', qatar: 'QAT',
  romania: 'ROU', russia: 'RUS', rwanda: 'RWA', 'saudi arabia': 'SAU', senegal: 'SEN',
  serbia: 'SRB', 'sierra leone': 'SLE', singapore: 'SGP', slovakia: 'SVK',
  slovenia: 'SVN', somalia: 'SOM', 'south africa': 'ZAF', 'south korea': 'KOR',
  'south sudan': 'SSD', spain: 'ESP', 'sri lanka': 'LKA', sudan: 'SDN', sweden: 'SWE',
  switzerland: 'CHE', syria: 'SYR', taiwan: 'TWN', tajikistan: 'TJK', tanzania: 'TZA',
  thailand: 'THA', 'timor-leste': 'TLS', 'east timor': 'TLS', togo: 'TGO',
  'trinidad and tobago': 'TTO', tunisia: 'TUN', turkey: 'TUR', türkiye: 'TUR',
  turkmenistan: 'TKM', uganda: 'UGA', ukraine: 'UKR', 'united arab emirates': 'ARE',
  'united kingdom': 'GBR', 'united states': 'USA', uruguay: 'URY', uzbekistan: 'UZB',
  venezuela: 'VEN', vietnam: 'VNM', yemen: 'YEM', zambia: 'ZMB', zimbabwe: 'ZWE',
  'west bank': 'PSE', gaza: 'PSE', 'palestinian territories': 'PSE', palestine: 'PSE',
}

function nameToIso3(name: string): string | null {
  const key = name.trim().toLowerCase().replace(/[.]/g, '')
  if (STATE_NAME_ISO3[key]) return STATE_NAME_ISO3[key]
  return null
}

export function normalizeStateRss(xml: string, fetchedAt: string): ParsedAdvisory[] {
  const out: ParsedAdvisory[] = []
  for (const item of parseXmlItems(xml)) {
    const title = extractXmlTag(item, 'title')
    if (!title) continue
    const mapped = mapStateLevel(title)
    if (!mapped) continue
    const countryPart = title.split(/\s+-\s+Level/i)[0]?.trim() ?? title
    const iso3 = nameToIso3(countryPart) ?? toIso3(extractXmlTag(item, 'category'))
    if (!iso3) continue
    out.push({
      country_iso3: iso3,
      source: 'us_state',
      level: mapped.level,
      level_text: mapped.text,
      updated_at: isoTime(extractXmlTag(item, 'pubDate') ?? extractXmlTag(item, 'lastBuildDate')) ?? fetchedAt,
      title,
    })
  }
  return out
}

export function normalizeFcdoCountry(payload: unknown, fetchedAt: string): ParsedAdvisory | null {
  const rec = asRecord(payload)
  if (!rec) return null
  const details = asRecord(rec.details)
  const country = asRecord(details?.country) ?? asRecord(rec.country)
  const iso2 = typeof country?.id === 'string' ? country.id : typeof country?.iso2 === 'string' ? country.iso2 : null
  const slug = typeof country?.slug === 'string'
    ? country.slug
    : typeof rec.base_path === 'string'
      ? rec.base_path.split('/').pop() ?? null
      : null
  const iso3 = toIso3(iso2) ?? (slug ? nameToIso3(slug.replace(/-/g, ' ')) : null)
  if (!iso3) return null
  const statuses = asArray(details?.alert_status).filter((item): item is string => typeof item === 'string')
  const mapped = mapFcdoLevel(statuses, typeof rec.description === 'string' ? rec.description : null)
  return {
    country_iso3: iso3,
    source: 'uk_fcdo',
    level: mapped.level,
    level_text: mapped.text,
    updated_at: isoTime(rec.updated_at ?? rec.public_updated_at ?? details?.reviewed_at) ?? fetchedAt,
    title: typeof rec.title === 'string' ? rec.title : slug,
  }
}

export function fcdoChildUrls(indexPayload: unknown): string[] {
  const rec = asRecord(indexPayload)
  const links = asRecord(rec?.links)
  const children = asArray(links?.children)
  const urls: string[] = []
  for (const child of children) {
    const row = asRecord(child)
    const url = typeof row?.api_url === 'string' ? row.api_url : typeof row?.web_url === 'string' ? null : null
    if (url) urls.push(url)
  }
  return urls
}

export function detectAdvisoryChanges(
  incoming: ParsedAdvisory[],
  previous: Array<{ country_iso3: string; source: string; level: number; updated_at: string | null }>,
  nowIso: string,
): {
  states: NormalizedAdvisory[]
  history: NormalizedAdvisoryHistory[]
  changeSignals: NormalizedSignal[]
  divergeSignals: NormalizedSignal[]
} {
  const prev = new Map(previous.map((row) => [`${row.country_iso3}|${row.source}`, row]))
  const latest = new Map<string, Map<string, { level: number; updated_at: string | null; text: string }>>()
  const put = (
    iso3: string,
    source: string,
    level: number,
    updatedAt: string | null,
    text: string,
  ) => {
    const bySource = latest.get(iso3) ?? new Map()
    bySource.set(source, { level, updated_at: updatedAt, text })
    latest.set(iso3, bySource)
  }
  for (const row of previous) put(row.country_iso3, row.source, row.level, row.updated_at, '')
  for (const row of incoming) put(row.country_iso3, row.source, row.level, row.updated_at ?? nowIso, row.level_text)

  const states: NormalizedAdvisory[] = incoming.map((row) => ({
    country_iso3: row.country_iso3,
    source: row.source,
    level: row.level,
    level_text: row.level_text,
    updated_at: row.updated_at ?? nowIso,
    fetched_at: nowIso,
  }))
  const history: NormalizedAdvisoryHistory[] = []
  const changeSignals: NormalizedSignal[] = []

  for (const row of incoming) {
    const before = prev.get(`${row.country_iso3}|${row.source}`)
    if (before && before.level !== row.level) {
      history.push({
        country_iso3: row.country_iso3,
        source: row.source,
        level: row.level,
        level_text: row.level_text,
        changed_at: nowIso,
        previous_level: before.level,
      })
      const us = latest.get(row.country_iso3)?.get('us_state')?.level ?? null
      const uk = latest.get(row.country_iso3)?.get('uk_fcdo')?.level ?? null
      changeSignals.push({
        department: 'diplomacy',
        source: 'advisories',
        signal_type: 'advisory_change',
        title: `${row.country_iso3} ${row.source} ${before.level}->${row.level}`,
        lat: null,
        lon: null,
        country_iso3: row.country_iso3,
        value_num: row.level,
        value_raw: {
          changed_source: row.source,
          previous_level: before.level,
          us_state: us,
          uk_fcdo: uk,
        },
        unit_raw: 'advisory_level',
        event_time: nowIso,
        url: row.source === 'us_state' ? STATE_RSS_URL : FCDO_INDEX_URL,
        dedupe_key: buildDedupeKey({
          source: 'advisories',
          signalType: 'advisory_change',
          id: `${row.country_iso3}|${row.source}|${before.level}|${row.level}|${nowIso}`,
          eventTime: nowIso,
        }),
      })
    }
  }

  const nowMs = new Date(nowIso).getTime()
  const divergeSignals: NormalizedSignal[] = []
  for (const [iso3, sources] of latest) {
    const us = sources.get('us_state')
    const uk = sources.get('uk_fcdo')
    if (!us || !uk) continue
    const spread = Math.abs(us.level - uk.level)
    const usChanged = us.updated_at ? nowMs - new Date(us.updated_at).getTime() <= ADVISORY_STALE_MS : false
    const ukChanged = uk.updated_at ? nowMs - new Date(uk.updated_at).getTime() <= ADVISORY_STALE_MS : false
    const lag = (usChanged && !ukChanged) || (ukChanged && !usChanged)
    if (spread >= ADVISORY_DIVERGE_LEVELS || lag) {
      divergeSignals.push({
        department: 'diplomacy',
        source: 'advisories',
        signal_type: 'advisory_divergence',
        title: `${iso3} US ${us.level} vs UK ${uk.level}`,
        lat: null,
        lon: null,
        country_iso3: iso3,
        value_num: spread,
        value_raw: {
          us_state: us.level,
          uk_fcdo: uk.level,
          us_updated_at: us.updated_at,
          uk_updated_at: uk.updated_at,
          lag_72h: lag,
        },
        unit_raw: 'level_delta',
        event_time: nowIso,
        url: STATE_RSS_URL,
        dedupe_key: buildDedupeKey({
          source: 'advisories',
          signalType: 'advisory_divergence',
          id: `${iso3}|${us.level}|${uk.level}|${nowIso.slice(0, 13)}`,
          eventTime: nowIso,
        }),
      })
    }
  }

  return { states, history, changeSignals, divergeSignals }
}

export const advisoriesSource: CrisisSource = {
  key: 'advisories',
  department: 'diplomacy',
  scheduleMinutes: 360,
  writes: 'mixed',
  async fetch(ctx): Promise<IngestFetchResult> {
    const fetchedAt = ctx.now.toISOString()
    let httpCalls = 0
    const incoming: ParsedAdvisory[] = []
    const notes: string[] = []

    const rss = await politeFetch(STATE_RSS_URL, { sourceKey: 'advisories', minIntervalMs: 1500, as: 'text' })
    httpCalls += 1
    if (!rss.ok) notes.push(`state HTTP ${rss.status}`)
    else incoming.push(...normalizeStateRss(rss.text, fetchedAt))

    const index = await politeFetch(FCDO_INDEX_URL, { sourceKey: 'advisories', minIntervalMs: 1500 })
    httpCalls += 1
    if (!index.ok) notes.push(`fcdo index HTTP ${index.status}`)
    else {
      const urls = fcdoChildUrls(index.data)
      const take = ctx.dryRun ? urls.slice(0, 1) : urls
      for (const url of take) {
        const page = await politeFetch(url, { sourceKey: 'advisories', minIntervalMs: 200 })
        httpCalls += 1
        if (!page.ok) continue
        const row = normalizeFcdoCountry(page.data, fetchedAt)
        if (row) incoming.push(row)
      }
      if (ctx.dryRun) notes.push('fcdo dry-run 1 country')
    }

    let previous: Array<{ country_iso3: string; source: string; level: number; updated_at: string | null }> = []
    if (!ctx.dryRun) {
      const { data, error } = await ctx.client
        .from('crisis_advisory_state')
        .select('country_iso3, source, level, updated_at')
      if (error) notes.push(`state read: ${error.message}`)
      previous = (data ?? []).map((row) => ({
        country_iso3: String(row.country_iso3),
        source: String(row.source),
        level: finiteNumber(row.level) ?? 1,
        updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
      }))
    }

    const { states, history, changeSignals, divergeSignals } = detectAdvisoryChanges(incoming, previous, fetchedAt)
    return {
      httpCalls,
      advisories: states,
      advisoryHistory: history,
      signals: [...changeSignals, ...divergeSignals],
      quotaNote: [
        `incoming=${incoming.length}`,
        `changes=${history.length}`,
        `diverge=${divergeSignals.length}`,
        notes.join('; ') || null,
      ].filter(Boolean).join('; '),
    }
  },
}
