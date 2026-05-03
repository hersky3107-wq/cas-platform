import type { AiProviderName } from '@/lib/ai/router'
import { VERDICT_SCORE_AI_ORDER } from '@/lib/verdict-score'

/** Same six providers as Score / Compare verdict flow. */
export const VERDICT_RANK_AI_ORDER: AiProviderName[] = [...VERDICT_SCORE_AI_ORDER]

export function normalizeItemKey(item: string): string {
  return item.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Rough item list for 2–10 validation: split on newlines, commas, semicolons;
 * strip leading "1." / "1)" numbering; de-dupe case-insensitively.
 */
export function extractItemsFromUserInput(raw: string): string[] {
  const t = raw.trim()
  if (!t) return []
  const chunks = t
    .split(/(?:\r?\n|[,;])+/g)
    .map((s) => s.replace(/^\s*\d+[\.\)\]]\s*/, '').trim())
    .filter(Boolean)
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of chunks) {
    const k = normalizeItemKey(c)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(c)
  }
  return out
}

/** True if client-sent originals are the same items as server-extracted (order may differ). */
export function rankClientOriginalsMatchExtracted(fromClient: string[], extracted: string[]): boolean {
  if (fromClient.length !== extracted.length) return false
  const a = [...fromClient].map(normalizeItemKey).filter(Boolean).sort()
  const b = [...extracted].map(normalizeItemKey).filter(Boolean).sort()
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

export function buildVerdictRankSystemPrompt(criteriaTrimmed: string): string {
  const c = criteriaTrimmed.trim()
  const criteriaLead = c
    ? `Ranking criteria (apply strictly): ${c}\n\n`
    : ''
  return (
    criteriaLead +
    `You are a strict, expert judge. The user will give you a list of items to rank.\n\n` +
    `STEP 1: Parse the input — identify each item regardless of format ` +
    `(comma-separated, numbered, line breaks, etc.)\n\n` +
    `STEP 2: Rank ALL items from best to worst based on the criteria provided. ` +
    `If no criteria given, use overall merit, practicality, and impact.\n\n` +
    `STEP 3: Respond in EXACTLY this format and nothing else:\n` +
    `RANKING:\n` +
    `1. [item name] — [one sentence reason]\n` +
    `2. [item name] — [one sentence reason]\n` +
    `3. [item name] — [one sentence reason]\n` +
    `(continue for all items)\n\n` +
    `Be decisive. No ties. No hedging.\n\n` +
    `Provide specific, expert-level reasoning — avoid generic or obvious statements.\n\n` +
    `Always respond in the same language ` +
    `as the input text.\n\n` +
    `CRITICAL: Copy each item name EXACTLY as given — ` +
    `character by character. Never shorten, translate, ` +
    `or paraphrase any item name under any circumstances.`
  )
}

export function stripMarkdownFormattingForRank(raw: string): string {
  let t = raw.replace(/\r\n/g, '\n')
  t = t.replace(/^#{1,6}\s+/gm, '')
  t = t.replace(/\*\*([^*]*)\*\*/g, '$1')
  t = t.replace(/__(.+?)__/g, '$1')
  t = t.replace(/\*(.+?)\*/g, '$1')
  t = t.replace(/_(.+?)_/g, '$1')
  t = t.replace(/^\s*[-*+]\s+/gm, '')
  t = t.replace(/\*\*/g, '')
  t = t.replace(/\*/g, '')
  t = t.replace(/^-\s*/gm, '')
  t = t.replace(/\n{3,}/g, '\n\n')
  return t.trim()
}

export type ParsedRankLine = {
  rank: number
  item: string
  reason: string
}

function extractItemReason(rest: string): { item: string; reason: string } {
  const t = rest.trim()
  const dashSep = t.match(/\s[—–\-]\s/)
  if (dashSep != null && dashSep.index != null && dashSep.index > 0) {
    return {
      item: t.slice(0, dashSep.index).trim(),
      reason: t.slice(dashSep.index + dashSep[0].length).trim(),
    }
  }
  const colonParts = t.match(/^([^:]+):\s*(.*)$/)
  if (colonParts != null && colonParts[1].trim()) {
    return { item: colonParts[1].trim(), reason: (colonParts[2] ?? '').trim() }
  }
  return { item: t, reason: '' }
}

function rankFromCircledDigit(ch: string): number | null {
  const cp = ch.codePointAt(0)
  if (cp == null) return null
  if (cp >= 0x2460 && cp <= 0x2473) return cp - 0x245f
  return null
}

/** Parse one line: "1.", "1)", "① …" etc. Returns null if not a ranked line. */
function tryParseNumberedRankLine(line: string): ParsedRankLine | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const first = trimmed[0]!
  const circledRank = rankFromCircledDigit(first)
  if (circledRank != null) {
    let rest = trimmed.slice(1).trim()
    rest = rest.replace(/^[.、．:：)）]\s*/, '')
    if (!rest) return null
    const { item, reason } = extractItemReason(rest)
    if (!item) return null
    return { rank: circledRank, item, reason }
  }

  const ascii = trimmed.match(
    /^\s*(\d{1,3})\s*(?:[.、．:：]|\)|）)\s*(.+)$/
  )
  if (ascii) {
    const rank = parseInt(ascii[1], 10)
    if (Number.isNaN(rank) || rank < 1 || rank > 100) return null
    const rest = ascii[2].trim()
    const { item, reason } = extractItemReason(rest)
    if (!item) return null
    return { rank, item, reason }
  }

  return null
}

