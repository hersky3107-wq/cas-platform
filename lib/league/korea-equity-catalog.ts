/**
 * Korean equity universe types, sector groups, rank hysteresis, and KRSTOCK
 * instrument codec. Pure module — no network, DB, UI, or generate registration.
 *
 * Registered in a later piece once KRX close data and the universe gate exist —
 * generating without data would publish coin-flip rounds.
 *
 * Codec conventions mirror `gateway/adapters/stock-catalog.ts` (STOCK:),
 * `gateway/adapters/sports-catalog.ts` (MATCH:), and
 * `gateway/adapters/real-estate-catalog.ts` (PROPERTY:): encode returns null
 * on invalid input; decode returns null (never throws); fixed segment count.
 */

export type KrMarket = 'KOSPI' | 'KOSDAQ'

export type UniverseMarket = KrMarket | 'US'

export type UniverseStatus = 'auto' | 'pinned' | 'hidden'

export interface UniverseRow {
  code: string
  name: string
  market: UniverseMarket
  groupId: KrGroupId | null
  status: UniverseStatus
  popularityRank: number | null
  removedAt: string | null
}

export const KR_GROUPS = [
  { id: 'semis', label: '반도체·장비' },
  { id: 'battery', label: '2차전지' },
  { id: 'auto', label: '자동차·부품' },
  { id: 'bio', label: '바이오·헬스케어' },
  { id: 'ship_defense', label: '조선·방산·우주' },
  { id: 'power_machinery', label: '전력·원전·기계' },
  { id: 'internet_ent', label: '인터넷·게임·엔터' },
  { id: 'finance', label: '금융·지주' },
  { id: 'materials_energy', label: '화학·철강·에너지' },
  { id: 'consumer', label: '소비재·유통·화장품·식품' },
  { id: 'infra', label: '건설·통신·운송' },
  { id: 'other', label: '기타' },
] as const

export type KrGroupId = (typeof KR_GROUPS)[number]['id']

const KR_GROUP_IDS = new Set<string>(KR_GROUPS.map((g) => g.id))
const KR_GROUP_ORDER = new Map<string, number>(KR_GROUPS.map((g, i) => [g.id, i]))

export function isKrGroupId(value: string): value is KrGroupId {
  return KR_GROUP_IDS.has(value)
}

/** Enter the auto universe at or below this rank (per market). */
export const KR_ENTER_RANK = 175

/** Remain in the auto universe at or below this rank once visible (per market). */
export const KR_EXIT_RANK = 220

const KR_CODE_RE = /^[0-9A-Z]{6}$/

export function encodeKrStockInstrument(market: KrMarket, code: string): string | null {
  if (market !== 'KOSPI' && market !== 'KOSDAQ') return null
  if (!KR_CODE_RE.test(code)) return null
  return `KRSTOCK:${market}:${code}`
}

export function decodeKrStockInstrument(s: string | null | undefined): { market: KrMarket; code: string } | null {
  if (!s) return null
  if (s.includes('%')) return null
  const parts = s.split(':')
  if (parts.length !== 3 || parts[0] !== 'KRSTOCK') return null
  const market = parts[1]
  const code = parts[2] ?? ''
  if (market !== 'KOSPI' && market !== 'KOSDAQ') return null
  if (!KR_CODE_RE.test(code)) return null
  return { market, code }
}

export function isKrStockInstrument(s: string): boolean {
  return decodeKrStockInstrument(s) !== null
}

export function decideUniverseStatus(
  prev: UniverseRow | undefined,
  newRank: number | null,
  excluded: boolean,
  now: string,
): { visible: boolean; removedAt: string | null } {
  const status = prev?.status ?? 'auto'

  if (excluded) {
    return {
      visible: false,
      removedAt: prev?.removedAt ?? now,
    }
  }

  if (status === 'hidden') {
    return { visible: false, removedAt: prev?.removedAt ?? null }
  }

  if (status === 'pinned') {
    return { visible: true, removedAt: null }
  }

  const currentlyVisible = prev !== undefined && prev.removedAt === null

  if (!currentlyVisible) {
    if (newRank !== null && newRank <= KR_ENTER_RANK) {
      return { visible: true, removedAt: null }
    }
    return { visible: false, removedAt: prev?.removedAt ?? null }
  }

  if (newRank !== null && newRank <= KR_EXIT_RANK) {
    return { visible: true, removedAt: null }
  }

  return { visible: false, removedAt: now }
}

/**
 * Visible-universe sort: KR by KR_GROUPS product order then popularity_rank;
 * US by popularity_rank. Missing ranks sort last; ties break on code.
 */
export function orderVisibleUniverseRows<
  T extends {
    market: UniverseMarket
    groupId: KrGroupId | null
    popularityRank: number | null
    code: string
  },
>(rows: T[], market: UniverseMarket): T[] {
  const copy = [...rows]
  if (market === 'US') {
    return copy.sort((a, b) => compareRankThenCode(a, b))
  }
  return copy.sort((a, b) => {
    const ga = KR_GROUP_ORDER.get(a.groupId ?? 'other') ?? KR_GROUPS.length
    const gb = KR_GROUP_ORDER.get(b.groupId ?? 'other') ?? KR_GROUPS.length
    if (ga !== gb) return ga - gb
    return compareRankThenCode(a, b)
  })
}

function compareRankThenCode(
  a: { popularityRank: number | null; code: string },
  b: { popularityRank: number | null; code: string },
): number {
  const ra = a.popularityRank ?? Number.POSITIVE_INFINITY
  const rb = b.popularityRank ?? Number.POSITIVE_INFINITY
  if (ra !== rb) return ra - rb
  return a.code.localeCompare(b.code)
}
