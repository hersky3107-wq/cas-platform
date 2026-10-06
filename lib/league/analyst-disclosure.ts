/**
 * Analyst / KRX-flow / short / broker / outlet figures are closed-book MODEL
 * INPUT for equity rounds (STOCK, KRSTOCK, etf_index). User-visible text —
 * stored rationales, translations, extra seats, scouts, deep output — must
 * keep the qualitative sentence and drop the raw source numbers and names.
 * The packet itself keeps the full numbers.
 *
 * Names match whole tokens only. Latin uses `\b`; Hangul names are not
 * preceded or followed by Hangul or Latin letters. Window labels (5d / 20d /
 * 1w) and public filing sizes (rights issue, buyback) are left alone.
 */

export const EQUITY_DISPLAY_CATEGORIES = new Set(['stock', 'etf_index'])

export const EQUITY_QUALITATIVE_GUIDANCE =
  'Describe direction and qualitative magnitude only; never quote raw ratios, flow amounts, target prices, broker or source names. Never name a brokerage, an analyst target price, a target-price consensus, a 증권사 리포트, or a rating change (upgrade/downgrade). Company disclosures and filings stay.'

export const BROKER_STANDIN = '일부 증권사'

export const TARGET_UPSIDE_STANDIN = '목표가 컨센서스가 현재가보다 높음'

export const CROWDING_STANDIN = '쏠림이 큰 편'

export function scrubsAnalystDisclosure(category: string | null | undefined): boolean {
  return EQUITY_DISPLAY_CATEGORIES.has((category ?? '').trim().toLowerCase())
}

const NUM = String.raw`[$€£¥₩]?\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:USD|달러|원|KRW|won)|%|x|X)?`
const ANALYST_AMT = String.raw`[$€£¥₩]?\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:USD|달러|원|KRW|won|만원|[TBMK]|bn|mn|tn|trillion|billion|million)|%|x|X)?`
const RANGE_AMT = String.raw`[$€£¥₩]?\s*\d[\d,]*(?:\.\d+)?\s*(?:k|K|만|만원|원)?`
const RANGE = String.raw`${RANGE_AMT}\s*[~\-–—〜]\s*${RANGE_AMT}`

/** 5d / 20d / 1w stay intact — never treat the leading digit as a flow amount. */
const WINDOW_LABEL = String.raw`^\d+[dDwWmMyY]$`

const INVESTOR_TERM =
  /기관|외국인|개인|연기금|금융투자|순매수|순매도|매수세|매도세|\binstitution(?:al)?s?\b|\bforeign(?:ers?)?\b|\bretail\b|\bpension(?:s)?\b|\bfinancial\s+investment\b|\bnet[\s-]?buys?\b|\bnet[\s-]?sells?\b|\binflows?\b|\boutflows?\b/gi

const COMPANY_DISCLOSURE =
  /유상증자|자사주|자기주식|rights[\s-]?issues?|buybacks?|공개매수|수주(?:계약)?|계약\s*규모/gi

const ANALYST_CTX =
  /애널리스트|analyst|목표\s*주?\s*가|투자의견|리포트|증권사|price\s+targets?|\bPT\b|rating/gi

/**
 * Monetary amounts only (signed or unsigned). Requires a money unit or
 * currency — not a bare count, not a % price move, not 5d/20d/1w.
 */
const FLOW_MONEY =
  /[+\-−–]?\s*[$₩]?\s*\d[\d,]*(?:\.\d+)?\s*(?:조|억|만|[Tt](?:n|rillion)?|[Bb](?:n|illion)?|[Mm](?:n|illion)?|[Kk])\s*(?:KRW|won|원|₩)?|[+\-−–]?\s*(?:[$₩]|KRW|won|원)\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:KRW|won|원|₩)/gi

