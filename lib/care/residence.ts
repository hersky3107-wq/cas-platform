/**
 * Residence store — the backbone of nationalization for the care app.
 *
 * A one-time "거주지 설정" picks the user's 시·도 (and optionally 시·군·구). Every
 * region-dependent feature (weather, HIRA medical search, local news, welfare
 * context, emergency guidance) reads from here.
 *
 * Persistence: localStorage only (no DB, no login), guarded with try/catch so a
 * private-mode / blocked-storage browser never crashes — it just behaves as
 * "not set" and the caller can fall back to DEFAULT_RESIDENCE.
 *
 * Data table: all 17 시·도 with
 *   - display name
 *   - HIRA `sidoCd` (건강보험심사평가원 병원/약국 정보서비스 코드; e.g. 서울 110000,
 *     부산 210000, 제주 390000, 세종 410000 — verified against getHospBasisList)
 *   - representative lat/lng (city-center) for weather
 *   - 시·군·구 list, each with refined coordinates (metros use the metro center,
 *     since intra-city weather is uniform; provinces use each city/county center)
 */

export interface Sigungu {
  name: string
  lat: number
  lng: number
}

export interface SidoInfo {
  /** Display name, e.g. "서울특별시". */
  name: string
  /** HIRA sidoCd, e.g. "110000". */
  code: string
  /** English slug used as the welfare `region` key (e.g. "seoul", "jeju"). */
  regionKey: string
  /** Representative (city-center) coordinates for weather. */
  lat: number
  lng: number
  sigungu: Sigungu[]
}

/** The residence value persisted for the user. */
export interface Residence {
  /** 시·도 display name, e.g. "서울특별시". */
  sido: string
  /** HIRA sidoCd, e.g. "110000". */
  sidoCode: string
  /** 시·군·구 display name, e.g. "종로구". Empty string = whole 시·도. */
  sigungu: string
  lat: number
  lng: number
}

// ── Coordinate helpers ─────────────────────────────────────────────────────────

/** Build a 시·군·구 list that all share one coordinate (metros: uniform weather). */
function atCenter(names: string[], lat: number, lng: number): Sigungu[] {
  return names.map((name) => ({ name, lat, lng }))
}

// ── The 17 시·도 table ───────────────────────────────────────────────────────────

