export const PUBLIC_SHARE_BASE = 'https://www.aimani.ai/share'

export type PanelSessionResponse = {
  ai_name: string
  content: string | null
}

export function parsePanelResponses(raw: unknown): PanelSessionResponse[] {
  if (!Array.isArray(raw)) return []

  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const ai_name = typeof row.ai_name === 'string' ? row.ai_name.trim() : ''
      if (!ai_name) return null
      const content =
        typeof row.content === 'string' ? row.content : row.content === null ? null : null
      return { ai_name, content }
    })
    .filter((x): x is PanelSessionResponse => Boolean(x))
}

