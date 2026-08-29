import { describe, expect, it } from 'vitest'
import { SYSTEM_IDS } from '../../axes/types'
import { LAYER1_REGISTRY, LAYER1_READING_RUNAWAY_CONTENT_TOKENS, applyOracleBrandPolicies, layer1Entry } from '../registry'
import { LAYER1_SYNTHESIS_RUNAWAY_CONTENT_TOKENS, layer1RunawayContentThreshold } from '../layer1-adapter'

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
  ziwei: 8000,
  iching: 1200,
  ninestar: 1200,
  sukuyou: 2500,
  astro: 1200,
  tarot: 1200,
  runes: 1200,
  numerology: 1200,
  name: 1200,
  tzolkin: 4000,
  prism: 700,
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

  it('disables Anthropic thinking at the brand level for every oracle call', () => {
    const prism = applyOracleBrandPolicies(LAYER1_REGISTRY.prism)
    expect(prism.caller.kind).toBe('core')
    if (prism.caller.kind === 'core') {
      expect(prism.caller.anthropicThinking).toBe('disabled')
    }
    const cloned = applyOracleBrandPolicies({
      ...LAYER1_REGISTRY.prism,
      system: 'astro',
      caller: { kind: 'core', provider: 'anthropic', modelOverride: 'claude-sonnet-5' },
    })
    expect(cloned.caller.kind).toBe('core')
    if (cloned.caller.kind === 'core') {
      expect(cloned.caller.anthropicThinking).toBe('disabled')
    }
  })

  it('assigns Cohere to iching so Z.ai can stay integrated synthesizer', () => {
    expect(LAYER1_REGISTRY.iching.brand).toBe('Cohere')
    expect(LAYER1_REGISTRY.iching.model).toBe('cohere/command-a')
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
        reasoning: { effort: 'minimal' },
      })
    }
  })

  it('gives every system its own explicit runaway guard, independent of maxCompletionTokens', () => {
    for (const system of SYSTEM_IDS) {
      const entry = LAYER1_REGISTRY[system]
      expect(entry.runawayContentTokens).toBe(LAYER1_READING_RUNAWAY_CONTENT_TOKENS)
      expect(layer1RunawayContentThreshold(entry, 'reading')).toBe(LAYER1_READING_RUNAWAY_CONTENT_TOKENS)
    }
  })

  it('does not silently move the runaway guard when a completion ceiling is retuned for an unrelated reason', () => {
    // Regression for the 2026-08-26 incident: ziwei's maxCompletionTokens
    // went 3000 -> 8000 (a hidden-reasoning budget fix for DeepSeek) and a
    // formula-derived guard (maxCompletionTokens * 1.5) would have silently
    // moved 4500 -> 12000 as a side effect. saju and prism sit at opposite
    // ends of maxCompletionTokens (1200 vs 700) yet must produce the SAME
    // runaway threshold, proving the guard tracks the shared output
    // contract, not any one system's completion ceiling.
    expect(LAYER1_REGISTRY.saju.maxCompletionTokens).not.toBe(LAYER1_REGISTRY.ziwei.maxCompletionTokens)
    expect(LAYER1_REGISTRY.prism.maxCompletionTokens).not.toBe(LAYER1_REGISTRY.ziwei.maxCompletionTokens)
    const thresholds = new Set(
      [LAYER1_REGISTRY.saju, LAYER1_REGISTRY.ziwei, LAYER1_REGISTRY.prism, LAYER1_REGISTRY.tzolkin].map((entry) =>
        layer1RunawayContentThreshold(entry, 'reading'),
      ),
    )
    expect(thresholds.size).toBe(1)
    expect([...thresholds][0]).toBe(LAYER1_READING_RUNAWAY_CONTENT_TOKENS)
  })

  it('floors the synthesis runaway guard to its own longer-contract value, never a reader ceiling', () => {
    for (const system of SYSTEM_IDS) {
      const entry = LAYER1_REGISTRY[system]
      expect(layer1RunawayContentThreshold(entry, 'synthesis')).toBe(LAYER1_SYNTHESIS_RUNAWAY_CONTENT_TOKENS)
    }
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
