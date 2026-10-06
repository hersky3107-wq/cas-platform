/**
 * Client-safe, sanitized view of a deep run's persisted pipeline state.
 *
 * The durable runner saves the full pipeline state after every hop; this
 * module projects that state into what the card UI may render — plan
 * seats, the shared briefing, per-model analyses as they land, debate
 * rounds/turns, the ballot, and the chair verdict — and drops the packet
 * context, research snapshot, and prompt internals.
 *
 * PURE module: no 'server-only', no async_hooks. The builder runs
 * server-side (deep-http); the client imports only the types plus
 * `deepBrandLabel`. Brand labels are duplicated from deep-prompts because
 * that module pulls the output-language ALS (node:async_hooks) and must
 * never enter a client bundle.
 */

import type { SourceTier } from './deep-report-dossier'
import {
  agreementOf,
  dossierSections,
  findingByRef,
  mergeFindings,
  type ResearchFinding,
} from './deep-report-findings'
import { pairDebaters, rebuttalsAwaitCounter } from './deep-debate-pairs'
import type { ResearchAngle } from './deep-report-policy'
import { plainText, readerText, tallyVotes, type EvidencePoint, type ReplyStance } from './deep-report-structured'
import { visibleLeagueText } from './visible-disclosure'

export type DeepSeatSnapshot = {
  roleId: string
  roleLabel: string
  provider: string
  brand: string
  /** Open product: the seat's assigned sub-question. */
  subQuestion?: string
  /** Debate product: the seat's mandate. */
  mandate?: string
}

export type DeepAnalysisSnapshot = {
  roleId: string
  roleLabel: string
  provider: string
  brand: string
  content: string | null
  ok: boolean
  error?: string
}

export type DeepTurnSnapshot = {
  roleLabel: string
  provider: string
  brand: string
  position: string | null
  concedes: string | null
  holds: string | null
  ok: boolean
}

export type DeepRoundSnapshot = {
  roundNumber: number
  consensusScore: number
  summary: string
  turns: DeepTurnSnapshot[]
}

export type DeepVoteSnapshot = {
  approve: number
  conditional: number
  oppose: number
  abstain: number
  summary: string
  votes: { provider: string; brand: string; choice: string | null; reason: string | null; ok: boolean }[]
}

export type DeepVerdictSnapshot = {
  judgment: string | null
  keyIssues: string | null
  minorityReport: string | null
  consensusScore: number | null
}

export type DeepOpenSnapshot = {
  kind: 'open'
  instrument: string | null
  proposition: string | null
  plan: DeepSeatSnapshot[] | null
  briefing: string | null
  analyses: DeepAnalysisSnapshot[]
  synthesis: string | null
}

export type DeepDebateSnapshot = {
  kind: 'debate'
  instrument: string | null
  proposition: string | null
  plan: DeepSeatSnapshot[] | null
  briefing: string | null
  rounds: DeepRoundSnapshot[]
  vote: DeepVoteSnapshot | null
  verdict: DeepVerdictSnapshot | null
}

export type DeepReportSide = 'yes' | 'no'
export type DeepReportStage = 'research' | 'opening' | 'rebuttal' | 'counter' | 'chair' | 'done'

export type DeepReportExchange = {
  claimBrand: string
  claimText: string
  rebuttalBrand: string
  rebuttalText: string
  quote: string
  replyBrand: string | null
  replyText: string | null
  stance: ReplyStance | null
}

export type DeepReportThread = {
  id: string
  exchanges: DeepReportExchange[]
  openings: { brand: string; headline: string | null; points: DeepReportPoint[] }[]
}

export type DeepReportConcession = { brand: string; text: string }

export type DeepReportEvidence = {
  ref: string | null
  claim: string
  date: string | null
  source: string | null
  url: string | null
  tier: SourceTier
  agreement: number
}

export type DeepReportPoint = { text: string; source: string | null }

