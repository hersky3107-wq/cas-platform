/**
 * Constructed 신강 chart for the preview — not a live session.
 * 1984-02-10 12:00 has 억부 용신 with strength strong, so the core drains.
 */
import { eokbu, fourPillars, nineStar, sukuyou, tenGods, tzolkin } from '@/lib/oracle/engines/calendar'
import { natalChart } from '@/lib/oracle/engines/astro'
import { ichingDraw, runeDraw, tarotDraw } from '@/lib/oracle/engines/draw'
import { nameReading } from '@/lib/oracle/engines/name'
import { numerology } from '@/lib/oracle/engines/numerology'
import { prism } from '@/lib/oracle/engines/prism'
import { ziweiChart } from '@/lib/oracle/engines/ziwei'
import { computeTalisman } from '@/lib/oracle/talisman'
import { ORACLE_DEFAULT_COORDS } from '@/lib/oracle/runner/conventions'
import type { TalismanCharts } from '@/lib/oracle/talisman'
import { specFromComputation, talismanStats } from './from-computation'
import type { TalismanSpec } from './variants'

const ACCESS = {
  status: 'done' as const,
  promptVersion: 'layer1-live',
  hasConsensus: true,
}

const BIRTH = { date: '1984-02-10', time: '12:00', timezone: 'Asia/Seoul' }
const AT = '2026-09-26'

function sinkangCharts(): TalismanCharts {
  const pillars = fourPillars(BIRTH)
  return {
    saju: { eokbu: eokbu(pillars), tenGods: tenGods(pillars.day.stem, pillars), pillars },
    ziwei: ziweiChart({
      birthDate: BIRTH.date,
      birthTime: BIRTH.time,
      tz: BIRTH.timezone,
      sex: 'male',
      atDate: AT,
    }),
    astro: natalChart({
      date: BIRTH.date,
      time: BIRTH.time,
      tz: BIRTH.timezone,
      lat: ORACLE_DEFAULT_COORDS.lat,
      lng: ORACLE_DEFAULT_COORDS.lng,
      timeKnown: true,
    }),
    iching: ichingDraw({ seed: 'talisman-iching-sinkang' }),
    tarot: tarotDraw({ seed: 'talisman-tarot-sinkang', spread: 5, pickedPositions: [1, 2, 3, 4, 5] }),
    prism: prism({
      birthDate: BIRTH.date,
      mbti: 'ENTJ',
      colors: { impulse: 'crimson', need: 'gold', identity: 'indigo' },
      microCheck: [4, 2, 3, 3] as const,
      atDate: AT,
    }),
    name: nameReading({ surname: '김', givenName: '지수', locale: 'ko' }),
    ninestar: nineStar({ date: BIRTH.date, time: '12:00', timezone: BIRTH.timezone }),
    runes: runeDraw({ seed: 'talisman-runes-sinkang', count: 3, pickedPositions: [1, 2, 3] }),
    numerology: numerology({ birthDate: BIRTH.date, latinName: 'Kim Jisu', atDate: AT }),
    sukuyou: sukuyou({ date: BIRTH.date, time: '12:00', timezone: BIRTH.timezone }),
    tzolkin: tzolkin({ date: BIRTH.date }),
  }
}

export function constructedSinkang(): { spec: TalismanSpec; stats: ReturnType<typeof talismanStats> } {
  const charts = sinkangCharts()
  const computation = computeTalisman({
    access: ACCESS,
    charts,
    consensus: {
      elements: {
        total: { wood: 20, fire: 20, earth: 20, metal: 20, water: 20 },
        deficiency: { wood: 0, fire: 0, earth: 0, metal: 0, water: 20 },
        excess: { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 },
        participating: ['saju', 'astro', 'prism'],
        unreadable: [],
      },
    },
  })
  if (!computation) throw new Error('constructed 신강: computeTalisman refused')
  return {
    spec: specFromComputation(computation, charts, {
      sessionId: 'sinkang-1984',
      dateLabel: '1984.02.10',
      title: 'constructed 신강',
      note: `${computation.centre.source} · ${computation.centre.mode} · hollow drain core`,
    }),
    stats: talismanStats(computation, charts),
  }
}
