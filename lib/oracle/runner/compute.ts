/**
 * The whole calculation stage, run synchronously inside the create request.
 *
 * The full 12-system calculation benchmarks at ~8ms per subject, so there is
 * nothing to gain from chunking it — chunking exists only for AI calls. Each
 * system produces three column values for oracle_computations:
 *
 *   result     — the raw engine output, server-side only
 *   axes       — the AxisVote the projector derived from it
 *   ai_payload — the prompt input, allowlisted and privacy-gated
 *
 * A system that cannot be computed at all (missing name, missing PRISM
 * colours, an engine that throws) is a 결번: its row is written with null
 * result/axes and a machine code, it casts no vote, and the session
 * continues. Only a subject where NOTHING is readable fails the session.
 */
import {
  computeConsensus,
  projectAstro,
  projectIching,
  projectMaya,
  projectName,
  projectNineStar,
  projectNumerology,
  projectPrismResult,
  projectRune,
  projectSaju,
  projectSukuyou,
  projectTarot,
  projectZiwei,
} from '../axes'
import { SYSTEM_IDS, type AxisConsensus, type AxisVote, type ReadingScope, type SystemId } from '../axes/types'
import { fiveElementBalance, fourPillars, greatLuck, nineStar, sukuyou, tenGods, tzolkin } from '../engines/calendar'
import { natalChart, transits } from '../engines/astro'
import { ichingDraw, runeDraw, tarotDraw } from '../engines/draw'
import type { TarotSpreadSize } from '../engines/draw/conventions'
import { createRng } from '../engines/draw/rng'
import { nameReading } from '../engines/name'
import { numerology } from '../engines/numerology'
import { MBTI_TYPES, prism } from '../engines/prism'
import type { MicroCheck, PrismColors } from '../engines/prism/types'
import { ziweiChart } from '../engines/ziwei'
import type { OracleProfile, OracleSessionKind, OracleSessionScope } from '../schema'
import {
  ORACLE_DEFAULT_COORDS,
  ORACLE_DEFAULT_TIMEZONE,
  ORACLE_RUNE_COUNT,
  ORACLE_TAROT_DECK_SIZE,
  ORACLE_TAROT_SPREAD,
  readingScopeForSession,
} from './conventions'
import { buildReadingPayload, type PayloadContext } from './payload'
import type { PersonalData } from './privacy'
import type { OracleSessionInputs } from './session-inputs'
import type { JsonObject } from './types'

export class OracleComputeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'OracleComputeError'
    this.code = code
  }
}

/** Substitutions the runner had to make because the profile was incomplete. */
export type ComputeAssumptions = {
  /** oracle_profiles.sex is null; 대운/大限 direction defaulted to male. */
  sexDefaulted: boolean
  timezoneDefaulted: boolean
  coordinatesDefaulted: boolean
  /** No usable birth time: hour pillar, houses, and 大限 are dropped. */
  birthTimeUnknown: boolean
  /**
   * The birth time came from a survey band, not a clock. It is still used,
   * but the axis layer has no 'estimated' confidence basis yet, so saju and
   * 자미두수 report it at full weight. Tracked, not silently swallowed.
   */
  birthTimeEstimated: boolean
}

export type ComputedSystem = {
  system: SystemId
  result: JsonObject | null
  aiPayload: JsonObject | null
  axes: JsonObject | null
  engineVersion: string | null
  vote: AxisVote | null
  /** Machine code when the system produced no vote (결번). */
  unreadableCode: string | null
}

export type ComputeInput = {
  profile: OracleProfile
  systems: SystemId[]
  seed: string
  /** YYYY-MM-DD the reading is anchored to (today, in the caller's frame). */
  asOfDate: string
  locale: string
  kind: OracleSessionKind
  question: string | null
  /** Per-reading state. PRISM colours are read only from this session copy. */
  sessionInputs: OracleSessionInputs | null
  /** Needle set for the privacy gate — covers subject AND partner profiles. */
  personalData: PersonalData
  /**
   * Product scope. Combined (default) builds axis-projection payloads.
   * Single builds that system's native chart and drops the axis block.
   */
  sessionScope?: OracleSessionScope
}

export type ComputeOutput = {
  systems: ComputedSystem[]
  votes: AxisVote[]
  consensus: AxisConsensus
  readingScope: ReadingScope
  assumptions: ComputeAssumptions
}

/**
 * jsonb columns hold plain objects. Engine result types are declared as
 * interfaces, which TypeScript will not widen to Record<string, unknown>,
 * so the store boundary needs one narrowing cast.
 */