export type DeepReportSeat = {
  provider: string
  brand: string
  assignedSide: DeepReportSide
  finalSide: DeepReportSide | null
  finalProbability: number | null
  changedMind: boolean
  whyChanged: string | null
  headline: string | null
  strongestPoint: DeepReportPoint | null
  rebuttalLine: DeepReportPoint | null
  opening: { headline: string | null; points: DeepReportPoint[] } | null
  rebuttal: { headline: string | null; rebuttal: DeepReportPoint[]; points: DeepReportPoint[] } | null
  openingDone: boolean
  rebuttalDone: boolean
}

export type DeepReportVerdict = {
  side: DeepReportSide
  probability: number
  oneLine: string
  relation: 'stronger' | 'weaker' | 'opposite' | null
  ai40: { side: DeepReportSide; confidence: number } | null
  why: string | null
}

export type DeepReportSnapshot = {
  kind: 'report'
  /** Always null: the instrument code is internal. Kept for the shared snapshot shape. */
  instrument: null
  proposition: string | null
  sideWords: { yes: string; no: string }
  stage: DeepReportStage
  progress: { sourcesFound: number; openingsDone: number; rebuttalsDone: number; countersDone: number; debaters: number }
  threads: DeepReportThread[]
  concessions: DeepReportConcession[]
  researchPath: string | null
  verdict: DeepReportVerdict | null
  vote: { yes: number; no: number; counted: number; total: number; majority: DeepReportSide | null; majorityCount: number } | null
  seats: DeepReportSeat[]
  keyEvidence: DeepReportEvidence[]
  judgment: string[]
  minorityView: string | null
  flipTriggers: { event: string; byDate: string | null }[]
  scenarios: { name: string; weight: number }[]
  dossier: { key: ResearchAngle; items: DeepReportEvidence[] }[]
  /** Plain text of a report generated before the structured contract. */
  legacyText: string | null
}

export type DeepSnapshot = DeepOpenSnapshot | DeepDebateSnapshot | DeepReportSnapshot

/** Duplicated from deep-prompts' LEAGUE_DEEP_BRAND_LABEL (see module doc). */
const BRAND_LABEL: Record<string, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  solar: 'Solar',
  'glm-5.2': 'GLM',
  perplexity: 'Perplexity',
  meta: 'Llama',
}

export function deepBrandLabel(provider: string): string {
  return BRAND_LABEL[provider] ?? provider
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

function vis(category: string | undefined, v: unknown): string | null {
  const raw = str(v)
  if (!raw) return null
  return visibleLeagueText(category, raw)
}

function seatFrom(raw: Record<string, unknown>, kind: 'open' | 'debate'): DeepSeatSnapshot {
  const provider = str(raw.provider) ?? 'unknown'
  return {
    roleId: str(raw.roleId) ?? provider,
    roleLabel: str(raw.roleLabel) ?? 'Analyst',
    provider,
    brand: deepBrandLabel(provider),
    ...(kind === 'open' ? { subQuestion: str(raw.subQuestion) ?? str(raw.mandate) ?? undefined } : {}),
    ...(kind === 'debate' ? { mandate: str(raw.mandate) ?? undefined } : {}),
  }
}

function planSeats(plan: unknown, kind: 'open' | 'debate'): DeepSeatSnapshot[] | null {
  if (!plan || typeof plan !== 'object') return null
  const roles = (plan as { roles?: unknown }).roles
  if (!Array.isArray(roles) || roles.length === 0) return null
  return roles
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => seatFrom(r, kind))
}

function turnsFrom(raw: unknown, category?: string): DeepTurnSnapshot[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => {
      const provider = str(t.provider) ?? 'unknown'
      return {
        roleLabel: str(t.roleLabel) ?? 'Analyst',
        provider,
        brand: deepBrandLabel(provider),
        position: vis(category, t.position),
        concedes: vis(category, t.concedes),
        holds: vis(category, t.holds),
        ok: t.ok === true,
      }
    })
}

function roundsFrom(raw: unknown, category?: string): DeepRoundSnapshot[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      roundNumber: typeof r.roundNumber === 'number' ? r.roundNumber : 0,
      consensusScore: typeof r.consensusScore === 'number' ? r.consensusScore : -1,
      summary: vis(category, r.summary) ?? '',
      turns: turnsFrom(r.turns, category),
    }))
}

