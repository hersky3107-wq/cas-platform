import type { SupabaseClient } from '@supabase/supabase-js'
import { isCardTranslationPayload, type CardTranslationPayload } from './payload'

const MISSING_TABLE = /crisis_card_translations|schema cache|does not exist/i

export async function loadCardTranslation(
  client: SupabaseClient,
  cardId: string,
  lang: string,
): Promise<CardTranslationPayload | null> {
  const { data, error } = await client
    .from('crisis_card_translations')
    .select('payload')
    .eq('card_id', cardId)
    .eq('lang', lang)
    .maybeSingle()
  if (error) {
    if (MISSING_TABLE.test(error.message)) return null
    throw new Error(error.message)
  }
  return isCardTranslationPayload(data?.payload) ? data.payload : null
}

export async function saveCardTranslation(
  client: SupabaseClient,
  cardId: string,
  lang: string,
  payload: CardTranslationPayload,
): Promise<void> {
  const { error } = await client.from('crisis_card_translations').upsert(
    { card_id: cardId, lang, payload, created_at: new Date().toISOString() },
    { onConflict: 'card_id,lang' },
  )
  if (error) {
    if (MISSING_TABLE.test(error.message)) return
    throw new Error(error.message)
  }
}
