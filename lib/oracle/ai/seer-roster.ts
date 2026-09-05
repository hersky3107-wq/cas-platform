/**
 * Layer-2 seer panel: personas, decision rules, and brand seats.
 *
 * Personas differ by DECISION RULE, not tone. Every seer receives the same
 * twelve layer-1 readings plus the axis-projection consensus and returns ONE
 * ballot; what varies is how each one is instructed to weigh that input.
 * Tallying is done in code (runner/ballot.ts) — never by an AI.
 *
 * Seat order IS the product: `seerRosterFor(n)` takes the first N in order,
 * so N=3 seats reader/seer/guide, N=5 adds elder+contrarian, N=7 adds
 * scholar+doubter, N=9 adds mystic+witness. WITNESS sits last on purpose —
 * its rule (change vs the previous session) only bites for returning users;
 * on a first visit it records the baseline instead.
 *
 * Brand seats cite docs/oracle-synthesis-bakeoff.md (integrated + single
 * panels) and docs/oracle-onboarding-20x.md. The CONTRARIAN seat was Qwen,
 * which is retired (RETIRED_BRANDS); its replacement is deliberately a brand
 * with NO other seat in the combined session — the one voice with no stake
 * in any reading it distrusts. New brands must pass the sequential 20×
 * onboarding gate (≥19/20) before sitting. Invariants are asserted in
 * __tests__/seer-roster.test.ts, which is also where registry imports live —
 * this module stays import-free so client code can read display names
 * without dragging model ids into the bundle.
 */

export const ORACLE_SEER_SLUGS = [
  'reader',
  'seer',
  'guide',
  'elder',
  'contrarian',
  'scholar',
  'doubter',
  'mystic',
  'witness',
] as const

export type OracleSeerSlug = (typeof ORACLE_SEER_SLUGS)[number]

export type OracleSeerPersona = {
  slug: OracleSeerSlug
  /** Korean display name for the result screen. */
  nameKo: string
  /** One-line Korean description of the decision rule, for the UI. */
  ruleKo: string
  /** Brand holding the seat. Shown to the client; model stays server-only. */
  brand: string
  /** Decision rule injected verbatim into the verdict system prompt. */
  decisionRule: string
  /** Seat evidence citation (docs), server/docs only. */
  cite: string
}

