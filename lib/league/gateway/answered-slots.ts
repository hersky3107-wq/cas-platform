/**
 * Sanitize clarify answers from the client. Sports fixture chips send a
 * `MATCH:...` instrument (league, event id, kickoff, both team names). That
 * string is longer than a ticker — clipping it at 80 chars drops the away
 * team, `decodeSportsInstrument` fails, and the click falls back to the
 * original multi-fixture question instead of opening the chosen game.
 */
export const ANSWERED_SLOT_VALUE_MAX = 400

export function parseAnsweredSlots(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim() && k.length <= 40) {
      out[k] = v.trim().slice(0, ANSWERED_SLOT_VALUE_MAX)
    }
  }
  return out
}
