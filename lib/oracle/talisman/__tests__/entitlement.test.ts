import { describe, expect, it } from 'vitest'
import { TALISMAN_PRICE } from '../../runner/conventions'
import {
  canDownloadTalismanFormat,
  isFreePhoneGrant,
  parseTalismanBuyPurpose,
  talismanDownloadGate,
  talismanPriceFor,
  unlockedTalismanFormats,
} from '../entitlement'
import { earliestIntegratedSessionId, isIntegratedTalismanSource } from '../source-session'

const LIVE = {
  kind: 'personal',
  scope: 'combined',
  status: 'done',
  prompt_version: 'layer1-v4',
  user_id: 'owner',
} as const

describe('talisman download gate', () => {
  it('refuses when there is no finished integrated reading', () => {
    expect(
      talismanDownloadGate({
        hasReading: false,
        purchased: false,
        purpose: 'deficiency',
        format: 'phone',
        isFirstIntegratedSession: true,
      }),
    ).toBe('no-reading')
    expect(isIntegratedTalismanSource({ ...LIVE, status: 'partial' }, 'owner', true)).toBe(false)
    expect(isIntegratedTalismanSource({ ...LIVE, kind: 'daily' }, 'owner', true)).toBe(false)
    expect(isIntegratedTalismanSource(LIVE, 'other', true)).toBe(false)
    expect(isIntegratedTalismanSource(LIVE, 'owner', false)).toBe(false)
  })

  it('gives the first-session deficiency phone for free', () => {
    expect(
      isFreePhoneGrant({ purpose: 'deficiency', format: 'phone', isFirstIntegratedSession: true }),
    ).toBe(true)
    expect(
      talismanDownloadGate({
        hasReading: true,
        purchased: false,
        purpose: 'deficiency',
        format: 'phone',
        isFirstIntegratedSession: true,
      }),
    ).toBe('free-phone')
    expect(
      canDownloadTalismanFormat({
        purchased: false,
        purpose: 'deficiency',
        format: 'phone',
        isFirstIntegratedSession: true,
      }),
    ).toBe(true)
    expect(
      unlockedTalismanFormats({
        purchased: false,
        purpose: 'deficiency',
        isFirstIntegratedSession: true,
      }),
    ).toEqual(['phone'])
    expect(earliestIntegratedSessionId([
      { id: 'later', created_at: '2026-09-02T00:00:00Z' },
      { id: 'first', created_at: '2026-09-01T00:00:00Z' },
    ])).toBe('first')
  })

  it('charges 6 for deficiency phone on a later integrated session', () => {
    expect(
      isFreePhoneGrant({ purpose: 'deficiency', format: 'phone', isFirstIntegratedSession: false }),
    ).toBe(false)
    expect(
      talismanDownloadGate({
        hasReading: true,
        purchased: false,
        purpose: 'deficiency',
        format: 'phone',
        isFirstIntegratedSession: false,
      }),
    ).toBe('unpaid')
    expect(
      canDownloadTalismanFormat({
        purchased: false,
        purpose: 'deficiency',
        format: 'phone',
        isFirstIntegratedSession: false,
      }),
    ).toBe(false)
    expect(talismanPriceFor('deficiency')).toBe(TALISMAN_PRICE.deficiency)
    expect(
      unlockedTalismanFormats({
        purchased: false,
        purpose: 'deficiency',
        isFirstIntegratedSession: false,
      }),
    ).toEqual([])
  })

  it('refuses an unpaid wallet (and every purpose format) until purchase', () => {
    expect(
      talismanDownloadGate({
        hasReading: true,
        purchased: false,
        purpose: 'deficiency',
        format: 'wallet',
        isFirstIntegratedSession: true,
      }),
    ).toBe('unpaid')
    expect(
      canDownloadTalismanFormat({
        purchased: false,
        purpose: 'deficiency',
        format: 'wallet',
        isFirstIntegratedSession: true,
      }),
    ).toBe(false)
    expect(
      canDownloadTalismanFormat({
        purchased: false,
        purpose: 'wealth',
        format: 'phone',
        isFirstIntegratedSession: true,
      }),
    ).toBe(false)
    expect(talismanPriceFor('wealth')).toBe(TALISMAN_PRICE.purpose)
  })

  it('unlocks all four formats after a purchase', () => {
    expect(
      talismanDownloadGate({
        hasReading: true,
        purchased: true,
        purpose: 'wealth',
        format: 'wallet',
        isFirstIntegratedSession: false,
      }),
    ).toBe('paid')
    expect(
      unlockedTalismanFormats({
        purchased: true,
        purpose: 'wealth',
        isFirstIntegratedSession: false,
      }),
    ).toEqual(['phone', 'wallet', 'square', 'desktop'])
    expect(parseTalismanBuyPurpose(null)).toBe('deficiency')
    expect(parseTalismanBuyPurpose('love')).toBe('love')
  })

  it('stub earliest + real second → second session is free (skips stub / legacy / no-consensus)', () => {
    const stubEarliest = {
      id: 'sess-stub',
      kind: 'personal',
      scope: 'combined',
      status: 'done',
      prompt_version: 'stub-0',
      created_at: '2026-09-01T00:00:00Z',
      user_id: 'user-1',
    }
    const legacyNoConsensus = {
      id: 'sess-no-consensus',
      kind: 'personal',
      scope: 'combined',
      status: 'done',
      prompt_version: 'layer1-v2',
      created_at: '2026-09-02T00:00:00Z',
      user_id: 'user-1',
    }
    const legacyPrompt = {
      id: 'sess-legacy',
      kind: 'personal',
      scope: 'combined',
      status: 'done',
      prompt_version: 'legacy',
      created_at: '2026-09-03T00:00:00Z',
      user_id: 'user-1',
    }
    const realSecond = {
      id: 'sess-real',
      kind: 'personal',
      scope: 'combined',
      status: 'done',
      prompt_version: 'layer1-v4',
      created_at: '2026-09-04T00:00:00Z',
      user_id: 'user-1',
    }
    const realThird = {
      id: 'sess-real-later',
      kind: 'personal',
      scope: 'combined',
      status: 'done',
      prompt_version: 'layer1-v4',
      created_at: '2026-09-05T00:00:00Z',
      user_id: 'user-1',
    }

    const consensusMap = new Map([
      ['sess-stub', true],
      ['sess-no-consensus', false],
      ['sess-legacy', true],
      ['sess-real', true],
      ['sess-real-later', true],
    ])

    const allSessions = [stubEarliest, legacyNoConsensus, legacyPrompt, realSecond, realThird]

    // Verify individual session source eligibility
    expect(isIntegratedTalismanSource(stubEarliest, 'user-1', consensusMap.get('sess-stub')!)).toBe(false)
    expect(isIntegratedTalismanSource(legacyNoConsensus, 'user-1', consensusMap.get('sess-no-consensus')!)).toBe(false)
    expect(isIntegratedTalismanSource(legacyPrompt, 'user-1', consensusMap.get('sess-legacy')!)).toBe(false)
    expect(isIntegratedTalismanSource(realSecond, 'user-1', consensusMap.get('sess-real')!)).toBe(true)
    expect(isIntegratedTalismanSource(realThird, 'user-1', consensusMap.get('sess-real-later')!)).toBe(true)

    const eligible = allSessions.filter((s) =>
      isIntegratedTalismanSource(s, 'user-1', consensusMap.get(s.id)!),
    )
    const firstEligibleId = earliestIntegratedSessionId(eligible)
    expect(firstEligibleId).toBe('sess-real')

    // Second session (realSecond) matches earliest eligible session → gets free deficiency phone
    const isFirstForSecond = realSecond.id === firstEligibleId
    expect(isFirstForSecond).toBe(true)
    expect(
      isFreePhoneGrant({
        purpose: 'deficiency',
        format: 'phone',
        isFirstIntegratedSession: isFirstForSecond,
      }),
    ).toBe(true)
    expect(
      unlockedTalismanFormats({
        purchased: false,
        purpose: 'deficiency',
        isFirstIntegratedSession: isFirstForSecond,
      }),
    ).toEqual(['phone'])

    // Later session does NOT get free phone
    const isFirstForThird = realThird.id === firstEligibleId
    expect(isFirstForThird).toBe(false)
    expect(
      isFreePhoneGrant({
        purpose: 'deficiency',
        format: 'phone',
        isFirstIntegratedSession: isFirstForThird,
      }),
    ).toBe(false)
  })
})
