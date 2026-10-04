/**
 * LMArena leaderboard ingest. Server-only writes. Dry-run planning is pure
 * and makes no network call. Apply fetches the public Hugging Face
 * datasets-server API (no lmarena.ai scraping).
 */

import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { mapVendorBrand, OTHER_VENDOR_BRAND, type MappedVendorBrand } from './brands'

export const LMARENA_DATASET = 'lmarena-ai/leaderboard-dataset'
export const LMARENA_SOURCE = 'lmarena'
export const LMARENA_LICENSE = 'cc-by-4.0'
export const LMARENA_ATTRIBUTION = '순위 데이터: LMArena (CC BY 4.0)'

/**
 * Artificial Analysis has a public API (x-api-key; free tier ~100–1,000
 * req/day depending on the doc page). Free/Pro terms limit customer-facing
 * ranking and raw redistribution; a Competitive Product clause applies.
 * Status: not ingested.
 */
export const ARTIFICIAL_ANALYSIS_INGEST = 'not ingested' as const

export const BACKFILL_ARENAS = [
  'text',
  'webdev',
  'vision',
  'text_to_image',
  'text_to_video',
  'search',
] as const

export type BackfillArena = (typeof BACKFILL_ARENAS)[number]
export const BACKFILL_MONTHS = 6
export const HF_PAGE_SIZE = 100
export const UPSERT_CHUNK = 200

const TABLE = 'league_ai_leaderboard'
const HF_SPLITS = `https://datasets-server.huggingface.co/splits?dataset=${LMARENA_DATASET}`
const HF_ROWS = 'https://datasets-server.huggingface.co/rows'
const HF_FILTER = 'https://datasets-server.huggingface.co/filter'

export const LMARENA_TEXT_CATEGORIES = [
  'overall',
  'coding',
  'math',
  'creative_writing',
  'hard_prompts',
  'hard_prompts_english',
  'instruction_following',
  'longer_query',
  'multi_turn',
  'exclude_ties',
  'expert',
  'english',
  'non_english',
  'chinese',
  'korean',
  'japanese',
  'spanish',
  'german',
  'french',
  'russian',
  'polish',
  'industry_software_and_it_services',
  'industry_life_and_physical_and_social_science',
  'industry_business_and_management_and_financial_operations',
  'industry_entertainment_and_sports_and_media',
  'industry_medicine_and_healthcare',
  'industry_mathematical',
  'industry_legal_and_government',
  'industry_writing_and_literature_and_language',
] as const

export const LMARENA_HAS_KOREAN_CATEGORY = true

export type AiLeaderboardRow = {
  source: string
  arena: string
  category: string
  publish_date: string
  model: string
  organization: string | null
  brand: MappedVendorBrand
  rank: number
  score: number | null
  votes: number | null
  fetched_at?: string
}

export type BrandRank = {
  brand: MappedVendorBrand
  model: string
  rank: number
  score: number | null
}

export type IngestPlan = {
  source: typeof LMARENA_SOURCE
  dataset: typeof LMARENA_DATASET
  arenas: readonly BackfillArena[]
  sinceDate: string
  untilDate: string
  months: typeof BACKFILL_MONTHS
  attribution: typeof LMARENA_ATTRIBUTION
  artificialAnalysis: typeof ARTIFICIAL_ANALYSIS_INGEST
}

export type IngestReport = {
  upserted: number
  skipped: number
  arenas: string[]
  unmappedOrganizations: string[]
}

export type HfArenaPage = {
  config: string
  split: string
  offset: number
  length: number
  sinceDate?: string
}

export type AiLeaderboardIo = {
  now?: () => Date
  fetchJson?: (url: string) => Promise<unknown>
  listArenas?: () => Promise<string[]>
  fetchPage?: (page: HfArenaPage) => Promise<Record<string, unknown>[]>
  upsertRows?: (rows: AiLeaderboardRow[]) => Promise<void>
  loadRows?: (source: string, arena: string, category: string, date: string) => Promise<AiLeaderboardRow[]>
  lastFetchedAt?: () => Promise<string | null>
  log?: (message: string) => void
}