/**
 * Builds the sanitized snapshot from a run row's `state`. Returns null
 * for the pre-seed placeholder (nothing to show yet).
 */
export function buildDeepSnapshot(
  product: 'open' | 'debate' | 'report',
  state: Record<string, unknown> | null | undefined
): DeepSnapshot | null {
  if (!state || typeof state !== 'object') return null
  if ((state as { __unseeded?: unknown }).__unseeded === true) return null
  if (product === 'open') return buildOpenSnapshot(state)
  if (product === 'debate') return buildDebateSnapshot(state)
  return buildReportSnapshot(state)
}

const REPORT_TIERS: readonly SourceTier[] = ['official', 'regulator', 'major_outlet', 'rumor', 'other']

function asReportSide(v: unknown): DeepReportSide | null {
  return v === 'yes' || v === 'no' ? v : null
}

function asTier(v: unknown): SourceTier {
  return REPORT_TIERS.includes(v as SourceTier) ? (v as SourceTier) : 'other'
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function safeUrl(v: unknown): string | null {
  const url = str(v)
  return url && /^https?:\/\//i.test(url) ? url : null
}

/** User-visible prose: display scrub, then no markdown residue. */
function prose(category: string | undefined, v: unknown): string | null {
  const text = vis(category, v)
  if (!text) return null
  const plain = plainText(text)
  return plain || null
}

function findingsOf(raw: unknown): ResearchFinding[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && typeof row.claim === 'string')
    .map((row) => ({
      claim: String(row.claim),
      date: str(row.date),
      sourceTitle: str(row.sourceTitle),
      sourceUrl: safeUrl(row.sourceUrl),
      tier: asTier(row.tier),
      side: row.side === 'yes' || row.side === 'no' ? row.side : 'context',
      queryKey: (str(row.queryKey) ?? 'changed_30d') as ResearchAngle,
      providers: Array.isArray(row.providers) ? row.providers.filter((p): p is string => typeof p === 'string') : [],
      ...(str(row.ref) ? { ref: str(row.ref)! } : {}),
    }))
}

function evidenceOf(category: string | undefined, finding: ResearchFinding): DeepReportEvidence | null {
  const claim = prose(category, finding.claim)
  if (!claim) return null
  return {
    ref: finding.ref ?? null,
    claim,
    date: finding.date,
    source: prose(category, finding.sourceTitle) ?? hostOf(finding.sourceUrl),
    url: finding.sourceUrl,
    tier: finding.tier,
    agreement: Math.max(1, agreementOf(finding)),
  }
}

type Say = (v: unknown) => string | null

function pointsOf(category: string | undefined, raw: unknown, findings: ResearchFinding[], say: Say): DeepReportPoint[] {
  if (!Array.isArray(raw)) return []
  const out: DeepReportPoint[] = []
  for (const item of raw as EvidencePoint[]) {
    if (!item || typeof item !== 'object') continue
    const text = say(item.text)
    if (!text) continue
    const finding = findingByRef(findings, item.ref)
    const source = finding ? prose(category, finding.sourceTitle) ?? hostOf(finding.sourceUrl) : null
    out.push({ text, source })
  }
  return out
}

type RawTurn = Record<string, unknown>

function turnRows(raw: unknown): RawTurn[] {
  return Array.isArray(raw) ? raw.filter((row): row is RawTurn => !!row && typeof row === 'object') : []
}

function asReplyStance(raw: unknown): ReplyStance | null {
  return raw === 'concede' || raw === 'partial' || raw === 'defend' ? raw : null
}

function reportConcessions(counters: readonly RawTurn[], say: Say): DeepReportConcession[] {
  return counters
    .filter((row) => row.ok === true && (row.stance === 'concede' || row.stance === 'partial'))
    .map((row) => ({ brand: deepBrandLabel(str(row.provider) ?? ''), text: say(row.reply) ?? '' }))
    .filter((row) => row.brand.length > 0 && row.text.length > 0)
}

