/**
 * 오늘의 운세 facts chips. Built from the same native charts that go into
 * the daily weave ai_payload (`buildNativeChart` per system) — never from a
 * parallel walk of engine `result` fields, which labeled natal 일명성 as
 * today's star.
 */
import { ORACLE_DAILY_SYSTEMS } from './daily'
import { buildNativeChart } from './native-chart'
import type { JsonObject } from './types'

export type DailyFact = { label: string; value: string }

function rec(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function dailyNativeChartsFromResults(
  rows: ReadonlyArray<{ system: string; result: JsonObject | null }>,
): Record<string, JsonObject> {
  const bySystem = new Map(rows.map((row) => [row.system, row.result]))
  const charts: Record<string, JsonObject> = {}
  for (const system of ORACLE_DAILY_SYSTEMS) {
    const result = bySystem.get(system)
    if (!result) continue
    charts[system] = buildNativeChart(system, result, { locale: 'ko', nominalAge: null })
  }
  return charts
}

/**
 * Today's chips. 일명성 is ninestar.오늘.일 (today's flying star), not
 * natal ninestar.일명성 — that label collision is what made the strip and
 * the weave disagree.
 */
export function dailyFactsFromNativeCharts(systems: Record<string, unknown>): DailyFact[] {
  const facts: DailyFact[] = []

  const iljin = rec(rec(systems.saju)?.일진)
  const ganzhi = text(iljin?.간지)
  const gods = rec(iljin?.십신)
  const stemGod = text(gods?.천간)
  const branchGod = text(gods?.지지)
  if (ganzhi) {
    const godsLine = [stemGod, branchGod].filter(Boolean).join('·')
    facts.push({ label: '일진', value: godsLine ? `${ganzhi} ${godsLine}` : ganzhi })
  }

  const mansion = rec(rec(systems.sukuyou)?.오늘숙)
  const mansionLabel = [text(mansion?.한글), text(mansion?.한자)].filter(Boolean).join(' ')
  if (mansionLabel) facts.push({ label: '오늘의 宿', value: mansionLabel })
  const sanKu = rec(rec(systems.sukuyou)?.삼구)
  const sanKuLabel = text(sanKu?.관계)
  if (sanKuLabel) facts.push({ label: '삼구', value: sanKuLabel })

  const todayStar = rec(rec(rec(systems.ninestar)?.오늘)?.일)
  const starName = text(todayStar?.이름)
  const starNum = typeof todayStar?.숫자 === 'number' ? String(todayStar.숫자) : text(todayStar?.숫자)
  if (starName || starNum) {
    facts.push({ label: '일명성', value: [starName, starNum].filter(Boolean).join(' ') })
  }

  const tz = rec(rec(systems.tzolkin)?.오늘)
  const nawal = text(tz?.나왈)
  const tone = typeof tz?.톤 === 'number' ? String(tz.톤) : text(tz?.톤)
  if (nawal || tone) {
    facts.push({
      label: '톤·나왈',
      value: [tone ? `톤 ${tone}` : null, nawal].filter(Boolean).join(' · '),
    })
  }

  return facts
}