export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function addUtcMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + months, d))
  return utcDate(dt)
}

export function planAiLeaderboardIngest(now: Date = new Date()): IngestPlan {
  const untilDate = utcDate(now)
  return {
    source: LMARENA_SOURCE,
    dataset: LMARENA_DATASET,
    arenas: BACKFILL_ARENAS,
    sinceDate: addUtcMonths(untilDate, -BACKFILL_MONTHS),
    untilDate,
    months: BACKFILL_MONTHS,
    attribution: LMARENA_ATTRIBUTION,
    artificialAnalysis: ARTIFICIAL_ANALYSIS_INGEST,
  }
}

export function alreadyRefreshedToday(now: Date, lastFetchedAt: string | null): boolean {
  if (!lastFetchedAt) return false
  return lastFetchedAt.slice(0, 10) === utcDate(now)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function publishDateOf(value: unknown): string | null {
  const raw = asString(value)
  if (!raw) return null
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

export function mapLmarenaRow(arena: string, raw: Record<string, unknown>, fetchedAt: string): AiLeaderboardRow | null {
  const model = asString(raw.model_name) ?? asString(raw.model)
  const category = asString(raw.category)
  const publish_date = publishDateOf(raw.leaderboard_publish_date) ?? publishDateOf(raw.publish_date)
  const rank = asNumber(raw.rank)
  if (!model || !category || !publish_date || rank == null) return null
  const organization = asString(raw.organization)
  const mapped = mapVendorBrand(organization, model)
  return {
    source: LMARENA_SOURCE,
    arena,
    category,
    publish_date,
    model,
    organization,
    brand: mapped.brand,
    rank: Math.round(rank),
    score: asNumber(raw.rating) ?? asNumber(raw.score),
    votes: asNumber(raw.vote_count) ?? asNumber(raw.observation_count),
    fetched_at: fetchedAt,
  }
}

export function collectUnmappedOrganizations(rows: readonly Pick<AiLeaderboardRow, 'organization' | 'brand'>[]): string[] {
  const seen = new Set<string>()
  for (const row of rows) {
    if (row.brand !== OTHER_VENDOR_BRAND) continue
    const org = row.organization?.trim()
    if (org) seen.add(org)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/**
 * Brands ordered by their best model's rank (lower is better). Same-rank
 * brands sort by brand name. Same-brand models keep the better rank, then
 * the earlier model name.
 */
export function brandRanking(
  source: string,
  arena: string,
  category: string,
  date: string,
  rows: readonly AiLeaderboardRow[],
): BrandRank[] {
  const best = new Map<MappedVendorBrand, BrandRank>()
  for (const row of rows) {
    if (row.source !== source || row.arena !== arena || row.category !== category || row.publish_date !== date) {
      continue
    }
    const next: BrandRank = { brand: row.brand, model: row.model, rank: row.rank, score: row.score }
    const prev = best.get(row.brand)
    if (!prev || next.rank < prev.rank || (next.rank === prev.rank && next.model.localeCompare(prev.model) < 0)) {
      best.set(row.brand, next)
    }
  }
  return [...best.values()].sort((a, b) => a.rank - b.rank || a.brand.localeCompare(b.brand))
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'cas-platform-league-ai-ranking/1.0' },
  })
  if (!res.ok) throw new Error(`Hugging Face datasets-server ${res.status} for ${url}`)
  return res.json()
}

function splitsOf(payload: unknown): string[] {
  const root = asRecord(payload)
  const splits = Array.isArray(root?.splits) ? root.splits : []
  const names = new Set<string>()
  for (const item of splits) {
    const row = asRecord(item)
    const config = asString(row?.config)
    if (config) names.add(config)
  }
  return [...names]
}

function pageRowsOf(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload)
  const rows = Array.isArray(root?.rows) ? root.rows : []
  const out: Record<string, unknown>[] = []
  for (const item of rows) {
    const wrapper = asRecord(item)
    const row = asRecord(wrapper?.row) ?? wrapper
    if (row) out.push(row)
  }
  return out
}

