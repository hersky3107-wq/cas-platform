/**
 * User-facing labels must never leak codec IDs (TECH:…, AIRANK:…, MATCH:…).
 * Fall back to the proposition (or another human string); if that is also a
 * codec, return empty rather than the raw id.
 */

const RAW_INSTRUMENT_ID =
  /^(TECH:|AIRANK:|FREEFORM:|MATCH:|ELECTION:|SHOW:|PROPERTY:|STOCK:|KRSTOCK:)/i

export function looksLikeRawInstrumentId(value: string | null | undefined): boolean {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 && RAW_INSTRUMENT_ID.test(trimmed)
}

export function publicFacingLabel(
  primary: string | null | undefined,
  fallback: string | null | undefined = '',
): string {
  const first = (primary ?? '').trim()
  if (first && !looksLikeRawInstrumentId(first)) return first
  const second = (fallback ?? '').trim()
  if (second && !looksLikeRawInstrumentId(second)) return second
  return ''
}
