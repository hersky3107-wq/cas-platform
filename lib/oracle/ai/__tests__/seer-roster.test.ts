/**
 * Seer panel invariants. The roster module itself is import-free (client-safe
 * display names), so the registry/family-roster cross-checks live HERE.
 */
import { describe, expect, it } from 'vitest'
import { ORACLE_READER_ROSTER, readerRosterFor } from '../../runner/conventions'
import { INTEGRATED_SYNTHESIZER_BRAND } from '../family-roster'
import { integratedReaderBrands, isRetiredBrand, layer1EntryForBrand } from '../registry'
import {
  ORACLE_SEER_PERSONAS,
  ORACLE_SEER_SLUGS,
  SEER_VERDICT_LINE_BUDGETS,
  seerBrandFor,
  seerPersona,
  seerRosterFor,
  verdictLineBudget,
  verdictRunawayContentTokens,
} from '../seer-roster'

describe('seer roster', () => {
  it('seats nine personas in the product order', () => {
    expect(ORACLE_SEER_SLUGS).toEqual([
      'reader',
      'seer',
      'guide',
      'elder',
      'contrarian',
      'scholar',
      'doubter',
      'mystic',
      'witness',
    ])
    expect(ORACLE_SEER_PERSONAS.map((p) => p.slug)).toEqual([...ORACLE_SEER_SLUGS])
  })

  it('is the runner layer-2 roster (conventions re-export)', () => {
    expect(ORACLE_READER_ROSTER).toEqual(ORACLE_SEER_SLUGS)
    expect(readerRosterFor(5)).toEqual(seerRosterFor(5))
  })

  it('N=3/5/7/9 take the first N; witness (returning-user seat) only exists at 9', () => {
    expect(seerRosterFor(3)).toEqual(['reader', 'seer', 'guide'])
    expect(seerRosterFor(5)).toEqual(['reader', 'seer', 'guide', 'elder', 'contrarian'])
    expect(seerRosterFor(7)).toEqual([
      'reader',
      'seer',
      'guide',
      'elder',
      'contrarian',
      'scholar',
      'doubter',
    ])
    expect(seerRosterFor(9)).toContain('witness')
    expect(seerRosterFor(7)).not.toContain('witness')
  })

  it('never seats a retired brand and never duplicates a brand across seats', () => {
    const brands = ORACLE_SEER_PERSONAS.map((p) => p.brand)
    for (const brand of brands) {
      expect(isRetiredBrand(brand), `${brand} is retired`).toBe(false)
    }
    expect(new Set(brands).size).toBe(brands.length)
  })

  it('every seat brand resolves to a live registry entry', () => {
    for (const persona of ORACLE_SEER_PERSONAS) {
      const entry = layer1EntryForBrand(persona.brand)
      expect(entry, `${persona.slug} seat brand ${persona.brand} has no registry entry`).not.toBeNull()
      expect(entry!.brand).toBe(persona.brand)
    }
  })

  it('CONTRARIAN is the one seat with no other stake in a combined session', () => {
    const contrarian = seerPersona('contrarian')!
    const readerBrands = new Set(integratedReaderBrands())
    // Not a layer-1 dedicated reader, not the integrated synthesizer, not Qwen.
    expect(readerBrands.has(contrarian.brand)).toBe(false)
    expect(contrarian.brand).not.toBe(INTEGRATED_SYNTHESIZER_BRAND)
    expect(contrarian.brand).toBe('ByteDance')
    // Every other seat reuses an onboarded layer-1 reader brand.
    for (const persona of ORACLE_SEER_PERSONAS) {
      if (persona.slug === 'contrarian') continue
      expect(readerBrands.has(persona.brand), `${persona.slug} (${persona.brand})`).toBe(true)
    }
    expect(seerPersona('doubter')!.brand).toBe('Mistral')
    expect(ORACLE_SEER_PERSONAS.every((persona) => persona.brand !== 'DeepSeek')).toBe(true)
  })

  it('decision rules differ per persona and carry the rule, not a tone', () => {
    const rules = ORACLE_SEER_PERSONAS.map((p) => p.decisionRule)
    expect(new Set(rules).size).toBe(rules.length)
    expect(seerPersona('contrarian')!.decisionRule).toMatch(/WRONG|DISTRUST/i)
    expect(seerPersona('contrarian')!.decisionRule).toMatch(/DIFFERENT COURSE/i)
    expect(seerPersona('mystic')!.decisionRule).toMatch(/NO digits|SYMBOLS/i)
    expect(seerPersona('witness')!.decisionRule).toMatch(/previous/i)
    expect(seerPersona('scholar')!.decisionRule).toMatch(/disagree|CONTRADICTIONS/i)
  })

  it('verdict-line budgets shrink as the panel grows; total stays in one band', () => {
    expect(SEER_VERDICT_LINE_BUDGETS).toEqual({ 3: 400, 5: 240, 7: 120, 9: 80 })
    const totals = ([3, 5, 7, 9] as const).map((n) => n * verdictLineBudget(n))
    for (const total of totals) {
      expect(total).toBeGreaterThanOrEqual(700)
      expect(total).toBeLessThanOrEqual(1300)
    }
    expect(seerBrandFor('nonexistent')).toBeNull()
  })

  it('derives the verdict runaway from the panel-size line budget, not a reading ceiling', () => {
    expect(verdictRunawayContentTokens(3)).toBe(2 * (400 + 160 + 200))
    expect(verdictRunawayContentTokens(5)).toBe(2 * (240 + 160 + 200))
    expect(verdictRunawayContentTokens(7)).toBe(2 * (120 + 160 + 200))
    expect(verdictRunawayContentTokens(9)).toBe(2 * (80 + 160 + 200))
    expect(verdictRunawayContentTokens(7)).toBe(960)
    expect(verdictRunawayContentTokens(3)).toBeLessThan(3000)
    expect(verdictRunawayContentTokens(3)).toBeGreaterThan(verdictRunawayContentTokens(9))
  })
})
