import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ISO2_TO_ISO3 } from '../../ingest/iso'
import { CRISIS_ZONES, ZONE_KEYS, zoneForIso3 } from '../../zones'
import { ZONE_COST_CAP_USD } from '../prices'
import { crossBorderLinks, pickZoneMembers, tagsForText } from '../zone-card'

describe('crisis zones', () => {
  it('maps every ingest ISO3 to exactly one of 15 zones, including Sri Lanka', () => {
    expect(ZONE_KEYS).toHaveLength(15)
    expect(CRISIS_ZONES).toHaveLength(15)
    const iso3 = Object.values(ISO2_TO_ISO3)
    const assigned = CRISIS_ZONES.flatMap((zone) => zone.iso3)
    expect(new Set(assigned).size).toBe(assigned.length)
    for (const code of iso3) expect(zoneForIso3(code)?.iso3).toContain(code)
    expect(zoneForIso3('LKA')?.key).toBe('south_asia')
    expect(zoneForIso3('USA')?.nameEn).toBe('North America')
  })

  it('takes the top 8 stage >= 2 regions and names cross-border links', () => {
    const rows = [
      { iso3: 'LKA', stage: 4, score: 9, name: 'Badulla' },
      { iso3: 'IND', stage: 3, score: 8, name: 'Tamil Nadu' },
      { iso3: 'PAK', stage: 2, score: 7, name: 'Sindh' },
      { iso3: 'BGD', stage: 1, score: 20, name: 'Dhaka' },
      { iso3: 'USA', stage: 5, score: 30, name: 'Texas' },
      ...Array.from({ length: 10 }, (_, i) => ({ iso3: 'NPL', stage: 2, score: i, name: `Hill ${i}` })),
    ]
    const picked = pickZoneMembers(rows, 'south_asia')
    expect(picked).toHaveLength(8)
    expect(picked.some((row) => row.iso3 === 'BGD')).toBe(false)
    expect(picked.some((row) => row.iso3 === 'USA')).toBe(false)
    expect(picked[0].name).toBe('Badulla')
    const members = [
      { region_id: 1, name: 'Badulla', iso3: 'LKA' },
      { region_id: 2, name: 'Tamil Nadu', iso3: 'IND' },
    ]
    expect(tagsForText('Badulla dam and Tamil Nadu camps', members)).toHaveLength(2)
    const links = crossBorderLinks(
      [{ title: 'Spill reaches Tamil Nadu', mechanism: 'Badulla release crosses into Tamil Nadu', regions: undefined }],
      members,
    )
    expect(links).toEqual([
      {
        title: 'Spill reaches Tamil Nadu',
        from_region: 'Badulla',
        to_region: 'Tamil Nadu',
        link: 'Badulla release crosses into Tamil Nadu',
      },
    ])
    expect(ZONE_COST_CAP_USD).toBe(1.2)
  })

  it('declares zone scope in the unapplied migration and the worker', () => {
    const sql = readFileSync(path.join(process.cwd(), 'supabase/migrations/20261010000004_crisis_zones.sql'), 'utf8')
    expect(sql).toContain('zone_key')
    expect(sql).toContain("'zone'")
    const worker = readFileSync(path.join(process.cwd(), 'scripts/crisis/engine-worker.ts'), 'utf8')
    expect(worker).toContain("scope === 'zone'")
    expect(worker).toContain('ZONE_COST_CAP_USD')
    expect(worker).toContain('batch:global')
  })
})
