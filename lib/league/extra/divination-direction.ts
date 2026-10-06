/**
 * 구성기학 direction of a housing region from its country's capital centre.
 *
 * Origins: 서울 = 서울시청, 東京 = 東京駅, London = Charing Cross,
 * Washington D.C. = the White House, Canberra = Parliament House.
 * A capital's own districts are measured from that same city centre.
 *
 * Points: 시·도 = the 시·도청; 구/borough = district centroid; JP blocks and
 * US metros = the main city; UK nations and US states = rough centroid.
 * National series, the capital itself, and the district that contains the
 * centre read as `center` (중궁).
 *
 * Sectors follow 九星気学: the four cardinal directions span 30°, the four
 * diagonals 60°. Bearings are great-circle initial bearings (true north).
 */
import type { PropertyCountry } from '../gateway/adapters/real-estate-regions'
import type { KigakuOrigin } from './divination-chart-types'
import type { Direction8, KigakuDirection } from './divination-ganzhi'

type LatLng = { lat: number; lng: number }

const CAPITALS: Record<PropertyCountry, { origin: KigakuOrigin; point: LatLng }> = {
  KR: { origin: 'seoul', point: { lat: 37.5663, lng: 126.9779 } },
  JP: { origin: 'tokyo', point: { lat: 35.6812, lng: 139.7671 } },
  UK: { origin: 'london', point: { lat: 51.5073, lng: -0.1276 } },
  US: { origin: 'washington', point: { lat: 38.8977, lng: -77.0365 } },
  AU: { origin: 'canberra', point: { lat: -35.3081, lng: 149.1245 } },
}

const CENTER = 'center' as const

