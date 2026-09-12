import { describe, expect, it } from 'vitest'
import { LAYER1_PROMPT_VERSION, buildLayer1SystemPrompt, buildLayer1UserPrompt } from '../layer1'
import { LAYER1_NARRATIVE_TARGET } from '../../parse-layer1'

describe('layer1 prompts (v4)', () => {
  it('is the v4 prompt: native-only, no axes variant', () => {
    expect(LAYER1_PROMPT_VERSION).toBe('layer1-v4')
    // (locale, system?, kind?) — still no readingInput param: native is the
    // only code path; kind only reframes one person vs. a relationship.
    expect(buildLayer1SystemPrompt.length).toBeLessThanOrEqual(3)
    const prompt = buildLayer1SystemPrompt('ko', 'saju')
    expect(prompt).not.toContain('readingInput')
  })

  it('demands the 700–1100 budget and forbids raw scores in prose (FIX 3)', () => {
    const prompt = buildLayer1SystemPrompt('ko', 'saju')
    expect(prompt).toContain(`aim ${LAYER1_NARRATIVE_TARGET}`)
    expect(prompt).toContain('NEVER print a raw numeric score')
    expect(prompt).toContain('Write for someone who knows NOTHING')
    expect(prompt).toContain('END with what to actually do or watch for')
    expect(prompt).not.toContain('connect at least THREE payload values')
    expect(prompt).not.toContain('max 500 characters')
  })

  it('keeps the internal-vocabulary ban', () => {
    const prompt = buildLayer1SystemPrompt('ko', 'saju')
    expect(prompt).toContain('Never name our internal engine layers')
    expect(prompt).toContain('코어 매트릭스')
  })

  it('gives tarot its no-오행, name-every-card rule', () => {
    const prompt = buildLayer1SystemPrompt('ko', 'tarot')
    expect(prompt).toContain('name every card')
    expect(prompt).toContain('Tarot has no 오행')
    const user = buildLayer1UserPrompt({ system: 'tarot' }, 'ko', 'tarot')
    expect(user).toContain('name the cards')
  })

  it('astro rule pins planets-vs-elements; sukuyou bans 명성 vocabulary (FIX 5c)', () => {
    expect(buildLayer1SystemPrompt('ko', 'astro')).toContain('never call a planet an element')
    expect(buildLayer1SystemPrompt('ko', 'sukuyou')).toContain('never call them 명성')
  })

  it('adds the Claude length lock only for prism, rescaled to the v4 budget', () => {
    const system = buildLayer1SystemPrompt('ko', 'prism')
    const user = buildLayer1UserPrompt({ system: 'prism' }, 'ko', 'prism')
    expect(system).toContain('PRISM / length lock (mandatory)')
    expect(system).toContain(`Target narrative length: ${LAYER1_NARRATIVE_TARGET}`)
    expect(user).toContain('Emit JSON only')
    expect(buildLayer1SystemPrompt('ko', 'saju')).not.toContain('length lock')
  })

  it('kind=compat reframes the reading as a RELATIONSHIP and bans invented facts and scores', () => {
    const compat = buildLayer1SystemPrompt('ko', 'saju', 'compat')
    expect(compat).toContain('RELATIONSHIP')
    expect(compat).toContain('궁합')
    expect(compat).toContain('본인')
    expect(compat).toContain('상대')
    expect(compat).toContain('Never invent names, ages, birth facts')
    expect(compat).toContain('Do not manufacture a percentage score')
    // Relationship-motion direction semantics ride along for the vote field.
    expect(compat).toContain('다가서라')
    expect(compat).toContain('거리를 두라')

    // Personal prompt stays untouched.
    const personal = buildLayer1SystemPrompt('ko', 'saju')
    expect(personal).not.toContain('궁합')
    expect(personal).toContain('for one person')
  })

  it('lets 구성 name 흉방/길방 only from chart fields, with no invented 吉 grade', () => {
    const prompt = buildLayer1SystemPrompt('ko', 'ninestar')
    expect(prompt).toContain('오황살')
    expect(prompt).toContain('암검살')
    expect(prompt).toContain('본명살')
    expect(prompt).toContain('본명적살')
    expect(prompt).toContain('세파')
    expect(prompt).toContain('월파')
    expect(prompt).toContain('길방')
    expect(prompt).toContain('never by inferring a direction')
    expect(prompt).toContain('do not invent a 대길/소길 grade')
  })

  it('lets 사주 name a TIER-1 용신 from 억부 and requires TIER-2 when 판정불가', () => {
    const prompt = buildLayer1SystemPrompt('ko', 'saju')
    expect(prompt).toContain('TWO-TIER AUTHORITY')
    expect(prompt).toContain('TIER 1 — computed')
    expect(prompt).toContain('TIER 2 — inferred')
    expect(prompt).toContain('saju.용신')
    expect(prompt).toContain('never name a different 오행 as 용신')
    expect(prompt).toContain('AI 판단 요청')
    expect(prompt).toContain('Fill JSON "needed"')
    expect(prompt).toContain('Stay silent ONLY when there is no material at all')
    expect(prompt).toContain('Fill JSON "inferred"')
    expect(prompt).toContain('용신을 하나로 고정하지 않습니다')
    expect(prompt).toContain('If 강약 is 중화, that is also TIER 1')
    expect(prompt).not.toContain('If 판정불가 is not 없음, do not name a 용신')
    expect(prompt).toContain('조후/병약/통관 are not computed')
  })

  it('asks TIER 2 from chart material for tzolkin, 숙요, tarot majors, and ziwei without time', () => {
    const tzolkin = buildLayer1SystemPrompt('ko', 'tzolkin')
    expect(tzolkin).toContain('nawal/tone')
    expect(tzolkin).toContain('NEVER assign an 오행')
    expect(tzolkin).toContain('no pair score')

    const sukuyou = buildLayer1SystemPrompt('ko', 'sukuyou')
    expect(sukuyou).toContain('命業胎')
    expect(sukuyou).toContain('성격.출처')
    expect(sukuyou).toContain('대길/소길 grade')

    const tarot = buildLayer1SystemPrompt('ko', 'tarot')
    expect(tarot).toContain('메이저')
    expect(tarot).toContain('Do not map the card to an 오행')

    const ziwei = buildLayer1SystemPrompt('ko', 'ziwei')
    expect(ziwei).toContain('출생시각 없음')
    expect(ziwei).toContain('reduced confidence')
    expect(ziwei).toContain('Do not invent 명궁')
  })

  it('lets 육효 name 왕쇠 only from computed 월령/일건/동효/복장 fields', () => {
    const prompt = buildLayer1SystemPrompt('ko', 'iching')
    expect(prompt).toContain('월령')
    expect(prompt).toContain('복장')
    expect(prompt).toContain('Never infer')
    expect(prompt).toContain('일건')
    expect(prompt).toContain('동효생극')
  })
})