function reportThreads(
  roundId: string,
  openings: readonly RawTurn[],
  rebuttals: readonly RawTurn[],
  counters: readonly RawTurn[],
  say: Say,
): DeepReportThread[] {
  if (!rebuttals.some((row) => row.ok === true && typeof row.quotedClaim === 'string' && row.quotedClaim)) return []
  const seats = openings
    .filter((row) => row.ok === true && (row.side === 'yes' || row.side === 'no'))
    .map((row) => ({
      provider: str(row.provider) ?? '',
      model: str(row.model) ?? '',
      assignedSide: row.side as 'yes' | 'no',
      finalSide: row.finalSide === 'yes' || row.finalSide === 'no' ? row.finalSide : null,
    }))
    .filter((row) => row.provider && row.model)
  return pairDebaters(roundId, seats)
    .map((pair): DeepReportThread | null => {
      const exchanges = [pair.yes, pair.no]
        .map((seat) => {
          const foe = seat.provider === pair.yes.provider ? pair.no : pair.yes
          const attack = rebuttals.find((row) => row.provider === foe.provider && row.ok === true)
          const quote = say(attack?.quotedClaim)
          const rebuttal = say(attack?.rebuttalText) ?? ''
          if (!quote || !rebuttal) return null
          const reply = counters.find((row) => row.provider === seat.provider && row.ok === true)
          const stance = asReplyStance(reply?.stance)
          const replyText = stance ? say(reply?.reply) : null
          return {
            claimBrand: deepBrandLabel(seat.provider),
            claimText: quote,
            rebuttalBrand: deepBrandLabel(foe.provider),
            rebuttalText: rebuttal,
            quote,
            replyBrand: replyText ? deepBrandLabel(seat.provider) : null,
            replyText,
            stance: replyText ? stance : null,
          }
        })
        .filter((row): row is DeepReportExchange => row !== null)
      if (exchanges.length === 0) return null
      const openingsOf = [pair.yes, pair.no].map((seat) => {
        const open = openings.find((row) => row.provider === seat.provider)
        return {
          brand: deepBrandLabel(seat.provider),
          headline: say(open?.headline),
          points: Array.isArray(open?.points)
            ? (open!.points as { text?: unknown }[])
                .map((point) => say(point?.text))
                .filter((text): text is string => Boolean(text))
                .map((text) => ({ text, source: null }))
            : [],
        }
      })
      return { id: `${pair.yes.provider}:${pair.no.provider}`, exchanges, openings: openingsOf }
    })
    .filter((row): row is DeepReportThread => row !== null)
}

function reportStage(state: Record<string, unknown>): DeepReportStage {
  const result = state.result as { ok?: unknown } | null | undefined
  if (result?.ok === true) return 'done'
  if (!state.research) return 'research'
  if (!state.openings) return 'opening'
  if (!state.rebuttals) return 'rebuttal'
  if (!state.counters && rebuttalsAwaitCounter(state.rebuttals)) return 'counter'
  return 'chair'
}

