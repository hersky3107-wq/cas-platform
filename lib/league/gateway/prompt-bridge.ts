/**
 * Non-ko/en free prompts are parsed by the existing Korean/English parsers.
 * Published hub chips map to the English question at the same index (no model
 * call). Any other sentence is translated by gemini-3.5-flash-lite when a
 * caller is installed. The original text is not stored as the proposition;
 * compose still renders per locale from the instrument.
 */

import { getLeagueUiPack } from '../i18n/dictionary'
import { LEAGUE_LOCALES, type LeagueLocale } from '../i18n/locales'
import { NORMALIZER_MODEL } from './normalize-prompt'

export const PROMPT_BRIDGE_MODEL = NORMALIZER_MODEL

export const PROMPT_BRIDGE_SYSTEM = [
  'Translate the user question into one English yes/no question.',
  'Keep proper names (teams, people, products, places) in their usual English form.',
  'Output only the English question. No quotes, no notes.',
].join(' ')

export type PromptBridgeCall = (text: string, locale: string) => Promise<string | null>

let bridgeCall: PromptBridgeCall | null = null

export function setPromptBridgeCaller(call: PromptBridgeCall | null): void {
  bridgeCall = call
}

export function promptBridgeCallerInstalled(): boolean {
  return bridgeCall !== null
}

const ENCODED = /^(TECH:|AIRANK:|MATCH:|ELECTION:|SHOW:|PROPERTY:)/

export function needsEnglishBridge(locale: string, text: string): boolean {
  if (locale === 'ko' || locale === 'en' || !locale) return false
  if (ENCODED.test(text.trim())) return false
  return true
}

/** English hub sentence aligned with a published example in another locale. */
export function publishedEnglishGloss(text: string): string | null {
  const needle = text.trim()
  if (!needle) return null
  const en = getLeagueUiPack('en')
  for (const locale of LEAGUE_LOCALES) {
    if (locale === 'en') continue
    const pack = getLeagueUiPack(locale as LeagueLocale)
    const pairs: Array<[readonly string[], readonly string[]]> = [
      [pack.catalog.techSamples, en.catalog.techSamples],
      [pack.catalog.freeformPanel.tech.examples, en.catalog.freeformPanel.tech.examples],
      [pack.catalog.freeformPanel.politics_election.examples, en.catalog.freeformPanel.politics_election.examples],
      [pack.catalog.freeformPanel.entertainment.examples, en.catalog.freeformPanel.entertainment.examples],
      [pack.catalog.freeformPanel.real_estate.examples, en.catalog.freeformPanel.real_estate.examples],
      [pack.catalog.freeformPanel.sports.examples, en.catalog.freeformPanel.sports.examples],
    ]
    for (const [local, english] of pairs) {
      const index = local.indexOf(needle)
      if (index >= 0 && english[index]) return english[index]
    }
  }
  return null
}

/**
 * Text the existing parser should see. Returns the original for ko/en and
 * for encoded instruments. `original` is always the trimmed user text.
 */
export async function bridgePromptToEnglish(
  text: string,
  locale: string,
): Promise<{ text: string; original: string }> {
  const original = text.trim()
  if (!needsEnglishBridge(locale, original)) return { text: original, original }
  const gloss = publishedEnglishGloss(original)
  if (gloss) return { text: gloss, original }
  if (!bridgeCall) return { text: original, original }
  const translated = await bridgeCall(original, locale)
  const cleaned = translated?.replace(/^["']|["']$/g, '').trim()
  return { text: cleaned || original, original }
}
