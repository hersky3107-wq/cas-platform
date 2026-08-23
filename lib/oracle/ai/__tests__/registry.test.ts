import { describe, expect, it } from 'vitest'
import { SYSTEM_IDS } from '../../axes/types'
import { LAYER1_REGISTRY, layer1Entry } from '../registry'

const STALE_ROUTER_DEFAULTS = [
  'gpt-4o',
  'claude-sonnet-4-6',
  'gemini-3.5-flash',
  'grok-3',
  'deepseek-chat',
  'mistral-large-latest',
]

describe('LAYER1_REGISTRY', () => {
  it('has one verified entry per system and no extras', () => {
    expect(Object.keys(LAYER1_REGISTRY).sort()).toEqual([...SYSTEM_IDS].sort())
    for (const system of SYSTEM_IDS) {
      const entry = layer1Entry(system)
      expect(entry).not.toBeNull()
      expect(entry!.brand.length).toBeGreaterThan(0)
      expect(entry!.model.length).toBeGreaterThan(0)
      if (system === 'ziwei') {
        expect(entry!.maxCompletionTokens).toBe(2000)
      } else {
        expect(entry!.maxCompletionTokens).toBe(1200)
      }
    }

    const brands = Object.values(LAYER1_REGISTRY).map((entry) => entry.brand)
    expect(new Set(brands).size).toBe(SYSTEM_IDS.length)
    expect(JSON.stringify(LAYER1_REGISTRY)).not.toContain('max_tokens')
  })

  it('applies the owner-approved three-way reassignment', () => {
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
      brand: 'Xiaomi',
      model: 'xiaomi/mimo-v2.5',
      caller: { kind: 'platform', platformId: 'openrouter:mimo-v2.5' },
    })
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
  })

  it('pins Gemini thinking and does not invent a platform id for core brands', () => {
    const tarot = LAYER1_REGISTRY.tarot
    expect(tarot.caller.kind).toBe('core')
    if (tarot.caller.kind === 'core') {
      expect(tarot.caller.allowGeminiThinking).toBe(true)
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
      expect(ninestar.extraRequestParams).toEqual({
        reasoning: null,
        provider: { order: ['xiaomi'], allow_fallbacks: true },
      })
      expect(ziwei.extraRequestParams).toEqual({
        reasoning: null,
      })
    }
  })
})
