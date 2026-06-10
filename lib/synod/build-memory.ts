/**
 * SYNOD — serial multi-round AI deliberation memory builder.
 *
 * SYNOD runs 6 AIs (chatgpt, claude, gemini, grok, deepseek, mistral) through
 * several rounds of structured debate, with a facilitator (GPT-5.4) compressing
 * each round into a short structured summary and a verdict chair (Claude Opus 4.8)
 * issuing the final answer.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TOKEN-COST PHILOSOPHY (mirrors Arena's buildArenaMemoryEntries approach)
 * ──────────────────────────────────────────────────────────────────────────
 * We DO NOT pass full transcripts between rounds. Doing so makes every round's
 * prompt grow O(rounds × participants × answer length), which blows up cost and
 * latency. Instead, only the facilitator's COMPRESSED summary is carried forward.
 *
 * The single most important rule (see buildDeliberationContext): include ONLY the
 * MOST RECENT facilitator summary in full. All OLDER summaries are collapsed to a
 * single headline line each. This keeps the injected history roughly constant in
 * size no matter how many rounds have elapsed.
 *
 * ⚠️ FUTURE EDITORS: Do not "helpfully" start injecting full prior-round turns or
 * full older summaries here. That silently reintroduces the very cost blow-up this
 * module exists to prevent. If you need more history, expand the facilitator
 * summary schema instead — never the raw transcript.
 *
 * All functions in this file are PURE: no DB calls, no network, no logging, no
 * mutation of inputs.
 */

/** A single AI's contribution within one deliberation round. */
export type SynodTurn = {
  roundNumber: number
  /** Brand name, e.g. "ChatGPT", "Claude". Anonymized to "Participant X" on demand. */
  aiName: string
  /** Optional stance tag the debater took relative to the prior turns. */
  actionTag?: 'AGREE' | 'CHALLENGE' | 'SUPPLEMENT' | 'REFRAME'
  /** Optional one-line distillation of the turn's core claim. */
  claim?: string
  content: string
  /** True when this turn was assigned the adversarial / devil's-advocate role. */
  isRedTeam?: boolean
}

/** The facilitator's compressed, structured summary of one round. */
export type FacilitatorSummary = {
  roundNumber: number
  consensusPoints: { point: string; agreedBy: string[] }[]
  openIssues: { issue: string; positions: { ai: string; stance: string }[] }[]
  /** 0-100; how close the participants are to a single shared answer. */
  roundConsensusScore: number
  /** What the next round should focus on resolving. */
  nextDirective: string
}

/**
 * Rough token estimate for debugging / context-size logging.
 * Uses the common ~4-chars-per-token heuristic. Intentionally cheap and pure —
 * callers may log its result; this function itself never logs.
 */
export function countApproxTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

// ──────────────────────────────────────────────────────────────────────────
// Anonymization helpers
// ──────────────────────────────────────────────────────────────────────────

type Labeler = {
  /** Maps a real brand name to its display name (label when anonymizing, else itself). */
  disp: (aiName: string) => string
  /** label -> real aiName, e.g. { "Participant A": "Claude" }. Empty when not anonymizing. */
  labelMap: Record<string, string>
}

/** Stable label for the Nth distinct participant: A, B, ... Z, then Participant 27+. */
function labelForIndex(i: number): string {
  if (i < 26) return `Participant ${String.fromCharCode(65 + i)}`
  return `Participant ${i + 1}`
}

/**
 * Builds a labeler. When `anonymize` is false it is the identity mapping with an
 * empty labelMap. When true, distinct names are assigned Participant A/B/C... in
 * order of first appearance in `names`, so the same call produces a stable map.
 */
function makeLabeler(names: string[], anonymize: boolean): Labeler {
  if (!anonymize) {
    return { disp: (n) => n, labelMap: {} }
  }
  const ordered: string[] = []
  for (const n of names) {
    if (n && !ordered.includes(n)) ordered.push(n)
  }
  const realToLabel = new Map<string, string>()
  const labelMap: Record<string, string> = {}
  ordered.forEach((real, i) => {
    const label = labelForIndex(i)
    realToLabel.set(real, label)
    labelMap[label] = real
  })
  return {
    disp: (n) => realToLabel.get(n) ?? n,
    labelMap,
  }
}

/** Collects every brand name referenced by a set of turns, in appearance order. */
function namesFromTurns(turns: SynodTurn[]): string[] {
  return turns.map((t) => t.aiName)
}

/** Collects every brand name referenced inside facilitator summaries, in order. */
function namesFromSummaries(summaries: FacilitatorSummary[]): string[] {
  const out: string[] = []
  for (const s of summaries) {
    for (const cp of s.consensusPoints) out.push(...cp.agreedBy)
    for (const oi of s.openIssues) for (const p of oi.positions) out.push(p.ai)
  }
  return out
}

