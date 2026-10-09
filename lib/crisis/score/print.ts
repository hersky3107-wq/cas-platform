import type { RegionScore } from './types'

function fmt(value: number, digits = 2): string {
  return value.toFixed(digits)
}

export function explainRegion(rank: number, row: RegionScore): string {
  const comps = row.components.map((item) => `${item.key}=${fmt(item.value)}`).join(' ') || '(none)'
  const rawBits = row.components
    .map((item) => {
      const extras = Object.entries(item.raw)
        .filter(([, value]) => value != null && value !== false)
        .map(([key, value]) => `${key}:${value}`)
        .join(',')
      return extras ? `${item.key}(${extras})` : item.key
    })
    .join('; ')
  const frag = row.fragility_items.map((item) => item.name).join('; ') || '(none)'
  const people = row.urban_centres.map((item) => `${item.name} ${Math.round(item.pop)}`).join('; ') || '(none)'
  const watch = row.cascades
    .map((item) => `${item.id} → ${item.effect_type} ${item.lag_min_days}-${item.lag_max_days}d ${item.evidence_level}`)
    .join('; ') || '(none)'
  return [
    `${rank}. ${row.name} / ${row.country}  score=${fmt(row.score, 1)} stage=${row.stage}`,
    `   trigger=${fmt(row.trigger)}  fragility=${fmt(row.fragility)}  people=${fmt(row.people_norm)}  urban_pop=${Math.round(row.urban_pop)}`,
    `   components: ${comps}`,
    `   raw: ${rawBits || '-'}`,
    `   fragility: ${frag}`,
    `   people: ${people}`,
    `   cascades: ${watch}`,
    `   bonus: compound=${row.bonus.compound} cascade=${row.bonus.cascade}  depts=${row.departments.join(',') || '-'}`,
    `   context: ${(row.context ?? []).join(' | ') || '-'}`,
  ].join('\n')
}

export function printTop30(rows: RegionScore[]): string {
  const top = [...rows].sort((a, b) => b.score - a.score).slice(0, 30)
  return top.map((row, i) => explainRegion(i + 1, row)).join('\n')
}
