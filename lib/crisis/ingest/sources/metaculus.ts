import { hazardsOf } from '../../config/hazard-taxonomy'
import { buildDedupeKey } from '../dedupe'
import { asArray, asRecord, finiteNumber, isoTime, politeFetch } from '../fetch'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'
import { collapseSignals } from '../upsert'
import { countriesInText } from './advisories'

export const METACULUS_POSTS = 'https://www.metaculus.com/api/posts/'
/** geopolitics, health, natural hazards (environment-climate), nuclear. */
export const METACULUS_CATEGORIES = ['geopolitics', 'health-pandemics', 'environment-climate', 'nuclear'] as const
export const METACULUS_PAGE = 100
export const METACULUS_MAX_PAGES = 4

function slugsOf(post: Record<string, unknown>): string[] {
  const projects = asRecord(post.projects)
  return asArray(projects?.category)
    .map((item) => asRecord(item)?.slug)
    .filter((slug): slug is string => typeof slug === 'string')
}

/** Binary community probability. Null when the token tier hides aggregations. */
export function communityProbability(question: Record<string, unknown> | null): number | null {
  const aggs = asRecord(question?.aggregations)
  const method = typeof question?.default_aggregation_method === 'string' ? question.default_aggregation_method : 'recency_weighted'
  const latest = asRecord(asRecord(aggs?.[method])?.latest) ?? asRecord(asRecord(aggs?.recency_weighted)?.latest)
  const centers = asArray(latest?.centers)
  const value = finiteNumber(centers[0])
  if (value == null || question?.type !== 'binary') return null
  return value
}

export function normalizeMetaculusPosts(payload: unknown, category: string): NormalizedSignal[] {
  const out: NormalizedSignal[] = []
  for (const item of asArray(asRecord(payload)?.results)) {
    const post = asRecord(item)
    if (!post || typeof post.title !== 'string') continue
    const id = finiteNumber(post.id)
    if (id == null) continue
    const question = asRecord(post.question)
    const slug = typeof post.slug === 'string' ? post.slug : typeof post.url_title === 'string' ? post.url_title : ''
    const countries = countriesInText(post.title)
    const probability = communityProbability(question)
    out.push({
      department: 'crowd_forecast',
      source: 'metaculus',
      signal_type: 'metaculus_question',
      title: post.title.slice(0, 300),
      lat: null,
      lon: null,
      country_iso3: countries[0] ?? null,
      value_num: probability,
      value_raw: {
        post_id: id,
        question_id: finiteNumber(question?.id),
        type: typeof question?.type === 'string' ? question.type : null,
        categories: [...new Set([category, ...slugsOf(post)])],
        countries,
        hazards: hazardsOf(post.title),
        community_probability: probability,
        probability_hidden: probability == null && question?.type === 'binary',
        close_time: isoTime(question?.scheduled_close_time ?? post.scheduled_close_time),
        forecasters: finiteNumber(post.nr_forecasters),
      },
      unit_raw: probability == null ? null : 'probability',
      event_time: isoTime(post.published_at ?? post.open_time ?? post.created_at),
      url: `https://www.metaculus.com/questions/${id}/${slug ? `${slug}/` : ''}`,
      dedupe_key: buildDedupeKey({ source: 'metaculus', signalType: 'metaculus_question', id }),
    })
  }
  return out
}

export const metaculusSource: CrisisSource = {
  key: 'metaculus',
  department: 'crowd_forecast',
  scheduleMinutes: 24 * 60,
  writes: 'signals',
  requiredEnv: ['METACULUS_TOKEN'],
  async fetch(ctx): Promise<IngestFetchResult> {
    const headers = { Authorization: `Token ${ctx.env.METACULUS_TOKEN?.trim() ?? ''}` }
    const signals: NormalizedSignal[] = []
    const notes: string[] = []
    let httpCalls = 0
    for (const category of METACULUS_CATEGORIES) {
      for (let page = 0; page < METACULUS_MAX_PAGES; page += 1) {
        const qs = `statuses=open&with_cp=true&order_by=-published_at&categories=${category}&limit=${METACULUS_PAGE}&offset=${page * METACULUS_PAGE}`
        const res = await politeFetch(`${METACULUS_POSTS}?${qs}`, { sourceKey: 'metaculus', minIntervalMs: 1500, timeoutMs: 45_000, headers })
        httpCalls += 1
        if (!res.ok) {
          notes.push(`${category} HTTP ${res.status}`)
          break
        }
        const rows = normalizeMetaculusPosts(res.data, category)
        signals.push(...rows)
        if (rows.length < METACULUS_PAGE || !asRecord(res.data)?.next) break
      }
    }
    const collapsed = collapseSignals(signals)
    const hidden = collapsed.filter((row) => row.value_raw?.probability_hidden === true).length
    if (!collapsed.length && notes.length) return { httpCalls, error: notes.join('; ') }
    return {
      httpCalls,
      signals: collapsed,
      quotaNote: [
        `n=${collapsed.length}`,
        `with_country=${collapsed.filter((row) => row.country_iso3).length}`,
        hidden ? `probability_hidden=${hidden} (api_access_tier restricted)` : null,
        notes.join('; ') || null,
      ].filter(Boolean).join('; '),
    }
  },
}
