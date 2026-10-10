/** Static CrisisWatch zones. Every ISO3 in lib/crisis/ingest/iso.ts belongs to exactly one zone. */

export const ZONE_KEYS = [
  'north_america',
  'central_america',
  'south_america',
  'east_asia',
  'southeast_asia',
  'south_asia',
  'central_asia',
  'middle_east',
  'western_europe',
  'northern_europe',
  'eastern_europe',
  'north_africa',
  'west_central_africa',
  'east_southern_africa',
  'oceania',
] as const

export type ZoneKey = (typeof ZONE_KEYS)[number]

export interface CrisisZone {
  key: ZoneKey
  nameKo: string
  nameEn: string
  iso3: readonly string[]
}

export const CRISIS_ZONES: readonly CrisisZone[] = [
  { key: 'north_america', nameKo: '북미', nameEn: 'North America', iso3: ['USA', 'CAN', 'MEX'] },
  {
    key: 'central_america',
    nameKo: '중미·카리브',
    nameEn: 'Central America & Caribbean',
    iso3: ['GTM', 'BLZ', 'HND', 'SLV', 'NIC', 'CRI', 'PAN', 'CUB', 'DOM', 'HTI', 'JAM', 'TTO', 'BRB', 'BHS', 'DMA', 'GRD', 'LCA', 'KNA', 'ATG', 'AIA'],
  },
  {
    key: 'south_america',
    nameKo: '남미',
    nameEn: 'South America',
    iso3: ['COL', 'VEN', 'GUY', 'SUR', 'BRA', 'ECU', 'PER', 'BOL', 'PRY', 'URY', 'ARG', 'CHL'],
  },
  { key: 'east_asia', nameKo: '동아시아', nameEn: 'East Asia', iso3: ['CHN', 'JPN', 'KOR', 'PRK', 'MNG'] },
  {
    key: 'southeast_asia',
    nameKo: '동남아시아',
    nameEn: 'Southeast Asia',
    iso3: ['MMR', 'THA', 'LAO', 'KHM', 'VNM', 'MYS', 'SGP', 'IDN', 'PHL', 'BRN', 'TLS'],
  },
  {
    key: 'south_asia',
    nameKo: '남아시아',
    nameEn: 'South Asia',
    iso3: ['IND', 'PAK', 'BGD', 'NPL', 'BTN', 'LKA', 'MDV', 'AFG'],
  },
  { key: 'central_asia', nameKo: '중앙아시아', nameEn: 'Central Asia', iso3: ['KAZ', 'KGZ', 'TJK', 'TKM', 'UZB'] },
  {
    key: 'middle_east',
    nameKo: '중동',
    nameEn: 'Middle East',
    iso3: ['TUR', 'IRN', 'IRQ', 'SYR', 'LBN', 'ISR', 'PSE', 'JOR', 'SAU', 'YEM', 'OMN', 'ARE', 'QAT', 'KWT', 'BHR', 'CYP', 'GEO', 'ARM', 'AZE'],
  },
  {
    key: 'western_europe',
    nameKo: '서·남유럽',
    nameEn: 'Western & Southern Europe',
    iso3: ['GBR', 'IRL', 'FRA', 'ESP', 'PRT', 'ITA', 'DEU', 'AUT', 'CHE', 'BEL', 'NLD', 'LUX', 'AND', 'MLT', 'GRC'],
  },
  { key: 'northern_europe', nameKo: '북유럽', nameEn: 'Northern Europe', iso3: ['NOR', 'SWE', 'FIN', 'DNK', 'ISL', 'EST', 'LVA', 'LTU'] },
  {
    key: 'eastern_europe',
    nameKo: '동유럽·러시아',
    nameEn: 'Eastern Europe & Russia',
    iso3: ['POL', 'CZE', 'SVK', 'HUN', 'ROU', 'BGR', 'SRB', 'BIH', 'HRV', 'SVN', 'MKD', 'ALB', 'MNE', 'MDA', 'UKR', 'BLR', 'RUS', 'XKX'],
  },
  { key: 'north_africa', nameKo: '북아프리카', nameEn: 'North Africa', iso3: ['MAR', 'DZA', 'TUN', 'LBY', 'EGY'] },
  {
    key: 'west_central_africa',
    nameKo: '서·중부아프리카',
    nameEn: 'West & Central Africa',
    iso3: ['SEN', 'GMB', 'GNB', 'GIN', 'SLE', 'LBR', 'CIV', 'GHA', 'TGO', 'BEN', 'NGA', 'NER', 'MLI', 'BFA', 'MRT', 'CPV', 'STP', 'CMR', 'CAF', 'TCD', 'GNQ', 'GAB', 'COG', 'COD'],
  },
  {
    key: 'east_southern_africa',
    nameKo: '동·남부아프리카',
    nameEn: 'East & Southern Africa',
    iso3: ['SDN', 'SSD', 'ETH', 'ERI', 'DJI', 'SOM', 'KEN', 'UGA', 'RWA', 'BDI', 'TZA', 'MWI', 'MOZ', 'ZMB', 'ZWE', 'BWA', 'NAM', 'ZAF', 'LSO', 'SWZ', 'AGO', 'MDG', 'COM', 'MUS', 'SYC'],
  },
  { key: 'oceania', nameKo: '오세아니아', nameEn: 'Oceania', iso3: ['AUS', 'NZL', 'PNG', 'FJI', 'SLB', 'VUT', 'WSM', 'TON'] },
]

const ZONE_BY_ISO3 = new Map<string, CrisisZone>()
for (const zone of CRISIS_ZONES) {
  for (const iso3 of zone.iso3) ZONE_BY_ISO3.set(iso3, zone)
}

export function isZoneKey(value: unknown): value is ZoneKey {
  return typeof value === 'string' && (ZONE_KEYS as readonly string[]).includes(value)
}

export function zoneByKey(key: string | null | undefined): CrisisZone | null {
  return CRISIS_ZONES.find((zone) => zone.key === key) ?? null
}

export function zoneForIso3(iso3: string | null | undefined): CrisisZone | null {
  if (!iso3) return null
  return ZONE_BY_ISO3.get(iso3.trim().toUpperCase()) ?? null
}

export function zoneDisplayName(zone: CrisisZone, locale: string): string {
  return locale === 'ko' ? zone.nameKo : zone.nameEn
}
