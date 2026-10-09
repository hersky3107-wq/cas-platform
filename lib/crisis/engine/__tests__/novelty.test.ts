import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { coverageFromSignals, mainstreamFromSearch, noveltyFor, type CoverageItem } from '../coverage'
import { checkHunterRow, clusterDrafts, entityCorpus, entityGrounded, obviousList, parseLeadTime, type Draft } from '../hunter-rules'
import { hunterSystem } from '../prompts'
import { hangulOnly, obviousnessOf, reportedIn, runEngine, type ModelCaller, type Placed } from '../run'
import type { EngineCard } from '../schema'
import { citationRecords, normalizeSearchItems } from '../search-items'

const NOW = new Date('2026-10-09T00:00:00Z')

function card(): EngineCard {
  return {
    region_id: 7,
    name: 'Badulla',
    country: 'Sri Lanka',
    iso3: 'LKA',
    lat: 6.99,
    lon: 81.06,
    level: 1,
    horizon: '30d',
    components: [{ key: 'rain', value: 0.8, raw: { sum_mm: 210 } }],
    fragility: [{ kind: 'dam', name: 'Ulhitiya Dam' }],
    cascades: [{ id: 'c1', trigger: 'dam_failure', effect: 'flood' }],
    context: ['wiki: Uma Oya tunnel'],
    urban: [{ name: 'Badulla', pop: 47000 }],
  }
}

function row(extra: Record<string, unknown> = {}) {
  return {
    title: 'Ulhitiya spill floods the Uma Oya tunnel adit road',
    hazards: ['dam', 'flood'],
    departments: ['natural-hydro', 'infrastructure-economy'],
    entities: ['Ulhitiya Dam'],
    mechanism: 'A controlled spill is not a failure, so no warning goes to the road crews below.',
    lead_time_days: { min: 2, max: 12 },
    early_indicators: ['Spill gates open on two days running'],
    falsifier: 'The reservoir stays under the spill crest all month.',
    what_to_do: ['Keep off the river road when gates open.'],
    ...extra,
  }
}

function draftOf(extra: Record<string, unknown> = {}, id = 'h0', model = 'm1'): Draft {
  const c = card()
  const checked = checkHunterRow(row(extra), { model, id, card: c, corpus: entityCorpus(c, []) })
  if (!checked.draft) throw new Error(checked.reasons.join('; '))
  return checked.draft
}

function item(extra: Partial<CoverageItem>): CoverageItem {
  return { source: 'reliefweb', title: 'x', url: 'https://reliefweb.int/x', date: '2026-10-05', country_iso3: 'LKA', hazards: [], region_match: false, ...extra }
}

describe('hunter requirements', () => {
  it('accepts a row with all six and rejects each missing one', () => {
    const c = card()
    const corpus = entityCorpus(c, [])
    const check = (extra: Record<string, unknown>) => checkHunterRow(row(extra), { model: 'm', id: 'h0', card: c, corpus })
    expect(check({}).draft).not.toBeNull()
    expect(check({ departments: ['natural-hydro'] }).reasons).toContain('crosses fewer than 2 departments')
    expect(check({ entities: ['Badulla'] }).reasons[0]).toMatch(/entity not in card/)
    expect(check({ entities: ['Victoria Dam'] }).reasons[0]).toMatch(/entity not in card/)
    expect(check({ mechanism: 'rain causes flood' }).reasons).toContain('no hidden mechanism')
    expect(check({ lead_time_days: 'soon' }).reasons).toContain('no lead-time window in days')
    expect(check({ early_indicators: [] }).reasons).toContain('no early indicator')
    expect(check({ falsifier: '' }).reasons).toContain('no falsifier')
    const evidence = [
      { type: 'news', ref: '', url: 'https://adaderana.lk/n/1' },
      { type: 'dam', ref: '  ' },
      { type: '', ref: 'Ulhitiya Dam' },
      { type: 'rain', ref: 'card rain', url: '' },
    ]
    expect(check({ evidence }).draft?.evidence).toEqual([
      { type: 'news', ref: 'https://adaderana.lk/n/1', url: 'https://adaderana.lk/n/1' },
      { type: 'rain', ref: 'card rain' },
    ])
  })

  it('grounds an entity on a specific word, not a generic one or the place name', () => {
    const corpus = entityCorpus(card(), [
      { title: 'Passara road closed', url: 'https://x', published: '2026-10-08', past: false, source: 's' },
      { title: 'hospital in badulla temporarily closed due to risk of landslides', url: 'https://y', published: '2026-10-08', past: false, source: 's' },
    ])
    expect(entityGrounded('Passara road', corpus, card())).toBe(true)
    expect(entityGrounded('the dam', corpus, card())).toBe(false)
    expect(entityGrounded('Badulla district', corpus, card())).toBe(false)
    expect(entityGrounded('Badulla Hospital', corpus, card())).toBe(true)
    expect(entityGrounded('Badulla District General Hospital', corpus, card())).toBe(true)
    expect(entityGrounded('Badulla bridge', corpus, card())).toBe(false)
  })

  it('reads lead time as an object, a pair, a number, or a range string', () => {
    expect(parseLeadTime({ min: 3, max: 14 }, '30d')).toEqual({ min: 3, max: 14 })
    expect(parseLeadTime([10, 4], '30d')).toEqual({ min: 4, max: 10 })
    expect(parseLeadTime(5, '7d')).toEqual({ min: 5, max: 5 })
    expect(parseLeadTime('7-21 days', '30d')).toEqual({ min: 7, max: 21 })
    expect(parseLeadTime({ min: 0, max: 0 }, '30d')).toBeNull()
  })

  it('names the wanted and unwanted examples in the hunter prompt', () => {
    const system = hunterSystem()
    expect(system).toContain('a controlled spill is not classed as failure, so villages are not warned')
    expect(system).toContain('across the Mahaweli basin may be cut off before warnings reach people')
    expect(system).toContain('rain → landslide')
    expect(system).toContain('at most 2 possibilities')
  })

  it('builds the obvious list from fired components, fragility, and cascades', () => {
    const lines = obviousList(card()).map((entry) => entry.line)
    expect(lines).toContain('rain → landslide')
    expect(lines).toContain('rain → Ulhitiya Dam overtopping or failure')
    expect(lines).toContain('dam failure → flood')
  })
})

