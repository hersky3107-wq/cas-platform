import { existsSync } from 'node:fs'
import path from 'node:path'
import { loadTodayRegions } from '../../lib/crisis/admin/store'
import { isExtremeTrigger } from '../../lib/crisis/score/compute'
import { runLayer1Score } from '../../lib/crisis/score/job'
import { RAIN } from '../../lib/crisis/score/thresholds'
import type { TriggerComponent } from '../../lib/crisis/score/types'

type Named = { name: string; country: string; stage: number; score: number; triggers: string[] }

function stageCounts(rows: Array<{ stage: number }>): Record<number, number> {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const r of rows) counts[r.stage] = (counts[r.stage] ?? 0) + 1
  return counts
}

function triggerKeys(components: TriggerComponent[]): string[] {
  return components.filter((c) => c.value > 0).map((c) => c.key)
}

function line(row: Named, rank: number): string {
  return `${rank}. ${row.name} / ${row.country} — stage=${row.stage} score=${row.score.toFixed(1)} triggers=[${row.triggers.join(', ') || 'none'}]`
}

function printList(title: string, rows: Named[]): void {
  console.log(`\n========================================`)
  console.log(title)
  console.log('========================================')
  if (rows.length === 0) {
    console.log('(none)')
    return
  }
  for (let i = 0; i < rows.length; i++) console.log(line(rows[i], i + 1))
}

function rainNum(raw: Record<string, unknown>, key: string): number {
  const v = raw[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

async function main(): Promise<void> {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  const { supabaseAdmin } = await import('../../lib/supabase/server')

  const today = await loadTodayRegions(supabaseAdmin)
  const beforeSorted = [...today.regions].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const beforeConflict = beforeSorted.filter((r) => r.triggers.includes('conflict'))
  const beforeStages = stageCounts(beforeSorted)

  console.log(`=== BEFORE (stored ${today.day}) scored=${beforeSorted.length} conflict=${beforeConflict.length} ===`)
  printList('REGIONS WITH CONFLICT — BEFORE', beforeConflict.map((r) => ({
    name: r.name,
    country: r.country,
    stage: r.stage,
    score: r.score,
    triggers: r.triggers,
  })))

  console.log('\n=== DRY RUN RESCORE ===')
  const dryResult = await runLayer1Score(supabaseAdmin, { dryRun: true, write: false })
  const afterSorted = [...dryResult.rows].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const afterConflict = afterSorted.filter((r) => r.components.some((c) => c.key === 'conflict' && c.value > 0))
  const afterStages = stageCounts(dryResult.rows)

  printList('REGIONS WITH CONFLICT — AFTER', afterConflict.map((r) => ({
    name: r.name,
    country: r.country,
    stage: r.stage,
    score: r.score,
    triggers: triggerKeys(r.components),
  })))

  console.log('\n========================================')
  console.log('TURKEY RAIN vs SINGLE-TRIGGER CAP')
  console.log('========================================')
  const sumSoft2x = 2 * RAIN.sumSoftMm
  const day2x = 2 * RAIN.dayMm
  const sumHard2x = 2 * RAIN.sumHardMm
  console.log(`thresholds: 2x sumSoftMm=${sumSoft2x}mm  2x dayMm=${day2x}mm  2x sumHardMm=${sumHard2x}mm`)
  for (const name of ['Istanbul', 'Bursa', 'Kocaeli']) {
    const row = afterSorted.find((r) => r.name === name && (r.iso3 === 'TUR' || /turkey|türkiye/i.test(r.country)))
    if (!row) {
      console.log(`${name}: not in rescore rows`)
      continue
    }
    const rain = row.components.find((c) => c.key === 'rain')
    const sum = rain ? rainNum(rain.raw, 'sum_mm') : 0
    const maxDay = rain ? rainNum(rain.raw, 'max_day_mm') : 0
    const extreme = rain ? isExtremeTrigger(rain) : false
    const families = new Set(row.components.filter((c) => c.value > 0).map((c) => c.key))
    console.log(
      `${name}: stage=${row.stage} score=${row.score.toFixed(1)} rain.value=${rain?.value ?? 0} ` +
        `sum_mm=${sum} max_day_mm=${maxDay} extreme=${extreme} triggers=[${[...families].join(', ')}]`,
    )
    if (extreme) {
      console.log(
        `  single-trigger cap skipped: rain is >= 2x threshold ` +
          `(sum ${sum}>=${sumSoft2x} or maxDay ${maxDay}>=${day2x} or sum ${sum}>=${sumHard2x})`,
      )
    } else if (row.stage >= 5) {
      console.log('  BUG: stage 5 with rain only and not extreme — cap should have applied')
    } else {
      console.log('  cap applied or stage < 5 (not a single-rain stage-5)')
    }
  }

  console.log('\n========================================')
  console.log('STAGE COUNTS COMPARISON (BEFORE -> AFTER)')
  console.log('========================================')
  for (const s of [1, 2, 3, 4, 5] as const) {
    console.log(`Stage ${s}: ${beforeStages[s] ?? 0} -> ${afterStages[s] ?? 0}`)
  }
  const cardsBefore = (beforeStages[2] ?? 0) + (beforeStages[3] ?? 0) + (beforeStages[4] ?? 0) + (beforeStages[5] ?? 0)
  const cardsAfter = (afterStages[2] ?? 0) + (afterStages[3] ?? 0) + (afterStages[4] ?? 0) + (afterStages[5] ?? 0)
  console.log(`Cards (stage >= 2): ${cardsBefore} -> ${cardsAfter}`)

  printList(
    'TOP 20 BEFORE RESCORE',
    beforeSorted.slice(0, 20).map((r) => ({
      name: r.name,
      country: r.country,
      stage: r.stage,
      score: r.score,
      triggers: r.triggers,
    })),
  )
  printList(
    'TOP 20 AFTER RESCORE',
    afterSorted.slice(0, 20).map((r) => ({
      name: r.name,
      country: r.country,
      stage: r.stage,
      score: r.score,
      triggers: triggerKeys(r.components),
    })),
  )

  console.log('\n=== WRITING NEW SCORES TO DB ===')
  const writeResult = await runLayer1Score(supabaseAdmin, { dryRun: false, write: true })
  console.log(`Successfully wrote ${writeResult.scored} flags, ${writeResult.cards} cards for day ${writeResult.day}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
