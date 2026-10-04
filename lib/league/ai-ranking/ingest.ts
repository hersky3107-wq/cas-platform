/**
 * LMArena leaderboard ingest via Hugging Face parquet files.
 *
 * Server-only writes. Dry-run planning is pure and makes NO network call.
 * Apply downloads auto-converted parquet files directly from Hugging Face with:
 *   - Sequential downloads, at most one request per second
 *   - Retry on 429/5xx with exponential backoff (2s, 4s, 8s, 16s; max 5 tries)
 *     honoring Retry-After when present
 *   - Bearer auth when HF_TOKEN is set (never printed)
 *   - Local filesystem cache under scripts/league/out/hf-cache/ keyed by URL + ETag/last-modified
 *   - Pure-JS parquet parsing via hyparquet
 *   - Date filtering by publish_date after parsing
 */

import 'server-only'

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parquetMetadataAsync, parquetReadObjects } from 'hyparquet'
import { supabaseAdmin } from '@/lib/supabase/server'
import { mapVendorBrand, OTHER_VENDOR_BRAND, type MappedVendorBrand } from './brands'
import {
  LMARENA_ATTRIBUTION,
  LMARENA_DATASET,
  LMARENA_LICENSE,
  LMARENA_SOURCE,
} from './meta'

export { LMARENA_ATTRIBUTION, LMARENA_DATASET, LMARENA_LICENSE, LMARENA_SOURCE }

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
export const UPSERT_CHUNK = 500

export const RATE_LIMIT_MIN_GAP_MS = 1000
export const BACKOFF_DELAYS_MS = [2000, 4000, 8000, 16000] as const
export const MAX_RETRY_TRIES = 5

const TABLE = 'league_ai_leaderboard'
export const HF_PARQUET_LISTING_URL = `https://huggingface.co/api/datasets/${LMARENA_DATASET}/parquet`
export const DEFAULT_CACHE_DIR = path.resolve(process.cwd(), 'scripts/league/out/hf-cache')

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
  split: 'full' | 'latest'
  sinceDate: string
  untilDate: string
  months: typeof BACKFILL_MONTHS
  plannedFiles: string[]
  attribution: typeof LMARENA_ATTRIBUTION
  artificialAnalysis: typeof ARTIFICIAL_ANALYSIS_INGEST
}

export type IngestReport = {
  upserted: number
  skipped: number
  arenas: string[]
  cacheHits: number
  downloads: number
  unmappedOrganizations: string[]
}

export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface ParquetBatchChunk {
  rows: Record<string, unknown>[]
  readCount: number
  skippedCount: number
}

export interface ParquetBatchOptions {
  batchSize?: number
  sinceDate?: string
  untilDate?: string
}

export type AiLeaderboardIo = {
  now?: () => Date
  fetch?: FetchFn
  sleep?: (ms: number) => Promise<void>
  cacheDir?: string
  getHfToken?: () => string | undefined
  listParquetFiles?: () => Promise<Record<string, Record<string, string[]>>>
  downloadParquetFile?: (url: string, io: AiLeaderboardIo) => Promise<{ buffer: ArrayBuffer; cacheHit: boolean }>
  parseParquetRows?: (file: ArrayBuffer | Uint8Array) => Promise<Record<string, unknown>[]>
  parseParquetBatches?: (
    file: ArrayBuffer | Uint8Array,
    opts?: ParquetBatchOptions,
  ) => AsyncIterable<Record<string, unknown>[] | ParquetBatchChunk>
  upsertRows?: (rows: AiLeaderboardRow[]) => Promise<void>
  loadRows?: (source: string, arena: string, category: string, date: string) => Promise<AiLeaderboardRow[]>
  lastFetchedAt?: () => Promise<string | null>
  log?: (message: string) => void
  minGapMs?: number
  backoffDelays?: readonly number[]
  maxTries?: number
}

export function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function addUtcMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + months, d))
  return utcDate(dt)
}

export function standardParquetUrl(arena: string, split: 'full' | 'latest', index: number = 0): string {
  return `https://huggingface.co/api/datasets/${LMARENA_DATASET}/parquet/${arena}/${split}/${index}.parquet`
}

