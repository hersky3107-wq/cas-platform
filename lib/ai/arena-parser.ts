import type { ArenaAI, ArenaResponse } from '@/lib/ai/arena-types'

const INTERNAL_BLOCK =
  /<Internal_Targeting>[\s\S]*?<\/Internal_Targeting>/gi

const LINE_TAGS = [
  'CHAMPION',
  'POSITION',
  'ANGLE',
  'CHALLENGE',
  'SUPPORT',
  'SUPPORT_COMMENT',
] as const

function lineValue(text: string, key: (typeof LINE_TAGS)[number]): string | null {
  const re = new RegExp(`^${key}:\\s*(.*)$`, 'im')
  const m = text.match(re)
  return m ? m[1]!.trim() : null
}

function noneOrString(v: string | null): string | null {
  if (v == null || v === '') return null
  const u = v.trim().toUpperCase()
  if (u === 'NONE' || u === 'N/A') return null
  return v.trim()
}

/** Map loose names (GPT, OpenAI, etc.) to ArenaAI */
export function resolveArenaAiName(raw: string | null): ArenaAI | null {
  if (!raw) return null
  const t = raw.trim().toLowerCase().replace(/\s+/g, '_')
  const aliases: Record<string, ArenaAI> = {
    gpt: 'gpt',
    chatgpt: 'gpt',
    openai: 'gpt',
    claude: 'claude',
    anthropic: 'claude',
    gemini: 'gemini',
    google: 'gemini',
    grok: 'grok',
    xai: 'grok',
    deepseek: 'deepseek',
    mistral: 'mistral',
  }
  if (aliases[t]) return aliases[t]
  for (const k of Object.keys(aliases)) {
    if (t.includes(k)) return aliases[k]!
  }
  return null
}

export function parseDisagreeTarget(position: string): ArenaAI | null {
  const m = position.match(/DISAGREE_WITH_([A-Za-z0-9_\s-]+)/i)
  if (!m) return null
  return resolveArenaAiName(m[1]!.replace(/_/g, ' '))
}

export function parseAgreeTarget(position: string): ArenaAI | null {
  const m = position.match(/AGREE_WITH_([A-Za-z0-9_\s-]+)/i)
  if (!m) return null
  return resolveArenaAiName(m[1]!.replace(/_/g, ' '))
}

export type ParsedArenaTagBlock = {
  champion: boolean
  position: string
  angle: string
  challenge: string | null
  support: string | null
  supportComment: string | null
  content: string
}

export function parseArenaResponse(rawText: string): ParsedArenaTagBlock {
  const stripped = rawText.replace(INTERNAL_BLOCK, '').trim()
  const championRaw = lineValue(stripped, 'CHAMPION')
  const champion = Boolean(championRaw && championRaw.toUpperCase().startsWith('Y'))
  const position = lineValue(stripped, 'POSITION') ?? 'INDEPENDENT'
  const angle = lineValue(stripped, 'ANGLE') ?? ''
  const challenge = noneOrString(lineValue(stripped, 'CHALLENGE'))
  const support = noneOrString(lineValue(stripped, 'SUPPORT'))
  const supportComment = noneOrString(lineValue(stripped, 'SUPPORT_COMMENT'))

  let content = stripped
  for (const key of LINE_TAGS) {
    const re = new RegExp(`^${key}:\\s*[^\\n]*\\n?`, 'gim')
    content = content.replace(re, '')
  }
  content = content.replace(INTERNAL_BLOCK, '').trim()

  return {
    champion,
    position: position || 'INDEPENDENT',
    angle: angle || '',
    challenge: challenge ?? null,
    support: support ?? null,
    supportComment: supportComment ?? null,
    content: content || stripped,
  }
}

function opposite(side: 'left' | 'right'): 'left' | 'right' {
  return side === 'left' ? 'right' : 'left'
}

/**
 * Classify opening-round responses into two camps and pick champions.
 */
export function determineSides(responses: ArenaResponse[]): {
  left: ArenaAI[]
  right: ArenaAI[]
  championLeft: ArenaAI | null
  championRight: ArenaAI | null
} {
  const present = new Set(responses.map((r) => r.ai))
  const side = new Map<ArenaAI, 'left' | 'right'>()

  const assign = (ai: ArenaAI, s: 'left' | 'right') => {
    if (!present.has(ai)) return
    const cur = side.get(ai)
    if (cur == null) {
      side.set(ai, s)
      return
    }
    if (cur !== s) {
      // conflict: keep first assignment
    }
  }

  let seeded = false
  for (const r of responses) {
    const d = parseDisagreeTarget(r.position)
    if (d) {
      assign(r.ai, 'left')
      assign(d, 'right')
      seeded = true
      break
    }
  }

  if (!seeded) {
    const first = responses[0]?.ai
    const second = responses[1]?.ai
    if (first) assign(first, 'left')
    if (second) assign(second, 'right')
    else if (first) assign(first, 'left')
  }

  let changed = true
  let guard = 0
  while (changed && guard++ < 20) {
    changed = false
    for (const r of responses) {
      const agree = parseAgreeTarget(r.position)
      if (agree && side.has(agree) && !side.has(r.ai)) {
        assign(r.ai, side.get(agree)!)
        changed = true
      }
      const dis = parseDisagreeTarget(r.position)
      if (dis && side.has(dis) && !side.has(r.ai)) {
        assign(r.ai, opposite(side.get(dis)!))
        changed = true
      }
    }
  }

  const left: ArenaAI[] = []
  const right: ArenaAI[] = []
  for (const ai of present) {
    if (!side.has(ai)) {
      side.set(ai, left.length <= right.length ? 'left' : 'right')
    }
    if (side.get(ai) === 'left') left.push(ai)
    else right.push(ai)
  }

  const orderIdx = (a: ArenaAI) =>
    ['grok', 'gpt', 'gemini', 'deepseek', 'mistral', 'claude'].indexOf(a)

  const pickChampion = (ais: ArenaAI[]): ArenaAI | null => {
    if (ais.length === 0) return null
    const inOrder = [...responses].filter((r) => ais.includes(r.ai))
    const champs = inOrder.filter((r) => r.champion)
    if (champs.length) return champs[0]!.ai
    const disagrees = inOrder.filter((r) => parseDisagreeTarget(r.position) != null)
    if (disagrees.length) return disagrees[0]!.ai
    return [...ais].sort((a, b) => orderIdx(a) - orderIdx(b))[0] ?? null
  }

  const championLeft = pickChampion(left) ?? left[0] ?? null
  const championRight = pickChampion(right) ?? right[0] ?? null

  return {
    left,
    right,
    championLeft,
    championRight,
  }
}
