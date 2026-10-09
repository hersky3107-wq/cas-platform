import { createHash } from 'node:crypto'
import {
  analystSystem,
  analystUser,
  cacheKey,
  hunterSystem,
  hunterUser,
  judgeSystem,
  judgeUser,
  queryWriterSystem,
  queryWriterUser,
  redTeamSystem,
  redTeamUser,
  searchSystem,
  searchUser,
} from './prompts'
import { DEFAULT_COST_CAP_USD, estimateTokens, listPriceCost, ROLE_TIMEOUT_MS, TOKEN_CAPS, TYPICAL_OUTPUT_TOKENS } from './prices'
import { resolveRoster, slotsFor, type ResolvedRoster, type RosterSlot } from './roster'
import { engineResultSchema, hypothesisSchema, type Department, type EngineCard, type EngineResult, type EngineRole, type Horizon, type Hypothesis } from './schema'
import { normalizeSearchItems, type SearchItem } from './search-items'
import { departmentsTouched, noveltyOf, structureOf, weaknessOf, type Weakness } from './structure'

export interface ModelCall {
  role: EngineRole
  slot: string
  model: string
  provider: string
  system: string
  user: string
  maxTokens: number
  timeoutMs: number
  search: boolean
}

export interface ModelCaller {
  complete(call: ModelCall): Promise<{
    text: string
    tokensIn: number
    tokensOut: number
    costUsd: number | null
  }>
}

export interface EngineStepRecord {
  role: EngineRole
  slot: string
  model: string
  provider: string
  promptHash: string
  system: string
  user: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number
  output: unknown
  error: string | null
  skipped: boolean
}

interface Draft {
  id: string
  title: string
  chain: Array<{ step: string; cascade_id: string | null }>
  why_humans_miss: string
  evidence: Array<{ type: string; ref: string; url?: string }>
  what_to_do: string[]
  official_links: Array<{ label: string; url: string }>
  proposed_by: string[]
  weakness_notes: string[]
  weakness: Weakness
}

export interface EngineRunRecord {
  id?: string
  cacheKey: string
  cacheHit: boolean
  regionId: number
  horizon: Horizon
  mode: 'region' | 'top' | 'global'
  status: 'done' | 'error'
  roster: ResolvedRoster
  costUsd: number
  tokensIn: number
  tokensOut: number
  result: EngineResult | null
  steps: EngineStepRecord[]
  card: EngineCard
  searchUrls: string[]
  error: string | null
  dryRun: boolean
}

export interface EngineCache {
  get(key: string): Promise<EngineRunRecord | null>
  put(record: EngineRunRecord): Promise<void>
}

export interface RunEngineOptions {
  card: EngineCard
  caller: ModelCaller
  dryRun?: boolean
  now?: Date
  mode?: 'region' | 'top' | 'global'
  costCapUsd?: number
  roster?: ResolvedRoster
  cache?: EngineCache
  costOf?: (model: string, tokensIn: number, tokensOut: number) => number
}

export function promptHash(system: string, user: string): string {
  return createHash('sha256').update(system).update('\n').update(user).digest('hex').slice(0, 16)
}

export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('model returned no JSON object')
  return JSON.parse(raw.slice(start, end + 1))
}

