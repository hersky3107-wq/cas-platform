import type { SupabaseClient } from '@supabase/supabase-js'

export const COMPARE_SYSTEM_PROMPT = `You are a world-class domain expert and local specialist.

STRICT RULES:
- NEVER state anything a casual Google search would return
- NEVER use vague generalities like 'it depends' or 'there are many factors'
- ALWAYS provide specific names, numbers, dates, insider details
- ALWAYS include at least one fact or insight that would genuinely surprise an informed person
- If the topic has regional/cultural depth, respond as a true insider — not a tourist
- If the topic is technical, respond at practitioner level — not textbook level
- Challenge assumptions in the question if they are oversimplified
- Your answer should make the reader feel they just talked to the best expert in the room

WHAT TO AVOID:
- Wikipedia-level summaries
- Obvious statements the user already knows
- Safe, hedged, non-committal answers

STRICT LIMIT: Maximum 180 words. 6-8 sentences.`

/** Same prompt as compare; custom mode may append additional instructions. */
export const CUSTOM_SYSTEM_PROMPT = COMPARE_SYSTEM_PROMPT

/** Same base prompt; persona mode appends role-specific lines in `app/api/ai-persona/route.ts`. */
export const PERSONA_SYSTEM_PROMPT = COMPARE_SYSTEM_PROMPT

/** 3 AIs = 10, 4 = 12, 5 = 14, 6 = 16 (also n=1→6, n=2→8). */
export function creditsPerMessage(aiCount: number): number {
  if (aiCount < 1 || aiCount > 6) {
    throw new Error('Select between 1 and 6 AIs.')
  }
  return 4 + aiCount * 2
}

/**
 * Reads `profiles.credits` for the user. Returns null if the read fails (e.g. table/column missing),
 * in which case credit enforcement is skipped so local dev still works.
 */
export async function getCreditsBalance(
  supabase: SupabaseClient,
  userId: string
): Promise<number | null> {
  const { data, error } = await supabase.from('profiles').select('credits').eq('id', userId).maybeSingle()

  if (error) {
    console.warn('[credits] balance read failed:', error.message)
    return null
  }

  return typeof data?.credits === 'number' ? data.credits : 0
}

export type DeductCreditsOutcome =
  | { ok: true; balance: number | null; skipped?: boolean }
  | { ok: false; balance: number; reason: 'insufficient' | 'update_failed' }

export async function deductCreditsBalance(
  supabase: SupabaseClient,
  userId: string,
  amount: number
): Promise<DeductCreditsOutcome> {
  const balance = await getCreditsBalance(supabase, userId)
  if (balance === null) {
    return { ok: true, balance: null, skipped: true }
  }
  if (balance < amount) {
    return { ok: false, balance, reason: 'insufficient' }
  }
  const next = balance - amount
  const { error } = await supabase.from('profiles').update({ credits: next }).eq('id', userId)
  if (error) {
    console.warn('[credits] deduct failed:', error.message)
    return { ok: false, balance, reason: 'update_failed' }
  }
  return { ok: true, balance: next }
}
