/**
 * Live verification of the league-divination adapter.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-league-divination-live.mts
 *
 * 1. Sequential 20× parse gate on the seated reader with a real compact chart pack.
 * 2. Twelve live rounds — one per category chip — through the adapter.
 * 3. Cache E2E: same roundId from adapter.ts vs live.ts against the real table.
 */
process.env.ORACLE_AI_MODE = 'live'

import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const GATE_N = 20
const GATE_PASS_AT = 19
const FIRST_VIEW = '2026-09-19T08:52:00.000Z'
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const OUT_MD = join(process.cwd(), 'docs', 'league-divination-live-verify.md')
const OUT_JSON = join(process.cwd(), 'docs', 'league-divination-live-verify.json')
const OUT_LOG = join(process.cwd(), 'docs', 'league-divination-live-verify.log')

writeFileSync(OUT_LOG, '')
function log(line: string) {
  console.log(line)
  appendFileSync(OUT_LOG, `${line}\n`)
}

const { callPlatformModel } = await import('../lib/ai/platform-providers')
const { isEmptyContentError } = await import('../lib/ai/empty-content-retry')
const { computeLeagueDivination } = await import('../lib/oracle/league-divination/compute')
const { compactReaderPack } = await import('../lib/oracle/league-divination/compact-pack')
const { parseLeagueReaderRationale, findMarketLanguage } = await import(
  '../lib/oracle/league-divination/parse-reader'
)
const { fallbackRationale } = await import('../lib/oracle/league-divination/fallback')
const { buildLeagueReaderSystemPrompt, buildLeagueReaderUserPrompt, LEAGUE_READER_STRICT_RETRY } =
  await import('../lib/oracle/league-divination/prompt')
const {
  LEAGUE_READER_BRAND,
  LEAGUE_READER_DISPLAY_NAME,
  LEAGUE_READER_PLATFORM_ID,
  LEAGUE_READER_MAX_COMPLETION_TOKENS,
  LEAGUE_READER_TIMEOUT_MS,
  LEAGUE_READER_EXTRA_REQUEST_PARAMS,
} = await import('../lib/oracle/league-divination/conventions')
const { LEAGUE_ORACLE_CATEGORY_IDS } = await import('../lib/oracle/league-divination/types')
const { runHoldCensus, holdCensusRates } = await import('../lib/oracle/league-divination/hold-census')
const { readLeagueDivination } = await import('../lib/oracle/league-divination/adapter')
const { createSupabaseLeagueDivinationCache } = await import('../lib/oracle/league-divination/cache')
const { supabaseAdmin } = await import('../lib/supabase/server')

type LeagueOracleCategoryId = (typeof LEAGUE_ORACLE_CATEGORY_IDS)[number]

const EYE_EXTRA = [
  '매수',
  '매도',
  '수익률',
  '호가',
  '캔들',
  '배당',
  '호재',
  '악재',
  '펀더멘',
  'odds',
  'spread',
  'bull',
  'bear',
] as const

type ChipEvent = {
  proposition: string
  propositionType: 'binary' | 'pick_one'
  subjectName: string
}

/** Closed-book chip prompts. No tape, no packet. */
const CHIP_EVENTS: Record<LeagueOracleCategoryId, ChipEvent> = {
  sports: {
    proposition: '홈 쪽이 원정 쪽을 이긴다',
    propositionType: 'pick_one',
    subjectName: '홈 vs 원정',
  },
  crypto: {
    proposition: '비트코인이 이번 구간에서 오른다',
    propositionType: 'binary',
    subjectName: 'Bitcoin',
  },
  stocks: {
    proposition: '삼성전자가 이번 구간에서 오른다',
    propositionType: 'binary',
    subjectName: '삼성전자',
  },
  fx: {
    proposition: '원화가 달러보다 강하다',
    propositionType: 'binary',
    subjectName: 'USD/KRW',
  },
  gold_metals: {
    proposition: '금이 이번 구간에서 오른다',
    propositionType: 'binary',
    subjectName: 'Gold',
  },
  index_etf: {
    proposition: '코스피가 이번 구간에서 오른다',
    propositionType: 'binary',
    subjectName: 'KOSPI',
  },
  commodities_energy: {
    proposition: '원유가 이번 구간에서 오른다',
    propositionType: 'binary',
    subjectName: 'WTI',
  },
  politics_election: {
    proposition: '갑 후보가 을 후보를 이긴다',
    propositionType: 'pick_one',
    subjectName: '갑 vs 을',
  },
  entertainment: {
    proposition: '작품 갑이 작품 을보다 앞에 선다',
    propositionType: 'pick_one',
    subjectName: '작품 갑 vs 작품 을',
  },
  memecoin: {
    proposition: '도지코인이 이번 구간에서 오른다',
    propositionType: 'binary',
    subjectName: 'DOGE',
  },
  real_estate: {
    proposition: '서울 아파트 매매가가 이번 구간에서 오른다',
    propositionType: 'binary',
    subjectName: '서울 아파트',
  },
  macro_econ: {
    proposition: '국내 경기가 이번 구간에서 살아난다',
    propositionType: 'binary',
    subjectName: '경기',
  },
}

