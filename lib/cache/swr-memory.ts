/**
 * Process-local stale-while-revalidate memory cache.
 *
 * Reusable across chips (e.g. Gunpo/Jeju AirKorea). On Vercel this survives
 * warm serverless instances and resets on cold start — still enough to keep
 * slow upstreams (에어코리아) from blocking every request in a demo session.
 *
 * Behavior:
 *   - Cache HIT (age < maxAgeMs): return the cached value IMMEDIATELY and
 *     kick off a background refresh (deduped). Screen never waits.
 *   - Cache MISS: await the loader; store on success; propagate failure.
 *   - A failed refresh never overwrites a good cached value.
 */

export type SwrMemoryOptions = {
  /** Max age (ms) of a cached value that may still be served. */
  maxAgeMs: number
}

export type SwrMemoryResult<T> = {
  value: T
  /** True when the returned value came from cache (not the awaited loader). */
  fromCache: boolean
  /** Age of the returned value in ms (0 when freshly loaded on a miss). */
  ageMs: number
}

type Entry<T> = {
  value: T
  storedAt: number
}

const store = new Map<string, Entry<unknown>>()
const inflight = new Map<string, Promise<unknown>>()

function readEntry<T>(key: string, maxAgeMs: number): Entry<T> | null {
  const entry = store.get(key) as Entry<T> | undefined
  if (!entry) return null
  if (Date.now() - entry.storedAt > maxAgeMs) {
    store.delete(key)
    return null
  }
  return entry
}

function writeEntry<T>(key: string, value: T): void {
  store.set(key, { value, storedAt: Date.now() })
}

async function runLoader<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) return existing

  const work = (async () => {
    try {
      const value = await loader()
      writeEntry(key, value)
      return value
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, work)
  return work
}

function revalidateInBackground<T>(key: string, loader: () => Promise<T>): void {
  if (inflight.has(key)) return
  void runLoader(key, loader).catch(() => {
    /* keep serving the previous good value */
  })
}

/**
 * Stale-while-revalidate get. See module docstring for hit/miss semantics.
 */
export async function swrMemoryGet<T>(
  key: string,
  loader: () => Promise<T>,
  opts: SwrMemoryOptions,
): Promise<SwrMemoryResult<T>> {
  const cached = readEntry<T>(key, opts.maxAgeMs)
  if (cached) {
    revalidateInBackground(key, loader)
    return {
      value: cached.value,
      fromCache: true,
      ageMs: Date.now() - cached.storedAt,
    }
  }

  const value = await runLoader(key, loader)
  return { value, fromCache: false, ageMs: 0 }
}

/** Test/ops helper — clears one key or the entire store. */
export function swrMemoryClear(key?: string): void {
  if (key === undefined) {
    store.clear()
    inflight.clear()
    return
  }
  store.delete(key)
  inflight.delete(key)
}
