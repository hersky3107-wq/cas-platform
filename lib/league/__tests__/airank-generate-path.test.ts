import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAirankRankedRoundInput, parseAirankPrompt } from '../ai-ranking/resolve'
import { decodeAirankInstrument } from '../ai-ranking/instrument'
import { buildPublicRankedRoundInput } from '../public-round-input'
import { generateErrorMessage, tryAgainSoonMessage } from '../generate-error-copy'
import { gatePublicGenerateInstrument } from '../access-policy'
import { getLeagueUiPack } from '../i18n/dictionary'

const NOW = new Date('2026-10-04T03:00:00.000Z')
const PUBLIC_ACCESS = readFileSync(join(__dirname, '../public-access.ts'), 'utf8')
const CARD_ROUTE = readFileSync(join(__dirname, '../../../app/api/league/card/route.ts'), 'utf8')
const GENERATE_ROUTE = readFileSync(join(__dirname, '../../../app/api/league/generate/route.ts'), 'utf8')
const HUB = readFileSync(join(__dirname, '../../../components/league/PublicLeagueHub.tsx'), 'utf8')
const PROMPT = readFileSync(join(__dirname, '../../../components/league/FreeformPromptBox.tsx'), 'utf8')
const INSTRUMENTS = readFileSync(join(__dirname, '../../../app/api/league/instruments/route.ts'), 'utf8')
const ORCHESTRATOR = readFileSync(join(__dirname, '../orchestrator.ts'), 'utf8')
const EXTRA = readFileSync(join(__dirname, '../extra/run.ts'), 'utf8')

describe('AIRANK generate path from the tech prompt', () => {
  const prompt = '클로드가 이번 달 말 코딩에서 GPT보다 위일까?'
  const parsed = parseAirankPrompt(prompt, NOW)
  if (!parsed.ok) throw new Error('expected parse')

  it('compose → public generate seed is an ai_models ranked round (not a catalog 404)', () => {
    expect(parsed.instrument).toMatch(/^AIRANK:text:coding:brand_above:Anthropic:OpenAI:20261031$/)
    const seed = buildPublicRankedRoundInput(parsed.instrument, parsed.horizon, NOW, 'ko')
    expect(seed).not.toBeNull()
    expect(seed?.category).toBe('ai_models')
    expect(seed?.instrument).toBe(parsed.instrument)
    expect(seed?.horizon).toBe('1m')
    expect(seed?.proposition_text).toBe(
      '클로드가 2026-10-31 이후 처음 발표되는 LMArena 코딩 순위에서 오픈AI보다 위일까?',
    )
    expect(seed?.item_type).toBe('ranked')
    expect(decodeAirankInstrument(seed!.instrument)).toMatchObject({
      kind: 'brand_above',
      subject: 'Anthropic',
      param: 'OpenAI',
    })
  })

  it('gate + builder are wired into generate and card so AIRANK is not unknown/catalog-null', () => {
    const gate = gatePublicGenerateInstrument(
      parsed.instrument,
      { isAdmin: false, jurisdiction: { ipCountry: 'KR' } },
      '1m',
    )
    expect(gate).toEqual({ ok: true, instrument: parsed.instrument, category: 'ai_models', horizon: '1m' })
    expect(PUBLIC_ACCESS).toContain('buildPublicRankedRoundInput')
    expect(CARD_ROUTE).toContain('buildPublicRankedRoundInput')
    expect(CARD_ROUTE).toContain("decodeAirankInstrument(gate.instrument)")
    expect(GENERATE_ROUTE).toContain('resolvePublicInstrumentGenerateTarget(viewer, instrument, horizon, locale)')
    expect(INSTRUMENTS).toContain("['tech', 'ai_models']")
    expect(INSTRUMENTS).toContain("c.id === 'tech'")
  })

  it('buildAirankRankedRoundInput reconstructs the first-snapshot proposition', () => {
    const built = buildAirankRankedRoundInput(parsed.instrument, '1m', NOW, 'ko')
    expect(built?.category).toBe('ai_models')
    expect(built?.proposition_text).toContain('이후 처음 발표되는 LMArena')
  })

  it('writes SELF-VENDOR columns on official and extra prediction upserts', () => {
    expect(ORCHESTRATOR).toContain('self_vendor_subject: vendorFlags ? vendorFlags.isSubjectVendor : null')
    expect(ORCHESTRATOR).toContain('self_vendor_param: vendorFlags ? vendorFlags.isParamVendor : null')
    expect(EXTRA).toContain('extraSelfVendorColumns')
    expect(EXTRA).toContain('self_vendor_subject')
    expect(EXTRA).toContain('self_vendor_param')
  })
})

describe('generate / gateway error UX', () => {
  it('maps known codes to localized reasons and never uses the bare generic string when a code exists', () => {
    const generic = getLeagueUiPack('ko').hub.genericError
    expect(generateErrorMessage('no_round', 'ko', 404)).not.toBe(generic)
    expect(generateErrorMessage('no_round', 'ko', 404)).toContain('라운드')
    expect(generateErrorMessage('unsupported_field', 'ko', 400)).toContain('종합')
    expect(generateErrorMessage('airank_min_horizon', 'ko', 400)).toBe('AI 순위는 1주 이상만 가능합니다.')
    expect(generateErrorMessage('mystery_code', 'ko', 400)).toContain('mystery_code')
    expect(generateErrorMessage('mystery_code', 'ko', 400)).not.toBe(generic)
    expect(generateErrorMessage(undefined, 'ko', 500)).toBe('잠시 후 다시 시도해 주세요.')
    expect(tryAgainSoonMessage('ko')).toBe('잠시 후 다시 시도해 주세요.')
    expect(PROMPT).toContain('generateErrorMessage')
    expect(HUB).toContain('generateErrorMessage')
    expect(GENERATE_ROUTE).toContain('[league-generate]')
  })
})

describe('tech hub freeform panel copy', () => {
  it('has no 준비 중 on the tech panel', () => {
    const ko = getLeagueUiPack('ko').catalog.freeformPanel.tech
    expect(ko.title).toBe('테크 · AI 순위')
    expect(`${ko.title} ${ko.body} ${ko.examples.join(' ')}`).not.toMatch(/준비 중/)
    expect(HUB).toContain('freeformPanel')
    expect(HUB).toContain('onExample')
  })
})
