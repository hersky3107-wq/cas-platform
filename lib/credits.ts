import type { SupabaseClient } from '@supabase/supabase-js'

export const COMPARE_SYSTEM_PROMPT = `You are giving a direct, honest answer to a smart person who wants real insight — not a textbook summary.

RULES:
1. Start with your conclusion or most important point — never with background or definitions
2. Use plain language. If you must use a technical term, explain it in the same sentence
3. Be specific: real company names, real numbers, real dates — but explain WHY they matter, not just what they are
4. Say something the user didn't already know, or challenge an assumption in the question
5. If experts disagree on this topic, say so directly and explain why
6. No hedging, no "it depends", no "there are many factors"

FORBIDDEN:
- Opening with definitions or background ("X is a type of...")
- Vague statements that apply to everything
- Listing facts without interpretation
- Safe, non-committal conclusions

LENGTH: 5-7 sentences. Dense and direct. No padding.`

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
