/**
 * Analyst / KRX-flow / short / broker / outlet figures are closed-book MODEL
 * INPUT for equity rounds (STOCK, KRSTOCK, etf_index). User-visible text —
 * stored rationales, translations, extra seats, scouts, deep output — must
 * keep the qualitative sentence and drop the raw source numbers and names.
 * The packet itself keeps the full numbers.
 */

export const EQUITY_DISPLAY_CATEGORIES = new Set(['stock', 'etf_index'])

export const EQUITY_QUALITATIVE_GUIDANCE =
  'Describe direction and qualitative magnitude only; never quote raw ratios, flow amounts, target prices, broker or source names.'

export function scrubsAnalystDisclosure(category: string | null | undefined): boolean {
  return EQUITY_DISPLAY_CATEGORIES.has((category ?? '').trim().toLowerCase())
}

const NUM = String.raw`[$€£¥₩]?\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:USD|달러|원|KRW|won)|%|x|X)?`
const KR_AMOUNT = String.raw`\d[\d,]*(?:\.\d+)?\s*(?:억|조)(?:\s*(?:원|KRW|won))?`
const EN_WON_AMOUNT = String.raw`\d[\d,]*(?:\.\d+)?\s*(?:B|bn|billion|T|tn|trillion|M|mn|million)\s*(?:won|KRW|원)?`
const FLOW_NEXT = String.raw`(?=.{0,24}(?:순매수|순매도|매수세|매도세|net[\s-]?buy|net[\s-]?sell|외국인|기관|개인|연기금|금융투자|short))`
const FLOW_PREV = String.raw`(?:순매수|순매도|매수세|매도세|net[\s-]?buy|net[\s-]?sell|외국인(?:의)?|기관|개인|연기금|금융투자)`

const BROKERS = [
  'JPMorgan',
  'J\\.?P\\.?\\s*Morgan',
  'Goldman(?:\\s+Sachs)?',
  'Morgan Stanley',
  'Bank of America',
  'BofA',
  'Citigroup',
  'Citi',
  'Barclays',
  'UBS',
  'HSBC',
  'Deutsche Bank',
  'Wells Fargo',
  'Jefferies',
  'Baird',
  'Piper Sandler',
  '미래에셋(?:증권)?',
  '삼성증권',
  'KB증권',
  '키움(?:증권)?',
  'NH(?:투자증권)?',
  '한국투자(?:증권)?',
  '신한(?:투자증권|증권)?',
  '하나(?:증권)?',
  '대신(?:증권)?',
  '메리츠(?:증권)?',
  '유안타(?:증권)?',
  '한화투자(?:증권)?',
].join('|')

const OUTLETS = [
  'Benzinga',
  'Investing\\.com',
  'StockAnalysis',
  'TipRanks',
  'Zacks',
  'MarketBeat',
  'Finviz',
  'Seeking Alpha',
  'The Motley Fool',
  'TheStreet',
].join('|')

