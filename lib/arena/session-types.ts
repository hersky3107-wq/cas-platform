/** Stored JSON row for arena turn share payloads */
export type ArenaShareRoundRow = {
  ai_name: string
  content: string | null
  round_number: number
}

export function parseArenaShareRoundRows(raw: unknown): ArenaShareRoundRow[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const ai_name = typeof row.ai_name === 'string' ? row.ai_name.trim() : ''
      if (!ai_name) return null
      const round_raw = row.round_number
      const round_number =
        typeof round_raw === 'number'
          ? round_raw
          : typeof round_raw === 'string'
            ? Number.parseInt(round_raw, 10)
            : NaN
      if (!Number.isFinite(round_number)) return null
      const content =
        typeof row.content === 'string'
          ? row.content
          : row.content === null
            ? null
            : null
      return { ai_name, content, round_number }
    })
    .filter((x): x is ArenaShareRoundRow => Boolean(x))
}
