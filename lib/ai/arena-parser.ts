import type { ArenaAI, ArenaResponse } from '@/lib/ai/arena-types'

/** Balanced <Internal_Targeting>...</Internal_Targeting> (spacing / case tolerant). */
const INTERNAL_BLOCK_BALANCED =
  /<\s*Internal_Targeting\b[^>]*>[\s\S]*?<\s*\/\s*Internal_Targeting\b[^>]*>/gi
const INTERNAL_CLOSING_ALONE = /<\s*\/\s*Internal_Targeting\b[^>]*>/gi
const INTERNAL_OPEN_TO_EOF = /<\s*Internal_Targeting\b[^>]*>[\s\S]*/gi

/**
 * Remove Internal_Targeting blocks before display.
 * Strips balanced regions first, then orphan closers, then any unclosed opener through end of text.
 */
export function stripInternalTargetingBlock(text: string): string {
  let t = text
  for (let i = 0; i < 64; i++) {
    const next = t.replace(INTERNAL_BLOCK_BALANCED, '')
    if (next === t) break
    t = next
  }
  t = t.replace(INTERNAL_CLOSING_ALONE, '')
  t = t.replace(INTERNAL_OPEN_TO_EOF, '')
  return t.trim()
}

/** Strip ** * __ _ style markdown from visible body. */
export function stripArenaMarkdown(text: string): string {
  let t = text
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1')
  t = t.replace(/\*([^*]+)\*/g, '$1')
  t = t.replace(/\*{2,}/g, '')
  t = t.replace(/\*/g, '')
  t = t.replace(/__([^_]+)__/g, '$1')
  t = t.replace(/__+/g, '')
  t = t.replace(/(^|[\s(])_([^_\n]+?)_([\s).,!?;:]|$)/g, '$1$2$3')
  return t
}

const ARENA_LEAK_SUBSTRINGS = [
  'CHAMPION:',
  'POSITION:',
  'ANGLE:',
  'CHALLENGE:',
  'SUPPORT:',
  'SUPPORT_COMMENT:',
  'AGREE_WITH',
  'DISAGREE_WITH',
  'Internal_Targeting',
  'INTERNAL_TARGETING',
] as const

/** Remove leaked template / tag lines (substring match per line). */
export function stripArenaTagLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const s = line.trim()
      if (!s) return true
      if (ARENA_LEAK_SUBSTRINGS.some((frag) => s.includes(frag))) return false
      const loneTag = s.match(/^([A-Z][A-Z0-9_]*)\s*:\s*\S/)
      if (loneTag?.[1] && loneTag[1] === loneTag[1].toUpperCase() && loneTag[1].length <= 56) {
        return false
      }
      return true
    })
    .join('\n')
    .trim()
}

function stripArenaAngleBrackets(text: string): string {
  let t = text
  for (let i = 0; i < 8; i++) {
    const next = t.replace(/<[^>\n]*>/g, '').trim()
    if (next === t) break
    t = next
  }
  return t
}

