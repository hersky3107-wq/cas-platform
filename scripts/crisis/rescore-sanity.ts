import { existsSync } from 'node:fs'
import path from 'node:path'
import { runLayer1Score } from '../../lib/crisis/score/job'
import type { RegionScore } from '../../lib/crisis/score/types'

const BEFORE_TOP_20 = [
  { rank: 1, name: 'Paraná', country: 'Brazil', stage: 5, score: 100.0, triggers: 'rain, conflict' },
  { rank: 2, name: 'São Paulo', country: 'Brazil', stage: 5, score: 100.0, triggers: 'rain, slow_burn' },
  { rank: 3, name: 'Istanbul', country: 'Turkey', stage: 5, score: 97.6, triggers: 'rain' },
  { rank: 4, name: 'Guizhou', country: "People's Republic of China", stage: 5, score: 96.4, triggers: 'rain, escalation' },
  { rank: 5, name: 'Manubah', country: 'Tunisia', stage: 5, score: 96.1, triggers: 'river' },
  { rank: 6, name: 'Bursa', country: 'Turkey', stage: 5, score: 94.8, triggers: 'rain' },
  { rank: 7, name: 'Kocaeli', country: 'Turkey', stage: 5, score: 94.1, triggers: 'rain' },
  { rank: 8, name: 'Nairobi', country: 'Kenya', stage: 5, score: 92.1, triggers: 'river, internet' },
  { rank: 9, name: 'Chiriquí', country: 'Panama', stage: 5, score: 85.5, triggers: 'rain, internet' },
  { rank: 10, name: 'Nord-Kivu', country: 'Democratic Republic of the Congo', stage: 5, score: 85.5, triggers: 'rain, internet, advisory' },
  { rank: 11, name: 'Shabeellaha Hoose', country: 'Somalia', stage: 4, score: 78.9, triggers: 'rain, advisory' },
  { rank: 12, name: 'Quezaltenango', country: 'Guatemala', stage: 4, score: 73.1, triggers: 'rain, internet' },
  { rank: 13, name: 'San Marcos', country: 'Guatemala', stage: 4, score: 73.0, triggers: 'rain, internet' },
  { rank: 14, name: 'Virginia', country: 'United States of America', stage: 3, score: 68.8, triggers: 'rain' },
  { rank: 15, name: 'Jubbada Dhexe', country: 'Somalia', stage: 3, score: 65.3, triggers: 'rain, advisory' },
  { rank: 16, name: 'Bujumbura Mairie', country: 'Burundi', stage: 3, score: 65.3, triggers: 'conflict' },
  { rank: 17, name: 'Veraguas', country: 'Panama', stage: 3, score: 64.6, triggers: 'quake, conflict, internet' },
  { rank: 18, name: 'Izmir', country: 'Turkey', stage: 3, score: 64.0, triggers: 'conflict' },
  { rank: 19, name: 'Los Rios', country: 'Ecuador', stage: 3, score: 62.2, triggers: 'rain' },
  { rank: 20, name: 'Nariño', country: 'Colombia', stage: 3, score: 62.1, triggers: 'rain' },
]

const BEFORE_STAGES = { '1': 4594, '2': 191, '3': 35, '4': 3, '5': 10 }

function stageCounts(rows: RegionScore[]): Record<number, number> {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const r of rows) counts[r.stage] = (counts[r.stage] ?? 0) + 1
  return counts
}

async function main(): Promise<void> {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  const { supabaseAdmin } = await import('../../lib/supabase/server')

  console.log('=== STEP 1: DRY RUN RESCORE ===')
  const dryResult = await runLayer1Score(supabaseAdmin, { dryRun: true, write: false })
  const newSorted = [...dryResult.rows].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const newStages = stageCounts(dryResult.rows)

  console.log('\n========================================')
  console.log('STAGE COUNTS COMPARISON (BEFORE -> AFTER)')
  console.log('========================================')
  console.log(`Stage 1: ${BEFORE_STAGES[1]} -> ${newStages[1]}`)
  console.log(`Stage 2: ${BEFORE_STAGES[2]} -> ${newStages[2]}`)
  console.log(`Stage 3: ${BEFORE_STAGES[3]} -> ${newStages[3]}`)
  console.log(`Stage 4: ${BEFORE_STAGES[4]} -> ${newStages[4]}`)
  console.log(`Stage 5: ${BEFORE_STAGES[5]} -> ${newStages[5]}`)
  console.log(`Cards (stage >= 2): ${BEFORE_STAGES[2] + BEFORE_STAGES[3] + BEFORE_STAGES[4] + BEFORE_STAGES[5]} -> ${newStages[2] + newStages[3] + newStages[4] + newStages[5]}`)

  console.log('\n========================================')
  console.log('TOP 20 BEFORE RESCORE:')
  console.log('========================================')
  for (const b of BEFORE_TOP_20) {
    console.log(`${b.rank}. ${b.name} / ${b.country} — stage=${b.stage} score=${b.score.toFixed(1)} triggers=[${b.triggers}]`)
  }

  console.log('\n========================================')
  console.log('TOP 20 AFTER RESCORE:')
  console.log('========================================')
  for (let i = 0; i < Math.min(20, newSorted.length); i++) {
    const r = newSorted[i]
    const triggers = r.components.map((c) => c.key).join(', ') || 'none'
    console.log(`${i + 1}. ${r.name} / ${r.country} — stage=${r.stage} score=${r.score.toFixed(1)} triggers=[${triggers}]`)
  }

  console.log('\n=== STEP 2: WRITING NEW SCORES TO DB ===')
  const writeResult = await runLayer1Score(supabaseAdmin, { dryRun: false, write: true })
  console.log(`Successfully wrote ${writeResult.scored} flags, ${writeResult.cards} cards for day ${writeResult.day}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