// ──────────────────────────────────────────────────────────────────────────
// Rendering helpers
// ──────────────────────────────────────────────────────────────────────────

/** Full, human-readable rendering of a facilitator summary (names via `disp`). */
function renderSummaryFull(s: FacilitatorSummary, disp: (n: string) => string): string {
  const lines: string[] = []
  lines.push(`Round ${s.roundNumber} facilitator summary — consensus score ${s.roundConsensusScore}/100`)

  if (s.consensusPoints.length) {
    lines.push('Consensus points:')
    for (const cp of s.consensusPoints) {
      const by = cp.agreedBy.map(disp).join(', ') || 'unspecified'
      lines.push(`  - ${cp.point} (agreed by: ${by})`)
    }
  } else {
    lines.push('Consensus points: none yet.')
  }

  if (s.openIssues.length) {
    lines.push('Open issues:')
    for (const oi of s.openIssues) {
      lines.push(`  - ${oi.issue}`)
      for (const p of oi.positions) {
        lines.push(`      • ${disp(p.ai)}: ${p.stance}`)
      }
    }
  } else {
    lines.push('Open issues: none.')
  }

  lines.push(`Next directive: ${s.nextDirective}`)
  return lines.join('\n')
}

/**
 * One-line collapse of an OLD facilitator summary — the token-saving form.
 * Only the consensus-point headlines + the score survive; open issues, agreedBy
 * lists, positions, and the directive are intentionally dropped.
 */
function renderSummaryOneLine(s: FacilitatorSummary): string {
  const headlines = s.consensusPoints.map((cp) => cp.point).join('; ') || '(no consensus recorded)'
  return `Round ${s.roundNumber} (score ${s.roundConsensusScore}/100): ${headlines}`
}

/** Renders a single debate turn with its tags (names via `disp`). */
function renderTurn(t: SynodTurn, disp: (n: string) => string): string {
  const tags: string[] = []
  if (t.isRedTeam) tags.push('RED TEAM')
  if (t.actionTag) tags.push(t.actionTag)
  const tagStr = tags.length ? ` (${tags.join(' · ')})` : ''
  const head = `[${disp(t.aiName)}${tagStr}]`
  const claimLine = t.claim ? `\nClaim: ${t.claim}` : ''
  return `${head}${claimLine}\n${t.content.trim()}`
}

// ──────────────────────────────────────────────────────────────────────────
// Public builders
// ──────────────────────────────────────────────────────────────────────────

/**
 * Builds the context injected into each debater's prompt for the current round.
 *
 * COMPRESSION CORE (do not weaken — see file header):
 *   • priorSummaries are sorted by round; the LATEST one is rendered IN FULL.
 *   • EVERY OLDER summary is collapsed to a single headline line.
 *   • Raw prior-round transcripts are NEVER included — only summaries.
 *
 * `currentRoundTurns` are the turns already spoken THIS round (serial flow), so
 * the next speaker can react; these are shown in full because they are the live,
 * not-yet-summarized state.
 *
 * Returns `{ text, labelMap }`. When `anonymize` is true, every aiName (in turns
 * and inside summaries) is replaced with a stable "Participant X" label and
 * `labelMap` maps each label back to the real brand name; otherwise `labelMap`
 * is empty. (The original spec typed this as `string`; an object is returned so
 * the anonymization map can be surfaced, matching buildVerdictInput.)
 */
export function buildDeliberationContext(params: {
  question: string
  priorSummaries: FacilitatorSummary[]
  currentRoundTurns: SynodTurn[]
  anonymize: boolean
}): { text: string; labelMap: Record<string, string> } {
  const { question, priorSummaries, currentRoundTurns, anonymize } = params

  // Build the labeler from ALL names that will appear, so anonymization is
  // consistent across both the live turns and the carried-forward summaries.
  const allNames = [...namesFromTurns(currentRoundTurns), ...namesFromSummaries(priorSummaries)]
  const { disp, labelMap } = makeLabeler(allNames, anonymize)

  const sorted = [...priorSummaries].sort((a, b) => a.roundNumber - b.roundNumber)

  const sections: string[] = []
  sections.push(`QUESTION:\n${question.trim()}`)

  if (sorted.length) {
    const historyLines: string[] = [
      'DELIBERATION HISTORY (compressed to control token cost: older rounds are one',
      'line each; ONLY the most recent facilitator summary is shown in full):',
      '',
    ]

    // ── Token-saving core: older summaries → one line each. ──
    const older = sorted.slice(0, -1)
    for (const s of older) {
      historyLines.push(renderSummaryOneLine(s))
    }

    // ── The single most recent summary → full detail. ──
    const latest = sorted[sorted.length - 1]!
    if (older.length) historyLines.push('')
    historyLines.push(renderSummaryFull(latest, disp))

    sections.push(historyLines.join('\n'))
  } else {
    sections.push('DELIBERATION HISTORY:\n(This is the first round — no prior summaries.)')
  }

  if (currentRoundTurns.length) {
    const turnLines = ['THIS ROUND SO FAR (serial — read and react to what was already said):']
    for (const t of currentRoundTurns) {
      turnLines.push('')
      turnLines.push(renderTurn(t, disp))
    }
    sections.push(turnLines.join('\n'))
  } else {
    sections.push('THIS ROUND SO FAR:\n(You are the first to speak this round.)')
  }

  return { text: sections.join('\n\n'), labelMap }
}