/** Keyed `${country}:${code}` exactly as in PROPERTY_REGIONS. */
const REGION_POINTS: Record<string, LatLng | typeof CENTER> = {
  'KR:NAT': CENTER,
  'KR:11': CENTER,
  'KR:26': { lat: 35.1798, lng: 129.075 },
  'KR:27': { lat: 35.8714, lng: 128.6014 },
  'KR:28': { lat: 37.4563, lng: 126.7052 },
  'KR:29': { lat: 35.1601, lng: 126.8514 },
  'KR:30': { lat: 36.3504, lng: 127.3845 },
  'KR:31': { lat: 35.5384, lng: 129.3114 },
  'KR:36': { lat: 36.48, lng: 127.289 },
  'KR:41': { lat: 37.2886, lng: 127.053 },
  'KR:51': { lat: 37.8853, lng: 127.7298 },
  'KR:43': { lat: 36.6357, lng: 127.4913 },
  'KR:44': { lat: 36.6588, lng: 126.6728 },
  'KR:52': { lat: 35.8203, lng: 127.1088 },
  'KR:46': { lat: 34.8161, lng: 126.4629 },
  'KR:47': { lat: 36.576, lng: 128.5056 },
  'KR:48': { lat: 35.2383, lng: 128.6925 },
  'KR:50': { lat: 33.489, lng: 126.4983 },

  'KR:11110': { lat: 37.5949, lng: 126.9773 },
  'KR:11140': CENTER,
  'KR:11170': { lat: 37.5311, lng: 126.981 },
  'KR:11200': { lat: 37.551, lng: 127.041 },
  'KR:11215': { lat: 37.5468, lng: 127.0857 },
  'KR:11230': { lat: 37.582, lng: 127.0548 },
  'KR:11260': { lat: 37.5978, lng: 127.0929 },
  'KR:11290': { lat: 37.6057, lng: 127.0176 },
  'KR:11305': { lat: 37.643, lng: 127.0111 },
  'KR:11320': { lat: 37.6688, lng: 127.0324 },
  'KR:11350': { lat: 37.6525, lng: 127.075 },
  'KR:11380': { lat: 37.6191, lng: 126.927 },
  'KR:11410': { lat: 37.5778, lng: 126.9391 },
  'KR:11440': { lat: 37.5594, lng: 126.9083 },
  'KR:11470': { lat: 37.5247, lng: 126.8556 },
  'KR:11500': { lat: 37.5613, lng: 126.8228 },
  'KR:11530': { lat: 37.4945, lng: 126.8566 },
  'KR:11545': { lat: 37.4605, lng: 126.9001 },
  'KR:11560': { lat: 37.5223, lng: 126.9102 },
  'KR:11590': { lat: 37.4989, lng: 126.9516 },
  'KR:11620': { lat: 37.4673, lng: 126.9453 },
  'KR:11650': { lat: 37.4735, lng: 127.0311 },
  'KR:11680': { lat: 37.4966, lng: 127.0629 },
  'KR:11710': { lat: 37.5057, lng: 127.1153 },
  'KR:11740': { lat: 37.5502, lng: 127.147 },

  'KR:26350': { lat: 35.1631, lng: 129.1636 },
  'KR:26410': { lat: 35.243, lng: 129.092 },
  'KR:26500': { lat: 35.1455, lng: 129.1131 },
  'KR:26260': { lat: 35.205, lng: 129.0786 },
  'KR:26230': { lat: 35.163, lng: 129.0532 },

  'KR:28185': { lat: 37.4101, lng: 126.6783 },
  'KR:28200': { lat: 37.4473, lng: 126.7315 },
  'KR:28237': { lat: 37.507, lng: 126.7219 },

  'KR:41135': { lat: 37.378, lng: 127.112 },
  'KR:41131': { lat: 37.45, lng: 127.146 },
  'KR:41133': { lat: 37.43, lng: 127.17 },
  'KR:41111': { lat: 37.304, lng: 127.01 },
  'KR:41113': { lat: 37.258, lng: 126.972 },
  'KR:41115': { lat: 37.282, lng: 127.02 },
  'KR:41117': { lat: 37.2596, lng: 127.0466 },
  'KR:41463': { lat: 37.28, lng: 127.115 },
  'KR:41465': { lat: 37.322, lng: 127.098 },
  'KR:41461': { lat: 37.234, lng: 127.201 },
  'KR:41285': { lat: 37.659, lng: 126.774 },
  'KR:41287': { lat: 37.675, lng: 126.75 },
  'KR:41281': { lat: 37.638, lng: 126.832 },
  'KR:41150': { lat: 37.7381, lng: 127.0337 },
  'KR:41590': { lat: 37.1995, lng: 126.831 },

  'US:CSUSHPINSA': CENTER,
  'US:WDXRNSA': CENTER,
  'US:BOXRNSA': { lat: 42.3601, lng: -71.0589 },
  'US:CHXRNSA': { lat: 41.8781, lng: -87.6298 },
  'US:DNXRNSA': { lat: 39.7392, lng: -104.9903 },
  'US:LVXRNSA': { lat: 36.1699, lng: -115.1398 },
  'US:LXXRNSA': { lat: 34.0522, lng: -118.2437 },
  'US:MIXRNSA': { lat: 25.7617, lng: -80.1918 },
  'US:NYXRNSA': { lat: 40.7128, lng: -74.006 },
  'US:SDXRNSA': { lat: 32.7157, lng: -117.1611 },
  'US:SFXRNSA': { lat: 37.7749, lng: -122.4194 },
  'US:ATXRNSA': { lat: 33.749, lng: -84.388 },
  'US:CRXRNSA': { lat: 35.2271, lng: -80.8431 },
  'US:CEXRNSA': { lat: 41.4993, lng: -81.6944 },
  'US:DAXRNSA': { lat: 32.7767, lng: -96.797 },
  'US:DEXRNSA': { lat: 42.3314, lng: -83.0458 },
  'US:MNXRNSA': { lat: 44.9778, lng: -93.265 },
  'US:PHXRNSA': { lat: 33.4484, lng: -112.074 },
  'US:POXRNSA': { lat: 45.5152, lng: -122.6784 },
  'US:SEXRNSA': { lat: 47.6062, lng: -122.3321 },
  'US:TPXRNSA': { lat: 27.9506, lng: -82.4572 },
  'US:FHFA_CA': { lat: 36.7783, lng: -119.4179 },
  'US:FHFA_NY': { lat: 42.9538, lng: -75.5268 },
  'US:FHFA_TX': { lat: 31.9686, lng: -99.9018 },
  'US:FHFA_FL': { lat: 27.9944, lng: -81.7603 },
  'US:FHFA_WA': { lat: 47.7511, lng: -120.7401 },
  'US:FHFA_IL': { lat: 40.6331, lng: -89.3985 },
  'US:ZZSOHO': { lat: 40.7233, lng: -74.003 },
  'US:ZZBK': { lat: 40.6782, lng: -73.9442 },

  'UK:K02000001': CENTER,
  'UK:E12000007': CENTER,
  'UK:E09000033': CENTER,
  'UK:E92000001': { lat: 52.5619, lng: -1.4646 },
  'UK:W92000004': { lat: 52.1307, lng: -3.7837 },
  'UK:S92000003': { lat: 56.4907, lng: -4.2026 },
  'UK:N92000002': { lat: 54.7877, lng: -6.4923 },
  'UK:E12000008': { lat: 51.3, lng: -0.75 },
  'UK:E09000007': { lat: 51.5517, lng: -0.1588 },
  'UK:E09000020': { lat: 51.4991, lng: -0.1938 },
  'UK:E09000028': { lat: 51.4734, lng: -0.0755 },
  'UK:E09000030': { lat: 51.5099, lng: -0.0059 },

  'JP:NAT': CENTER,
  'JP:13': CENTER,
  'JP:KANTO': CENTER,
  'JP:SOUTH_KANTO': CENTER,
  'JP:HOKKAIDO': { lat: 43.0642, lng: 141.3469 },
  'JP:TOHOKU': { lat: 38.2682, lng: 140.8694 },
  'JP:HOKURIKU': { lat: 36.5613, lng: 136.6562 },
  'JP:CHUBU': { lat: 35.1815, lng: 136.9066 },
  'JP:KINKI': { lat: 34.6937, lng: 135.5023 },
  'JP:CHUGOKU': { lat: 34.3853, lng: 132.4553 },
  'JP:SHIKOKU': { lat: 34.3428, lng: 134.0466 },
  'JP:KYUSHU': { lat: 33.5904, lng: 130.4017 },
  'JP:NAGOYA': { lat: 35.1815, lng: 136.9066 },
  'JP:KEIHANSHIN': { lat: 34.6937, lng: 135.5023 },
  'JP:23': { lat: 35.1802, lng: 136.9066 },
  'JP:27': { lat: 34.6863, lng: 135.52 },

  'AU:AUS': CENTER,
  'AU:CBR': CENTER,
  'AU:SYD': { lat: -33.8688, lng: 151.2093 },
  'AU:MEL': { lat: -37.8136, lng: 144.9631 },
  'AU:BRI': { lat: -27.4698, lng: 153.0251 },
  'AU:ADL': { lat: -34.9285, lng: 138.6007 },
  'AU:PER': { lat: -31.9505, lng: 115.8605 },
  'AU:HOB': { lat: -42.8821, lng: 147.3272 },
  'AU:DAR': { lat: -12.4634, lng: 130.8456 },
}

