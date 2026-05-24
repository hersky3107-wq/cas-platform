export const PUBLIC_SHARE_BASE = 'https://www.aimani.ai/share'

export type CompareSessionResponse = {
  ai_name: string
  content: string | null
}

export type CompareSessionRow = {
  id: string
  share_id: string
  user_id: string
  question: string
  responses: CompareSessionResponse[]
  is_public: boolean
  voted_ai: string | null
  created_at?: string
  updated_at?: string
}

export function parseCompareResponses(raw: unknown): CompareSessionResponse[] {
  if (!Array.isArray(raw)) return []
  const out: CompareSessionResponse[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const ai_name = typeof o.ai_name === 'string' ? o.ai_name.trim() : ''
    const content =
      o.content === null ? null : typeof o.content === 'string' ? o.content : ''
    if (!ai_name) continue
    out.push({ ai_name, content })
  }
  return out
}
