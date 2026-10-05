import { describe, expect, it } from 'vitest'
import { propertySourceAudit } from '../source-audit'

describe('property source audit', () => {
  it('lists Korea, the US, the UK, Japan, and Australia with no live fetch', () => {
    const rows = propertySourceAudit()
    expect(rows.map((row) => row.country)).toEqual(
      expect.arrayContaining(['KR', 'US', 'UK', 'JP', 'AU']),
    )
    expect(rows.find((row) => row.country === 'KR')?.publisher).toBe('부동산원')
    expect(rows.find((row) => row.publisher === 'S&P Case-Shiller')?.pubRule).toBe('lastTue')
    expect(rows.find((row) => row.country === 'UK')?.publisher).toBe('UK HPI')
    expect(rows.find((row) => row.country === 'JP')?.publisher).toBe('국토교통성')
    expect(rows.find((row) => row.country === 'AU')?.cadence).toBe('quarter')
    for (const row of rows) {
      expect(row.auth).toBe('no dedicated fetch client')
      expect(row.lastSuccessfulFetch).toBeNull()
      expect(row.packet).toBe('search-based')
      expect(row.grading).toBe('operator_manual')
      expect(row.regionCount).toBeGreaterThan(0)
    }
  })
})