export const REGIONS: SidoInfo[] = [
  {
    name: '서울특별시',
    code: '110000',
    regionKey: 'seoul',
    lat: 37.5665,
    lng: 126.978,
    sigungu: atCenter(
      [
        '종로구', '중구', '용산구', '성동구', '광진구', '동대문구', '중랑구', '성북구',
        '강북구', '도봉구', '노원구', '은평구', '서대문구', '마포구', '양천구', '강서구',
        '구로구', '금천구', '영등포구', '동작구', '관악구', '서초구', '강남구', '송파구', '강동구',
      ],
      37.5665,
      126.978
    ),
  },
  {
    name: '부산광역시',
    code: '210000',
    regionKey: 'busan',
    lat: 35.1796,
    lng: 129.0756,
    sigungu: atCenter(
      [
        '중구', '서구', '동구', '영도구', '부산진구', '동래구', '남구', '북구',
        '해운대구', '사하구', '금정구', '강서구', '연제구', '수영구', '사상구', '기장군',
      ],
      35.1796,
      129.0756
    ),
  },
  {
    name: '대구광역시',
    code: '230000',
    regionKey: 'daegu',
    lat: 35.8714,
    lng: 128.6014,
    sigungu: atCenter(
      ['중구', '동구', '서구', '남구', '북구', '수성구', '달서구', '달성군', '군위군'],
      35.8714,
      128.6014
    ),
  },
  {
    name: '인천광역시',
    code: '220000',
    regionKey: 'incheon',
    lat: 37.4563,
    lng: 126.7052,
    sigungu: atCenter(
      ['중구', '동구', '미추홀구', '연수구', '남동구', '부평구', '계양구', '서구', '강화군', '옹진군'],
      37.4563,
      126.7052
    ),
  },
  {
    name: '광주광역시',
    code: '240000',
    regionKey: 'gwangju',
    lat: 35.1595,
    lng: 126.8526,
    sigungu: atCenter(['동구', '서구', '남구', '북구', '광산구'], 35.1595, 126.8526),
  },
  {
    name: '대전광역시',
    code: '250000',
    regionKey: 'daejeon',
    lat: 36.3504,
    lng: 127.3845,
    sigungu: atCenter(['동구', '중구', '서구', '유성구', '대덕구'], 36.3504, 127.3845),
  },
  {
    name: '울산광역시',
    code: '260000',
    regionKey: 'ulsan',
    lat: 35.5384,
    lng: 129.3114,
    sigungu: atCenter(['중구', '남구', '동구', '북구', '울주군'], 35.5384, 129.3114),
  },
  {
    name: '세종특별자치시',
    code: '410000',
    regionKey: 'sejong',
    lat: 36.4801,
    lng: 127.289,
    sigungu: [{ name: '세종시 전체', lat: 36.4801, lng: 127.289 }],
  },
  {
    name: '경기도',
    code: '310000',
    regionKey: 'gyeonggi',
    lat: 37.2636,
    lng: 127.0286,
    sigungu: [
      { name: '수원시', lat: 37.2636, lng: 127.0286 },
      { name: '성남시', lat: 37.42, lng: 127.1265 },
      { name: '의정부시', lat: 37.7381, lng: 127.0338 },
      { name: '안양시', lat: 37.3943, lng: 126.9568 },
      { name: '부천시', lat: 37.5035, lng: 126.766 },
      { name: '광명시', lat: 37.4786, lng: 126.8646 },
      { name: '평택시', lat: 36.9921, lng: 127.1129 },
      { name: '동두천시', lat: 37.9036, lng: 127.0606 },
      { name: '안산시', lat: 37.3219, lng: 126.8309 },
      { name: '고양시', lat: 37.6584, lng: 126.832 },
      { name: '과천시', lat: 37.4292, lng: 126.9877 },
      { name: '구리시', lat: 37.5943, lng: 127.1296 },
      { name: '남양주시', lat: 37.636, lng: 127.2165 },
      { name: '오산시', lat: 37.1499, lng: 127.0772 },
      { name: '시흥시', lat: 37.38, lng: 126.8029 },
      { name: '군포시', lat: 37.3617, lng: 126.9352 },
      { name: '의왕시', lat: 37.3446, lng: 126.9683 },
      { name: '하남시', lat: 37.5393, lng: 127.2148 },
      { name: '용인시', lat: 37.2411, lng: 127.1776 },
      { name: '파주시', lat: 37.7599, lng: 126.78 },
      { name: '이천시', lat: 37.272, lng: 127.435 },
      { name: '안성시', lat: 37.008, lng: 127.2797 },
      { name: '김포시', lat: 37.6152, lng: 126.7157 },
      { name: '화성시', lat: 37.1996, lng: 126.831 },
      { name: '광주시', lat: 37.4292, lng: 127.255 },
      { name: '양주시', lat: 37.7852, lng: 127.0459 },
      { name: '포천시', lat: 37.8949, lng: 127.2003 },
      { name: '여주시', lat: 37.2982, lng: 127.6371 },
      { name: '연천군', lat: 38.0966, lng: 127.0748 },
      { name: '가평군', lat: 37.8315, lng: 127.5106 },
      { name: '양평군', lat: 37.4917, lng: 127.4876 },
    ],
  },
  {
    name: '강원특별자치도',
    code: '320000',
    regionKey: 'gangwon',
    lat: 37.8813,
    lng: 127.73,
    sigungu: [
      { name: '춘천시', lat: 37.8813, lng: 127.73 },
      { name: '원주시', lat: 37.3422, lng: 127.9202 },
      { name: '강릉시', lat: 37.7519, lng: 128.8761 },
      { name: '동해시', lat: 37.5247, lng: 129.1143 },
      { name: '태백시', lat: 37.164, lng: 128.9856 },
      { name: '속초시', lat: 38.207, lng: 128.5918 },
      { name: '삼척시', lat: 37.4499, lng: 129.1655 },
      { name: '홍천군', lat: 37.6971, lng: 127.8888 },
      { name: '횡성군', lat: 37.4917, lng: 127.985 },
      { name: '영월군', lat: 37.1836, lng: 128.4617 },
      { name: '평창군', lat: 37.3705, lng: 128.3902 },
      { name: '정선군', lat: 37.3807, lng: 128.6608 },
      { name: '철원군', lat: 38.1466, lng: 127.3134 },
      { name: '화천군', lat: 38.1061, lng: 127.7081 },
      { name: '양구군', lat: 38.1099, lng: 127.9899 },
      { name: '인제군', lat: 38.0697, lng: 128.1707 },
      { name: '고성군', lat: 38.3806, lng: 128.4677 },
      { name: '양양군', lat: 38.0754, lng: 128.619 },
    ],
  },
  {
    name: '충청북도',
    code: '330000',
    regionKey: 'chungbuk',
    lat: 36.6424,
    lng: 127.489,
    sigungu: [
      { name: '청주시', lat: 36.6424, lng: 127.489 },
      { name: '충주시', lat: 36.991, lng: 127.926 },
      { name: '제천시', lat: 37.1326, lng: 128.191 },
      { name: '보은군', lat: 36.4894, lng: 127.7294 },
      { name: '옥천군', lat: 36.3064, lng: 127.5714 },
      { name: '영동군', lat: 36.175, lng: 127.7833 },
      { name: '증평군', lat: 36.7853, lng: 127.5816 },
      { name: '진천군', lat: 36.8553, lng: 127.4355 },
      { name: '괴산군', lat: 36.8153, lng: 127.7866 },
      { name: '음성군', lat: 36.9403, lng: 127.6903 },
      { name: '단양군', lat: 36.9846, lng: 128.3655 },
    ],
  },
  {
    name: '충청남도',
    code: '340000',
    regionKey: 'chungnam',
    lat: 36.6585,
    lng: 126.664,
    sigungu: [
      { name: '천안시', lat: 36.8151, lng: 127.1139 },
      { name: '공주시', lat: 36.4466, lng: 127.119 },
      { name: '보령시', lat: 36.3492, lng: 126.6127 },
      { name: '아산시', lat: 36.7898, lng: 127.0018 },
      { name: '서산시', lat: 36.7848, lng: 126.4503 },
      { name: '논산시', lat: 36.1872, lng: 127.0987 },
      { name: '계룡시', lat: 36.2745, lng: 127.2489 },
      { name: '당진시', lat: 36.893, lng: 126.628 },
      { name: '금산군', lat: 36.1088, lng: 127.4881 },
      { name: '부여군', lat: 36.2757, lng: 126.9099 },
      { name: '서천군', lat: 36.0803, lng: 126.6913 },
      { name: '청양군', lat: 36.4592, lng: 126.8021 },
      { name: '홍성군', lat: 36.6013, lng: 126.6608 },
      { name: '예산군', lat: 36.6829, lng: 126.8449 },
      { name: '태안군', lat: 36.7456, lng: 126.2979 },
    ],
  },
  {
    name: '전북특별자치도',
    code: '350000',
    regionKey: 'jeonbuk',
    lat: 35.8242,
    lng: 127.148,
    sigungu: [
      { name: '전주시', lat: 35.8242, lng: 127.148 },
      { name: '군산시', lat: 35.9676, lng: 126.7368 },
      { name: '익산시', lat: 35.9483, lng: 126.9577 },
      { name: '정읍시', lat: 35.5699, lng: 126.8558 },
      { name: '남원시', lat: 35.4164, lng: 127.3905 },
      { name: '김제시', lat: 35.8035, lng: 126.8809 },
      { name: '완주군', lat: 35.9047, lng: 127.162 },
      { name: '진안군', lat: 35.7917, lng: 127.4249 },
      { name: '무주군', lat: 36.0068, lng: 127.6608 },
      { name: '장수군', lat: 35.6473, lng: 127.5211 },
      { name: '임실군', lat: 35.6178, lng: 127.2891 },
      { name: '순창군', lat: 35.3743, lng: 127.1376 },
      { name: '고창군', lat: 35.4358, lng: 126.702 },
      { name: '부안군', lat: 35.7318, lng: 126.7333 },
    ],
  },
  {
    name: '전라남도',
    code: '360000',
    regionKey: 'jeonnam',
    lat: 34.9906,
    lng: 126.4416,
    sigungu: [
      { name: '목포시', lat: 34.8118, lng: 126.3922 },
      { name: '여수시', lat: 34.7604, lng: 127.6622 },
      { name: '순천시', lat: 34.9506, lng: 127.4872 },
      { name: '나주시', lat: 35.016, lng: 126.7108 },
      { name: '광양시', lat: 34.9407, lng: 127.6959 },
      { name: '담양군', lat: 35.3211, lng: 126.9882 },
      { name: '곡성군', lat: 35.282, lng: 127.2921 },
      { name: '구례군', lat: 35.2025, lng: 127.4629 },
      { name: '고흥군', lat: 34.6111, lng: 127.285 },
      { name: '보성군', lat: 34.7714, lng: 127.08 },
      { name: '화순군', lat: 35.0645, lng: 126.9866 },
      { name: '장흥군', lat: 34.6816, lng: 126.907 },
      { name: '강진군', lat: 34.642, lng: 126.7672 },
      { name: '해남군', lat: 34.5735, lng: 126.599 },
      { name: '영암군', lat: 34.8, lng: 126.6967 },
      { name: '무안군', lat: 34.9906, lng: 126.4416 },
      { name: '함평군', lat: 35.0658, lng: 126.5165 },
      { name: '영광군', lat: 35.2772, lng: 126.512 },
      { name: '장성군', lat: 35.3018, lng: 126.7889 },
      { name: '완도군', lat: 34.311, lng: 126.755 },
      { name: '진도군', lat: 34.4867, lng: 126.2634 },
      { name: '신안군', lat: 34.8271, lng: 126.1085 },
    ],
  },
  {
    name: '경상북도',
    code: '370000',
    regionKey: 'gyeongbuk',
    lat: 36.5684,
    lng: 128.7294,
    sigungu: [
      { name: '포항시', lat: 36.019, lng: 129.3435 },
      { name: '경주시', lat: 35.8562, lng: 129.2247 },
      { name: '김천시', lat: 36.1398, lng: 128.1136 },
      { name: '안동시', lat: 36.5684, lng: 128.7294 },
      { name: '구미시', lat: 36.1195, lng: 128.3446 },
      { name: '영주시', lat: 36.8057, lng: 128.624 },
      { name: '영천시', lat: 35.9733, lng: 128.9386 },
      { name: '상주시', lat: 36.4109, lng: 128.159 },
      { name: '문경시', lat: 36.5866, lng: 128.1867 },
      { name: '경산시', lat: 35.825, lng: 128.7415 },
      { name: '의성군', lat: 36.3527, lng: 128.6971 },
      { name: '청송군', lat: 36.436, lng: 129.057 },
      { name: '영양군', lat: 36.6667, lng: 129.1124 },
      { name: '영덕군', lat: 36.415, lng: 129.3656 },
      { name: '청도군', lat: 35.6473, lng: 128.734 },
      { name: '고령군', lat: 35.7266, lng: 128.2628 },
      { name: '성주군', lat: 35.9192, lng: 128.283 },
      { name: '칠곡군', lat: 35.9955, lng: 128.4017 },
      { name: '예천군', lat: 36.6577, lng: 128.4527 },
      { name: '봉화군', lat: 36.8932, lng: 128.7325 },
      { name: '울진군', lat: 36.993, lng: 129.4004 },
      { name: '울릉군', lat: 37.4844, lng: 130.9057 },
    ],
  },
  {
    name: '경상남도',
    code: '380000',
    regionKey: 'gyeongnam',
    lat: 35.228,
    lng: 128.6811,
    sigungu: [
      { name: '창원시', lat: 35.228, lng: 128.6811 },
      { name: '진주시', lat: 35.18, lng: 128.1076 },
      { name: '통영시', lat: 34.8544, lng: 128.4331 },
      { name: '사천시', lat: 35.0037, lng: 128.064 },
      { name: '김해시', lat: 35.2285, lng: 128.8894 },
      { name: '밀양시', lat: 35.5038, lng: 128.7469 },
      { name: '거제시', lat: 34.8806, lng: 128.6212 },
      { name: '양산시', lat: 35.335, lng: 129.0372 },
      { name: '의령군', lat: 35.3222, lng: 128.2617 },
      { name: '함안군', lat: 35.2723, lng: 128.4066 },
      { name: '창녕군', lat: 35.5445, lng: 128.4922 },
      { name: '고성군', lat: 34.973, lng: 128.3223 },
      { name: '남해군', lat: 34.8376, lng: 127.8925 },
      { name: '하동군', lat: 35.0672, lng: 127.7514 },
      { name: '산청군', lat: 35.4155, lng: 127.8735 },
      { name: '함양군', lat: 35.5205, lng: 127.725 },
      { name: '거창군', lat: 35.6866, lng: 127.9096 },
      { name: '합천군', lat: 35.5666, lng: 128.1657 },
    ],
  },
  {
    name: '제주특별자치도',
    code: '390000',
    regionKey: 'jeju',
    lat: 33.4996,
    lng: 126.5312,
    sigungu: [
      { name: '제주시', lat: 33.4996, lng: 126.5312 },
      { name: '서귀포시', lat: 33.2541, lng: 126.5601 },
    ],
  },
]