export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export async function runEngine(opts: RunEngineOptions): Promise<EngineRunRecord> {
  const now = opts.now ?? new Date()
  const roster = opts.roster ?? resolveRoster()
  const key = cacheKey(opts.card.region_id, opts.card.horizon, now)
  const costOf = opts.costOf ?? listPriceCost
  const cap = opts.costCapUsd ?? DEFAULT_COST_CAP_USD
  if (!opts.dryRun && opts.cache) {
    const hit = await opts.cache.get(key)
    if (hit?.result && hit.status === 'done') return { ...hit, cacheHit: true, cacheKey: key }
  }

  const steps: EngineStepRecord[] = []
  let spent = 0
  let tokensIn = 0
  let tokensOut = 0
  let partial = false
  const notes: string[] = []

  const callSlot = async (slot: RosterSlot, system: string, user: string): Promise<unknown | null> => {
    const inputEstimate = estimateTokens(`${system}\n${user}`)
    const outputCap = TOKEN_CAPS[slot.role].out
    const estimate = costOf(slot.model, inputEstimate, outputCap)
    const base = {
      role: slot.role,
      slot: slot.slot,
      model: slot.model,
      provider: slot.provider,
      promptHash: promptHash(system, user),
      system,
      user,
    }
    if (inputEstimate > TOKEN_CAPS[slot.role].in || spent + estimate > cap) {
      partial = true
      steps.push({
        ...base,
        inputTokens: inputEstimate,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: 0,
        output: null,
        error: inputEstimate > TOKEN_CAPS[slot.role].in ? 'token cap' : 'budget',
        skipped: true,
      })
      return null
    }
    if (opts.dryRun) {
      const dryOut = Math.min(TYPICAL_OUTPUT_TOKENS[slot.role], outputCap)
      const dryCost = costOf(slot.model, inputEstimate, dryOut)
      steps.push({
        ...base,
        inputTokens: inputEstimate,
        outputTokens: dryOut,
        costUsd: dryCost,
        latencyMs: 0,
        output: null,
        error: null,
        skipped: false,
      })
      spent += dryCost
      tokensIn += inputEstimate
      tokensOut += dryOut
      return null
    }
    const started = Date.now()
    try {
      const result = await withTimeout(
        opts.caller.complete({
          role: slot.role,
          slot: slot.slot,
          model: slot.model,
          provider: slot.provider,
          system,
          user,
          maxTokens: outputCap,
          timeoutMs: ROLE_TIMEOUT_MS[slot.role],
          search: slot.search,
        }),
        ROLE_TIMEOUT_MS[slot.role],
      )
      const parsed = extractJson(result.text)
      const cost = result.costUsd ?? costOf(slot.model, result.tokensIn, result.tokensOut)
      steps.push({
        ...base,
        inputTokens: result.tokensIn,
        outputTokens: result.tokensOut,
        costUsd: cost,
        latencyMs: Date.now() - started,
        output: parsed,
        error: null,
        skipped: false,
      })
      spent += cost
      tokensIn += result.tokensIn
      tokensOut += result.tokensOut
      return parsed
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'call failed'
      steps.push({
        ...base,
        inputTokens: inputEstimate,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - started,
        output: null,
        error: message,
        skipped: false,
      })
      return null
    }
  }

  for (const slot of slotsFor(roster, 'dept_analyst')) {
    const department = slot.slot as Department
    const parsed = await callSlot(slot, analystSystem(department), analystUser(opts.card, department))
    const record = asRecord(parsed)
    const note = typeof record?.notes === 'string' ? record.notes : ''
    if (note) notes.push(`${department}: ${note}`)
  }

  const writer = slotsFor(roster, 'query_writer')[0]
  const writerParsed = writer ? await callSlot(writer, queryWriterSystem(opts.card), queryWriterUser(opts.card, notes)) : null
  const queries = stringList(asRecord(writerParsed)?.queries).slice(0, 5)
  const searchQueries = queries.length > 0 ? queries : [`${opts.card.name} ${opts.card.country} flood dam health conflict`]

  const searchItems: SearchItem[] = []
  for (const slot of slotsFor(roster, 'search')) {
    const parsed = await callSlot(slot, searchSystem(), searchUser(searchQueries))
    const items = normalizeSearchItems(asRecord(parsed)?.items, slot.slot, now)
    searchItems.push(...items)
  }

  const drafts: Draft[] = []
  const hunterPacket = hunterUser(opts.card, notes, searchItems)
  for (const slot of slotsFor(roster, 'hunter')) {
    const parsed = await callSlot(slot, hunterSystem(), hunterPacket)
    const rows = asRecord(parsed)?.hypotheses
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      const draft = draftFromHunter(row, slot.model, opts.card.horizon, drafts.length)
      if (draft) drafts.push(draft)
    }
  }

  const red = slotsFor(roster, 'red_team')[0]
  if (opts.dryRun && red) {
    await callSlot(
      red,
      redTeamSystem(),
      redTeamUser([{ id: 'h0', title: '(hunter hypotheses are inserted here on a live run)', why_humans_miss: '', evidence: [] }]),
    )
  } else if (red && drafts.length > 0) {
    const parsed = await callSlot(
      red,
      redTeamSystem(),
      redTeamUser(drafts.map((draft) => ({
        id: draft.id,
        title: draft.title,
        why_humans_miss: draft.why_humans_miss,
        evidence: draft.evidence,
      }))),
    )
    applyWeakness(drafts, asRecord(parsed)?.notes)
  }

  const judge = slotsFor(roster, 'judge')[0]
  let summaries = {
    summary_ko: `${opts.card.name} 가능성`,
    summary_en: `Possibilities for ${opts.card.name}, ${opts.card.country}.`,
    headline_ko: `${opts.card.name} 가능성`,
    headline_en: `${opts.card.name}: crossed-department possibilities`,
  }
  let grouped: Array<{ draft: Draft; outsider: boolean; rank: number; sourceIds: string[] }> = drafts.map((draft, index) => ({
    draft,
    outsider: false,
    rank: index + 1,
    sourceIds: [draft.id],
  }))
  if (opts.dryRun && judge) {
    await callSlot(judge, judgeSystem(), judgeUser({
      hypotheses: [],
      search_items: searchItems,
      note: 'Hunter hypotheses, weakness notes, and search items are inserted here on a live run.',
    }))
  } else if (judge && drafts.length > 0) {
    const parsed = await callSlot(
      judge,
      judgeSystem(),
      judgeUser({
        hypotheses: drafts,
        search_items: searchItems,
        structure: 'stage comes from hunter count, department count, weakness, and evidence count',
      }),
    )
    const record = asRecord(parsed)
    if (record) {
      summaries = {
        summary_ko: stringOr(record.summary_ko, summaries.summary_ko),
        summary_en: stringOr(record.summary_en, summaries.summary_en),
        headline_ko: stringOr(record.headline_ko, summaries.headline_ko),
        headline_en: stringOr(record.headline_en, summaries.headline_en),
      }
      grouped = applyJudgeGroups(drafts, record.groups)
    }
  } else if (partial && drafts.length === 0) {
    summaries.headline_en = `${opts.card.name}: run stopped under the cost cap`
    summaries.summary_en = `The run for ${opts.card.name} stopped before a full brief because the cost cap was reached.`
  }

  const built = grouped.map(({ draft, outsider }) => toHypothesis(draft, outsider, opts.card.horizon, searchItems))
  const hypotheses = built.filter((row) => !row.outsider)
  const outsider = built.filter((row) => row.outsider)
  const covered = new Set(grouped.flatMap((row) => row.sourceIds))
  if (covered.size !== drafts.length) {
    throw new Error('judge dropped a hypothesis')
  }

  let result: EngineResult | null = null
  let status: 'done' | 'error' = 'done'
  let error: string | null = null
  if (!opts.dryRun) {
    const candidate: EngineResult = {
      hypotheses,
      outsider,
      ...summaries,
      map_focus: { lat: opts.card.lat, lon: opts.card.lon, zoom: opts.card.level === 0 ? 5 : 7 },
      partial,
    }
    const parsed = engineResultSchema.safeParse(candidate)
    if (!parsed.success) {
      status = 'error'
      error = parsed.error.issues.map((issue) => issue.message).join('; ')
    } else {
      result = parsed.data
    }
  }

  const record: EngineRunRecord = {
    cacheKey: key,
    cacheHit: false,
    regionId: opts.card.region_id,
    horizon: opts.card.horizon,
    mode: opts.mode ?? 'region',
    status: opts.dryRun ? 'done' : status,
    roster,
    costUsd: spent,
    tokensIn,
    tokensOut,
    result,
    steps,
    card: opts.card,
    searchUrls: searchItems.map((item) => item.url),
    error,
    dryRun: Boolean(opts.dryRun),
  }
  if (!opts.dryRun && status === 'done' && opts.cache) await opts.cache.put(record)
  return record
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function draftFromHunter(row: unknown, model: string, horizon: Horizon, index: number): Draft | null {
  const record = asRecord(row)
  if (!record || typeof record.title !== 'string' || !record.title.trim()) return null
  const chainRaw = Array.isArray(record.chain) ? record.chain : []
  const chain = chainRaw
    .map((step) => {
      const item = asRecord(step)
      if (!item || typeof item.step !== 'string' || !item.step.trim()) return null
      return { step: item.step.trim(), cascade_id: typeof item.cascade_id === 'string' ? item.cascade_id : null }
    })
    .filter((step): step is { step: string; cascade_id: string | null } => step !== null)
  const evidenceRaw = Array.isArray(record.evidence) ? record.evidence : []
  const evidence = evidenceRaw
    .map((item) => {
      const entry = asRecord(item)
      if (!entry || typeof entry.type !== 'string' || typeof entry.ref !== 'string') return null
      const url = typeof entry.url === 'string' ? entry.url : undefined
      return url ? { type: entry.type, ref: entry.ref, url } : { type: entry.type, ref: entry.ref }
    })
    .filter((item): item is { type: string; ref: string; url?: string } => item !== null)
  return {
    id: `h${index}`,
    title: record.title.trim(),
    chain: chain.length > 0 ? chain : [{ step: record.title.trim(), cascade_id: null }],
    why_humans_miss: stringOr(record.why_humans_miss, 'The departments that hold the pieces of this possibility do not share one desk.'),
    evidence,
    what_to_do: stringList(record.what_to_do).length > 0
      ? stringList(record.what_to_do)
      : ['Check the official links and local radio before you travel, and keep drinking water in the house.'],
    official_links: linkList(record.official_links),
    proposed_by: [model],
    weakness_notes: [],
    weakness: 'low',
  }
}

