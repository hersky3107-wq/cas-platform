import 'server-only'

import { fetchFredSeries } from './metals-data'
import {
  CFTC_AUD_CODE,
  CFTC_DXY_CODE,
  CFTC_EUR_CODE,
  CFTC_GBP_CODE,
  CFTC_JPY_CODE,
  cotFromLegacyText,
  cotFromTffText,
} from './fx-parse'
import type { CotPositioning, FredObs, FxRateDiff, SlowDataSnapshot } from './closed-book-packet'

/**
 * Free FX packet feeds. Zero API-key cost.
 * FRED rates/CPI/DXY + CFTC TFF (FinFutWk.txt) leveraged-funds, with
 * legacy deafut.txt non-commercial as fallback. KRW and all crosses have
 * no CME futures COT — labeled honestly; crosses may cite component-leg
 * TFF as context, never as a cross COT.
 * Per-pair isolation: each pair gets ONLY its two countries' series.
 */

const FETCH_TIMEOUT_MS = 45_000
const UA = 'cas-platform-league-research/1.0 (contact: admin@cas-platform.example)'
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const CFTC_TFF_URL = 'https://www.cftc.gov/dea/newcot/FinFutWk.txt'
const CFTC_LEGACY_URL = 'https://www.cftc.gov/dea/newcot/deafut.txt'

const FX_CATEGORIES = new Set(['fx'])

export type FxFamily =
  | 'eurusd'
  | 'usdkrw'
  | 'usdjpy'
  | 'gbpusd'
  | 'usdcnh'
  | 'audusd'
  | 'jpykrw'
  | 'eurjpy'
  | 'gbpjpy'

type Fail = { unavailable: string }
type CftcFxFile = { kind: 'tff' | 'legacy'; text: string }

async function getText(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string } | { error: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, ...headers },
    })
    const text = await res.text()
    return { status: res.status, text }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { error: msg.toLowerCase().includes('abort') ? `timeout after ${FETCH_TIMEOUT_MS}ms` : msg }
  } finally {
    clearTimeout(timer)
  }
}

const dayMemo = new Map<string, unknown>()
function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}
async function memoDaily<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const k = `${key}|${utcDay()}`
  const hit = dayMemo.get(k)
  if (hit !== undefined) return hit as T
  const value = await fn()
  dayMemo.set(k, value)
  return value
}

function instrumentKey(instrument?: string): string {
  return instrument?.trim().toUpperCase() ?? ''
}

export function classifyFxInstrument(instrument?: string): FxFamily | null {
  const u = instrumentKey(instrument)
  if (!u) return null
  if (u === 'EUR/USD' || u === 'EURUSD') return 'eurusd'
  if (u === 'USD/KRW' || u === 'USDKRW') return 'usdkrw'
  if (u === 'USD/JPY' || u === 'USDJPY') return 'usdjpy'
  if (u === 'GBP/USD' || u === 'GBPUSD') return 'gbpusd'
  if (u === 'USD/CNH' || u === 'USDCNH') return 'usdcnh'
  if (u === 'AUD/USD' || u === 'AUDUSD') return 'audusd'
  if (u === 'JPY/KRW' || u === 'JPYKRW') return 'jpykrw'
  if (u === 'EUR/JPY' || u === 'EURJPY') return 'eurjpy'
  if (u === 'GBP/JPY' || u === 'GBPJPY') return 'gbpjpy'
  return null
}

/** US-listed currency/country ETFs whose FINRA short % belongs on this pair. */
export function fxFinraTickers(instrument?: string): string[] {
  switch (classifyFxInstrument(instrument)) {
    case 'eurusd':
      return ['UUP', 'FXE']
    case 'usdkrw':
      return ['UUP', 'EWY']
    case 'usdjpy':
      return ['UUP', 'FXY']
    case 'gbpusd':
      return ['UUP', 'FXB']
    case 'usdcnh':
      return ['UUP']
    case 'audusd':
      return ['UUP']
    case 'jpykrw':
      return ['EWY', 'EWJ']
    case 'eurjpy':
      return ['FXE', 'FXY']
    case 'gbpjpy':
      return ['FXB', 'FXY']
    default:
      return []
  }
}

function isUsdPair(family: FxFamily): boolean {
  return (
    family === 'eurusd' ||
    family === 'usdkrw' ||
    family === 'usdjpy' ||
    family === 'gbpusd' ||
    family === 'usdcnh' ||
    family === 'audusd'
  )
}

