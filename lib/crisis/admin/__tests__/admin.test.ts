import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { engineCardFromStored } from '../card'
import { centroidLonLat, projectLonLat, stageColor } from '../geo'
import { publishableIndices } from '../publish'
import {
  canClaimNext,
  enqueueRegion,
  enqueueRunAll,
  estimateQueueUsd,
  expandAllToRegions,
  groupQueue,
  markDone,
  markFailed,
  markRunning,
  nextQueued,
  regionsForRunAll,
} from '../queue'
import { assembleTodayRegions, latestFlagDate } from '../today'
import type { AdminRegion, QueueRow } from '../types'

const NOW = '2026-10-10T12:00:00.000Z'

function region(partial: Partial<AdminRegion> & Pick<AdminRegion, 'regionId' | 'stage' | 'score'>): AdminRegion {
  return {
    name: `R${partial.regionId}`,
    country: 'Sri Lanka',
    iso3: 'LKA',
    triggers: ['rain'],
    lastRunAt: null,
    lat: 7,
    lon: 81,
    level: 1,
    ...partial,
  }
}

function queue(partial: Partial<QueueRow> & Pick<QueueRow, 'id' | 'status'>): QueueRow {
  return {
    region_id: 1,
    scope: 'region',
    requested_by: 'admin',
    run_id: null,
    error: null,
    created_at: NOW,
    started_at: null,
    finished_at: null,
    ...partial,
  }
}

describe('queue planning', () => {
  it('estimates run-all cost as count × $0.42', () => {
    expect(estimateQueueUsd(0)).toBe(0)
    expect(estimateQueueUsd(3)).toBe(1.26)
    const picked = regionsForRunAll([
      region({ regionId: 1, stage: 2, score: 2 }),
      region({ regionId: 2, stage: 3, score: 4 }),
      region({ regionId: 3, stage: 5, score: 8 }),
    ])
    expect(picked.map((row) => row.regionId)).toEqual([2, 3])
    expect(estimateQueueUsd(picked.length)).toBe(0.84)
  })

  it('inserts one region row or a batch plus per-region rows', () => {
    expect(enqueueRegion(44, 'u1')).toEqual({
      region_id: 44,
      scope: 'region',
      requested_by: 'u1',
      status: 'queued',
    })
    expect(() => enqueueRegion(0, 'u1')).toThrow(/region_id/)
    const rows = enqueueRunAll([2, 3, 3], 'u1')
    expect(rows[0]).toMatchObject({ scope: 'all', region_id: null })
    expect(rows.slice(1).map((row) => row.region_id)).toEqual([2, 3])
    expect(expandAllToRegions(rows[0], [9, 10])).toEqual([
      { region_id: 9, scope: 'region', requested_by: 'u1', status: 'queued' },
      { region_id: 10, scope: 'region', requested_by: 'u1', status: 'queued' },
    ])
  })

  it('claims the oldest region row and never starts a second while one is running', () => {
    const older = queue({ id: 'a', status: 'queued', created_at: '2026-10-10T11:00:00.000Z', region_id: 1 })
    const newer = queue({ id: 'b', status: 'queued', created_at: '2026-10-10T12:00:00.000Z', region_id: 2 })
    const all = queue({ id: 'c', status: 'queued', scope: 'all', region_id: null, created_at: '2026-10-10T10:00:00.000Z' })
    expect(nextQueued([newer, all, older])?.id).toBe('a')
    expect(canClaimNext([older, newer])).toBe(true)
    expect(canClaimNext([markRunning(older, NOW)])).toBe(false)
    expect(markDone(older, NOW, 'run-1')).toMatchObject({ status: 'done', run_id: 'run-1' })
    expect(markFailed(older, NOW, 'cap')).toMatchObject({ status: 'failed', error: 'cap' })
    expect(groupQueue([older, markFailed(newer, NOW, 'x')]).failed).toHaveLength(1)
  })
})

