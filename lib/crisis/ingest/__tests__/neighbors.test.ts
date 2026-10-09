import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pendingNeighborBatches, planNeighborBatches } from '../neighbors'

describe('neighbour batches', () => {
  it('splits a country into slices of at most 200 and keeps other countries separate', () => {
    const usa = Array.from({ length: 201 }, (_, index) => ({ id: index + 1, iso3: 'USA', level: 1 }))
    const lka = [{ id: 900, iso3: 'LKA', level: 1 }]
    const country = [{ id: 1, iso3: 'LKA', level: 0 }]
    const batches = planNeighborBatches([...country, ...lka, ...usa])
    expect(batches.map((batch) => batch.key)).toEqual(['LKA:0', 'USA:0', 'USA:1'])
    expect(batches[1].ids).toHaveLength(200)
    expect(batches[2].ids).toEqual([201])
    expect(batches.every((batch) => batch.ids.length <= 200)).toBe(true)
    expect(pendingNeighborBatches(batches, ['USA:0']).map((batch) => batch.key)).toEqual(['LKA:0', 'USA:1'])
  })

  it('refuses a batch larger than 200', () => {
    expect(() => planNeighborBatches([{ id: 1, iso3: 'USA', level: 1 }], 201)).toThrow(/200/)
  })

  it('uses a bbox prefilter and does not limit pairs to one country', () => {
    const sql = readFileSync(new URL('../../../../supabase/migrations/20261009000004_crisis_engine.sql', import.meta.url), 'utf8')
    expect(sql).toContain('crisis_refresh_neighbor_batch')
    expect(sql).toContain('ST_Expand(a.geom, 0.05) && b.geom')
    expect(sql).toContain('ST_DWithin(a.geom, b.geom, 0.05)')
    expect(sql).not.toContain('a.iso3 = b.iso3')
    expect(sql).not.toContain('truncate public.crisis_region_neighbors')
    expect(sql).toContain('cardinality(batch) > 200')
    expect(sql).toContain('crisis_engine_runs_cache_key_idx')
    expect(sql).toContain('crisis_engine_runs_region_created_idx')
    expect(sql).toContain("check (role in ('dept_analyst', 'query_writer', 'search', 'hunter', 'red_team', 'judge'))")
    expect(sql).toContain('enable row level security')
  })
})