const RULES: Array<[RegExp, string]> = [
  // "(source: Twelve Data /price_target; as-of …)" and bare vendor mentions
  [/\(\s*(?:source:\s*)?twelve\s*data[^)]*\)/gi, ''],
  [/\b(?:according to|per|from|via)\s+twelve\s*data\b,?\s*/gi, ''],
  [/\btwelve\s*data(?:'s)?\b/gi, 'consensus data'],
  [/\/(?:price_target|recommendations|eps_trend|earnings|statistics|analyst_ratings(?:\/light)?)\b/gi, ''],
  // Parenthetical / inline outlet domains
  [/\(\s*(?:https?:\/\/)?(?:www\.)?[\w.-]+\.(?:com|co\.kr|kr|net|io|org)\s*\)/gi, ''],
  [/\b(?:https?:\/\/)?(?:www\.)?[\w.-]+\.(?:com|co\.kr|kr|net|io|org)\b/gi, ''],
  [new RegExp(`\\b(?:${OUTLETS})\\b`, 'gi'), ''],
  // Broker / bank names in an analyst context → one Korean stand-in
  [new RegExp(`(?:${BROKERS})`, 'gi'), '일부 증권사'],
  // "hi 400 / median 335 / lo 215" target ranges
  [new RegExp(String.raw`\b(?:hi(?:gh)?|median|lo(?:w)?|avg|average|mean)\s*:?\s*${NUM}(?:\s*/\s*(?:hi(?:gh)?|median|lo(?:w)?|avg|average|mean)\s*:?\s*${NUM})+`, 'gi'), 'analyst range'],
  // Prefix amounts on Korean consensus targets: "1.4M 컨센서스 목표가"
  [new RegExp(String.raw`\d[\d,]*(?:\.\d+)?\s*(?:[MBT]|mn|million|bn|billion|tn|trillion|억|조|만)?\s*((?:컨센서스\s*)?목표가|consensus(?:\s+price)?\s*targets?)`, 'gi'), '$1'],
  // "price target of $315", "target $315", "목표가 315달러", "목표가 35만원", "PT 240"
  [new RegExp(String.raw`((?:consensus\s+|street\s+|analyst\s+|median\s+|average\s+|mean\s+)?(?:price\s+)?targets?|목표\s?주?가|PT)(\s*(?:는|은|이|가)?\s*(?:of|at|is|near|around|~|≈|=|:)?\s*)${NUM}(?:\s*만원)?`, 'gi'), '$1'],
  // Consensus OP / 영업이익 ranges
  [new RegExp(String.raw`(OP\s*전망치|영업이익(?:\s*전망치)?)(\s*(?:는|은|이|가|약)?\s*)${NUM}(?:\s*(?:~|–|-|〜)\s*${NUM})?`, 'gi'), '$1'],
  // "25 buy / 14 hold / 3 sell", "6 strong_buy"
  [/\b\d+\s*(strong[_ ]buy|strong[_ ]sell|buys?|holds?|sells?|outperforms?|underperforms?)\b/gi, '$1'],
  // "trailing PE 45.2", "PER ~287x", "P/B 12", "EPS estimate 1.97"
  [new RegExp(String.raw`\b((?:trailing\s+|forward\s+)?(?:p\/?e|per|p\/?b|pbr|price[- ]to[- ](?:book|earnings)|eps(?:\s+(?:estimate|trend|actual))?))(\s*(?:of|at|is|=|:|~)?\s*)${NUM}`, 'gi'), '$1'],
  // Short-ratio figures and vs-average comparisons
  [/short[- ]ratio(?:\s+spike)?\s*\(\s*\d[\d.]*(?:\s*vs\.?\s*\d[\d.]*\s*(?:avg|average)?)?\s*\)/gi, 'short-ratio spike'],
  [/short[- ]ratio\s+\d[\d.]*(?:\s*vs\.?\s*\d[\d.]*\s*(?:avg|average)?)?/gi, 'short-ratio'],
  [/\(\s*\d[\d.]*(?:\s*vs\.?\s*\d[\d.]*\s*(?:avg|average)?)\s*\)/gi, ''],
  [/공매도\s*비중\s*(?:상승|하락|스파이크)?(?:\s*(?:은|이|가)?)?\s*\d[\d.]*%?/gi, '공매도 비중 상승'],
  [/외국인\s*보유율(?:\s*(?:은|이|가)?)?\s*\d[\d.]*%?/gi, '외국인 보유 비중'],
  // KRW/USD flow amounts next to who-traded language; 유상증자 / rights-issue sizes stay
  [new RegExp(String.raw`(?:${KR_AMOUNT}|${EN_WON_AMOUNT}|${NUM})\s*규모의?\s*${FLOW_NEXT}`, 'gi'), ''],
  [new RegExp(String.raw`(${FLOW_PREV}\s*(?:of\s+)?)(?:${KR_AMOUNT}|${EN_WON_AMOUNT}|${NUM})\s*`, 'gi'), '$1'],
  [new RegExp(String.raw`(?:${KR_AMOUNT}|${EN_WON_AMOUNT})\s*(?=KOSPI|KOSDAQ|${FLOW_PREV})`, 'gi'), ''],
]

function tidy(text: string): string {
  return text
    .replace(/(?:일부 증권사)(?:\s*(?:과|와|,|and|&)\s*일부 증권사)+/g, '일부 증권사')
    .replace(/\bof\s*([,.;]|$)/gi, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function scrubAnalystDisclosure(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null
  let out = text
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  out = tidy(out)
  return out || null
}
