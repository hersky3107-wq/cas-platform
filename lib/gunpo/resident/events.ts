import 'server-only'

/**
 * SHARED Gunpo 축제·행사 (events) layer — 시민(resident) mode. STEP5: the
 * 한국문화정보원(문화정보, B553457/cultureinfo) integration from STEP3/4 was
 * DISCARDED entirely (region parameters never resolved to real Gunpo-scoped
 * data) and replaced with the SAME Perplexity architecture as
 * lib/gunpo/resident/news.ts (언론 chip): one KST-dated search call, sourced
 * from 군포시청 공식 홈페이지의 행사·축제 안내. Consumed by GET
 * /api/gunpo/resident/events.
 *
 * FRESHNESS GUARD (mirrors lib/gunpo/resident/news.ts):
 *   - Inject today's KST date (and the +14일 window end) into every prompt;
 *     require asOf per event.
 *   - Model is instructed to tag any stale/already-past instance of a
 *     recurring event (e.g. a 군포시청 page still showing 지난해 회차) with
 *     "[과거 자료]" — such items are then DROPPED here, never shown as an
 *     upcoming/current event.
 *   - Every kept item MUST carry a source url (군포시청 등 공식 페이지) —
 *     items without one are dropped, not silently shown without attribution.
 *   - DROP any event whose endDate (or startDate, if no endDate) is before
 *     today; keep only events overlapping [today, today+WINDOW_DAYS].
 *
 * RESIDENT LENS: 축제 / 공연전시 / 체험강좌 / 시정행사 / 기타 그룹 유지 (동네
 * 행사·주민 참여·문화강좌도 포함, 큰 축제만 다루지 않음).
 *
 * Caching: one payload per KST day in gunpo_events_cache (degrades to
 * no-cache if table missing). ?force=1 bypass.
 *
 * ISOLATION: 'server-only'; sessionId/userId null for AI; cache via
 * supabaseAdmin. MUST NOT import lib/jeju or lib/motie. Never throws.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import { cleanPerplexityText, extractJsonObject, kstNowIso, kstTodayIso, type ContextMeta } from './shared'

// ── Constants ─────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 20_000
const MAX_TOKENS = 2500
const PERPLEXITY_PROVIDER: ExtendedAiProviderName = 'perplexity'
const WINDOW_DAYS = 14
const FRESHNESS_NOTE = '🔍 검색(군포시청 공식 행사·축제 안내) 기반 (오늘부터 2주 이내)'

export const EVENT_GROUPS = ['축제', '공연전시', '체험강좌', '시정행사', '기타'] as const
export type EventGroup = (typeof EVENT_GROUPS)[number]

export type EventStatus = '진행중' | '예정'
export type EventSource = '검색'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EventItem {
  title: string
  group: EventGroup
  place: string | null
  startDate: string | null
  endDate: string | null
  price: string | null
  /** Source URL — REQUIRED for every item that survives filtering (STEP5). */
  url: string | null
  status: EventStatus
  source: EventSource
  asOf: string | null
}

export type EventGroups = Record<EventGroup, EventItem[]>

export interface EventsPayload {
  ok: true
  windowDays: number
  today: string
  groups: EventGroups
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
  fromCache: boolean
}

export type EventsResult = EventsPayload | { ok: false; error: string }

export interface GetEventsOptions {
  force?: boolean
}

const inflight = new Map<string, Promise<EventsPayload>>()

// ── Helpers ───────────────────────────────────────────────────────────────────

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'gunpo-events-no-db') as unknown as SupabaseClient
}

function emptyGroups(): EventGroups {
  return { 축제: [], 공연전시: [], 체험강좌: [], 시정행사: [], 기타: [] }
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = cleanPerplexityText(v)
  return s || null
}

/** Accepts YYYY-MM-DD (and tolerates '.'/'/' separators) — else null. */
function normalizeYmd(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = v.trim().match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (!m) return null
  const pad = (s: string) => s.padStart(2, '0')
  return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
}

function parseYmd(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return Number.isNaN(d.getTime()) ? null : d
}