function buildReportSnapshot(state: Record<string, unknown>): DeepReportSnapshot {
  const category = str(state.category) ?? undefined
  const sideWordsRaw = (state.sideWords ?? {}) as { yes?: unknown; no?: unknown }
  const sideWords = { yes: str(sideWordsRaw.yes) ?? 'YES', no: str(sideWordsRaw.no) ?? 'NO' }
  const research = (state.research ?? null) as { findings?: unknown; path?: unknown; sourcesFound?: unknown; dossier?: unknown } | null
  const pending = (state.researchPending ?? null) as { seatFindings?: unknown; path?: unknown } | null
  const findings = findingsOf(research?.findings)
  const pendingFindings = Array.isArray(pending?.seatFindings)
    ? mergeFindings((pending!.seatFindings as unknown[]).map(findingsOf))
    : []

  const refLabel = (ref: string) => {
    const finding = findingByRef(findings, ref)
    return finding ? (prose(category, finding.sourceTitle) ?? hostOf(finding.sourceUrl)) : null
  }
  const say: Say = (v) => {
    const text = prose(category, v)
    return text ? readerText(text, { refLabel, sideWords }) || null : null
  }

  const openings = turnRows(state.openings ?? state.openingDraft)
  const rebuttals = turnRows(state.rebuttals ?? state.rebuttalDraft)
  const counters = turnRows(state.counters ?? state.counterDraft)
  const structured = openings.some((row) => Array.isArray(row.points))

  const seats: DeepReportSeat[] = structured
    ? openings
        .map((open): DeepReportSeat | null => {
          const provider = str(open.provider) ?? 'unknown'
          const assignedSide = asReportSide(open.side)
          if (!assignedSide) return null
          const reb = rebuttals.find((row) => row.provider === provider) ?? null
          const counter = counters.find((row) => row.provider === provider) ?? null
          const openOk = open.ok === true
          const rebOk = reb?.ok === true
          const counterOk = counter?.ok === true && asReportSide(counter?.finalSide) != null
          const finalTurn = counterOk ? counter! : rebOk && asReportSide(reb?.finalSide) ? reb! : openOk ? open : null
          const openingPoints = pointsOf(category, open.points, findings, say)
          const rebuttalItems = rebOk ? pointsOf(category, reb!.rebuttal, findings, say) : []
          const rebuttalPoints = rebOk ? pointsOf(category, reb!.points, findings, say) : []
          return {
            provider,
            brand: deepBrandLabel(provider),
            assignedSide,
            finalSide: finalTurn ? asReportSide(finalTurn.finalSide) : null,
            finalProbability: finalTurn ? num(finalTurn.finalProbability) : null,
            changedMind: false,
            whyChanged: counterOk ? say(counter!.whyChanged) : rebOk ? say(reb!.whyChanged) : null,
            headline: say(rebOk ? reb!.headline : open.headline) ?? say(open.headline),
            strongestPoint: rebuttalPoints[0] ?? openingPoints[0] ?? null,
            rebuttalLine: rebuttalItems[0] ?? null,
            opening: openOk ? { headline: say(open.headline), points: openingPoints } : null,
            rebuttal: rebOk ? { headline: say(reb!.headline), rebuttal: rebuttalItems, points: rebuttalPoints } : null,
            openingDone: openOk,
            rebuttalDone: rebOk,
          }
        })
        .filter((seat): seat is DeepReportSeat => seat !== null)
    : []

  const tally = tallyVotes(
    seats.map((seat) => ({
      provider: seat.provider,
      model: seat.provider,
      assignedSide: seat.assignedSide,
      finalSide: seat.finalSide,
      finalProbability: seat.finalProbability,
    })),
  )
  tally.seats.forEach((vote, i) => {
    const seat = seats[i]!
    seat.finalSide = vote.finalSide
    seat.finalProbability = vote.finalProbability
    seat.changedMind = vote.changedMind
    if (!vote.changedMind) seat.whyChanged = null
  })

  const chair = (state.chair ?? null) as Record<string, unknown> | null
  const verdictSide = asReportSide(chair?.verdictSide)
  const verdictProbability = num(chair?.verdictProbability)
  const ai40Raw = (chair?.ai40 ?? null) as { side?: unknown; confidence?: unknown } | null
  const ai40Side = asReportSide(ai40Raw?.side)
  const ai40Confidence = num(ai40Raw?.confidence)
  const relation = chair?.relation === 'stronger' || chair?.relation === 'weaker' || chair?.relation === 'opposite' ? chair.relation : null
  const verdict: DeepReportVerdict | null =
    chair && verdictSide && verdictProbability != null
      ? {
          side: verdictSide,
          probability: verdictProbability,
          oneLine: say(chair.oneLine) ?? '',
          relation,
          ai40: ai40Side && ai40Confidence != null ? { side: ai40Side, confidence: ai40Confidence } : null,
          why: say(chair.vs40Why),
        }
      : null

  const keyEvidence: DeepReportEvidence[] = (Array.isArray(chair?.keyEvidence) ? (chair!.keyEvidence as unknown[]) : [])
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row): DeepReportEvidence | null => {
      const finding = findingByRef(findings, str(row.ref))
      const claim = say(row.claim)
      if (!claim) return null
      return {
        ref: finding?.ref ?? null,
        claim,
        date: str(row.date) ?? finding?.date ?? null,
        source: prose(category, row.source) ?? (finding ? prose(category, finding.sourceTitle) ?? hostOf(finding.sourceUrl) : null),
        url: finding?.sourceUrl ?? null,
        tier: finding ? finding.tier : asTier(row.tier),
        agreement: finding ? Math.max(1, agreementOf(finding)) : 1,
      }
    })
    .filter((row): row is DeepReportEvidence => row !== null)
    .slice(0, 5)

  const proseList = (raw: unknown): string[] =>
    Array.isArray(raw) ? raw.map((line) => say(line)).filter((line): line is string => Boolean(line)) : []

  const legacyRaw = !structured ? (str(state.chairReport) ?? str((state.result as { report?: unknown } | null)?.report)) : null
  const legacyVisible = legacyRaw && !verdict ? vis(category, legacyRaw) : null
  const legacyText = legacyVisible
    ? legacyVisible
        .split('\n')
        .map((line) => plainText(line))
        .filter(Boolean)
        .join('\n') || null
    : null

  return {
    kind: 'report',
    instrument: null,
    proposition: prose(category, state.proposition),
    sideWords,
    stage: reportStage(state),
    progress: {
      sourcesFound: num(research?.sourcesFound) ?? (findings.length || pendingFindings.length),
      openingsDone: seats.filter((seat) => seat.openingDone).length,
      rebuttalsDone: seats.filter((seat) => seat.rebuttalDone).length,
      countersDone: counters.filter((row) => row.ok === true && typeof row.reply === 'string').length,
      debaters: Math.max(seats.length, 6),
    },
    threads: reportThreads(str(state.roundId) ?? '', openings, rebuttals, counters, say),
    concessions: reportConcessions(counters, say),
    researchPath: str(research?.path) ?? str(pending?.path),
    verdict,
    vote: tally.counted > 0 ? { yes: tally.yes, no: tally.no, counted: tally.counted, total: tally.total, majority: tally.majority, majorityCount: tally.majorityCount } : null,
    seats,
    keyEvidence,
    judgment: proseList(chair?.debateJudgment).slice(0, 3),
    minorityView: say(chair?.minorityView),
    flipTriggers: (Array.isArray(chair?.flipTriggers) ? (chair!.flipTriggers as unknown[]) : [])
      .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
      .map((row) => ({ event: say(row.event) ?? '', byDate: str(row.byDate) }))
      .filter((row) => row.event.length > 0)
      .slice(0, 3),
    scenarios: (Array.isArray(chair?.scenarios) ? (chair!.scenarios as unknown[]) : [])
      .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
      .map((row) => ({ name: say(row.name) ?? '', weight: num(row.weight) ?? 0 }))
      .filter((row) => row.name.length > 0)
      .slice(0, 3),
    dossier: dossierSections(findings).map((section) => ({
      key: section.key,
      items: section.items.map((finding) => evidenceOf(category, finding)).filter((row): row is DeepReportEvidence => row !== null),
    })),
    legacyText,
  }
}

