/**
 * Authoritative per-call USD when a provider actually reports one.
 *
 * Used by the core router so league (and anyone else) can store billed cost
 * instead of a roster list-price estimate. Keep this module free of supabase
 * / env so the conversion can be unit-tested in isolation.
 */

/** xAI documents `usage.cost_in_usd_ticks / 1e10` as the billed USD. */
export const XAI_USD_TICKS_PER_DOLLAR = 10_000_000_000

export function usdFromCostTicks(ticks: unknown): number | null {
  if (typeof ticks !== 'number' || !Number.isFinite(ticks) || ticks < 0) return null
  return ticks / XAI_USD_TICKS_PER_DOLLAR
}

/**
 * Pull a billed USD figure out of a provider `usage` object, or null when
 * the response has no authoritative cost field.
 *
 * Order:
 *  1. Perplexity `usage.cost.total_cost`
 *  2. OpenRouter-style `usage.cost` (number)
 *  3. xAI `usage.cost_in_usd_ticks` (Responses +, if present, chat)
 */
export function billedUsdFromProviderUsage(usage: unknown): number | null {
  if (!usage || typeof usage !== 'object') return null
  const u = usage as Record<string, unknown>

  const nested = u.cost
  if (nested && typeof nested === 'object') {
    const total = (nested as Record<string, unknown>).total_cost
    if (typeof total === 'number' && Number.isFinite(total)) return total
  }
  if (typeof nested === 'number' && Number.isFinite(nested)) return nested

  return usdFromCostTicks(u.cost_in_usd_ticks)
}

/**
 * Count of server-side tool invocations (xAI Agent Tools). Prefers the
 * documented scalar; falls back to summing `server_side_tool_usage`.
 */
export function serverSideToolsUsedFromUsage(usage: unknown): number | null {
  if (!usage || typeof usage !== 'object') return null
  const u = usage as Record<string, unknown>
  if (typeof u.num_server_side_tools_used === 'number' && Number.isFinite(u.num_server_side_tools_used)) {
    return u.num_server_side_tools_used
  }
  const breakdown = u.server_side_tool_usage
  if (breakdown && typeof breakdown === 'object' && !Array.isArray(breakdown)) {
    let sum = 0
    let any = false
    for (const value of Object.values(breakdown as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        sum += value
        any = true
      }
    }
    if (any) return sum
  }
  return null
}