describe('dedupe', () => {
  it('clusters on a shared hazard and entity, or similar titles, and keeps others apart', () => {
    const a = draftOf({}, 'h0', 'm1')
    const b = draftOf({ title: 'Spill at Ulhitiya cuts road access for estate clinics' }, 'h1', 'm2')
    const c = draftOf({ title: 'Tea estate wage protest blocks the Passara road', hazards: ['unrest'], entities: ['Uma Oya'] }, 'h2', 'm3')
    expect(clusterDrafts([a, b, c], card())).toEqual([['h0', 'h1'], ['h2']])
  })
})

describe('coverage and novelty', () => {
  it('reads ReliefWeb, GDACS, and Metaculus rows for the country in the last 30 days', () => {
    const items = coverageFromSignals(
      [
        { source: 'reliefweb', signal_type: 'reliefweb_report', title: 'Sri Lanka: Floods in Badulla', url: 'https://reliefweb.int/a', country_iso3: 'LKA', region_id: null, event_time: '2026-10-05T00:00:00Z', value_raw: { kind: 'report', hazards: ['flood'], countries: ['LKA'] } },
        { source: 'reliefweb', signal_type: 'reliefweb_report', title: 'Old report', url: 'https://reliefweb.int/b', country_iso3: 'LKA', region_id: null, event_time: '2026-07-01T00:00:00Z', value_raw: { kind: 'report', hazards: ['flood'] } },
        { source: 'reliefweb', signal_type: 'reliefweb_report', title: 'Sri Lanka: Floods - Jun 2026', url: 'https://reliefweb.int/c', country_iso3: 'LKA', region_id: null, event_time: '2026-06-01T00:00:00Z', value_raw: { kind: 'disaster', status: 'ongoing', hazards: ['flood'] } },
        { source: 'gdacs', signal_type: 'FL', title: 'Orange alert', url: 'https://gdacs.org/f', country_iso3: 'LKA', region_id: 7, event_time: '2026-10-07T00:00:00Z', value_raw: {} },
        { source: 'metaculus', signal_type: 'metaculus_question', title: 'Will Sri Lanka see a dengue emergency?', url: 'https://metaculus.com/q/1', country_iso3: 'LKA', region_id: null, event_time: '2026-09-01T00:00:00Z', value_raw: { countries: ['LKA'], hazards: ['dengue', 'disease'], close_time: '2026-12-01T00:00:00Z' } },
      ],
      card(),
      NOW,
    )
    expect(items.map((entry) => [entry.source, entry.url, entry.region_match])).toEqual([
      ['reliefweb', 'https://reliefweb.int/a', true],
      ['reliefweb', 'https://reliefweb.int/c', false],
      ['gdacs', 'https://gdacs.org/f', true],
      ['metaculus', 'https://metaculus.com/q/1', false],
    ])
    expect(items[2].hazards).toContain('flood')
  })

  it('counts mainstream outlets and national ccTLD outlets that name the place', () => {
    const items = normalizeSearchItems(
      [
        { title: 'Badulla landslide warning extended', url: 'https://www.adaderana.lk/news/1', published: '2026-10-08' },
        { title: 'Sri Lanka floods kill 4', url: 'https://www.reuters.com/world/asia/1', published: '2026-10-07' },
        { title: 'Kenya floods', url: 'https://www.bbc.com/news/2', published: '2026-10-07' },
        { title: 'Badulla blog', url: 'https://someblog.example/3', published: '2026-10-07' },
      ],
      'sonar',
      NOW,
    )
    const out = mainstreamFromSearch(items, card(), NOW)
    expect(out.map((entry) => [entry.url, entry.region_match])).toEqual([
      ['https://www.adaderana.lk/news/1', true],
      ['https://www.reuters.com/world/asia/1', false],
    ])
  })

  it('is only_us when nothing covers the hazard, else also_seen_elsewhere with the best match', () => {
    const coverage = [
      item({ source: 'mainstream', url: 'https://reuters.com/a', hazards: ['flood'], region_match: true }),
      item({ source: 'reliefweb', url: 'https://reliefweb.int/b', hazards: ['flood'], region_match: true }),
      item({ source: 'metaculus', url: 'https://metaculus.com/c', hazards: ['dengue', 'disease'] }),
    ]
    expect(noveltyFor(['unrest'], coverage)).toEqual({ novelty: 'only_us', match: null, matches: 0 })
    const flood = noveltyFor(['dam', 'flood'], coverage)
    expect(flood.novelty).toBe('also_seen_elsewhere')
    expect(flood.match).toMatchObject({ source: 'reliefweb', url: 'https://reliefweb.int/b', scope: 'region', hazard: 'flood' })
    expect(noveltyFor(['cholera', 'disease'], coverage).novelty).toBe('only_us')
  })
})

