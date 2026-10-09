import { jsonrepair } from 'jsonrepair'

export const RETRY_JSON_HINT = 'Return only valid JSON. Max 2 hypotheses.'

export function stripThink(text: string): string {
  return text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').trim()
}

export function stripFences(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  return fenced ? fenced[1].trim() : text
}

export function firstBalancedJson(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let escape = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inStr) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return text.slice(start)
}

export function extractJson(text: string): unknown {
  const cleaned = stripFences(stripThink(text)).trim()
  const candidate = firstBalancedJson(cleaned)
  if (!candidate) throw new Error('model returned no JSON object')
  try {
    return JSON.parse(candidate)
  } catch {
    return JSON.parse(jsonrepair(candidate))
  }
}

export function logParseFailure(slot: string, text: string): void {
  console.warn(`json parse failed slot=${slot} raw=${text.slice(0, 500)}`)
}
