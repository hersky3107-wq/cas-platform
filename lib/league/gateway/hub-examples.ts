/**
 * Published hub free-prompt examples. Pure.
 * Every string here must resolve (ready or clarify) — never refuse.
 */

import { getLeagueUiPack } from '../i18n/dictionary'
import { LEAGUE_LOCALES, type LeagueLocale } from '../i18n/locales'
import type { AdapterCategoryId } from './types'

export const FREEFORM_HUBS = ['sports', 'politics_election', 'entertainment', 'real_estate', 'tech', 'ai_ranking'] as const
export type FreeformHub = (typeof FREEFORM_HUBS)[number]

export type HubExample = {
  locale: LeagueLocale
  hub: FreeformHub | 'techSamples'
  category: AdapterCategoryId
  text: string
}

function categoryForHub(hub: FreeformHub | 'techSamples'): AdapterCategoryId {
  if (hub === 'techSamples' || hub === 'tech') return 'tech'
  if (hub === 'ai_ranking') return 'ai_models'
  return hub
}

export function listHubExamples(): HubExample[] {
  const out: HubExample[] = []
  const seen = new Set<string>()
  for (const locale of LEAGUE_LOCALES) {
    const pack = getLeagueUiPack(locale)
    const push = (hub: HubExample['hub'], text: string) => {
      const key = `${locale}|${hub}|${text}`
      if (seen.has(key)) return
      seen.add(key)
      out.push({ locale, hub, category: categoryForHub(hub), text })
    }
    for (const text of pack.catalog.techSamples) push('techSamples', text)
    for (const hub of FREEFORM_HUBS) {
      for (const text of pack.catalog.freeformPanel[hub].examples) push(hub, text)
    }
  }
  return out
}
