import { describe, expect, it } from 'vitest'
import { propertySourceAudit } from '../source-audit'

describe('property source audit', () => {
  it('lists official clients and marks Australia unsupported', () => {
    const rows = propertySourceAudit()
    expect(rows.map((row) => row.country)).toEqual(
      expect.arrayContaining(['KR', 'US', 'UK', 'JP', 'AU']),
    )
    expect(rows.find((row) => row.country === 'KR')?.auth).toBe('RONE_API_KEY')
    expect(rows.find((row) => row.publisher === 'S&P Case-Shiller')?.grading).toBe('housing_index')
    expect(rows.find((row) => row.publisher === 'UK HPI')?.license).toMatch(/Open Government Licence/)
    expect(rows.find((row) => row.country === 'JP')?.auth).toMatch(/001473668/)
    expect(rows.find((row) => row.country === 'AU')).toMatchObject({
      packet: 'unsupported',
      grading: 'unsupported',
    })
    expect(rows.find((row) => row.publisher === 'Zillow ZHVI')?.grading).toBe('operator_manual')
    for (const row of rows) {
      expect(row.lastSuccessfulFetch).toBeNull()
      expect(row.regionCount).toBeGreaterThan(0)
    }
  })
})
