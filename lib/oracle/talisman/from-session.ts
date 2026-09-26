/**
 * On-demand talisman from a finished session's stored computations.
 * Not persisted — recomputed from oracle_computations.result + consensus
 * deficiency. No new session kind, no credits.
 */

import type { OracleComputation, OracleJobSession } from '../schema'
import { computeTalisman } from './compute'
import { chartsFromComputations, type ArrivalReport } from './charts'
import type { TalismanCharts, TalismanComputation, TalismanPurpose } from './types'

export type TalismanSessionResult = {
  computation: TalismanComputation | null
  charts: TalismanCharts
  arrival: ArrivalReport
  reason: 'ok' | 'gate' | 'no-consensus'
}

export function talismanFromStoredSession(input: {
  session: Pick<OracleJobSession, 'status' | 'prompt_version'>
  computations: readonly Pick<OracleComputation, 'system' | 'result'>[]
  deficiency: Record<string, unknown> | null
  purpose?: TalismanPurpose | null
}): TalismanSessionResult {
  const { charts, arrival } = chartsFromComputations(input.computations)
  const hasConsensus = input.deficiency != null
  const computation = computeTalisman({
    access: {
      status: input.session.status,
      promptVersion: input.session.prompt_version,
      hasConsensus,
    },
    charts,
    consensus: hasConsensus
      ? {
          elements: {
            total: { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 },
            deficiency: {
              wood: num(input.deficiency?.wood),
              fire: num(input.deficiency?.fire),
              earth: num(input.deficiency?.earth),
              metal: num(input.deficiency?.metal),
              water: num(input.deficiency?.water),
            },
            excess: { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 },
            participating: [],
            unreadable: [],
          },
        }
      : null,
    purpose: input.purpose ?? null,
  })
  return {
    computation,
    charts,
    arrival,
    reason: computation ? 'ok' : hasConsensus ? 'gate' : 'no-consensus',
  }
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
