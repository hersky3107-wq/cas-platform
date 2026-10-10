import type { SupabaseClient } from '@supabase/supabase-js'
import type { CrisisLocale } from '../i18n/locales'
import type { LockedBriefCard, UnlockedBriefCard } from '../public/card'
import { loadPublishedRuns } from '../public/store'
import { applyPayloadToLockedCard, applyPayloadToUnlockedCard } from './apply'
import { cheapTranslateCaller } from './caller'
import { ensureCardTranslation, type TranslateCaller } from './ensure'

export async function localizeBriefCards(
  client: SupabaseClient,
  cards: Array<LockedBriefCard | UnlockedBriefCard>,
  locale: CrisisLocale,
  caller: TranslateCaller = cheapTranslateCaller,
): Promise<Array<LockedBriefCard | UnlockedBriefCard>> {
  if (cards.length === 0) return cards
  const runs = await loadPublishedRuns(client)
  const byId = new Map(runs.map((row) => [row.id, row]))
  const out: Array<LockedBriefCard | UnlockedBriefCard> = []
  for (const card of cards) {
    const run = byId.get(card.runId)
    if (!run?.result) {
      out.push(card)
      continue
    }
    const payload = await ensureCardTranslation(client, {
      cardId: card.runId,
      lang: locale,
      result: run.result,
      caller,
    })
    out.push(
      card.locked ? applyPayloadToLockedCard(card, payload) : applyPayloadToUnlockedCard(card, payload),
    )
  }
  return out
}