function addDaysIso(iso: string, days: number): string {
  const d = parseYmd(iso)!
  d.setUTCDate(d.getUTCDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Perplexity's free-text group hint → normalized UI group. */
function toGroup(hint: string): EventGroup {
  const t = hint || ''
  if (/축제|festival|페스티벌|플리마켓|장터|한마당/.test(t)) return '축제'
  if (/시정|시청|행정|주민참여|공청|설명회|간담|정책|민원/.test(t)) return '시정행사'
  if (/교육|체험|강좌|워크숍|워크샵|클래스|아카데미|캠프|프로그램/.test(t)) return '체험강좌'
  if (/전시|공연|미술|음악|국악|무용|연극|뮤지컬|오페라|콘서트|클래식|영화|문학|전람|공예/.test(t))
    return '공연전시'
  return '기타'
}

function normTitle(t: string): string {
  return t.toLowerCase().replace(/[\s\-·,.()[\]{}!?'"~/]+/g, '')
}

function dedupe(items: EventItem[]): EventItem[] {
  const seen = new Map<string, EventItem>()
  for (const ev of items) {
    const key = `${normTitle(ev.title)}|${ev.startDate ?? ''}`
    if (!seen.has(key)) seen.set(key, ev)
  }
  return Array.from(seen.values())
}

function withinWindow(ev: EventItem, todayIso: string, endIso: string): boolean {
  if (!ev.startDate) return false
  const end = ev.endDate ?? ev.startDate
  if (end < todayIso) return false
  if (ev.startDate > endIso) return false
  return true
}

function groupAndSort(items: EventItem[]): EventGroups {
  const groups = emptyGroups()
  for (const ev of items) groups[ev.group].push(ev)
  for (const g of EVENT_GROUPS) {
    groups[g].sort((a, b) => {
      const cmp = (a.startDate ?? '').localeCompare(b.startDate ?? '')
      return cmp !== 0 ? cmp : a.title.localeCompare(b.title, 'ko')
    })
  }
  return groups
}

// ── Perplexity fetch (mirrors lib/gunpo/resident/news.ts's call shape) ─────────

function buildSystemPrompt(today: string, endIso: string): string {
  return (
    `오늘은 ${today}입니다 (KST). 가장 최신 정보 위주로 답하라. ` +
    '당신은 경기도 군포시 시민을 위한 행사·축제 안내 편집자입니다. ' +
    '군포시청 공식 홈페이지(대표 홈페이지, 문화관광/소식·행사 게시판 등)를 최우선 출처로 삼고, ' +
    '군포문화재단 및 군포시 산하 문화시설(반월호수공원, 철쭉동산 등) 공식 안내도 참고하세요. ' +
    `오늘(${today})부터 2주 이내(${endIso}까지) 열리는 축제·공연·전시·체험강좌·시정 행사·주민 참여 행사를 모으세요. ` +
    '【최신성 가드 — 반드시 지키세요】 페이지가 "지난해"·"작년" 회차 정보를 그대로 남겨두고 있거나 ' +
    '날짜가 이미 지난 과거 자료로 보이면 그 항목의 title 맨 앞에 "[과거 자료]"를 붙이세요(그런 항목은 이후 제거됩니다). ' +
    '올해/다가오는 실제 일정이 확인되지 않으면 아예 포함하지 마세요. 날짜를 추정하거나 지어내지 마세요. ' +
    '이미 종료된 행사(종료일이 오늘 이전)는 절대 넣지 마세요. ' +
    '한국어로만 답하세요. 인용 번호([1][3] 등)와 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    '반드시 아래 JSON 형식만 출력하세요(설명·마크다운·코드펜스 금지):\n' +
    '{"events":[{"title":"행사명","group":"축제|공연전시|체험강좌|시정행사|기타",' +
    '"place":"장소","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","price":"무료 또는 가격",' +
    '"url":"출처 URL(군포시청 등 공식 페이지)","asOf":"YYYY-MM-DD"}]}\n' +
    '각 행사에 시작일(가능하면 종료일도)을 YYYY-MM-DD로 넣고, url(출처)은 반드시 채우세요 — ' +
    'url을 모르면 그 항목은 아예 포함하지 마세요. 실제로 존재하고 날짜·출처를 아는 행사만 넣으세요. 지어내거나 패딩하지 마세요.'
  )
}

function buildPrompt(today: string, endIso: string): string {
  return (
    `군포시청 공식 홈페이지의 행사·축제 안내를 ${today} 기준으로 조회해 JSON으로 주세요. ` +
    `오늘부터 2주 이내(${endIso}까지) 열리는 축제·공연·전시·체험강좌·시정 행사·동네 행사를 찾고, ` +
    '각 항목에 출처 URL을 반드시 포함하세요. 이미 끝난 행사·출처 불명 항목·과거 회차 정보는 제외하세요.'
  )
}

async function fetchPerplexityEvents(
  today: string,
  endIso: string,
  errors: string[],
): Promise<{ items: EventItem[]; meta: ContextMeta }> {
  const retrievedAt = kstNowIso()
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: PERPLEXITY_PROVIDER,
      prompt: buildPrompt(today, endIso),
      systemPrompt: buildSystemPrompt(today, endIso),
      maxCompletionTokens: MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      temperature: 0.2,
      skipLanguageInjection: true,
    })
    if (r.error || !r.text?.trim()) {
      errors.push(`perplexity: ${r.error || 'empty'}`)
      return { items: [], meta: { source: '검색', retrievedAt, asOf: null } }
    }

    const cleaned = cleanPerplexityText(r.text)
    let parsed: unknown
    try {
      parsed = JSON.parse(extractJsonObject(cleaned))
    } catch {
      try {
        parsed = JSON.parse(extractJsonObject(r.text))
      } catch {
        errors.push('perplexity: JSON parse failed')
        return { items: [], meta: { source: '검색', retrievedAt, asOf: null } }
      }
    }

    const arr =
      parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).events)
        ? ((parsed as Record<string, unknown>).events as unknown[])
        : Array.isArray(parsed)
          ? (parsed as unknown[])
          : []

    const items: EventItem[] = []
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue
      const it = row as Record<string, unknown>

      const rawTitle = strOrNull(it.title)
      if (!rawTitle) continue

      // Model-tagged stale instance of a recurring event — the freshness
      // guard's whole point is to surface these so we can drop them, not
      // show them as this year's schedule.
      if (/\[\s*과거\s*자료\s*\]/.test(rawTitle)) {
        errors.push(`events: dropped "${rawTitle}" — tagged [과거 자료] (stale source page)`)
        continue
      }

      const url = strOrNull(it.url)
      if (!url) {
        errors.push(`events: dropped "${rawTitle}" — no source url`)
        continue
      }

      const startDate = normalizeYmd(it.startDate)
      const endDate = normalizeYmd(it.endDate)
      const groupHint = strOrNull(it.group) ?? ''

      items.push({
        title: rawTitle,
        group: toGroup(groupHint),
        place: strOrNull(it.place),
        startDate,
        endDate,
        price: strOrNull(it.price),
        url,
        status: startDate && startDate <= today ? '진행중' : '예정',
        source: '검색',
        asOf: normalizeYmd(it.asOf) ?? startDate,
      })
    }

    return { items, meta: { source: '검색', retrievedAt, asOf: today } }
  } catch (e: unknown) {
    errors.push(`perplexity: ${e instanceof Error ? e.message : String(e)}`)
    return { items: [], meta: { source: '검색', retrievedAt, asOf: null } }
  }
}

