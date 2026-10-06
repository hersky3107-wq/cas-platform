/**
 * Wikidata subject lookup for the divination seat's 사주 line (tech /
 * politics / entertainment). Public API, no key.
 *
 *   person            → P569 date of birth
 *   political party   → P571 inception
 *   company / brand   → current CEO (P169 without an end date) → P569;
 *                       P571 inception when there is no CEO or no birth month
 *   music group       → P571 inception
 *
 * Month precision or better, Gregorian only; the day is dropped. An exact
 * label match beats an alias match. Two or more usable entities in the same
 * tier are ambiguous unless one has at least 3× the sitelinks of the next.
 * Not found / ambiguous → null, and the seat keeps its usual reading.
 *
 * Caches subject birth data only (memory + optional store). Readings stay in
 * the oracle's own cache.
 */
import {
  WIKI_LABEL_LANGS,
  parseWikiLabels,
  type SajuSource,
  type SajuSubjectKind,
  type WikiLabels,
} from './divination-chart-types'

export type SajuCategory = 'tech' | 'politics_election' | 'entertainment'

export type SubjectBirth = {
  qid: string
  kind: SajuSubjectKind
  source: SajuSource
  yearMonth: string
  labels: WikiLabels
  ceo: { qid: string; labels: WikiLabels } | null
}

export type SubjectLookupReason = 'ok' | 'not_found' | 'ambiguous' | 'no_date'
export type SubjectLookup = { birth: SubjectBirth | null; reason: SubjectLookupReason }

export type WikidataFetchJson = (url: string) => Promise<unknown>

export type SubjectCacheStore = {
  get(key: string): Promise<{ value: SubjectBirth | null; fetchedAt: string } | null>
  put(key: string, label: string, value: SubjectBirth | null): Promise<void>
}

const API = 'https://www.wikidata.org/w/api.php'
/** Wikimedia rate-limits clients whose User-Agent carries no contact (URL or e-mail) far harder. */
const CONTACT = process.env.LEAGUE_WIKIDATA_CONTACT?.trim() || 'https://github.com/hersky3107-wq/cas-platform'
const USER_AGENT = `CasPlatformLeague/1.0 (${CONTACT}) divination-subject-lookup`
const GREGORIAN = 'http://www.wikidata.org/entity/Q1985727'
const HUMAN = 'Q5'
const PARTY_CLASSES = new Set(['Q7278'])
/** Political ideology / political alignment — only parties carry these with an inception. */
const PARTY_PROPS = ['P1142', 'P1387']
const COMPANY_CLASSES = new Set([
  'Q4830453', // business
  'Q783794', // company
  'Q891723', // public company
  'Q6881511', // enterprise
  'Q167037', // corporation
  'Q431289', // brand
  'Q219577', // holding company
  'Q1589009', // privately held company
  'Q778575', // conglomerate
  'Q18388277', // technology company
  'Q1058914', // software company
])
/** CEO / stock exchange / industry / employees. */
const COMPANY_PROPS = ['P169', 'P414', 'P452', 'P1128']
const GROUP_CLASSES = new Set([
  'Q215380', // musical group
  'Q216337', // boy band
  'Q641066', // girl group
  'Q9212979', // musical duo
  'Q5741069', // rock band
])

const CATEGORY_KINDS: Record<SajuCategory, readonly SajuSubjectKind[]> = {
  tech: ['company', 'person'],
  politics_election: ['person', 'party'],
  entertainment: ['person', 'group', 'company'],
}

const SEARCH_LIMIT = 7
const MAX_CANDIDATES = 6
const DOMINANT_SITELINK_RATIO = 3
const POSITIVE_TTL_MS = 30 * 24 * 3_600_000
const NEGATIVE_TTL_MS = 7 * 24 * 3_600_000
/** Inside the divination seat's 30 s timeout, leaving the reader most of it. */
export const WIKIDATA_BUDGET_MS = 8_000
const FETCH_TIMEOUT_MS = 4_000
const MIN_REQUEST_GAP_MS = 350
const RETRY_WAIT_DEFAULT_MS = 1_000
const RETRY_WAIT_MAX_MS = 2_500