function linkList(value: unknown): Array<{ label: string; url: string }> {
  if (!Array.isArray(value)) return []
  const links: Array<{ label: string; url: string }> = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record || typeof record.label !== 'string' || typeof record.url !== 'string') continue
    if (!record.label.trim() || !record.url.trim()) continue
    links.push({ label: record.label.trim(), url: record.url.trim() })
  }
  return links
}

export function applyWeakness(drafts: Draft[], notes: unknown): void {
  const rows = Array.isArray(notes) ? notes : []
  drafts.forEach((draft, index) => {
    const match = rows
      .map((row) => asRecord(row))
      .find((row) => row?.id === draft.id) ?? asRecord(rows[index])
    const note = typeof match?.note === 'string' ? match.note : 'Red team did not return a note for this possibility.'
    const severity = typeof match?.severity === 'string' ? match.severity : undefined
    draft.weakness_notes = [...draft.weakness_notes, note]
    draft.weakness = weaknessOf(note, severity)
  })
}

export function applyJudgeGroups(
  drafts: Draft[],
  groups: unknown,
): Array<{ draft: Draft; outsider: boolean; rank: number; sourceIds: string[] }> {
  const byId = new Map(drafts.map((draft) => [draft.id, draft]))
  const used = new Set<string>()
  const placed: Array<{ draft: Draft; outsider: boolean; rank: number; sourceIds: string[] }> = []
  const rows = Array.isArray(groups) ? groups : []
  rows.forEach((row, index) => {
    const record = asRecord(row)
    if (!record) return
    const ids = stringList(record.ids).filter((id) => byId.has(id) && !used.has(id))
    if (ids.length === 0) return
    ids.forEach((id) => used.add(id))
    const merged = mergeDrafts(ids.map((id) => byId.get(id)!), record)
    const rank = typeof record.rank === 'number' ? record.rank : index + 1
    const outsider = record.outsider === true || rank > 3
    placed.push({ draft: merged, outsider, rank, sourceIds: ids })
  })
  for (const draft of drafts) {
    if (used.has(draft.id)) continue
    placed.push({ draft, outsider: true, rank: placed.length + 1, sourceIds: [draft.id] })
  }
  return placed
}

