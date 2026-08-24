import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ALL_PREDICTION_CATEGORIES,
  RECORD_ROOM_FREE_PAGE_SIZE,
  gatePublicGenerateInstrument,
  isCuratedInstrument,
  isFreeArchiveQuery,
  tuningForViewer,
  visibleCategoriesFor,
} from '../access-policy'

const CURATED = ['AAPL', 'NVDA', 'BTC/USD', 'EUR/USD'] as const

describe('visibleCategoriesFor', () => {
  it('default-denies a viewer with no jurisdiction signal at all', () => {
    expect(visibleCategoriesFor({ declaredCountry: null, ipCountry: null })).toEqual([])
  })

  it('gives a US viewer the full category set', () => {
    const visible = visibleCategoriesFor({ ipCountry: 'US' })
    expect(visible).toEqual(ALL_PREDICTION_CATEGORIES)
    expect(visible).toContain('real_estate')
  })

  it('omits crypto_perps for a UK viewer but keeps ordinary finance categories', () => {
    const visible = visibleCategoriesFor({ ipCountry: 'GB' })
    expect(visible).not.toContain('crypto_perps')
    expect(visible).toContain('stock')
    expect(visible).toContain('crypto_spot')
  })

  it('applies stricter-of-the-two across declared vs IP country', () => {
    // US allows crypto_perps, GB denies it — the deny wins.
    expect(visibleCategoriesFor({ declaredCountry: 'US', ipCountry: 'GB' })).not.toContain('crypto_perps')
  })

  it('returns an empty list for a jurisdiction with no allowed categories (CN)', () => {
    expect(visibleCategoriesFor({ declaredCountry: 'CN' })).toEqual([])
  })

  it('never returns a category outside the known universe', () => {
    for (const category of visibleCategoriesFor({ ipCountry: 'KR' })) {
      expect(ALL_PREDICTION_CATEGORIES).toContain(category)
    }
  })
})

