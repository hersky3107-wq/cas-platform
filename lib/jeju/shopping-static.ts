/**
 * STATIC Jeju shopping landmarks — foreigner shopping chip data.
 *
 * Pure data, no fetching, no UI. The chip will later MERGE this static set
 * with live VisitJeju c2 (쇼핑) results:
 *   - STATIC_SHOPPING: hand-curated landmarks NOT in VisitJeju c2 (duty-free,
 *     city duty-free, 제주민속오일장). Each carries its own coords so the
 *     shared map-link builders in app/jeju/tourist/place-detail.ts
 *     (googleMapsUrl / naverMapsUrl / kakaoMapsUrl) work via the coord-pin
 *     branch — same UX as VisitJeju cards.
 *   - VISITJEJU_LANDMARK_IDS: contentsids of markets that DO exist in c2
 *     (동문재래시장, 동문수산시장, 서귀포매일올레시장, 제주 중앙지하상가).
 *     These are referenced, NOT duplicated here — the merge step fetches them
 *     from VisitJeju to inherit multilingual title/address + coords for free.
 *
 * Place NAMES are proper nouns and stay Korean + romanized/English. Any
 * human-facing UI label (category names, "sponsor" badge, caveats header)
 * routes through lib/jeju/tourist-labels.ts — NOT hardcoded here.
 */

export type ShoppingCategory = 'dutyfree' | 'market' | 'mall'

export interface ShoppingLandmark {
  /** Stable id, unique within the static set. */
  id: string
  /** Korean name (proper noun). */
  nameKo: string
  /** English / romanized name (proper noun). */
  nameEn: string
  /** Landmark type — drives grouping + label lookup in tourist-labels.ts. */
  category: ShoppingCategory
  /** Korean road/jibun address. */
  address: string
  /** Phone, or null when unknown. */
  phone: string | null
  /** Official homepage URL, or null when unknown. */
  homepage: string | null
  /** Latitude (WGS84). */
  lat: number
  /** Longitude (WGS84). */
  lng: number
  /**
   * Sponsored placement (e.g. JDC duty-free). When true, the chip pins these to
   * the top and may show a sponsor badge. Does not change data accuracy.
   * Default false.
   */
  sponsor: boolean
  /** Short caveat / usage note, or null. E.g. opening days, purchase limits. */
  note: string | null
  /** Sort weight — lower sorts higher in the list. */
  sortPriority: number
}

/**
 * Hand-curated static landmarks. Sort priority: 0 = JDC duty-free (sponsor,
 * pinned top), 1 = city duty-free, 2 = static markets. VisitJeju-referenced
 * markets are NOT in this array — see VISITJEJU_LANDMARK_IDS.
 */
export const STATIC_SHOPPING: readonly ShoppingLandmark[] = [
  // ── JDC duty-free (sponsor — pinned to top) ───────────────────────────────
  {
    id: 'jdc-airport',
    nameKo: 'JDC 지정면세점 제주공항점',
    nameEn: 'JDC Duty Free (Jeju Airport)',
    category: 'dutyfree',
    address: '제주시 공항로 2 (용담이동)',
    phone: '064-740-9900',
    homepage: 'https://www.jdcdutyfree.com',
    lat: 33.5069,
    lng: 126.4930,
    sponsor: true,
    sortPriority: 0,
    note: 'For travelers departing Jeju (domestic/international). Limit USD 800/visit, up to 6x/year.',
  },
  {
    id: 'jdc-port1',
    nameKo: 'JDC 지정면세점 제주항(연안여객터미널)',
    nameEn: 'JDC Duty Free (Jeju Port – Coastal Terminal)',
    category: 'dutyfree',
    address: '제주시 임항로 111 (건입동)',
    phone: '064-740-9934',
    homepage: 'https://www.jdcdutyfree.com',
    lat: 33.5195,
    lng: 126.5351,
    sponsor: true,
    sortPriority: 0,
    note: 'For travelers departing Jeju (domestic/international). Limit USD 800/visit, up to 6x/year.',
  },
  {
    id: 'jdc-port2',
    nameKo: 'JDC 지정면세점 제주항(국제여객터미널)',
    nameEn: 'JDC Duty Free (Jeju Port – International Terminal)',
    category: 'dutyfree',
    address: '제주시 임항로 191 (건입동)',
    phone: '064-740-9935',
    homepage: 'https://www.jdcdutyfree.com',
    lat: 33.5265,
    lng: 126.5439,
    sponsor: true,
    sortPriority: 0,
    note: 'For travelers departing Jeju (domestic/international). Limit USD 800/visit, up to 6x/year.',
  },

  // ── City duty-free ─────────────────────────────────────────────────────────
  {
    id: 'lotte-df',
    nameKo: '롯데면세점 제주점',
    nameEn: 'Lotte Duty Free Jeju',
    category: 'dutyfree',
    address: '제주시 도령로 83 (롯데시티호텔 1~3층)',
    phone: '064-793-3000',
    homepage: null,
    lat: 33.4906,
    lng: 126.4866,
    sponsor: false,
    sortPriority: 1,
    note: 'Hours/brands may change — check before visiting.',
  },
  {
    id: 'shilla-df',
    nameKo: '신라면세점 제주점',
    nameEn: 'Shilla Duty Free Jeju',
    category: 'dutyfree',
    address: '제주시 노연로 69',
    phone: '1688-1110',
    homepage: null,
    lat: 33.4863,
    lng: 126.4874,
    sponsor: false,
    sortPriority: 1,
    note: 'Hours/brands may change — check before visiting.',
  },

  // ── Static markets (NOT in VisitJeju c2) ───────────────────────────────────
  {
    id: 'minsok-5day',
    nameKo: '제주민속오일장',
    nameEn: 'Jeju Folk Five-Day Market',
    category: 'market',
    address: '제주시 오일장서길 26',
    phone: '064-743-5985',
    homepage: null,
    lat: 33.4969,
    lng: 126.4754,
    sponsor: false,
    sortPriority: 2,
    note: 'Open on days ending in 2 and 7. 07:00–18:00.',
  },
]

/**
 * VisitJeju c2 contentsids of landmark markets that ALREADY exist in the API.
 * The merge step fetches these from VisitJeju (via searchList, category=c2) to
 * inherit multilingual title/address + coords — DO NOT duplicate their
 * address/phone/coords as static entries.
 *
 * Verified present in c2 (locale=kr, totalCount=262) on 2026-07-10:
 *   - 동문재래시장 Dongmun Market
 *   - 동문수산시장 Dongmun Fish Market
 *   - 서귀포매일올레시장 Seogwipo Olle Market
 *   - 제주 중앙지하상가 Jeju Central Underground Mall
 */
export const VISITJEJU_LANDMARK_IDS: readonly string[] = [
  'CONT_000000000500745', // 동문재래시장 Dongmun Market
  'CONT_000000000500744', // 동문수산시장 Dongmun Fish Market
  'CONT_000000000500731', // 서귀포매일올레시장 Seogwipo Olle Market
  'CNTS_200000000012176', // 제주 중앙지하상가 Jeju Central Underground Mall
]
