import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCatalogRankedRoundInput } from '../catalog'

const CARD_ROUTE = readFileSync(join(__dirname, '../../../app/api/league/card/route.ts'), 'utf8')
const GENERATE_ROUTE = readFileSync(join(__dirname, '../../../app/api/league/generate/route.ts'), 'utf8')

describe('GET /api/league/card missing catalog chip+horizon', () => {
  it('public 404 and admin CardNotFoundError share catalogLockedPreview', () => {
    expect(CARD_ROUTE).toContain('function catalogLockedPreview')
    const public404 = CARD_ROUTE.indexOf('} else if (access.response.status === 404)')
    const publicHelper = CARD_ROUTE.indexOf('catalogLockedPreview(instrument, horizonRaw, viewer)', public404)
    expect(public404).toBeGreaterThan(-1)
    expect(publicHelper).toBeGreaterThan(public404)

    const adminCatch = CARD_ROUTE.indexOf('if (e instanceof CardNotFoundError)')
    const adminHelper = CARD_ROUTE.indexOf('catalogLockedPreview(lookup.instrument, lookup.horizon, viewer)', adminCatch)
    expect(adminCatch).toBeGreaterThan(-1)
    expect(adminHelper).toBeGreaterThan(adminCatch)
    expect(CARD_ROUTE).toContain("!('roundId' in lookup) && !lookup.date && lookup.horizon")
  })

  it('generation progress counts roster rows (incl. 결번), not tile count or a hardcoded 41', () => {
    expect(CARD_ROUTE).not.toContain('const answered = card.models.length')
    expect(CARD_ROUTE).not.toMatch(/rosterSize\s*=\s*41/)
    expect(CARD_ROUTE).toContain('listRoundModelRows')
    expect(CARD_ROUTE).toContain('rosterGenerationProgress')
    expect(CARD_ROUTE).toContain('getProgressRosterIds()')
    expect(CARD_ROUTE).toContain('droppedModelIds')
  })

  it('does not skip fetchCardData for an existing admin round (full card, grade-on-read unchanged)', () => {
    expect(CARD_ROUTE).toContain('lookup = parseAdminLookup(searchParams)')
    const fetch = CARD_ROUTE.indexOf('const card = await fetchCardData')
    const paywall = CARD_ROUTE.indexOf('if (!viewer.isAdmin)')
    const gradeComment = CARD_ROUTE.indexOf('Assembles the card AND triggers grade-on-read')
    expect(fetch).toBeGreaterThan(-1)
    expect(paywall).toBeGreaterThan(fetch)
    expect(gradeComment).toBeGreaterThan(-1)
    expect(gradeComment).toBeLessThan(fetch)
  })

  it('loads fail_reason only for admin card reads', () => {
    expect(CARD_ROUTE).toContain('{ includeFailReasons: viewer.isAdmin }')
    const CARD_TS = readFileSync(join(__dirname, '../card.ts'), 'utf8')
    expect(CARD_TS).toContain('PREDICTION_COLUMNS_ADMIN')
    const publicCols = CARD_TS.match(/const PREDICTION_COLUMNS =\s*'([^']+)'/)?.[1] ?? ''
    expect(publicCols).toContain('reasoning_snippet')
    expect(publicCols).not.toContain('fail_reason')
    const adminCols = CARD_TS.match(/const PREDICTION_COLUMNS_ADMIN =\s*'([^']+)'/)?.[1] ?? ''
    expect(adminCols).toContain('fail_reason')
  })
})

describe('chip+horizon generate persistence', () => {
  it('catalog compose for a missing metals week is ranked, not on_demand', () => {
    const input = buildCatalogRankedRoundInput('XAG/USD', '1w', new Date('2026-09-15T06:00:00.000Z'))
    expect(input).toMatchObject({
      instrument: 'XAG/USD',
      horizon: '1w',
      category: 'gold_metal',
      item_type: 'ranked',
    })
    expect(input?.proposition_text).toMatch(/XAG\/USD/)
  })

  it('POST /api/league/generate still opens via resolvePublicInstrumentGenerateTarget + ensureLeagueRound', () => {
    expect(GENERATE_ROUTE).toContain('resolvePublicInstrumentGenerateTarget(viewer, instrument, horizon, locale)')
    expect(GENERATE_ROUTE).toContain('ensureLeagueRound(target.round)')
    expect(GENERATE_ROUTE).not.toContain("item_type: 'on_demand'")
  })

  it('GET /api/league/instruments keeps freeform tabs coming_soon and attaches recentRounds', () => {
    const INSTRUMENTS_ROUTE = readFileSync(join(__dirname, '../../../app/api/league/instruments/route.ts'), 'utf8')
    expect(INSTRUMENTS_ROUTE).toContain('selectRecentPublicFreeformRounds')
    expect(INSTRUMENTS_ROUTE).toContain('recentRounds')
    expect(INSTRUMENTS_ROUTE).toContain('league_generation_jobs')
    expect(INSTRUMENTS_ROUTE).not.toContain('headlinePropertyInstruments')
    expect(INSTRUMENTS_ROUTE).not.toContain("kind: 'instruments' as const")
  })
})