describe('gatePublicGenerateInstrument — generate-stream { instrument }', () => {
  const krPublic = { isAdmin: false, jurisdiction: { ipCountry: 'KR' } }
  const gbPublic = { isAdmin: false, jurisdiction: { ipCountry: 'GB' } }
  const cnPublic = { isAdmin: false, jurisdiction: { declaredCountry: 'CN' } }
  const adminInCn = { isAdmin: true, jurisdiction: { declaredCountry: 'CN' } }

  it('rejects an unknown or caller-invented instrument with 400 before any chargeable work', () => {
    for (const invented of ['NOT-A-SYMBOL', 'aapl', 'TSLAX', '005930.KS', '  FAKE  ']) {
      const gate = gatePublicGenerateInstrument(invented, krPublic)
      expect(gate, invented).toEqual({ ok: false, status: 400, code: 'unknown_instrument' })
    }
  })

  it('rejects a jurisdiction-blocked catalog instrument with 403 before any chargeable work', () => {
    // DOGE/USD is a real catalog key (memecoin). GB denies memecoin.
    expect(gatePublicGenerateInstrument('DOGE/USD', gbPublic)).toEqual({
      ok: false,
      status: 403,
      code: 'jurisdiction_blocked',
    })
    // CN denies every category, including AAPL/stock.
    expect(gatePublicGenerateInstrument('AAPL', cnPublic)).toEqual({
      ok: false,
      status: 403,
      code: 'jurisdiction_blocked',
    })
  })

  it('accepts an exact catalog key that the viewer may see', () => {
    expect(gatePublicGenerateInstrument('  AAPL  ', krPublic)).toEqual({
      ok: true,
      instrument: 'AAPL',
      category: 'stock',
      horizon: '1d',
    })
    expect(gatePublicGenerateInstrument('BTC/USD', krPublic)).toEqual({
      ok: true,
      instrument: 'BTC/USD',
      category: 'crypto_spot',
      horizon: '1d',
    })
  })

  it('lets admin skip the jurisdiction matrix but not invent a catalog key', () => {
    expect(gatePublicGenerateInstrument('AAPL', adminInCn)).toEqual({
      ok: true,
      instrument: 'AAPL',
      category: 'stock',
      horizon: '1d',
    })
    expect(gatePublicGenerateInstrument('INVENTED', adminInCn)).toEqual({
      ok: false,
      status: 400,
      code: 'unknown_instrument',
    })
  })

  it('rejects an unknown horizon with 400 before any chargeable work — never silently defaulted', () => {
    for (const bad of ['24h', '2d', 'YOLO', '', 5, null]) {
      expect(gatePublicGenerateInstrument('AAPL', krPublic, bad)).toEqual({
        ok: false,
        status: 400,
        code: 'unknown_horizon',
      })
    }
  })

  it('accepts every one of the 4 fixed horizon codes for a valid instrument', () => {
    for (const horizon of ['1d', '1w', '1m', '3m']) {
      expect(gatePublicGenerateInstrument('AAPL', krPublic, horizon)).toEqual({
        ok: true,
        instrument: 'AAPL',
        category: 'stock',
        horizon,
      })
    }
  })

  it('defaults to 1d when horizon is omitted (every pre-horizon-selection caller)', () => {
    expect(gatePublicGenerateInstrument('AAPL', krPublic)).toEqual({
      ok: true,
      instrument: 'AAPL',
      category: 'stock',
      horizon: '1d',
    })
  })

  it('generate-stream charges only after resolveTarget, so a failed gate is zero cost', () => {
    const route = readFileSync(join(__dirname, '../../../app/api/league/generate-stream/route.ts'), 'utf8')
    const targetAt = route.indexOf('const target = await resolveTarget(')
    const chargeAt = route.indexOf('deductCreditsBalance(')
    expect(targetAt).toBeGreaterThan(0)
    expect(chargeAt).toBeGreaterThan(targetAt)
    expect(route.indexOf('if (\'response\' in target) return target.response')).toBeGreaterThan(targetAt)
    expect(route.indexOf('if (\'response\' in target) return target.response')).toBeLessThan(chargeAt)
  })

  it('an unknown horizon is checked by the SAME gate as an unknown instrument, before the same charge point', () => {
    // resolveTarget -> resolvePublicInstrumentGenerateTarget -> gatePublicGenerateInstrument.
    // gatePublicGenerateInstrument itself does zero I/O (no DB, no fetch) — see
    // its source: instrument/horizon validation is pure string/lookup-table
    // logic, so "before any chargeable work" holds structurally for BOTH
    // unknown_instrument and unknown_horizon, not just by convention.
    const gateSrc = readFileSync(join(__dirname, '../access-policy.ts'), 'utf8')
    const fnStart = gateSrc.indexOf('export function gatePublicGenerateInstrument')
    const fnBody = gateSrc.slice(fnStart, gateSrc.indexOf('\n}', fnStart))
    expect(fnBody).not.toMatch(/await |supabase|fetch\(/i)

    const paSrc = readFileSync(join(__dirname, '../public-access.ts'), 'utf8')
    const genStart = paSrc.indexOf('export async function resolvePublicInstrumentGenerateTarget')
    const genBody = paSrc.slice(genStart, paSrc.indexOf('\n}', paSrc.lastIndexOf('return { ok: true, round: created }')))
    const gateCallAt = genBody.indexOf('gatePublicGenerateInstrument(')
    const dbLookupAt = genBody.indexOf('resolvePublicInstrumentRound(')
    expect(gateCallAt).toBeGreaterThan(0)
    expect(dbLookupAt).toBeGreaterThan(gateCallAt)
  })
})

describe('isCuratedInstrument', () => {
  it('accepts an exact curated symbol', () => {
    expect(isCuratedInstrument('AAPL', CURATED)).toBe(true)
    expect(isCuratedInstrument('BTC/USD', CURATED)).toBe(true)
  })

  it('tolerates surrounding whitespace from a query string', () => {
    expect(isCuratedInstrument('  AAPL  ', CURATED)).toBe(true)
  })

  it('rejects anything not on the curated list — including near-misses and empties', () => {
    expect(isCuratedInstrument('TSLA', CURATED)).toBe(false)
    expect(isCuratedInstrument('aapl', CURATED)).toBe(false)
    expect(isCuratedInstrument('', CURATED)).toBe(false)
    expect(isCuratedInstrument('   ', CURATED)).toBe(false)
    expect(isCuratedInstrument('005930.KS', CURATED)).toBe(false)
  })
})

describe('tuningForViewer', () => {
  const hostile = {
    tiers: ['premier'] as const,
    concurrency: 64,
    timeoutMs: 600_000,
    maxCompletionTokens: 100_000,
    costCapUsd: 999,
  }

  it('strips every cost knob for a non-admin caller', () => {
    expect(tuningForViewer({ ...hostile, tiers: ['premier'] }, false)).toEqual({})
  })

  it('preserves the knobs for admin operational testing', () => {
    const raw = { ...hostile, tiers: ['premier'] as ('premier' | 'challenger')[] }
    expect(tuningForViewer(raw, true)).toEqual(raw)
  })
})

describe('isFreeArchiveQuery', () => {
  it('allows the recent-summary window only', () => {
    expect(isFreeArchiveQuery({ page: 1, pageSize: RECORD_ROOM_FREE_PAGE_SIZE })).toBe(true)
    expect(isFreeArchiveQuery({ page: 1, pageSize: 3 })).toBe(true)
  })

  it('treats pagination, filters, and CSV as deep (paid)', () => {
    expect(isFreeArchiveQuery({ page: 2, pageSize: 5 })).toBe(false)
    expect(isFreeArchiveQuery({ page: 1, pageSize: 20 })).toBe(false)
    expect(isFreeArchiveQuery({ page: 1, pageSize: 5, modelId: 'gpt-4o' })).toBe(false)
    expect(isFreeArchiveQuery({ page: 1, pageSize: 5, from: '2026-01-01' })).toBe(false)
    expect(isFreeArchiveQuery({ page: 1, pageSize: 5, format: 'csv' })).toBe(false)
  })
})
