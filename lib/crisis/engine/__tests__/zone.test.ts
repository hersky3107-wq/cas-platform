import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ISO2_TO_ISO3 } from '../../ingest/iso'
import { CRISIS_ZONES, ZONE_KEYS, zoneForIso3 } from '../../zones'
import { HUNTER_DEEPSEEK_TIMEOUT_MS, ZONE_COST_CAP_USD } from '../prices'
import { buildZoneLinks, pickZoneMembers, tagsForText, zoneLinkKeepReason } from '../zone-card'

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

  it('takes the top 8 stage >= 2 regions and keeps grounded cross-border links', () => {
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
    const built = buildZoneLinks(
      [{ title: 'Spill reaches Tamil Nadu', mechanism: 'Badulla release crosses into Tamil Nadu', regions: undefined }],
      { members, neighborEdges: [], hydroNames: [] },
    )
    expect(built.cross_border).toEqual([
      {
        title: 'Spill reaches Tamil Nadu',
        from_region: 'Badulla',
        to_region: 'Tamil Nadu',
        link: 'Badulla release crosses into Tamil Nadu',
      },
    ])
    expect(built.intra_zone).toEqual([])
    expect(ZONE_COST_CAP_USD).toBe(1.2)
    expect(HUNTER_DEEPSEEK_TIMEOUT_MS).toBe(120_000)
  })

  it('drops Nangarhar → Mahanuvara returnee link without grounding', () => {
    const members = [
      { region_id: 10, name: 'Nangarhar', iso3: 'AFG' },
      { region_id: 20, name: 'Mahanuvara', iso3: 'LKA' },
    ]
    const row = {
      title: 'Returnee flows',
      mechanism: 'Returnees from Nangarhar linked to Mahanuvara resettlement narrative',
      regions: [
        { region_id: 10, name: 'Nangarhar', iso3: 'AFG' },
        { region_id: 20, name: 'Mahanuvara', iso3: 'LKA' },
      ],
    }
    const logs: string[] = []
    const built = buildZoneLinks([row], {
      members,
      neighborEdges: [],
      hydroNames: [],
      log: (message) => logs.push(message),
    })
    expect(built.cross_border).toEqual([])
    expect(built.intra_zone).toEqual([])
    expect(zoneLinkKeepReason(row.regions, row, { members, neighborEdges: [], hydroNames: [] })).toBe(
      'returnee_without_grounding',
    )
    expect(logs.some((line) => line.includes('returnee_without_grounding') && line.includes('Nangarhar'))).toBe(true)
  })

  it('keeps neighbor pairs even when evidence is thin', () => {
    const members = [
      { region_id: 1, name: 'Sindh', iso3: 'PAK' },
      { region_id: 2, name: 'Balochistan', iso3: 'PAK' },
    ]
    const built = buildZoneLinks(
      [{ title: 'Local tension', mechanism: 'Sindh and Balochistan mentioned together', regions: members }],
      {
        members,
        neighborEdges: [{ regionId: 1, neighborId: 2, sharedBorder: true }],
        hydroNames: [],
      },
    )
    expect(built.intra_zone).toHaveLength(1)
    expect(built.cross_border).toEqual([])
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
