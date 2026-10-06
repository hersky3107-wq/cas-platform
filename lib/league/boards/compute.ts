import { COIN_FLIP_EXPECTED_PCT } from '../baselines'
import { CAMPS, LEAGUE_TIERS } from '../card-types'
import { EXTRA_SEAT_IDS, isExtraSeat } from '../extra/seats'
import { FINANCE_LEDGER_CATEGORIES, WORLD_LEDGER_CATEGORIES } from '../hub-doors'
import { LEAGUE_ROSTER } from '../roster'
import { truncateWinRatePct, WIN_RATE_MIN_SAMPLE } from '../win-rate'
import { kstDayIndex, kstMonth } from './filters'
import { companyOf, familyOf, modelOrderOf, weightsOf } from './model-meta'
import type {
  AgreementBoard,
  BannerBoard,
  BoardPrediction,
  BoardRate,
  BoardRound,
  BoardRow,
  BoardSet,
  CategoriesBoard,
  CompaniesBoard,
  ConfidenceRow,
  ExtrasBoard,
  FameBoard,
  GroupsBoard,
  HighlightCard,
  LensesBoard,
  LoneWolfRow,
  ModelRow,
  ModelsBoard,
  SiblingBattle,
  StreakRow,
} from './types'

/**
 * Leaderboard boards (pure). `rounds` are already the filtered public set;
 * predictions outside them are ignored, so callers cannot leak a test or
 * voided round in through the prediction list.
 */

export const BLUFF_MIN_CONFIDENCE = 75
export const HUMBLE_MAX_CONFIDENCE = 60
export const LONE_WOLF_MAX_SEATS = 3
const STREAK_MIN = 2
const FAME_LIMIT = 10
const LONE_WOLF_ROUND_LIMIT = 20

export const MAJORITY_SHARE_BUCKETS = ['85+', '70-84', '<70'] as const
export const CONFIDENCE_BUCKETS = ['80+', '70-79', '60-69', '<60'] as const

const CATEGORY_ORDER: readonly string[] = [...FINANCE_LEDGER_CATEGORIES, ...WORLD_LEDGER_CATEGORIES]
const HORIZON_ORDER: readonly string[] = ['1d', '1w', '1m', '3m']

type Acc = { correct: number; n: number; rounds: Set<string> }

function acc(): Acc {
  return { correct: 0, n: 0, rounds: new Set() }
}

function add(target: Acc, roundId: string, correct: boolean): void {
  target.n += 1
  target.rounds.add(roundId)
  if (correct) target.correct += 1
}

/** Gate on distinct rounds; the percentage is truncated, never rounded up. */
export function boardRate(correct: number, n: number, rounds: number = n): BoardRate {
  return {
    correct,
    n,
    rounds,
    pct: n > 0 && rounds >= WIN_RATE_MIN_SAMPLE ? truncateWinRatePct(correct, n) : null,
  }
}

function rateOf(a: Acc | undefined): BoardRate {
  if (!a) return boardRate(0, 0, 0)
  return boardRate(a.correct, a.n, a.rounds.size)
}

function bucket<K>(map: Map<K, Acc>, key: K): Acc {
  let found = map.get(key)
  if (!found) {
    found = acc()
    map.set(key, found)
  }
  return found
}

function orderIndex(order: readonly string[], key: string): number {
  const index = order.indexOf(key)
  return index === -1 ? order.length : index
}

/**
 * Rated rows first by rate (ties share a rank), then by sample; rows below the
 * minimum sample follow in `orderOf` order, which says nothing about
 * performance, and get no rank.
 */
export function rankRows<T extends BoardRow>(rows: readonly T[], orderOf: (key: string) => number): T[] {
  const rated = rows
    .filter((row) => row.rate.pct !== null)
    .sort((a, b) => (b.rate.pct ?? 0) - (a.rate.pct ?? 0) || b.rate.n - a.rate.n || a.key.localeCompare(b.key))
  const ranked: T[] = []
  rated.forEach((row, index) => {
    const prev = ranked[index - 1]
    const rank = prev && prev.rate.pct === row.rate.pct ? (prev.rank as number) : index + 1
    ranked.push({ ...row, rank })
  })
  const unranked = rows
    .filter((row) => row.rate.pct === null)
    .sort((a, b) => orderOf(a.key) - orderOf(b.key) || a.key.localeCompare(b.key))
    .map((row) => ({ ...row, rank: null }))
  return [...ranked, ...unranked]
}