function jsonObject(value: object): JsonObject {
  return value as JsonObject
}

/** oracle_profiles.birth_time is a SQL `time` ('HH:mm:ss'); engines want 'HH:mm'. */
function toClock(value: string | null): string | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!match) return null
  return `${match[1]!.padStart(2, '0')}:${match[2]}`
}

export function personalDataFrom(profiles: OracleProfile[]): PersonalData {
  const names: string[] = []
  for (const profile of profiles) {
    for (const raw of [profile.name_local, profile.name_hanja, profile.name_latin]) {
      if (!raw) continue
      names.push(raw)
      // Split forms too: a payload leaking only the given name still leaks.
      for (const part of raw.split(/[\s·]+/)) {
        if (part.length > 0) names.push(part)
      }
    }
  }
  const first = profiles[0]
  return {
    birthDate: first?.birth_date ?? '',
    birthTime: first?.birth_time ?? null,
    birthPlace: first?.birth_place ?? null,
    names,
    lat: first?.lat ?? null,
    lng: first?.lng ?? null,
    timezone: first?.tz ?? null,
  }
}

type SubjectContext = {
  date: string
  /** 'HH:mm' or null when there is no usable birth time. */
  time: string | null
  timeExact: boolean
  tz: string
  lat: number
  lng: number
  sex: 'male' | 'female'
  asOfDate: string
  locale: string
  seed: string
  latinName: string | null
  nameParts: { surname: string; givenName: string } | null
  prism: { mbti: string; colors: PrismColors; microCheck: MicroCheck | undefined } | null
  tarot: { spread: TarotSpreadSize; pickedPositions: number[] } | null
  runeCount: number | null
}

/**
 * Korean names have no separator: the first syllable is the surname (the
 * one-syllable surnames cover the overwhelming majority; 남궁/황보 and the
 * other two-syllable surnames are a known gap). Latin names split on
 * whitespace, last token first.
 */
function splitName(profile: OracleProfile, locale: string): { surname: string; givenName: string } | null {
  const local = profile.name_local?.trim()
  if (local && local.length >= 2 && /[\u3131-\uD79D\u4E00-\u9FFF]/.test(local)) {
    return { surname: local.slice(0, 1), givenName: local.slice(1) }
  }
  const hanja = profile.name_hanja?.trim()
  if (hanja && hanja.length >= 2) {
    return { surname: hanja.slice(0, 1), givenName: hanja.slice(1) }
  }
  const latin = profile.name_latin?.trim()
  if (latin) {
    const parts = latin.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return { surname: parts[parts.length - 1]!, givenName: parts.slice(0, -1).join(' ') }
    }
  }
  // Locale is kept in the signature because the engine branches on it; a
  // single-token name is unreadable in every locale.
  void locale
  return null
}

/**
 * PRISM's colours and micro check are per-reading state. They come only from
 * oracle_job_sessions.session_inputs; the profile contributes MBTI (CORE).
 * Missing session input stays a 결번 — never fabricate colours from the seed.
 */
function readPrismInputs(
  profile: OracleProfile,
  sessionInputs: OracleSessionInputs | null,
): SubjectContext['prism'] {
  const input = sessionInputs?.prism
  if (!input) return null

  const mbti = profile.mbti?.toUpperCase()
  if (!mbti || !(MBTI_TYPES as readonly string[]).includes(mbti)) return null

  return {
    mbti,
    colors: {
      impulse: input.impulse,
      need: input.need,
      identity: input.identity,
    },
    microCheck: input.microCheck,
  }
}

function drawSeed(seed: string, system: string): string {
  return `${seed}:${system}`
}

function readTarotInputs(sessionInputs: OracleSessionInputs | null): SubjectContext['tarot'] {
  const input = sessionInputs?.tarot
  if (!input) return null
  return { spread: input.spread, pickedPositions: input.pickedPositions }
}

function readRuneCount(sessionInputs: OracleSessionInputs | null): number | null {
  const count = sessionInputs?.runes?.count
  return typeof count === 'number' ? count : null
}

/** Combined-session fallback when the UI did not send a user draw. */
function derivePickedPositions(seed: string, count: number, deckSize: number): number[] {
  const rng = createRng(seed)
  const picked: number[] = []
  while (picked.length < count) {
    const position = rng.nextInt(deckSize) + 1
    if (!picked.includes(position)) picked.push(position)
  }
  return picked
}

