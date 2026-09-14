import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clampRecordRoomQuery,
  isLockedViewPayload,
  lockedViewPayload,
  RECORD_ROOM_PURCHASE_ROUND_LIMIT,
  RECORD_ROOM_PURCHASED_PAGE_SIZE,
} from '../view-purchase-policy'

describe('record-room purchase window', () => {
  it('pins the 30-round freeze', () => {
    expect(RECORD_ROOM_PURCHASE_ROUND_LIMIT).toBe(30)
    expect(RECORD_ROOM_PURCHASED_PAGE_SIZE).toBe(20)
  })

  it('cannot page past the purchased round count', () => {
    const clamped = clampRecordRoomQuery(
      { page: 9, pageSize: 50, format: 'csv', from: '2020-01-01', to: '2099-01-01' },
      { roundCount: 30, from: '2026-08-01T00:00:00.000Z', to: '2026-09-14T00:00:00.000Z' }
    )
    expect(clamped.pageSize).toBe(20)
    expect(clamped.page).toBe(2)
    expect(clamped.format).toBe('json')
    expect(clamped.from).toBe('2026-08-01T00:00:00.000Z')
    expect(clamped.to).toBe('2026-09-14T00:00:00.000Z')
  })

  it('builds a locked payload that carries the price and no ranks', () => {
    const locked = lockedViewPayload('leaderboard', 2)
    expect(isLockedViewPayload(locked)).toBe(true)
    expect(locked).toEqual({ locked: true, product: 'leaderboard', required: 2, code: 'purchase_required' })
    expect(isLockedViewPayload({ ok: true, ranks: [] })).toBe(false)
  })
})

describe('paid-view routes do not charge on GET', () => {
  it('leaderboard GET never calls deductCreditsBalance', () => {
    const src = readFileSync(join(__dirname, '../../../app/api/league/leaderboard/route.ts'), 'utf8')
    const getAt = src.indexOf('export async function GET')
    const postAt = src.indexOf('export async function POST')
    expect(getAt).toBeGreaterThan(0)
    expect(postAt).toBeGreaterThan(getAt)
    expect(src.slice(getAt, postAt)).not.toMatch(/deductCreditsBalance|purchaseLeagueView/)
    expect(src.slice(postAt)).toMatch(/purchaseLeagueView/)
  })

  it('record-room GET never calls deductCreditsBalance', () => {
    const src = readFileSync(join(__dirname, '../../../app/api/league/record-room/route.ts'), 'utf8')
    const getAt = src.indexOf('export async function GET')
    const postAt = src.indexOf('export async function POST')
    expect(src.slice(getAt, postAt)).not.toMatch(/deductCreditsBalance|purchaseLeagueView/)
    expect(src.slice(postAt)).toMatch(/purchaseLeagueView/)
  })
})