function rowsUrl(page: HfArenaPage): string {
  const url = new URL(HF_ROWS)
  url.searchParams.set('dataset', LMARENA_DATASET)
  url.searchParams.set('config', page.config)
  url.searchParams.set('split', page.split)
  url.searchParams.set('offset', String(page.offset))
  url.searchParams.set('length', String(page.length))
  return url.toString()
}

function filterUrl(page: HfArenaPage): string {
  const url = new URL(HF_FILTER)
  url.searchParams.set('dataset', LMARENA_DATASET)
  url.searchParams.set('config', page.config)
  url.searchParams.set('split', page.split)
  url.searchParams.set('offset', String(page.offset))
  url.searchParams.set('length', String(page.length))
  if (page.sinceDate) url.searchParams.set('where', `leaderboard_publish_date>='${page.sinceDate}'`)
  return url.toString()
}

async function defaultListArenas(fetchJson: (url: string) => Promise<unknown>): Promise<string[]> {
  return splitsOf(await fetchJson(HF_SPLITS))
}

async function defaultFetchPage(
  page: HfArenaPage,
  fetchJson: (url: string) => Promise<unknown>,
): Promise<Record<string, unknown>[]> {
  if (page.sinceDate) {
    try {
      return pageRowsOf(await fetchJson(filterUrl(page)))
    } catch {
      // datasets-server /filter where-syntax varies; fall back to /rows.
    }
  }
  return pageRowsOf(await fetchJson(rowsUrl(page)))
}

async function defaultUpsertRows(rows: AiLeaderboardRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map((row) => ({
      source: row.source,
      arena: row.arena,
      category: row.category,
      publish_date: row.publish_date,
      model: row.model,
      organization: row.organization,
      brand: row.brand,
      rank: row.rank,
      score: row.score,
      votes: row.votes,
      fetched_at: row.fetched_at,
    }))
    const { error } = await supabaseAdmin.from(TABLE).upsert(chunk)
    if (error) throw new Error(`league_ai_leaderboard upsert failed: ${error.message}`)
  }
}

async function defaultLoadRows(
  source: string,
  arena: string,
  category: string,
  date: string,
): Promise<AiLeaderboardRow[]> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('source,arena,category,publish_date,model,organization,brand,rank,score,votes')
    .eq('source', source)
    .eq('arena', arena)
    .eq('category', category)
    .eq('publish_date', date)
    .order('rank', { ascending: true })
  if (error) throw new Error(`league_ai_leaderboard read failed: ${error.message}`)
  return (data ?? []).map((row) => ({
    source: String(row.source),
    arena: String(row.arena),
    category: String(row.category),
    publish_date: String(row.publish_date).slice(0, 10),
    model: String(row.model),
    organization: row.organization == null ? null : String(row.organization),
    brand: (row.brand == null ? OTHER_VENDOR_BRAND : String(row.brand)) as MappedVendorBrand,
    rank: Number(row.rank),
    score: row.score == null ? null : Number(row.score),
    votes: row.votes == null ? null : Number(row.votes),
  }))
}

async function defaultLastFetchedAt(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('fetched_at')
    .eq('source', LMARENA_SOURCE)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`league_ai_leaderboard fetched_at read failed: ${error.message}`)
  return data?.fetched_at ? String(data.fetched_at) : null
}

