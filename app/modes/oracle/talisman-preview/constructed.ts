/**
 * Constructed charts for the preview — not live sessions.
 * Birth dates are the ones centre.test.ts already locks:
 *   신강 1984-02-10 12:00, 중화 1984-02-15 12:00, 종격 1980-01-08 04:30.
 * scripts/dump-talisman-calibration.ts only dumps one stored session id;
 * it has no 중화 / 종격 rows.
 */
import { eokbu, fourPillars, nineStar, sukuyou, tenGods, tzolkin } from '@/lib/oracle/engines/calendar'
import { natalChart } from '@/lib/oracle/engines/astro'
import { ichingDraw, runeDraw, tarotDraw } from '@/lib/oracle/engines/draw'
import { nameReading } from '@/lib/oracle/engines/name'
import { numerology } from '@/lib/oracle/engines/numerology'
import { prism } from '@/lib/oracle/engines/prism'
import { ziweiChart } from '@/lib/oracle/engines/ziwei'
import { computeTalisman, FAKE_TALISMAN_SERIAL } from '@/lib/oracle/talisman'
import type { TalismanPurpose } from '@/lib/oracle/talisman'
import type { SystemId } from '@/lib/oracle/axes/types'
import type { FiveElement } from '@/lib/oracle/engines/calendar'
import { ORACLE_DEFAULT_COORDS } from '@/lib/oracle/runner/conventions'
import type { TalismanCharts } from '@/lib/oracle/talisman'
import { specFromComputation, talismanStats } from './from-computation'
import type { TalismanSpec } from './variants'

const ACCESS = {
  status: 'done' as const,
  promptVersion: 'layer1-live',
  hasConsensus: true,
}

const AT = '2026-09-26'
const TZ = 'Asia/Seoul'

export type ConstructedPreview = {
  id:
    | 'sinkang'
    | 'junghwa'
    | 'jonggyeok'
    | 'consensus-null'
    | 'no-prism'
    | 'lean-weak'
    | 'lean-strong'
    | 'follow'
    | 'secondary'
    | 'bindrune-3'
    | 'bindrune-5'
    | 'bindrune-reversed'
  label: string
  spec: TalismanSpec
  stats: ReturnType<typeof talismanStats>
}

function chartsFor(
  birth: { date: string; time: string },
  seed: string,
  withPrism: boolean,
  runes?: { seed: string; count: number } | null,
): TalismanCharts {
  const clock = { ...birth, timezone: TZ }
  const pillars = fourPillars(clock)
  return {
    saju: { eokbu: eokbu(pillars), tenGods: tenGods(pillars.day.stem, pillars), pillars },
    ziwei: ziweiChart({
      birthDate: birth.date,
      birthTime: birth.time,
      tz: TZ,
      sex: 'male',
      atDate: AT,
    }),
    astro: natalChart({
      date: birth.date,
      time: birth.time,
      tz: TZ,
      lat: ORACLE_DEFAULT_COORDS.lat,
      lng: ORACLE_DEFAULT_COORDS.lng,
      timeKnown: true,
    }),
    iching: ichingDraw({ seed: `talisman-iching-${seed}` }),
    tarot: tarotDraw({ seed: `talisman-tarot-${seed}`, spread: 5, pickedPositions: [1, 2, 3, 4, 5] }),
    prism: withPrism
      ? prism({
          birthDate: birth.date,
          mbti: 'ENTJ',
          colors: { impulse: 'crimson', need: 'gold', identity: 'indigo' },
          microCheck: [4, 2, 3, 3] as const,
          atDate: AT,
        })
      : null,
    name: nameReading({ surname: '김', givenName: '지수', locale: 'ko' }),
    ninestar: nineStar({ date: birth.date, time: '12:00', timezone: TZ }),
    runes:
      runes === null
        ? null
        : runeDraw({
            seed: runes?.seed ?? `talisman-runes-${seed}`,
            count: runes?.count ?? 3,
            pickedPositions: Array.from({ length: runes?.count ?? 3 }, (_, i) => i + 1),
          }),
    numerology: numerology({ birthDate: birth.date, latinName: 'Kim Jisu', atDate: AT }),
    sukuyou: sukuyou({ date: birth.date, time: '12:00', timezone: TZ }),
    tzolkin: tzolkin({ date: birth.date }),
  }
}

function deficiency(partial: Partial<Record<FiveElement, number>>) {
  return {
    elements: {
      total: { wood: 20, fire: 20, earth: 20, metal: 20, water: 20 },
      deficiency: { wood: 0, fire: 0, earth: 0, metal: 0, water: 0, ...partial },
      excess: { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 },
      participating: ['saju', 'astro', 'prism'] as SystemId[],
      unreadable: [],
    },
  }
}

function build(input: {
  id: ConstructedPreview['id']
  label: string
  birth: { date: string; time: string }
  seed: string
  withPrism: boolean
  deficiency: Partial<Record<FiveElement, number>>
  title: string
  note: string
  noSaju?: boolean
  noRunes?: boolean
  runeCount?: number
  runeSeed?: string
  purpose?: TalismanPurpose
}): ConstructedPreview {
  const charts = chartsFor(
    input.birth,
    input.seed,
    input.withPrism,
    input.noRunes ? null : input.runeCount || input.runeSeed ? { seed: input.runeSeed ?? `talisman-runes-${input.seed}`, count: input.runeCount ?? 3 } : undefined,
  )
  if (input.noSaju) charts.saju = null
  const computation = computeTalisman({
    access: ACCESS,
    charts,
    consensus: deficiency(input.deficiency),
    purpose: input.purpose ?? null,
    prismColors: input.withPrism
      ? { impulse: 'crimson', need: 'gold', identity: 'indigo' }
      : null,
  })
  if (!computation) throw new Error(`constructed ${input.id}: computeTalisman refused`)
  return {
    id: input.id,
    label: input.label,
    spec: specFromComputation(computation, charts, {
      sessionId: input.id,
      dateLabel: '',
      serial: FAKE_TALISMAN_SERIAL,
      title: input.title,
      note: input.note,
    }),
    stats: talismanStats(computation, charts),
  }
}

