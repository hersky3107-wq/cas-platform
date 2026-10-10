import { describe, expect, it, vi } from 'vitest'
import type { EngineResult } from '../../engine/schema'
import { applyPayloadToUnlockedCard } from '../apply'
import { ensureCardTranslation, parseTranslationPayload, translatePayload } from '../ensure'
import { englishPayload, koreanSeedPayload } from '../payload'
import { unlockBriefCard } from '../../public/card'

function sampleResult(): EngineResult {
  return {
    headlines: [
      {
        title: 'Spillway risk',
        chain: [{ step: 'rain', cascade_id: null }],
        horizon: '30d',
        possibility: 'medium',
        why_humans_miss: 'The dam is not in headlines',
        evidence: [{ type: 'url', ref: 'DMC bulletin', url: 'https://dmc.gov.lk' }],
        what_to_do: ['Move upslope'],
        official_links: [{ label: 'DMC', url: 'https://dmc.gov.lk' }],
        proposed_by: ['a'],
        weakness_notes: [],
        novelty: 'only_us',
        stage: 4,
        confidence: 'medium',
        outsider: true,
      },
    ],
    missed_by_others: [],
    baseline_risks: [
      { title: 'Seasonal flood', stage: 2, possibility: 'high', what_to_do: ['Watch river'], reason: 'Monsoon' },
      { title: 'Landslide', stage: 3, possibility: 'medium', what_to_do: ['Avoid slopes'] },
      { title: 'Road cut', stage: 2, possibility: 'medium', what_to_do: ['Stock fuel'] },
    ],
    summary_ko: '바둘라 산사태 위험',
    summary_en: 'Landslide risk in Badulla',
    headline_ko: '바둘라 즉시 주의',
    headline_en: 'Badulla act now',
    map_focus: { lat: 7, lon: 81, zoom: 8 },
    partial: false,
    novelty_counts: { only_us: 1, also_seen_elsewhere: 0 },
  }
}

describe('payload extract', () => {
  it('keeps Korean headline/summary for the publish seed and omits evidence titles', () => {
    const result = sampleResult()
    const ko = koreanSeedPayload(result)
    const en = englishPayload(result)
    expect(ko.headline).toBe('바둘라 즉시 주의')
    expect(ko.summary).toBe('바둘라 산사태 위험')
    expect(en.headline).toBe('Badulla act now')
    expect(JSON.stringify(ko)).not.toContain('DMC bulletin')
    expect(JSON.stringify(en)).not.toContain('https://dmc.gov.lk')
    expect(ko.headlines[0]?.why_humans_miss).toBe('The dam is not in headlines')
  })
})

describe('cheap-model translate + cache', () => {
  it('reuses a stored payload and does not call the model again', async () => {
    const caller = vi.fn()
    const stored = {
      headline: 'cached',
      summary: 'cached summary',
      headlines: [],
      missed_by_others: [],
      baseline_risks: [],
    }
    const client = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { payload: stored }, error: null }),
      }),
    }
    const payload = await ensureCardTranslation(client as never, {
      cardId: 'run-1',
      lang: 'ja',
      result: sampleResult(),
      caller,
    })
    expect(payload.headline).toBe('cached')
    expect(caller).not.toHaveBeenCalled()
  })

  it('writes Korean from the engine headline and translates the body once', async function () {
    const writes: unknown[] = []
    const caller = vi.fn().mockResolvedValue(
      JSON.stringify({
        headline: 'model should not win',
        summary: 'model should not win',
        headlines: [{ title: '방수로 위험', what_to_do: ['높은 곳으로'], why_humans_miss: '댐이 뉴스에 없음' }],
        missed_by_others: [],
        baseline_risks: [{ title: '홍수', what_to_do: ['강을 보라'], reason: '우기' }],
      }),
    )
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'crisis_card_translations') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            upsert: vi.fn((row: unknown) => {
              writes.push(row)
              return Promise.resolve({ error: null })
            }),
          }
        }
        return {}
      }),
    }
    const payload = await ensureCardTranslation(client as never, {
      cardId: 'run-1',
      lang: 'ko',
      result: sampleResult(),
      caller,
    })
    expect(payload.headline).toBe('바둘라 즉시 주의')
    expect(payload.summary).toBe('바둘라 산사태 위험')
    expect(payload.headlines[0]?.title).toBe('방수로 위험')
    expect(caller).toHaveBeenCalledOnce()
    expect(writes).toHaveLength(1)
  })

  it('parses fenced JSON from the cheap model', () => {
    const parsed = parseTranslationPayload('```json\n{"headline":"H","summary":"S","headlines":[]}\n```')
    expect(parsed).toMatchObject({ headline: 'H', summary: 'S' })
  })

  it('returns the English source without calling a model', async () => {
    const caller = vi.fn()
    const source = englishPayload(sampleResult())
    await expect(translatePayload(source, 'en', caller)).resolves.toEqual(source)
    expect(caller).not.toHaveBeenCalled()
  })
})

describe('apply translation', () => {
  it('overwrites AI text but leaves evidence link titles in the original language', () => {
    const card = unlockBriefCard({
      runId: 'r1',
      regionId: 7,
      regionName: 'Badulla',
      country: 'Sri Lanka',
      iso3: 'LKA',
      searchUrls: ['https://example.com/e'],
      costUsd: 0.4,
      result: sampleResult(),
    })
    const applied = applyPayloadToUnlockedCard(card, {
      headline: '번역 제목',
      summary: '번역 요약',
      headlines: [{ title: '번역 가설', what_to_do: ['대피'], why_humans_miss: '이유' }],
      missed_by_others: [],
      baseline_risks: [{ title: '번역 기저', what_to_do: ['준비'] }],
    })
    expect(applied.headline_ko).toBe('번역 제목')
    expect(applied.headlines[0]?.title).toBe('번역 가설')
    expect(applied.headlines[0]?.official_links[0]?.label).toBe('DMC')
    expect(applied.headlines[0]?.evidence[0]?.ref).toBe('DMC bulletin')
  })
})
