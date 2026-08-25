/**
 * Mechanical quality scoring for oracle synthesis bakeoff.
 * No LLM judging — string/lexicon matching against frozen reader narratives.
 */

export type SynthesisBakeoffRun = {
  brand: string
  panel: 'single_saju_n3' | 'integrated_n3'
  run: number
  agreements: string[]
  divergences: string[]
  conclusion: string
  confidence_note: string | null
  contentTokens: number | null
  ms: number
  costUsd: number | null
  parsed: boolean
}

export type SynthesisBrandScore = {
  brand: string
  panel: SynthesisBakeoffRun['panel']
  groundingCount: number
  groundingMatches: string[]
  /** Share of agreement/divergence bullets with no reader-claim overlap. */
  platitudeShare: number
  /** True when conclusion matches universal-advice patterns. */
  conclusionGeneric: boolean
  genericShare: number
  lengthChars: [number, number]
  costUsdTotal: number
  parsedBoth: boolean
  disqualified: boolean
}

/** Phrases that could apply to almost any person / any question. */
const UNIVERSAL_CONCLUSION =
  /균형이\s*핵심|균형을\s*잡|단계적으로|무리한\s*확장|준비된\s*기회|유연하게|상황에\s*맞춰|신중하게\s*판단|한\s*걸음씩|과유불급|중도를\s*지키|누구에게나|일반적인\s*조언|보편적/i

const HEDGE_FILLER = /균형|단계적|유연|조율|신중|내실|기반을\s*다지/

function tokenizeClaims(text: string): string[] {
  return text
    .split(/[\s,./·|/]+/)
    .map((t) => t.replace(/[^\p{L}\p{N}%]/gu, ''))
    .filter((t) => t.length >= 2)
}

function readerClaimLexicon(narratives: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const narrative of narratives) {
    for (const token of tokenizeClaims(narrative)) {
      if (token.length >= 2) out.add(token)
    }
    // Keep short distinctive spans (3–12 chars) for Korean grounding.
    const compact = narrative.replace(/\s+/g, '')
    for (let i = 0; i < compact.length - 2; i += 1) {
      const span = compact.slice(i, i + 3)
      if (/[\uAC00-\uD7A3]/.test(span)) out.add(span)
    }
  }
  return out
}

function groundedAgainst(text: string, lexicon: Set<string>): string[] {
  const hits: string[] = []
  for (const token of lexicon) {
    if (token.length < 2) continue
    if (text.includes(token)) hits.push(token)
  }
  return [...new Set(hits)].sort()
}

function bulletPlatitudeShare(bullets: string[], lexicon: Set<string>): number {
  if (bullets.length === 0) return 1
  let platitude = 0
  for (const bullet of bullets) {
    const hits = groundedAgainst(bullet, lexicon)
    const hedgeOnly = HEDGE_FILLER.test(bullet) && hits.length < 2
    if (hits.length === 0 || hedgeOnly) platitude += 1
  }
  return platitude / bullets.length
}

function sentenceGenericShare(text: string, lexicon: Set<string>): number {
  const sentences = text
    .split(/(?<=[.!?。])\s+|[\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
  if (sentences.length === 0) return 1
  let generic = 0
  for (const sentence of sentences) {
    if (groundedAgainst(sentence, lexicon).length === 0) generic += 1
    else if (UNIVERSAL_CONCLUSION.test(sentence) && groundedAgainst(sentence, lexicon).length < 2) {
      generic += 1
    }
  }
  return generic / sentences.length
}

export function scoreSynthesisBrand(
  brand: string,
  panel: SynthesisBakeoffRun['panel'],
  runs: SynthesisBakeoffRun[],
  readerNarratives: readonly string[],
): SynthesisBrandScore {
  const brandRuns = runs.filter((r) => r.brand === brand && r.panel === panel)
  const parsed = brandRuns.filter((r) => r.parsed && r.conclusion.length > 0)
  const lexicon = readerClaimLexicon(readerNarratives)

  const groundingMatches = new Set<string>()
  for (const run of parsed) {
    const blob = [...run.agreements, ...run.divergences, run.conclusion].join('\n')
    for (const hit of groundedAgainst(blob, lexicon)) groundingMatches.add(hit)
  }

  const platitudeShares = parsed.map((r) =>
    bulletPlatitudeShare([...r.agreements, ...r.divergences], lexicon),
  )
  const platitudeShare =
    platitudeShares.length > 0
      ? platitudeShares.reduce((a, b) => a + b, 0) / platitudeShares.length
      : 1

  const conclusionGeneric =
    parsed.length > 0 && parsed.every((r) => UNIVERSAL_CONCLUSION.test(r.conclusion))

  const genericShares = parsed.map((r) => sentenceGenericShare(r.conclusion, lexicon))
  const genericShare =
    genericShares.length > 0 ? genericShares.reduce((a, b) => a + b, 0) / genericShares.length : 1

  const lengthChars: [number, number] = [
    parsed[0]?.conclusion.length ?? 0,
    parsed[1]?.conclusion.length ?? 0,
  ]

  const costUsdTotal = brandRuns.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)

  return {
    brand,
    panel,
    groundingCount: groundingMatches.size,
    groundingMatches: [...groundingMatches].sort(),
    platitudeShare,
    conclusionGeneric,
    genericShare,
    lengthChars,
    costUsdTotal,
    parsedBoth: parsed.length >= 2,
    disqualified: !parsed.length || conclusionGeneric,
  }
}

export function rankSynthesisBrands(scores: SynthesisBrandScore[]): SynthesisBrandScore[] {
  return [...scores].sort((a, b) => {
    if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1
    if (a.conclusionGeneric !== b.conclusionGeneric) return a.conclusionGeneric ? 1 : -1
    if (a.platitudeShare !== b.platitudeShare) return a.platitudeShare - b.platitudeShare
    if (a.genericShare !== b.genericShare) return a.genericShare - b.genericShare
    if (a.groundingCount !== b.groundingCount) return b.groundingCount - a.groundingCount
    if (a.costUsdTotal !== b.costUsdTotal) return a.costUsdTotal - b.costUsdTotal
    return a.brand.localeCompare(b.brand)
  })
}
