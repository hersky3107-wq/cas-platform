/**
 * Native single-system charts for layer-1 prompts.
 *
 * Combined / integrated mode keeps the axis projection. Single-system mode
 * must send THIS engine's own result in that system's vocabulary — never the
 * consensus-layer 오행 / 유지·방출 mapping.
 *
 * Privacy: never emit JSON key `name`, birth date/time/city, lat/lng, tz, sex,
 * draw seeds, or natal instants. Derived glyphs (카드, 괘, 팔자) are allowed.
 */
import type { SystemId } from '../axes/types'
import {
  ASPECT_KO,
  BEAST_KO,
  BODY_KO,
  DOMAIN_KO,
  ELEMENT_KO,
  GYEOK_KO,
  PALACE_KO,
  PRISM_CYCLE_KO,
  PRISM_RELATION_KO,
  RELATIVE_KO,
  RUNE_KO,
  runePositionKo,
  SIGN_KO,
  STAR_CATEGORY_KO,
  tarotCardNameKo,
  tarotPositionKo,
  TRIGRAM_KO,
  WEEKDAY_KO,
  oneDecimal,
} from '../display-copy'
import { PRISM_COLOR_KO } from '../prism-swatches'
import type { JsonObject } from './types'

const TAROT_SUIT_KO: Record<string, string> = {
  wands: '지팡이',
  cups: '컵',
  swords: '검',
  pentacles: '펜타클',
}

const LINE_VALUE_KO: Record<number, string> = {
  6: '노음',
  7: '소양',
  8: '소음',
  9: '노양',
}

const SIHUA_KO = {
  lu: '화록',
  quan: '화권',
  ke: '화과',
  ji: '화기',
} as const

const ORDINAL_KO = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째', '여덟째', '아홉째'] as const

const SIGN_ORDER = [
  'Aries',
  'Taurus',
  'Gemini',
  'Cancer',
  'Leo',
  'Virgo',
  'Libra',
  'Scorpio',
  'Sagittarius',
  'Capricorn',
  'Aquarius',
  'Pisces',
] as const

export type NativeChartContext = {
  locale: string
  nominalAge: number | null
}

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function elementKo(value: unknown): string {
  const key = str(value)
  return ELEMENT_KO[key] ?? key
}

function hangulHanja(hanja: unknown, hangul: unknown): string {
  const h = str(hanja)
  const g = str(hangul)
  if (h && g) return `${h} (${g})`
  return h || g
}

function pillarChart(pillar: unknown): JsonObject | null {
  const row = rec(pillar)
  if (!row) return null
  const stem = rec(row.stem)
  const branch = rec(row.branch)
  return {
    간지: str(row.ganzhi),
    천간: stem ? hangulHanja(stem.hanja, stem.hangul) : '',
    지지: branch ? hangulHanja(branch.hanja, branch.hangul) : '',
  }
}

function tenGodCell(cell: unknown): JsonObject | null {
  const row = rec(cell)
  if (!row) return null
  return { 천간: str(row.stem), 지지: str(row.branch) }
}

function tarotCard(card: unknown): JsonObject {
  const row = rec(card) ?? {}
  const id = num(row.id) ?? -1
  const english = str(row.name)
  const reversed = bool(row.reversed) === true
  const suit = str(row.suit)
  const arcana = str(row.arcana)
  return {
    위치: tarotPositionKo(str(row.positionLabel)),
    카드: tarotCardNameKo(english, id),
    방향: reversed ? '역방향' : '정방향',
    구분: arcana === 'major' ? '메이저' : arcana === 'minor' ? '마이너' : arcana,
    수트: suit ? (TAROT_SUIT_KO[suit] ?? suit) : '없음',
  }
}

function runeRow(rune: unknown, index: number): JsonObject {
  const row = rec(rune) ?? {}
  const english = str(row.name)
  const reversed = bool(row.reversed) === true
  const positionLabel = str(row.positionLabel)
  return {
    위치: positionLabel ? runePositionKo(positionLabel) : (ORDINAL_KO[index] ?? `${index + 1}번`),
    룬: RUNE_KO[english] ?? english,
    글자: str(row.glyph),
    방향: reversed ? '역방향' : '정방향',
  }
}

function hexagramChart(hex: unknown): JsonObject | null {
  const row = rec(hex)
  if (!row) return null
  return {
    번호: num(row.kingWen),
    괘: hangulHanja(row.hanja, row.hangul),
  }
}