async function fetchCftcFxFile(): Promise<CftcFxFile | Fail> {
  return memoDaily('cftc-fx', async () => {
    const attempts: Array<{ url: string; kind: 'tff' | 'legacy' }> = [
      { url: CFTC_TFF_URL, kind: 'tff' },
      { url: CFTC_LEGACY_URL, kind: 'legacy' },
    ]
    const errors: string[] = []
    for (const { url, kind } of attempts) {
      const extras: Array<Record<string, string>> = [{}, { 'User-Agent': BROWSER_UA }]
      for (const extra of extras) {
        const res = await getText(url, extra)
        if ('error' in res) {
          errors.push(`${kind}: ${res.error}`)
          continue
        }
        if (res.status !== 200) {
          errors.push(`${kind}: HTTP ${res.status}`)
          continue
        }
        if (/^\s*</.test(res.text) || res.text.length < 200) {
          errors.push(`${kind}: empty/HTML`)
          continue
        }
        return { kind, text: res.text }
      }
    }
    return { unavailable: `CFTC FX COT (FinFutWk.txt / deafut.txt): ${errors.join('; ')}` }
  })
}

function cotOrFail(file: CftcFxFile | Fail, contractCode: string): CotPositioning {
  if ('unavailable' in file) return file
  return file.kind === 'tff' ? cotFromTffText(file.text, contractCode) : cotFromLegacyText(file.text, contractCode)
}

function fredValue(obs: FredObs | null): { date: string; value: number } | null {
  if (!obs || 'unavailable' in obs) return null
  return obs
}

function rateDiff(
  leftLabel: string,
  rightLabel: string,
  left: FredObs | null,
  right: FredObs | null,
): FxRateDiff | null {
  const a = fredValue(left)
  const b = fredValue(right)
  if (!a || !b) return null
  return {
    leftLabel,
    rightLabel,
    leftValue: a.value,
    rightValue: b.value,
    leftDate: a.date,
    rightDate: b.date,
    diffPp: a.value - b.value,
  }
}