const LATIN_BROKERS = [
  'Korea Investment(?:\\s+&\\s+Securities)?',
  'Mirae Asset Securities',
  'Samsung Securities',
  'NH Investment(?:\\s+&\\s+Securities)?',
  'KB Securities',
  'Kiwoom Securities',
  'Hana Securities',
  'Shinhan Investment(?:\\s+&\\s+Securities)?',
  'Shinhan Securities',
  'Daishin Securities',
  'Meritz Securities',
  'Yuanta Securities',
  'Hanwha Investment(?:\\s+&\\s+Securities)?',
  'Kyobo Securities',
  'Hyundai Motor Securities',
  'IBK Securities',
  'DB\\s+Securities',
  'DB Financial Investment',
  'Eugene Investment(?:\\s+&\\s+Securities)?',
  'JPMorgan',
  'J\\.?P\\.?\\s*Morgan',
  'Goldman(?:\\s+Sachs)?',
  'Morgan Stanley',
  'Bank of America',
  'BofA',
  'Citigroup',
  'Nomura',
  'Barclays',
  'Deutsche Bank',
  'Wells Fargo',
  'Jefferies',
  'Piper Sandler',
  'HSBC',
  'UBS',
  'Citi',
  'Baird',
].join('|')

const HANGUL_BROKERS = [
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
  '교보(?:증권)?',
  '현대차증권',
  'IBK투자증권',
].join('|')

const LATIN_OUTLETS = [
  'Benzinga',
  'Investing\\.com',
  'StockAnalysis',
  'TipRanks',
  'MarketBeat',
  'Seeking Alpha',
  'The Motley Fool',
  'Yahoo Finance',
  'TheStreet',
  'Bloomberg',
  'Reuters',
  'Finviz',
  'Zacks',
].join('|')

const HANGUL_OUTLETS = [
  '매일경제(?:신문)?',
  '한국경제(?:신문)?',
  '머니투데이',
  '이데일리',
  '연합뉴스',
  '네이버\\s*증권',
].join('|')

const LATIN_NAME = String.raw`\b(?:${LATIN_BROKERS})\b`
const HANGUL_NAME = String.raw`(?<![가-힣A-Za-z])(?:${HANGUL_BROKERS})(?![가-힣A-Za-z])`
const LATIN_OUTLET = String.raw`\b(?:${LATIN_OUTLETS})\b`
const HANGUL_OUTLET = String.raw`(?<![가-힣A-Za-z])(?:${HANGUL_OUTLETS})(?![가-힣A-Za-z])`
const NAVER_OUTLET = String.raw`\bNaver\s+증권`
const GENERIC_FIRM = String.raw`\b[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,4}\s+(?:Investment\s+&\s+Securities|Securities)\b`