export function planAiLeaderboardIngest(now: Date = new Date(), split: 'full' | 'latest' = 'full'): IngestPlan {
  const untilDate = utcDate(now)
  const plannedFiles = BACKFILL_ARENAS.map((arena) => standardParquetUrl(arena, split, 0))
  return {
    source: LMARENA_SOURCE,
    dataset: LMARENA_DATASET,
    arenas: BACKFILL_ARENAS,
    split,
    sinceDate: addUtcMonths(untilDate, -BACKFILL_MONTHS),
    untilDate,
    months: BACKFILL_MONTHS,
    plannedFiles,
    attribution: LMARENA_ATTRIBUTION,
    artificialAnalysis: ARTIFICIAL_ANALYSIS_INGEST,
  }
}

export function alreadyRefreshedToday(now: Date, lastFetchedAt: string | null): boolean {
  if (!lastFetchedAt) return false
  return lastFetchedAt.slice(0, 10) === utcDate(now)
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'bigint') return String(value)
  return null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function publishDateOf(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }
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

export function parseRetryAfter(header: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!header || !header.trim()) return null
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) {
    const sec = parseInt(trimmed, 10)
    return Number.isFinite(sec) && sec >= 0 ? sec * 1000 : null
  }
  const dateMs = Date.parse(trimmed)
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - nowMs
    return diff > 0 ? diff : 0
  }
  return null
}