function ichingLine(line: unknown): JsonObject {
  const row = rec(line) ?? {}
  const value = num(row.value)
  return {
    위치: num(row.position),
    음양: bool(row.yang) ? '양' : '음',
    효: value != null ? (LINE_VALUE_KO[value] ?? String(value)) : '',
    변효: bool(row.changing) === true,
    육친: RELATIVE_KO[str(row.relative)] ?? str(row.relative),
    육신: BEAST_KO[str(row.beast)] ?? str(row.beast),
    오행: elementKo(row.element),
  }
}

function longitudeLabel(longitude: number): string {
  const wrapped = ((longitude % 360) + 360) % 360
  const signIndex = Math.floor(wrapped / 30)
  const deg = wrapped - signIndex * 30
  const sign = SIGN_ORDER[signIndex] ?? 'Aries'
  return `${SIGN_KO[sign] ?? sign} ${oneDecimal(deg)}도`
}

function bodyChart(bodyKey: string, position: unknown): JsonObject | null {
  const row = rec(position)
  if (!row) return null
  const house = num(row.house)
  return {
    행성: BODY_KO[bodyKey] ?? bodyKey,
    별자리: SIGN_KO[str(row.sign)] ?? str(row.sign),
    도수: num(row.degreeInSign) != null ? `${oneDecimal(num(row.degreeInSign)!)}도` : '',
    하우스: house,
    역행: bool(row.retrograde) === true,
  }
}

function aspectChart(aspect: unknown): JsonObject {
  const row = rec(aspect) ?? {}
  return {
    행성1: BODY_KO[str(row.a)] ?? str(row.a),
    행성2: BODY_KO[str(row.b)] ?? str(row.b),
    각: ASPECT_KO[str(row.type)] ?? str(row.type),
    오브: num(row.orb) != null ? `${oneDecimal(num(row.orb)!)}도` : '',
    적용: bool(row.applying) === true ? '적용중' : '분리중',
  }
}

function cycleChart(cycle: unknown): JsonObject | null {
  const row = rec(cycle)
  if (!row) return null
  const english = str(row.name)
  const mapped = PRISM_CYCLE_KO[english]
  return {
    주기: mapped?.name ?? english,
    이로운일: mapped?.lucky ?? '',
    삼갈일: mapped?.taboo ?? '',
  }
}

function sihuaChart(sihua: unknown): JsonObject | null {
  const row = rec(sihua)
  if (!row) return null
  return {
    천간: str(row.stem),
    [SIHUA_KO.lu]: str(row.lu),
    [SIHUA_KO.quan]: str(row.quan),
    [SIHUA_KO.ke]: str(row.ke),
    [SIHUA_KO.ji]: str(row.ji),
  }
}

function palaceStars(stars: unknown): JsonObject[] {
  return arr(stars).map((star) => {
    const row = rec(star) ?? {}
    const out: JsonObject = {
      별: str(row.name),
      구분: STAR_CATEGORY_KO[str(row.category)] ?? str(row.category),
    }
    if (typeof row.brightness === 'string' && row.brightness.length > 0) {
      out.밝기 = row.brightness
    }
    return out
  })
}

function sajuChart(result: Record<string, unknown>, ctx: NativeChartContext): JsonObject {
  const pillars = rec(result.pillars)
  const five = rec(result.fiveElements)
  const gods = rec(result.tenGods)
  const luck = rec(result.greatLuck)
  const hour = pillars ? pillarChart(pillars.hour) : null
  const chart: JsonObject = {
    팔자: {
      년주: pillars ? pillarChart(pillars.year) : null,
      월주: pillars ? pillarChart(pillars.month) : null,
      일주: pillars ? pillarChart(pillars.day) : null,
      시주: hour,
    },
    십신: gods
      ? {
          년주: tenGodCell(gods.year),
          월주: tenGodCell(gods.month),
          일주: tenGodCell(gods.day),
          시주: tenGodCell(gods.hour),
        }
      : null,
    오행: five
      ? { 목: five.wood, 화: five.fire, 토: five.earth, 금: five.metal, 수: five.water }
      : null,
  }
  const periods = luck ? arr(luck.periods) : []
  if (periods.length > 0) {
    chart.대운 = periods.map((period) => {
      const row = rec(period) ?? {}
      const start = num(row.startAge)
      const end = num(row.endAge)
      const current =
        ctx.nominalAge != null && start != null && end != null
          ? ctx.nominalAge >= start && ctx.nominalAge <= end
          : false
      return {
        간지: str(row.ganzhi),
        나이대: start != null && end != null ? `${start}–${end}세` : '',
        현재: current,
      }
    })
  }
  return chart
}