export function constructedPreviews(): ConstructedPreview[] {
  return [
    build({
      id: 'sinkang',
      label: 'constructed 신강 · drain',
      birth: { date: '1984-02-10', time: '12:00' },
      seed: 'sinkang',
      withPrism: true,
      deficiency: { water: 20 },
      title: 'constructed 신강',
      note: 'eokbu · drain · hollow drain core',
    }),
    build({
      id: 'junghwa',
      label: 'constructed 중화 · 억부 경향',
      birth: { date: '1984-02-15', time: '12:00' },
      seed: 'junghwa',
      withPrism: true,
      deficiency: { metal: 11, wood: 3 },
      title: 'constructed 중화',
      note: '억부 경향 · soft fill · 득령 0 → 신약 lean, 용신 화',
    }),
    build({
      id: 'jonggyeok',
      label: 'constructed 종격 · follow',
      birth: { date: '1980-01-08', time: '04:30' },
      seed: 'jonggyeok',
      withPrism: true,
      deficiency: { water: 9 },
      title: 'constructed 종격',
      note: '종격 follow · fill earth with spiral. 용신 null, dominant 토',
    }),
    build({
      id: 'lean-weak',
      label: 'lean-weak · 억부 경향 fill',
      birth: { date: '1984-02-15', time: '12:00' },
      seed: 'lean-weak',
      withPrism: true,
      deficiency: { metal: 11 },
      title: 'lean-weak',
      note: '억부 경향 · soft fill fire (중화, 득령 없음)',
    }),
    build({
      id: 'lean-strong',
      label: 'lean-strong · 억부 경향 drain',
      birth: { date: '1960-01-13', time: '12:00' },
      seed: 'lean-strong',
      withPrism: true,
      deficiency: { wood: 11 },
      title: 'lean-strong',
      note: '억부 경향 · soft drain water (중화, 득령 있음)',
    }),
    build({
      id: 'follow',
      label: 'follow · 종격',
      birth: { date: '1980-01-08', time: '04:30' },
      seed: 'follow',
      withPrism: true,
      deficiency: { water: 9 },
      title: 'follow',
      note: '종격 follow · earth core with outward spiral',
    }),
    build({
      id: 'consensus-null',
      label: 'fallback · no 사주',
      birth: { date: '1984-02-15', time: '12:00' },
      seed: 'consensus-null',
      withPrism: true,
      deficiency: {},
      title: 'fallback no pillars',
      note: 'fallback · no 사주 pillars. Balanced core when deficiency has no leader.',
      noSaju: true,
    }),
    build({
      id: 'no-prism',
      label: 'no PRISM',
      birth: { date: '1984-02-10', time: '12:00' },
      seed: 'no-prism',
      withPrism: false,
      deficiency: { water: 20 },
      title: 'no PRISM',
      note: 'eokbu · drain · prism coreMatrix absent, rim is an empty seat',
    }),
    build({
      id: 'secondary',
      label: 'secondary · 금 결',
      birth: { date: '1988-03-15', time: '04:30' },
      seed: 'secondary',
      withPrism: true,
      deficiency: { water: 20 },
      title: 'secondary',
      note: 'natal 금·수 결. secondary 금 (木火土金水). consensus water ignored.',
    }),
    build({
      id: 'bindrune-3',
      label: 'bindrune · 3',
      birth: { date: '1984-02-10', time: '12:00' },
      seed: 'bindrune-3',
      withPrism: true,
      deficiency: { water: 20 },
      title: 'bindrune-3',
      note: '3-stone bindrune from the stored draw. Same seed, same path.',
      runeCount: 3,
      runeSeed: 'talisman-runes-bindrune-3',
    }),
    build({
      id: 'bindrune-5',
      label: 'bindrune · 5',
      birth: { date: '1984-02-10', time: '12:00' },
      seed: 'bindrune-5',
      withPrism: true,
      deficiency: { water: 20 },
      title: 'bindrune-5',
      note: '5-stone bindrune. Shared stave, merged arms.',
      runeCount: 5,
      runeSeed: 'talisman-runes-bindrune-5',
    }),
    build({
      id: 'bindrune-reversed',
      label: 'bindrune · merkstave',
      birth: { date: '1984-02-10', time: '12:00' },
      seed: 'bindrune-reversed',
      withPrism: true,
      deficiency: { water: 20 },
      title: 'bindrune-reversed',
      note: 'Kenaz reversed is mirrored on the stave. 財 stays readable above.',
      runeCount: 3,
      runeSeed: 'br-0',
      purpose: 'wealth',
    }),
  ]
}

export function constructedSinkang(): { spec: TalismanSpec; stats: ReturnType<typeof talismanStats> } {
  const row = constructedPreviews().find((item) => item.id === 'sinkang')
  if (!row) throw new Error('constructed 신강 missing')
  return { spec: row.spec, stats: row.stats }
}
