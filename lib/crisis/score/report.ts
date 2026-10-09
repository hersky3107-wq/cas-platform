import { percentileThreshold } from './math'
import { SATURATION_FRACTION, STAGE_MIN } from './thresholds'
import type { RegionScore } from './types'

export interface CalibrationExtras {
  riverFired: number
  advisoryBoth: number
  advisoryDiverge: string[]
  wikiKept: number
  wikiDropped: number
  wikiKeptExamples: string[]
  wikiDroppedExamples: string[]
}

function pct(values: number[], p: number): number | null {
  return percentileThreshold(values, p)
}

function num(value: number | null, digits = 1): string {
  return value == null ? '-' : value.toFixed(digits)
}

export function calibrationReport(rows: RegionScore[], extra: CalibrationExtras): string {
  const scores = rows.map((row) => row.score)
  const fragility = rows.map((row) => row.fragility)
  const stages = [0, 0, 0, 0, 0, 0]
  for (const row of rows) stages[row.stage] = (stages[row.stage] ?? 0) + 1
  const cards = rows.filter((row) => row.stage >= 2).length
  const stage5 = stages[5] ?? 0
  const lines = [
    'calibration',
    `  scores n=${rows.length} p50=${num(pct(scores, 0.5))} p90=${num(pct(scores, 0.9))} p99=${num(pct(scores, 0.99))} max=${num(scores.length ? Math.max(...scores) : null)}`,
    `  stages 1=${stages[1] ?? 0} 2=${stages[2] ?? 0} 3=${stages[3] ?? 0} 4=${stages[4] ?? 0} 5=${stage5}  cuts 2>=${STAGE_MIN[2]} 3>=${STAGE_MIN[3]} 4>=${STAGE_MIN[4]} 5>=${STAGE_MIN[5]}`,
    `  cards stage>=2 ${cards} (target ~200)  stage5 ${stage5} (target ~10)`,
    `  fragility p50=${num(pct(fragility, 0.5), 3)} p90=${num(pct(fragility, 0.9), 3)} p99=${num(pct(fragility, 0.99), 3)}`,
    `  river fired ${extra.riverFired}`,
    `  advisory both=${extra.advisoryBoth} diverge=${extra.advisoryDiverge.length} ${extra.advisoryDiverge.slice(0, 12).join(',') || '-'}`,
    `  wiki kept=${extra.wikiKept} dropped=${extra.wikiDropped}`,
    `  wiki kept examples: ${extra.wikiKeptExamples.slice(0, 6).join(' | ') || '-'}`,
    `  wiki dropped examples: ${extra.wikiDroppedExamples.slice(0, 6).join(' | ') || '-'}`,
  ]
  if (!rows.length) return lines.join('\n')
  const keys = new Set<string>()
  for (const row of rows) for (const component of row.components) keys.add(component.key)
  for (const key of [...keys].sort()) {
    const n = rows.filter((row) => row.components.some((component) => component.key === key)).length
    const fraction = n / rows.length
    const alarm = fraction > SATURATION_FRACTION ? ' SATURATION' : ''
    lines.push(`  component ${key} ${n} (${(fraction * 100).toFixed(1)}%)${alarm}`)
  }
  return lines.join('\n')
}