function fixedRows(map: Map<string, Acc>, order: readonly string[], includeEmpty = false): BoardRow[] {
  const keys = includeEmpty ? [...new Set([...order, ...map.keys()])] : [...map.keys()]
  return keys
    .sort((a, b) => orderIndex(order, a) - orderIndex(order, b) || a.localeCompare(b))
    .map((key) => ({ key, rate: rateOf(map.get(key)), rank: null }))
}

export function sideSlot(side: string | null): 'a' | 'b' | null {
  if (side === 'up' || side === 'yes' || side === 'above') return 'a'
  if (side === 'down' || side === 'no' || side === 'below') return 'b'
  return null
}

export function isOfficialPrediction(p: Pick<BoardPrediction, 'modelId' | 'tier'>): boolean {
  return !isExtraSeat({ model_id: p.modelId, league_tier: p.tier })
}

type RoundSides = { a: number; b: number; majority: 'a' | 'b' | null; share: number | null }

function roundSides(official: readonly BoardPrediction[]): RoundSides {
  let a = 0
  let b = 0
  for (const p of official) {
    const slot = sideSlot(p.side)
    if (slot === 'a') a += 1
    else if (slot === 'b') b += 1
  }
  const total = a + b
  return {
    a,
    b,
    majority: a > b ? 'a' : b > a ? 'b' : null,
    share: total > 0 ? Math.max(a, b) / total : null,
  }
}

export function majorityShareBucket(share: number): (typeof MAJORITY_SHARE_BUCKETS)[number] {
  const pct = share * 100
  if (pct >= 85) return '85+'
  if (pct >= 70) return '70-84'
  return '<70'
}

export function confidenceBucket(probability: number): (typeof CONFIDENCE_BUCKETS)[number] {
  if (probability >= 80) return '80+'
  if (probability >= 70) return '70-79'
  if (probability >= 60) return '60-69'
  return '<60'
}

type Ctx = {
  rounds: BoardRound[]
  roundById: Map<string, BoardRound>
  preds: BoardPrediction[]
  official: BoardPrediction[]
  extras: BoardPrediction[]
  officialByRound: Map<string, BoardPrediction[]>
  sidesByRound: Map<string, RoundSides>
}

function context(rounds: readonly BoardRound[], predictions: readonly BoardPrediction[]): Ctx {
  const roundById = new Map(rounds.map((round) => [round.id, round]))
  const preds = predictions.filter((p) => roundById.has(p.roundId))
  const official = preds.filter(isOfficialPrediction)
  const extras = preds.filter((p) => !isOfficialPrediction(p))
  const officialByRound = new Map<string, BoardPrediction[]>()
  for (const p of official) {
    const list = officialByRound.get(p.roundId) ?? []
    list.push(p)
    officialByRound.set(p.roundId, list)
  }
  const sidesByRound = new Map<string, RoundSides>()
  for (const [roundId, list] of officialByRound) sidesByRound.set(roundId, roundSides(list))
  return { rounds: [...rounds], roundById, preds, official, extras, officialByRound, sidesByRound }
}

function banner(ctx: Ctx): BannerBoard {
  const overall = acc()
  const byCategory = new Map<string, Acc>()
  const byHorizon = new Map<string, Acc>()
  for (const round of ctx.rounds) {
    if (round.consensusCorrect === null) continue
    add(overall, round.id, round.consensusCorrect)
    add(bucket(byCategory, round.category), round.id, round.consensusCorrect)
    add(bucket(byHorizon, round.horizon), round.id, round.consensusCorrect)
  }
  return {
    overall: rateOf(overall),
    byCategory: fixedRows(byCategory, CATEGORY_ORDER),
    byHorizon: fixedRows(byHorizon, HORIZON_ORDER),
    coinFlipPct: COIN_FLIP_EXPECTED_PCT,
  }
}

