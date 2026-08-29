import { describe, expect, it } from 'vitest'
import {
  billedUsdFromProviderUsage,
  serverSideToolsUsedFromUsage,
  usdFromCostTicks,
} from '../provider-billed-cost'

describe('usdFromCostTicks', () => {
  it('converts xAI ticks at 1e10 per dollar', () => {
    expect(usdFromCostTicks(7_233_840_000)).toBeCloseTo(0.723384, 6)
    expect(usdFromCostTicks(0)).toBe(0)
  })

  it('rejects nonsense', () => {
    expect(usdFromCostTicks(-1)).toBeNull()
    expect(usdFromCostTicks('12')).toBeNull()
    expect(usdFromCostTicks(Number.NaN)).toBeNull()
  })
})

describe('billedUsdFromProviderUsage', () => {
  it('reads Perplexity usage.cost.total_cost', () => {
    expect(billedUsdFromProviderUsage({ cost: { total_cost: 0.0072 } })).toBe(0.0072)
  })

  it('reads OpenRouter usage.cost as a number', () => {
    expect(billedUsdFromProviderUsage({ cost: 0.0123 })).toBe(0.0123)
  })

  it('reads xAI cost_in_usd_ticks', () => {
    expect(billedUsdFromProviderUsage({ cost_in_usd_ticks: 1_500_000_000 })).toBeCloseTo(0.15, 6)
  })

  it('returns null when nothing authoritative is present', () => {
    expect(billedUsdFromProviderUsage({ input_tokens: 100, output_tokens: 20 })).toBeNull()
    expect(billedUsdFromProviderUsage(null)).toBeNull()
  })
})

describe('serverSideToolsUsedFromUsage', () => {
  it('prefers the documented scalar', () => {
    expect(
      serverSideToolsUsedFromUsage({
        num_server_side_tools_used: 3,
        server_side_tool_usage: { WEB_SEARCH: 9 },
      }),
    ).toBe(3)
  })

  it('sums the breakdown when the scalar is missing', () => {
    expect(
      serverSideToolsUsedFromUsage({
        server_side_tool_usage: { WEB_SEARCH: 2, X_SEARCH: 1 },
      }),
    ).toBe(3)
  })

  it('returns null when neither is present', () => {
    expect(serverSideToolsUsedFromUsage({ input_tokens: 10 })).toBeNull()
  })
})
