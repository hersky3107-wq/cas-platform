/**
 * ai_payload builders.
 *
 * Both builders work from an ALLOWLIST: computed vectors, confidence flags,
 * and machine reason codes. Raw profile data is never copied in, and
 * `assertNoPersonalData` gates the result (see privacy.ts).
 *
 * The only fields deliberately outside that assertion live under `context`
 * (see OracleAiContext) — a closed, two-field shape.
 */
import { AXES_LAYER_VERSION } from '../axes/conventions'
import type { AxisConsensus, AxisVote, ReadingScope } from '../axes/types'
import type { OracleReading, OracleSessionKind } from '../schema'
import { ORACLE_RUNNER_VERSION } from './conventions'
import { buildNativeChart } from './native-chart'
import { assertNoPersonalData, type PersonalData } from './privacy'
import type { JsonObject } from './types'

/**
 * How much of each layer-1 narrative the synthesis sees. Sized to the layer-1
 * narrative budget (700–1100 chars, FIX 3): 400 units keeps ~the first half of
 * a max-length reading, which is where the chart facts land under prompt v4.
 */
export const SYNTHESIS_NARRATIVE_MAX_TOKENS = 400

/**
 * Conservative tokenizer-free cap. CJK characters, words, numbers and
 * punctuation count as units; an additional 600-code-point ceiling prevents
 * long unbroken Latin strings from escaping the budget.
 */
export function truncateNarrativeForSynthesis(
  text: string,
  maxTokens = SYNTHESIS_NARRATIVE_MAX_TOKENS,
): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  const units = compact.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+|[^\s]/gu) ?? []
  const capped = units.slice(0, maxTokens).join(' ')
    .replace(/\s+([.,!?;:)\]}])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
  return Array.from(capped).slice(0, maxTokens * 3).join('')
}

export function axisConsensusPayload(consensus: AxisConsensus): JsonObject {
  return {
    phase: {
      tally: consensus.phase.tally,
      leader: consensus.phase.leader,
      leaderShare: consensus.phase.leaderShare,
      unanimityCount: consensus.phase.unanimityCount,
      participantCount: consensus.phase.participantCount,
      coreTally: consensus.phase.coreTally,
      polarized: consensus.phase.polarized,
      oppositions: consensus.phase.oppositions,
      participating: consensus.phase.participating,
      unreadable: consensus.phase.unreadable,
    },
    traits: {
      profile: consensus.traits.profile,
      spread: consensus.traits.spread,
      contested: consensus.traits.contested,
      participating: consensus.traits.participating,
      unreadable: consensus.traits.unreadable,
    },
    elements: {
      total: consensus.elements.total,
      deficiency: consensus.elements.deficiency,
      excess: consensus.elements.excess,
      participating: consensus.elements.participating,
      unreadable: consensus.elements.unreadable,
    },
    systemCount: consensus.systemCount,
  }
}

/**
 * Projector reason / unreadable codes come from static tables, never from the
 * profile, so they are exempt from the value scan (keys are still enforced).
 * See PrivacyScanOptions for the collision this avoids.
 */
export const MACHINE_CODE_FIELDS = ['reasons', 'labels', 'unreadable'] as const

/**
 * Context fields intentionally OUTSIDE the birth-data assertion:
 *
 *   asOfDate — today's calendar date. Public, identifies nobody, and it can
 *              legitimately equal the subject's birth date on their
 *              birthday, which is exactly why it cannot sit inside the
 *              assertion without producing a false positive.
 *   question — the user's own words, deliberately submitted for this
 *              reading. The privacy rule covers data the user never chose
 *              to send, not their own prose.
 *
 * Nothing else may ever be added to this shape.
 */
export type OracleAiContext = {
  asOfDate: string
  question: string | null
}

export type PayloadContext = {
  kind: OracleSessionKind
  locale: string
  readingScope: ReadingScope
  asOfDate: string
  question: string | null
  /** 세 / 虚岁 from birth year + asOfDate. Used only to mark 현재 대운/대한. Never emitted. */
  nominalAge?: number | null
}