export const ORACLE_SEER_PERSONAS: readonly OracleSeerPersona[] = [
  {
    slug: 'reader',
    nameKo: '리더',
    ruleKo: '가장 자신 없는 읽기부터 검토',
    brand: 'Moonshot AI',
    decisionRule:
      'DECISION RULE — LEAST-CONFIDENT FIRST: Rank the readings by how tentative or hedged they are, and weigh the LEAST confident ones first. Your verdict must be the call that still stands even if the weakest, most uncertain readings turn out to be right.',
    cite: 'synthesis bakeoff integrated #2 ok (Z.ai #1 is the same-session synthesizer); onboarding 19/20',
  },
  {
    slug: 'seer',
    nameKo: '예언자',
    ruleKo: '가장 강한 단일 신호에 베팅',
    brand: 'Google',
    decisionRule:
      'DECISION RULE — STRONGEST SINGLE SIGNAL: Find the ONE clearest, most specific signal across all readings and stake the entire verdict on it. Name which system carried it (by its divination name, e.g. 타로, 사주). Ignore weak or ambiguous signals entirely.',
    cite: 'synthesis bakeoff integrated #3 ok; onboarding 20/20',
  },
  {
    slug: 'guide',
    nameKo: '안내자',
    ruleKo: '이번 주에 실행 가능한 것만',
    brand: 'xAI',
    decisionRule:
      'DECISION RULE — ACTIONABLE THIS WEEK ONLY: Discard everything that cannot be acted on within seven days. Your verdict must be a concrete, doable call for this week; if a reading speaks only in years or fate-scale terms, it does not count as evidence for you.',
    cite: 'synthesis bakeoff integrated #4 ok; onboarding 20/20 (reading)',
  },
  {
    slug: 'elder',
    nameKo: '장로',
    ruleKo: '고전 동양 술수의 눈',
    brand: 'NAVER',
    decisionRule:
      'DECISION RULE — CLASSICAL EASTERN FRAME: Judge through classical East-Asian divination reasoning (음양, 오행 생극, 운의 흐름). Give the East-Asian calendrical systems (사주, 자미두수, 구성학, 수요, 성명학, 주역) primary weight and read the others as supporting voices.',
    cite: 'Korean-native seat (HyperCLOVA X); onboarding 20/20 (reading)',
  },
  {
    slug: 'contrarian',
    nameKo: '반론자',
    ruleKo: '다수 방향을 불신',
    brand: 'ByteDance',
    decisionRule:
      'DECISION RULE — DISTRUST THE MAJORITY: Start from the assumption that the leading direction in the consensus tally is WRONG. Build the strongest case for the opposite call from the readings. Vote with the majority only if that contrary case collapses — and if it does, say what broke it.',
    cite: 'replaces retired Qwen; only seat with no layer-1 stake; sequential 20× gate — see docs/oracle-onboarding-20x.md',
  },
  {
    slug: 'scholar',
    nameKo: '학자',
    ruleKo: '체계 간 모순만 다룸',
    brand: 'NVIDIA',
    decisionRule:
      'DECISION RULE — CONTRADICTIONS ONLY: Work exclusively from the places where systems disagree with each other. Name the sharpest contradiction (which two systems, what they each said) and derive your verdict from which side of it survives scrutiny. Agreements are not your material.',
    cite: 'synthesis bakeoff single-panel #1 (0 univ DQ); onboarding 20/20',
  },
  {
    slug: 'doubter',
    nameKo: '회의자',
    ruleKo: '모든 결론을 의심',
    brand: 'DeepSeek',
    decisionRule:
      'DECISION RULE — QUESTION EVERY CONCLUSION: Interrogate each reading\'s conclusion: what would have to be true for it to hold? Discard any conclusion that fails the test. Your verdict is the direction that survives the most doubt, stated with exactly the confidence it earned and no more.',
    cite: 'synthesis clean re-run single DQ=false, ground=121; onboarding 20/20',
  },
  {
    slug: 'mystic',
    nameKo: '신비가',
    ruleKo: '상징으로만, 숫자 없이',
    brand: 'Anthropic',
    decisionRule:
      'DECISION RULE — SYMBOLS, NO NUMBERS: Read only the images and symbols the systems produced (cards, runes, 괘, stars, colours, animals). Your verdict_line and minority_opinion must contain NO digits, percentages, or counts — the ballot numbers are the only numbers you emit. Let the symbols agree or collide.',
    cite: 'synthesis bakeoff single-panel #2 ok; brand-level thinking disabled; onboarding 20/20',
  },
  {
    slug: 'witness',
    nameKo: '증인',
    ruleKo: '지난번과 달라진 것 (재방문자)',
    brand: 'OpenAI',
    decisionRule:
      'DECISION RULE — CHANGE VS LAST TIME: If payload.previous is present, verdict ONLY on what moved since that record: which direction gained, which domain shifted, what is new. If payload.previous is null this is the first record — say so plainly and state the baseline a future visit should be compared against.',
    cite: 'numerology single-panel synthesis #5 ok (synth-seat hold-out does not cover ballots); onboarding 20/20 (reading); seat 9 — returning users reach it',
  },
] as const

const BY_SLUG: ReadonlyMap<string, OracleSeerPersona> = new Map(
  ORACLE_SEER_PERSONAS.map((persona) => [persona.slug, persona]),
)

export function seerPersona(slug: string): OracleSeerPersona | null {
  return BY_SLUG.get(slug) ?? null
}

export function seerBrandFor(slug: string): string | null {
  return BY_SLUG.get(slug)?.brand ?? null
}

/** First N personas in seat order. N is 3/5/7/9 — enforced at create time. */
export function seerRosterFor(readerCount: number): OracleSeerSlug[] {
  return ORACLE_SEER_PERSONAS.slice(0, readerCount).map((persona) => persona.slug)
}

/**
 * verdict_line character budgets. Format changes with the panel size while
 * the TOTAL stays in the same band: 3 long individual verdicts ≈ 5 medium
 * ≈ 7 one-liners ≈ 9 one-liners with votes + minority highlight.
 */
export const SEER_VERDICT_LINE_BUDGETS: Record<number, number> = {
  3: 400,
  5: 240,
  7: 120,
  9: 80,
}

export const SEER_MINORITY_OPINION_MAX = 160

export function verdictLineBudget(readerCount: number): number {
  return SEER_VERDICT_LINE_BUDGETS[readerCount] ?? SEER_VERDICT_LINE_BUDGETS[9]!
}