type Snak = { snaktype?: string; datavalue?: { value?: unknown } }
type Statement = { mainsnak?: Snak; rank?: string; qualifiers?: Record<string, Snak[] | undefined> }
export type WikidataEntity = {
  id?: string
  missing?: string
  labels?: Record<string, { value?: string } | undefined>
  claims?: Record<string, Statement[] | undefined>
  sitelinks?: Record<string, unknown>
}

type SearchHit = { id?: string; label?: string; aliases?: string[]; match?: { type?: string; text?: string } }

export function normalizeSubjectName(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s.,·・'’"`_\-()]/g, '')
}

function searchLanguage(name: string): string {
  if (/[\uac00-\ud7a3]/.test(name)) return 'ko'
  if (/[\u3040-\u30ff]/.test(name)) return 'ja'
  if (/[\u4e00-\u9fff]/.test(name)) return 'zh'
  return 'en'
}

function statements(entity: WikidataEntity, prop: string): Statement[] {
  const rows = (entity.claims?.[prop] ?? []).filter((s) => s.rank !== 'deprecated')
  return [...rows.filter((s) => s.rank === 'preferred'), ...rows.filter((s) => s.rank !== 'preferred')]
}

function entityIdOf(snak: Snak | undefined): string | null {
  if (!snak || snak.snaktype !== 'value') return null
  const value = snak.datavalue?.value as { id?: unknown } | undefined
  return typeof value?.id === 'string' ? value.id : null
}

function classIds(entity: WikidataEntity): string[] {
  return statements(entity, 'P31')
    .map((s) => entityIdOf(s.mainsnak))
    .filter((id): id is string => Boolean(id))
}

function hasProp(entity: WikidataEntity, prop: string): boolean {
  return statements(entity, prop).length > 0
}

/** `+1963-02-17T00:00:00Z` at precision ≥ 10 (month) → `1963-02`. */
export function wikidataYearMonth(snak: Snak | undefined): string | null {
  if (!snak || snak.snaktype !== 'value') return null
  const value = snak.datavalue?.value as { time?: unknown; precision?: unknown; calendarmodel?: unknown } | undefined
  if (!value || typeof value.time !== 'string') return null
  if (typeof value.precision !== 'number' || value.precision < 10) return null
  if (value.calendarmodel != null && value.calendarmodel !== GREGORIAN) return null
  const m = /^\+(\d{4})-(\d{2})-/.exec(value.time)
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return `${m[1]}-${m[2]}`
}

function firstYearMonth(entity: WikidataEntity, prop: string): string | null {
  for (const s of statements(entity, prop)) {
    const ym = wikidataYearMonth(s.mainsnak)
    if (ym) return ym
  }
  return null
}

export function classifyEntity(entity: WikidataEntity): SajuSubjectKind | null {
  const classes = classIds(entity)
  if (classes.includes(HUMAN)) return 'person'
  if (classes.some((id) => PARTY_CLASSES.has(id))) return 'party'
  if (classes.some((id) => GROUP_CLASSES.has(id))) return 'group'
  if (classes.some((id) => COMPANY_CLASSES.has(id)) || COMPANY_PROPS.some((p) => hasProp(entity, p))) return 'company'
  if (hasProp(entity, 'P571') && PARTY_PROPS.some((p) => hasProp(entity, p))) return 'party'
  return null
}

function timeQualifier(statement: Statement, prop: string): string | null {
  const raw = statement.qualifiers?.[prop]?.[0]
  if (!raw || raw.snaktype !== 'value') return null
  const value = raw.datavalue?.value as { time?: unknown } | undefined
  return typeof value?.time === 'string' ? value.time : null
}

