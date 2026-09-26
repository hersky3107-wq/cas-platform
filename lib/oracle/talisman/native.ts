/**
 * Per-system native findings. Each layer speaks its own language.
 *
 * Do not import the axis layer. Do not accept consensus. Do not derive any
 * of these from the projected 오행 vector — that is the fake-consensus path
 * the league module already hit.
 */

import { nineStarDirections } from '../engines/calendar'
import type { CompassDirection, TenGodName } from '../engines/calendar'
import type { ClassicalElement, GyeokSeat, KillingName, NativeFindings, NameGyeokHit, TalismanCharts, TenGodGroupName, ZiweiPalaceHit } from './types'
import { FORM_ONLY_LAYERS } from './types'

const TEN_GOD_GROUPS: Record<TenGodGroupName, readonly TenGodName[]> = {
  비겁: ['비견', '겁재'],
  식상: ['식신', '상관'],
  재성: ['편재', '정재'],
  관성: ['편관', '정관'],
  인성: ['편인', '정인'],
}

const GROUP_ORDER: TenGodGroupName[] = ['비겁', '식상', '재성', '관성', '인성']

const CLASSICAL_ELEMENTS: ClassicalElement[] = ['fire', 'earth', 'air', 'water']

const TAROT_SUITS = ['wands', 'cups', 'swords', 'pentacles'] as const

const KILLING_LABELS: Array<{ key: 'ohwang' | 'amgeom' | 'honmei' | 'honmeiOpposite' | 'sepa' | 'wolpa'; name: KillingName }> = [
  { key: 'ohwang', name: '오황살' },
  { key: 'amgeom', name: '암검살' },
  { key: 'honmei', name: '본명살' },
  { key: 'honmeiOpposite', name: '본명적살' },
  { key: 'sepa', name: '세파' },
  { key: 'wolpa', name: '월파' },
]

const GYEOK_SEATS: GyeokSeat[] = ['cheon', 'in', 'ji', 'oe', 'chong']

function emptyGroupCounts(): Record<TenGodGroupName, number> {
  return { 비겁: 0, 식상: 0, 재성: 0, 관성: 0, 인성: 0 }
}

function countTenGodGroups(saju: NonNullable<TalismanCharts['saju']>): Record<TenGodGroupName, number> {
  const counts = emptyGroupCounts()
  const names: TenGodName[] = [
    saju.tenGods.year.stem,
    saju.tenGods.year.branch,
    saju.tenGods.month.stem,
    saju.tenGods.month.branch,
    saju.tenGods.day.branch,
  ]
  if (saju.tenGods.hour) {
    names.push(saju.tenGods.hour.stem, saju.tenGods.hour.branch)
  }
  for (const name of names) {
    for (const group of GROUP_ORDER) {
      if ((TEN_GOD_GROUPS[group] as readonly string[]).includes(name)) {
        counts[group] += 1
        break
      }
    }
  }
  return counts
}

function extractSaju(charts: TalismanCharts): NativeFindings['saju'] {
  if (!charts.saju) return null
  const groupCounts = countTenGodGroups(charts.saju)
  const zeroGroups = GROUP_ORDER.filter((group) => groupCounts[group] === 0)
  return {
    zeroGroups,
    groupCounts,
    gisin: charts.saju.eokbu.gisin,
  }
}

function extractAstro(charts: TalismanCharts): NativeFindings['astro'] {
  if (!charts.astro) return null
  const emptyElements = CLASSICAL_ELEMENTS.filter((el) => charts.astro!.elementBalance[el] === 0)
  const housesMissing = charts.astro.houses == null || charts.astro.limitations.includes('no_houses')
  return { emptyElements, housesMissing }
}

function extractPrism(charts: TalismanCharts): NativeFindings['prism'] {
  if (!charts.prism) return null
  return { warningDomain: charts.prism.warningDomain }
}