// ── Default (safe fallback) ──────────────────────────────────────────────────

/** Sensible default when the user skips setup or storage is unavailable: 서울. */
export const DEFAULT_RESIDENCE: Residence = {
  sido: '서울특별시',
  sidoCode: '110000',
  sigungu: '',
  lat: 37.5665,
  lng: 126.978,
}

// ── Lookups / builders ──────────────────────────────────────────────────────

export function findSido(code: string): SidoInfo | undefined {
  return REGIONS.find((r) => r.code === code)
}

export function findSidoByName(name: string): SidoInfo | undefined {
  return REGIONS.find((r) => r.name === name)
}

/** Build a Residence from a chosen 시·도 and (optional) 시·군·구. */
export function buildResidence(sido: SidoInfo, sigungu: Sigungu | null): Residence {
  return {
    sido: sido.name,
    sidoCode: sido.code,
    sigungu: sigungu ? sigungu.name : '',
    lat: sigungu ? sigungu.lat : sido.lat,
    lng: sigungu ? sigungu.lng : sido.lng,
  }
}

/** Human label, e.g. "서울특별시 종로구" or "서울특별시" (whole 시·도). */
export function regionLabel(r: Residence): string {
  return r.sigungu ? `${r.sido} ${r.sigungu}` : r.sido
}