type CallKind = 'ok' | 'empty-200' | 'timeout' | 'http' | 'other'

type PlatformCallResult = Awaited<ReturnType<typeof callPlatformModel>>

function classifyCall(res: PlatformCallResult): CallKind {
  const klass = res.diagnostics?.errorClass
  if (klass === 'EmptyContentError' || isEmptyContentError(res.error)) return 'empty-200'
  if (klass === 'TimeoutError') return 'timeout'
  if (klass === 'HttpError') return 'http'
  if (res.error) return 'other'
  return 'ok'
}

type InstrumentedCall = {
  latencyMs: number
  costUsd: number | null
  kind: CallKind
  finishReason: string | null
  error: string | null
  promptTokens: number | null
  completionTokens: number | null
  empty200Logged: number
}

let empty200LogHits = 0
const origLog = console.log.bind(console)
console.log = (...args: unknown[]) => {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  if (line.includes('HTTP 200 with empty message.content')) empty200LogHits += 1
  origLog(...args)
}

async function callReaderOnce(input: {
  systemPrompt: string
  userPrompt: string
  timeoutMs: number
}): Promise<{ text: string | null; meta: InstrumentedCall }> {
  const emptyBefore = empty200LogHits
  const t0 = Date.now()
  const res = await callPlatformModel({
    id: LEAGUE_READER_PLATFORM_ID,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    maxCompletionTokens: LEAGUE_READER_MAX_COMPLETION_TOKENS,
    extraRequestParams: { ...LEAGUE_READER_EXTRA_REQUEST_PARAMS },
    debugRequestLabel: 'league-divination-reader',
    timeoutMs: input.timeoutMs,
  })
  const meta: InstrumentedCall = {
    latencyMs: Date.now() - t0,
    costUsd: typeof res.costUsd === 'number' ? res.costUsd : null,
    kind: classifyCall(res),
    finishReason: res.finishReason ?? null,
    error: res.error ?? null,
    promptTokens: res.usage?.promptTokens ?? null,
    completionTokens: res.usage?.completionTokens ?? null,
    empty200Logged: empty200LogHits - emptyBefore,
  }
  return { text: res.text ?? null, meta }
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function usd(n: number | null): string {
  if (n == null) return 'n/a'
  return `$${n.toFixed(6)}`
}

function eyeExtras(text: string): string[] {
  const lower = text.toLowerCase()
  return EYE_EXTRA.filter((w) => lower.includes(w.toLowerCase()))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForCacheTable(timeoutMs: number): Promise<{ ok: boolean; message: string }> {
  const start = Date.now()
  let last = 'not probed'
  while (Date.now() - start < timeoutMs) {
    const { error } = await supabaseAdmin.from('oracle_league_divination_cache').select('round_id').limit(1)
    if (!error) return { ok: true, message: 'table reachable' }
    last = error.message
    if (!/does not exist|schema cache|could not find the table/i.test(error.message)) {
      return { ok: false, message: last }
    }
    log(`waiting for oracle_league_divination_cache (${last})`)
    await sleep(5000)
  }
  return { ok: false, message: last }
}

// --- 1. Sequential 20× gate, cycling real chip payloads -----------------------

const gateSystem = buildLeagueReaderSystemPrompt()

type GateRow = {
  run: number
  category: string
  parsed: boolean
  parseReason: string | null
  parseDetail: string | null
  attempts: number
  latencyMs: number
  firstAttemptMs: number
  costUsd: number | null
  kinds: CallKind[]
  empty200Logged: number
  finishReason: string | null
  error: string | null
  textChars: number
  sample: string | null
}

const gateRows: GateRow[] = []

async function runGateTrial(run: number): Promise<GateRow> {
  const category = LEAGUE_ORACLE_CATEGORY_IDS[(run - 1) % LEAGUE_ORACLE_CATEGORY_IDS.length]!
  const event = CHIP_EVENTS[category]
  const computed = computeLeagueDivination({
    roundId: `live-verify-gate-${RUN_STAMP}-${run}-${category}`,
    firstViewIso: FIRST_VIEW,
    categoryId: category,
    axis: event.propositionType === 'pick_one' ? 'pick_one' : 'direction',
  })
  const pack = compactReaderPack(computed, {
    proposition: event.proposition,
    subjectName: event.subjectName,
  })
  const user = buildLeagueReaderUserPrompt(pack)
  if (run === 1) {
    log(
      `gate cycles all ${LEAGUE_ORACLE_CATEGORY_IDS.length} chips (run i → chip[(i-1)%12]). first userChars=${user.length} codeVerdict=${pack.codeVerdict}`,
    )
  }

  const first = await callReaderOnce({
    systemPrompt: gateSystem,
    userPrompt: user,
    timeoutMs: LEAGUE_READER_TIMEOUT_MS,
  })
  const parsedFirst = parseLeagueReaderRationale(first.text ?? '', pack.codeVerdict)
  if (parsedFirst.ok) {
    return {
      run,
      category,
      parsed: true,
      parseReason: null,
      parseDetail: null,
      attempts: 1,
      latencyMs: first.meta.latencyMs,
      firstAttemptMs: first.meta.latencyMs,
      costUsd: first.meta.costUsd,
      kinds: [first.meta.kind],
      empty200Logged: first.meta.empty200Logged,
      finishReason: first.meta.finishReason,
      error: first.meta.error,
      textChars: (first.text ?? '').length,
      sample: null,
    }
  }

  const firstFail = parsedFirst.ok ? null : parsedFirst
  const second = await callReaderOnce({
    systemPrompt: gateSystem + LEAGUE_READER_STRICT_RETRY,
    userPrompt: user,
    timeoutMs: LEAGUE_READER_TIMEOUT_MS,
  })
  const parsedSecond = parseLeagueReaderRationale(second.text ?? '', pack.codeVerdict)
  const cost =
    first.meta.costUsd != null || second.meta.costUsd != null
      ? (first.meta.costUsd ?? 0) + (second.meta.costUsd ?? 0)
      : null
  const secondFail = parsedSecond.ok ? null : parsedSecond
  return {
    run,
    category,
    parsed: parsedSecond.ok,
    parseReason: parsedSecond.ok ? firstFail?.reason ?? null : secondFail?.reason ?? null,
    parseDetail: parsedSecond.ok ? firstFail?.detail ?? null : secondFail?.detail ?? null,
    attempts: 2,
    latencyMs: first.meta.latencyMs + second.meta.latencyMs,
    firstAttemptMs: first.meta.latencyMs,
    costUsd: cost,
    kinds: [first.meta.kind, second.meta.kind],
    empty200Logged: first.meta.empty200Logged + second.meta.empty200Logged,
    finishReason: second.meta.finishReason ?? first.meta.finishReason,
    error: second.meta.error ?? first.meta.error,
    textChars: (second.text ?? first.text ?? '').length,
    sample: parsedSecond.ok ? (first.text ?? '').slice(0, 400) : (second.text ?? first.text ?? '').slice(0, 800),
  }
}

log(`starting sequential ${GATE_N}× gate on ${LEAGUE_READER_DISPLAY_NAME} (${LEAGUE_READER_PLATFORM_ID}) timeout=${LEAGUE_READER_TIMEOUT_MS}ms`)

for (let run = 1; run <= GATE_N; run += 1) {
  const row = await runGateTrial(run)
  gateRows.push(row)
  log(
    `gate ${run}/${GATE_N} ${row.category} parsed=${row.parsed} attempts=${row.attempts} ${row.latencyMs}ms kinds=${row.kinds.join('+')} reason=${row.parseReason ?? '-'}${row.parseDetail ? `/${row.parseDetail}` : ''}`,
  )
}

const gateParsed = gateRows.filter((r) => r.parsed).length
const gateEmpty200 = gateRows.filter((r) => r.kinds.includes('empty-200') || r.empty200Logged > 0).length
const gateTimeout = gateRows.filter((r) => r.kinds.includes('timeout')).length
const firstAttempts = gateRows.map((r) => r.firstAttemptMs)
const gateMeanMs = mean(firstAttempts)
const gateWorstMs = Math.max(...firstAttempts)
const clears12s = gateTimeout === 0 && gateWorstMs <= LEAGUE_READER_TIMEOUT_MS
const gatePass = gateParsed >= GATE_PASS_AT
const failSample = gateRows.find((r) => r.sample)?.sample ?? null

log(
  `GATE ${gateParsed}/${GATE_N} pass=${gatePass} mean=${Math.round(gateMeanMs)}ms worst=${Math.round(gateWorstMs)}ms clears12s=${clears12s} empty-200=${gateEmpty200}/${GATE_N} timeout=${gateTimeout}/${GATE_N}`,
)
if (failSample) log(`--- first fail sample ---\n${failSample}\n---`)

const REPLACEMENT = {
  brand: 'Meta',
  displayName: 'Llama 4 Maverick',
  platformId: 'openrouter:llama-4-maverick',
  why: 'Meta already passed the oracle reading 20× gate (20/20). Live probe on this pack: 6.8s, five Korean lines, under the $0.002 cap. Do not raise the 12s timeout; NAVER oracle name-seat thinking:low measured 11–23s.',
}

// --- 2. Twelve live category rounds -------------------------------------------

const tableWait = await waitForCacheTable(180_000)
log(`cache table: ${tableWait.ok ? 'ok' : 'MISSING'} (${tableWait.message})`)

const supabaseCache = createSupabaseLeagueDivinationCache(supabaseAdmin)

type RoundRow = {
  category: LeagueOracleCategoryId
  roundId: string
  verdict: 'up' | 'down'
  pick: 'A' | 'B' | null
  confidence: number
  latencyMs: number
  costUsd: number | null
  source: 'ai' | 'fallback'
  attempts: number
  rationale: string
  parserBanHit: string | null
  eyeExtra: string[]
  fallbackFired: boolean
  kinds: CallKind[]
  empty200Logged: number
}

const roundRows: RoundRow[] = []

for (const category of LEAGUE_ORACLE_CATEGORY_IDS) {
  const event = CHIP_EVENTS[category]
  const roundId = `live-verify-${RUN_STAMP}-${category}`
  const computed = computeLeagueDivination({
    roundId,
    firstViewIso: FIRST_VIEW,
    categoryId: category,
    axis: event.propositionType === 'pick_one' ? 'pick_one' : 'direction',
  })
  const pack = compactReaderPack(computed, {
    proposition: event.proposition,
    subjectName: event.subjectName,
  })
  const expectedFallback = fallbackRationale(pack)

  const callMetas: InstrumentedCall[] = []
  const t0 = Date.now()
  const output = await readLeagueDivination(
    {
      proposition: event.proposition,
      propositionType: event.propositionType,
      category,
      subjectName: event.subjectName,
      firstViewedAt: FIRST_VIEW,
      roundId,
    },
    {
      cache: supabaseCache,
      reader: async (input) => {
        const { text, meta } = await callReaderOnce({
          systemPrompt: input.systemPrompt,
          userPrompt: input.userPrompt,
          timeoutMs: input.timeoutMs,
        })
        callMetas.push(meta)
        const parsed = parseLeagueReaderRationale(text ?? '', pack.codeVerdict)
        if (!parsed.ok) {
          log(
            `  parse miss ${category} attempt=${callMetas.length} reason=${parsed.reason}${parsed.detail ? `/${parsed.detail}` : ''} chars=${[...(text ?? '')].length} lines=${(text ?? '').split(/\n/).filter((l) => l.trim()).length}`,
          )
          log(`  --- raw miss ---\n${(text ?? '').slice(0, 800)}\n  ---`)
        }
        return { text, error: meta.error ?? undefined }
      },
    },
  )
  const latencyMs = Date.now() - t0
  const costUsd = callMetas.reduce<number | null>((acc, m) => {
    if (m.costUsd == null) return acc
    return (acc ?? 0) + m.costUsd
  }, null)
  const fallbackFired = output.rationale === expectedFallback
  const row: RoundRow = {
    category,
    roundId,
    verdict: output.verdict,
    pick: output.pick,
    confidence: output.confidence,
    latencyMs,
    costUsd,
    source: fallbackFired ? 'fallback' : 'ai',
    attempts: callMetas.length,
    rationale: output.rationale,
    parserBanHit: findMarketLanguage(output.rationale),
    eyeExtra: eyeExtras(output.rationale),
    fallbackFired,
    kinds: callMetas.map((m) => m.kind),
    empty200Logged: callMetas.reduce((n, m) => n + m.empty200Logged, 0),
  }
  roundRows.push(row)
  log(
    `round ${category} verdict=${row.verdict} pick=${row.pick ?? '-'} conf=${row.confidence.toFixed(3)} ${row.latencyMs}ms cost=${usd(row.costUsd)} source=${row.source} ban=${row.parserBanHit ?? '-'} extra=${row.eyeExtra.join(',') || '-'}`,
  )
  log(`--- rationale (${category}) ---\n${row.rationale}\n---`)
}

const upCount = roundRows.filter((r) => r.verdict === 'up').length
const downCount = roundRows.filter((r) => r.verdict === 'down').length
const fallbackCount = roundRows.filter((r) => r.fallbackFired).length
const leakCount = roundRows.filter((r) => r.parserBanHit || r.eyeExtra.length > 0).length
const biased = upCount === 12 || downCount === 12

log(`verdict distribution: ${upCount} up / ${downCount} down biased=${biased}`)
log(`fallback fired: ${fallbackCount}/12  market-language leak (parser or extra): ${leakCount}/12`)

// --- 3. Cache E2E from a second call site (live.ts) ---------------------------

type CacheCheck = {
  ok: boolean
  detail: string
  firstIching: unknown
  secondIching: unknown
  rationaleMatch: boolean
}

let cacheCheck: CacheCheck = {
  ok: false,
  detail: 'not run',
  firstIching: null,
  secondIching: null,
  rationaleMatch: false,
}

if (!tableWait.ok) {
  cacheCheck = {
    ok: false,
    detail: `table missing: ${tableWait.message}`,
    firstIching: null,
    secondIching: null,
    rationaleMatch: false,
  }
} else {
  const sample = roundRows[0]!
  const event = CHIP_EVENTS[sample.category]
  const { readLeagueDivinationLive } = await import('../lib/oracle/league-divination/live')
  const second = await readLeagueDivinationLive({
    proposition: event.proposition,
    propositionType: event.propositionType,
    category: sample.category,
    subjectName: event.subjectName,
    firstViewedAt: FIRST_VIEW,
    roundId: sample.roundId,
  })
  const { data, error } = await supabaseAdmin
    .from('oracle_league_divination_cache')
    .select('round_id, first_viewed_at, result')
    .eq('round_id', sample.roundId)
    .maybeSingle()
  const stored = (data?.result ?? null) as typeof second | null
  const firstAdapter = await readLeagueDivination(
    {
      proposition: event.proposition,
      propositionType: event.propositionType,
      category: sample.category,
      subjectName: event.subjectName,
      firstViewedAt: FIRST_VIEW,
      roundId: sample.roundId,
    },
    { cache: supabaseCache },
  )

  const sameRationale =
    firstAdapter.rationale === second.rationale && stored != null && stored.rationale === second.rationale
  const sameDraw =
    JSON.stringify(firstAdapter.systems) === JSON.stringify(second.systems) &&
    stored != null &&
    JSON.stringify(stored.systems) === JSON.stringify(second.systems)
  const sameVerdict = firstAdapter.verdict === second.verdict && stored?.verdict === second.verdict

  cacheCheck = {
    ok: Boolean(sameRationale && sameDraw && sameVerdict && !error),
    detail: error
      ? `db error: ${error.message}`
      : `sameRationale=${sameRationale} sameDraw=${sameDraw} sameVerdict=${sameVerdict} stored=${Boolean(stored)}`,
    firstIching: firstAdapter.systems.find((s) => s.id === 'iching')?.chart ?? null,
    secondIching: second.systems.find((s) => s.id === 'iching')?.chart ?? null,
    rationaleMatch: sameRationale,
  }
  log(`cache e2e (${sample.roundId}): ok=${cacheCheck.ok} ${cacheCheck.detail}`)
}

// --- Report --------------------------------------------------------------------

const replacementLine = gatePass && clears12s
  ? `${LEAGUE_READER_DISPLAY_NAME} passed ${gateParsed}/${GATE_N} and clears the 12s timeout (mean ${Math.round(gateMeanMs)}ms, worst ${Math.round(gateWorstMs)}ms).`
  : gatePass && !clears12s
    ? `${LEAGUE_READER_DISPLAY_NAME} parsed ${gateParsed}/${GATE_N} but does **not** clear 12s (mean ${Math.round(gateMeanMs)}ms, worst ${Math.round(gateWorstMs)}ms, timeouts ${gateTimeout}/20). Timeout not raised. Next candidate: **${REPLACEMENT.brand} ${REPLACEMENT.displayName}** (\`${REPLACEMENT.platformId}\`). ${REPLACEMENT.why}`
    : `${LEAGUE_READER_DISPLAY_NAME} failed ${gateParsed}/${GATE_N} (mean ${Math.round(gateMeanMs)}ms, worst ${Math.round(gateWorstMs)}ms, clears12s=${clears12s}). Next candidate: **${REPLACEMENT.brand} ${REPLACEMENT.displayName}** (\`${REPLACEMENT.platformId}\`). ${REPLACEMENT.why}`

const md: string[] = [
  '# League divination live verify',
  '',
  `- Run: ${RUN_STAMP}`,
  `- Reader: ${LEAGUE_READER_BRAND} / ${LEAGUE_READER_DISPLAY_NAME} (\`${LEAGUE_READER_PLATFORM_ID}\`)`,
  `- Timeout: ${LEAGUE_READER_TIMEOUT_MS}ms, max tokens: ${LEAGUE_READER_MAX_COMPLETION_TOKENS}`,
  `- Gate payload: cycles all 12 chips (run i → chip[(i-1)%12]), not a single stocks pack.`,
  '',
  '## 1. Sequential 20× gate',
  '',
  `| parsed | pass (≥19/20) | mean (1st) | worst (1st) | clears 12s | empty-200 | timeout |`,
  `| ---: | --- | ---: | ---: | --- | ---: | ---: |`,
  `| ${gateParsed}/${GATE_N} | ${gatePass ? 'yes' : 'NO'} | ${Math.round(gateMeanMs)}ms | ${Math.round(gateWorstMs)}ms | ${clears12s ? 'yes' : 'NO'} | ${gateEmpty200}/${GATE_N} | ${gateTimeout}/${GATE_N} |`,
  '',
  replacementLine,
  '',
  '## 2. Twelve category rounds',
  '',
  '| category | verdict | pick | conf | latency | cost | source | fallback | leak |',
  '| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |',
]
for (const r of roundRows) {
  const leak = r.parserBanHit ?? (r.eyeExtra.length ? r.eyeExtra.join(',') : '-')
  md.push(
    `| ${r.category} | ${r.verdict} | ${r.pick ?? '-'} | ${r.confidence.toFixed(3)} | ${r.latencyMs}ms | ${usd(r.costUsd)} | ${r.source} | ${r.fallbackFired ? 'yes' : 'no'} | ${leak} |`,
  )
}
md.push('')
md.push(`Verdict distribution: **${upCount} up / ${downCount} down**.${biased ? ' 12-one-way — ballot looks biased.' : ' Not a 12-up or 12-down sweep.'}`)
md.push('')
md.push(`Reader vs fallback: **${12 - fallbackCount} reader / ${fallbackCount} fallback**.`)
md.push('')
md.push(`Fallback sentence fired: **${fallbackCount}/12**. Market-language leak past parser (ban list or extra eye words): **${leakCount}/12**.`)
md.push('')
const sampleRounds = roundRows.filter((r) => !r.fallbackFired).slice(0, 3)
const rationaleSamples = sampleRounds.length === 3 ? sampleRounds : roundRows.slice(0, 3)
md.push('### Three full rationales')
md.push('')
for (const r of rationaleSamples) {
  md.push(`#### ${r.category} (${r.source})`)
  md.push('')
  md.push('```')
  md.push(r.rationale)
  md.push('```')
  md.push('')
}
md.push('### All rationales')
md.push('')
for (const r of roundRows) {
  md.push(`#### ${r.category}`)
  md.push('')
  md.push('```')
  md.push(r.rationale)
  md.push('```')
  md.push('')
}
md.push('## 3. Cache E2E')
md.push('')
md.push(`- Table: ${tableWait.ok ? 'reachable' : 'MISSING'} (${tableWait.message})`)
md.push(`- Second call site: \`readLeagueDivinationLive\` vs first \`readLeagueDivination\` + raw row`)
md.push(`- Result: **${cacheCheck.ok ? 'identical stored row' : 'FAILED'}** — ${cacheCheck.detail}`)
md.push('')

const hold = runHoldCensus()
const holdRates = holdCensusRates(hold)
md.push('## 4. Hold → 결번 census')
md.push('')
md.push(`n=${hold.n} (varied firstViewIso + all 12 chips). Hold is 결번 (말을 아낌); weight leaves the denom.`)
md.push('')
md.push('| | count | share |')
md.push('| --- | ---: | ---: |')
md.push(`| 타로 hold → 결번 | ${hold.tarotHold} | ${holdRates.tarotHoldPct}% |`)
md.push(`| 룬 hold → 결번 | ${hold.runeHold} | ${holdRates.runeHoldPct}% |`)
md.push(`| 택일 hold → 결번 | ${hold.taeilHold} | ${holdRates.taeilHoldPct}% |`)
md.push(`| systems voted 4 / 3 / 2 / 1 | ${hold.voted4} / ${hold.voted3} / ${hold.voted2} / ${hold.voted1} | ${holdRates.voted4Pct}% / ${holdRates.voted3Pct}% / ${holdRates.voted2Pct}% / ${holdRates.voted1Pct}% |`)
md.push(`| 육효 votes alone | ${hold.ichingAlone} | ${holdRates.ichingAlonePct}% |`)
md.push(`| DRAW split (육효 vs 타로+룬) | ${hold.drawSplit} | ${holdRates.drawSplitPct}% |`)
md.push(`| 택일 casts when DRAW splits | ${hold.taeilCasts} | ${holdRates.taeilCastsGivenDrawSplitPct}% of splits (${holdRates.taeilCastsPct}% of all rounds) |`)
md.push(`| remaining voters unanimous | ${hold.allVotersAgree} | ${holdRates.allVotersAgreePct}% |`)
md.push(`| all four voted and agree | ${hold.fourVotedAndAgree} | ${holdRates.fourVotedAndAgreePct}% |`)
md.push(`| confidence 1.000 | ${hold.confidence1} | ${holdRates.confidence1Pct}% (of which 육효-alone ${hold.confidence1ByVoted[1]}) |`)
md.push(`| up / down | ${hold.up} / ${hold.down} | — |`)
md.push('')
md.push(
  '1.000 is remaining-voter unanimity. 육효-alone is genuine (one ballot) and still scores 1.000. The old 33.5% four-identical shape is gone — a 결번 seat no longer wears 육효\'s hat.',
)
md.push('')

writeFileSync(OUT_MD, md.join('\n'))
writeFileSync(
  OUT_JSON,
  JSON.stringify(
    {
      runStamp: RUN_STAMP,
      gate: {
        parsed: gateParsed,
        total: GATE_N,
        pass: gatePass,
        meanLatencyMs: gateMeanMs,
        worstLatencyMs: gateWorstMs,
        clears12s,
        empties: gateEmpty200,
        timeoutTrials: gateTimeout,
        cyclesChips: true,
        failSample,
        rows: gateRows.map((r) => ({ ...r, sample: r.sample ? r.sample.slice(0, 400) : null })),
      },
      replacement: gatePass && clears12s ? null : REPLACEMENT,
      rounds: roundRows,
      distribution: { up: upCount, down: downCount, biased },
      fallbackFired: fallbackCount,
      marketLeak: leakCount,
      cache: { table: tableWait, ...cacheCheck },
      holdCensus: { ...hold, rates: holdRates },
    },
    null,
    2,
  ),
)
log(`wrote ${OUT_MD}`)
if (!gatePass || !clears12s) log(`REPLACEMENT: ${REPLACEMENT.brand} ${REPLACEMENT.displayName} (${REPLACEMENT.platformId})`)
process.exitCode = gatePass && clears12s && cacheCheck.ok ? 0 : 1