export function createRateLimitedFetch(opts: {
  fetch?: FetchFn
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  minGapMs?: number
  backoffDelays?: readonly number[]
  maxTries?: number
  getHfToken?: () => string | undefined
}) {
  const fetchFn = opts.fetch ?? fetch
  const sleepFn = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const nowFn = opts.now ?? (() => new Date())
  const minGap = opts.minGapMs ?? RATE_LIMIT_MIN_GAP_MS
  const backoffDelays = opts.backoffDelays ?? BACKOFF_DELAYS_MS
  const maxTries = opts.maxTries ?? MAX_RETRY_TRIES

  let lastRequestAtMs = 0

  return async function rateLimitedFetch(url: string, init?: RequestInit): Promise<Response> {
    const token = opts.getHfToken?.() ?? process.env.HF_TOKEN
    const headers = new Headers(init?.headers)
    if (!headers.has('User-Agent')) {
      headers.set('User-Agent', 'cas-platform-league-ai-ranking/1.0')
    }
    if (token?.trim() && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token.trim()}`)
    }

    for (let attempt = 0; attempt < maxTries; attempt++) {
      const nowMs = nowFn().getTime()
      const gap = nowMs - lastRequestAtMs
      if (lastRequestAtMs > 0 && gap < minGap) {
        await sleepFn(minGap - gap)
      }
      lastRequestAtMs = nowFn().getTime()

      const res = await fetchFn(url, { ...init, headers })
      if (res.status === 429 || res.status >= 500) {
        if (attempt === maxTries - 1) {
          throw new Error(`HTTP ${res.status} after ${maxTries} attempts for ${url}`)
        }
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'), nowFn().getTime())
        const baseDelay = backoffDelays[attempt] ?? 16000
        const delay = retryAfter != null ? Math.max(retryAfter, baseDelay) : baseDelay
        await sleepFn(delay)
        continue
      }
      if (!res.ok) {
        throw new Error(`Hugging Face request failed (${res.status}) for ${url}`)
      }
      return res
    }
    throw new Error(`Request failed after ${maxTries} attempts for ${url}`)
  }
}

export function cacheKeyForUrl(url: string): string {
  try {
    const u = new URL(url)
    const sanitizedPath = u.pathname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-40)
    const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)
    return `${sanitizedPath}_${hash}`
  } catch {
    const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16)
    return `parquet_${hash}`
  }
}

export async function downloadParquetFileWithCache(
  url: string,
  rateLimitedFetch: (url: string, init?: RequestInit) => Promise<Response>,
  io: AiLeaderboardIo = {},
): Promise<{ buffer: ArrayBuffer; cacheHit: boolean }> {
  const cacheDir = io.cacheDir ?? DEFAULT_CACHE_DIR
  const key = cacheKeyForUrl(url)
  const parquetPath = path.join(cacheDir, `${key}.parquet`)
  const metaPath = path.join(cacheDir, `${key}.meta.json`)

  if (fs.existsSync(parquetPath) && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { etag?: string | null; lastModified?: string | null }
      const headRes = await rateLimitedFetch(url, { method: 'HEAD' })
      const remoteEtag = headRes.headers.get('etag')
      const remoteLastModified = headRes.headers.get('last-modified')

      const etagMatches = Boolean(remoteEtag && meta.etag && remoteEtag === meta.etag)
      const dateMatches = Boolean(!remoteEtag && remoteLastModified && meta.lastModified && remoteLastModified === meta.lastModified)

      if (etagMatches || dateMatches) {
        const fileBuf = fs.readFileSync(parquetPath)
        const arrayBuffer = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength)
        return { buffer: arrayBuffer, cacheHit: true }
      }
    } catch {
      // On HEAD failure or corrupted cache, proceed to fresh download
    }
  }

  const getRes = await rateLimitedFetch(url, { method: 'GET' })
  const arrayBuffer = await getRes.arrayBuffer()
  const etag = getRes.headers.get('etag')
  const lastModified = getRes.headers.get('last-modified')

  try {
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(parquetPath, Buffer.from(arrayBuffer))
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          url,
          etag,
          lastModified,
          cachedAt: (io.now?.() ?? new Date()).toISOString(),
        },
        null,
        2,
      ),
    )
  } catch {
    // Non-fatal if filesystem cache isn't writable in serverless runtime
  }

  return { buffer: arrayBuffer, cacheHit: false }
}

function toArrayBuffer(file: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (file instanceof Uint8Array) {
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
  }
  return file
}

export async function parseParquetRows(file: ArrayBuffer | Uint8Array): Promise<Record<string, unknown>[]> {
  const ab = toArrayBuffer(file)
  const rows = await parquetReadObjects({ file: ab })
  return rows as Record<string, unknown>[]
}

export async function* readParquetRowBatches(
  file: ArrayBuffer | Uint8Array,
  options?: ParquetBatchOptions,
): AsyncGenerator<ParquetBatchChunk> {
  const ab = toArrayBuffer(file)

  let metadata: any
  try {
    metadata = await parquetMetadataAsync(ab)
  } catch {
    // If metadata parsing fails, fall back to whole-file read
  }

  if (metadata?.row_groups && metadata.row_groups.length > 0) {
    let currentRow = 0
    for (const rg of metadata.row_groups) {
      const count = Number(rg.num_rows)
      const rowStart = currentRow
      const rowEnd = currentRow + count
      currentRow = rowEnd

      // Check statistics on date column if available to skip row group
      const dateCol = rg.columns?.find((c: any) =>
        c.meta_data?.path_in_schema?.some((p: string) => {
          const lower = p.toLowerCase()
          return lower.includes('publish_date') || lower.includes('date')
        }),
      )
      const maxVal = dateCol?.meta_data?.statistics?.max_value ?? dateCol?.meta_data?.statistics?.max
      const minVal = dateCol?.meta_data?.statistics?.min_value ?? dateCol?.meta_data?.statistics?.min

      if (typeof maxVal === 'string' && options?.sinceDate && maxVal < options.sinceDate) {
        yield { rows: [], readCount: count, skippedCount: count }
        continue
      }
      if (typeof minVal === 'string' && options?.untilDate && minVal > options.untilDate) {
        yield { rows: [], readCount: count, skippedCount: count }
        continue
      }

      const rows = (await parquetReadObjects({
        file: ab,
        metadata,
        rowStart,
        rowEnd,
      })) as Record<string, unknown>[]

      yield { rows, readCount: count, skippedCount: 0 }
    }
    return
  }

  // Fallback for files without row_groups metadata
  const allRows = (await parquetReadObjects({ file: ab })) as Record<string, unknown>[]
  const chunkSize = options?.batchSize ?? 1000
  for (let i = 0; i < allRows.length; i += chunkSize) {
    const chunk = allRows.slice(i, i + chunkSize)
    yield { rows: chunk, readCount: chunk.length, skippedCount: 0 }
  }
}

async function defaultListParquetFiles(
  rateLimitedFetch: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<Record<string, Record<string, string[]>>> {
  const res = await rateLimitedFetch(HF_PARQUET_LISTING_URL, {
    headers: { Accept: 'application/json' },
  })
  return res.json()
}

export function dedupeLeaderboardRows(rows: readonly AiLeaderboardRow[]): AiLeaderboardRow[] {
  const map = new Map<string, AiLeaderboardRow>()
  for (const row of rows) {
    const key = `${row.source}|${row.arena}|${row.category}|${row.publish_date}|${row.model}`
    map.set(key, row)
  }
  return [...map.values()]
}

async function defaultUpsertRows(rows: AiLeaderboardRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const rawChunk = rows.slice(i, i + UPSERT_CHUNK)
    const dedupedChunk = dedupeLeaderboardRows(rawChunk)
    const chunk = dedupedChunk.map((row) => ({
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
  const now = io.now ?? (() => new Date())
  const rateLimitedFetch = createRateLimitedFetch({
    fetch: io.fetch,
    sleep: io.sleep,
    now,
    minGapMs: io.minGapMs,
    backoffDelays: io.backoffDelays,
    maxTries: io.maxTries,
    getHfToken: io.getHfToken,
  })

  return {
    now,
    fetch: rateLimitedFetch,
    cacheDir: io.cacheDir ?? DEFAULT_CACHE_DIR,
    listParquetFiles: io.listParquetFiles ?? (() => defaultListParquetFiles(rateLimitedFetch)),
    downloadParquetFile:
      io.downloadParquetFile ?? ((url: string) => downloadParquetFileWithCache(url, rateLimitedFetch, io)),
    parseParquetRows: io.parseParquetRows ?? parseParquetRows,
    parseParquetBatches: io.parseParquetBatches,
    hasCustomParseParquetRows: Boolean(io.parseParquetRows && io.parseParquetRows !== parseParquetRows),
    upsertRows: io.upsertRows ?? defaultUpsertRows,
    loadRows: io.loadRows ?? defaultLoadRows,
    lastFetchedAt: io.lastFetchedAt ?? defaultLastFetchedAt,
    log: io.log ?? ((message: string) => console.log(message)),
  }
}

async function* getRowBatches(
  buffer: ArrayBuffer,
  bound: ReturnType<typeof bindIo>,
  sinceDate?: string,
  untilDate?: string,
): AsyncGenerator<ParquetBatchChunk> {
  if (bound.parseParquetBatches) {
    for await (const batch of bound.parseParquetBatches(buffer, { sinceDate, untilDate })) {
      if (Array.isArray(batch)) {
        yield { rows: batch, readCount: batch.length, skippedCount: 0 }
      } else {
        yield batch
      }
    }
    return
  }

  if (bound.hasCustomParseParquetRows) {
    const rawRows = await bound.parseParquetRows(buffer)
    const chunkSize = 1000
    for (let i = 0; i < rawRows.length; i += chunkSize) {
      const chunk = rawRows.slice(i, i + chunkSize)
      yield { rows: chunk, readCount: chunk.length, skippedCount: 0 }
    }
    return
  }

  yield* readParquetRowBatches(buffer, { sinceDate, untilDate })
}

export async function ingestAiLeaderboard(args: {
  arenas?: readonly string[]
  split?: 'full' | 'latest'
  sinceDate?: string
  untilDate?: string
  io?: AiLeaderboardIo
}): Promise<IngestReport> {
  const io = bindIo(args.io)
  const split = args.split ?? 'full'
  const fetchedAt = io.now().toISOString()

  let listing: Record<string, Record<string, string[]>> = {}
  try {
    listing = await io.listParquetFiles()
  } catch (err) {
    io.log(`[ai-leaderboard] listing lookup failed, using fallback URLs: ${err instanceof Error ? err.message : String(err)}`)
  }

  const requestedArenas = args.arenas ?? BACKFILL_ARENAS
  const targetArenas = requestedArenas.filter((arena) => {
    if (Object.keys(listing).length === 0) return true
    return Boolean(listing[arena]?.[split]?.length)
  })

  let upserted = 0
  let skipped = 0
  let cacheHits = 0
  let downloads = 0
  const unmappedOrgs = new Set<string>()

  for (const arena of targetArenas) {
    const urls = listing[arena]?.[split] ?? [standardParquetUrl(arena, split, 0)]
    let arenaUpserted = 0
    let arenaSkipped = 0
    let arenaRead = 0
    let arenaInWindow = 0

    for (const url of urls) {
      const { buffer, cacheHit } = await io.downloadParquetFile(url, args.io ?? {})
      if (cacheHit) cacheHits += 1
      else downloads += 1

      let pendingUpsert: AiLeaderboardRow[] = []
      let lastProgressReport = 0

      for await (const batch of getRowBatches(buffer, io, args.sinceDate, args.untilDate)) {
        arenaRead += batch.readCount
        arenaSkipped += batch.skippedCount

        for (const raw of batch.rows) {
          const pubDate = publishDateOf(raw.leaderboard_publish_date) ?? publishDateOf(raw.publish_date)
          if (args.sinceDate && pubDate && pubDate < args.sinceDate) {
            arenaSkipped += 1
            continue
          }
          if (args.untilDate && pubDate && pubDate > args.untilDate) {
            arenaSkipped += 1
            continue
          }

          const mapped = mapLmarenaRow(arena, raw, fetchedAt)
          if (!mapped) {
            arenaSkipped += 1
            continue
          }
          if (args.sinceDate && mapped.publish_date < args.sinceDate) {
            arenaSkipped += 1
            continue
          }
          if (args.untilDate && mapped.publish_date > args.untilDate) {
            arenaSkipped += 1
            continue
          }

          arenaInWindow += 1
          if (mapped.brand === OTHER_VENDOR_BRAND && mapped.organization?.trim()) {
            unmappedOrgs.add(mapped.organization.trim())
          }

          pendingUpsert.push(mapped)

          if (pendingUpsert.length >= UPSERT_CHUNK) {
            await io.upsertRows(pendingUpsert)
            arenaUpserted += pendingUpsert.length
            pendingUpsert = []

            if (arenaUpserted - lastProgressReport >= 25000) {
              lastProgressReport = arenaUpserted
              io.log(
                `[ai-leaderboard] arena=${arena} split=${split} progress: read=${arenaRead} in_window=${arenaInWindow} upserted=${arenaUpserted}`,
              )
            }
          }
        }
      }

      if (pendingUpsert.length > 0) {
        await io.upsertRows(pendingUpsert)
        arenaUpserted += pendingUpsert.length
        pendingUpsert = []
      }
    }

    upserted += arenaUpserted
    skipped += arenaSkipped
    io.log(
      `[ai-leaderboard] arena=${arena} split=${split} read=${arenaRead} in_window=${arenaInWindow} upserted=${arenaUpserted} skipped=${arenaSkipped}`,
    )
  }

  return {
    upserted,
    skipped,
    arenas: targetArenas,
    cacheHits,
    downloads,
    unmappedOrganizations: [...unmappedOrgs].sort((a, b) => a.localeCompare(b)),
  }
}

export async function listLeaderboardPublishDates(arena: string, category: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('publish_date')
    .eq('source', LMARENA_SOURCE)
    .eq('arena', arena)
    .eq('category', category)
  if (error) throw new Error(`league_ai_leaderboard dates read failed: ${error.message}`)
  return [...new Set((data ?? []).map((row) => String(row.publish_date).slice(0, 10)))].sort()
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
    bound.log(`[league-generate] ai-leaderboard fetched upserted=${report.upserted} cacheHits=${report.cacheHits} downloads=${report.downloads}`)
    return { action: 'fetched', upserted: report.upserted }
  } catch {
    bound.log('[league-generate] ai-leaderboard skipped reason=error')
    return { action: 'skip', reason: 'error' }
  }
}