function bindIo(io: AiLeaderboardIo = {}) {
  const fetchJson = io.fetchJson ?? defaultFetchJson
  return {
    now: io.now ?? (() => new Date()),
    fetchJson,
    listArenas: io.listArenas ?? (() => defaultListArenas(fetchJson)),
    fetchPage: io.fetchPage ?? ((page: HfArenaPage) => defaultFetchPage(page, fetchJson)),
    upsertRows: io.upsertRows ?? defaultUpsertRows,
    loadRows: io.loadRows ?? defaultLoadRows,
    lastFetchedAt: io.lastFetchedAt ?? defaultLastFetchedAt,
    log: io.log ?? ((message: string) => console.log(message)),
  }
}

export async function ingestArenaWindow(args: {
  arena: string
  split: 'full' | 'latest'
  sinceDate?: string
  fetchedAt: string
  io?: AiLeaderboardIo
}): Promise<{ rows: AiLeaderboardRow[]; skipped: number }> {
  const io = bindIo(args.io)
  const rows: AiLeaderboardRow[] = []
  let skipped = 0
  let offset = 0
  for (;;) {
    const page = await io.fetchPage({
      config: args.arena,
      split: args.split,
      offset,
      length: HF_PAGE_SIZE,
      sinceDate: args.sinceDate,
    })
    if (page.length === 0) break
    for (const raw of page) {
      const mapped = mapLmarenaRow(args.arena, raw, args.fetchedAt)
      if (!mapped) {
        skipped += 1
        continue
      }
      if (args.sinceDate && mapped.publish_date < args.sinceDate) {
        skipped += 1
        continue
      }
      rows.push(mapped)
    }
    offset += page.length
    if (page.length < HF_PAGE_SIZE) break
  }
  return { rows, skipped }
}

export async function ingestAiLeaderboard(args: {
  arenas?: readonly string[]
  split: 'full' | 'latest'
  sinceDate?: string
  io?: AiLeaderboardIo
}): Promise<IngestReport> {
  const io = bindIo(args.io)
  const fetchedAt = io.now().toISOString()
  const available = new Set(await io.listArenas())
  const wanted = args.arenas ?? BACKFILL_ARENAS
  const arenas = wanted.filter((name) => available.has(name))
  let upserted = 0
  let skipped = 0
  const allRows: AiLeaderboardRow[] = []
  for (const arena of arenas) {
    const batch = await ingestArenaWindow({
      arena,
      split: args.split,
      sinceDate: args.sinceDate,
      fetchedAt,
      io: args.io,
    })
    skipped += batch.skipped
    if (batch.rows.length === 0) continue
    await io.upsertRows(batch.rows)
    upserted += batch.rows.length
    allRows.push(...batch.rows)
    io.log(`[ai-leaderboard] arena=${arena} upserted=${batch.rows.length} skipped=${batch.skipped}`)
  }
  return {
    upserted,
    skipped,
    arenas,
    unmappedOrganizations: collectUnmappedOrganizations(allRows),
  }
}

export async function brandRankingFromStore(
  source: string,
  arena: string,
  category: string,
  date: string,
  io: AiLeaderboardIo = {},
): Promise<BrandRank[]> {
  const bound = bindIo(io)
  const rows = await bound.loadRows(source, arena, category, date)
  return brandRanking(source, arena, category, date, rows)
}

export async function refreshAiLeaderboardDaily(io: AiLeaderboardIo = {}): Promise<{
  action: 'skip' | 'fetched'
  reason?: 'already_today' | 'error'
  upserted?: number
}> {
  const bound = bindIo(io)
  try {
    const last = await bound.lastFetchedAt()
    const now = bound.now()
    if (alreadyRefreshedToday(now, last)) {
      bound.log('[league-generate] ai-leaderboard skipped reason=already_today')
      return { action: 'skip', reason: 'already_today' }
    }
    const report = await ingestAiLeaderboard({ split: 'latest', io })
    bound.log(`[league-generate] ai-leaderboard fetched upserted=${report.upserted}`)
    return { action: 'fetched', upserted: report.upserted }
  } catch {
    bound.log('[league-generate] ai-leaderboard skipped reason=error')
    return { action: 'skip', reason: 'error' }
  }
}
