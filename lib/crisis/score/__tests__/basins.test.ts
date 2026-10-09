import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { naturalTitlesForCoast, regionStormBasins, titleFitsRegionBasin, titleStormBasins } from '../basins'

const FLORIDA = { lat: 27.8, lon: -81.7 }
const CALIFORNIA = { lat: 36.7, lon: -119.4 }
const BADULLA = { lat: 6.99, lon: 81.06 }

describe('wiki storm basins', () => {
  it('keeps a Pacific season title off the Atlantic coast, and the reverse', () => {
    expect(titleStormBasins('2026 Pacific hurricane season')).toEqual(['pacific'])
    expect(titleStormBasins('2026 Atlantic hurricane season')).toEqual(['atlantic'])
    expect(regionStormBasins(FLORIDA.lat, FLORIDA.lon)).toEqual(['atlantic'])
    expect(regionStormBasins(CALIFORNIA.lat, CALIFORNIA.lon)).toEqual(['pacific'])
    expect(titleFitsRegionBasin('2026 Pacific hurricane season', FLORIDA.lat, FLORIDA.lon)).toBe(false)
    expect(titleFitsRegionBasin('2026 Atlantic hurricane season', CALIFORNIA.lat, CALIFORNIA.lon)).toBe(false)
    expect(titleFitsRegionBasin('2026 Pacific hurricane season', CALIFORNIA.lat, CALIFORNIA.lon)).toBe(true)
    expect(titleFitsRegionBasin('2026 Atlantic hurricane season', FLORIDA.lat, FLORIDA.lon)).toBe(true)
  })

  it('does not let either ocean season amplify Badulla, and keeps a dam title', () => {
    expect(regionStormBasins(BADULLA.lat, BADULLA.lon)).toEqual(['indian'])
    expect(titleFitsRegionBasin('2026 Pacific hurricane season', BADULLA.lat, BADULLA.lon)).toBe(false)
    expect(titleFitsRegionBasin('2026 Atlantic hurricane season', BADULLA.lat, BADULLA.lon)).toBe(false)
    expect(titleFitsRegionBasin('North Indian Ocean cyclone season', BADULLA.lat, BADULLA.lon)).toBe(true)
    expect(naturalTitlesForCoast(['වික්ටෝරියා වේල්ල'], FLORIDA.lat, FLORIDA.lon)).toEqual(['වික්ටෝරියා වේල්ල'])
    expect(naturalTitlesForCoast(['2026 Pacific hurricane season', 'වික්ටෝරියා වේල්ල'], FLORIDA.lat, FLORIDA.lon)).toEqual([
      'වික්ටෝරියා වේල්ල',
    ])
  })

  it('is the filter the score job applies before amplification', () => {
    const job = readFileSync(new URL('../job.ts', import.meta.url), 'utf8')
    expect(job).toContain('naturalTitlesForCoast')
    expect(job).toContain('natural: naturalTitles.length > 0')
  })
})
