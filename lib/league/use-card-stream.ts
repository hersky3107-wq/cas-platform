'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CardData } from './card-types'

export type CardStreamState = 'static' | 'connecting' | 'live' | 'reconnecting' | 'error'

export type UseCardStreamOptions = {
  roundId: string
  initialData: CardData
  /** Opt into the live path. Meaningless until a generation-stream endpoint exists (see TODO below). */
  live?: boolean
}

export type UseCardStreamResult = {
  data: CardData
  connection: CardStreamState
  /** Re-pull the current stored state from the DB. Also fires automatically on reconnect. */
  refetch: () => Promise<void>
}

/**
 * AI Prediction League — STREAM HOOK (Layer 4).
 *
 * THE CONTRACT (designed in now, independent of what's stubbed below): the
 * DATABASE is always the source of truth for a round. Whatever a live
 * connection does, if it drops — mobile background, screen lock, flaky
 * network — this hook falls back to re-fetching
 * `GET /api/league/card?round_id=...` and replacing `data` wholesale. The UI
 * must never get stuck showing stale/partial state with no way back to
 * ground truth.
 *
 * WHAT'S REAL:
 *  - Initial render from server-supplied `initialData` (no client-side
 *    aggregation — every aggregate already lives on `CardData`, see
 *    card-types.ts).
 *  - `refetch()`, wired to fire automatically on `visibilitychange` (tab/app
 *    foregrounded again) and `online` (network restored) — this alone
 *    satisfies "reconnect and re-hydrate from the DB, never lose data" even
 *    with zero live-stream wiring.
 *
 * WHAT'S STUBBED (TODO — see inline comment in the effect below):
 *  - The actual incremental-arrival stream. There is no live
 *    generation-stream endpoint yet: the orchestrator
 *    (`lib/league/orchestrator.ts`) writes each model's row to the DB as
 *    soon as it completes, but nothing currently pushes those writes to a
 *    connected browser, and wiring that is an orchestrator-side change,
 *    which is out of scope for this pass. `connect()` is where that would
 *    plug in later.
 */
export function useCardStream({ roundId, initialData, live = false }: UseCardStreamOptions): UseCardStreamResult {
  const [data, setData] = useState<CardData>(initialData)
  // Always starts 'static': the live path is a stub (see TODO below), so
  // there is no real 'connecting'/'live' transition to represent yet.
  const [connection, setConnection] = useState<CardStreamState>('static')
  const roundIdRef = useRef(roundId)
  useEffect(() => {
    roundIdRef.current = roundId
  }, [roundId])

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/league/card?round_id=${encodeURIComponent(roundIdRef.current)}`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`league card refetch failed: ${res.status}`)
      const fresh = (await res.json()) as CardData
      setData(fresh)
      setConnection('static')
    } catch {
      setConnection('error')
    }
  }, [])

  // Reconnect-from-DB contract: whenever the tab/app returns to the
  // foreground or the network comes back, re-hydrate from the DB instead of
  // trusting whatever partial state a dropped connection left behind. This
  // is intentionally independent of the live-stream path below.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void refetch()
    }
    function onOnline() {
      void refetch()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
    }
  }, [refetch])

  // TODO(live-generation-stream): `live` is accepted and plumbed through
  // (see PredictionCard) but not yet wired to anything — there is no live
  // generation-stream endpoint (see file header). Once one exists, open it
  // in a useEffect keyed on `[live, roundId]` and follow this codebase's
  // existing incremental-response convention — newline-delimited JSON over a
  // `ReadableStream` response body (see `app/api/ai-compare/route.ts`) —
  // rather than introducing a new transport. Expected line shapes:
  //   {"type":"model", ...CardModelPrediction}  // one per arriving model, in arrival order
  //   {"type":"done"}                            // round complete
  // On each "model" line (from the stream's own callback, NOT synchronously
  // in the effect body): setData(prev => ({ ...prev, models: [...prev.models, model] })).
  // `ModelList` re-derives its tier/camp grouping from `models` on every
  // render, so no separate "re-sort on completion" step is needed — it
  // happens for free once all rows have arrived. On stream error or
  // close-before-"done": call refetch(), exactly like the visibility/online
  // handlers above.
  void live

  return { data, connection, refetch }
}
