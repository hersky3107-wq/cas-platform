/**
 * Pure index/ETF packet helpers. No fetches — unit tests never import
 * `server-only`. Index futures live in CFTC TFF (`FinFutWk.txt`), same
 * parser as FX (`cotFromTffText`), NOT disaggregated `f_disagg.txt`.
 *
 * Contract codes from FinFutWk (probed 2026-09-15):
 *   ES 13874A, NQ 209742, YM 124603, Nikkei yen 240743, VIX 1170E1.
 */

export {
  CFTC_LEGACY_SOURCE,
  CFTC_TFF_SOURCE,
  cotFromLegacyText,
  cotFromTffText,
} from './fx-parse'

export const CFTC_ES_CODE = '13874A'
export const CFTC_NQ_CODE = '209742'
export const CFTC_YM_CODE = '124603'
export const CFTC_NIKKEI_YEN_CODE = '240743'
export const CFTC_VIX_CODE = '1170E1'

export type IndexEtfFamily =
  | 'spy'
  | 'qqq'
  | 'dia'
  | 'ewj'
  | 'ewy'
  | 'fez'
  | 'ewt'
  | 'tqqq'
  | 'sqqq'
  | 'soxl'
  | 'upro'
  | 'spxu'

export type IndexEtfFieldPlan = {
  family: IndexEtfFamily
  /** FRED VIXCLS — every chip. */
  vixcls: true
  /** FRED cash-index print; null = country ETF with no matching series. */
  fredIndex: 'SP500' | 'NASDAQCOM' | 'DJIA' | 'NIKKEI225' | null
  cotEs: boolean
  cotNq: boolean
  cotYm: boolean
  cotNikkei: boolean
  cotVix: true
  cotGapNote: string | null
  identityNote: string | null
}

function instrumentKey(instrument?: string): string {
  return instrument?.trim().toUpperCase() ?? ''
}

export function classifyIndexEtfInstrument(instrument?: string): IndexEtfFamily | null {
  switch (instrumentKey(instrument)) {
    case 'SPY':
      return 'spy'
    case 'QQQ':
      return 'qqq'
    case 'DIA':
      return 'dia'
    case 'EWJ':
      return 'ewj'
    case 'EWY':
      return 'ewy'
    case 'FEZ':
      return 'fez'
    case 'EWT':
      return 'ewt'
    case 'TQQQ':
      return 'tqqq'
    case 'SQQQ':
      return 'sqqq'
    case 'SOXL':
      return 'soxl'
    case 'UPRO':
      return 'upro'
    case 'SPXU':
      return 'spxu'
    default:
      return null
  }
}

/** Per-chip isolation: TQQQ gets NQ not ES; UPRO gets ES not NQ; SOXL gets neither. */
export function indexEtfFieldPlan(instrument?: string): IndexEtfFieldPlan | null {
  const family = classifyIndexEtfInstrument(instrument)
  if (!family) return null

  const base: Omit<IndexEtfFieldPlan, 'family' | 'fredIndex' | 'cotEs' | 'cotNq' | 'cotYm' | 'cotNikkei' | 'cotGapNote' | 'identityNote'> = {
    vixcls: true,
    cotVix: true,
  }

  switch (family) {
    case 'spy':
    case 'upro':
    case 'spxu':
      return {
        ...base,
        family,
        fredIndex: 'SP500',
        cotEs: true,
        cotNq: false,
        cotYm: false,
        cotNikkei: false,
        cotGapNote: null,
        identityNote: null,
      }
    case 'qqq':
    case 'tqqq':
    case 'sqqq':
      return {
        ...base,
        family,
        fredIndex: 'NASDAQCOM',
        cotEs: false,
        cotNq: true,
        cotYm: false,
        cotNikkei: false,
        cotGapNote: null,
        identityNote: null,
      }
    case 'dia':
      return {
        ...base,
        family,
        fredIndex: 'DJIA',
        cotEs: false,
        cotNq: false,
        cotYm: true,
        cotNikkei: false,
        cotGapNote: null,
        identityNote: null,
      }
    case 'ewj':
      return {
        ...base,
        family,
        fredIndex: 'NIKKEI225',
        cotEs: false,
        cotNq: false,
        cotYm: false,
        cotNikkei: true,
        cotGapNote: null,
        identityNote:
          'EWJ is iShares MSCI Japan (US-listed country ETF), not a Nikkei 225 cash index or 1321.T. FRED NIKKEI225 is a lagged cash print for context.',
      }
    case 'ewy':
      return {
        ...base,
        family,
        fredIndex: null,
        cotEs: false,
        cotNq: false,
        cotYm: false,
        cotNikkei: false,
        cotGapNote:
          'CFTC KOSPI/Korea: none in FinFutWk. EWY is a US-listed MSCI Korea ETF, not KOSPI 200 / KODEX 200. No Korea-index COT.',
        identityNote:
          'EWY is iShares MSCI Korea (US-listed country ETF), not a KOSPI cash index. No free KOSPI series on FRED.',
      }
    case 'fez':
      return {
        ...base,
        family,
        fredIndex: null,
        cotEs: false,
        cotNq: false,
        cotYm: false,
        cotNikkei: false,
        cotGapNote:
          'CFTC EURO STOXX 50: none in FinFutWk. FEZ is the US-listed SPDR EURO STOXX 50 ETF. No Euro Stoxx COT.',
        identityNote: 'FEZ is SPDR EURO STOXX 50 (US-listed ETF), not a cash Euro Stoxx index.',
      }
    case 'ewt':
      return {
        ...base,
        family,
        fredIndex: null,
        cotEs: false,
        cotNq: false,
        cotYm: false,
        cotNikkei: false,
        cotGapNote:
          'CFTC TAIEX/Taiwan: none in FinFutWk. EWT is a US-listed MSCI Taiwan ETF, not TAIEX cash. No Taiwan-index COT.',
        identityNote: 'EWT is iShares MSCI Taiwan (US-listed country ETF), not a TAIEX cash index.',
      }
    case 'soxl':
      return {
        ...base,
        family,
        fredIndex: null,
        cotEs: false,
        cotNq: false,
        cotYm: false,
        cotNikkei: false,
        cotGapNote:
          'CFTC semiconductor / SOXL: no dedicated semis futures COT. VIX TFF below is the vol contract, not ES/NQ. SOXL is +3x US semis, not an index beta ETF.',
        identityNote: 'SOXL is Direxion Daily Semiconductor Bull 3X, not an S&P or Nasdaq-100 product.',
      }
  }
}
