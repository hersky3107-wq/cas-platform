import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { brandCountry, type CountryCode } from '../country'
import { LEAGUE_ROSTER } from '../roster'

const FLAG_FILES: Record<Exclude<CountryCode, never>, string> = {
  US: 'us.svg',
  CN: 'cn.svg',
  KR: 'kr.svg',
  FR: 'fr.svg',
  CA: 'ca.svg',
  INT: 'int.svg',
}

describe('CountryFlag roster coverage', () => {
  it('maps every roster brand to a country that has a bundled SVG', () => {
    const flagsDir = join(process.cwd(), 'public/league/flags')
    for (const entry of LEAGUE_ROSTER) {
      const brand = entry.product_alias ? `${entry.brand} (${entry.product_alias})` : entry.brand
      const code = brandCountry(brand, entry.camp)
      expect(FLAG_FILES[code], `${entry.model_id} → ${code}`).toBeDefined()
      expect(existsSync(join(flagsDir, FLAG_FILES[code]))).toBe(true)
    }
  })

  it('keeps the Korean / French / Canadian brands on their real flags', () => {
    expect(brandCountry('NAVER (HyperCLOVA)', 'other')).toBe('KR')
    expect(brandCountry('Upstage (Solar)', 'other')).toBe('KR')
    expect(brandCountry('LG (EXAONE)', 'other')).toBe('KR')
    expect(brandCountry('Mistral', 'other')).toBe('FR')
    expect(brandCountry('Cohere (Command)', 'other')).toBe('CA')
  })
})