export function emptyReportSnapshot(): DeepReportSnapshot {
  return {
    kind: 'report',
    instrument: null,
    proposition: null,
    sideWords: { yes: 'YES', no: 'NO' },
    stage: 'research',
    progress: { sourcesFound: 0, openingsDone: 0, rebuttalsDone: 0, countersDone: 0, debaters: 6 },
    threads: [],
    concessions: [],
    researchPath: null,
    verdict: null,
    vote: null,
    seats: [],
    keyEvidence: [],
    judgment: [],
    minorityView: null,
    flipTriggers: [],
    scenarios: [],
    dossier: [],
    legacyText: null,
  }
}

function buildOpenSnapshot(state: Record<string, unknown>): DeepOpenSnapshot {
  const category = str(state.category) ?? undefined
  const analysesRaw = Array.isArray(state.analyses) ? state.analyses : []
  const result = (state.result ?? null) as { synthesis?: unknown } | null
  return {
    kind: 'open',
    instrument: str(state.instrument),
    proposition: str(state.proposition),
    plan: planSeats(state.plan, 'open'),
    briefing: vis(category, state.report),
    analyses: analysesRaw
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .map((a) => {
        const provider = str(a.provider) ?? 'unknown'
        return {
          roleId: str(a.roleId) ?? provider,
          roleLabel: str(a.roleLabel) ?? 'Analyst',
          provider,
          brand: deepBrandLabel(provider),
          content: vis(category, a.analysis),
          ok: a.ok === true,
          ...(str(a.error) ? { error: str(a.error)! } : {}),
        }
      }),
    synthesis: result ? vis(category, result.synthesis) : null,
  }
}