/**
 * Builds the input the facilitator (GPT-5.4) reads to produce a FacilitatorSummary
 * for `roundNumber`.
 *
 * Per the compression rule, prior rounds are given ONLY as a one-line score recap
 * (the facilitator already produced their detailed summaries earlier). This round's
 * turns are included IN FULL because the facilitator's job is to compress them.
 * Names are kept real here — the facilitator is neutral and benefits from identity.
 */
export function buildFacilitatorInput(params: {
  question: string
  roundNumber: number
  allTurnsThisRound: SynodTurn[]
  priorSummaries: FacilitatorSummary[]
}): string {
  const { question, roundNumber, allTurnsThisRound, priorSummaries } = params
  const disp = (n: string) => n // facilitator sees real brand names

  const sections: string[] = []
  sections.push(`QUESTION:\n${question.trim()}`)

  const sorted = [...priorSummaries].sort((a, b) => a.roundNumber - b.roundNumber)
  if (sorted.length) {
    const recap = sorted
      .map((s) => `Round ${s.roundNumber}: consensus score ${s.roundConsensusScore}/100`)
      .join('\n')
    sections.push(`PRIOR ROUNDS (score recap only):\n${recap}`)
  } else {
    sections.push('PRIOR ROUNDS (score recap only):\n(None — this is round 1.)')
  }

  const turnLines = [`ROUND ${roundNumber} — ALL TURNS (full text, summarize these):`]
  for (const t of allTurnsThisRound) {
    turnLines.push('')
    turnLines.push(renderTurn(t, disp))
  }
  sections.push(turnLines.join('\n'))

  sections.push(
    [
      'TASK:',
      'Produce a FacilitatorSummary for this round: list consensusPoints (with who',
      'agreed), openIssues (with each participant\'s stance), a roundConsensusScore',
      '(0-100), and a nextDirective for the following round.',
    ].join('\n')
  )

  return sections.join('\n\n')
}

/**
 * Builds the input for the verdict chair (Claude Opus 4.8).
 *
 * ALWAYS anonymized: the judge must not be able to favor any branded model
 * (self-preference / brand bias). Every real name in both the summaries and the
 * final-round transcript is replaced with a stable "Participant X" label, and the
 * returned `labelMap` lets the caller de-anonymize the chosen winner afterward.
 *
 * The full set of facilitator summaries is included (they are already compressed)
 * plus the final round's turns in full, since the verdict weighs the closing
 * arguments most heavily.
 */
export function buildVerdictInput(params: {
  question: string
  allSummaries: FacilitatorSummary[]
  finalRoundTurns: SynodTurn[]
  anonymize: true
}): { text: string; labelMap: Record<string, string> } {
  const { question, allSummaries, finalRoundTurns } = params

  // Verdict input is always anonymized regardless of the flag's nominal value.
  const allNames = [...namesFromTurns(finalRoundTurns), ...namesFromSummaries(allSummaries)]
  const { disp, labelMap } = makeLabeler(allNames, true)

  const sorted = [...allSummaries].sort((a, b) => a.roundNumber - b.roundNumber)

  const sections: string[] = []
  sections.push(`QUESTION:\n${question.trim()}`)

  if (sorted.length) {
    const summaryBlocks = sorted.map((s) => renderSummaryFull(s, disp)).join('\n\n')
    sections.push(`FACILITATOR SUMMARIES (anonymized, all rounds):\n\n${summaryBlocks}`)
  } else {
    sections.push('FACILITATOR SUMMARIES (anonymized):\n(None.)')
  }

  const turnLines = ['FINAL ROUND TRANSCRIPT (anonymized — closing arguments):']
  for (const t of finalRoundTurns) {
    turnLines.push('')
    turnLines.push(renderTurn(t, disp))
  }
  sections.push(turnLines.join('\n'))

  sections.push(
    [
      'TASK:',
      'Weigh the deliberation and choose the single best consensus answer. Judge the',
      'ideas on their merits only — you do not know which participant is which model,',
      'and you must not speculate about their identities.',
    ].join('\n')
  )

  return { text: sections.join('\n\n'), labelMap }
}
