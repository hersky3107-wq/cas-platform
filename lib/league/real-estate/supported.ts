/**
 * Regions with a working official series. Australia and Zillow are closed.
 * The hub line and the free-prompt refusal are built from this list.
 */

import type { LeagueLocale } from '../i18n/locales'
import { PROPERTY_REGIONS, type PropertyCountry, type PropertyRegion } from '../gateway/adapters/real-estate-regions'

const ORDER: readonly PropertyCountry[] = ['KR', 'US', 'UK', 'JP']

export function isOfficialHousingRegion(region: Pick<PropertyRegion, 'country' | 'tier'>): boolean {
  if (region.country === 'AU' || region.tier === 'zillow') return false
  return region.country === 'KR' || region.country === 'US' || region.country === 'UK' || region.country === 'JP'
}

export function officialHousingRegions(
  regions: readonly PropertyRegion[] = PROPERTY_REGIONS,
): PropertyRegion[] {
  return regions.filter((region) => isOfficialHousingRegion(region))
}

const COUNTRY_LABEL: Record<LeagueLocale, Record<PropertyCountry, string>> = {
  ko: { KR: '한국', US: '미국', UK: '영국', JP: '일본', AU: '호주' },
  en: { KR: 'Korea', US: 'United States', UK: 'United Kingdom', JP: 'Japan', AU: 'Australia' },
  ja: { KR: '韓国', US: '米国', UK: '英国', JP: '日本', AU: 'オーストラリア' },
  'zh-TW': { KR: '韓國', US: '美國', UK: '英國', JP: '日本', AU: '澳洲' },
  fr: { KR: 'Corée', US: 'États-Unis', UK: 'Royaume-Uni', JP: 'Japon', AU: 'Australie' },
  es: { KR: 'Corea', US: 'Estados Unidos', UK: 'Reino Unido', JP: 'Japón', AU: 'Australia' },
  ar: { KR: 'كوريا', US: 'الولايات المتحدة', UK: 'المملكة المتحدة', JP: 'اليابان', AU: 'أستراليا' },
  pt: { KR: 'Coreia', US: 'Estados Unidos', UK: 'Reino Unido', JP: 'Japão', AU: 'Austrália' },
}

const INTRO: Record<LeagueLocale, string> = {
  ko: '지원 지역',
  en: 'Supported areas',
  ja: '対応地域',
  'zh-TW': '支援地區',
  fr: 'Zones couvertes',
  es: 'Zonas disponibles',
  ar: 'المناطق المدعومة',
  pt: 'Regiões suportadas',
}

export function supportedRegionsLine(
  locale: LeagueLocale,
  regions: readonly PropertyRegion[] = officialHousingRegions(),
): string {
  const parts = ORDER.map((country) => {
    const mine = regions.filter((region) => region.country === country)
    if (mine.length === 0) return ''
    return `${COUNTRY_LABEL[locale][country]}(${coverage(locale, country, mine)})`
  }).filter(Boolean)
  return `${INTRO[locale]}: ${parts.join(', ')}`
}

function coverage(locale: LeagueLocale, country: PropertyCountry, regions: readonly PropertyRegion[]): string {
  if (country === 'KR') return krCoverage(locale, regions)
  if (country === 'US') return usCoverage(locale, regions)
  const names = regions.map((region) => (locale === 'ko' ? region.nameKo : region.nameEn))
  return names.join(locale === 'ko' ? '·' : ', ')
}

function krCoverage(locale: LeagueLocale, regions: readonly PropertyRegion[]): string {
  const bits = [
    regions.some((region) => region.code === 'NAT') ? word(locale, 'national') : '',
    regions.some((region) => region.code !== 'NAT' && region.code.length <= 2) ? word(locale, 'provinces') : '',
    regions.some((region) => region.code.length > 2) ? word(locale, 'districts') : '',
  ].filter(Boolean)
  return bits.join(locale === 'ko' ? '·' : ', ')
}

function usCoverage(locale: LeagueLocale, regions: readonly PropertyRegion[]): string {
  const cities = regions.filter((region) => region.tier === 'official' && region.code !== 'CSUSHPINSA').length
  const states = regions.filter((region) => region.tier === 'fhfa').length
  const bits = [
    regions.some((region) => region.code === 'CSUSHPINSA') ? word(locale, 'national') : '',
    cities > 0 ? word(locale, 'cities', cities) : '',
    states > 0 ? word(locale, 'states', states) : '',
  ].filter(Boolean)
  return bits.join(locale === 'ko' ? '·' : ', ')
}

function word(locale: LeagueLocale, kind: 'national' | 'provinces' | 'districts' | 'cities' | 'states', count = 0): string {
  const ko = locale === 'ko'
  if (kind === 'national') return ko ? '전국' : locale === 'ja' ? '全国' : locale === 'zh-TW' ? '全國' : 'national'
  if (kind === 'provinces') {
    if (ko) return '시도'
    if (locale === 'ja') return '市道'
    if (locale === 'zh-TW') return '市道'
    if (locale === 'fr') return 'provinces'
    if (locale === 'es') return 'provincias'
    if (locale === 'ar') return 'المقاطعات'
    if (locale === 'pt') return 'províncias'
    return 'provinces'
  }
  if (kind === 'districts') {
    if (ko) return '시군구'
    if (locale === 'ja') return '市区郡'
    if (locale === 'zh-TW') return '市郡區'
    if (locale === 'fr') return 'districts'
    if (locale === 'es') return 'distritos'
    if (locale === 'ar') return 'الأحياء'
    if (locale === 'pt') return 'distritos'
    return 'districts'
  }
  if (kind === 'cities') {
    if (ko) return `주요 ${count}개 도시`
    if (locale === 'ja') return `主要${count}都市`
    if (locale === 'zh-TW') return `主要${count}個城市`
    if (locale === 'fr') return `${count} grandes villes`
    if (locale === 'es') return `${count} ciudades principales`
    if (locale === 'ar') return `${count} مدن رئيسية`
    if (locale === 'pt') return `${count} cidades principais`
    return `${count} major cities`
  }
  if (ko) return `${count}개 주`
  if (locale === 'ja') return `${count}州`
  if (locale === 'zh-TW') return `${count}州`
  if (locale === 'fr') return `${count} États`
  if (locale === 'es') return `${count} estados`
  if (locale === 'ar') return `${count} ولايات`
  if (locale === 'pt') return `${count} estados`
  return `${count} states`
}