export async function fetchFxSlowFields(
  category: string,
  instrument?: string,
): Promise<{
  fedFunds?: SlowDataSnapshot['fedFunds']
  ust2y?: SlowDataSnapshot['ust2y']
  ust10y?: SlowDataSnapshot['ust10y']
  ust10y2y?: SlowDataSnapshot['ust10y2y']
  tips10yFred?: SlowDataSnapshot['tips10yFred']
  dxyBroad?: SlowDataSnapshot['dxyBroad']
  dxyAfe?: SlowDataSnapshot['dxyAfe']
  dxyEme?: SlowDataSnapshot['dxyEme']
  ecbDeposit?: SlowDataSnapshot['ecbDeposit']
  ecbRefi?: SlowDataSnapshot['ecbRefi']
  germanBund10y?: SlowDataSnapshot['germanBund10y']
  euroHicp?: SlowDataSnapshot['euroHicp']
  bojPolicy?: SlowDataSnapshot['bojPolicy']
  jgb10y?: SlowDataSnapshot['jgb10y']
  tibor3m?: SlowDataSnapshot['tibor3m']
  bokRate?: SlowDataSnapshot['bokRate']
  ktb10y?: SlowDataSnapshot['ktb10y']
  krwCd3m?: SlowDataSnapshot['krwCd3m']
  krwCpi?: SlowDataSnapshot['krwCpi']
  sonia?: SlowDataSnapshot['sonia']
  gilt10y?: SlowDataSnapshot['gilt10y']
  policyRateDiff?: SlowDataSnapshot['policyRateDiff']
  yield10yDiff?: SlowDataSnapshot['yield10yDiff']
  cotEur?: SlowDataSnapshot['cotEur']
  cotJpy?: SlowDataSnapshot['cotJpy']
  cotGbp?: SlowDataSnapshot['cotGbp']
  cotAud?: SlowDataSnapshot['cotAud']
  cotDxy?: SlowDataSnapshot['cotDxy']
  fxCotGap?: SlowDataSnapshot['fxCotGap']
} | null> {
  if (!FX_CATEGORIES.has(category)) return null
  const family = classifyFxInstrument(instrument)
  if (!family) return {}

  const wantsUs = isUsdPair(family)
  const wantsEur = family === 'eurusd' || family === 'eurjpy'
  const wantsJpy = family === 'usdjpy' || family === 'jpykrw' || family === 'eurjpy' || family === 'gbpjpy'
  const wantsKrw = family === 'usdkrw' || family === 'jpykrw'
  const wantsGbp = family === 'gbpusd' || family === 'gbpjpy'
  const wantsAud = family === 'audusd'
  const wantsEme = family === 'usdkrw' || family === 'usdcnh'
  const wantsCotEur = family === 'eurusd' || family === 'eurjpy'
  const wantsCotJpy = family === 'usdjpy' || family === 'jpykrw' || family === 'eurjpy' || family === 'gbpjpy'
  const wantsCotGbp = family === 'gbpusd' || family === 'gbpjpy'
  const wantsCotAud = family === 'audusd'
  const wantsCotDxy = wantsUs
  const wantsAnyCot = wantsCotEur || wantsCotJpy || wantsCotGbp || wantsCotAud || wantsCotDxy

  const [
    cftcFile,
    fedFunds,
    ust2y,
    ust10y,
    ust10y2y,
    tips10yFred,
    dxyBroad,
    dxyAfe,
    dxyEme,
    ecbDeposit,
    ecbRefi,
    germanBund10y,
    euroHicp,
    bojPolicy,
    jgb10y,
    tibor3m,
    bokRate,
    ktb10y,
    krwCd3m,
    krwCpi,
    sonia,
    gilt10y,
  ] = await Promise.all([
    wantsAnyCot ? fetchCftcFxFile() : Promise.resolve(null),
    wantsUs ? fetchFredSeries('DFF') : Promise.resolve(null),
    wantsUs ? fetchFredSeries('DGS2') : Promise.resolve(null),
    wantsUs ? fetchFredSeries('DGS10') : Promise.resolve(null),
    wantsUs ? fetchFredSeries('T10Y2Y') : Promise.resolve(null),
    wantsUs ? fetchFredSeries('DFII10') : Promise.resolve(null),
    wantsUs ? fetchFredSeries('DTWEXBGS') : Promise.resolve(null),
    wantsUs ? fetchFredSeries('DTWEXAFEGS') : Promise.resolve(null),
    wantsEme ? fetchFredSeries('DTWEXEMEGS') : Promise.resolve(null),
    wantsEur ? fetchFredSeries('ECBDFR') : Promise.resolve(null),
    wantsEur ? fetchFredSeries('ECBMRRFR') : Promise.resolve(null),
    wantsEur ? fetchFredSeries('IRLTLT01DEM156N') : Promise.resolve(null),
    wantsEur ? fetchFredSeries('CP0000EZ19M086NEST') : Promise.resolve(null),
    wantsJpy ? fetchFredSeries('IRSTCB01JPM156N') : Promise.resolve(null),
    wantsJpy ? fetchFredSeries('IRLTLT01JPM156N') : Promise.resolve(null),
    wantsJpy ? fetchFredSeries('IR3TIB01JPM156N') : Promise.resolve(null),
    wantsKrw ? fetchFredSeries('INTDSRKRM193N') : Promise.resolve(null),
    wantsKrw ? fetchFredSeries('IRLTLT01KRM156N') : Promise.resolve(null),
    wantsKrw ? fetchFredSeries('IR3TIB01KRM156N') : Promise.resolve(null),
    wantsKrw ? fetchFredSeries('CPALTT01KRM657N') : Promise.resolve(null),
    wantsGbp ? fetchFredSeries('IUDSOIA') : Promise.resolve(null),
    wantsGbp ? fetchFredSeries('IRLTLT01GBM156N') : Promise.resolve(null),
  ])

  const cotFile = cftcFile ?? { unavailable: 'CFTC FX COT not requested' }

  let policyRateDiff: FxRateDiff | null = null
  let yield10yDiff: FxRateDiff | null = null
  if (family === 'eurusd') {
    policyRateDiff = rateDiff('Fed funds', 'ECB deposit', fedFunds, ecbDeposit)
    yield10yDiff = rateDiff('US 10Y', 'German bund 10Y', ust10y, germanBund10y)
  } else if (family === 'usdjpy') {
    policyRateDiff = rateDiff('Fed funds', 'BOJ policy', fedFunds, bojPolicy)
    yield10yDiff = rateDiff('US 10Y', 'JGB 10Y', ust10y, jgb10y)
  } else if (family === 'usdkrw') {
    policyRateDiff = rateDiff('Fed funds', 'BOK policy', fedFunds, bokRate)
    yield10yDiff = rateDiff('US 10Y', 'KTB 10Y', ust10y, ktb10y)
  } else if (family === 'gbpusd') {
    policyRateDiff = rateDiff('Fed funds', 'SONIA', fedFunds, sonia)
    yield10yDiff = rateDiff('US 10Y', 'Gilt 10Y', ust10y, gilt10y)
  } else if (family === 'usdcnh' || family === 'audusd') {
    policyRateDiff = null
    yield10yDiff = null
  } else if (family === 'jpykrw') {
    policyRateDiff = rateDiff('BOK policy', 'BOJ policy', bokRate, bojPolicy)
    yield10yDiff = rateDiff('KTB 10Y', 'JGB 10Y', ktb10y, jgb10y)
  } else if (family === 'eurjpy') {
    policyRateDiff = rateDiff('ECB deposit', 'BOJ policy', ecbDeposit, bojPolicy)
    yield10yDiff = rateDiff('German bund 10Y', 'JGB 10Y', germanBund10y, jgb10y)
  } else if (family === 'gbpjpy') {
    policyRateDiff = rateDiff('SONIA', 'BOJ policy', sonia, bojPolicy)
    yield10yDiff = rateDiff('Gilt 10Y', 'JGB 10Y', gilt10y, jgb10y)
  }

  let fxCotGap: { note: string } | undefined
  if (family === 'usdkrw') {
    fxCotGap = {
      note: 'CFTC KRW futures: none — CME does not list KRW (offshore NDF). No KRW COT. DXY TFF below is the USD-index contract, not KRW.',
    }
  } else if (family === 'usdcnh') {
    fxCotGap = {
      note: 'CFTC CNH futures: none in FinFutWk/deafut for this chip. No CNH COT. DXY TFF below is the USD-index contract, not CNH.',
    }
  } else if (family === 'jpykrw') {
    fxCotGap = {
      note: 'CFTC JPY/KRW cross: none. KRW has no CME futures. JPY TFF below is the JPY leg only, not a cross COT.',
    }
  } else if (family === 'eurjpy') {
    fxCotGap = {
      note: 'CFTC EUR/JPY cross: none. EUR and JPY TFF below are component legs, not a cross COT.',
    }
  } else if (family === 'gbpjpy') {
    fxCotGap = {
      note: 'CFTC GBP/JPY cross: none. GBP and JPY TFF below are component legs, not a cross COT.',
    }
  }

  return {
    ...(fedFunds ? { fedFunds } : {}),
    ...(ust2y ? { ust2y } : {}),
    ...(ust10y ? { ust10y } : {}),
    ...(ust10y2y ? { ust10y2y } : {}),
    ...(tips10yFred ? { tips10yFred } : {}),
    ...(dxyBroad ? { dxyBroad } : {}),
    ...(dxyAfe ? { dxyAfe } : {}),
    ...(dxyEme ? { dxyEme } : {}),
    ...(ecbDeposit ? { ecbDeposit } : {}),
    ...(ecbRefi ? { ecbRefi } : {}),
    ...(germanBund10y ? { germanBund10y } : {}),
    ...(euroHicp ? { euroHicp } : {}),
    ...(bojPolicy ? { bojPolicy } : {}),
    ...(jgb10y ? { jgb10y } : {}),
    ...(tibor3m ? { tibor3m } : {}),
    ...(bokRate ? { bokRate } : {}),
    ...(ktb10y ? { ktb10y } : {}),
    ...(krwCd3m ? { krwCd3m } : {}),
    ...(krwCpi ? { krwCpi } : {}),
    ...(sonia ? { sonia } : {}),
    ...(gilt10y ? { gilt10y } : {}),
    ...(policyRateDiff ? { policyRateDiff } : {}),
    ...(yield10yDiff ? { yield10yDiff } : {}),
    ...(wantsCotEur ? { cotEur: cotOrFail(cotFile, CFTC_EUR_CODE) } : {}),
    ...(wantsCotJpy ? { cotJpy: cotOrFail(cotFile, CFTC_JPY_CODE) } : {}),
    ...(wantsCotGbp ? { cotGbp: cotOrFail(cotFile, CFTC_GBP_CODE) } : {}),
    ...(wantsCotAud ? { cotAud: cotOrFail(cotFile, CFTC_AUD_CODE) } : {}),
    ...(wantsCotDxy ? { cotDxy: cotOrFail(cotFile, CFTC_DXY_CODE) } : {}),
    ...(fxCotGap ? { fxCotGap } : {}),
  }
}