/** Short label for tight spots, e.g. "종로구" or "서울특별시". */
export function shortLabel(r: Residence): string {
  return r.sigungu || r.sido
}

/**
 * Welfare `region` key for the matchWelfare query. Each 시·도 maps to its slug
 * (e.g. 서울→'seoul', 제주→'jeju'); matchWelfare then reads region IN (key,
 * 'national'), so the user sees their province's local-government welfare plus
 * nationwide central-government welfare. This is the SAME key the national
 * tagging batch (scripts/tag-welfare-national.ts) stores rows under.
 */
export function welfareRegionKey(sidoCode: string): string {
  return findSido(sidoCode)?.regionKey ?? 'national'
}

/**
 * Legacy 시·도 names → current name, so a welfare feed / batch that still emits
 * pre-특별자치도 labels resolves to the right region.
 */
const SIDO_NAME_ALIASES: Record<string, string> = {
  전라북도: '전북특별자치도',
  강원도: '강원특별자치도',
  서울: '서울특별시',
  부산: '부산광역시',
  대구: '대구광역시',
  인천: '인천광역시',
  광주: '광주광역시',
  대전: '대전광역시',
  울산: '울산광역시',
  세종: '세종특별자치시',
  세종시: '세종특별자치시',
  경기: '경기도',
  강원: '강원특별자치도',
  충북: '충청북도',
  충남: '충청남도',
  전북: '전북특별자치도',
  전남: '전라남도',
  경북: '경상북도',
  경남: '경상남도',
  제주: '제주특별자치도',
}