const RULES: Array<[RegExp, string]> = [
  // Broken / leftover markdown links before other punctuation work
  [/\(\[\s*\]\([^)\s]*\)?/g, ''],
  [/\[\s*\]\([^)\s]*\)?/g, ''],
  [/\[\s*\]\([^)]*\)/g, ''],
  [/\[\d+\]/g, ''],
  [/【\d+】/g, ''],
  [/\(\[/g, ''],
  [/\]\(/g, ''],
  // "(source: Twelve Data /price_target; as-of …)" and bare vendor mentions
  [/\(\s*(?:source:\s*)?twelve\s*data[^)]*\)/gi, ''],
  [/\b(?:according to|per|from|via)\s+twelve\s*data\b,?\s*/gi, ''],
  [/\btwelve\s*data(?:'s)?\b/gi, 'consensus data'],
  [/\/(?:price_target|recommendations|eps_trend|earnings|statistics|analyst_ratings(?:\/light)?)\b/gi, ''],
  // Parenthetical source pages — domains (any position) run in scrubBareDomains
  [/\([^)]*(?:시세\s*페이지|증권\s*페이지)[^)]*\)/gi, ''],
  [new RegExp(`(?:${LATIN_OUTLET}|${HANGUL_OUTLET}|${NAVER_OUTLET})`, 'gi'), ''],
  // Broker / bank names → one Korean stand-in (whole tokens only)
  [new RegExp(`(?:${LATIN_NAME}|${HANGUL_NAME})`, 'gi'), BROKER_STANDIN],
  // Target expressed as % upside vs the current price — drop the consensus claim
  [/목표가\s*컨센서스가\s*현재가\s*대비\s*약?\s*\d[\d.,]*\s*%\s*상방(?:이다|임)?/g, ''],
  [/\bconsensus\s+target\s+implies\s+\d[\d.,]*\s*%\s+upside\b/gi, ''],
  // Target-price ranges and abbreviations
  [new RegExp(String.raw`(목표\s?주?가|PT)\s*\(\s*${RANGE}\s*\)`, 'gi'), '$1'],
  [new RegExp(String.raw`\bPT\s+${RANGE}`, 'gi'), 'PT'],
  [new RegExp(String.raw`(목표\s?주?가)\s*${RANGE}(?:원)?`, 'gi'), '$1'],
  [new RegExp(String.raw`\$?\d[\d,]*(?:\.\d+)?(?:k|K)?\s*[~\-–—〜]\s*\$?\d[\d,]*(?:\.\d+)?(?:k|K)?\s+(?:price\s+)?targets?`, 'gi'), 'target'],
  // "hi 400 / median 335 / lo 215" target ranges
  [new RegExp(String.raw`\b(?:hi(?:gh)?|median|lo(?:w)?|avg|average|mean)\s*:?\s*${NUM}(?:\s*/\s*(?:hi(?:gh)?|median|lo(?:w)?|avg|average|mean)\s*:?\s*${NUM})+`, 'gi'), 'analyst range'],
  // Prefix amounts on Korean consensus targets: "1.4M 컨센서스 목표가"
  [new RegExp(String.raw`\d[\d,]*(?:\.\d+)?\s*(?:[MBT]|mn|million|bn|billion|tn|trillion|억|조|만)?\s*((?:컨센서스\s*)?목표가|consensus(?:\s+price)?\s*targets?)`, 'gi'), '$1'],
  // Brokerage reports, target-price consensus, and rating changes (KR + US equity).
  // After the amount prefix is peeled, so "1.4M 컨센서스 목표가" does not leave "1.4M".
  [/증권사\s*리포트(?:도|를|은|는|가|의|에서)?/g, ''],
  [/평균\s*목표\s*주?\s*가가?\s*(?:도\s*)?(?:상향|하향|유지)?(?:됐다|했다|했습니다|하였다)?/g, ''],
  [
    /(?:컨센서스\s*목표\s*주?\s*가|목표주가\s*컨센서스|목표\s*주?\s*가\s*컨센서스)(?:가|는|은|이|도)?(?:\s*현재가\s*대비)?(?:\s*(?:약\s*)?(?:\d[\d.,]*\s*%)?)?(?:\s*(?:큰|높은|상당한))?(?:\s*상방)?/g,
    '',
  ],
  [/목표\s*주\s*가\s*(?:상향|하향|유지)(?:\s*조정)?/g, ''],
  [/(?:투자의견|rating)\s*(?:을|를|이|가)?\s*(?:상향|하향|유지|upgrade|downgrade)/gi, ''],
  [/\b(?:upgrades?|downgrades?)\s+(?:to\s+)?(?:buy|sell|hold|neutral|outperform|underperform)\b/gi, ''],
  // "price target of $315", "target $315", "목표가 315달러", "목표가 35만원", "PT 240"
  [new RegExp(String.raw`((?:consensus\s+|street\s+|analyst\s+|median\s+|average\s+|mean\s+)?(?:price\s+)?targets?|목표\s?주?가|PT)(\s*(?:는|은|이|가)?\s*(?:of|at|is|near|around|~|≈|=|:)?\s*)${ANALYST_AMT}(?:\s*만원)?`, 'gi'), '$1'],
  // Consensus OP / 영업이익 ranges
  [new RegExp(String.raw`(OP\s*전망치|영업이익(?:\s*전망치)?)(\s*(?:는|은|이|가|약)?\s*)${ANALYST_AMT}(?:\s*(?:~|–|-|〜)\s*${ANALYST_AMT})?`, 'gi'), '$1'],
  // "25 buy / 14 hold / 3 sell", "6 strong_buy"
  [/\b\d+\s*(strong[_ ]buy|strong[_ ]sell|buys?|holds?|sells?|outperforms?|underperforms?)\b/gi, '$1'],
  // PER/PBR multiples, including "PER(약 119배)" and "PER ~287x". Drop the label and the figure.
  [
    /\b(?:trailing\s+|forward\s+)?(?:p\/e|p\/b|per|pbr|price[- ]to[- ](?:book|earnings))\b\s*(?:\(\s*[^)]{0,40}\)|\s*[~≈]?\s*(?:약\s*)?\d[\d.,]*\s*(?:배|x|X)?)/gi,
    '',
  ],
  // "trailing PE 45.2", "EPS estimate 1.97" — keep the label, drop the figure.
  [new RegExp(String.raw`\b((?:trailing\s+|forward\s+)?(?:p\/?e|eps(?:\s+(?:estimate|trend|actual))?))(\s*(?:of|at|is|=|:|~)?\s*)${NUM}`, 'gi'), '$1'],
  // Analyst/target remnants: "애널리스트 인 274k", "target 274k".
  [
    /(?:애널리스트|analysts?|목표가|price\s*targets?|컨센서스\s*목표)(?:\s*(?:의|가|는|은|인|들))?[^.\n]{0,24}?\d[\d.,]*\s*[kKmMbB]\b/gi,
    '',
  ],
  [
    /\d[\d.,]*\s*[kKmMbB]\b[^.\n]{0,24}?(?:애널리스트|analysts?|목표가|price\s*targets?)/gi,
    '',
  ],
  // Short-ratio figures and vs-average comparisons
  [/short[- ]ratio(?:\s+spike)?\s*\(\s*\d[\d.]*(?:\s*vs\.?\s*\d[\d.]*\s*(?:avg|average)?)?\s*\)/gi, 'short-ratio spike'],
  [/short[- ]ratio\s+\d[\d.]*(?:\s*vs\.?\s*\d[\d.]*\s*(?:avg|average)?)?/gi, 'short-ratio'],
  [/\(\s*\d[\d.]*(?:\s*vs\.?\s*\d[\d.]*\s*(?:avg|average)?)\s*\)/gi, ''],
  [/공매도\s*비중\s*(?:상승|하락|스파이크)?(?:\s*(?:은|이|가)?)?\s*\d[\d.]*%?/gi, '공매도 비중 상승'],
  [/외국인\s*보유율(?:\s*(?:은|이|가)?)?\s*\d[\d.]*%?/gi, '외국인 보유 비중'],
]