function groups(ctx: Ctx): GroupsBoard {
  const camp = new Map<string, Acc>()
  const tier = new Map<string, Acc>()
  const book = new Map<string, Acc>()
  const weights = new Map<string, Acc>()
  for (const p of ctx.preds) add(bucket(tier, p.tier), p.roundId, p.correct)
  for (const p of ctx.official) {
    add(bucket(camp, p.camp), p.roundId, p.correct)
    add(bucket(book, p.tier === 'scout' ? 'search' : 'reasoning'), p.roundId, p.correct)
    const kind = weightsOf(p.modelId)
    if (kind) add(bucket(weights, kind), p.roundId, p.correct)
  }
  return {
    camp: fixedRows(camp, CAMPS, true).filter((row) => (CAMPS as readonly string[]).includes(row.key)),
    tier: fixedRows(tier, LEAGUE_TIERS, true).filter((row) => (LEAGUE_TIERS as readonly string[]).includes(row.key)),
    book: fixedRows(book, ['reasoning', 'search'], true),
    weights: fixedRows(weights, ['closed', 'open'], true),
  }
}

function agreement(ctx: Ctx): AgreementBoard {
  const share = new Map<string, Acc>()
  const confidence = new Map<string, Acc>()
  for (const round of ctx.rounds) {
    if (round.consensusCorrect === null) continue
    const sides = ctx.sidesByRound.get(round.id)
    if (sides?.share != null) add(bucket(share, majorityShareBucket(sides.share)), round.id, round.consensusCorrect)
    if (round.consensusProbability != null && Number.isFinite(round.consensusProbability)) {
      add(bucket(confidence, confidenceBucket(round.consensusProbability)), round.id, round.consensusCorrect)
    }
  }
  return {
    byMajorityShare: fixedRows(share, MAJORITY_SHARE_BUCKETS, true),
    byConfidence: fixedRows(confidence, CONFIDENCE_BUCKETS, true),
  }
}

function modelRows(preds: readonly BoardPrediction[]): ModelRow[] {
  const byModel = new Map<string, { acc: Acc; first: BoardPrediction }>()
  for (const p of preds) {
    const found = byModel.get(p.modelId) ?? { acc: acc(), first: p }
    add(found.acc, p.roundId, p.correct)
    byModel.set(p.modelId, found)
  }
  const rows: ModelRow[] = [...byModel.entries()].map(([modelId, { acc: a, first }]) => ({
    key: modelId,
    modelId,
    rate: rateOf(a),
    rank: null,
    company: companyOf(modelId, first.brand),
    tier: first.tier,
    camp: first.camp,
  }))
  return rankRows(rows, modelOrderOf)
}

function models(ctx: Ctx): ModelsBoard {
  return { official: modelRows(ctx.official), extras: modelRows(ctx.extras) }
}

function categories(ctx: Ctx): CategoriesBoard {
  const byCategory = new Map<string, BoardPrediction[]>()
  for (const p of ctx.official) {
    const category = ctx.roundById.get(p.roundId)!.category
    const list = byCategory.get(category) ?? []
    list.push(p)
    byCategory.set(category, list)
  }
  const keys = [...byCategory.keys()].sort(
    (a, b) => orderIndex(CATEGORY_ORDER, a) - orderIndex(CATEGORY_ORDER, b) || a.localeCompare(b),
  )
  return {
    categories: keys.map((key) => {
      const all = modelRows(byCategory.get(key)!)
      const ranked = all.filter((row) => row.rank !== null)
      const top = ranked.slice(0, 5)
      const bottom = ranked.length > 5 ? ranked.slice(Math.max(5, ranked.length - 5)) : []
      return { key, top, bottom, all, ranked: ranked.length }
    }),
  }
}

const ROSTER_FAMILIES = new Map<string, Set<string>>()
for (const entry of LEAGUE_ROSTER) {
  if (entry.league_tier === 'scout') continue
  const company = companyOf(entry.model_id)
  const set = ROSTER_FAMILIES.get(company) ?? new Set<string>()
  set.add(familyOf(entry.model_id))
  ROSTER_FAMILIES.set(company, set)
}

