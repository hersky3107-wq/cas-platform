/**
 * Apply a popularity snapshot CSV onto public.league_kr_universe.
 *
 * Default is --dry-run (prints entering / staying / leaving / unmapped).
 * Only --apply writes. Never deletes. Never changes pinned/hidden status.
 *
 *   npx tsx --env-file=.env.local scripts/league/kr-universe-apply.ts scripts/league/out/kr-universe-YYYYMMDD.csv
 *   npx tsx --env-file=.env.local scripts/league/kr-universe-apply.ts scripts/league/out/kr-universe-YYYYMMDD.csv --apply
 *
 * Group map: data/league/kr-group-map.json
 *   { "KOSPI:005930": { "group": "semis", "flags": [] } }
 * Missing map file is created as {} and the run stays dry-run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Papa from 'papaparse'
import { supabaseAdmin } from '@/lib/supabase/server'
import {
  mapUniverseDbRow,
  parseKrGroupMap,
  planUniverseApply,
  toUniverseDbWrite,
  type LeagueKrUniverseDbRow,
  type UniverseRecord,
  type UniverseSnapshotRow,
} from '@/lib/league/korea-universe-apply'
import type { UniverseMarket } from '@/lib/league/korea-equity-catalog'

const TABLE = 'league_kr_universe'
const GROUP_MAP_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/league/kr-group-map.json',
)

function parseArgs(argv: string[]): { csvPath: string | null; apply: boolean } {
  let csvPath: string | null = null
  let apply = false
  for (const arg of argv) {
    if (arg === '--apply') apply = true
    else if (arg === '--dry-run') apply = false
    else if (!arg.startsWith('-')) csvPath = arg
  }
  return { csvPath, apply }
}

function asMarket(value: string): UniverseMarket | null {
  if (value === 'KOSPI' || value === 'KOSDAQ' || value === 'US') return value
  return null
}

function parseNum(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

export function parseUniverseSnapshotCsv(text: string): UniverseSnapshotRow[] {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })
  const rows: UniverseSnapshotRow[] = []
  for (const raw of parsed.data) {
    const market = asMarket(String(raw.market ?? '').trim())
    const code = String(raw.code ?? '').trim()
    const name = String(raw.name ?? '').trim()
    const rank = parseNum(raw.rank)
    const avg = parseNum(raw.avg_trdval_20d_eok)
    const mktcap = parseNum(raw.mktcap_eok)
    if (!market || !code || rank == null || avg == null || mktcap == null) continue
    rows.push({
      market,
      code,
      name: name || code,
      rank,
      avgTrdval20dEok: Math.round(avg),
      mktcapEok: Math.round(mktcap),
    })
  }
  return rows
}

function loadOrCreateGroupMap(): { map: ReturnType<typeof parseKrGroupMap>; created: boolean } {
  if (!existsSync(GROUP_MAP_PATH)) {
    mkdirSync(dirname(GROUP_MAP_PATH), { recursive: true })
    writeFileSync(GROUP_MAP_PATH, '{}\n', 'utf8')
    return { map: {}, created: true }
  }
  const raw = JSON.parse(readFileSync(GROUP_MAP_PATH, 'utf8')) as unknown
  return { map: parseKrGroupMap(raw), created: false }
}

async function loadExisting(): Promise<UniverseRecord[]> {
  const { data, error } = await supabaseAdmin.from(TABLE).select('*')
  if (error) throw new Error(`league_kr_universe read: ${error.message}`)
  return ((data ?? []) as LeagueKrUniverseDbRow[])
    .map(mapUniverseDbRow)
    .filter((row): row is UniverseRecord => row !== null)
}

async function writeRows(rows: UniverseRecord[]): Promise<void> {
  if (rows.length === 0) return
  const payload = rows.map(toUniverseDbWrite)
  const { error } = await supabaseAdmin.from(TABLE).upsert(payload, { onConflict: 'market,code' })
  if (error) throw new Error(`league_kr_universe upsert: ${error.message}`)
}

function printPlan(
  plan: ReturnType<typeof planUniverseApply>,
  opts: { dryRun: boolean; mapCreated: boolean; csvPath: string },
): void {
  const mode = opts.dryRun ? 'dry-run' : 'APPLY'
  console.log(`league_kr_universe apply [${mode}]`)
  console.log(`  csv: ${opts.csvPath}`)
  console.log(`  group map: ${GROUP_MAP_PATH}${opts.mapCreated ? ' (created empty {})' : ''}`)
  console.log(`  writes:    ${plan.writes.length}`)
  console.log(`  entering:  ${plan.entering.length}`)
  console.log(`  staying:   ${plan.staying.length}`)
  console.log(`  leaving:   ${plan.leaving.length}`)
  console.log(`  unmapped:  ${plan.unmapped.length}`)
  if (plan.unmapped.length > 0) {
    const preview = plan.unmapped.slice(0, 40)
    console.log(`  unmapped list (${plan.unmapped.length}):`)
    for (const key of preview) console.log(`    ${key}`)
    if (plan.unmapped.length > preview.length) {
      console.log(`    … ${plan.unmapped.length - preview.length} more`)
    }
  }
}

async function main(): Promise<void> {
  const { csvPath: rawPath, apply } = parseArgs(process.argv.slice(2))
  if (!rawPath) {
    console.error(
      'Usage: npx tsx --env-file=.env.local scripts/league/kr-universe-apply.ts <csv> [--apply]',
    )
    process.exit(1)
  }
  const csvPath = isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath)
  if (!existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`)
    process.exit(1)
  }

  const { map, created } = loadOrCreateGroupMap()
  const dryRun = !apply || created
  if (created && apply) {
    console.log('group map was missing — created {} and staying in dry-run')
  }

  const snapshot = parseUniverseSnapshotCsv(readFileSync(csvPath, 'utf8'))
  if (snapshot.length === 0) {
    console.error('CSV parsed 0 snapshot rows')
    process.exit(1)
  }

  let existing: UniverseRecord[] = []
  try {
    existing = await loadExisting()
  } catch (e) {
    if (!dryRun) throw e
    console.log(`DB read skipped (${e instanceof Error ? e.message : e}) — planning against empty table`)
  }

  const now = new Date().toISOString()
  const plan = planUniverseApply({ existing, snapshot, groupMap: map, now })
  printPlan(plan, { dryRun, mapCreated: created, csvPath })

  if (dryRun) return
  await writeRows(plan.writes)
  console.log(`wrote ${plan.writes.length} rows (no deletes)`)
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isDirect) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
