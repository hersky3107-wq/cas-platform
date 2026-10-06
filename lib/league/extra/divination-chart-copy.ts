/**
 * One small line on the divination tile: the 사주 pillars or the 구성기학
 * centre star and direction. Display only, all 8 league locales.
 */
import type { LeagueLocale } from '../i18n/locales'
import { preferredLabel, type DivinationChart, type WikiLabelLang } from './divination-chart-types'
import {
  DIRECTION_KO,
  NINE_STAR_HANGUL,
  NINE_STAR_HANJA,
  NINE_STAR_HANJA_TW,
  ganzhiHangul,
  type KigakuDirection,
} from './divination-ganzhi'

type Dirs = Record<KigakuDirection, string>

const DIRECTIONS: Record<Exclude<LeagueLocale, 'ko'>, Dirs> = {
  en: { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest', center: 'center' },
  ja: { N: '北', NE: '北東', E: '東', SE: '南東', S: '南', SW: '南西', W: '西', NW: '北西', center: '中央' },
  'zh-TW': { N: '北方', NE: '東北方', E: '東方', SE: '東南方', S: '南方', SW: '西南方', W: '西方', NW: '西北方', center: '中央' },
  fr: { N: 'nord', NE: 'nord-est', E: 'est', SE: 'sud-est', S: 'sud', SW: 'sud-ouest', W: 'ouest', NW: 'nord-ouest', center: 'centre' },
  ar: {
    N: 'الشمال',
    NE: 'الشمال الشرقي',
    E: 'الشرق',
    SE: 'الجنوب الشرقي',
    S: 'الجنوب',
    SW: 'الجنوب الغربي',
    W: 'الغرب',
    NW: 'الشمال الغربي',
    center: 'المركز',
  },
  es: { N: 'norte', NE: 'noreste', E: 'este', SE: 'sureste', S: 'sur', SW: 'suroeste', W: 'oeste', NW: 'noroeste', center: 'centro' },
  pt: { N: 'norte', NE: 'nordeste', E: 'leste', SE: 'sudeste', S: 'sul', SW: 'sudoeste', W: 'oeste', NW: 'noroeste', center: 'centro' },
}

const LABEL_ORDER: Record<LeagueLocale, readonly WikiLabelLang[]> = {
  ko: ['ko', 'en'],
  en: ['en', 'ko'],
  ja: ['ja', 'en'],
  'zh-TW': ['zh-tw', 'zh', 'en'],
  fr: ['fr', 'en'],
  ar: ['ar', 'en'],
  es: ['es', 'en'],
  pt: ['pt', 'en'],
}

function sajuLine(locale: LeagueLocale, year: string, month: string, name: string | null): string {
  switch (locale) {
    case 'ko':
      return `사주: ${name ? `${name} ` : ''}${ganzhiHangul(year) ?? year}년 ${ganzhiHangul(month) ?? month}월`
    case 'ja':
      return `四柱: ${name ? `${name} ` : ''}${year}年 ${month}月`
    case 'zh-TW':
      return `四柱：${name ? `${name} ` : ''}${year}年 ${month}月`
    case 'fr':
      return `Saju : ${name ? `${name} · ` : ''}année ${year} · mois ${month}`
    case 'ar':
      return `ساجو: ${name ? `${name} · ` : ''}سنة ${year} · شهر ${month}`
    case 'es':
      return `Saju: ${name ? `${name} · ` : ''}año ${year} · mes ${month}`
    case 'pt':
      return `Saju: ${name ? `${name} · ` : ''}ano ${year} · mês ${month}`
    default:
      return `Saju: ${name ? `${name} · ` : ''}${year} year · ${month} month`
  }
}

function kigakuLine(locale: LeagueLocale, year: number, star: number, direction: KigakuDirection): string {
  switch (locale) {
    case 'ko':
      return `구성기학: ${year}년 중궁 ${NINE_STAR_HANGUL[star - 1]} · ${DIRECTION_KO[direction]}`
    case 'ja':
      return `九星気学: ${year}年 中宮 ${NINE_STAR_HANJA[star - 1]} · ${DIRECTIONS.ja[direction]}`
    case 'zh-TW':
      return `九星氣學：${year}年 中宮 ${NINE_STAR_HANJA_TW[star - 1]} · ${DIRECTIONS['zh-TW'][direction]}`
    case 'fr':
      return `Neuf étoiles : ${year}, centre ${NINE_STAR_HANJA[star - 1]} · ${DIRECTIONS.fr[direction]}`
    case 'ar':
      return `النجوم التسع: ${year}، المركز ${NINE_STAR_HANJA[star - 1]} · ${DIRECTIONS.ar[direction]}`
    case 'es':
      return `Nueve estrellas: ${year}, centro ${NINE_STAR_HANJA[star - 1]} · ${DIRECTIONS.es[direction]}`
    case 'pt':
      return `Nove estrelas: ${year}, centro ${NINE_STAR_HANJA[star - 1]} · ${DIRECTIONS.pt[direction]}`
    default:
      return `Nine Star Ki: ${year} center ${NINE_STAR_HANJA[star - 1]} · ${DIRECTIONS.en[direction]}`
  }
}

/** Company subjects read through the CEO show the CEO's name first. */
export function divinationChartLine(locale: LeagueLocale, chart: DivinationChart | null | undefined): string | null {
  if (!chart) return null
  if (chart.kind === 'kigaku') return kigakuLine(locale, chart.qiYear, chart.year.center, chart.direction)
  const ceo =
    chart.subject.source === 'ceo_birth' && chart.subject.ceo
      ? preferredLabel(chart.subject.ceo.labels, LABEL_ORDER[locale])
      : null
  return sajuLine(locale, chart.pillars.year, chart.pillars.month, ceo)
}