const JARGON_RULES: Array<[RegExp, string]> = [
  [/\bcrowdingLevel\b/gi, CROWDING_STANDIN],
  [/\b(?:very\s+)?(?:high|low|medium|elevated)\s+crowding\b/gi, CROWDING_STANDIN],
  [/\bbp\s+of\s+mktcap\b/gi, ''],
  [/\bbp\s*pct(?:\s*[+\-]?\d[\d.]*)?/gi, ''],
  [/\bpct\s*[+\-]?\d[\d.]*/gi, ''],
  [/\bpercentile\s*[+\-]?\d[\d.]*/gi, ''],
  [/백분위\s*[+\-]?\d[\d.]*/gi, ''],
  [/\bz[- ]?score\s*[+\-]?\d[\d.]*/gi, ''],
  [/\bz\s+[+\-]?\d[\d.]+/gi, ''],
]

function hasMatch(re: RegExp, text: string): boolean {
  re.lastIndex = 0
  return re.test(text)
}

function nearby(text: string, index: number, length: number, span: number): string {
  return text.slice(Math.max(0, index - span), Math.min(text.length, index + length + span))
}

/**
 * Any money unit within ~40 characters of an investor term is packet flow,
 * not a public filing. Filings (유상증자 / 자사주) and window labels stay.
 */
function scrubInvestorFlowAmounts(text: string): string {
  if (!hasMatch(INVESTOR_TERM, text)) return text
  return text.replace(FLOW_MONEY, (match, offset: number) => {
    const token = match.trim()
    if (new RegExp(WINDOW_LABEL).test(token)) return match
    const window = nearby(text, offset, match.length, 40)
    if (!hasMatch(INVESTOR_TERM, window)) return match
    const filingWindow = nearby(text, offset, match.length, 24)
    if (hasMatch(COMPANY_DISCLOSURE, filingWindow)) return match
    const signedNeg = /^[−–-]/.test(token)
    const signedPos = token.startsWith('+')
    const hasSell = hasMatch(/순매도|매도세|\bnet[\s-]?sells?\b|\boutflows?\b/gi, window)
    const hasBuy = hasMatch(/순매수|매수세|\bnet[\s-]?buys?\b|\binflows?\b/gi, window)
    const ko = /[가-힣]/.test(window)
    if (signedNeg && !hasSell) return ko ? '순매도' : 'net sell'
    if (signedPos && !hasBuy) return ko ? '순매수' : 'net buy'
    return ''
  }).replace(/\s*규모의?\s*(?=기관|외국인|개인|연기금|금융투자|\binstitution|\bforeign|\bretail)/gi, ' ')
}

