/**
 * Operator manual close for Korean elections only.
 * US and other jurisdictions are never matched.
 */
import { decodePoliticsInstrument, type PoliticsInstrumentParts } from '../gateway/adapters/politics-catalog'

export type KrManualCloseFlag =
  | { mode: 'off' }
  | { mode: 'all_kr' }
  | { mode: 'ids'; ids: readonly string[] }

export function parseKrManualCloseFlag(raw: string | null | undefined): KrManualCloseFlag {
  const text = (raw ?? '').trim()
  if (!text || /^(off|0|false|none)$/i.test(text)) return { mode: 'off' }
  if (/^(all_kr|all|\*)$/i.test(text)) return { mode: 'all_kr' }
  const ids = text
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (ids.length === 0) return { mode: 'off' }
  if (ids.some((id) => /^(all_kr|all|\*)$/i.test(id))) return { mode: 'all_kr' }
  return { mode: 'ids', ids }
}

export function serializeKrManualCloseFlag(flag: KrManualCloseFlag): string {
  if (flag.mode === 'off') return 'off'
  if (flag.mode === 'all_kr') return 'all_kr'
  return flag.ids.join(',')
}

export function krManualCloseIsOn(flag: KrManualCloseFlag): boolean {
  return flag.mode !== 'off'
}

/** Calendar raceKey `KR:local:2026:nationwide` matches KR instruments in that cycle. */
export function krElectionIdMatches(id: string, parts: PoliticsInstrumentParts): boolean {
  if (parts.jurisdiction !== 'KR') return false
  if (id === 'all_kr') return true
  const bits = id.split(':')
  if ((bits[0] ?? '') !== 'KR') return false
  const office = bits[1] ?? ''
  const cycle = bits[2] ?? ''
  const district = bits[3] ?? ''
  if (cycle && cycle !== parts.cycle) return false
  if (office && office !== 'local' && office !== parts.office) return false
  if (district && district !== 'nationwide' && district !== parts.district) return false
  return true
}

export function isKrElectionClosedByFlag(instrument: string, flag: KrManualCloseFlag): boolean {
  if (flag.mode === 'off') return false
  const parts = decodePoliticsInstrument(instrument)
  if (!parts || parts.jurisdiction !== 'KR') return false
  if (flag.mode === 'all_kr') return true
  return flag.ids.some((id) => krElectionIdMatches(id, parts))
}

/** Admins still see / grade closed KR races. */
export function krElectionAccessDenied(
  viewer: { isAdmin?: boolean },
  instrument: string,
  flag: KrManualCloseFlag,
): boolean {
  if (viewer.isAdmin) return false
  return isKrElectionClosedByFlag(instrument, flag)
}

export function envKrManualCloseFlag(env: NodeJS.ProcessEnv = process.env): KrManualCloseFlag {
  return parseKrManualCloseFlag(env.KR_ELECTION_MANUAL_CLOSE)
}