/** Current CEO: P169 with no P582 end time; preferred rank, then latest P580 start. */
export function currentCeoId(entity: WikidataEntity): string | null {
  const current = statements(entity, 'P169').filter((s) => {
    const end = s.qualifiers?.P582?.[0]
    return !end && entityIdOf(s.mainsnak)
  })
  if (current.length === 0) return null
  const preferred = current.filter((s) => s.rank === 'preferred')
  const pool = preferred.length > 0 ? preferred : current
  const sorted = [...pool].sort((a, b) => (timeQualifier(b, 'P580') ?? '').localeCompare(timeQualifier(a, 'P580') ?? ''))
  return entityIdOf(sorted[0]?.mainsnak)
}

export function entityLabels(entity: WikidataEntity): WikiLabels {
  const out: WikiLabels = {}
  for (const lang of WIKI_LABEL_LANGS) {
    const value = entity.labels?.[lang]?.value
    if (typeof value === 'string' && value.trim()) out[lang] = value.trim()
  }
  return out
}

function sitelinkCount(entity: WikidataEntity): number {
  return entity.sitelinks ? Object.keys(entity.sitelinks).length : 0
}

function searchUrl(name: string): string {
  const lang = searchLanguage(name)
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    format: 'json',
    type: 'item',
    limit: String(SEARCH_LIMIT),
    language: lang,
    uselang: lang,
    search: name,
  })
  return `${API}?${params.toString()}`
}

function entitiesUrl(ids: readonly string[], withSitelinks: boolean): string {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    format: 'json',
    props: withSitelinks ? 'claims|labels|sitelinks' : 'claims|labels',
    languages: WIKI_LABEL_LANGS.join('|'),
    ids: ids.join('|'),
  })
  return `${API}?${params.toString()}`
}

function searchHits(payload: unknown): SearchHit[] {
  const rows = (payload as { search?: unknown } | null)?.search
  return Array.isArray(rows) ? (rows as SearchHit[]) : []
}

function entitiesOf(payload: unknown): Record<string, WikidataEntity> {
  const rows = (payload as { entities?: unknown } | null)?.entities
  return rows && typeof rows === 'object' ? (rows as Record<string, WikidataEntity>) : {}
}

type Viable = { entity: WikidataEntity; qid: string; kind: SajuSubjectKind }

function viable(entity: WikidataEntity, allowed: readonly SajuSubjectKind[]): Viable | null {
  if (!entity.id || entity.missing != null) return null
  const kind = classifyEntity(entity)
  if (!kind || !allowed.includes(kind)) return null
  if (kind === 'person' && !firstYearMonth(entity, 'P569')) return null
  if ((kind === 'party' || kind === 'group') && !firstYearMonth(entity, 'P571')) return null
  if (kind === 'company' && !currentCeoId(entity) && !firstYearMonth(entity, 'P571')) return null
  return { entity, qid: entity.id, kind }
}

function pickFromTier(rows: Viable[]): Viable | 'ambiguous' | null {
  if (rows.length === 0) return null
  if (rows.length === 1) return rows[0]
  const ranked = [...rows].sort((a, b) => sitelinkCount(b.entity) - sitelinkCount(a.entity))
  const top = sitelinkCount(ranked[0].entity)
  const next = sitelinkCount(ranked[1].entity)
  return top > 0 && top >= next * DOMINANT_SITELINK_RATIO ? ranked[0] : 'ambiguous'
}

async function birthFor(pick: Viable, fetchJson: WikidataFetchJson): Promise<SubjectBirth | null> {
  const labels = entityLabels(pick.entity)
  if (pick.kind === 'person') {
    const ym = firstYearMonth(pick.entity, 'P569')
    return ym ? { qid: pick.qid, kind: 'person', source: 'birth', yearMonth: ym, labels, ceo: null } : null
  }
  if (pick.kind === 'company') {
    const ceoId = currentCeoId(pick.entity)
    if (ceoId) {
      const ceo = entitiesOf(await fetchJson(entitiesUrl([ceoId], false)))[ceoId]
      const ym = ceo ? firstYearMonth(ceo, 'P569') : null
      if (ceo && ym) {
        return {
          qid: pick.qid,
          kind: 'company',
          source: 'ceo_birth',
          yearMonth: ym,
          labels,
          ceo: { qid: ceoId, labels: entityLabels(ceo) },
        }
      }
    }
  }
  const inception = firstYearMonth(pick.entity, 'P571')
  return inception ? { qid: pick.qid, kind: pick.kind, source: 'inception', yearMonth: inception, labels, ceo: null } : null
}

