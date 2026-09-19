/**
 * Replay the two live parse misses and dump pack diffs vs the stocks gate pack.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/replay-league-misses.mts
 */
process.env.ORACLE_AI_MODE = 'live'

const FIRST_VIEW = '2026-09-19T08:52:00.000Z'
const RUN_STAMP = '2026-09-19T09-50-24-551Z'

const { callPlatformModel } = await import('../lib/ai/platform-providers')
const { computeLeagueDivination } = await import('../lib/oracle/league-divination/compute')
const { compactReaderPack } = await import('../lib/oracle/league-divination/compact-pack')
const { parseLeagueReaderRationale, rationaleLineCount, findMarketLanguage } = await import(
  '../lib/oracle/league-divination/parse-reader'
)
const { buildLeagueReaderSystemPrompt, buildLeagueReaderUserPrompt, LEAGUE_READER_STRICT_RETRY } =
  await import('../lib/oracle/league-divination/prompt')
const {
  LEAGUE_READER_PLATFORM_ID,
  LEAGUE_READER_MAX_COMPLETION_TOKENS,
  LEAGUE_READER_TIMEOUT_MS,
  LEAGUE_READER_EXTRA_REQUEST_PARAMS,
} = await import('../lib/oracle/league-divination/conventions')
const { isPlusVote } = await import('../lib/oracle/league-divination/yongshen')
const { runHoldCensus, holdCensusRates, HOLD_CENSUS_N } = await import(
  '../lib/oracle/league-divination/hold-census'
)

const CHIP = {
  stocks: { proposition: '삼성전자가 이번 구간에서 오른다', subjectName: '삼성전자', propositionType: 'binary' as const },
  gold_metals: { proposition: '금이 이번 구간에서 오른다', subjectName: 'Gold', propositionType: 'binary' as const },
  macro_econ: { proposition: '국내 경기가 이번 구간에서 살아난다', subjectName: '경기', propositionType: 'binary' as const },
}

function packOf(
  category: 'stocks' | 'gold_metals' | 'macro_econ',
  roundId: string,
) {
  const event = CHIP[category]
  const computed = computeLeagueDivination({
    roundId,
    firstViewIso: FIRST_VIEW,
    categoryId: category,
    axis: 'direction',
  })
  const pack = compactReaderPack(computed, {
    proposition: event.proposition,
    subjectName: event.subjectName,
  })
  return { computed, pack }
}

function summarize(label: string, computed: ReturnType<typeof computeLeagueDivination>, pack: ReturnType<typeof compactReaderPack>) {
  const votes = computed.votes
  return {
    label,
    category: pack.category,
    proposition: pack.proposition,
    codeVerdict: pack.codeVerdict,
    confidence: computed.aggregate.confidence,
    iching: `${pack.iching.primaryHangul}(${pack.iching.primary})→${pack.iching.resultingHangul} relative=${pack.iching.relative} phase=${pack.iching.yongshenMonthPhase}`,
    tarot: `${pack.tarot.outcomeKo} (${pack.tarot.outcome}) reversed=${pack.tarot.reversed}`,
    rune: `${pack.runes.futureKo} (${pack.runes.future}) reversed=${pack.runes.reversed}`,
    taeil: `${pack.taeil.dayHangul} stem=${pack.taeil.yongshenStemHangul}(${pack.taeil.yongshenElement})`,
    holds: {
      tarot: votes.tarot.abstained,
      runes: votes.runes.abstained,
      taeil: votes.taeil.abstained,
    },
    ballots: {
      iching: votes.iching.vote,
      tarot: votes.tarot.vote,
      runes: votes.runes.vote,
      taeil: votes.taeil.vote,
    },
  }
}

const gate = packOf('stocks', `live-verify-gate-${RUN_STAMP}`)
const gold = packOf('gold_metals', `live-verify-${RUN_STAMP}-gold_metals`)
const macro = packOf('macro_econ', `live-verify-${RUN_STAMP}-macro_econ`)

const gateSum = summarize('gate-stocks', gate.computed, gate.pack)
const goldSum = summarize('gold_metals', gold.computed, gold.pack)
const macroSum = summarize('macro_econ', macro.computed, macro.pack)

console.log('=== PACKS ===')
console.log(JSON.stringify({ gate: gateSum, gold: goldSum, macro: macroSum }, null, 2))

function packDiff(name: string, miss: typeof goldSum) {
  const keys = [
    ['category', gateSum.category, miss.category],
    ['proposition', gate.pack.proposition, name === 'gold' ? gold.pack.proposition : macro.pack.proposition],
    ['codeVerdict', gateSum.codeVerdict, miss.codeVerdict],
    ['iching', gateSum.iching, miss.iching],
    ['tarot', gateSum.tarot, miss.tarot],
    ['rune', gateSum.rune, miss.rune],
    ['taeil', gateSum.taeil, miss.taeil],
    ['holds', JSON.stringify(gateSum.holds), JSON.stringify(miss.holds)],
  ] as const
  return keys.filter((row) => row[1] !== row[2])
}

console.log('=== DIFF vs gate (gold) ===')
console.log(packDiff('gold', goldSum))
console.log('=== DIFF vs gate (macro) ===')
console.log(packDiff('macro', macroSum))

async function callOnce(pack: typeof gold.pack, strict: boolean) {
  const system = buildLeagueReaderSystemPrompt() + (strict ? LEAGUE_READER_STRICT_RETRY : '')
  const user = buildLeagueReaderUserPrompt(pack)
  const t0 = Date.now()
  const res = await callPlatformModel({
    id: LEAGUE_READER_PLATFORM_ID,
    systemPrompt: system,
    userPrompt: user,
    maxCompletionTokens: LEAGUE_READER_MAX_COMPLETION_TOKENS,
    extraRequestParams: { ...LEAGUE_READER_EXTRA_REQUEST_PARAMS },
    timeoutMs: LEAGUE_READER_TIMEOUT_MS,
  })
  const text = res.text ?? ''
  const parsed = parseLeagueReaderRationale(text, pack.codeVerdict)
  return {
    ms: Date.now() - t0,
    lines: rationaleLineCount(text),
    chars: [...text].length,
    ban: findMarketLanguage(text),
    plus: isPlusVote(pack.codeVerdict),
    parsed,
    text,
    error: res.error ?? null,
  }
}

async function replay(label: string, pack: typeof gold.pack) {
  console.log(`\n=== REPLAY ${label} verdict=${pack.codeVerdict} ===`)
  const first = await callOnce(pack, false)
  console.log(`attempt 1 ${first.ms}ms lines=${first.lines} chars=${first.chars} ban=${first.ban} parse=${JSON.stringify(first.parsed)}`)
  console.log('---RAW 1---')
  console.log(first.text)
  console.log('---END 1---')
  if (first.parsed.ok) return
  const second = await callOnce(pack, true)
  console.log(`attempt 2 ${second.ms}ms lines=${second.lines} chars=${second.chars} ban=${second.ban} parse=${JSON.stringify(second.parsed)}`)
  console.log('---RAW 2---')
  console.log(second.text)
  console.log('---END 2---')
}

await replay('gold_metals', gold.pack)
await replay('macro_econ', macro.pack)

// Hold-collapse census (≥500 rounds, varied clocks). No LLM. Collapse rule unchanged.
const census = runHoldCensus(HOLD_CENSUS_N)
console.log('\n=== HOLD CENSUS ===')
console.log(JSON.stringify({ ...census, rates: holdCensusRates(census) }, null, 2))
