import { describe, expect, it } from 'vitest'
import { SYSTEM_IDS } from '../../axes/types'
import { LAYER1_REGISTRY, layer1Entry } from '../registry'
import { layer1RunawayContentThreshold } from '../layer1-adapter'

const STALE_ROUTER_DEFAULTS = [
  'gpt-4o',
  'claude-sonnet-4-6',
  'gemini-3.5-flash',
  'grok-3',
  'deepseek-chat',
  'mistral-large-latest',
]

const EXPECTED_CEILINGS: Record<string, number> = {
  saju: 1200,
  ziwei: 3000,
  iching: 2000,
  ninestar: 1200,
  sukuyou: 2500,
  astro: 1200,
  tarot: 1200,
  runes: 1200,
  numerology: 1200,
  name: 1200,
  tzolkin: 2000,
  prism: 1200,
}

describe('LAYER1_REGISTRY', () => {
  it('has one verified entry per system and 12 distinct brands', () => {
    expect(Object.keys(LAYER1_REGISTRY).sort()).toEqual([...SYSTEM_IDS].sort())
    for (const system of SYSTEM_IDS) {
      const entry = layer1Entry(system)
      expect(entry).not.toBeNull()
      expect(entry!.brand.length).toBeGreaterThan(0)
      expect(entry!.model.length).toBeGreaterThan(0)
      expect(entry!.maxCompletionTokens).toBe(EXPECTED_CEILINGS[system])
    }

    const brands = Object.values(LAYER1_REGISTRY).map((entry) => entry.brand)
    expect(brands).toHaveLength(SYSTEM_IDS.length)
    expect(new Set(brands).size).toBe(SYSTEM_IDS.length)
    expect(JSON.stringify(LAYER1_REGISTRY)).not.toContain('max_tokens')
  })

  it('assigns the owner-approved brands including Llama 4 Maverick on ninestar', () => {
    expect(LAYER1_REGISTRY.saju).toMatchObject({
      brand: 'Moonshot AI',
      model: 'moonshotai/kimi-k3',
      caller: { kind: 'platform', platformId: 'openrouter:kimi-k3' },
    })
    expect(LAYER1_REGISTRY.ziwei).toMatchObject({
      brand: 'DeepSeek',
      model: 'deepseek/deepseek-v4-pro',
      caller: { kind: 'platform', platformId: 'openrouter:deepseek-v4-pro' },
    })
    expect(LAYER1_REGISTRY.ninestar).toMatchObject({
      brand: 'Meta',
      model: 'meta-llama/llama-4-maverick',
      caller: { kind: 'platform', platformId: 'openrouter:llama-4-maverick' },
    })
    expect(LAYER1_REGISTRY.ninestar.caller.kind === 'platform' && LAYER1_REGISTRY.ninestar.caller.extraRequestParams).toBeFalsy()
  })

  it('never uses the stale router.ts default model strings', () => {
    const models = Object.values(LAYER1_REGISTRY).map((entry) => entry.model)
    const overrides = Object.values(LAYER1_REGISTRY)
      .map((entry) => (entry.caller.kind === 'core' ? entry.caller.modelOverride : null))
      .filter((value): value is string => value !== null)
    for (const stale of STALE_ROUTER_DEFAULTS) {
      expect(models).not.toContain(stale)
      expect(overrides).not.toContain(stale)
    }
    expect(models).not.toContain('xiaomi/mimo-v2.5')
    expect(models).not.toContain('qwen/qwen3.5-plus-20260420')
  })

  it('pins Gemini thinking and does not invent a platform id for core brands', () => {
    const tarot = LAYER1_REGISTRY.tarot
    expect(tarot.caller.kind).toBe('core')
    if (tarot.caller.kind === 'core') {
      expect(tarot.caller.allowGeminiThinking).toBe(true)
      expect(tarot.caller.geminiThinkingLevel).toBe('minimal')
      expect(tarot.caller.modelOverride).toBe('gemini-3.6-flash')
    }
    expect(layer1Entry('not-a-system')).toBeNull()
  })

  it('scopes reassigned model reasoning and provider pins to oracle calls', () => {
    const saju = LAYER1_REGISTRY.saju.caller
    const ninestar = LAYER1_REGISTRY.ninestar.caller
    const ziwei = LAYER1_REGISTRY.ziwei.caller
    expect(saju.kind).toBe('platform')
    expect(ninestar.kind).toBe('platform')
    expect(ziwei.kind).toBe('platform')
    if (saju.kind === 'platform' && ninestar.kind === 'platform' && ziwei.kind === 'platform') {
      expect(saju.extraRequestParams).toEqual({
        reasoning: { enabled: false },
        provider: { order: ['moonshotai'], allow_fallbacks: true },
      })
      expect(ninestar.extraRequestParams).toBeUndefined()
      expect(ziwei.extraRequestParams).toEqual({
        reasoning: null,
      })
    }
  })

  it('scales the runaway guard to each system ceiling rather than a hardcoded value', () => {
    expect(layer1RunawayContentThreshold(LAYER1_REGISTRY.saju.maxCompletionTokens)).toBe(1800)
    expect(layer1RunawayContentThreshold(LAYER1_REGISTRY.sukuyou.maxCompletionTokens)).toBe(3750)
    expect(layer1RunawayContentThreshold(LAYER1_REGISTRY.ziwei.maxCompletionTokens)).toBe(4500)
    expect(layer1RunawayContentThreshold(LAYER1_REGISTRY.iching.maxCompletionTokens)).toBe(3000)
    expect(layer1RunawayContentThreshold(LAYER1_REGISTRY.tzolkin.maxCompletionTokens)).toBe(3000)
  })

  it('pins official first-party prices on core-router estimates', () => {
    expect(LAYER1_REGISTRY.astro.officialPricing).toEqual({
      promptUsdPerToken: 0.000002,
      completionUsdPerToken: 0.000012,
    })
    expect(LAYER1_REGISTRY.tarot.officialPricing).toEqual({
      promptUsdPerToken: 0.0000015,
      completionUsdPerToken: 0.0000075,
    })
    expect(LAYER1_REGISTRY.runes.officialPricing).toEqual({
      promptUsdPerToken: 0.00000125,
      completionUsdPerToken: 0.0000025,
    })
    expect(LAYER1_REGISTRY.prism.officialPricing).toEqual({
      promptUsdPerToken: 0.000002,
      completionUsdPerToken: 0.00001,
    })
  })
})
