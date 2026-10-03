/**
 * In-process permit gate for one parallel generation job.
 * Caps overall in-flight model calls and OpenRouter calls. Other routes
 * share only the overall cap. A retry must acquire again (the permit is
 * held only for the duration of one provider call).
 */

import { PARALLEL_MAX_IN_FLIGHT, PARALLEL_OPENROUTER_MAX_IN_FLIGHT } from './parallel-policy'

export const OPENROUTER_ROUTE = 'openrouter'

export type ProviderRouteEntry = {
  provider_key: string
  caller: { kind: string; platformId?: string }
}

export function rosterProviderRoute(entry: ProviderRouteEntry): string {
  if (entry.caller.kind === 'platform' && entry.caller.platformId?.startsWith('openrouter:')) {
    return OPENROUTER_ROUTE
  }
  if (entry.provider_key === OPENROUTER_ROUTE) return OPENROUTER_ROUTE
  return entry.provider_key
}

type Waiter = { route: string; resolve: () => void }

export type ProviderCallGate = {
  acquire(route: string): Promise<void>
  release(route: string): void
  readonly inFlight: number
  readonly openRouterInFlight: number
  readonly maxInFlightSeen: number
  readonly maxOpenRouterSeen: number
}

export function createProviderCallGate(limits?: {
  maxInFlight?: number
  maxOpenRouter?: number
}): ProviderCallGate {
  const maxInFlight = limits?.maxInFlight ?? PARALLEL_MAX_IN_FLIGHT
  const maxOpenRouter = limits?.maxOpenRouter ?? PARALLEL_OPENROUTER_MAX_IN_FLIGHT
  let inFlight = 0
  let openRouterInFlight = 0
  let maxInFlightSeen = 0
  let maxOpenRouterSeen = 0
  const waiters: Waiter[] = []

  function fits(route: string): boolean {
    if (inFlight >= maxInFlight) return false
    if (route === OPENROUTER_ROUTE && openRouterInFlight >= maxOpenRouter) return false
    return true
  }

  function grant(route: string): void {
    inFlight += 1
    if (route === OPENROUTER_ROUTE) openRouterInFlight += 1
    if (inFlight > maxInFlightSeen) maxInFlightSeen = inFlight
    if (openRouterInFlight > maxOpenRouterSeen) maxOpenRouterSeen = openRouterInFlight
  }

  function pump(): void {
    for (let i = 0; i < waiters.length; i++) {
      const waiter = waiters[i]!
      if (!fits(waiter.route)) continue
      waiters.splice(i, 1)
      grant(waiter.route)
      waiter.resolve()
      return
    }
  }

  return {
    get inFlight() {
      return inFlight
    },
    get openRouterInFlight() {
      return openRouterInFlight
    },
    get maxInFlightSeen() {
      return maxInFlightSeen
    },
    get maxOpenRouterSeen() {
      return maxOpenRouterSeen
    },
    acquire(route: string) {
      if (fits(route)) {
        grant(route)
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        waiters.push({ route, resolve })
      })
    },
    release(route: string) {
      inFlight = Math.max(0, inFlight - 1)
      if (route === OPENROUTER_ROUTE) openRouterInFlight = Math.max(0, openRouterInFlight - 1)
      pump()
    },
  }
}