/**
 * Map a 시·도 display name (as returned by the 지자체복지서비스 API `ctpvNm`, e.g.
 * "서울특별시", "전북특별자치도") to the welfare `region` key used in the
 * jeju_welfare_services table. Returns null when the name is unknown.
 *
 * Single source of truth shared by the residence store, the care welfare query,
 * and the national tagging batch — so a user's residence always resolves to the
 * same region rows that were tagged.
 */
export function sidoNameToRegionKey(name: string): string | null {
  const cleaned = (name ?? '').trim()
  if (!cleaned) return null
  const direct = findSidoByName(cleaned)
  if (direct) return direct.regionKey
  const aliased = SIDO_NAME_ALIASES[cleaned]
  if (aliased) return findSidoByName(aliased)?.regionKey ?? null
  return null
}

// ── Store (localStorage) ──────────────────────────────────────────────────────

const STORAGE_KEY = 'care.residence.v1'

function isValidResidence(v: unknown): v is Residence {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.sido === 'string' &&
    typeof r.sidoCode === 'string' &&
    typeof r.sigungu === 'string' &&
    typeof r.lat === 'number' &&
    typeof r.lng === 'number' &&
    Number.isFinite(r.lat) &&
    Number.isFinite(r.lng)
  )
}

/** Read the saved residence, or null if unset/unavailable/corrupt. */
export function getResidence(): Residence | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return isValidResidence(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Persist the residence. Returns false if storage is unavailable. */
export function setResidence(r: Residence): boolean {
  try {
    if (typeof window === 'undefined') return false
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(r))
    return true
  } catch {
    return false
  }
}

/** True when a valid residence has been saved. */
export function hasResidence(): boolean {
  return getResidence() !== null
}