describe('non-obviousness', () => {
  const placed = (draft: Draft, judge: Partial<NonNullable<Placed['judge']>> | null): Placed => ({
    draft,
    outsider: false,
    rank: 1,
    sourceIds: [draft.id],
    judge: judge
      ? { non_obviousness: 0.8, on_obvious_list: false, twist: '', reported_as_news: '', headline_ko: '', headline_en: '', brief_ko: '', brief_en: '', ...judge }
      : null,
  })

  it('is 0 when reported as news, or on the obvious list without a twist', () => {
    const draft = draftOf()
    const obvious = obviousList(card())
    const news = [item({ source: 'mainstream', title: 'Ulhitiya spill gates opened', url: 'https://adaderana.lk/u', date: '2026-10-06', hazards: ['dam'] })]
    expect(reportedIn(draft, card(), news, NOW)?.url).toBe('https://adaderana.lk/u')
    expect(obviousnessOf(placed(draft, {}), card(), obvious, news, NOW).non).toBe(0)
    expect(obviousnessOf(placed(draft, { reported_as_news: 'https://x.lk/1' }), card(), obvious, [], NOW, new Set(['https://x.lk/1'])).non).toBe(0)
    expect(obviousnessOf(placed(draft, { reported_as_news: 'https://made-up.example/1' }), card(), obvious, [], NOW, new Set(['https://x.lk/1'])).non).toBe(0.8)
    expect(obviousnessOf(placed(draft, { on_obvious_list: true }), card(), obvious, [], NOW)).toEqual({ non: 0, reason: 'on the obvious list without a twist' })
    expect(obviousnessOf(placed(draft, { on_obvious_list: true, twist: 'spill is not failure' }), card(), obvious, [], NOW).non).toBe(0.8)
    expect(obviousnessOf(placed(draft, null), card(), obvious, [], NOW).non).toBe(0.5)
    expect(obviousnessOf(placed(draftOf({ hazards: ['landslide'], title: 'Landslide on the Ulhitiya road' }), null), card(), obvious, [], NOW).non).toBe(0)
  })

  it('ranks by non_obviousness x stage, sends obvious ones to baseline, and takes the headline from the least obvious', async () => {
    const titles = ['Spill at Ulhitiya isolates estate clinics', 'Landslide closes the Ulhitiya road', 'Uma Oya tunnel seepage poisons wells']
    const fake: ModelCaller = {
      async complete(call) {
        const ok = (body: unknown) => ({ text: JSON.stringify(body), tokensIn: 1, tokensOut: 1, costUsd: 0 })
        if (call.role === 'dept_analyst') return ok({ notes: 'n' })
        if (call.role === 'query_writer') return ok({ queries: ['q1', 'q2', 'q3'] })
        if (call.role === 'search') return ok({ items: [] })
        if (call.role === 'hunter') {
          const index = Number(call.slot.length % 3)
          return ok({ hypotheses: [row({ title: titles[index], entities: index === 2 ? ['Uma Oya'] : ['Ulhitiya Dam'], hazards: index === 1 ? ['landslide'] : ['dam'] }), row(), row()] })
        }
        if (call.role === 'red_team') return ok({ notes: [] })
        const packet = JSON.parse(call.user) as { hypotheses: Array<{ id: string; title: string }> }
        return ok({
          groups: packet.hypotheses.map((h) => ({
            ids: [h.id],
            title: h.title,
            non_obviousness: h.title.startsWith('Landslide') ? 0.7 : h.title.startsWith('Uma Oya') ? 0.95 : 0.6,
            on_obvious_list: h.title.startsWith('Landslide'),
            twist: '',
            headline_en: h.title.startsWith('Uma Oya') ? 'Badulla: tunnel seepage reaches the wells' : '',
            headline_ko: h.title.startsWith('Uma Oya') ? '바둘라: 터널 누수가 우물로' : '',
            brief_en: '',
            brief_ko: '',
          })),
        })
      },
    }
    const record = await runEngine({ card: card(), caller: fake, now: NOW, coverage: [] })
    const result = record.result!
    expect(result.rejected?.some((entry) => entry.reasons[0] === 'over the 2 per hunter limit')).toBe(true)
    expect(result.hypotheses.length).toBeLessThanOrEqual(3)
    expect(result.baseline_risks?.every((entry) => entry.reason === 'on the obvious list without a twist')).toBe(true)
    expect(result.baseline_risks?.some((entry) => entry.title.startsWith('Landslide'))).toBe(true)
    expect([...result.hypotheses, ...result.outsider].some((entry) => entry.title.startsWith('Landslide'))).toBe(false)
    expect(result.headline_en).toBe('Badulla: tunnel seepage reaches the wells')
    expect(result.novelty_counts).toEqual({ only_us: expect.any(Number), also_seen_elsewhere: 0 })
    const all = result.hypotheses.length + result.outsider.length + (result.baseline_risks?.length ?? 0)
    expect(all).toBeGreaterThan(0)
    expect(result.hypotheses[0].early_indicators?.length).toBeGreaterThan(0)
    expect(result.hypotheses[0].falsifier).toBeTruthy()
    expect(result.headline_ko).toBe('바둘라: 터널 누수가 우물로')
  })

  it('keeps only Korean text in the _ko fields', () => {
    expect(hangulOnly('바둘라: 터널 누수')).toBe('바둘라: 터널 누수')
    expect(hangulOnly('ඉන්ධන මිල ඉහළයාම')).toBe('')
    expect(hangulOnly('Badulla')).toBe('')
    expect(hangulOnly(undefined)).toBe('')
  })
})