const COMPANY_ORDER = [...new Set(LEAGUE_ROSTER.map((entry) => companyOf(entry.model_id)))]

function companyOrderOf(company: string): number {
  return orderIndex(COMPANY_ORDER, company)
}

function companies(ctx: Ctx): CompaniesBoard {
  const totals = new Map<string, Acc>()
  const modelsByCompany = new Map<string, Set<string>>()
  const families = new Map<string, Map<string, { acc: Acc; modelIds: Set<string> }>>()
  for (const p of ctx.official) {
    const company = companyOf(p.modelId, p.brand)
    add(bucket(totals, company), p.roundId, p.correct)
    const seen = modelsByCompany.get(company) ?? new Set<string>()
    seen.add(p.modelId)
    modelsByCompany.set(company, seen)
    if (p.tier === 'scout') continue
    const byFamily = families.get(company) ?? new Map()
    const family = familyOf(p.modelId)
    const entry = byFamily.get(family) ?? { acc: acc(), modelIds: new Set<string>() }
    add(entry.acc, p.roundId, p.correct)
    entry.modelIds.add(p.modelId)
    byFamily.set(family, entry)
    families.set(company, byFamily)
  }

  const companyRows = rankRows(
    [...totals.entries()].map(([key, a]) => ({
      key,
      rate: rateOf(a),
      rank: null,
      models: modelsByCompany.get(key)?.size ?? 0,
    })),
    companyOrderOf,
  )

  const siblingCompanies = new Set([...ROSTER_FAMILIES.keys(), ...families.keys()])
  const siblings: SiblingBattle[] = []
  for (const company of [...siblingCompanies].sort((a, b) => companyOrderOf(a) - companyOrderOf(b) || a.localeCompare(b))) {
    const seen = families.get(company) ?? new Map()
    const names = new Set<string>([...(ROSTER_FAMILIES.get(company) ?? []), ...seen.keys()])
    if (names.size < 2) continue
    const rosterOrder = [...(ROSTER_FAMILIES.get(company) ?? [])]
    const members = rankRows(
      [...names].map((family) => {
        const entry = seen.get(family)
        return {
          key: family,
          rate: rateOf(entry?.acc),
          rank: null,
          modelIds: entry ? [...entry.modelIds].sort((a, b) => modelOrderOf(a) - modelOrderOf(b)) : [],
        }
      }),
      (family) => orderIndex(rosterOrder, family),
    )
    siblings.push({ company, members })
  }
  return { companies: companyRows, siblings }
}

function lenses(ctx: Ctx): LensesBoard {
  const byLens = new Map<string, Acc>()
  let withoutLens = 0
  for (const p of ctx.official) {
    const lens = p.lens?.trim()
    if (!lens) {
      withoutLens += 1
      continue
    }
    add(bucket(byLens, lens), p.roundId, p.correct)
  }
  const rows = rankRows(
    [...byLens.entries()].map(([key, a]) => ({ key, rate: rateOf(a), rank: null })),
    () => 0,
  )
  return { rows, withoutLens }
}