function parseNumberedLinesInText(content: string): ParsedRankLine[] {
  const entries: ParsedRankLine[] = []
  for (const line of content.split(/\n/)) {
    const row = tryParseNumberedRankLine(line)
    if (row) entries.push(row)
  }
  return entries
}

function stripLeadingNumberBullet(s: string): string {
  return s
    .replace(/^\s*(?:\d{1,3}|[\u2460-\u2473])\s*[.、．:：;；,，]?\s*/u, '')
    .replace(/^\s*(?:\d{1,3}|[\u2460-\u2473])\s*[)）]\s*/u, '')
    .trim()
}

function commaOrLineFallback(text: string): ParsedRankLine[] {
  const t = text.trim()
  if (!t) return []

  const rawLines = t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  if (rawLines.length >= 2) {
    return rawLines.map((line, i) => ({
      rank: i + 1,
      item: stripLeadingNumberBullet(line),
      reason: '',
    }))
  }

  const chunks = t.split(/[,;，；]/).map((s) => s.trim()).filter(Boolean)
  if (chunks.length >= 2) {
    return chunks.map((item, i) => ({
      rank: i + 1,
      item: stripLeadingNumberBullet(item),
      reason: '',
    }))
  }

  return []
}

export function parseVerdictRankResponse(text: string | null): { entries: ParsedRankLine[] } {
  if (!text) return { entries: [] }

  const idx = text.search(/RANKING\s*:/i)
  const afterHeader = idx >= 0 ? text.slice(idx).replace(/^RANKING\s*:\s*/i, '') : null

  let entries = afterHeader != null ? parseNumberedLinesInText(afterHeader) : []
  if (entries.length === 0) {
    entries = parseNumberedLinesInText(text)
  }
  if (entries.length === 0) {
    entries = commaOrLineFallback(text)
  }

  entries.sort((a, b) => a.rank - b.rank)
  return { entries }
}

export type JudgeRankingParsed = {
  provider: AiProviderName
  entries: { itemKey: string; itemLabel: string }[]
}

export function routerResultToJudgeRanking(
  provider: AiProviderName,
  text: string | null,
  error?: string
): JudgeRankingParsed {
  if (error || !text) return { provider, entries: [] }
  const plain = stripMarkdownFormattingForRank(text)
  const { entries } = parseVerdictRankResponse(plain)
  return {
    provider,
    entries: entries.map((e) => ({
      itemKey: normalizeItemKey(e.item),
      itemLabel: e.item.trim(),
    })),
  }
}

export type BordaRow = {
  itemKey: string
  itemLabel: string
  totalPoints: number
}

const MERGE_TRAILING_SUFFIXES = ['식단', '음식', '요리', '식', '式'] as const