/** One uncached lookup. Throws on network failure so the caller does not cache it. */
export async function lookupSubjectBirth(
  name: string,
  category: SajuCategory,
  fetchJson: WikidataFetchJson,
): Promise<SubjectLookup> {
  const target = normalizeSubjectName(name)
  if (!target) return { birth: null, reason: 'not_found' }
  const tiers = new Map<string, 'label' | 'alias'>()
  for (const hit of searchHits(await fetchJson(searchUrl(name)))) {
    if (!hit.id || tiers.has(hit.id)) continue
    if (normalizeSubjectName(hit.label ?? '') === target) tiers.set(hit.id, 'label')
    else if (
      normalizeSubjectName(hit.match?.text ?? '') === target ||
      (hit.aliases ?? []).some((alias) => normalizeSubjectName(alias) === target)
    ) {
      tiers.set(hit.id, 'alias')
    }
  }
  const ids = [...tiers.keys()].slice(0, MAX_CANDIDATES)
  if (ids.length === 0) return { birth: null, reason: 'not_found' }

  const entities = entitiesOf(await fetchJson(entitiesUrl(ids, true)))
  const allowed = CATEGORY_KINDS[category]
  const usable = ids
    .map((id) => (entities[id] ? viable(entities[id], allowed) : null))
    .filter((row): row is Viable => row !== null)
  if (usable.length === 0) return { birth: null, reason: 'no_date' }

  for (const tier of ['label', 'alias'] as const) {
    const pick = pickFromTier(usable.filter((row) => tiers.get(row.qid) === tier))
    if (pick === 'ambiguous') return { birth: null, reason: 'ambiguous' }
    if (pick) {
      const birth = await birthFor(pick, fetchJson)
      return birth ? { birth, reason: 'ok' } : { birth: null, reason: 'no_date' }
    }
  }
  return { birth: null, reason: 'not_found' }
}

const SUBJECT_KINDS: readonly SajuSubjectKind[] = ['person', 'party', 'company', 'group']
const SOURCES: readonly SajuSource[] = ['birth', 'inception', 'ceo_birth']

/** Stored cache row → SubjectBirth, or null for a negative / malformed row. */
export function parseSubjectBirth(value: unknown): SubjectBirth | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.qid !== 'string' || !SUBJECT_KINDS.includes(raw.kind as SajuSubjectKind)) return null
  if (!SOURCES.includes(raw.source as SajuSource)) return null
  if (typeof raw.yearMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw.yearMonth)) return null
  const ceoRaw = raw.ceo as Record<string, unknown> | null | undefined
  const ceo = ceoRaw && typeof ceoRaw.qid === 'string' ? { qid: ceoRaw.qid, labels: parseWikiLabels(ceoRaw.labels) } : null
  return {
    qid: raw.qid,
    kind: raw.kind as SajuSubjectKind,
    source: raw.source as SajuSource,
    yearMonth: raw.yearMonth,
    labels: parseWikiLabels(raw.labels),
    ceo,
  }
}

export class WikidataHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null,
  ) {
    super(`wikidata ${status}`)
    this.name = 'WikidataHttpError'
  }
}

/** `Retry-After` in seconds or as an HTTP date. */
export function parseRetryAfterMs(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - now) : null
}

const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let nextRequestAt = 0

/** Spaces requests process-wide so a batch of rounds does not burst the API. */
async function takeRequestSlot(): Promise<void> {
  const now = Date.now()
  const at = Math.max(now, nextRequestAt)
  nextRequestAt = at + MIN_REQUEST_GAP_MS
  if (at > now) await sleepMs(at - now)
}