function extras(ctx: Ctx): ExtrasBoard {
  const extraRounds = new Set(ctx.extras.map((p) => p.roundId))
  const pooledExtras = acc()
  const pooledAi = acc()
  for (const p of ctx.extras) add(pooledExtras, p.roundId, p.correct)
  for (const p of ctx.official) if (extraRounds.has(p.roundId)) add(pooledAi, p.roundId, p.correct)

  const bySeat = new Map<string, BoardPrediction[]>()
  for (const p of ctx.extras) {
    const list = bySeat.get(p.modelId) ?? []
    list.push(p)
    bySeat.set(p.modelId, list)
  }
  const seatIds = [...new Set<string>([...EXTRA_SEAT_IDS, ...bySeat.keys()])].filter((id) => id !== 'crow')
  const seats = seatIds.map((key) => {
    const list = bySeat.get(key) ?? []
    const own = acc()
    const extra = acc()
    const ai = acc()
    for (const p of list) {
      add(own, p.roundId, p.correct)
      const round = ctx.roundById.get(p.roundId)!
      if (round.consensusCorrect === null) continue
      add(extra, p.roundId, p.correct)
      add(ai, p.roundId, round.consensusCorrect)
    }
    return { key, own: rateOf(own), rounds: extra.rounds.size, extra: rateOf(extra), ai: rateOf(ai) }
  })

  let answered = 0
  let contrarian = 0
  let contrarianRight = 0
  for (const p of bySeat.get('crow') ?? []) {
    answered += 1
    const majority = ctx.sidesByRound.get(p.roundId)?.majority ?? null
    const slot = sideSlot(p.side)
    if (!majority || !slot || slot === majority) continue
    contrarian += 1
    if (p.correct) contrarianRight += 1
  }

  const byMonth = new Map<string, Acc>()
  for (const p of bySeat.get('replay') ?? []) {
    const month = kstMonth(ctx.roundById.get(p.roundId)!.resolvesAt)
    if (month) add(bucket(byMonth, month), p.roundId, p.correct)
  }
  const replayCurve = [...byMonth.keys()].sort().map((month) => ({ month, rate: rateOf(byMonth.get(month)) }))

  return {
    pooled: { extras: rateOf(pooledExtras), ai40: rateOf(pooledAi) },
    seats,
    crow: { answered, contrarian, contrarianRight },
    replayCurve,
  }
}

function byTime(ctx: Ctx) {
  return (a: BoardPrediction, b: BoardPrediction) => {
    const ra = ctx.roundById.get(a.roundId)!
    const rb = ctx.roundById.get(b.roundId)!
    return ra.resolvesAt.localeCompare(rb.resolvesAt) || ra.id.localeCompare(rb.id)
  }
}

function streakRows(rows: StreakRow[]): StreakRow[] {
  return rows
    .filter((row) => row.length >= STREAK_MIN)
    .sort((a, b) => b.length - a.length || modelOrderOf(a.modelId) - modelOrderOf(b.modelId) || a.modelId.localeCompare(b.modelId))
    .slice(0, FAME_LIMIT)
}

function confidenceRows(
  ctx: Ctx,
  inBand: (probability: number) => boolean,
  isHit: (p: BoardPrediction) => boolean,
): ConfidenceRow[] {
  const byModel = new Map<string, { hits: number; n: number }>()
  for (const p of ctx.official) {
    if (p.probability == null || !Number.isFinite(p.probability) || !inBand(p.probability)) continue
    const row = byModel.get(p.modelId) ?? { hits: 0, n: 0 }
    row.n += 1
    if (isHit(p)) row.hits += 1
    byModel.set(p.modelId, row)
  }
  const rows = [...byModel.entries()].map(([modelId, { hits, n }]) => ({
    modelId,
    hits,
    band: boardRate(hits, n),
    rank: null as number | null,
  }))
  const rated = rows
    .filter((row) => row.band.pct !== null && row.hits > 0)
    .sort(
      (a, b) =>
        b.hits - a.hits ||
        (b.band.pct ?? 0) - (a.band.pct ?? 0) ||
        modelOrderOf(a.modelId) - modelOrderOf(b.modelId) ||
        a.modelId.localeCompare(b.modelId),
    )
  const ranked: ConfidenceRow[] = []
  rated.forEach((row, index) => {
    const prev = ranked[index - 1]
    const tie = prev && prev.hits === row.hits && prev.band.pct === row.band.pct
    ranked.push({ ...row, rank: tie ? prev.rank : index + 1 })
  })
  const rest = rows
    .filter((row) => !rated.includes(row))
    .sort((a, b) => modelOrderOf(a.modelId) - modelOrderOf(b.modelId) || a.modelId.localeCompare(b.modelId))
  return [...ranked, ...rest]
}

