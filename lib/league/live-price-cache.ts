import 'server-only'

import { fetchLiveQuote } from '@/lib/league/market-data'

/**
 * AI Prediction League — LIVE PRICE cache (card header, secondary to the
 * persisted anchor price — see `card-types.ts`'s `CardRoundMeta.livePrice`).
 *
 * DESIGN CONSTRAINT (load-bearing): `GET /api/league/card` must never wait on
 * a market-data call, and a Twelve Data outage/rate-limit must never break or
 * even slow down a card read. So this is NOT "fetch, with a timeout" — it is
 * stale-while-revalidate with a SYNCHRONOUS read:
 *
 *   getCachedLivePrice(instrument)
 *     -> returns whatever is in the cache RIGHT NOW (or null), zero await
 *     -> if that entry is missing/expired, kicks off a background refetch
 *        (fire-and-forget, de-duplicated per instrument) that populates the
 *        cache for the NEXT call
 *
 * So the very first read after a cold start (or after the entry expires)
 * gets `null` and every read for the following TTL window is free (no
 * network at all) — which is also what keeps this within the Twelve Data
 * Basic (free) plan's 8-credits/minute, 800/day caps: `fetchLiveQuote` costs
 * 1 credit per cache MISS per instrument, never per request.
 *
 * Positive results cache for POSITIVE_TTL_MS (>= 60s, per product spec).
 * Failures (bad symbol, no key, 429, timeout, malformed response) cache a
 * `null` value for the shorter NEGATIVE_TTL_MS — long enough to stop a
 * sustained outage from re-triggering a fetch on every single card view,
 * short enough to recover quickly once the provider is healthy again.
 *
 * IN-PROCESS ONLY (same caveat as `lib/league/research.ts`'s memory cache):
 * this is a per-server-instance cache, not a distributed one. Fine at this
 * product's current scale; a durable/shared cache would be a // v2 if this
 * ever runs across many instances hammering Twelve Data independently.
 */

const POSITIVE_TTL_MS = 60_000
const NEGATIVE_TTL_MS = 20_000

export type LiveQuote = { price: number; asOf: string }

type CacheEntry = { value: LiveQuote | null; expiresAt: number }

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<void>>()

function refresh(instrument: string): void {
  if (inFlight.has(instrument)) return
  const task = fetchLiveQuote(instrument)
    .then((quote) => {
      cache.set(instrument, {
        value: quote,
        expiresAt: Date.now() + (quote ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
      })
    })
    .catch(() => {
      cache.set(instrument, { value: null, expiresAt: Date.now() + NEGATIVE_TTL_MS })
    })
    .finally(() => {
      inFlight.delete(instrument)
    })
  inFlight.set(instrument, task)
}

/**
 * Synchronous, non-blocking read. NEVER awaits the network — see the module
 * doc comment. Always safe to call from a hot read path like
 * `GET /api/league/card`.
 */
export function getCachedLivePrice(instrument: string): LiveQuote | null {
  const entry = cache.get(instrument)
  const fresh = entry && entry.expiresAt > Date.now()
  if (!fresh) refresh(instrument) // fire-and-forget; populates the NEXT read
  return fresh ? entry.value : null
}
