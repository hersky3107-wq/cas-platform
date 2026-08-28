/**
 * LIVE PROBE of the four slow-public-data sources for packet v2 (C).
 * Read-only HTTP; no DB, no AI. Prints per-source: URL tried, HTTP status,
 * and a parsed sample — so an unreliable source is caught BEFORE the module
 * is built around it.
 *
 * Run: npx tsx scripts/probe-slow-data-sources.ts
 */

const UA = 'cas-platform-league-research/1.0 (contact: admin@cas-platform.example)'

function utcDay(offset: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - offset)
  return d
}

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function get(url: string, extraHeaders: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA, ...extraHeaders } })
    const text = await res.text()
    return { status: res.status, text }
  } finally {
    clearTimeout(timer)
  }
}

async function probeFinra() {
  console.log('\n===== FINRA daily short-sale volume =====')
  for (let back = 0; back < 8; back++) {
    const d = utcDay(back)
    const dow = d.getUTCDay()
    if (dow === 0 || dow === 6) continue
    const url = `https://cdn.finra.org/equity/regsho/daily/CNMSshvol${yyyymmdd(d)}.txt`
    try {
      const r = await get(url)
      console.log(`${url} -> HTTP ${r.status} (${r.text.length} bytes)`)
      if (r.status === 200 && r.text.includes('|')) {
        const lines = r.text.split('\n')
        console.log(`header: ${lines[0]}`)
        const aapl = lines.find((l) => l.includes('|AAPL|'))
        console.log(`AAPL row: ${aapl ?? 'NOT FOUND'}`)
        return
      }
    } catch (e) {
      console.log(`${url} -> FETCH ERROR ${e instanceof Error ? e.message : e}`)
    }
  }
  console.log('FINRA: no file found in the last 8 days — UNRELIABLE')
}

async function probeCboe() {
  console.log('\n===== CBOE daily put/call =====')
  for (let back = 0; back < 8; back++) {
    const d = utcDay(back)
    const dow = d.getUTCDay()
    if (dow === 0 || dow === 6) continue
    const day = isoDate(d)
    const candidates = [
      `https://www.cboe.com/us/options/market_statistics/daily/?dt=${day}`,
      `https://cdn.cboe.com/data/us/options/market_statistics/daily/${day}_daily_options_volume.csv`,
      `https://markets.cboe.com/us/options/market_statistics/daily/?dt=${day}`,
    ]
    for (const url of candidates) {
      try {
        const r = await get(url)
        const hit = /PUT\/CALL RATIO/i.test(r.text) || /put_call/i.test(r.text)
        console.log(`${url} -> HTTP ${r.status} (${r.text.length} bytes) putcall-marker=${hit}`)
        if (r.status === 200 && hit) {
          const m = r.text.match(/TOTAL PUT\/CALL RATIO[^0-9]*([0-9.]+)/i)
          console.log(`TOTAL PUT/CALL RATIO parse: ${m ? m[1] : 'marker present but ratio regex missed'}`)
          const snippet = r.text.slice(Math.max(0, r.text.search(/PUT\/CALL/i) - 200), r.text.search(/PUT\/CALL/i) + 300)
          console.log(`context: ${snippet.replace(/\s+/g, ' ').slice(0, 400)}`)
          return
        }
      } catch (e) {
        console.log(`${url} -> FETCH ERROR ${e instanceof Error ? e.message : e}`)
      }
    }
  }
  console.log('CBOE: no parseable put/call found — UNRELIABLE (will report)')
}

async function probeFarside() {
  console.log('\n===== Farside BTC spot ETF flows =====')
  for (const url of ['https://farside.co.uk/btc/', 'https://farside.co.uk/?p=997']) {
    try {
      const r = await get(url, { Accept: 'text/html' })
      console.log(`${url} -> HTTP ${r.status} (${r.text.length} bytes)`)
      if (r.status === 200) {
        const hasTable = /<table/i.test(r.text) && /Total/i.test(r.text)
        console.log(`table+Total markers: ${hasTable}`)
        const rows = r.text.match(/<tr[\s\S]*?<\/tr>/gi) ?? []
        console.log(`tr count: ${rows.length}`)
        const dataRow = rows.reverse().find((row) => /\d{1,2} \w{3} \d{4}/.test(row))
        if (dataRow) console.log(`sample row: ${dataRow.replace(/<[^>]+>/g, '|').replace(/\s+/g, ' ').slice(0, 300)}`)
        if (hasTable) return
      }
    } catch (e) {
      console.log(`${url} -> FETCH ERROR ${e instanceof Error ? e.message : e}`)
    }
  }
  console.log('Farside: blocked or no table — UNRELIABLE (will report)')
}

async function probeEdgar() {
  console.log('\n===== SEC EDGAR Form 4 (AAPL) =====')
  try {
    const tickers = await get('https://www.sec.gov/files/company_tickers.json')
    console.log(`company_tickers.json -> HTTP ${tickers.status} (${tickers.text.length} bytes)`)
    if (tickers.status !== 200) return console.log('EDGAR ticker map failed — UNRELIABLE')
    const map = JSON.parse(tickers.text) as Record<string, { cik_str: number; ticker: string }>
    const aapl = Object.values(map).find((r) => r.ticker === 'AAPL')
    console.log(`AAPL CIK: ${aapl?.cik_str}`)
    if (!aapl) return

    const cik10 = String(aapl.cik_str).padStart(10, '0')
    const subs = await get(`https://data.sec.gov/submissions/CIK${cik10}.json`)
    console.log(`submissions -> HTTP ${subs.status} (${subs.text.length} bytes)`)
    if (subs.status !== 200) return console.log('EDGAR submissions failed — UNRELIABLE')
    const j = JSON.parse(subs.text)
    const recent = j?.filings?.recent
    const forms: string[] = recent?.form ?? []
    const accession: string[] = recent?.accessionNumber ?? []
    const primaryDoc: string[] = recent?.primaryDocument ?? []
    const filingDate: string[] = recent?.filingDate ?? []
    const idx = forms.findIndex((f: string) => f === '4')
    console.log(`total recent filings: ${forms.length}; first Form 4 idx: ${idx}`)
    if (idx < 0) return console.log('no Form 4 in recent window')
    console.log(`form4: ${filingDate[idx]} acc=${accession[idx]} primaryDoc=${primaryDoc[idx]}`)

    const accNoDash = accession[idx].replace(/-/g, '')
    const rawName = primaryDoc[idx].split('/').pop()
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${aapl.cik_str}/${accNoDash}/${rawName}`
    const doc = await get(docUrl)
    console.log(`${docUrl} -> HTTP ${doc.status} (${doc.text.length} bytes)`)
    const isXml = doc.text.trimStart().startsWith('<?xml') || doc.text.includes('<ownershipDocument')
    console.log(`looks like ownership XML: ${isXml}`)
    if (isXml) {
      const codes = doc.text.match(/<transactionCode>(\w)<\/transactionCode>/g)
      const shares = doc.text.match(/<transactionShares>[\s\S]*?<value>([\d.]+)<\/value>/)
      console.log(`transactionCode matches: ${codes?.join(',') ?? 'none'}; first shares: ${shares?.[1] ?? 'none'}`)
    } else {
      console.log(`doc head: ${doc.text.slice(0, 200).replace(/\s+/g, ' ')}`)
    }
  } catch (e) {
    console.log(`EDGAR probe error: ${e instanceof Error ? e.message : e}`)
  }
}

async function main() {
  await probeFinra()
  await probeCboe()
  await probeFarside()
  await probeEdgar()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
