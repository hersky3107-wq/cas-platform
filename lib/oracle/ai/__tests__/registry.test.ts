import { describe, expect, it } from 'vitest'
import { SYSTEM_IDS } from '../../axes/types'
import {
  INTEGRATED_BANNED_BRANDS,
  LAYER1_REGISTRY,
  LAYER1_READING_RUNAWAY_CONTENT_TOKENS,
  applyOracleBrandPolicies,
  integratedReaderBrands,
  layer1Entry,
  resolveOracleCallEntry,
} from '../registry'
import { LAYER1_SYNTHESIS_RUNAWAY_CONTENT_TOKENS, layer1RunawayContentThreshold } from '../layer1-adapter'

const STALE_ROUTER_DEFAULTS = [
  'gpt-4o',
  'claude-sonnet-4-6',
  'gemini-3.5-flash',
  'grok-3',
  'deepseek-chat',
  'mistral-large-latest',
]

/**
 * FIX 3 rescale: the v4 narrative budget is 700–1100 chars (~1600 CJK-heavy
 * completion tokens incl. JSON overhead), so the shared reading ceiling moved
 * 1200 → 2200. Systems with measured hidden-reasoning floors keep their own
 * larger ceilings (ziwei/NVIDIA 4000); prism keeps a tighter 1800 as the
 * Claude length backstop. tzolkin sits at the shared 2200 after DeepSeek
 * left — Google's ceiling is under the 3000 runaway guard on purpose.
 */
const EXPECTED_CEILINGS: Record<string, number> = {
  saju: 2200,
  ziwei: 4000,
  iching: 2200,
  ninestar: 2200,
  sukuyou: 2200,
  astro: 2200,
  tarot: 2200,
  runes: 2200,
  numerology: 2200,
  name: 2200,
  tzolkin: 2200,
  prism: 1800,
}

describe('LAYER1_REGISTRY', () => {
  it('has one verified entry per system and twelve distinct brands', () => {
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
    expect(LAYER1_REGISTRY.tarot.brand).toBe('Google')
    expect(LAYER1_REGISTRY.tzolkin.brand).toBe('Upstage')
    expect(brands).not.toContain('DeepSeek')
    expect(JSON.stringify(LAYER1_REGISTRY)).not.toContain('max_tokens')
    for (const banned of INTEGRATED_BANNED_BRANDS) {
      expect(integratedReaderBrands()).not.toContain(banned)
    }
  })

  it('assigns the owner-approved brands including Llama 4 Maverick on ninestar', () => {
    expect(LAYER1_REGISTRY.saju).toMatchObject({
      brand: 'Moonshot AI',
      model: 'moonshotai/kimi-k3',
      caller: { kind: 'platform', platformId: 'openrouter:kimi-k3' },
    })
    expect(LAYER1_REGISTRY.ziwei).toMatchObject({
      brand: 'NVIDIA',
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      caller: { kind: 'platform', platformId: 'openrouter:nemotron-3-ultra-550b' },
    })
    expect(LAYER1_REGISTRY.ninestar).toMatchObject({
      brand: 'Meta',
      model: 'meta-llama/llama-4-maverick',
      caller: { kind: 'platform', platformId: 'openrouter:llama-4-maverick' },
    })
    expect(LAYER1_REGISTRY.sukuyou).toMatchObject({
      brand: 'Mistral',
      model: 'mistralai/mistral-medium-3-5',
      caller: { kind: 'platform', platformId: 'openrouter:mistral-medium-3.5' },
    })
    expect(LAYER1_REGISTRY.numerology).toMatchObject({
      brand: 'MiniMax',
      model: 'minimax/minimax-m3',
    })
    expect(LAYER1_REGISTRY.tzolkin).toMatchObject({
      brand: 'Upstage',
      model: 'solar-pro3',
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
    const numerology = LAYER1_REGISTRY.numerology.caller
    const tzolkin = LAYER1_REGISTRY.tzolkin.caller
    expect(saju.kind).toBe('platform')
    expect(ninestar.kind).toBe('platform')
    expect(ziwei.kind).toBe('platform')
    expect(numerology.kind).toBe('platform')
    expect(tzolkin.kind).toBe('platform')
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
    if (numerology.kind === 'platform') {
      expect(numerology.extraRequestParams).toEqual({
        reasoning: { enabled: false },
        provider: { order: ['minimax'], allow_fallbacks: true },
      })
    }
    if (tzolkin.kind === 'platform') {
      expect(tzolkin.platformId).toBe('upstage:solar-pro3')
      expect(tzolkin.extraRequestParams).toEqual({ reasoning_effort: 'low' })
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

  it('gives a seer its own log unit instead of the brand\'s LAYER1 home system', () => {
    const doubter = resolveOracleCallEntry({ kind: 'verdict', unit: 'doubter', brand: 'Mistral' })
    expect(doubter).not.toBeNull()
    expect(doubter!.logUnit).toBe('doubter')
    expect(doubter!.entry.brand).toBe('Mistral')
    expect(doubter!.entry.narrativeFloor).toBeUndefined()
    expect(LAYER1_REGISTRY.sukuyou.brand).toBe('Mistral')
    expect(doubter!.logUnit).not.toBe(LAYER1_REGISTRY.sukuyou.system)

    const contrarian = resolveOracleCallEntry({
      kind: 'verdict',
      unit: 'contrarian',
      brand: 'ByteDance',
    })
    expect(contrarian!.logUnit).toBe('contrarian')
    expect(contrarian!.entry.model).toBe('bytedance-seed/seed-1.6')

    const synth = resolveOracleCallEntry({ kind: 'synthesis', unit: 'synthesis', brand: 'Z.ai' })
    expect(synth!.logUnit).toBe('synthesis')
    expect(synth!.entry.brand).toBe('Z.ai')
  })

  it('judges a verdict runaway against the panel budget, not the 3000-token reading ceiling', () => {
    const entry = LAYER1_REGISTRY.sukuyou
    expect(layer1RunawayContentThreshold(entry, 'reading')).toBe(LAYER1_READING_RUNAWAY_CONTENT_TOKENS)
    expect(layer1RunawayContentThreshold(entry, 'verdict', 7)).toBe(960)
    expect(layer1RunawayContentThreshold(entry, 'verdict', 3)).toBe(1520)
    expect(layer1RunawayContentThreshold(entry, 'verdict', 7)).toBeLessThan(
      layer1RunawayContentThreshold(entry, 'reading'),
    )
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
    expect(LAYER1_REGISTRY.tzolkin.officialPricing).toBeUndefined()
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
