import { describe, expect, it } from 'vitest'
import { leagueGatewayAdmission } from '../admission'
import type { GatewayViewer } from '../types'

const KR: GatewayViewer = {
  userId: 'u',
  isAdmin: false,
  jurisdiction: { declaredCountry: 'KR', ipCountry: 'KR' },
}

describe('leagueGatewayAdmission', () => {
  it('refuses a KR financial prompt before any later gateway step', () => {
    expect(leagueGatewayAdmission(KR, 'stocks', 'stock')).toBe('prompt_not_available')
    expect(leagueGatewayAdmission(KR, 'crypto', 'crypto_spot')).toBe('prompt_not_available')
    expect(leagueGatewayAdmission(KR, 'fx', 'fx')).toBe('prompt_not_available')
  })

  it('blocks memecoin in Korea as a category, not a prompt-only hide', () => {
    expect(leagueGatewayAdmission(KR, 'memecoin', 'memecoin')).toBe('jurisdiction_blocked')
  })

  it('requires a registered country and does not silently use IP', () => {
    expect(
      leagueGatewayAdmission(
        { userId: 'u', isAdmin: false, jurisdiction: { declaredCountry: null, ipCountry: 'US' } },
        'stocks',
        'stock',
      ),
    ).toBe('registered_country_missing')
  })

  it('does not let admin bypass the prompt matrix', () => {
    const US = {
      userId: 'u',
      isAdmin: true as const,
      jurisdiction: { declaredCountry: 'US', ipCountry: 'US' },
    }
    expect(leagueGatewayAdmission({ ...KR, isAdmin: true }, 'stocks', 'stock')).toBe('prompt_not_available')
    expect(leagueGatewayAdmission({ ...KR, isAdmin: true }, 'memecoin', 'memecoin')).toBe('prompt_not_available')
    expect(leagueGatewayAdmission(US, 'gold_metals', 'gold_metal')).toBe('prompt_not_available')
    expect(leagueGatewayAdmission(US, 'stocks', 'stock')).toBeNull()
  })
})
