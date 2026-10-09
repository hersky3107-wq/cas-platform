/**
 * Storm-basin gate for wiki amplification.
 * A title that names a basin only boosts regions on that coast.
 * A title that names no basin stays country-wide.
 */

export type StormBasin = 'atlantic' | 'pacific' | 'indian'

const BASIN_WORD: Array<{ basin: StormBasin; pattern: RegExp }> = [
  { basin: 'pacific', pattern: /\bpacific\b/i },
  { basin: 'atlantic', pattern: /\batlantic\b/i },
]

export function titleStormBasins(title: string): StormBasin[] {
  const found: StormBasin[] = []
  for (const row of BASIN_WORD) {
    if (row.pattern.test(title)) found.push(row.basin)
  }
  const indianOcean = /\bindian ocean\b/i.test(title)
  const indianStorm = /\bindian\b/i.test(title) && /\b(cyclone|hurricane|typhoon)\b/i.test(title)
  if (indianOcean || indianStorm) found.push('indian')
  return found
}

/**
 * Approximate coast bands in degrees. The Americas divide is -105 / -97:
 * west of -105 is Pacific, east of -97 is Atlantic/Gulf, and the band between
 * can take either title. Indian Ocean coasts are lon 30–100, lat -40–30.
 * West Pacific Asia is lon 100–180.
 */
export function regionStormBasins(lat: number, lon: number): StormBasin[] {
  const basins = new Set<StormBasin>()
  const americas = lat >= -60 && lat <= 70 && lon <= -30 && lon >= -180
  if (americas && lon <= -105) basins.add('pacific')
  if (americas && lon >= -97) basins.add('atlantic')
  if (americas && lon > -105 && lon < -97) {
    basins.add('pacific')
    basins.add('atlantic')
  }
  if (lat >= -40 && lat <= 70 && lon > -30 && lon < 20) basins.add('atlantic')
  if (lat >= -40 && lat <= 30 && lon >= 30 && lon <= 100) basins.add('indian')
  if (lat >= -50 && lat <= 50 && lon >= 100 && lon <= 180) basins.add('pacific')
  return [...basins]
}

export function titleFitsRegionBasin(title: string, lat: number, lon: number): boolean {
  const named = titleStormBasins(title)
  if (named.length === 0) return true
  const coast = regionStormBasins(lat, lon)
  return named.some((basin) => coast.includes(basin))
}

export function naturalTitlesForCoast(titles: string[], lat: number, lon: number): string[] {
  return titles.filter((title) => titleFitsRegionBasin(title, lat, lon))
}
