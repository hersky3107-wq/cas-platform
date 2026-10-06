import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { categoryForOpenedRound, rerouteCategoryForPrompt } from '../ai-ranking/chip-route'
import { boardLabels, publicCategoryOfLedger } from '../boards/display'
import { boardDoorOfCategory } from '../boards/filters'
import { PUBLIC_CATALOG, isFreeformSearchCategory, usesHorizonChipRow } from '../catalog'
import { publicCategoryForLedger } from '../freeform-recent'
import { createAiModelsAdapter } from '../gateway/adapters/ai-models'
import type { AirankAdapterIo } from '../gateway/adapters/ai-models-packet'
import {
  WORLD_CATEGORY_IDS,
  categoryFromSearch,
  chipsForDoor,
  doorForCategory,
  redirectForCategorySearch,
  redirectForDoorSearch,
} from '../hub-doors'
import { getLeagueUiPack } from '../i18n/dictionary'
import { leaderboardBoardCopy } from '../i18n/leaderboard-board-copy'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { leagueSurfaceCopy } from '../i18n/surface-copy'
import { isPromptAllowed } from '../jurisdiction/resolve'
import { krDeepPolicyForInstrument } from '../korea-lane-features'

const HUB = readFileSync(resolve('components/league/PublicLeagueHub.tsx'), 'utf8')
const BOX = readFileSync(resolve('components/league/FreeformPromptBox.tsx'), 'utf8')
const RECORD_ROOM_BODY = readFileSync(resolve('components/league/RecordRoomBody.tsx'), 'utf8')
const REGISTRY = readFileSync(resolve('lib/league/gateway/adapters/registry.server.ts'), 'utf8')
const INSTRUMENTS = readFileSync(resolve('app/api/league/instruments/route.ts'), 'utf8')

const NOW = new Date('2026-10-06T03:00:00.000Z')
const DEAD = async () => {
  throw new Error('no I/O in chip tests')
}
const AIRANK_IO: AirankAdapterIo = {
  listPublishDates: DEAD as AirankAdapterIo['listPublishDates'],
  loadBrandRanking: DEAD as AirankAdapterIo['loadBrandRanking'],
  getResearchPacket: DEAD as AirankAdapterIo['getResearchPacket'],
}
const US = { userId: 'chip', isAdmin: false, jurisdiction: { declaredCountry: 'US', ipCountry: 'US' } }

describe('AI 순위 chip on the EVENTS door', () => {
  it('sits right after 테크 and is labelled in every locale', () => {
    expect(WORLD_CATEGORY_IDS.slice(-2)).toEqual(['tech', 'ai_ranking'])
    const chips = chipsForDoor(PUBLIC_CATALOG, 'world').map((c) => c.id)
    expect(chips).toEqual(['politics_election', 'entertainment', 'sports', 'real_estate', 'tech', 'ai_ranking'])
    expect(chipsForDoor(PUBLIC_CATALOG, 'finance').map((c) => c.id)).not.toContain('ai_ranking')
    expect(getLeagueUiPack('ko').catalog.categories.ai_ranking).toBe('AI 순위')
    expect(getLeagueUiPack('en').catalog.categories.ai_ranking).toBe('AI Rankings')
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale)
      expect(pack.catalog.categories.ai_ranking.trim().length, locale).toBeGreaterThan(0)
      expect(pack.catalog.categories.ai_ranking, locale).not.toBe(pack.catalog.categories.tech)
      expect(pack.catalog.freeformPanel.ai_ranking.title, locale).toBe(pack.catalog.categories.ai_ranking)
      expect(pack.gateway.placeholder.ai_ranking, locale).toBe(pack.catalog.freeformPanel.ai_ranking.examples[0])
    }
    expect(HUB).toContain('{t.catalog.categories[c.id]}')
  })

  it('is a free-prompt chip on the ai_models ledger with the prompt box open everywhere', () => {
    const def = PUBLIC_CATALOG.find((c) => c.id === 'ai_ranking')!
    expect(def.ledgerCategory).toBe('ai_models')
    expect(def.instruments).toEqual([])
    expect(isFreeformSearchCategory('ai_ranking')).toBe(true)
    expect(usesHorizonChipRow('ai_ranking')).toBe(false)
    for (const jurisdiction of [
      { declaredCountry: 'KR', ipCountry: 'KR' },
      { declaredCountry: 'US', ipCountry: 'US' },
      { declaredCountry: 'CN', ipCountry: 'CN' },
      { declaredCountry: null, ipCountry: null },
    ]) {
      expect(isPromptAllowed('ai_ranking', jurisdiction), JSON.stringify(jurisdiction)).toBe(true)
    }
    expect(REGISTRY).toMatch(/if \(id === 'ai_ranking'\) return aiModelsAdapter/)
  })

  it('deep-links with ?cat=ai_ranking and the ai_models alias', () => {
    const visible = PUBLIC_CATALOG.map((c) => c.id)
    expect(categoryFromSearch('?cat=ai_ranking', visible)).toBe('ai_ranking')
    expect(categoryFromSearch('?cat=ai_models', visible)).toBe('ai_ranking')
    expect(categoryFromSearch('?cat=tech', visible)).toBe('tech')
    expect(doorForCategory('ai_ranking')).toBe('world')
    expect(redirectForCategorySearch('?cat=ai_ranking')).toBe('/league/world?cat=ai_ranking')
    expect(redirectForCategorySearch('?cat=ai_models&tab=leaderboard')).toBe('/league/world?cat=ai_ranking&tab=leaderboard')
    expect(redirectForDoorSearch('finance', '?cat=ai_models')).toBe('/league/world?cat=ai_ranking')
    expect(redirectForDoorSearch('world', '?cat=ai_ranking')).toBeNull()
  })
})