/**
 * `readingInput` states what the payload body carries: 'native' for a layer-1
 * reading (that system's own chart), 'axes' for the layer-2 verdict payload
 * (the cross-system projection — the only place it belongs).
 */
function envelope(ctx: PayloadContext, readingInput: 'native' | 'axes'): JsonObject {
  return {
    runnerVersion: ORACLE_RUNNER_VERSION,
    axesLayerVersion: AXES_LAYER_VERSION,
    kind: ctx.kind,
    locale: ctx.locale,
    readingScope: ctx.readingScope,
    readingInput,
  }
}

function contextOf(ctx: PayloadContext): OracleAiContext {
  return { asOfDate: ctx.asOfDate, question: ctx.question }
}

/**
 * One system's layer-1 prompt input — the engine's NATIVE chart in that
 * system's own vocabulary, in EVERY mode (single and combined alike).
 *
 * The axis projection (traits/elements/phase scores) never goes to a layer-1
 * reader: it is the comparison scale for LAYER 2 (seers) and the consensus
 * map. Combined mode used to send it here, which made tarot narrate
 * "나무 기운 56.3" — the exact disease 5fbbc92 fixed for single scope.
 * One code path now; there is no axes variant to regress to.
 */
export function buildReadingPayload(
  vote: AxisVote,
  result: JsonObject | null,
  ctx: PayloadContext,
  pii: PersonalData,
): JsonObject {
  const body: JsonObject = {
    ...envelope(ctx, 'native'),
    system: vote.system,
    engineVersion: vote.engineVersion,
    chart: buildNativeChart(vote.system, result, {
      locale: ctx.locale,
      nominalAge: ctx.nominalAge ?? null,
    }),
  }

  assertNoPersonalData(body, pii, {
    label: `ai_payload(${vote.system})`,
    machineCodeFields: [],
  })
  return { ...body, context: contextOf(ctx) }
}

/**
 * One seer's layer-2 prompt input: the aggregated axis picture plus every
 * layer-1 narrative. The narratives are themselves derived from reading
 * payloads that passed the same gate, so they cannot reintroduce birth data.
 *
 * `previous` is the WITNESS seat's prior-session block ({} for returning
 * users, null on a first visit). It carries only computed values (ballot
 * tally, synthesis conclusion) and is still covered by the privacy scan.
 * Other seers never get the key.
 */
export function buildVerdictPayload(
  args: {
    readerSlug: string
    readerIndex: number
    readerCount: number
    consensus: AxisConsensus
    readings: OracleReading[]
    previous?: JsonObject | null
  },
  ctx: PayloadContext,
  pii: PersonalData,
): JsonObject {
  const { consensus } = args
  const body: JsonObject = {
    ...envelope(ctx, 'axes'),
    reader: { slug: args.readerSlug, index: args.readerIndex, of: args.readerCount },
    ...(args.previous !== undefined ? { previous: args.previous } : {}),
    consensus: axisConsensusPayload(consensus),
    readings: args.readings.map((row) => ({
      system: row.system,
      status: row.status,
      summary: row.summary,
      narrative: row.narrative,
    })),
  }

  assertNoPersonalData(body, pii, `ai_payload(verdict:${args.readerSlug})`)
  return { ...body, context: contextOf(ctx) }
}

/**
 * Synthesis receives exactly N independent reading narratives plus the
 * axis-projection consensus. No raw engine result/ai_payload, profile data,
 * provider identity, or reader-to-reader context crosses this boundary.
 */
export function buildSynthesisPayload(
  readings: readonly OracleReading[],
  consensus: AxisConsensus,
  pii: PersonalData,
): JsonObject {
  const body: JsonObject = {
    readings: readings.map((row, index) => ({
      index: index + 1,
      narrative: truncateNarrativeForSynthesis(row.narrative ?? ''),
    })),
    consensus: axisConsensusPayload(consensus),
  }
  assertNoPersonalData(body, pii, {
    label: 'ai_payload(synthesis)',
    machineCodeFields: MACHINE_CODE_FIELDS,
  })
  return body
}