// ── Cache I/O (gunpo_events_cache — degrades to no-cache if table missing) ─────

async function readCache(cacheDate: string): Promise<EventsPayload | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('gunpo_events_cache')
      .select('payload')
      .eq('cache_date', cacheDate)
      .maybeSingle()
    if (error) {
      console.warn('[gunpo-events] cache read:', error.message)
      return null
    }
    if (!data?.payload || typeof data.payload !== 'object') return null
    const payload = data.payload as EventsPayload
    if (!payload.ok || !payload.groups) return null
    return { ...payload, fromCache: true }
  } catch (e: unknown) {
    console.warn('[gunpo-events] cache read threw:', e instanceof Error ? e.message : e)
    return null
  }
}

async function writeCache(cacheDate: string, payload: EventsPayload): Promise<EventsPayload> {
  try {
    const { error } = await supabaseAdmin.from('gunpo_events_cache').insert({
      cache_date: cacheDate,
      payload: { ...payload, fromCache: false },
    })
    if (!error) return payload
    const isConflict = error.code === '23505' || /duplicate|unique/i.test(error.message)
    if (isConflict) {
      console.log('[gunpo-events] cache race — re-reading winner for', cacheDate)
      const winner = await readCache(cacheDate)
      if (winner) return winner
    } else {
      console.warn('[gunpo-events] cache write:', error.message)
    }
  } catch (e: unknown) {
    console.warn('[gunpo-events] cache write threw:', e instanceof Error ? e.message : e)
  }
  return payload
}

// ── Build fresh payload ─────────────────────────────────────────────────────────

async function buildFreshPayload(): Promise<EventsPayload> {
  const errors: string[] = []
  const today = kstTodayIso()
  const endIso = addDaysIso(today, WINDOW_DAYS)
  console.log('[gunpo-events] fresh build (perplexity)', today, '→', endIso)

  const { items: rawItems, meta } = await fetchPerplexityEvents(today, endIso, errors)
  const deduped = dedupe(rawItems)
  const inWindow = deduped.filter((ev) => withinWindow(ev, today, endIso))

  const groups = groupAndSort(inWindow)
  if (inWindow.length === 0) errors.push('events: no events in window after filtering')

  return {
    ok: true,
    windowDays: WINDOW_DAYS,
    today,
    groups,
    contextMeta: meta,
    freshnessNote: FRESHNESS_NOTE,
    updatedAt: new Date().toISOString(),
    errors,
    fromCache: false,
  }
}

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Fetch Gunpo resident-lens events (오늘 → +14일), sourced from 군포시청 공식
 * 행사·축제 안내 via Perplexity search.
 * First request of a KST day → Perplexity call → cache in
 * gunpo_events_cache. Later requests same day → cache hit. Never throws.
 */
export async function getEvents(opts: GetEventsOptions = {}): Promise<EventsResult> {
  const cacheDate = kstTodayIso()
  const force = Boolean(opts.force)

  if (!force) {
    const cached = await readCache(cacheDate)
    if (cached) {
      console.log('[gunpo-events] cache hit', cacheDate)
      return cached
    }
  } else {
    console.log('[gunpo-events] force bypass cache', cacheDate)
  }

  const existing = inflight.get(cacheDate)
  if (existing && !force) {
    console.log('[gunpo-events] awaiting in-flight fetch', cacheDate)
    return existing
  }

  const work = (async (): Promise<EventsPayload> => {
    const fresh = await buildFreshPayload()
    if (force) return { ...fresh, fromCache: false }
    return writeCache(cacheDate, fresh)
  })()

  if (!force) inflight.set(cacheDate, work)
  try {
    return await work
  } finally {
    if (!force) inflight.delete(cacheDate)
  }
}