describe('today regions and map', () => {
  it('joins flags to centroids and sorts by score', () => {
    const day = latestFlagDate([{ flag_date: '2026-10-09' }, { flag_date: '2026-10-10' }], '2026-10-10')
    expect(day).toBe('2026-10-10')
    const rows = assembleTodayRegions({
      flags: [
        {
          region_id: 1,
          flag_date: '2026-10-10',
          value: 3.4,
          detail: { stage: 3, components: [{ key: 'rain', value: 0.8 }, { key: 'fire', value: 0 }] },
        },
        {
          region_id: 2,
          flag_date: '2026-10-10',
          value: 8.1,
          detail: { stage: 5, components: [{ key: 'conflict', value: 1 }] },
        },
      ],
      regions: [
        { id: 1, name: 'Badulla', iso3: 'LKA', level: 1, parent_id: 9, centroid: { type: 'Point', coordinates: [81.1, 7.0] } },
        { id: 2, name: 'Khartoum', iso3: 'SDN', level: 1, parent_id: 10, centroid: 'POINT (32.5 15.6)' },
      ],
      countries: [
        { iso3: 'LKA', name: 'Sri Lanka' },
        { iso3: 'SDN', name: 'Sudan' },
      ],
      lastRuns: [{ region_id: 2, at: NOW }],
    })
    expect(rows.map((row) => row.name)).toEqual(['Khartoum', 'Badulla'])
    expect(rows[0]).toMatchObject({ country: 'Sudan', stage: 5, triggers: ['conflict'], lastRunAt: NOW })
    expect(rows[1].triggers).toEqual(['rain'])
    expect(centroidLonLat({ type: 'Point', coordinates: [81.1, 7] })).toEqual({ lon: 81.1, lat: 7 })
    const pt = projectLonLat(0, 0, 800, 400)
    expect(pt).toEqual({ x: 400, y: 200 })
    expect(stageColor(5)).toBe('#fb7185')
    expect(stageColor(1)).toBe('#94a3b8')
  })
})

describe('engine card and publish indices', () => {
  it('builds a card from stored flags and publishes every headline plus missed row', () => {
    const card = engineCardFromStored(
      region({ regionId: 7, name: 'Badulla', stage: 3, score: 4, lat: 7, lon: 81 }),
      {
        components: [{ key: 'rain', value: 0.7, raw: { sum: 120 } }],
        fragility_items: [{ kind: 'dam', name: 'Uma Oya' }],
        cascades: [{ id: 'flood-road', trigger_type: 'rain', effect_type: 'road' }],
      },
    )
    expect(card).toMatchObject({
      region_id: 7,
      name: 'Badulla',
      horizon: '30d',
      components: [{ key: 'rain', value: 0.7 }],
      fragility: [{ kind: 'dam', name: 'Uma Oya' }],
      cascades: [{ id: 'flood-road', trigger: 'rain', effect: 'road' }],
    })
    expect(publishableIndices({ headlines: [{ title: 'a' } as never], missed_by_others: [{ title: 'b' } as never] })).toEqual([0, 1])
    expect(publishableIndices(null)).toEqual([])
  })
})

describe('migration and npm script', () => {
  it('declares the queue table and the worker script', () => {
    const sql = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261010000001_crisis_engine_requests.sql'),
      'utf8',
    )
    expect(sql).toContain('crisis_engine_requests')
    expect(sql).toContain("check (scope in ('region', 'all'))")
    expect(sql).toContain("check (status in ('queued', 'running', 'done', 'failed'))")
    expect(sql).toContain('hersky3107@gmail.com')
    expect(sql).toContain('enable row level security')
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['crisis:worker']).toContain('scripts/crisis/engine-worker.ts')
    expect(pkg.scripts['crisis:worker']).not.toContain('sweep.ts')
    const apply = readFileSync(path.join(process.cwd(), 'docs/crisis/APPLY_ENGINE_REQUESTS.md'), 'utf8')
    expect(apply).toContain("VALUES ('20261010000001','20261010000001_crisis_engine_requests')")
  })
})
