/**
 * TWO separate category tables. Do not fold 육친 and 택일 오행 into one map —
 * 육효 용신 is a 육친 of the palace, 택일 용신 is an 오행 of the topic.
 *
 * Chip ids are the 12 public league chips, copied (not imported) so this
 * folder never depends on lib/league.
 */
import type { FiveElement, YinYang } from '../engines/calendar/types'
import type { SixRelative } from '../engines/draw/tables'
import type { LeagueOracleCategoryId, LeagueTaeilYongshen } from './types'
import { LEAGUE_ORACLE_CATEGORY_IDS } from './types'

const STEM_HANJA: Record<FiveElement, Record<YinYang, LeagueTaeilYongshen['stemHanja']>> = {
  wood: { yang: '甲', yin: '乙' },
  fire: { yang: '丙', yin: '丁' },
  earth: { yang: '戊', yin: '己' },
  metal: { yang: '庚', yin: '辛' },
  water: { yang: '壬', yin: '癸' },
}

/**
 * Classical 육친 topic mapping (卜筮 / 黄金策 topic lists), not an invention:
 *   妻财 money/profit
 *   官鬼 authority / competition / lawsuit
 *   父母 documents / property
 *   子孙 outcome / remedy (also pleasure)
 *   兄弟 rivals / partners — unused by v1 chips. sports/politics stay 官鬼
 *   (competition / authority / lawsuit). Some schools read a contest through
 *   兄弟 (the opposing camp as 劫财); that would make 세/응 the two sides
 *   rather than the event as 관살. v1 keeps 官鬼 for sports — a match is
 *   승부 (official contest), not a sibling/partner quarrel. Do not switch
 *   without an explicit product decision.
 */
export const CATEGORY_TO_LIUQIN: Record<LeagueOracleCategoryId, SixRelative> = {
  stocks: '妻财',
  crypto: '妻财',
  fx: '妻财',
  gold_metals: '妻财',
  index_etf: '妻财',
  commodities_energy: '妻财',
  memecoin: '妻财',
  sports: '官鬼',
  politics_election: '官鬼',
  real_estate: '父母',
  macro_econ: '父母',
  entertainment: '子孙',
}

/**
 * PRODUCT 택일 용신 — category → one of the 10 천간 buckets (5 오행 × 음양).
 * This is not a 명리 일간 and is not derived from a person. yinYang names the
 * bucket for the later adapter; the v1 ballot reads 오행 only.
 *
 * 12 chips into the 10 천간 buckets, so two pairs share a 천간:
 *   stocks + gold_metals → 庚 (listed equity and bullion, both 금 재물)
 *   index_etf + macro_econ → 戊 (broad market / economy-as-ground)
 */
export const CATEGORY_TO_TAEIL_YONGSHEN: Record<
  LeagueOracleCategoryId,
  { element: FiveElement; yinYang: YinYang }
> = {
  sports: { element: 'wood', yinYang: 'yang' },
  entertainment: { element: 'wood', yinYang: 'yin' },
  commodities_energy: { element: 'fire', yinYang: 'yang' },
  politics_election: { element: 'fire', yinYang: 'yin' },
  index_etf: { element: 'earth', yinYang: 'yang' },
  macro_econ: { element: 'earth', yinYang: 'yang' },
  real_estate: { element: 'earth', yinYang: 'yin' },
  stocks: { element: 'metal', yinYang: 'yang' },
  gold_metals: { element: 'metal', yinYang: 'yang' },
  fx: { element: 'metal', yinYang: 'yin' },
  crypto: { element: 'water', yinYang: 'yang' },
  memecoin: { element: 'water', yinYang: 'yin' },
}

export function liuqinForCategory(categoryId: LeagueOracleCategoryId): SixRelative {
  return CATEGORY_TO_LIUQIN[categoryId]
}

export function taeilYongshenForCategory(categoryId: LeagueOracleCategoryId): LeagueTaeilYongshen {
  const bucket = CATEGORY_TO_TAEIL_YONGSHEN[categoryId]
  return {
    element: bucket.element,
    yinYang: bucket.yinYang,
    stemHanja: STEM_HANJA[bucket.element][bucket.yinYang],
  }
}

/** Exhaustiveness guard — every chip has both rows. */
export function assertCategoryTablesComplete(): void {
  for (const id of LEAGUE_ORACLE_CATEGORY_IDS) {
    if (!CATEGORY_TO_LIUQIN[id]) throw new Error(`league-divination: missing 육친 for ${id}`)
    if (!CATEGORY_TO_TAEIL_YONGSHEN[id]) throw new Error(`league-divination: missing 택일 용신 for ${id}`)
  }
}