function astroChart(result: Record<string, unknown>): JsonObject {
  const natal = rec(result.natal)
  const transits = rec(result.transits)
  const bodies = natal ? rec(natal.bodies) : null
  const angles = natal ? rec(natal.angles) : null
  const elementBalance = natal ? rec(natal.elementBalance) : null
  const 행성 = bodies
    ? Object.entries(bodies)
        .map(([key, value]) => bodyChart(key, value))
        .filter((row): row is JsonObject => row !== null)
    : []
  const 각도 = angles
    ? {
        상승점: typeof angles.ascendant === 'number' ? longitudeLabel(angles.ascendant) : null,
        중천: typeof angles.midheaven === 'number' ? longitudeLabel(angles.midheaven) : null,
        하강점: typeof angles.descendant === 'number' ? longitudeLabel(angles.descendant) : null,
        천저: typeof angles.imumCoeli === 'number' ? longitudeLabel(angles.imumCoeli) : null,
      }
    : null
  const transitBodies = transits ? rec(transits.bodies) : null
  return {
    행성,
    각도,
    애스펙트: natal ? arr(natal.aspects).map(aspectChart) : [],
    사원소: elementBalance
      ? {
          불: elementBalance.fire,
          흙: elementBalance.earth,
          바람: elementBalance.air,
          물: elementBalance.water,
        }
      : null,
    오늘: transitBodies
      ? Object.entries(transitBodies)
          .map(([key, value]) => {
            const row = rec(value)
            if (!row) return null
            return {
              행성: BODY_KO[key] ?? key,
              별자리: SIGN_KO[str(row.sign)] ?? str(row.sign),
            }
          })
          .filter((row) => row !== null)
      : [],
  }
}

function prismChart(result: Record<string, unknown>): JsonObject {
  const prism = rec(result.prism) ?? result
  const colors = rec(result.colors)
  const impulse = colors ? str(colors.impulse) : ''
  const need = colors ? str(colors.need) : ''
  const identity = colors ? str(colors.identity) : ''
  const anchor = rec(prism.birthAnchor)
  const weekday = anchor ? num(anchor.weekday) : null
  const season = anchor ? str(anchor.seasonElement) : ''
  return {
    MBTI: str(result.mbti),
    색: {
      충동: PRISM_COLOR_KO[impulse as keyof typeof PRISM_COLOR_KO] ?? impulse,
      필요: PRISM_COLOR_KO[need as keyof typeof PRISM_COLOR_KO] ?? need,
      정체성: PRISM_COLOR_KO[identity as keyof typeof PRISM_COLOR_KO] ?? identity,
    },
    요일: weekday != null ? (WEEKDAY_KO[weekday] ?? weekday) : null,
    계절: ELEMENT_KO[season] ?? season,
    올해주기: cycleChart(prism.annualCycle),
    이달주기: cycleChart(prism.monthlyCycle),
    오행관계: PRISM_RELATION_KO[str(prism.elementRelation)] ?? str(prism.elementRelation),
    기회: DOMAIN_KO[str(prism.opportunityDomain)] ?? str(prism.opportunityDomain),
    주의: DOMAIN_KO[str(prism.warningDomain)] ?? str(prism.warningDomain),
  }
}

function ziweiChart(result: Record<string, unknown>, ctx: NativeChartContext): JsonObject {
  const chart = rec(result.chart) ?? result
  const palaces = arr(chart.palaces).map((palace) => {
    const row = rec(palace) ?? {}
    return {
      궁: PALACE_KO[str(row.name)] ?? str(row.name),
      천간: str(row.stem),
      지지: str(row.branch),
      주성: palaceStars(arr(row.stars).filter((star) => rec(star)?.category === 'major')),
      보조성: palaceStars(arr(row.stars).filter((star) => rec(star)?.category !== 'major')),
    }
  })
  const daXian = rec(chart.daXian)
  const current = daXian ? rec(daXian.currentDaXian) : null
  let 대한: JsonObject | null = current
    ? {
        궁: PALACE_KO[str(current.palaceName)] ?? str(current.palaceName),
        나이대:
          num(current.ageFrom) != null && num(current.ageTo) != null
            ? `${num(current.ageFrom)}–${num(current.ageTo)}세`
            : '',
      }
    : null
  if (!대한 && daXian && ctx.nominalAge != null) {
    const match = arr(daXian.periods)
      .map((period) => rec(period))
      .find((period) => {
        if (!period) return false
        const from = num(period.ageFrom)
        const to = num(period.ageTo)
        return from != null && to != null && ctx.nominalAge! >= from && ctx.nominalAge! <= to
      })
    if (match) {
      대한 = {
        궁: PALACE_KO[str(match.palaceName)] ?? str(match.palaceName),
        나이대:
          num(match.ageFrom) != null && num(match.ageTo) != null
            ? `${num(match.ageFrom)}–${num(match.ageTo)}세`
            : '',
      }
    }
  }
  return {
    오행국: rec(chart.wuXingJu)?.name ?? null,
    십이궁: palaces,
    사화: sihuaChart(chart.siHua),
    대한: 대한,
  }
}