function extractZiwei(charts: TalismanCharts): NativeFindings['ziwei'] {
  if (!charts.ziwei) return null
  const palaces = charts.ziwei.palaces
  if (palaces.length === 0) {
    return { palacesUnavailable: true, palaces: [], emptyPalaces: [], maleficPalaces: [], huaJiPalace: null }
  }
  const ji = charts.ziwei.siHua.ji
  const emptyPalaces: ZiweiPalaceHit[] = []
  const maleficPalaces: Array<ZiweiPalaceHit & { stars: string[] }> = []
  let huaJiPalace: (ZiweiPalaceHit & { star: string }) | null = null
  for (const palace of palaces) {
    const hit: ZiweiPalaceHit = { name: palace.name, index: palace.index, branchIndex: palace.index }
    if (!palace.stars.some((star) => star.category === 'major')) emptyPalaces.push(hit)
    const malefics = palace.stars.filter((star) => star.category === 'malefic').map((star) => star.name)
    if (malefics.length > 0) maleficPalaces.push({ ...hit, stars: malefics })
    if (palace.stars.some((star) => star.name === ji)) {
      huaJiPalace = { ...hit, star: ji }
    }
  }
  return {
    palacesUnavailable: false,
    palaces: palaces.map((palace) => ({ name: palace.name, index: palace.index, branchIndex: palace.index })),
    emptyPalaces,
    maleficPalaces,
    huaJiPalace,
  }
}

function extractIching(charts: TalismanCharts): NativeFindings['iching'] {
  if (!charts.iching) return null
  return { hiddenRelatives: [...charts.iching.hiddenRelatives] }
}

function extractTarot(charts: TalismanCharts): NativeFindings['tarot'] {
  if (!charts.tarot) return null
  const present = new Set(charts.tarot.cards.map((card) => card.suit).filter((suit): suit is Exclude<typeof suit, null> => suit != null))
  const missingSuits = TAROT_SUITS.filter((suit) => !present.has(suit))
  const reversed = charts.tarot.cards
    .map((card, index) => ({ index, name: card.name, positionLabel: card.positionLabel, reversed: card.reversed }))
    .filter((card) => card.reversed)
    .map(({ index, name, positionLabel }) => ({ index, name, positionLabel }))
  return { missingSuits, reversed }
}

function extractName(charts: TalismanCharts): NativeFindings['name'] {
  if (!charts.name) return null
  if (!charts.name.supported) {
    return { supported: false, hyung: [], daehyung: [] }
  }
  const hyung: NameGyeokHit[] = []
  const daehyung: NameGyeokHit[] = []
  for (const seat of GYEOK_SEATS) {
    const entry = charts.name.numerology81[seat]
    const hit: NameGyeokHit = { seat, number: entry.number, label: entry.label, keyword: entry.keyword }
    if (entry.label === '대흉') daehyung.push(hit)
    else if (entry.label === '흉') hyung.push(hit)
  }
  return { supported: true, hyung, daehyung }
}

function extractNinestar(charts: TalismanCharts): NativeFindings['ninestar'] {
  if (!charts.ninestar) return null
  const natal = charts.ninestar
  const dirs = nineStarDirections(
    natal.yearBoard,
    natal.monthBoard,
    natal.year.number,
    natal.yearBranchIndex,
    natal.monthBranchIndex,
  )
  const killings: Array<{ name: KillingName; direction: CompassDirection }> = []
  for (const { key, name } of KILLING_LABELS) {
    const direction = dirs.killings[key]
    if (direction) killings.push({ name, direction })
  }
  return {
    killings,
    gilbang: [...dirs.gilbang],
    gilbangYear: [...dirs.gilbangYear],
    gilbangMonth: [...dirs.gilbangMonth],
  }
}

export function extractNativeFindings(charts: TalismanCharts): NativeFindings {
  return {
    saju: extractSaju(charts),
    astro: extractAstro(charts),
    prism: extractPrism(charts),
    ziwei: extractZiwei(charts),
    iching: extractIching(charts),
    tarot: extractTarot(charts),
    name: extractName(charts),
    ninestar: extractNinestar(charts),
    numerology: FORM_ONLY_LAYERS.numerology,
    sukuyou: FORM_ONLY_LAYERS.sukuyou,
    tzolkin: FORM_ONLY_LAYERS.tzolkin,
    runes: FORM_ONLY_LAYERS.runes,
  }
}
