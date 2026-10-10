import type { Prediction } from './predictions'
import { isoDate } from './window'

export type Verdict = 'hit' | 'miss' | 'unclear'

export interface EvidenceHit {
  title: string
  url: string
  source: 'gdacs' | 'reliefweb' | 'usgs' | 'web'
}

export interface OpenPrediction {
  id: number
  createdAt: string
  prediction: Prediction
  outcomeCount: number
}

export function storedOutcome(verdict: Verdict): 'happened' | 'did_not_happen' | 'partially' {
  if (verdict === 'hit') return 'happened'
  if (verdict === 'miss') return 'did_not_happen'
  return 'partially'
}

export function verdictPrefix(verdict: Verdict, note: string): string {
  return `${verdict}: ${note}`.trim()
}

export function parseVerdict(raw: string): { verdict: Verdict; note: string; url: string | null } | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { verdict?: string; note?: string; url?: string }
    const verdict = parsed.verdict
    if (verdict !== 'hit' && verdict !== 'miss' && verdict !== 'unclear') return null
    return {
      verdict,
      note: typeof parsed.note === 'string' ? parsed.note : '',
      url: typeof parsed.url === 'string' && parsed.url.startsWith('http') ? parsed.url : null,
    }
  } catch {
    return null
  }
}

export function windowEnded(windowEnd: string, now: Date): boolean {
  const end = Date.parse(`${windowEnd}T23:59:59Z`)
  return Number.isFinite(end) && now.getTime() > end
}

export function evidenceQueries(prediction: Prediction, appName = 'crisiswatch'): Array<{ source: EvidenceHit['source']; url: string }> {
  const q = encodeURIComponent(`${prediction.what} ${prediction.where}`)
  const since = prediction.window_start
  return [
    { source: 'gdacs', url: 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ,TC,FL,VO,WF,DR' },
    {
      source: 'reliefweb',
      url: `https://api.reliefweb.int/v1/reports?appname=${encodeURIComponent(appName)}&query[value]=${q}&limit=5&profile=list`,
    },
    {
      source: 'usgs',
      url: `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=time&limit=15&starttime=${since}`,
    },
    { source: 'usgs', url: 'https://volcanoes.usgs.gov/vsc/api/volcanoApi/vhpstatus' },
  ]
}

function mentions(text: string, prediction: Prediction): boolean {
  const hay = text.toLowerCase()
  const where = prediction.where.toLowerCase()
  const what = prediction.what.toLowerCase()
  return (where.length > 2 && hay.includes(where)) || hay.includes(what)
}

export function hitsFromPayload(source: EvidenceHit['source'], payload: unknown, prediction: Prediction): EvidenceHit[] {
  const hits: EvidenceHit[] = []
  const push = (title: string, url: string) => {
    if (!title || !url.startsWith('http')) return
    if (!mentions(`${title} ${url}`, prediction)) return
    hits.push({ title, url, source })
  }
  if (!payload || typeof payload !== 'object') return hits
  const rec = payload as Record<string, unknown>
  const features = Array.isArray(rec.features) ? rec.features : []
  for (const feature of features) {
    const props = (feature as { properties?: { title?: string; place?: string; url?: string } }).properties
    if (!props) continue
    push(props.title || props.place || '', props.url || '')
  }
  const data = Array.isArray(rec.data) ? rec.data : Array.isArray(rec.features) ? [] : []
  for (const row of data) {
    const item = row as { fields?: { title?: string; url?: string }; title?: string; url?: string; name?: string }
    push(item.fields?.title || item.title || item.name || '', item.fields?.url || item.url || '')
  }
  const events = Array.isArray(rec.features) ? [] : Array.isArray(rec.eventlist) ? rec.eventlist : Array.isArray(rec.events) ? rec.events : []
  for (const row of events) {
    const item = row as { title?: string; name?: string; eventname?: string; url?: string; link?: string }
    push(item.title || item.name || item.eventname || '', item.url || item.link || '')
  }
  return hits.slice(0, 8)
}

export interface OutcomeWrite {
  hypothesis_id: number
  outcome: 'happened' | 'did_not_happen' | 'partially'
  event_description: string
  event_date: string
  source_urls: string[]
  lead_time_days: number
}

export function decideOutcome(opts: {
  prediction: Prediction
  createdAt: string
  now: Date
  evidence: EvidenceHit[]
  judged: { verdict: Verdict; note: string; url: string | null } | null
}): OutcomeWrite | null {
  const ended = windowEnded(opts.prediction.window_end, opts.now)
  if (opts.evidence.length === 0) {
    if (!ended) return null
    return {
      hypothesis_id: 0,
      outcome: storedOutcome('miss'),
      event_description: verdictPrefix('miss', 'Window ended with no matching GDACS, ReliefWeb, USGS, or web report.'),
      event_date: isoDate(opts.now),
      source_urls: [],
      lead_time_days: leadDays(opts.createdAt, opts.now),
    }
  }
  const judged = opts.judged ?? { verdict: ended ? 'unclear' as const : 'unclear' as const, note: 'Evidence found but the judge did not return a verdict.', url: opts.evidence[0]?.url ?? null }
  if (!ended && judged.verdict === 'miss') return null
  const url = judged.url || opts.evidence[0]?.url || null
  return {
    hypothesis_id: 0,
    outcome: storedOutcome(judged.verdict),
    event_description: verdictPrefix(judged.verdict, judged.note || opts.evidence[0]?.title || ''),
    event_date: isoDate(opts.now),
    source_urls: url ? [url] : [],
    lead_time_days: leadDays(opts.createdAt, opts.now),
  }
}

function leadDays(createdAt: string, now: Date): number {
  const start = Date.parse(createdAt)
  if (!Number.isFinite(start)) return 0
  return Math.max(0, Math.round((now.getTime() - start) / 86_400_000))
}

export function judgeUser(prediction: Prediction, evidence: EvidenceHit[], now: Date): { system: string; user: string } {
  return {
    system: [
      'You judge whether a dated CrisisWatch prediction already happened.',
      'Reply JSON only: {"verdict":"hit"|"miss"|"unclear","note":"one sentence","url":"https://..."}',
      'hit: the observable consequence is in the evidence and falls inside the window.',
      'miss: the window has ended and the evidence shows it did not happen, or the evidence is about a different place.',
      'unclear: the evidence is related but does not confirm or refute the observable.',
      'A rain forecast, river forecast, or cyclone track is not a hit. The consequence itself must be reported.',
    ].join('\n'),
    user: JSON.stringify({
      today: isoDate(now),
      prediction,
      evidence: evidence.slice(0, 6),
    }),
  }
}
