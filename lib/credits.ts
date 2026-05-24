/** Client-safe credit helpers and prompts (no server Supabase imports). */

/** Admin account — never deduct credits for this email. */
export const ADMIN_EMAIL = 'hersky3107@gmail.com'

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase()
}

export const COMPARE_SYSTEM_PROMPT = `You are giving a direct, honest answer to a smart person who wants real insight — not a textbook summary.

RULES:
1. Start with your conclusion or most important point — never with background or definitions
2. Use plain language. If you must use a technical term, explain it in the same sentence
3. Be specific: real company names, real numbers, real dates — but explain WHY they matter, not just what they are
4. Say something the user didn't already know, or challenge an assumption in the question
5. If experts disagree on this topic, say so directly and explain why
6. No hedging, no "it depends", no "many factors"

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

/** Compare: 1 credit per AI selected. */
export function creditsPerMessage(aiCount: number): number {
  if (aiCount < 1 || aiCount > 6) {
    throw new Error('Select between 1 and 6 AIs.')
  }
  return aiCount
}

/** Custom: 1 credit per AI + 1 extra. */
export function creditsForCustom(aiCount: number): number {
  return creditsPerMessage(aiCount) + 1
}

/** Panel (Verdict) modes — fixed cost per run. */
export function creditsForPanelScore(): number {
  return 6
}
export function creditsForPanelVote(): number {
  return 5
}
export function creditsForPanelRank(): number {
  return 6
}
export function creditsForPanelPredict(): number {
  return 6
}
export function creditsForPanelFactcheck(): number {
  return 7
}
export function creditsForPanelVerdict(): number {
  return 3
}

/** Arena rounds 1–3: charge 2 credits per round (incremental, not cumulative total). */
export function creditsForArenaRound(roundNumber: number): number {
  if (roundNumber >= 1 && roundNumber <= 3) return 2
  return 0
}

export type DeepOutputMode = 'brief' | 'standard' | 'report'

export function creditsForDeep(mode: DeepOutputMode): number {
  const costs: Record<DeepOutputMode, number> = {
    brief: 3,
    standard: 6,
    report: 10,
  }
  return costs[mode]
}

export function creditsForSuit(): number {
  return 13
}

export function creditsForTale(): number {
  return 4
}

export type OracleTarotSpreadKey = 'one' | 'three' | 'five' | 'celtic'

/** Tarot spread cost by card count (one / three / five / celtic). */
export function creditsForOracleTarotSpread(spread: OracleTarotSpreadKey): number {
  const costs: Record<OracleTarotSpreadKey, number> = {
    one: 2,
    three: 3,
    five: 4,
    celtic: 6,
  }
  return costs[spread]
}

export function creditsForOracleAstrology(): number {
  return 4
}

export function creditsForOracleSaju(): number {
  return 4
}

export function creditsForOracleToday(): number {
  return 3
}

export function creditsForComedyTalkTurn(): number {
  return 2
}

export function creditsForComedyStandup(): number {
  return 5
}

export function creditsForMindgameCareer(): number {
  return 13
}

export function creditsForMindgameWolf(): number {
  return 13
}

export function creditsForArchive(): number {
  return 1
}

export type DeductCreditsOutcome =
  | { ok: true; balance: number | null; skipped?: boolean }
  | { ok: false; balance: number; reason: 'insufficient' | 'update_failed' }

export type AddCreditsOutcome =
  | { ok: true; balance: number }
  | { ok: false; reason: 'read_failed' | 'update_failed' }