type SystemOutcome =
  | { vote: AxisVote; result: JsonObject }
  | { unreadableCode: string }

function computeSystem(system: SystemId, ctx: SubjectContext): SystemOutcome {
  switch (system) {
    case 'saju': {
      const pillars = fourPillars({ date: ctx.date, time: ctx.time, timezone: ctx.tz })
      const luck =
        ctx.time === null
          ? null
          : greatLuck({ date: ctx.date, time: ctx.time, timezone: ctx.tz, sex: ctx.sex })
      return {
        vote: projectSaju({ date: ctx.date, time: ctx.time, timezone: ctx.tz, sex: ctx.sex, asOfDate: ctx.asOfDate }),
        result: {
          pillars: jsonObject(pillars),
          fiveElements: jsonObject(fiveElementBalance(pillars)),
          tenGods: jsonObject(tenGods(pillars.day.stem, pillars)),
          greatLuck: luck ? jsonObject(luck) : null,
        },
      }
    }
    case 'astro': {
      const asOf = { date: ctx.asOfDate, time: '12:00', tz: ctx.tz }
      const natal = natalChart({
        date: ctx.date,
        time: ctx.time,
        tz: ctx.tz,
        lat: ctx.lat,
        lng: ctx.lng,
        timeKnown: ctx.timeExact,
      })
      return {
        vote: projectAstro({
          date: ctx.date,
          time: ctx.time,
          tz: ctx.tz,
          lat: ctx.lat,
          lng: ctx.lng,
          timeKnown: ctx.timeExact,
          asOf,
        }),
        result: { natal: jsonObject(natal), transits: jsonObject(transits({ natal, at: asOf })) },
      }
    }
    case 'prism': {
      if (!ctx.prism) return { unreadableCode: 'prism.no_color_selection' }
      const result = prism({
        birthDate: ctx.date,
        mbti: ctx.prism.mbti,
        colors: ctx.prism.colors,
        microCheck: ctx.prism.microCheck,
        atDate: ctx.asOfDate,
      })
      return { vote: projectPrismResult(result, ctx.asOfDate), result: { prism: jsonObject(result), mbti: ctx.prism.mbti, colors: jsonObject(ctx.prism.colors) } }
    }
    case 'ziwei': {
      const input = { birthDate: ctx.date, birthTime: ctx.time, tz: ctx.tz, sex: ctx.sex, atDate: ctx.asOfDate }
      return { vote: projectZiwei(input), result: { chart: jsonObject(ziweiChart(input)) } }
    }
    case 'numerology': {
      const input = { birthDate: ctx.date, latinName: ctx.latinName, atDate: ctx.asOfDate }
      return { vote: projectNumerology(input), result: { numbers: jsonObject(numerology(input)) } }
    }
    case 'name': {
      if (!ctx.nameParts) return { unreadableCode: 'name.no_name_on_profile' }
      const input = { ...ctx.nameParts, locale: ctx.locale }
      return { vote: projectName(input), result: { reading: jsonObject(nameReading(input)) } }
    }
    case 'iching': {
      const seed = drawSeed(ctx.seed, 'iching')
      return { vote: projectIching({ seed }), result: { draw: jsonObject(ichingDraw({ seed })) } }
    }
    case 'tarot': {
      const seed = drawSeed(ctx.seed, 'tarot')
      const spread = ctx.tarot?.spread ?? ORACLE_TAROT_SPREAD
      const pickedPositions =
        ctx.tarot?.pickedPositions ?? derivePickedPositions(seed, spread, ORACLE_TAROT_DECK_SIZE)
      const input = { seed, spread, pickedPositions }
      return { vote: projectTarot(input), result: { draw: jsonObject(tarotDraw(input)) } }
    }
    case 'runes': {
      const seed = drawSeed(ctx.seed, 'runes')
      const input = { seed, count: ctx.runeCount ?? ORACLE_RUNE_COUNT }
      return { vote: projectRune(input), result: { draw: jsonObject(runeDraw(input)) } }
    }
    case 'ninestar': {
      const input = { date: ctx.date, time: ctx.time, timezone: ctx.tz }
      return {
        vote: projectNineStar({ ...input, atDate: ctx.asOfDate }),
        result: { natal: jsonObject(nineStar(input)), current: jsonObject(nineStar({ date: ctx.asOfDate, time: '12:00', timezone: ctx.tz })) },
      }
    }
    case 'sukuyou': {
      const input = { date: ctx.date, time: ctx.time, timezone: ctx.tz }
      return {
        vote: projectSukuyou({ birthDate: ctx.date, birthTime: ctx.time, tz: ctx.tz, atDate: ctx.asOfDate }),
        result: { natal: jsonObject(sukuyou(input)), current: jsonObject(sukuyou({ date: ctx.asOfDate, time: '12:00', timezone: ctx.tz })) },
      }
    }
    case 'tzolkin': {
      return {
        vote: projectMaya({ birthDate: ctx.date, atDate: ctx.asOfDate }),
        result: { natal: jsonObject(tzolkin({ date: ctx.date })), current: jsonObject(tzolkin({ date: ctx.asOfDate })) },
      }
    }
  }
}