function buildDebateSnapshot(state: Record<string, unknown>): DeepDebateSnapshot {
  const category = str(state.category) ?? undefined
  const deliberation = (state.deliberation ?? null) as { rounds?: unknown; finalScore?: unknown } | null
  const result = (state.result ?? null) as {
    consensusScore?: unknown
    vote?: { approve?: unknown; oppose?: unknown; conditional?: unknown; abstain?: unknown; summary?: unknown } | null
    verdict?: { judgment?: unknown; keyIssues?: unknown; minorityReport?: unknown } | null
  } | null

  // New pipeline persists rounds incrementally; pre-split rows only have
  // them inside the assembled deliberation. Prefer the live list.
  const rounds = roundsFrom(Array.isArray(state.rounds) ? state.rounds : deliberation?.rounds, category)

  const voteState = (state.vote ?? null) as {
    votes?: unknown
    approveCount?: unknown
    conditionalCount?: unknown
    opposeCount?: unknown
    abstainCount?: unknown
    summary?: unknown
  } | null

  let vote: DeepVoteSnapshot | null = null
  if (voteState && typeof voteState === 'object') {
    const votesRaw = Array.isArray(voteState.votes) ? voteState.votes : []
    vote = {
      approve: typeof voteState.approveCount === 'number' ? voteState.approveCount : 0,
      conditional: typeof voteState.conditionalCount === 'number' ? voteState.conditionalCount : 0,
      oppose: typeof voteState.opposeCount === 'number' ? voteState.opposeCount : 0,
      abstain: typeof voteState.abstainCount === 'number' ? voteState.abstainCount : 0,
      summary: vis(category, voteState.summary) ?? '',
      votes: votesRaw
        .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
        .map((v) => {
          const provider = str(v.provider) ?? 'unknown'
          return {
            provider,
            brand: deepBrandLabel(provider),
            choice: str(v.choice),
            reason: vis(category, v.reason),
            ok: v.ok === true,
          }
        }),
    }
  } else if (result?.vote && typeof result.vote === 'object') {
    // Terminal rows from before the vote hop split: counts only.
    const rv = result.vote
    vote = {
      approve: typeof rv.approve === 'number' ? rv.approve : 0,
      conditional: typeof rv.conditional === 'number' ? rv.conditional : 0,
      oppose: typeof rv.oppose === 'number' ? rv.oppose : 0,
      abstain: typeof rv.abstain === 'number' ? rv.abstain : 0,
      summary: vis(category, rv.summary) ?? '',
      votes: [],
    }
  }

  const verdict: DeepVerdictSnapshot | null =
    result?.verdict && typeof result.verdict === 'object'
      ? {
          judgment: vis(category, result.verdict.judgment),
          keyIssues: vis(category, result.verdict.keyIssues),
          minorityReport: vis(category, result.verdict.minorityReport),
          consensusScore:
            typeof result.consensusScore === 'number'
              ? result.consensusScore
              : typeof deliberation?.finalScore === 'number'
                ? deliberation.finalScore
                : null,
        }
      : null

  return {
    kind: 'debate',
    instrument: str(state.instrument),
    proposition: str(state.proposition),
    plan: planSeats(state.plan, 'debate'),
    briefing: vis(category, state.report),
    rounds,
    vote,
    verdict,
  }
}
