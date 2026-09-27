import { describe, expect, it } from 'vitest'
import {
  LEAGUE_SEATS,
  formatSeatLabel,
  formatSeatSwapStatus,
  getAllSeats,
  getRetiredTenures,
  lookupSeat,
  seatForModelId,
  seatIdForModel,
} from '../seats'

describe('LEAGUE_SEATS registry', () => {
  it('contains the 40 official roster seats plus 4 extra seats', () => {
    const seats = getAllSeats()
    expect(seats.length).toBe(44)

    const premier = seats.filter((s) => s.tier === 'premier')
    const challenger = seats.filter((s) => s.tier === 'challenger')
    const world = seats.filter((s) => s.tier === 'world')
    const scout = seats.filter((s) => s.tier === 'scout')
    const extra = seats.filter((s) => s.tier === 'extra')

    expect(premier.length).toBe(10)
    expect(challenger.length).toBe(10)
    expect(world.length).toBe(14)
    expect(scout.length).toBe(6)
    expect(extra.length).toBe(4)
  })

  it('correctly maps known retired models to their official seats', () => {
    // 1. LG EXAONE -> Thinking Machines Inkling
    const inklingSeat = seatForModelId('k-exaone-2.0', 'world')
    expect(inklingSeat?.seatId).toBe('world:thinking-machines')
    expect(inklingSeat?.currentModelId).toBe('inkling')

    // 2. Kimi k2.6 -> Tencent Hunyuan 3
    const tencentSeat = seatForModelId('kimi-k2.6', 'challenger')
    expect(tencentSeat?.seatId).toBe('challenger:tencent')
    expect(tencentSeat?.currentModelId).toBe('hunyuan-3')

    // 3. DeepSeek v3.2 -> DeepSeek Flash
    const deepseekSeat = seatForModelId('deepseek-v3.2', 'challenger')
    expect(deepseekSeat?.seatId).toBe('challenger:deepseek')
    expect(deepseekSeat?.currentModelId).toBe('deepseek-flash')

    // 4. Qwen 3.5 Plus -> Llama 4 Maverick
    const metaSeat = seatForModelId('qwen3.5-plus', 'challenger')
    expect(metaSeat?.seatId).toBe('challenger:meta')
    expect(metaSeat?.currentModelId).toBe('llama-4-maverick')

    // 5. ERNIE 4.5 VL -> Gemma 4 31B
    const gemmaSeat = seatForModelId('ernie-4.5-vl', 'world')
    expect(gemmaSeat?.seatId).toBe('world:google-gemma')
    expect(gemmaSeat?.currentModelId).toBe('gemma-4-31b-it')

    // 6. Granite 4.2 8B -> Mistral Small 3.2
    const mistralSeat = seatForModelId('granite-4.2-8b', 'world')
    expect(mistralSeat?.seatId).toBe('world:mistral')
    expect(mistralSeat?.currentModelId).toBe('mistral-small-3.2-24b')
  })

  it('correctly reports seat swap status and last swap date', () => {
    const swappedSeat = lookupSeat('world:thinking-machines')!
    expect(swappedSeat).toBeDefined()
    const status = formatSeatSwapStatus(swappedSeat)
    expect(status.isSwapped).toBe(true)
    expect(status.currentModelId).toBe('inkling')
    expect(status.lastSwapDate).toBe('2026-09-07')

    const unswappedSeat = lookupSeat('premier:google')!
    const unswappedStatus = formatSeatSwapStatus(unswappedSeat)
    expect(unswappedStatus.isSwapped).toBe(false)
    expect(unswappedStatus.lastSwapDate).toBeUndefined()
  })

  it('retrieves all retired tenures with reason and dates', () => {
    const retired = getRetiredTenures()
    expect(retired.length).toBeGreaterThanOrEqual(6)

    const exaone = retired.find((r) => r.modelId === 'k-exaone-2.0')!
    expect(exaone).toBeDefined()
    expect(exaone.seatId).toBe('world:thinking-machines')
    expect(exaone.retiredAt).toBe('2026-09-07')
    expect(exaone.reason).toContain('EXAONE')
  })

  it('derives canonical seat ID via seatIdForModel', () => {
    expect(seatIdForModel('gpt-5.6-sol', 'premier')).toBe('premier:openai')
    expect(seatIdForModel('gpt-6-astra', 'premier')).toBe('premier:openai')
    expect(seatIdForModel('k-exaone-2.0', 'world')).toBe('world:thinking-machines')
    expect(seatIdForModel('unknown-model', 'challenger')).toBe('challenger:unknown-model')
  })

  it('keeps premier seat_id continuous across the 2026-09-27 flagship swaps', () => {
    const openai = lookupSeat('premier:openai')!
    expect(openai.currentModelId).toBe('gpt-6-astra')
    expect(seatForModelId('gpt-5.6-sol', 'premier')?.seatId).toBe('premier:openai')
    expect(seatForModelId('gpt-6-astra', 'premier')?.seatId).toBe('premier:openai')
    expect(formatSeatSwapStatus(openai).isSwapped).toBe(true)
    expect(formatSeatSwapStatus(openai).lastSwapDate).toBe('2026-09-27')

    const anthropic = lookupSeat('premier:anthropic')!
    expect(anthropic.currentModelId).toBe('claude-fable-5.1')
    expect(seatForModelId('claude-fable-5', 'premier')?.seatId).toBe('premier:anthropic')

    const xai = lookupSeat('premier:xai')!
    expect(xai.currentModelId).toBe('grok-4.7')
    expect(seatForModelId('grok-4.5', 'premier')?.seatId).toBe('premier:xai')

    const zai = lookupSeat('premier:z-ai')!
    expect(zai.currentModelId).toBe('glm-5.3')
    expect(seatForModelId('glm-5.2', 'premier')?.seatId).toBe('premier:z-ai')

    const retired = getRetiredTenures()
    expect(retired.find((r) => r.modelId === 'gpt-5.6-sol')?.reason).toContain('GPT-6 Astra')
    expect(retired.find((r) => r.modelId === 'claude-fable-5')?.retiredAt).toBe('2026-09-27')
    expect(retired.find((r) => r.modelId === 'grok-4.5')?.seatId).toBe('premier:xai')
    expect(retired.find((r) => r.modelId === 'glm-5.2')?.seatId).toBe('premier:z-ai')
  })
})