/** Strip tags, internal blocks, markdown; repeat until stable (handles stray tag lines). */
export function finalizeArenaVisibleBody(text: string): string {
  let t = text
  for (let i = 0; i < 12; i++) {
    const next = stripArenaMarkdown(
      stripArenaAngleBrackets(stripInternalTargetingBlock(stripArenaTagLines(t)))
    ).trim()
    if (next === t) break
    t = next
  }
  return t
}

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
  // "DISAGREE_WITH_X" contains the substring "AGREE_WITH_X" — do not treat as agreement.
  if (/DISAGREE_WITH_/i.test(position)) return null
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
  const stripped = stripInternalTargetingBlock(rawText)
  const championRaw = lineValue(stripped, 'CHAMPION')
  const champion = Boolean(championRaw && championRaw.toUpperCase().startsWith('Y'))
  const position = lineValue(stripped, 'POSITION') ?? 'INDEPENDENT'
  const angleRaw = lineValue(stripped, 'ANGLE') ?? ''
  const challenge = noneOrString(lineValue(stripped, 'CHALLENGE'))
  const support = noneOrString(lineValue(stripped, 'SUPPORT'))
  const supportCommentRaw = noneOrString(lineValue(stripped, 'SUPPORT_COMMENT'))

  let content = stripped
  for (const key of LINE_TAGS) {
    const re = new RegExp(`^${key}:\\s*[^\\n]*\\n?`, 'gim')
    content = content.replace(re, '')
  }
  content = stripInternalTargetingBlock(content)
  content = finalizeArenaVisibleBody(content)

  const angle = stripArenaMarkdown(angleRaw)
  const supportComment = supportCommentRaw ? stripArenaMarkdown(supportCommentRaw) : null
  const angleForFallback = (stripArenaMarkdown(angleRaw) || '').trim()
  if (content.replace(/\s+/g, ' ').trim().length < 20 && angleForFallback.length > 0) {
    content = finalizeArenaVisibleBody(angleForFallback)
  }

  return {
    champion,
    position: position || 'INDEPENDENT',
    angle: angle || '',
    challenge: challenge ?? null,
    support: support ?? null,
    supportComment,
    content:
      finalizeArenaVisibleBody(content || angleForFallback || stripInternalTargetingBlock(stripped)),
  }
}

function opposite(side: 'left' | 'right'): 'left' | 'right' {
  return side === 'left' ? 'right' : 'left'
}

export type ArenaCampContext = {
  left: ArenaAI[]
  right: ArenaAI[]
  leftChamp: ArenaAI | null
  rightChamp: ArenaAI | null
}

function campOfAi(ai: ArenaAI, ctx: ArenaCampContext): 'left' | 'right' | null {
  if (ctx.leftChamp === ai || ctx.left.includes(ai)) return 'left'
  if (ctx.rightChamp === ai || ctx.right.includes(ai)) return 'right'
  return null
}

/**
 * Visual column: DISAGREE_WITH_X → opposite side from X's camp.
 * AGREE_WITH_X → same side as X. Else speaker's camp.
 */
export function computeBubbleAlign(r: ArenaResponse, ctx: ArenaCampContext): 'left' | 'right' {
  const dis = parseDisagreeTarget(r.position)
  if (dis) {
    const targetCamp = campOfAi(dis, ctx)
    if (targetCamp === 'left') return 'right'
    if (targetCamp === 'right') return 'left'
  }
  const agr = parseAgreeTarget(r.position)
  if (agr) {
    const c = campOfAi(agr, ctx)
    if (c === 'left' || c === 'right') return c
  }
  const self = campOfAi(r.ai, ctx)
  if (self === 'left' || self === 'right') return self
  return 'left'
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
      const dis = parseDisagreeTarget(r.position)
      if (dis && side.has(dis) && !side.has(r.ai)) {
        assign(r.ai, opposite(side.get(dis)!))
        changed = true
      }
    }
    for (const r of responses) {
      const agree = parseAgreeTarget(r.position)
      if (agree && side.has(agree) && !side.has(r.ai)) {
        assign(r.ai, side.get(agree)!)
        changed = true
      }
    }
    for (const r of responses) {
      const sup = r.support ? resolveArenaAiName(String(r.support)) : null
      if (sup && side.has(sup) && !side.has(r.ai)) {
        assign(r.ai, side.get(sup)!)
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

  const shuffleResponses = (arr: ArenaResponse[]): ArenaResponse[] => {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j]!, a[i]!]
    }
    return a
  }

  const pickChampion = (ais: ArenaAI[]): ArenaAI | null => {
    if (ais.length === 0) return null
    const inOrder = [...responses].filter((r) => ais.includes(r.ai))
    const champs = inOrder.filter((r) => r.champion)
    if (champs.length) return shuffleResponses(champs)[0]!.ai
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
