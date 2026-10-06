import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { usesHorizonChipRow, isFreeformSearchCategory } from '../catalog'
import {
  isOpenUngradedRound,
  isPublicGatewayCacheKey,
  isPublicGatewayFreeformInstrument,
  selectRecentPublicFreeformRounds,
  type FreeformRecentRow,
} from '../freeform-recent'
import { looksLikeRawInstrumentId, publicFacingLabel } from '../public-label'
import { rankedPropositionDisplay } from '../card-header-copy'
import { getLeagueUiPack } from '../i18n/dictionary'

const HUB = readFileSync(join(__dirname, '../../../components/league/PublicLeagueHub.tsx'), 'utf8')
const INSTRUMENTS = readFileSync(join(__dirname, '../../../app/api/league/instruments/route.ts'), 'utf8')
const NOW = new Date('2026-10-04T09:00:00.000Z')

function row(over: Partial<FreeformRecentRow> & Pick<FreeformRecentRow, 'id' | 'instrument'>): FreeformRecentRow {
  return {
    proposition_text: '클로드가 2026-10-31 이후 처음 발표되는 LMArena 코딩 순위에서 오픈AI보다 위일까?',
    resolves_at: '2026-10-31T23:59:59.999Z',
    category: 'ai_models',
    created_at: '2026-10-04T08:00:00.000Z',
    grading_status: 'auto',
    actual_outcome: null,
    cache_key: `airank|${over.instrument}|1m`,
    horizon: '1m',
    ...over,
  }
}

describe('free-prompt first screen', () => {
  it('first load of a freeform tab shows the intro and does not auto-select a round', () => {
    expect(HUB).toContain('isFreeformSearchCategory(firstCat.id)')
    expect(HUB).toContain('showFreeformIntro')
    expect(HUB).toContain('freeformPanel')
    expect(HUB).toContain('onExample')
    expect(HUB).toMatch(/if \(!next \|\| isFreeformSearchCategory\(id\) \|\| next\.instruments\.length === 0\)/)
    expect(getLeagueUiPack('ko').catalog.freeformPanel.tech.title).toBe('테크')
    expect(getLeagueUiPack('ko').catalog.freeformPanel.ai_ranking.title).toBe('AI 순위')
    expect(getLeagueUiPack('ko').catalog.freeformPanel.tech.title).not.toMatch(/준비 중/)
  })

  it('never renders horizon buttons for freeform categories', () => {
    for (const id of ['tech', 'ai_ranking', 'sports', 'politics_election', 'entertainment', 'real_estate'] as const) {
      expect(isFreeformSearchCategory(id)).toBe(true)
      expect(usesHorizonChipRow(id)).toBe(false)
    }
    expect(HUB).toContain('!isFreeformSearchCategory(active.id)')
    expect(HUB).toContain('usesHorizonChipRow(active.id)')
  })

  it('excludes expired, graded, voided, and script/experiment rounds', () => {
    const openAirank = row({
      id: 'open-airank',
      instrument: 'AIRANK:text:coding:brand_above:Anthropic:OpenAI:20261031',
    })
    const expiredScript = row({
      id: 'script-aapl',
      instrument: 'TECH:AAPL:product_launch:foldable_iphone',
      category: 'tech',
      cache_key: 'tech|TECH:AAPL:product_launch:foldable_iphone|2026-09-30',
      resolves_at: '2026-09-30T12:00:00.000Z',
      proposition_text: 'Will Apple publish a product page for a foldable iPhone?',
    })
    const noJob = row({
      id: 'no-job',
      instrument: 'TECH:OPEN:apple:announce:ipad:20261031:official_newsroom',
      category: 'tech',
      cache_key: 'tech|TECH:OPEN:apple:announce:ipad:20261031:official_newsroom|2026-10-31',
    })
    const graded = row({
      id: 'graded',
      instrument: 'AIRANK:text:overall:brand_rank1:Google:20261031',
      grading_status: 'graded',
    })
    const voided = row({
      id: 'voided',
      instrument: 'AIRANK:text:overall:brand_rank1:OpenAI:20261031',
      grading_status: 'voided',
    })
    const listed = selectRecentPublicFreeformRounds(
      [expiredScript, graded, voided, noJob, openAirank],
      new Set(['open-airank', 'script-aapl', 'graded', 'voided']),
      NOW,
      6,
    )
    expect(listed).toEqual([
      expect.objectContaining({
        round_id: 'open-airank',
        proposition_text: openAirank.proposition_text,
      }),
    ])
    expect(isPublicGatewayFreeformInstrument(expiredScript.instrument)).toBe(false)
    expect(isPublicGatewayCacheKey(openAirank.cache_key)).toBe(true)
    expect(isOpenUngradedRound(expiredScript, NOW)).toBe(false)
    expect(INSTRUMENTS).toContain('league_generation_jobs')
  })

  it('list labels are proposition text, never the instrument code', () => {
    const instrument = 'AIRANK:text:coding:brand_above:Anthropic:OpenAI:20261031'
    const proposition = '클로드가 이번 달 말 코딩 순위에서 GPT보다 위일까?'
    const label = publicFacingLabel(rankedPropositionDisplay(instrument, 'stored LMArena audit', 'ko', null, '1m'), 'stored')
    expect(label).toBe(proposition)
    expect(label).not.toContain('AIRANK:')
    expect(label).not.toContain('LMArena')
    expect(HUB).toContain('publicFacingLabel')
    expect(HUB).toContain('selectRecentRound')
    expect(HUB).toContain('round_id')
  })

  it('raw ID guard falls back to the proposition and never returns the codec', () => {
    expect(looksLikeRawInstrumentId('TECH:AAPL:product_launch:foldable_iphone')).toBe(true)
    expect(looksLikeRawInstrumentId('AIRANK:text:overall:brand_rank1:OpenAI:20261031')).toBe(true)
    expect(looksLikeRawInstrumentId('FREEFORM:xyz')).toBe(true)
    expect(looksLikeRawInstrumentId('AAPL')).toBe(false)
    expect(publicFacingLabel('TECH:OPEN:apple:announce:ipad:20261031:official_newsroom', '애플이 아이패드를 발표할까?')).toBe(
      '애플이 아이패드를 발표할까?',
    )
    expect(publicFacingLabel('AIRANK:text:overall:brand_rank1:OpenAI:20261031', 'AIRANK:text:overall:brand_rank1:OpenAI:20261031')).toBe(
      '',
    )
    expect(HUB).not.toMatch(/t\.catalog\.instruments\[instrument\] \?\? instrument/)
  })
})
