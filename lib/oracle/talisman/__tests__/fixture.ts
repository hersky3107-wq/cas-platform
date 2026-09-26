import { eokbu, fourPillars, nineStar, tenGods } from '../../engines/calendar'
import { natalChart } from '../../engines/astro'
import { ichingDraw, runeDraw, tarotDraw } from '../../engines/draw'
import { nameReading } from '../../engines/name'
import { prism } from '../../engines/prism'
import { ziweiChart } from '../../engines/ziwei'
import type { AxisConsensus } from '../../axes/types'
import type { FiveElement } from '../../engines/calendar'
import type { TalismanAccessInput, TalismanCharts } from '../types'
import { ORACLE_DEFAULT_COORDS } from '../../runner/conventions'

export const LIVE_ACCESS: TalismanAccessInput = {
  status: 'done',
  promptVersion: 'layer1-live',
  hasConsensus: true,
}

export const EMPTY_CHARTS: TalismanCharts = {
  saju: null,
  ziwei: null,
  astro: null,
  iching: null,
  tarot: null,
  prism: null,
  name: null,
  ninestar: null,
  runes: null,
  numerology: null,
  sukuyou: null,
  tzolkin: null,
}

export function fakeConsensus(deficiency: Partial<Record<FiveElement, number>>): Pick<AxisConsensus, 'elements'> {
  return {
    elements: {
      total: { wood: 20, fire: 20, earth: 20, metal: 20, water: 20 },
      deficiency: { wood: 0, fire: 0, earth: 0, metal: 0, water: 0, ...deficiency },
      excess: { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 },
      participating: ['saju', 'astro', 'prism'],
      unreadable: [],
    },
  }
}

/** 1988-03-15 04:30 신약 fixture used across calendar tests. */
export function charts1988(overrides: Partial<TalismanCharts> = {}): TalismanCharts {
  const pillars = fourPillars({ date: '1988-03-15', time: '04:30', timezone: 'Asia/Seoul' })
  return {
    saju: { eokbu: eokbu(pillars), tenGods: tenGods(pillars.day.stem, pillars), pillars },
    ziwei: ziweiChart({
      birthDate: '1988-03-15',
      birthTime: '04:30',
      tz: 'Asia/Seoul',
      sex: 'male',
    }),
    astro: natalChart({
      date: '1988-03-15',
      time: '04:30',
      tz: 'Asia/Seoul',
      lat: ORACLE_DEFAULT_COORDS.lat,
      lng: ORACLE_DEFAULT_COORDS.lng,
      timeKnown: true,
    }),
    iching: ichingDraw({ seed: 'talisman-iching-1988' }),
    tarot: tarotDraw({ seed: 'talisman-tarot-1988', spread: 5, pickedPositions: [1, 2, 3, 4, 5] }),
    prism: prism({
      birthDate: '1988-03-15',
      mbti: 'INFJ',
      colors: { impulse: 'crimson', need: 'sage', identity: 'indigo' },
      microCheck: [3, 3, 3, 3],
      atDate: '2026-08-15',
    }),
    name: nameReading({ surname: '김', givenName: '지수', locale: 'ko' }),
    ninestar: nineStar({ date: '1988-03-15', time: '12:00', timezone: 'Asia/Seoul' }),
    runes: runeDraw({ seed: 'talisman-runes-1988', count: 3, pickedPositions: [1, 2, 3] }),
    numerology: null,
    sukuyou: null,
    tzolkin: null,
    ...overrides,
  }
}