describe('AI 순위 picker and panels', () => {
  it('shows the ranking picker only on the AI 순위 chip', () => {
    expect(HUB).toMatch(/selectedCategory === 'ai_ranking' \? \(\s*<AirankRankingPicker/)
    expect(HUB.match(/<AirankRankingPicker/g)).toHaveLength(1)
    expect(HUB).not.toMatch(/selectedCategory === 'tech' \? \(\s*<AirankRankingPicker/)
  })

  it('gives each chip its own examples, tech-only on 테크', () => {
    const ko = getLeagueUiPack('ko').catalog
    expect(ko.freeformPanel.tech.examples).toEqual([
      '애플이 10월 안에 새 아이패드를 발표할까?',
      '삼성이 연말까지 3단 폴더블을 출시할까?',
    ])
    expect(ko.freeformPanel.ai_ranking.examples).toEqual([
      '클로드가 이번 달 말 코딩 순위에서 GPT보다 위일까?',
      '중국 AI가 이번 달 종합 순위 3위 안에 들까?',
    ])
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale).catalog
      for (const text of [...pack.techSamples, ...pack.freeformPanel.tech.examples]) {
        expect(rerouteCategoryForPrompt('tech', text), `${locale}: ${text}`).toBeNull()
      }
      expect(pack.freeformPanel.tech.title, locale).not.toContain(pack.categories.ai_ranking)
    }
    expect(HUB).toMatch(/categoryId === 'tech' \|\|\s*categoryId === 'ai_ranking'\s*\?\s*t\.catalog\.freeformPanel\[categoryId\]/)
  })

  it('lists recent ai_models rounds under AI 순위 and tech rounds under 테크', () => {
    expect(publicCategoryForLedger('ai_models')).toBe('ai_ranking')
    expect(publicCategoryForLedger('tech')).toBe('tech')
    expect(INSTRUMENTS.match(/ai_ranking: \[\]/g)).toHaveLength(2)
    expect(HUB).toContain('active.recentRounds')
  })
})

