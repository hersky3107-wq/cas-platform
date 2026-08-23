/**
 * Lazy OpenRouter catalog pricing for cost estimation when `usage.cost` is
 * absent. Keys are registry `model` strings (e.g. `deepseek/deepseek-v3.2`).
 */
export type TokenPricing = { promptUsdPerToken: number; completionUsdPerToken: number }

let cache: Map<string, TokenPricing> | null = null
let loadPromise: Promise<Map<string, TokenPricing>> | null = null

function parsePrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

async function loadPricing(): Promise<Map<string, TokenPricing>> {
  if (cache) return cache
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const map = new Map<string, TokenPricing>()
    const apiKey = process.env.OPENROUTER_API_KEY?.trim()
    if (!apiKey) return map

    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) return map
      const json = (await res.json()) as {
        data?: Array<{ id?: string; pricing?: { prompt?: unknown; completion?: unknown } }>
      }
      for (const row of json.data ?? []) {
        if (!row.id) continue
        const prompt = parsePrice(row.pricing?.prompt)
        const completion = parsePrice(row.pricing?.completion)
        if (prompt == null || completion == null) continue
        map.set(row.id, { promptUsdPerToken: prompt, completionUsdPerToken: completion })
      }
    } catch {
      // Estimation is best-effort; callers fall back to null cost.
    }

    cache = map
    return map
  })()

  return loadPromise
}

/** Resolve per-token USD rates from the live OpenRouter model catalog. */
export async function getOpenRouterModelPricing(model: string): Promise<TokenPricing | null> {
  const pricing = await loadPricing()
  return pricing.get(model) ?? null
}

export function estimateCostUsdFromPricing(
  pricing: TokenPricing,
  promptTokens: number,
  completionTokens: number,
): number {
  const cost =
    promptTokens * pricing.promptUsdPerToken + completionTokens * pricing.completionUsdPerToken
  return Math.round(cost * 1e8) / 1e8
}