function numerologyChart(result: Record<string, unknown>): JsonObject {
  const numbers = rec(result.numbers) ?? result
  const chart: JsonObject = {
    라이프패스: numbers.lifePath,
    생일수: numbers.birthdayNumber,
    개인연: numbers.personalYear,
    개인월: numbers.personalMonth,
  }
  if (numbers.expression != null) chart.표현수 = numbers.expression
  if (numbers.soulUrge != null) chart.하트수 = numbers.soulUrge
  if (numbers.personality != null) chart.성격수 = numbers.personality
  return chart
}

function nameChart(result: Record<string, unknown>): JsonObject {
  const reading = rec(result.reading) ?? result
  if (reading.supported === false) {
    return { 상태: '이 이름 체계로는 오격을 내지 않음' }
  }
  const suri = rec(reading.numerology81)
  if (!suri) return { 상태: '오격 없음' }
  return {
    오격: (['cheon', 'in', 'ji', 'oe', 'chong'] as const).map((key) => {
      const cell = rec(suri[key]) ?? {}
      return {
        격: GYEOK_KO[key] ?? key,
        수: cell.number,
        길흉: str(cell.label),
        키워드: str(cell.keyword),
      }
    }),
  }
}

function ichingChart(result: Record<string, unknown>): JsonObject {
  const draw = rec(result.draw) ?? result
  const palace = str(draw.palace)
  return {
    본괘: hexagramChart(draw.primary),
    변괘: hexagramChart(draw.resulting),
    변효위치: arr(draw.changingPositions),
    세효: draw.shi,
    응효: draw.ying,
    궁: hangulHanja(palace, TRIGRAM_KO[palace]),
    효: arr(draw.lines).map(ichingLine),
  }
}

function tarotChart(result: Record<string, unknown>): JsonObject {
  const draw = rec(result.draw) ?? result
  return {
    장수: draw.spread,
    카드: arr(draw.cards).map(tarotCard),
  }
}

function runesChart(result: Record<string, unknown>): JsonObject {
  const draw = rec(result.draw) ?? result
  return {
    룬: arr(draw.runes).map(runeRow),
  }
}

function nineStarValue(value: unknown): JsonObject | null {
  const row = rec(value)
  if (!row) return null
  return {
    숫자: row.number,
    이름: str(row.hangul),
    오행: elementKo(row.element),
  }
}

function ninestarChart(result: Record<string, unknown>): JsonObject {
  const natal = rec(result.natal)
  const current = rec(result.current)
  return {
    본명성: natal ? nineStarValue(natal.year) : null,
    월명성: natal ? nineStarValue(natal.month) : null,
    일명성: natal ? nineStarValue(natal.day) : null,
    오늘: current
      ? {
          연: nineStarValue(current.year),
          월: nineStarValue(current.month),
          일: nineStarValue(current.day),
        }
      : null,
  }
}

function sukuyouMansion(value: unknown): JsonObject | null {
  const row = rec(value)
  if (!row) return null
  return { 한자: str(row.hanja), 한글: str(row.hangul) }
}

function sukuyouChart(result: Record<string, unknown>): JsonObject {
  return {
    태어난숙: sukuyouMansion(result.natal),
    오늘숙: sukuyouMansion(result.current),
  }
}

function tzolkinCoord(value: unknown): JsonObject | null {
  const row = rec(value)
  if (!row) return null
  return { 톤: row.tone, 나왈: str(row.nawalName) }
}

function tzolkinChart(result: Record<string, unknown>): JsonObject {
  return {
    태어난날: tzolkinCoord(result.natal),
    오늘: tzolkinCoord(result.current),
  }
}

const BUILDERS: Record<SystemId, (result: Record<string, unknown>, ctx: NativeChartContext) => JsonObject> = {
  saju: sajuChart,
  astro: astroChart,
  prism: prismChart,
  ziwei: ziweiChart,
  numerology: numerologyChart,
  name: nameChart,
  iching: ichingChart,
  tarot: tarotChart,
  runes: runesChart,
  ninestar: ninestarChart,
  sukuyou: sukuyouChart,
  tzolkin: tzolkinChart,
}

export function buildNativeChart(
  system: SystemId,
  result: JsonObject | null,
  ctx: NativeChartContext,
): JsonObject {
  const builder = BUILDERS[system]
  return builder(result ?? {}, ctx)
}