function fame(ctx: Ctx): FameBoard {
  const byModel = new Map<string, BoardPrediction[]>()
  for (const p of ctx.official) {
    const list = byModel.get(p.modelId) ?? []
    list.push(p)
    byModel.set(p.modelId, list)
  }
  const current: StreakRow[] = []
  const longest: StreakRow[] = []
  for (const [modelId, list] of byModel) {
    const ordered = [...list].sort(byTime(ctx))
    let run = 0
    let best = 0
    for (const p of ordered) {
      run = p.correct ? run + 1 : 0
      best = Math.max(best, run)
    }
    current.push({ modelId, length: run })
    longest.push({ modelId, length: best })
  }

  const wolves = new Map<string, LoneWolfRow>()
  for (const p of ctx.official) {
    if (!p.correct) continue
    const slot = sideSlot(p.side)
    const sides = ctx.sidesByRound.get(p.roundId)
    if (!slot || !sides || sides[slot] > LONE_WOLF_MAX_SEATS) continue
    if (sides[slot === 'a' ? 'b' : 'a'] <= sides[slot]) continue
    const round = ctx.roundById.get(p.roundId)!
    const row = wolves.get(p.modelId) ?? { modelId: p.modelId, count: 0, rounds: [] }
    row.count += 1
    row.rounds.push({ id: round.id, label: round.label, category: round.category, resolvesAt: round.resolvesAt })
    wolves.set(p.modelId, row)
  }
  const loneWolves = [...wolves.values()]
    .map((row) => ({
      ...row,
      rounds: [...row.rounds]
        .sort((a, b) => b.resolvesAt.localeCompare(a.resolvesAt) || a.id.localeCompare(b.id))
        .slice(0, LONE_WOLF_ROUND_LIMIT),
    }))
    .sort((a, b) => b.count - a.count || modelOrderOf(a.modelId) - modelOrderOf(b.modelId) || a.modelId.localeCompare(b.modelId))
    .slice(0, FAME_LIMIT)

  return {
    currentStreaks: streakRows(current),
    longestStreaks: streakRows(longest),
    loneWolves,
    bluff: confidenceRows(ctx, (pr) => pr >= BLUFF_MIN_CONFIDENCE, (p) => !p.correct),
    humble: confidenceRows(ctx, (pr) => pr <= HUMBLE_MAX_CONFIDENCE, (p) => p.correct),
  }
}

function highlights(
  board: Pick<BoardSet, 'groups' | 'extras' | 'companies'>,
  nowMs: number,
): HighlightCard[] {
  const side = (rows: readonly BoardRow[], key: string) => ({
    key,
    rate: rows.find((row) => row.key === key)?.rate ?? boardRate(0, 0, 0),
  })
  const cards: HighlightCard[] = [
    { id: 'camp', sides: [side(board.groups.camp, 'us'), side(board.groups.camp, 'china')] },
  ]
  const divination = board.extras.seats.find((seat) => seat.key === 'divination')
  cards.push({
    id: 'divination',
    sides: [
      { key: 'divination', rate: divination?.extra ?? boardRate(0, 0, 0) },
      { key: 'ai', rate: divination?.ai ?? boardRate(0, 0, 0) },
    ],
  })
  const withData = board.companies.siblings.filter((battle) => battle.members.filter((m) => m.rate.n > 0).length >= 2)
  const pool = withData.length > 0 ? withData : board.companies.siblings
  if (pool.length > 0) {
    const battle = pool[kstDayIndex(nowMs) % pool.length]!
    cards.push({
      id: 'siblings',
      company: battle.company,
      sides: battle.members.slice(0, 4).map((member) => ({ key: member.key, rate: member.rate })),
    })
  }
  cards.push({ id: 'method', sides: [side(board.groups.book, 'reasoning'), side(board.groups.book, 'search')] })
  return cards
}

export function computeBoards(
  rounds: readonly BoardRound[],
  predictions: readonly BoardPrediction[],
  nowMs: number,
): BoardSet {
  const ctx = context(rounds, predictions)
  const groupsBoard = groups(ctx)
  const extrasBoard = extras(ctx)
  const companiesBoard = companies(ctx)
  return {
    banner: banner(ctx),
    highlights: highlights({ groups: groupsBoard, extras: extrasBoard, companies: companiesBoard }, nowMs),
    groups: groupsBoard,
    agreement: agreement(ctx),
    models: models(ctx),
    categories: categories(ctx),
    companies: companiesBoard,
    lenses: lenses(ctx),
    extras: extrasBoard,
    fame: fame(ctx),
  }
}

export function emptyBoards(nowMs: number): BoardSet {
  return computeBoards([], [], nowMs)
}
