/**
 * A ranking question typed into the 테크 box belongs to the AI 순위 chip.
 * Pure, client-safe. Uses the same test as the tech adapter's AIRANK branch,
 * plus the published AI-ranking examples of every locale (ja/zh/ar examples
 * carry no Korean/English rank words).
 */

import type { PublicCategoryId } from '../catalog'
import { getLeagueUiPack } from '../i18n/dictionary'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { isAirankRankingQuestion } from './resolve'

function isPublishedRankingExample(text: string): boolean {
  return LEAGUE_LOCALES.some((locale) =>
    getLeagueUiPack(locale).catalog.freeformPanel.ai_ranking.examples.includes(text),
  )
}

/** Chip a fresh box submission should move to, or null to stay. */
export function rerouteCategoryForPrompt(categoryId: PublicCategoryId, raw: string): PublicCategoryId | null {
  if (categoryId !== 'tech') return null
  const text = raw.trim()
  if (!text) return null
  return isAirankRankingQuestion(text) || isPublishedRankingExample(text) ? 'ai_ranking' : null
}

/** Chip that owns a round the box just opened (server-bridged ranking prompts land on AIRANK). */
export function categoryForOpenedRound(categoryId: PublicCategoryId, instrument: string): PublicCategoryId {
  return categoryId === 'tech' && instrument.startsWith('AIRANK:') ? 'ai_ranking' : categoryId
}
