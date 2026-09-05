/**
 * Stubbed AI adapter — canned text, no provider calls.
 *
 * This implements OracleAiAdapter, the same interface the real provider
 * adapter will implement, so swapping it in is a one-line change at the
 * route wiring. Nothing from lib/ai or router.ts is imported here, by
 * design: the runner's state machine must be exercisable without a provider.
 *
 * Failure and timeout rates are configurable so the 결번 path can be driven
 * on purpose. Both default to 0 — set the env vars below to exercise them:
 *
 *   ORACLE_STUB_MIN_DELAY_MS    default 2000
 *   ORACLE_STUB_MAX_DELAY_MS    default 15000
 *   ORACLE_STUB_FAILURE_RATE    default 0    (0–1, provider error)
 *   ORACLE_STUB_TIMEOUT_RATE    default 0    (0–1, hangs past the deadline)
 */
import { createRng } from '../engines/draw/rng'
import type { OracleAiAdapter, OracleAiRequest, OracleAiResult } from './types'

export const ORACLE_STUB_BRAND = 'stub'
export const ORACLE_STUB_MODEL = 'stub-oracle-v0'

export const ORACLE_STUB_DEFAULT_MIN_DELAY_MS = 2_000
export const ORACLE_STUB_DEFAULT_MAX_DELAY_MS = 15_000

export type StubAiConfig = {
  minDelayMs: number
  maxDelayMs: number
  /** 0–1. Rolled before the delay; produces status 'error'. */
  failureRate: number
  /** 0–1. Rolled first; the call hangs past the deadline and returns 'timeout'. */
  timeoutRate: number
  /**
   * Injected so tests do not actually wait. Production uses a real timer,
   * which is what makes the runner's per-unit deadline meaningful.
   */
  sleep: (ms: number) => Promise<void>
  now: () => number
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function rate(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.min(1, parsed)
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.floor(parsed)
}

export function stubAiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StubAiConfig {
  const minDelayMs = positiveInt(env.ORACLE_STUB_MIN_DELAY_MS, ORACLE_STUB_DEFAULT_MIN_DELAY_MS)
  const maxDelayMs = positiveInt(env.ORACLE_STUB_MAX_DELAY_MS, ORACLE_STUB_DEFAULT_MAX_DELAY_MS)
  return {
    minDelayMs,
    maxDelayMs: Math.max(minDelayMs, maxDelayMs),
    failureRate: rate(env.ORACLE_STUB_FAILURE_RATE, 0),
    timeoutRate: rate(env.ORACLE_STUB_TIMEOUT_RATE, 0),
    sleep: realSleep,
    now: () => Date.now(),
  }
}

const READING_TEMPLATES = [
  'This system reads the period as building rather than settling. The trait profile leans on the strongest two axes and the element supply is uneven, so momentum is available but not free.',
  'The signal here is a holding pattern. Nothing in this system argues for a decisive move; the useful work is maintenance and consolidation.',
  'This system points toward release. The phase weight sits on letting go of a commitment that has stopped paying for itself.',
  'A mixed reading. Two of the three spaces agree on forward pressure while the third is unreadable, so treat the direction as provisional.',
] as const

const VERDICT_TEMPLATES = [
  'The panel is not unanimous. Weighing the tally against the oppositions, the defensible call is to move on the leading axis while keeping the dissent on record.',
  'The systems split closely enough that no single direction earns a headline. The honest reading is the count itself.',
  'The leading axis carries the tally without dominating it. Act on it, but expect the minority position to matter within the year.',
] as const

const PHASES = ['advance', 'hold', 'release'] as const
const FOCI = ['work', 'money', 'love', 'social', 'energy'] as const

/**
 * Canned text is deliberately generic: it must not read as a real reading.
 * It is seeded per (session seed, kind, unit) so a re-run of the same chunk
 * produces the same text, which keeps idempotency observable.
 */
export function createStubAiAdapter(overrides: Partial<StubAiConfig> = {}): OracleAiAdapter {
  const config: StubAiConfig = { ...stubAiConfigFromEnv(), ...overrides }

  return {
    async run(request: OracleAiRequest, options: { timeoutMs: number }): Promise<OracleAiResult> {
      const rng = createRng(`${request.seed}:${request.kind}:${request.unit}`)
      const roll = rng.next()
      const spread = config.maxDelayMs - config.minDelayMs
      const delayMs = config.minDelayMs + Math.floor(rng.next() * (spread + 1))
      const startedAt = config.now()

      if (roll < config.timeoutRate) {
        // A hung provider: sit past the deadline and let the caller's race win.
        await config.sleep(options.timeoutMs)
        return {
          ok: false,
          brand: ORACLE_STUB_BRAND,
          model: ORACLE_STUB_MODEL,
          status: 'timeout',
          message: `stub timeout after ${options.timeoutMs}ms`,
          latencyMs: config.now() - startedAt,
        }
      }

      if (roll < config.timeoutRate + config.failureRate) {
        await config.sleep(delayMs)
        return {
          ok: false,
          brand: ORACLE_STUB_BRAND,
          model: ORACLE_STUB_MODEL,
          status: 'error',
          message: 'stub provider error',
          latencyMs: config.now() - startedAt,
        }
      }

      await config.sleep(delayMs)

      const isVerdict = request.kind === 'verdict'
      const isSynthesis = request.kind === 'synthesis'
      const templates = isVerdict ? VERDICT_TEMPLATES : READING_TEMPLATES
      const text = `[stub:${request.unit}] ${templates[rng.nextInt(templates.length)]!}`
      const phase = PHASES[rng.nextInt(PHASES.length)]!
      const payloadSize = JSON.stringify(request.payload).length
      // Same ballot shape the live seer adapter produces, so the code tally
      // (runner/ballot.ts) is exercised identically on stub sessions.
      const ballot = {
        direction: phase,
        focus: FOCI[rng.nextInt(FOCI.length)]!,
        domains: {
          work: 20 + rng.nextInt(70),
          money: 20 + rng.nextInt(70),
          love: 20 + rng.nextInt(70),
          social: 20 + rng.nextInt(70),
          energy: 20 + rng.nextInt(70),
        },
      }

      return {
        ok: true,
        brand: ORACLE_STUB_BRAND,
        model: ORACLE_STUB_MODEL,
        text,
        summary: isVerdict
          ? { ballot, dissent: rng.nextBool() ? null : 'stub dissent noted' }
          : isSynthesis
            ? {
                agreements: ['stub agreement'],
                divergences: ['stub divergence'],
                conclusion: 'stub synthesis conclusion',
                confidence_note: null,
              }
            : { unit: request.unit, headline: `stub headline for ${request.unit}`, phase },
        latencyMs: config.now() - startedAt,
        tokensIn: Math.ceil(payloadSize / 4),
        tokensOut: Math.ceil(text.length / 4),
      }
    },
  }
}