describe('테크 box routes ranking questions to AI 순위', () => {
  it('reroutes Korean, English and every published ranking example', () => {
    expect(rerouteCategoryForPrompt('tech', '클로드가 이번 달 말 코딩 순위에서 GPT보다 위일까?')).toBe('ai_ranking')
    expect(rerouteCategoryForPrompt('tech', 'Will Gemini be #1 overall this week?')).toBe('ai_ranking')
    expect(rerouteCategoryForPrompt('tech', '  오픈AI가 이번 주 웹개발 리더보드 1위일까?  ')).toBe('ai_ranking')
    for (const locale of LEAGUE_LOCALES) {
      for (const text of getLeagueUiPack(locale).catalog.freeformPanel.ai_ranking.examples) {
        expect(rerouteCategoryForPrompt('tech', text), `${locale}: ${text}`).toBe('ai_ranking')
      }
    }
  })

  it('leaves other chips and non-ranking questions alone', () => {
    expect(rerouteCategoryForPrompt('ai_ranking', '클로드가 이번 달 말 코딩 순위에서 GPT보다 위일까?')).toBeNull()
    expect(rerouteCategoryForPrompt('sports', 'Will Arsenal be top 4?')).toBeNull()
    expect(rerouteCategoryForPrompt('tech', '애플이 10월 안에 새 아이패드를 발표할까?')).toBeNull()
    expect(rerouteCategoryForPrompt('tech', '   ')).toBeNull()
  })

  it('moves a round the server bridged to AIRANK onto the AI 순위 chip', () => {
    expect(categoryForOpenedRound('tech', 'AIRANK:text:coding:brand_above:Anthropic:OpenAI:20261031')).toBe('ai_ranking')
    expect(categoryForOpenedRound('tech', 'TECH:OPEN:apple:announce:ipad:20261031:official_newsroom')).toBe('tech')
    expect(categoryForOpenedRound('ai_ranking', 'AIRANK:text:overall:brand_rank1:OpenAI:20261031')).toBe('ai_ranking')
  })

  it('switches the chip and resubmits through the AI 순위 box', () => {
    expect(BOX).toContain('rerouteCategoryForPrompt(categoryId, text)')
    expect(BOX.indexOf('rerouteCategoryForPrompt(categoryId, text)')).toBeLessThan(BOX.indexOf("fetch('/api/league/gateway'"))
    expect(BOX).toContain('onAutoSubmitted?.()')
    expect(HUB).toMatch(/onReroute=\{\(target, text\) => \{[\s\S]*?selectCategory\(target\)[\s\S]*?setAutoPrompt/)
    expect(HUB).toContain('onAutoSubmitted={() => setAutoPrompt(null)}')
    expect(HUB).toContain('categoryForOpenedRound(selectedCategory, instrument)')
  })

  it('the AI 순위 box resolves ranking questions and refuses plain tech questions', async () => {
    const adapter = createAiModelsAdapter(AIRANK_IO, () => NOW)
    const hit = await adapter.resolveEntity('클로드가 이번 달 말 코딩 순위에서 GPT보다 위일까?', 'ko', US)
    expect(hit.ok && hit.entity_id.startsWith('AIRANK:')).toBe(true)
    const ja = await adapter.resolveEntity('クロードは今月末のコーディング順位でGPTより上？', 'ja', US)
    expect(ja.ok && ja.entity_id.startsWith('AIRANK:')).toBe(true)
    const tech = await adapter.resolveEntity('애플이 10월 안에 새 아이패드를 발표할까?', 'ko', US)
    expect(!tech.ok && 'refuse' in tech && tech.refuse.code).toBe('prompt_not_available')
  })
})

describe('door copy lists 테크 and AI 순위 separately', () => {
  it('names six world rooms in every locale', () => {
    expect(leagueSurfaceCopy('ko').doors.worldRooms).toEqual(['정치·선거', '엔터테인먼트', '스포츠', '부동산', '테크', 'AI 순위'])
    expect(leagueSurfaceCopy('en').doors.worldRooms).toEqual([
      'Politics & elections',
      'Entertainment',
      'Sports',
      'Housing',
      'Tech',
      'AI Rankings',
    ])
    for (const locale of LEAGUE_LOCALES) {
      const rooms = leagueSurfaceCopy(locale).doors.worldRooms
      expect(rooms, locale).toHaveLength(6)
      const pack = getLeagueUiPack(locale).catalog.categories
      expect(rooms.slice(-2), locale).toEqual([pack.tech, pack.ai_ranking])
    }
  })
})

describe('leaderboard and record room labels', () => {
  it('labels ai_models rounds AI 순위 and tech rounds 테크, both on the world door', () => {
    expect(boardDoorOfCategory('ai_models')).toBe('world')
    expect(boardDoorOfCategory('tech')).toBe('world')
    for (const locale of LEAGUE_LOCALES) {
      const t = getLeagueUiPack(locale)
      const labels = boardLabels(locale, t, leaderboardBoardCopy(locale))
      expect(labels.category('ai_models'), locale).toBe(t.catalog.categories.ai_ranking)
      expect(labels.category('tech'), locale).toBe(t.catalog.categories.tech)
      expect(labels.category('ai_models'), locale).not.toBe(labels.category('tech'))
    }
    expect(boardLabels('ko', getLeagueUiPack('ko'), leaderboardBoardCopy('ko')).category('ai_models')).toBe('AI 순위')
  })

  it('record-room rows print the chip name for the ledger category', () => {
    expect(publicCategoryOfLedger('ai_models')).toBe('ai_ranking')
    expect(publicCategoryOfLedger('tech')).toBe('tech')
    expect(publicCategoryOfLedger('not_a_category')).toBeNull()
    expect(RECORD_ROOM_BODY).toContain('publicCategoryOfLedger(category)')
    expect(RECORD_ROOM_BODY).toContain('formatCategory(entry.category, t)')
  })

  it('keeps Korean-lane deep reports on for both', () => {
    expect(krDeepPolicyForInstrument('ai_models', 'AIRANK:text:overall:brand_rank1:OpenAI:20261031')).toBe('allow')
    expect(krDeepPolicyForInstrument('tech', 'TECH:OPEN:apple:announce:ipad:20261031:official_newsroom')).toBe('allow')
  })
})
