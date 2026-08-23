/**
 * Merge catalog + caller OpenRouter extras without whole-key clobber.
 *
 * Nested objects (`reasoning`, `provider`, …) are shallow-merged per key.
 * A value of `null` on the override DELETES that key (oracle entries strip
 * catalog `reasoning.effort:'minimal'` so a default_enabled:false model does
 * not get reasoning turned on).
 * When the override sets `reasoning.enabled === false`, catalog effort /
 * max_tokens are dropped — disable is absolute.
 */
export function mergeExtraRequestParams(
  catalog: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!catalog && !override) return undefined
  const out: Record<string, unknown> = { ...(catalog ?? {}) }
  if (!override) return out

  for (const [key, value] of Object.entries(override)) {
    if (value === null) {
      delete out[key]
      continue
    }
    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      out[key] !== null &&
      typeof out[key] === 'object' &&
      !Array.isArray(out[key])
    ) {
      if (key === 'reasoning' && (value as Record<string, unknown>).enabled === false) {
        out[key] = { enabled: false }
        continue
      }
      out[key] = { ...(out[key] as Record<string, unknown>), ...(value as Record<string, unknown>) }
      continue
    }
    out[key] = value
  }
  return out
}
