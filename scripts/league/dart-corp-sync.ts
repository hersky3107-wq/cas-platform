/**
 * Map KOSPI/KOSDAQ league_kr_universe stock codes to OpenDART corp codes.
 *
 * Default is dry-run: prints the plan and makes NO network call.
 * Only --apply downloads corpCode.xml once and upserts league_dart_corp.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/dart-corp-sync.ts
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/dart-corp-sync.ts --apply
 */
import JSZip from 'jszip'
import { mapStockCodesToCorps, parseCorpCodeXml, type MappedDartCorp } from '@/lib/league/korea-dart-model'
import { supabaseAdmin } from '@/lib/supabase/server'

const TABLE = 'league_dart_corp'

export function parseDartCorpSyncArgs(argv: string[]): { apply: boolean } {
  let apply = false
  for (const arg of argv) {
    if (arg === '--apply') apply = true
    if (arg === '--dry-run') apply = false
  }
  return { apply }
}

export type DartCorpSyncIo = {
  log?: (message: string) => void
  listKrStockCodes?: () => Promise<string[]>
  downloadCorpCodeZip?: () => Promise<Uint8Array>
  upsertCorps?: (rows: MappedDartCorp[]) => Promise<void>
}

async function defaultListKrStockCodes(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('league_kr_universe')
    .select('code, market')
    .in('market', ['KOSPI', 'KOSDAQ'])
  if (error) throw new Error(`league_kr_universe read failed: ${error.message}`)
  const codes: string[] = []
  for (const row of data ?? []) {
    const code = (row as { code?: unknown }).code
    if (typeof code === 'string' && code.trim()) codes.push(code.trim())
  }
  return codes
}

async function defaultDownloadCorpCodeZip(): Promise<Uint8Array> {
  const key = process.env.OPENDART_API_KEY?.trim()
  if (!key) throw new Error('OPENDART_API_KEY is not set')
  const url = new URL('https://opendart.fss.or.kr/api/corpCode.xml')
  url.searchParams.set('crtfc_key', key)
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`OpenDART corpCode download failed (${res.status})`)
    return new Uint8Array(await res.arrayBuffer())
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('OpenDART corpCode download failed')) throw err
    throw new Error('OpenDART corpCode download failed')
  }
}

async function xmlFromZip(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)
  const name = Object.keys(zip.files).find((entry) => /corpcode\.xml$/i.test(entry) && !zip.files[entry]?.dir)
  if (!name) throw new Error('OpenDART corpCode zip has no CORPCODE.xml')
  return zip.file(name)!.async('string')
}

async function defaultUpsertCorps(rows: MappedDartCorp[]): Promise<void> {
  const now = new Date().toISOString()
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((row) => ({
      stock_code: row.stockCode,
      corp_code: row.corpCode,
      corp_name: row.corpName,
      updated_at: now,
    }))
    const { error } = await supabaseAdmin.from(TABLE).upsert(chunk)
    if (error) throw new Error(`league_dart_corp upsert failed: ${error.message}`)
  }
}

export async function runDartCorpSync(argv: string[] = process.argv.slice(2), io: DartCorpSyncIo = {}): Promise<void> {
  const { apply } = parseDartCorpSyncArgs(argv)
  const log = io.log ?? ((message: string) => console.log(message))
  if (!apply) {
    log(
      'OpenDART corp-code sync: dry-run. Would download corpCode.xml once and map every KOSPI/KOSDAQ row in league_kr_universe into league_dart_corp. No request sent.',
    )
    return
  }

  const list = io.listKrStockCodes ?? defaultListKrStockCodes
  const download = io.downloadCorpCodeZip ?? defaultDownloadCorpCodeZip
  const upsert = io.upsertCorps ?? defaultUpsertCorps
  const codes = await list()
  const bytes = await download()
  const xml = await xmlFromZip(bytes)
  const mapped = mapStockCodesToCorps(codes, parseCorpCodeXml(xml))
  await upsert(mapped)
  log(`OpenDART corp-code sync: APPLY universe=${codes.length} matched=${mapped.length} unmatched=${codes.length - mapped.length}`)
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/league/dart-corp-sync.ts')
if (isMain) {
  runDartCorpSync().catch((err) => {
    console.error(err instanceof Error ? err.message : 'dart corp sync failed')
    process.exit(1)
  })
}
