/**
 * Entertainment slate — objective metrics only.
 * Subjective "대박/흥행" never becomes a proposition; the resolver
 * expands a title into these rows.
 *
 * Dates are the late-Sep 2026 window (≤ ~3 months): KR openings around
 * 2026-09-30, US wide releases in November, The Game Awards 2026-12-10.
 */

export const ENTERTAINMENT_WINDOW_MS = 92 * 86_400_000

export type ShowKind = 'boxoffice' | 'chart' | 'award' | 'stream'

export type ShowMetric = {
  kind: ShowKind
  venue: string
  event: string
  subject: string
  resolvesAtIso: string
  aliases: readonly string[]
  /** Award-market implied percent when a book exists. Null = consensus must abstain. */
  marketPct: number | null
}

function row(partial: ShowMetric): ShowMetric {
  return partial
}

/** Upcoming objective propositions. Past titles live in PAST_SHOWS so "파묘 흥행" refuses as past. */
export const ENTERTAINMENT_SLATE: readonly ShowMetric[] = [
  row({
    kind: 'boxoffice',
    venue: 'KR',
    event: 'opening_1',
    subject: '치이카와',
    resolvesAtIso: '2026-10-04T15:00:00.000Z',
    aliases: ['치이카와', 'chiikawa', '인어섬'],
    marketPct: null,
  }),
  row({
    kind: 'boxoffice',
    venue: 'KR',
    event: 'admissions_3000000',
    subject: '치이카와',
    resolvesAtIso: '2026-10-21T15:00:00.000Z',
    aliases: ['치이카와', 'chiikawa', '인어섬'],
    marketPct: null,
  }),
  row({
    kind: 'boxoffice',
    venue: 'KR',
    event: 'opening_1',
    subject: '부활남',
    resolvesAtIso: '2026-10-04T15:00:00.000Z',
    aliases: ['부활남', 'buhwalnam', 'the red'],
    marketPct: null,
  }),
  row({
    kind: 'boxoffice',
    venue: 'KR',
    event: 'admissions_3000000',
    subject: '부활남',
    resolvesAtIso: '2026-10-21T15:00:00.000Z',
    aliases: ['부활남', 'buhwalnam'],
    marketPct: null,
  }),
  row({
    kind: 'boxoffice',
    venue: 'US',
    event: 'opening_1',
    subject: 'The Odyssey',
    resolvesAtIso: '2026-10-04T15:00:00.000Z',
    aliases: ['오디세이', 'the odyssey', 'odyssey'],
    marketPct: null,
  }),
  row({
    kind: 'boxoffice',
    venue: 'US',
    event: 'opening_1',
    subject: 'The Cat in the Hat',
    resolvesAtIso: '2026-11-08T15:00:00.000Z',
    aliases: ['캣 인 더 햇', 'cat in the hat', 'the cat in the hat'],
    marketPct: null,
  }),
  row({
    kind: 'boxoffice',
    venue: 'US',
    event: 'opening_1',
    subject: 'Godzilla Minus Zero',
    resolvesAtIso: '2026-11-08T15:00:00.000Z',
    aliases: ['고질라', 'godzilla minus zero', 'godzilla'],
    marketPct: null,
  }),
  row({
    kind: 'boxoffice',
    venue: 'US',
    event: 'opening_1',
    subject: 'The Hunger Games: Sunrise on the Reaping',
    resolvesAtIso: '2026-11-22T15:00:00.000Z',
    aliases: ['헝거게임', 'hunger games', 'sunrise on the reaping'],
    marketPct: null,
  }),
  row({
    kind: 'award',
    venue: 'tga',
    event: 'game_of_the_year',
    subject: 'Resident Evil Requiem',
    resolvesAtIso: '2026-12-11T02:00:00.000Z',
    aliases: ['바이오하자드', 'resident evil requiem', '바이오하자드 레퀴엠', 'tga', '게임 어워드', '올해의 게임'],
    marketPct: null,
  }),
  row({
    kind: 'award',
    venue: 'tga',
    event: 'game_of_the_year',
    subject: 'Ghost of Yotei',
    resolvesAtIso: '2026-12-11T02:00:00.000Z',
    aliases: ['고스트 오브 요테이', 'ghost of yotei', 'tga', '게임 어워드', '올해의 게임'],
    marketPct: null,
  }),
  row({
    kind: 'award',
    venue: 'tga',
    event: 'game_of_the_year',
    subject: 'Grand Theft Auto VI',
    resolvesAtIso: '2026-12-11T02:00:00.000Z',
    aliases: ['gta 6', 'gta6', 'gta vi', 'grand theft auto', 'tga', '게임 어워드', '올해의 게임'],
    marketPct: null,
  }),
]

/** Recognized but already released — resolver returns past, not a new round. */
export const PAST_SHOWS: readonly ShowMetric[] = [
  row({
    kind: 'boxoffice',
    venue: 'KR',
    event: 'opening_1',
    subject: '파묘',
    resolvesAtIso: '2024-02-25T15:00:00.000Z',
    aliases: ['파묘', 'exhuma'],
    marketPct: null,
  }),
  row({
    kind: 'boxoffice',
    venue: 'US',
    event: 'opening_1',
    subject: 'Avatar 3',
    resolvesAtIso: '2025-12-21T15:00:00.000Z',
    aliases: ['아바타3', '아바타 3', 'avatar 3', 'avatar fire and ash'],
    marketPct: null,
  }),
]

export const CHART_ARTISTS: readonly { subject: string; aliases: readonly string[] }[] = [
  { subject: 'NewJeans', aliases: ['뉴진스', 'newjeans', 'new jeans'] },
  { subject: 'IU', aliases: ['아이유', 'iu'] },
  { subject: 'BTS', aliases: ['방탄소년단', 'bts'] },
]

export function withinShowHorizon(resolvesAtMs: number, now: Date): boolean {
  const nowMs = now.getTime()
  return resolvesAtMs > nowMs - 6 * 60 * 60 * 1000 && resolvesAtMs <= nowMs + ENTERTAINMENT_WINDOW_MS
}