describe('search citations', () => {
  it('keeps the search_results title and date when citations list the same url first', () => {
    const rows = citationRecords([
      ['https://www.adaderana.lk/news/1'],
      [{ url: 'https://www.adaderana.lk/news/1', title: 'Badulla spill gates open', date: '2026-10-07' }],
    ], NOW)
    expect(rows).toEqual([{ url: 'https://www.adaderana.lk/news/1', title: 'Badulla spill gates open', published: '2026-10-07', snippet: undefined }])
  })

  it('drops citation-marker titles, reads the url slug, and keeps undated items out of coverage', () => {
    const rows = citationRecords([[{ url: 'https://www.dailymirror.lk/breaking-news/Badulla-reservoirs-spill-downstream-warning-issued/108-347670', title: '1' }]], NOW)
    expect(rows[0]).toMatchObject({ title: 'Badulla reservoirs spill downstream warning issued', published: '2026-10-09', undated: true })
    const items = normalizeSearchItems(rows, 'grok-live', NOW)
    expect(items[0].undated).toBe(true)
    expect(mainstreamFromSearch(items, card(), NOW)).toEqual([])
    const dated = citationRecords([[{ url: 'https://www.newswire.lk/2025/12/18/sluice-gates-at-three-major-reservoirs-opened-today/', title: '2' }]], NOW)
    expect(dated[0]).toEqual({ url: dated[0].url, title: 'sluice gates at three major reservoirs opened today', published: '2025-12-18', snippet: undefined })
  })
})