function scrubGenericEnglishBrokers(text: string): string {
  return text.replace(new RegExp(GENERIC_FIRM, 'gi'), (match, offset: number) => {
    if (new RegExp(LATIN_NAME, 'i').test(match)) return BROKER_STANDIN
    const window = nearby(text, offset, match.length, 40)
    if (!hasMatch(ANALYST_CTX, window)) return match
    return BROKER_STANDIN
  })
}

/** Domains in any position, including glued residue like `co.krhome))`. */
function scrubBareDomains(text: string): string {
  return text
    .replace(
      /(?:https?:\/\/)?(?:www\.)?[a-z0-9][\w.-]*\.(?:com|co\.kr|net|io|org|kr)[a-z0-9]*/gi,
      '',
    )
    .replace(/[)\/]{2,}/g, '')
    .replace(/\/\)/g, '')
}

function scrubSourceResidue(text: string): string {
  return text
    .replace(/;\s*(?:출처|source)\s*[:.]*\s*$/gi, '.')
    .replace(/\(\s*(?:출처|source)\s*[:.]?\s*\)/gi, '')
    .replace(/(?:출처|source)\s*[:.]\s*\.?\s*$/gi, '')
    .replace(/(?:출처|source)\s*[:.]\s*(?=[,.;]|$)/gi, '')
}

function tidyPass(text: string): string {
  return text
    .replace(new RegExp(String.raw`(?:${BROKER_STANDIN})(?:\s*(?:과|와|,|and|&)\s*${BROKER_STANDIN})+`, 'g'), BROKER_STANDIN)
    .replace(/[$€£¥₩]\s*(?!\d)/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\(\[/g, '')
    .replace(/\]\(/g, '')
    .replace(/[)\/]{2,}/g, '')
    .replace(/\/\)/g, '')
    .replace(/\bof\s*([,.;]|$)/gi, '$1')
    .replace(/\s+(?:및|and|&|,)\s*(?=[.!?…]|$)/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/;\s*([.!?])/g, '$1')
    .replace(/[,\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * A deletion that leaves a dangling particle or an empty object ("인 에",
 * " 에 도달") makes the sentence meaningless. Drop that sentence only.
 */
function sentenceIsBroken(sentence: string): boolean {
  const s = sentence.replace(/\s+/g, ' ').trim()
  if (!s) return true
  if (/(?:^|\s)(?:은|는|이|가|을|를|에|에서|으로|로|와|과|의|도)\s+(?:은|는|이|가|을|를|에|에서|으로|로|와|과)/.test(s)) return true
  if (/(?:^|\s)(?:에|을|를|이|가)\s*(?:도달|초과|상회|하회)/.test(s)) return true
  if (/인\s+에(?:\s|$)/.test(s)) return true
  if (/이미\s+에(?:\s|$)/.test(s)) return true
  return false
}

function dropBrokenSentences(text: string): string {
  return text
    .split(/(?<=[.!?…。])\s+/)
    .filter((part) => !sentenceIsBroken(part))
    .join(' ')
    .trim()
}

function tidy(text: string): string {
  let prev = ''
  let out = text
  for (let i = 0; i < 4 && out !== prev; i++) {
    prev = out
    out = tidyPass(out)
  }
  return out
}

export function scrubAnalystDisclosure(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null
  let out = text
  out = scrubBareDomains(out)
  for (const [re, rep] of RULES) out = out.replace(re, rep)
  out = scrubGenericEnglishBrokers(out)
  out = scrubInvestorFlowAmounts(out)
  for (const [re, rep] of JARGON_RULES) out = out.replace(re, rep)
  out = scrubSourceResidue(out)
  out = tidy(out)
  out = dropBrokenSentences(out)
  out = tidy(out)
  return out || null
}
