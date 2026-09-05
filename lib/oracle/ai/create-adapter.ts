/**
 * Route-facing factory. Swapping stub ↔ live is this one line plus the
 * `ORACLE_AI_MODE=live|stub`. Missing the flag is stub — tests and local
 * `npm run dev` never spend tokens unless the owner sets live.
 *
 * The live adapter is dynamically imported only when mode is live AND an
 * AI unit actually runs. Tests that stay on stub never construct anything
 * network-related — `lib/ai` is not on the static import graph.
 *
 * Readings, synthesis, AND seer verdicts all run live: the layer-2 seer
 * panel (combined mode) casts real ballots through the same adapter.
 */
import { createStubAiAdapter, type StubAiConfig } from '../runner/ai-stub'
import type { OracleAiAdapter, OracleAiRequest, OracleAiResult } from '../runner/types'
import { getOracleAiMode, ORACLE_LAYER1_LIVE_TIMEOUT_MS } from './mode'

export type OracleAiAdapterOptions = {
  stub?: Partial<StubAiConfig>
  /** Injected by tests so live-mode factory tests never hit the network. */
  layer1?: OracleAiAdapter
}

export function createOracleAiAdapter(options: OracleAiAdapterOptions = {}): OracleAiAdapter {
  const stub = createStubAiAdapter(options.stub)
  if (getOracleAiMode() !== 'live') return stub

  let live: Promise<OracleAiAdapter> | null = null
  const getLive = (): Promise<OracleAiAdapter> => {
    if (options.layer1) return Promise.resolve(options.layer1)
    if (!live) {
      live = import('./layer1-adapter').then((mod) => mod.createLayer1AiAdapter())
    }
    return live
  }

  return {
    async run(request: OracleAiRequest, opts: { timeoutMs: number }): Promise<OracleAiResult> {
      return (await getLive()).run(request, opts)
    },
  }
}

/** Extra AdvanceDeps when live — unit deadline stays under the 150s lease. */
export function oracleAiAdvanceOptions(): { unitTimeoutMs?: number } {
  if (getOracleAiMode() !== 'live') return {}
  return { unitTimeoutMs: ORACLE_LAYER1_LIVE_TIMEOUT_MS }
}