export const defaultWikidataFetch: WikidataFetchJson = async (url) => {
  await takeRequestSlot()
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new WikidataHttpError(res.status, parseRetryAfterMs(res.headers.get('retry-after')))
  return res.json()
}

function isRetryable(error: unknown): error is WikidataHttpError {
  return error instanceof WikidataHttpError && (error.status === 429 || error.status >= 500)
}

/** One retry per request on 429 / 5xx, only when the wait still fits before `deadline`. */
function retryingFetch(
  fetchJson: WikidataFetchJson,
  deadline: number,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
): WikidataFetchJson {
  return async (url) => {
    try {
      return await fetchJson(url)
    } catch (error) {
      if (!isRetryable(error)) throw error
      const wait = Math.min(error.retryAfterMs ?? RETRY_WAIT_DEFAULT_MS, RETRY_WAIT_MAX_MS)
      if (now() + wait >= deadline - 500) throw error
      await sleep(wait)
      return fetchJson(url)
    }
  }
}

const memory = new Map<string, { value: SubjectBirth | null; at: number }>()
const inflight = new Map<string, Promise<SubjectBirth | null>>()

export function clearSubjectBirthMemory(): void {
  memory.clear()
  inflight.clear()
}

export function subjectCacheKey(category: SajuCategory, name: string): string {
  return `${category}:${normalizeSubjectName(name)}`
}

function fresh(value: SubjectBirth | null, at: number, now: number): boolean {
  return now - at < (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS)
}

function withBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('wikidata budget exceeded')), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

export type ResolveSubjectDeps = {
  fetchJson?: WikidataFetchJson
  store?: SubjectCacheStore | null
  now?: () => number
  budgetMs?: number
  sleep?: (ms: number) => Promise<void>
}

/**
 * Cached per subject; concurrent callers for one subject share a lookup.
 * Network failures, 429s and timeouts are not cached: they fall back to a
 * stale stored hit when there is one, else null.
 */
export function resolveSubjectBirth(
  name: string,
  category: SajuCategory,
  deps: ResolveSubjectDeps = {},
): Promise<SubjectBirth | null> {
  const clock = deps.now ?? Date.now
  const key = subjectCacheKey(category, name)
  if (key.endsWith(':')) return Promise.resolve(null)
  const mem = memory.get(key)
  if (mem && fresh(mem.value, mem.at, clock())) return Promise.resolve(mem.value)
  const running = inflight.get(key)
  if (running) return running
  const work = resolveUncached(key, name, category, deps, clock).finally(() => inflight.delete(key))
  inflight.set(key, work)
  return work
}

async function resolveUncached(
  key: string,
  name: string,
  category: SajuCategory,
  deps: ResolveSubjectDeps,
  clock: () => number,
): Promise<SubjectBirth | null> {
  const now = clock()
  let stale: SubjectBirth | null = null
  try {
    const stored = await deps.store?.get(key)
    if (stored) {
      const at = Date.parse(stored.fetchedAt)
      if (Number.isFinite(at) && fresh(stored.value, at, now)) {
        memory.set(key, { value: stored.value, at })
        return stored.value
      }
      stale = stored.value
    }
  } catch {
    /* store is optional */
  }
  const budgetMs = deps.budgetMs ?? WIKIDATA_BUDGET_MS
  const fetchJson = retryingFetch(deps.fetchJson ?? defaultWikidataFetch, now + budgetMs, deps.sleep ?? sleepMs, clock)
  let result: SubjectLookup
  try {
    result = await withBudget(lookupSubjectBirth(name, category, fetchJson), budgetMs)
  } catch (error) {
    console.warn(
      `[league-divination] subject lookup failed for ${key}: ${error instanceof Error ? error.message : String(error)}${stale ? ' (using stale cache)' : ''}`,
    )
    return stale
  }
  memory.set(key, { value: result.birth, at: now })
  try {
    await deps.store?.put(key, name, result.birth)
  } catch {
    /* store is optional */
  }
  return result.birth
}