function mergeDrafts(rows: Draft[], override: Record<string, unknown>): Draft {
  const first = rows[0]
  const evidence = rows.flatMap((row) => row.evidence)
  const seen = new Set<string>()
  const uniqueEvidence = evidence.filter((item) => {
    const key = `${item.type}|${item.ref}|${item.url ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return {
    ...first,
    title: stringOr(override.title, first.title),
    why_humans_miss: stringOr(override.why_humans_miss, first.why_humans_miss),
    what_to_do: stringList(override.what_to_do).length > 0 ? stringList(override.what_to_do) : first.what_to_do,
    official_links: linkList(override.official_links).length > 0 ? linkList(override.official_links) : first.official_links,
    chain: rows.flatMap((row) => row.chain),
    evidence: uniqueEvidence,
    proposed_by: [...new Set(rows.flatMap((row) => row.proposed_by))],
    weakness_notes: rows.flatMap((row) => row.weakness_notes),
    weakness: rows.some((row) => row.weakness === 'high') ? 'high' : rows.some((row) => row.weakness === 'medium') ? 'medium' : 'low',
  }
}

function toHypothesis(draft: Draft, outsider: boolean, horizon: Horizon, items: SearchItem[]): Hypothesis {
  const departments = departmentsTouched(draft)
  const structure = structureOf({
    hunters: draft.proposed_by.length,
    departments: departments.length,
    weakness: draft.weakness,
    evidence: draft.evidence.length,
  })
  const hypothesis: Hypothesis = {
    title: draft.title,
    chain: draft.chain,
    horizon,
    possibility: structure.possibility,
    why_humans_miss: draft.why_humans_miss,
    evidence: draft.evidence,
    what_to_do: draft.what_to_do,
    official_links: draft.official_links,
    proposed_by: draft.proposed_by,
    weakness_notes: draft.weakness_notes,
    novelty: noveltyOf(draft.title, items),
    stage: structure.stage,
    confidence: structure.confidence,
    outsider,
  }
  return hypothesisSchema.parse(hypothesis)
}