const RAD = Math.PI / 180

export function initialBearingDeg(from: LatLng, to: LatLng): number {
  const lat1 = from.lat * RAD
  const lat2 = to.lat * RAD
  const dLng = (to.lng - from.lng) * RAD
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.atan2(y, x) / RAD + 360) % 360
}

/** 九星気学 sectors: N/E/S/W 30° each, NE/SE/SW/NW 60° each. */
export function kigakuSector(bearing: number): Direction8 {
  const b = ((bearing % 360) + 360) % 360
  if (b >= 345 || b < 15) return 'N'
  if (b < 75) return 'NE'
  if (b < 105) return 'E'
  if (b < 165) return 'SE'
  if (b < 195) return 'S'
  if (b < 255) return 'SW'
  if (b < 285) return 'W'
  return 'NW'
}

export type RegionDirection = {
  origin: KigakuOrigin
  direction: KigakuDirection
  bearing: number | null
}

export function propertyRegionDirection(country: string, code: string): RegionDirection | null {
  const capital = CAPITALS[country as PropertyCountry]
  const point = REGION_POINTS[`${country}:${code}`]
  if (!capital || !point) return null
  if (point === CENTER) return { origin: capital.origin, direction: 'center', bearing: null }
  const bearing = initialBearingDeg(capital.point, point)
  return { origin: capital.origin, direction: kigakuSector(bearing), bearing: Math.round(bearing * 10) / 10 }
}

export const KIGAKU_ORIGIN_KO: Record<KigakuOrigin, string> = {
  seoul: '서울 중심',
  tokyo: '도쿄 중심',
  london: '런던 중심',
  washington: '워싱턴 D.C. 중심',
  canberra: '캔버라 중심',
}
