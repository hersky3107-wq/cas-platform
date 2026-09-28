/**
 * KOBIS (영진위) weekend box office — the only entertainment slice that can
 * auto-grade. Awards, US grosses, and charts stay operator_manual.
 */

import {
  admissionsThreshold,
  decodeEntertainmentInstrument,
  type ShowParts,
} from '../gateway/adapters/entertainment-catalog'

export type KobisRankRow = {
  rank: number
  movieNm: string
  audiAcc: number
  audiCnt: number
}

export type KobisGrade = {
  direction: 'up' | 'down'
  rawOutcome: string
  resolutionPrice: number
  resolutionSessionDate: string
}

function fold(value: string): string {
  return value.toLowerCase().replace(/[\s:·,.!?'"\-–—()]/g, '')
}

export function movieMatches(movieNm: string, subject: string): boolean {
  const movie = fold(movieNm)
  const name = fold(subject)
  if (!movie || !name) return false
  return movie.includes(name) || name.includes(movie)
}

export function parseKobisWeeklyList(payload: unknown): KobisRankRow[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as { boxOfficeResult?: { weeklyBoxOfficeList?: unknown } }
  const list = root.boxOfficeResult?.weeklyBoxOfficeList
  if (!Array.isArray(list)) return []
  const out: KobisRankRow[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const movieNm = typeof row.movieNm === 'string' ? row.movieNm.trim() : ''
    const rank = Number(row.rank)
    const audiAcc = Number(row.audiAcc)
    const audiCnt = Number(row.audiCnt)
    if (!movieNm || !Number.isFinite(rank)) continue
    out.push({
      rank,
      movieNm,
      audiAcc: Number.isFinite(audiAcc) ? audiAcc : 0,
      audiCnt: Number.isFinite(audiCnt) ? audiCnt : 0,
    })
  }
  return out
}

/** Yes (up) / No (down) from a published weekend list. Null when the film is absent. */
export function decideKobisGrade(parts: ShowParts, rows: readonly KobisRankRow[], sessionDate: string): KobisGrade | null {
  if (parts.kind !== 'boxoffice' || parts.venue !== 'KR') return null
  const hit = rows.find((row) => movieMatches(row.movieNm, parts.subject))
  if (!hit) return null
  const threshold = admissionsThreshold(parts.event)
  if (parts.event === 'opening_1') {
    const yes = hit.rank === 1
    return {
      direction: yes ? 'up' : 'down',
      rawOutcome: `KOBIS weekend rank ${hit.rank}: ${hit.movieNm} (audiCnt ${hit.audiCnt})`,
      resolutionPrice: hit.rank,
      resolutionSessionDate: sessionDate,
    }
  }
  if (threshold != null) {
    const yes = hit.audiAcc >= threshold
    return {
      direction: yes ? 'up' : 'down',
      rawOutcome: `KOBIS audiAcc ${hit.audiAcc} vs ${threshold}: ${hit.movieNm}`,
      resolutionPrice: hit.audiAcc,
      resolutionSessionDate: sessionDate,
    }
  }
  return null
}

export function kobisTargetDt(resolvesAtMs: number): string {
  const iso = new Date(resolvesAtMs).toISOString()
  return iso.slice(0, 10).replace(/-/g, '')
}

export async function fetchKobisWeekend(targetDt: string, key = process.env.KOBIS_API_KEY): Promise<KobisRankRow[]> {
  if (!key) return []
  const url = `https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json?key=${encodeURIComponent(key)}&targetDt=${targetDt}&weekGb=1`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return []
  const json = (await res.json()) as unknown
  return parseKobisWeeklyList(json)
}

export async function gradeKrBoxOfficeInstrument(instrument: string, now = new Date()): Promise<KobisGrade | null> {
  const parts = decodeEntertainmentInstrument(instrument)
  if (!parts || parts.kind !== 'boxoffice' || parts.venue !== 'KR') return null
  if (parts.resolvesAtMs > now.getTime()) return null
  const targetDt = kobisTargetDt(parts.resolvesAtMs)
  const rows = await fetchKobisWeekend(targetDt)
  if (rows.length === 0) return null
  return decideKobisGrade(parts, rows, targetDt.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))
}
