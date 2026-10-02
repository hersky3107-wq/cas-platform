import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KR_ENTER_RANK, KR_EXIT_RANK, KR_GROUPS, orderVisibleUniverseRows } from '../korea-equity-catalog'
import {
  hysteresisPrev,
  parseKrGroupMap,
  planUniverseApply,
  type UniverseRecord,
  type UniverseSnapshotRow,
} from '../korea-universe-apply'

const NOW = '2026-10-02T09:00:00.000Z'
const STORE_SRC = readFileSync(join(__dirname, '../korea-universe-store.ts'), 'utf8')
const APPLY_SRC = readFileSync(join(__dirname, '../../../scripts/league/kr-universe-apply.ts'), 'utf8')

function rec(over: Partial<UniverseRecord> = {}): UniverseRecord {
  return {
    market: 'KOSPI',
    code: '005930',
    name: '삼성전자',
    groupId: 'semis',
    status: 'auto',
    popularityRank: 1,
    avgTrdval20dEok: 10000,
    mktcapEok: 4000000,
    visible: true,
    removedAt: null,
    flags: [],
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

function snap(over: Partial<UniverseSnapshotRow> = {}): UniverseSnapshotRow {
  return {
    market: 'KOSPI',
    code: '005930',
    name: '삼성전자',
    rank: 1,
    avgTrdval20dEok: 10000,
    mktcapEok: 4000000,
    ...over,
  }
}

describe('korea-universe-store (source contract)', () => {
  it('is server-only and sorts visible rows via orderVisibleUniverseRows', () => {
    expect(STORE_SRC).toContain("import 'server-only'")
    expect(STORE_SRC).toContain('export async function listVisibleUniverse')
    expect(STORE_SRC).toContain('export async function isUniverseCodeVisible')
    expect(STORE_SRC).toContain('orderVisibleUniverseRows')
    expect(STORE_SRC).toContain('.eq(\'visible\', true)')
  })

  it('apply script defaults to dry-run and only writes with --apply', () => {
    expect(APPLY_SRC).toContain('Default is --dry-run')
    expect(APPLY_SRC).toContain('--apply')
    expect(APPLY_SRC).toContain('const dryRun = !apply || created')
    expect(APPLY_SRC).not.toMatch(/delete\(/)
  })
})

describe('orderVisibleUniverseRows', () => {
  it('orders KR by KR_GROUPS then popularity_rank', () => {
    const rows = [
      rec({ code: '000660', groupId: 'semis', popularityRank: 2, name: 'SK하이닉스' }),
      rec({ code: '035420', groupId: 'internet_ent', popularityRank: 1, name: 'NAVER' }),
      rec({ code: '005930', groupId: 'semis', popularityRank: 1 }),
      rec({ code: '999999', groupId: 'other', popularityRank: 3, name: '기타' }),
    ]
    expect(orderVisibleUniverseRows(rows, 'KOSPI').map((r) => r.code)).toEqual([
      '005930',
      '000660',
      '035420',
      '999999',
    ])
    expect(KR_GROUPS[0]?.id).toBe('semis')
    expect(KR_GROUPS[KR_GROUPS.length - 1]?.id).toBe('other')
  })

  it('orders US by popularity_rank only', () => {
    const rows = [
      rec({ market: 'US', code: 'MSFT', groupId: null, popularityRank: 2, name: 'Microsoft' }),
      rec({ market: 'US', code: 'AAPL', groupId: null, popularityRank: 1, name: 'Apple' }),
      rec({ market: 'US', code: 'AMZN', groupId: null, popularityRank: 3, name: 'Amazon' }),
    ]
    expect(orderVisibleUniverseRows(rows, 'US').map((r) => r.code)).toEqual(['AAPL', 'MSFT', 'AMZN'])
  })
})

describe('planUniverseApply — enter / stay / leave', () => {
  it('enters a new auto name at rank 175', () => {
    const plan = planUniverseApply({
      existing: [],
      snapshot: [snap({ rank: KR_ENTER_RANK })],
      groupMap: { 'KOSPI:005930': { group: 'semis', flags: [] } },
      now: NOW,
    })
    expect(plan.entering).toHaveLength(1)
    expect(plan.staying).toHaveLength(0)
    expect(plan.leaving).toHaveLength(0)
    expect(plan.writes[0]).toMatchObject({
      code: '005930',
      visible: true,
      removedAt: null,
      groupId: 'semis',
      status: 'auto',
    })
  })

  it('does not enter a new auto name at rank 176', () => {
    const plan = planUniverseApply({
      existing: [],
      snapshot: [snap({ rank: KR_ENTER_RANK + 1 })],
      groupMap: { 'KOSPI:005930': { group: 'semis' } },
      now: NOW,
    })
    expect(plan.entering).toHaveLength(0)
    expect(plan.writes[0]).toMatchObject({ visible: false, removedAt: null, status: 'auto' })
  })

  it('stays visible at rank 200 and leaves at 221', () => {
    const existing = [rec({ popularityRank: 180, visible: true, removedAt: null })]
    const stay = planUniverseApply({
      existing,
      snapshot: [snap({ rank: 200 })],
      groupMap: { 'KOSPI:005930': { group: 'semis' } },
      now: NOW,
    })
    expect(stay.staying).toHaveLength(1)
    expect(stay.entering).toHaveLength(0)
    expect(stay.leaving).toHaveLength(0)
    expect(stay.writes[0]?.visible).toBe(true)

    const leave = planUniverseApply({
      existing,
      snapshot: [snap({ rank: KR_EXIT_RANK + 1 })],
      groupMap: { 'KOSPI:005930': { group: 'semis' } },
      now: NOW,
    })
    expect(leave.leaving).toHaveLength(1)
    expect(leave.writes[0]).toMatchObject({ visible: false, removedAt: NOW, status: 'auto' })
  })

  it('treats a DB-only row as newRank=null (leave if visible)', () => {
    const plan = planUniverseApply({
      existing: [rec({ visible: true, removedAt: null })],
      snapshot: [],
      groupMap: { 'KOSPI:005930': { group: 'semis' } },
      now: NOW,
    })
    expect(plan.leaving).toHaveLength(1)
    expect(plan.writes).toHaveLength(1)
    expect(plan.writes[0]).toMatchObject({
      code: '005930',
      popularityRank: null,
      visible: false,
      removedAt: NOW,
    })
  })
})

describe('planUniverseApply — pinned / hidden / unmapped', () => {
  it('does not change pinned or hidden status and never deletes', () => {
    const existing = [
      rec({ code: '005930', status: 'pinned', visible: true, removedAt: null }),
      rec({
        code: '035420',
        name: 'NAVER',
        status: 'hidden',
        groupId: 'internet_ent',
        visible: false,
        removedAt: null,
        popularityRank: 4,
      }),
    ]
    const plan = planUniverseApply({
      existing,
      snapshot: [
        snap({ rank: 999 }),
        snap({ code: '035420', name: 'NAVER', rank: 1, avgTrdval20dEok: 1, mktcapEok: 1 }),
      ],
      groupMap: {
        'KOSPI:005930': { group: 'semis' },
        'KOSPI:035420': { group: 'internet_ent' },
      },
      now: NOW,
    })
    const pinned = plan.writes.find((r) => r.code === '005930')
    const hidden = plan.writes.find((r) => r.code === '035420')
    expect(pinned).toMatchObject({ status: 'pinned', visible: true, removedAt: null })
    expect(hidden).toMatchObject({ status: 'hidden', visible: false })
    expect(plan.writes).toHaveLength(2)
  })

  it('coerces unknown map group ids to other and lists invalidGroups', () => {
    const plan = planUniverseApply({
      existing: [],
      snapshot: [snap({ rank: 1 })],
      groupMap: parseKrGroupMap({ 'KOSPI:005930': { group: 'legacy_sector', flags: [] } }),
      now: NOW,
    })
    expect(plan.invalidGroups).toEqual(['KOSPI:005930'])
    expect(plan.unmapped).toEqual([])
    expect(plan.writes[0]?.groupId).toBe('other')
  })

  it('maps unmapped KR codes to other and lists them', () => {
    const plan = planUniverseApply({
      existing: [],
      snapshot: [snap({ rank: 1 }), snap({ market: 'KOSDAQ', code: '247540', name: '에코프로비엠', rank: 2 })],
      groupMap: parseKrGroupMap({}),
      now: NOW,
    })
    expect(plan.unmapped).toEqual(['KOSDAQ:247540', 'KOSPI:005930'])
    expect(plan.writes.every((r) => r.groupId === 'other')).toBe(true)
  })

  it('leaves US group_id null even when unmapped', () => {
    const plan = planUniverseApply({
      existing: [],
      snapshot: [snap({ market: 'US', code: 'AAPL', name: 'Apple', rank: 1 })],
      groupMap: {},
      now: NOW,
    })
    expect(plan.unmapped).toEqual([])
    expect(plan.writes[0]).toMatchObject({ market: 'US', groupId: null, visible: true })
  })
})

describe('hysteresisPrev', () => {
  it('treats never-entered auto rows as no previous row', () => {
    expect(hysteresisPrev(rec({ visible: false, removedAt: null, status: 'auto' }))).toBeUndefined()
    expect(hysteresisPrev(rec({ visible: true, removedAt: null }))).toMatchObject({
      removedAt: null,
      status: 'auto',
    })
  })
})