/** Normalizes and orders the requested system list; empty means all twelve. */
export function resolveSystems(requested: readonly string[]): SystemId[] {
  if (requested.length === 0) return [...SYSTEM_IDS]
  const wanted = new Set(requested)
  return SYSTEM_IDS.filter((id) => wanted.has(id))
}

function nominalAgeFrom(birthDate: string, asOfDate: string): number | null {
  const birthYear = Number(birthDate.slice(0, 4))
  const asOfYear = Number(asOfDate.slice(0, 4))
  if (!Number.isFinite(birthYear) || !Number.isFinite(asOfYear)) return null
  return asOfYear - birthYear + 1
}

export function runComputations(input: ComputeInput): ComputeOutput {
  const { profile } = input
  const clock = toClock(profile.birth_time)
  const usableTime = profile.birth_time_source === 'unknown' ? null : clock

  const assumptions: ComputeAssumptions = {
    sexDefaulted: profile.sex === null,
    timezoneDefaulted: !profile.tz,
    coordinatesDefaulted: profile.lat === null || profile.lng === null,
    birthTimeUnknown: usableTime === null,
    birthTimeEstimated: usableTime !== null && profile.birth_time_source === 'estimated',
  }

  const ctx: SubjectContext = {
    date: profile.birth_date,
    time: usableTime,
    timeExact: usableTime !== null && profile.birth_time_source === 'exact',
    tz: profile.tz ?? ORACLE_DEFAULT_TIMEZONE,
    lat: profile.lat ?? ORACLE_DEFAULT_COORDS.lat,
    lng: profile.lng ?? ORACLE_DEFAULT_COORDS.lng,
    sex: profile.sex === 'F' ? 'female' : 'male',
    asOfDate: input.asOfDate,
    locale: input.locale,
    seed: input.seed,
    latinName: profile.name_latin ?? null,
    nameParts: splitName(profile, input.locale),
    prism: readPrismInputs(profile, input.sessionInputs),
    tarot: readTarotInputs(input.sessionInputs),
    runeCount: readRuneCount(input.sessionInputs),
  }

  const readingScope = readingScopeForSession(input.kind, input.question !== null)
  const payloadContext: PayloadContext = {
    kind: input.kind,
    locale: input.locale,
    readingScope,
    asOfDate: input.asOfDate,
    question: input.question,
    sessionScope: input.sessionScope ?? 'combined',
    nominalAge: nominalAgeFrom(profile.birth_date, input.asOfDate),
  }

  const systems: ComputedSystem[] = []
  const votes: AxisVote[] = []

  for (const system of input.systems) {
    let outcome: SystemOutcome
    try {
      outcome = computeSystem(system, ctx)
    } catch (e) {
      // One engine throwing is a 결번, not a failed session.
      const message = e instanceof Error ? e.message : 'unknown error'
      outcome = { unreadableCode: `${system}.engine_error:${message.slice(0, 120)}` }
    }

    if ('unreadableCode' in outcome) {
      systems.push({
        system,
        result: null,
        aiPayload: null,
        axes: null,
        engineVersion: null,
        vote: null,
        unreadableCode: outcome.unreadableCode,
      })
      continue
    }

    votes.push(outcome.vote)
    systems.push({
      system,
      result: outcome.result,
      aiPayload: buildReadingPayload(outcome.vote, outcome.result, payloadContext, input.personalData),
      axes: jsonObject(outcome.vote),
      engineVersion: outcome.vote.engineVersion,
      vote: outcome.vote,
      unreadableCode: null,
    })
  }

  if (votes.length === 0) {
    throw new OracleComputeError('no_readable_system', 'no requested system produced a readable vote')
  }

  return {
    systems,
    votes,
    consensus: computeConsensus(votes, { readingScope }),
    readingScope,
    assumptions,
  }
}