/** Normalization for dedup / fuzzy match only — not for display. */
export function normalizeForMergeKey(s: string): string {
  let t = s.trim().toLowerCase()
  let changed = true
  while (changed) {
    changed = false
    for (const suf of MERGE_TRAILING_SUFFIXES) {
      if (t.endsWith(suf)) {
        t = t.slice(0, -suf.length)
        changed = true
      }
    }
  }
  t = t.replace(/\s+/g, '')
  t = t.replace(/[^\p{L}\p{N}]/gu, '')
  return t
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Array<number>(n + 1)
  let cur = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]!
}

/** Shorter normalized string must cover ≥80% of the longer — stops short tokens absorbing longer items. */
function mergeLengthRatioAccepts(normA: string, normB: string): boolean {
  const la = normA.length
  const lb = normB.length
  if (la === 0 || lb === 0) return false
  const shorter = Math.min(la, lb)
  const longer = Math.max(la, lb)
  return shorter / longer >= 0.8
}

/** Distance for matching AI text to an original (lowercase / spaces / suffixes ignored via normalize). */
function normDistanceForMatch(raw: string, original: string): number {
  if (raw.trim().toLowerCase() === original.trim().toLowerCase()) return 0
  const a = normalizeForMergeKey(raw)
  const b = normalizeForMergeKey(original)
  if (!a || !b) return 999
  if (a === b) return 0
  const [s, L] = a.length <= b.length ? [a, b] : [b, a]
  if (s.length >= 2 && L.includes(s)) {
    if (mergeLengthRatioAccepts(a, b)) return 0
  }
  const d = levenshteinDistance(a, b)
  if (!mergeLengthRatioAccepts(a, b)) return 999
  return d
}

/**
 * Closest original list item within edit distance 3 (after normalization rules).
 * Returns null if none qualifies — that AI line is discarded for Borda.
 */
function findClosestOriginalItem(raw: string, originalItems: string[]): string | null {
  const t = raw.trim()
  if (!t || originalItems.length === 0) return null
  let best: string | null = null
  let bestD = 999
  let bestIdx = 999
  for (let i = 0; i < originalItems.length; i++) {
    const o = originalItems[i]!
    const d = normDistanceForMatch(t, o)
    if (d < bestD || (d === bestD && i < bestIdx)) {
      bestD = d
      bestIdx = i
      best = o
    }
  }
  if (best != null && bestD <= 3) return best
  return null
}

function dedupeAnchoredPreservingOrder(anchored: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of anchored) {
    if (seen.has(x)) continue
    seen.add(x)
    out.push(x)
  }
  return out
}

/**
 * Map an AI-parsed item to the user's exact original string, or null if no match within distance 3.
 */
export function anchorItemToOriginalItems(
  raw: string,
  originalItems: string[]
): string | null {
  return findClosestOriginalItem(raw, originalItems)
}

/**
 * Borda over original input items only: each judge list is anchored then de-duped;
 * only originals appear in the result, each exactly once.
 */
export function computeBordaFinal(
  judges: JudgeRankingParsed[],
  originalItems: string[]
): BordaRow[] {
  if (originalItems.length === 0) return []

  const totals = new Map<string, number>()
  for (const o of originalItems) totals.set(o, 0)

  for (const j of judges) {
    const anchored: string[] = []
    for (const e of j.entries) {
      const c = findClosestOriginalItem(e.itemLabel, originalItems)
      if (c != null) anchored.push(c)
    }
    const ranked = dedupeAnchoredPreservingOrder(anchored)
    const N = ranked.length
    for (let i = 0; i < ranked.length; i++) {
      const o = ranked[i]!
      totals.set(o, (totals.get(o) ?? 0) + (N - i))
    }
  }

  return originalItems
    .map((o, idx) => ({
      itemKey: normalizeForMergeKey(o),
      itemLabel: o,
      totalPoints: totals.get(o) ?? 0,
      _idx: idx,
    }))
    .sort(
      (a, b) =>
        b.totalPoints - a.totalPoints ||
        a._idx - b._idx
    )
    .map(({ itemKey, itemLabel, totalPoints }) => ({ itemKey, itemLabel, totalPoints }))
}
