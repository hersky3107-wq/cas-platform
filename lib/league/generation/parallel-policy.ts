/**
 * LEAGUE_PARALLEL_TIERS — default OFF.
 * Unset or any value other than the exact string "true" keeps the sequential
 * stage walk (packet → premier → challenger → world → scout → extra).
 */

import { LEAGUE_JOB_MAX_RUNNING } from './policy'

export const OFFICIAL_GENERATION_TIERS = ['premier', 'challenger', 'world', 'scout'] as const
export type OfficialGenerationTier = (typeof OFFICIAL_GENERATION_TIERS)[number]

/** In-flight model HTTP calls per parallel job (all providers). */
export const PARALLEL_MAX_IN_FLIGHT = 16

/** In-flight OpenRouter calls per parallel job. */
export const PARALLEL_OPENROUTER_MAX_IN_FLIGHT = 8

/** A parallel job occupies two slots of LEAGUE_JOB_MAX_RUNNING. */
export const PARALLEL_JOB_RUNNING_WEIGHT = 2

export function leagueParallelTiersEnabled(explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit
  return process.env.LEAGUE_PARALLEL_TIERS === 'true'
}

export function isOfficialGenerationStage(stage: string): boolean {
  return (
    stage === 'packet' ||
    stage === 'premier' ||
    stage === 'challenger' ||
    stage === 'world' ||
    stage === 'scout'
  )
}

/**
 * How many additional jobs this sweep may claim.
 * Flag off: same arithmetic as before (`max - running`).
 * Flag on: each running job weighs 2, and each new claim also weighs 2.
 */
const packetBuildInflight = new Map<string, Promise<unknown>>()

/** Concurrent callers for the same round share one packet build. */
export function coalesceRoundPacketBuild<T>(roundId: string, build: () => Promise<T>): Promise<T> {
  const existing = packetBuildInflight.get(roundId) as Promise<T> | undefined
  if (existing) return existing
  const pending = build().finally(() => {
    packetBuildInflight.delete(roundId)
  })
  packetBuildInflight.set(roundId, pending)
  return pending
}

export function generationClaimBudget(
  runningBefore: number,
  parallel: boolean,
  maxRunning = LEAGUE_JOB_MAX_RUNNING,
): number {
  if (!parallel) return Math.max(0, maxRunning - runningBefore)
  const used = runningBefore * PARALLEL_JOB_RUNNING_WEIGHT
  return Math.floor(Math.max(0, maxRunning - used) / PARALLEL_JOB_RUNNING_WEIGHT)
}
