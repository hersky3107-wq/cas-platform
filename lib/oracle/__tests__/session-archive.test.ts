import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LAYER1_REGISTRY, ORACLE_SEAT_ONLY_BRANDS } from '../ai/registry'
import { allSessionSeatBrands } from '../ai/family-roster'
import { projectOracleArchiveResponses } from '../session-archive'
import { oracleSystemDisplayName } from '../system-display'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')

/** brand -> server-only model id, for every seat a session can actually fill. */
function brandModelPairs(): Array<{ brand: string; model: string }> {
  return [
    ...Object.values(LAYER1_REGISTRY).map((e) => ({ brand: e.brand, model: e.model })),
    ...Object.values(ORACLE_SEAT_ONLY_BRANDS).map((e) => ({ brand: e.brand, model: e.model })),
  ]
}

describe('oracle_sessions archive projection', () => {
  it('keeps only ai_name and content', () => {
    const out = projectOracleArchiveResponses({
      readings: [{ brand: 'Z.ai', narrative: '첫 번째 해석' }],
      synthesis: { brand: 'NVIDIA', conclusion: '종합' },
    })
    expect(out).toEqual([
      { ai_name: 'Z.ai', content: '첫 번째 해석' },
      { ai_name: 'NVIDIA', content: '종합' },
    ])
    for (const row of out) {
      expect(Object.keys(row).sort()).toEqual(['ai_name', 'content'])
    }
  })

  it('preserves roster order and appends the synthesizer last', () => {
    const out = projectOracleArchiveResponses({
      readings: [
        { brand: 'Z.ai', narrative: 'a' },
        { brand: 'xAI', narrative: 'b' },
        { brand: 'DeepSeek', narrative: 'c' },
      ],
      synthesis: { brand: 'NVIDIA', conclusion: 'd' },
    })
    expect(out.map((row) => row.ai_name)).toEqual(['Z.ai', 'xAI', 'DeepSeek', 'NVIDIA'])
  })

  it('never emits a model id, for any brand that can hold a seat', () => {
    const pairs = brandModelPairs()
    expect(pairs.length).toBeGreaterThan(10)

    // Extra fields stand in for a caller that passed a whole oracle_readings
    // row: the projection must read `brand`/`narrative` and ignore the rest.
    const readings = pairs.map(({ brand, model }) => ({
      brand,
      narrative: `${brand} 해석`,
      model,
      tokens_out: 412,
      ai_payload: { model },
    }))
    const serialized = JSON.stringify(
      projectOracleArchiveResponses({
        readings,
        synthesis: { brand: 'NVIDIA', conclusion: '종합', model: 'nvidia/secret' } as never,
      }),
    )

    for (const { model } of pairs) {
      expect(serialized).not.toContain(model)
    }
    expect(serialized).not.toContain('nvidia/secret')
    expect(serialized).not.toContain('tokens_out')
    expect(serialized).not.toContain('ai_payload')
  })

  it('covers every roster brand with a display-safe name and no model string', () => {
    const seats = allSessionSeatBrands()
    const out = projectOracleArchiveResponses({
      readings: seats.map((brand) => ({ brand, narrative: 'x' })),
    })
    expect(out.map((row) => row.ai_name)).toEqual(seats)
    for (const row of out) expect(row.ai_name).not.toContain('/')
  })

  it('drops blank brands and normalizes empty prose to null', () => {
    const out = projectOracleArchiveResponses({
      readings: [
        { brand: '  ', narrative: 'orphan' },
        { brand: 'xAI', narrative: '   ' },
        { brand: 'Google', narrative: null },
      ],
    })
    expect(out).toEqual([
      { ai_name: 'xAI', content: null },
      { ai_name: 'Google', content: null },
    ])
  })
})

describe('share page oracle query', () => {
  const source = readFileSync(join(REPO_ROOT, 'app', 'share', '[share_id]', 'page.tsx'), 'utf8')

  it('selects oracle_sessions columns explicitly', () => {
    expect(source).toContain(
      "from('oracle_sessions')\n    .select('oracle_type, question, responses, voted_ai, is_public')",
    )
  })

  it('never selects * anywhere on the share page', () => {
    expect(source).not.toContain(".select('*')")
    expect(source).not.toContain('.select("*")')
  })

  it('does not read the runner reading/verdict tables, whose model column is server-only', () => {
    expect(source).not.toContain('oracle_readings')
    expect(source).not.toContain('oracle_verdicts')
  })
})

describe('system display names', () => {
  it('maps system ids to Korean names instead of printing the id', () => {
    expect(oracleSystemDisplayName('saju')).toBe('사주명리')
    expect(oracleSystemDisplayName('astro')).toBe('서양 점성술')
    expect(oracleSystemDisplayName('prism')).toBe('PRISM-5')
    expect(oracleSystemDisplayName('horoscope')).toBe('서양 점성술')
  })

  it('falls back to the raw value rather than an empty heading', () => {
    expect(oracleSystemDisplayName('mystery')).toBe('mystery')
    expect(oracleSystemDisplayName(null)).toBe('')
  })
})
