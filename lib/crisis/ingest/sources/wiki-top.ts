import { HAZARD_TERM_STATUS, matchHazardTitle } from '../../config/hazard-terms'
import { WIKI_PROJECTS, WIKI_PROJECT_ISO3, wikiProjectLang, type WikiProject } from '../../config/wiki-projects'
import { buildDedupeKey } from '../dedupe'
import { asArray, asRecord, finiteNumber, politeFetch } from '../fetch'
import { loadCountryIdByIso3, loadStateSafe } from '../regions'
import type { CrisisSource, IngestFetchResult, NormalizedDaily, NormalizedSignal } from '../types'

export const WIKI_TOP_CAP = 1000
const SEEN_DAYS = 7

export function wikiTopUrl(project: string, day: Date): string {
  const y = day.getUTCFullYear()
  const m = String(day.getUTCMonth() + 1).padStart(2, '0')
  const d = String(day.getUTCDate()).padStart(2, '0')
  return `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${project}/all-access/${y}/${m}/${d}`
}

export function utcYesterday(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
}

export interface WikiTopArticle {
  article: string
  views: number
  rank: number
}

export function normalizeWikiTop(payload: unknown): WikiTopArticle[] {
  const rec = asRecord(payload)
  const items = asArray(rec?.items)
  const first = asRecord(items[0])
  const articles = asArray(first?.articles ?? rec?.articles)
  const out: WikiTopArticle[] = []
  for (const item of articles) {
    const row = asRecord(item)
    if (!row) continue
    const article = typeof row.article === 'string' ? row.article : typeof row.title === 'string' ? row.title : null
    const views = finiteNumber(row.views)
    const rank = finiteNumber(row.rank)
    if (!article || views == null || rank == null) continue
    if (/^(Special|Wikipedia|User|File|Template|Help|Category|Portal|Draft|MediaWiki):/i.test(article)) continue
    out.push({ article, views, rank })
    if (out.length >= WIKI_TOP_CAP) break
  }
  return out
}

export interface WikiMatch {
  project: string
  lang: string
  title: string
  rank: number
  views: number
  term: string
  concept: string
  status: typeof HAZARD_TERM_STATUS
}

export function matchWikiArticles(articles: WikiTopArticle[], project: string): WikiMatch[] {
  const lang = wikiProjectLang(project)
  const out: WikiMatch[] = []
  for (const row of articles) {
    const hit = matchHazardTitle(row.article, lang)
    if (!hit) continue
    out.push({
      project,
      lang,
      title: row.article.replace(/_/g, ' '),
      rank: row.rank,
      views: row.views,
      term: hit.term,
      concept: hit.concept,
      status: HAZARD_TERM_STATUS,
    })
  }
  return out
}

function seenKey(project: string, title: string): string {
  return `${wikiProjectLang(project)}:${title.replace(/_/g, ' ').toLowerCase()}`
}

function pruneSeen(seen: Record<string, string>, day: string): Record<string, string> {
  const cutoff = new Date(`${day}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - SEEN_DAYS)
  const keep: Record<string, string> = {}
  for (const [key, when] of Object.entries(seen)) {
    if (when >= cutoff.toISOString().slice(0, 10)) keep[key] = when
  }
  return keep
}

export const wikiTopSource: CrisisSource = {
  key: 'wiki_top',
  department: 'media',
  scheduleMinutes: 1440,
  writes: 'mixed',
  async fetch(ctx): Promise<IngestFetchResult> {
    const countryIds = await loadCountryIdByIso3(ctx.client).catch(() => new Map<string, number>())
    const state = ctx.dryRun ? null : await loadStateSafe(ctx.client, 'wiki_top')
    const seenRaw = asRecord(state?.cursor?.seen) ?? {}
    const seen: Record<string, string> = {}
    for (const [key, value] of Object.entries(seenRaw)) {
      if (typeof value === 'string') seen[key] = value
    }

    const day = utcYesterday(ctx.now)
    const dayKey = day.toISOString().slice(0, 10)
    const projects = ctx.dryRun ? WIKI_PROJECTS.slice(0, 1) : WIKI_PROJECTS
    let httpCalls = 0
    const matchesByCountry = new Map<string, WikiMatch[]>()
    const signals: NormalizedSignal[] = []
    const notes: string[] = []

    for (const project of projects) {
      const url = wikiTopUrl(project, day)
      const res = await politeFetch(url, {
        sourceKey: 'wiki_top',
        minIntervalMs: 200,
        headers: {
          'Api-User-Agent': 'AIMANI-CrisisIngest/2B2 (crisis ingest; wiki_top)',
        },
      })
      httpCalls += 1
      if (!res.ok) {
        notes.push(`${project} HTTP ${res.status}`)
        continue
      }
      const articles = normalizeWikiTop(res.data)
      const matches = matchWikiArticles(articles, project)
      const iso3 = WIKI_PROJECT_ISO3[project as WikiProject]
      if (iso3) {
        const list = matchesByCountry.get(iso3) ?? []
        list.push(...matches)
        matchesByCountry.set(iso3, list)
      }
      for (const match of matches) {
        const key = seenKey(project, match.title)
        const prior = seen[key]
        if (!prior) {
          signals.push({
            department: 'media',
            source: 'wiki_top',
            signal_type: 'wiki_new_top',
            title: `${match.title} (${project})`,
            lat: null,
            lon: null,
            country_iso3: iso3 ?? null,
            value_num: match.views,
            value_raw: { ...match, day: dayKey },
            unit_raw: 'pageviews',
            event_time: `${dayKey}T00:00:00.000Z`,
            url: `https://${project}/wiki/${encodeURIComponent(match.title.replace(/ /g, '_'))}`,
            dedupe_key: buildDedupeKey({
              source: 'wiki_top',
              signalType: 'wiki_new_top',
              id: `${project}|${match.title}|${dayKey}`,
              eventTime: dayKey,
            }),
          })
        }
        seen[key] = dayKey
      }
    }

    const daily: NormalizedDaily[] = []
    for (const [iso3, matches] of matchesByCountry) {
      const regionId = countryIds.get(iso3)
      if (regionId == null) continue
      daily.push({
        region_id: regionId,
        day: dayKey,
        source: 'wiki',
        stats: {
          matches: matches.map((row) => ({
            title: row.title,
            rank: row.rank,
            views: row.views,
            term: row.term,
            concept: row.concept,
            project: row.project,
            status: row.status,
          })),
        },
      })
    }

    return {
      httpCalls,
      daily,
      signals,
      cursor: { seen: pruneSeen(seen, dayKey), last_day: dayKey },
      quotaNote: [
        `projects=${projects.length}`,
        `matches=${[...matchesByCountry.values()].reduce((n, rows) => n + rows.length, 0)}`,
        `new_top=${signals.length}`,
        notes.length ? notes.join('; ') : null,
      ].filter(Boolean).join('; '),
    }
  },
}
