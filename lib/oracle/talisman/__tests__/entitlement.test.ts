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
})
