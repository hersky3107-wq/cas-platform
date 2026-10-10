import { createHash } from 'node:crypto'
import {
  analystSystem,
  analystUser,
  cacheKey,
  departmentSliceEmpty,
  ensureQueries,
  fallbackQueries,
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
import { sameHazard } from '../config/hazard-taxonomy'
import { normalizeName } from '../ingest/iso'
import { mergeBaselineRisks, type AnalystFinding } from './baseline-fill'
import {
  applyFactPrecisionToDraft,
  entityEvidencePrecise,
  entityMatchContext,
  headlineRootKey,
  hedgeStaleStatusText,
  pickDiverseHeadlines,
  staleStatusFacts,
  type EvidenceDates,
} from './fact-precision'
import { coverageCounts, mainstreamFromSearch, noveltyFor, withinDays, type BackgroundCoverageItem, type CoverageItem } from './coverage'
import { checkHunterRow, clusterDrafts, entityCorpus, entityWords, HUNTER_MAX_HYPOTHESES, obviousList, type Draft, type ObviousEntry } from './hunter-rules'
import { extractJson, logParseFailure, RETRY_JSON_HINT } from './parse'
import {
  DEFAULT_COST_CAP_USD,
  estimateTokens,
  HUNTER_DEEPSEEK_TIMEOUT_MS,
  listPriceCost,
  outputBudget,
  ROLE_TIMEOUT_MS,
  TOKEN_CAPS,
  TYPICAL_OUTPUT_TOKENS,
} from './prices'
import { resolveRoster, slotsFor, type ResolvedRoster, type RosterSlot } from './roster'
import {
  engineResultSchema,
  hypothesisSchema,
  type BaselineRisk,
  type Department,
  type EngineCard,
  type EngineResult,
  type EngineRole,
  type Horizon,
  type Hypothesis,
} from './schema'
import { normalizeSearchItems, type SearchItem } from './search-items'
import { departmentsTouched, structureOf, weaknessOf } from './structure'
import { buildZoneLinks, tagsForText } from './zone-card'

export type { Draft } from './hunter-rules'

/** A coverage item counts as the same news when it is this recent and names the same entity. */
const REPORTED_DAYS = 14

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
  maxTurns?: number
  extraBody?: Record<string, unknown>
  googleThinking?: RosterSlot['googleThinking']
  anthropicThinking?: RosterSlot['anthropicThinking']
  jsonMode?: boolean
}

export interface ModelCaller {
  complete(call: ModelCall): Promise<{
    text: string
    tokensIn: number
    tokensOut: number
    costUsd: number | null
    searchItems?: SearchItem[]
    searchOrigin?: Record<string, number>
    finishReason?: string | null
  }>
}

const CUT_OFF = new Set(['length', 'max_tokens', 'MAX_TOKENS', 'incomplete'])

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
  dbId?: number
}

export interface EngineRunRecord {
  id?: string
  cacheKey: string
  cacheHit: boolean
  regionId: number
  horizon: Horizon
  mode: 'region' | 'top' | 'global' | 'zone'
  status: 'done' | 'error' | 'partial' | 'running'
  roster: ResolvedRoster
  costUsd: number
  tokensIn: number
  tokensOut: number
  result: EngineResult | null
  steps: EngineStepRecord[]
  card: EngineCard
  searchUrls: string[]
  queries: string[]
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
  mode?: 'region' | 'top' | 'global' | 'zone'
  costCapUsd?: number
  roster?: ResolvedRoster
  cache?: EngineCache
  costOf?: (model: string, tokensIn: number, tokensOut: number) => number
  force?: boolean
  /** ReliefWeb, GDACS, and Metaculus items for this card's country; mainstream search items are added in the run. */
  coverage?: CoverageItem[]
  /** Test hook. Live runs use ROLE_TIMEOUT_MS. */
  roleTimeouts?: Partial<Record<EngineRole, number>>
}

export function promptHash(system: string, user: string): string {
  return createHash('sha256').update(system).update('\n').update(user).digest('hex').slice(0, 16)
}

export { extractJson } from './parse'

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

function parseRegionTags(
  value: unknown,
  card: EngineCard,
): Array<{ region_id: number; name: string; iso3: string | null }> {
  if (!Array.isArray(value)) return []
  const members = card.members ?? []
  const out: Array<{ region_id: number; name: string; iso3: string | null }> = []
  for (const item of value) {
    const rec = asRecord(item)
    if (!rec) continue
    const name = typeof rec.name === 'string' ? rec.name : ''
    const hit = members.find((row) => row.region_id === rec.region_id || (name && row.name === name))
    if (!hit && !name) continue
    out.push({
      region_id: hit?.region_id ?? (typeof rec.region_id === 'number' ? rec.region_id : 0),
      name: hit?.name ?? name,
      iso3: hit?.iso3 ?? (typeof rec.iso3 === 'string' ? rec.iso3 : null),
    })
  }
  return out
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

export async function runEngine(opts: RunEngineOptions): Promise<EngineRunRecord> {
  const now = opts.now ?? new Date()
  const roster = opts.roster ?? resolveRoster()
  const zoneMode = opts.mode === 'zone' || Boolean(opts.card.zone_key)
  const key = cacheKey(opts.card.region_id, opts.card.horizon, now, zoneMode ? opts.card.zone_key : null)
  const costOf = opts.costOf ?? listPriceCost
  const cap = opts.costCapUsd ?? DEFAULT_COST_CAP_USD
  if (!opts.dryRun && !opts.force && opts.cache) {
    const hit = await opts.cache.get(key)
    if (hit?.result && hit.status === 'done' && !hit.result.partial) return { ...hit, cacheHit: true, cacheKey: key }
  }

  const steps: EngineStepRecord[] = []
  let spent = 0
  let reserved = 0
  let tokensIn = 0
  let tokensOut = 0
  let partial = false
  const notes: string[] = []
  const analystFindings: AnalystFinding[] = []
  let judgeBaselineRows: unknown = null
  const live: EngineRunRecord = {
    cacheKey: key,
    cacheHit: false,
    regionId: opts.card.region_id,
    horizon: opts.card.horizon,
    mode: zoneMode ? 'zone' : opts.mode ?? 'region',
    status: 'running',
    roster,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    result: null,
    steps,
    card: opts.card,
    searchUrls: [],
    queries: [],
    error: null,
    dryRun: Boolean(opts.dryRun),
  }

  const timeoutFor = (slot: RosterSlot) => {
    const override = opts.roleTimeouts?.[slot.role]
    if (override != null) return override
    if (slot.slot === 'hunter-deepseek') return HUNTER_DEEPSEEK_TIMEOUT_MS
    return ROLE_TIMEOUT_MS[slot.role]
  }

  let persistTail = Promise.resolve()
  const flushLive = async (status: EngineRunRecord['status'] = 'running') => {
    if (opts.dryRun || !opts.cache) return
    live.status = status
    live.costUsd = spent
    live.tokensIn = tokensIn
    live.tokensOut = tokensOut
    const write = persistTail.then(async () => {
      try {
        await opts.cache!.put(live)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'persist failed'
        console.warn(`engine step persist failed: ${message}`)
      }
    })
    persistTail = write.then(
      () => undefined,
      () => undefined,
    )
    await write
  }

  const pushStep = (step: EngineStepRecord) => {
    steps.push(step)
    return step
  }

  const finishStep = (
    step: EngineStepRecord,
    patch: Partial<Pick<EngineStepRecord, 'inputTokens' | 'outputTokens' | 'costUsd' | 'latencyMs' | 'output' | 'error' | 'skipped'>>,
  ) => {
    Object.assign(step, patch)
  }

  const callSlot = async (
    slot: RosterSlot,
    system: string,
    user: string,
  ): Promise<{ parsed: unknown | null; searchItems: SearchItem[] } | null> => {
    const inputEstimate = estimateTokens(`${system}\n${user}`)
    const outputCap = outputBudget(slot.role, Boolean(slot.reasoning))
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
    if (inputEstimate > TOKEN_CAPS[slot.role].in || spent + reserved + estimate > cap) {
      partial = true
      pushStep({
        ...base,
        inputTokens: inputEstimate,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: 0,
        output: null,
        error: inputEstimate > TOKEN_CAPS[slot.role].in ? 'token cap' : 'budget',
        skipped: true,
      })
      await flushLive()
      return null
    }
    reserved += estimate
    if (opts.dryRun) {
      const dryOut = Math.min(TYPICAL_OUTPUT_TOKENS[slot.role], TOKEN_CAPS[slot.role].out)
      const dryCost = costOf(slot.model, inputEstimate, dryOut)
      reserved -= estimate
      spent += dryCost
      tokensIn += inputEstimate
      tokensOut += dryOut
      pushStep({
        ...base,
        inputTokens: inputEstimate,
        outputTokens: dryOut,
        costUsd: dryCost,
        latencyMs: 0,
        output: null,
        error: null,
        skipped: false,
      })
      return { parsed: null, searchItems: [] }
    }
    const step = pushStep({
      ...base,
      inputTokens: inputEstimate,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: 0,
      output: null,
      error: null,
      skipped: false,
    })
    await flushLive()
    const started = Date.now()
    const timeoutMs = timeoutFor(slot)
    const settle = (actual: number, inTok: number, outTok: number) => {
      reserved -= estimate
      spent += actual
      tokensIn += inTok
      tokensOut += outTok
    }
    const invoke = async (promptUser: string) =>
      withTimeout(
        opts.caller.complete({
          role: slot.role,
          slot: slot.slot,
          model: slot.model,
          provider: slot.provider,
          system,
          user: promptUser,
          maxTokens: outputCap,
          timeoutMs,
          search: slot.search,
          maxTurns: slot.maxTurns,
          extraBody: slot.extraBody,
          googleThinking: slot.googleThinking,
          anthropicThinking: slot.anthropicThinking,
          jsonMode: !slot.search,
        }),
        timeoutMs,
      )
    const recordFinish = (
      result: { tokensIn: number; tokensOut: number; costUsd: number | null },
      parsed: unknown,
      error: string | null,
    ) => {
      const cost = result.costUsd ?? costOf(slot.model, result.tokensIn, result.tokensOut)
      settle(cost, result.tokensIn, result.tokensOut)
      finishStep(step, {
        inputTokens: result.tokensIn,
        outputTokens: result.tokensOut,
        costUsd: cost,
        latencyMs: Date.now() - started,
        output: parsed,
        error,
        skipped: false,
      })
    }
    try {
      const result = await invoke(user)
      if (result.finishReason && CUT_OFF.has(result.finishReason)) {
        console.warn(`${slot.slot}: output hit the ${outputCap}-token cap (${result.finishReason}); repaired JSON may end mid-item`)
      }
      const apiItems = normalizeSearchItems(result.searchItems, slot.slot, now)
      if (slot.search) {
        let parsed: unknown = { items: apiItems, origin: result.searchOrigin ?? 'api' }
        if (!apiItems.length) {
          try {
            parsed = extractJson(result.text)
          } catch {
            parsed = { items: [], origin: result.searchOrigin ?? 'none' }
          }
        }
        recordFinish(result, parsed, null)
        await flushLive()
        return { parsed, searchItems: apiItems }
      }
      try {
        const parsed = extractJson(result.text)
        recordFinish(result, parsed, null)
        await flushLive()
        return { parsed, searchItems: apiItems }
      } catch (parseError) {
        logParseFailure(slot.slot, result.text)
        const retry = await invoke(`${user}\n${RETRY_JSON_HINT}`)
        try {
          const parsed = extractJson(retry.text)
          recordFinish(
            {
              tokensIn: result.tokensIn + retry.tokensIn,
              tokensOut: result.tokensOut + retry.tokensOut,
              costUsd: (result.costUsd ?? 0) + (retry.costUsd ?? 0) || null,
            },
            parsed,
            null,
          )
          await flushLive()
          return { parsed, searchItems: apiItems }
        } catch {
          logParseFailure(slot.slot, retry.text)
          recordFinish(retry, null, parseError instanceof Error ? parseError.message : 'json parse failed')
          await flushLive()
          return null
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'call failed'
      console.warn(`${slot.slot}: skipped (${message})`)
      reserved -= estimate
      finishStep(step, {
        inputTokens: inputEstimate,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - started,
        output: null,
        error: message,
        skipped: true,
      })
      await flushLive()
      return null
    }
  }

  await flushLive('running')

  const analystCalled = await Promise.all(
    slotsFor(roster, 'dept_analyst').map(async (slot) => {
      const department = slot.slot as Department
      if (departmentSliceEmpty(opts.card, department)) {
        pushStep({
          role: slot.role,
          slot: slot.slot,
          model: slot.model,
          provider: slot.provider,
          promptHash: promptHash(analystSystem(department, zoneMode), analystUser(opts.card, department)),
          system: analystSystem(department, zoneMode),
          user: analystUser(opts.card, department),
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: 0,
          output: null,
          error: 'skipped: empty slice',
          skipped: true,
        })
        await flushLive()
        return { department, called: null as Awaited<ReturnType<typeof callSlot>> }
      }
      return { department, called: await callSlot(slot, analystSystem(department, zoneMode), analystUser(opts.card, department)) }
    }),
  )
  for (const { department, called } of analystCalled) {
    const record = asRecord(called?.parsed)
    const note = typeof record?.notes === 'string' ? record.notes : ''
    if (note) notes.push(`${department}: ${note}`)
    for (const signal of stringList(record?.signals)) analystFindings.push({ department, signal })
  }

  const writer = slotsFor(roster, 'query_writer')[0]
  const writerCalled = writer ? await callSlot(writer, queryWriterSystem(opts.card), queryWriterUser(opts.card, notes)) : null
  const queries = ensureQueries(opts.card, stringList(asRecord(writerCalled?.parsed)?.queries))
  const searchQueries = queries.length > 0 ? queries : fallbackQueries(opts.card)

  const searchItems: SearchItem[] = []
  const searchCalled = await Promise.all(
    slotsFor(roster, 'search').map(async (slot) => ({
      slot,
      called: await callSlot(slot, searchSystem(), searchUser(searchQueries)),
    })),
  )
  for (const { slot, called } of searchCalled) {
    if (called?.searchItems.length) {
      searchItems.push(...called.searchItems)
      continue
    }
    searchItems.push(...normalizeSearchItems(asRecord(called?.parsed)?.items, slot.slot, now))
  }

  const coverage = [...(opts.coverage ?? []), ...mainstreamFromSearch(searchItems, opts.card, now)]
  const obvious = obviousList(opts.card)
  const alreadyReported = [...coverage]
    .sort((a, b) => Number(b.region_match) - Number(a.region_match) || (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, 12)
    .map((item) => ({ source: item.source, title: item.title, url: item.url, date: item.date }))
  const hunterItems = searchItems.slice(0, 8)
  const entityCtx = entityMatchContext(opts.card, searchItems)
  const corpus = entityCorpus(opts.card, hunterItems, alreadyReported.map((item) => item.title))

  const drafts: Draft[] = []
  const rejected: Array<{ model: string; title: string; reasons: string[] }> = []
  const hunterPacket = hunterUser(opts.card, notes, hunterItems, {
    obvious: obvious.map((row) => row.line),
    alreadyReported,
  })
  let hunterOk = 0
  const hunterCalled = await Promise.all(
    slotsFor(roster, 'hunter').map(async (slot) => ({
      slot,
      called: await callSlot(slot, hunterSystem(zoneMode), hunterPacket),
    })),
  )
  for (const { slot, called } of hunterCalled) {
    const rows = asRecord(called?.parsed)?.hypotheses
    if (!Array.isArray(rows)) continue
    hunterOk += 1
    rows.slice(HUNTER_MAX_HYPOTHESES).forEach((row) => {
      rejected.push({ model: slot.model, title: stringOr(asRecord(row)?.title, '(no title)'), reasons: [`over the ${HUNTER_MAX_HYPOTHESES} per hunter limit`] })
    })
    for (const row of rows.slice(0, HUNTER_MAX_HYPOTHESES)) {
      const checked = checkHunterRow(row, { model: slot.model, id: `h${drafts.length}`, card: opts.card, corpus, entityCtx })
      if (checked.draft) {
        const tagged = parseRegionTags(asRecord(row)?.regions, opts.card)
        const fallback = tagsForText(
          `${checked.draft.title} ${checked.draft.entities.join(' ')} ${checked.draft.mechanism}`,
          opts.card.members ?? [],
        )
        checked.draft.regions = tagged.length ? tagged : fallback
        drafts.push(checked.draft)
      }
      else rejected.push({ model: checked.model, title: checked.title, reasons: checked.reasons })
    }
  }
  if (hunterOk < 2) partial = true

  const red = slotsFor(roster, 'red_team')[0]
  if (opts.dryRun && red) {
    await callSlot(
      red,
      redTeamSystem(),
      redTeamUser([{ id: 'h0', title: '(hunter hypotheses are inserted here on a live run)', why_humans_miss: '', evidence: [] }]),
    )
  } else if (red && drafts.length > 0) {
    const called = await callSlot(
      red,
      redTeamSystem(),
      redTeamUser(drafts.map((draft) => ({
        id: draft.id,
        title: draft.title,
        why_humans_miss: draft.why_humans_miss,
        evidence: draft.evidence,
      }))),
    )
    applyWeakness(drafts, asRecord(called?.parsed)?.notes)
  }

  const judge = slotsFor(roster, 'judge')[0]
  let summaries = {
    summary_ko: `${opts.card.name} 가능성`,
    summary_en: `Possibilities for ${opts.card.name}, ${opts.card.country}.`,
    headline_ko: `${opts.card.name} 가능성`,
    headline_en: `${opts.card.name}: crossed-department possibilities`,
  }
  const suggested = clusterDrafts(drafts, opts.card)
  const byId = new Map(drafts.map((draft) => [draft.id, draft]))
  let grouped: Placed[] = suggested.map((ids, index) => ({
    draft: ids.length > 1 ? mergeDrafts(ids.map((id) => byId.get(id)!), {}) : byId.get(ids[0])!,
    outsider: false,
    rank: index + 1,
    sourceIds: ids,
    judge: null,
  }))
  const judgePacket = (hypotheses: unknown[]) => ({
    card: {
      region: opts.card.name,
      country: opts.card.country,
      horizon: opts.card.horizon,
      forecast_totals: '7-day (7일)',
    },
    hypotheses,
    suggested_groups: suggested,
    obvious_list: obvious.map((row) => row.line),
    already_reported: coverage.slice(0, 25).map((item) => ({ source: item.source, title: item.title, url: item.url, date: item.date, hazards: item.hazards })),
    search_items: searchItems.map((item) => ({ title: item.title, url: item.url, published: item.undated ? 'undated' : item.published })),
  })
  if (opts.dryRun && judge) {
    await callSlot(judge, judgeSystem(), judgeUser(judgePacket([{ id: 'h0', note: 'Hunter hypotheses and weakness notes are inserted here on a live run.' }])))
  } else if (judge && hunterOk >= 2 && drafts.length > 0) {
    const called = await callSlot(
      judge,
      judgeSystem(),
      judgeUser(judgePacket(drafts.map((draft) => ({
        id: draft.id,
        title: draft.title,
        proposed_by: draft.proposed_by,
        hazards: draft.hazards,
        departments: draft.departments,
        entities: draft.entities,
        mechanism: draft.mechanism,
        lead_time_days: draft.lead_time_days,
        early_indicators: draft.early_indicators,
        falsifier: draft.falsifier,
        why_humans_miss: draft.why_humans_miss,
        evidence: draft.evidence,
        what_to_do: draft.what_to_do,
        official_links: draft.official_links,
        weakness_notes: draft.weakness_notes,
      })))),
    )
    const record = asRecord(called?.parsed)
    if (record?.baseline_risks != null) judgeBaselineRows = record.baseline_risks
    if (record && Array.isArray(record.groups)) grouped = applyJudgeGroups(drafts, record.groups)
  } else if (partial && drafts.length === 0) {
    summaries.headline_en = `${opts.card.name}: run stopped under the cost cap`
    summaries.summary_en = `The run for ${opts.card.name} stopped before a full brief because the cost cap was reached.`
  }

  const covered = new Set(grouped.flatMap((row) => row.sourceIds))
  if (covered.size !== drafts.length) {
    throw new Error('judge dropped a hypothesis')
  }

  const knownUrls = new Set([
    ...searchItems.map((item) => item.url),
    ...coverage.map((item) => item.url),
    ...drafts.flatMap((draft) => [...draft.evidence.flatMap((item) => (item.url ? [item.url] : [])), ...draft.official_links.map((link) => link.url)]),
  ])
  const evidenceDates: EvidenceDates = new Map(searchItems.map((item) => [item.url, item.published]))
  const backgroundByUrl = new Map<string, BackgroundCoverageItem>()
  const scored = grouped.map((row) => {
    const verdict = obviousnessOf(row, opts.card, obvious, coverage, now, knownUrls)
    const preciseDraft = applyFactPrecisionToDraft(row.draft, evidenceDates, now, entityCtx)
    const built = toHypothesis(preciseDraft, row.outsider, opts.card, coverage, verdict.non, row.judge?.twist ?? '', evidenceDates, now)
    for (const entry of built.background) backgroundByUrl.set(entry.url, entry)
    return { row, verdict, hypothesis: built.hypothesis, entityPrecise: entityEvidencePrecise(preciseDraft, entityCtx) }
  })
  const liveRows = scored.filter((item) => item.verdict.non > 0)
  const rankScore = (item: (typeof scored)[number]) => item.verdict.non * item.hypothesis.stage
  const headlinePool = liveRows.filter((item) => !item.row.outsider && item.entityPrecise)
  let headline_fallback = false
  let headlineCandidates = headlinePool.filter((item) => item.hypothesis.stage >= 3)
  if (headlineCandidates.length === 0 && headlinePool.length > 0) {
    headline_fallback = true
    headlineCandidates = [...headlinePool].sort((a, b) => b.hypothesis.stage - a.hypothesis.stage || rankScore(b) - rankScore(a))
  }
  const headlineRows = pickDiverseHeadlines(
    headlineCandidates,
    (item) => rankScore(item),
    (item) => headlineRootKey(item.hypothesis),
    3,
  )
  const headlineIds = new Set(headlineRows.flatMap((item) => item.row.sourceIds))
  const headlines = headlineRows.map((item) => ({ ...item.hypothesis, outsider: false }))
  const missed_by_others = liveRows
    .filter((item) => !item.row.sourceIds.some((id) => headlineIds.has(id)))
    .filter((item) => item.hypothesis.novelty === 'only_us' || item.row.outsider)
    .map((item) => ({ ...item.hypothesis, outsider: item.row.outsider }))
  const baselineRisks: BaselineRisk[] = mergeBaselineRisks(judgeBaselineRows, opts.card, analystFindings).map((row) => ({
    ...row,
    regions:
      row.regions && row.regions.length > 0
        ? row.regions
        : opts.card.members
          ? tagsForText(`${row.title} ${row.reason ?? ''}`, opts.card.members)
          : undefined,
  }))

  const lead = headlineRows[0]
  if (lead) {
    const judged = lead.row.judge
    const stale = staleStatusFacts(lead.row.draft, evidenceDates, now)
    const title = lead.hypothesis.title
    summaries = {
      headline_en: hedgeStaleStatusText(stringOr(judged?.headline_en, `${opts.card.name}: ${title}`), stale),
      headline_ko: stringOr(hangulOnly(judged?.headline_ko), `${opts.card.name}: ${title}`),
      summary_en: hedgeStaleStatusText(stringOr(judged?.brief_en, `${title}. ${lead.hypothesis.why_humans_miss}`), stale),
      summary_ko: stringOr(hangulOnly(judged?.brief_ko), stringOr(hangulOnly(judged?.headline_ko), `${opts.card.name}: ${title}`)),
    }
  } else if (baselineRisks.length) {
    summaries.headline_en = `${opts.card.name}: standard regional risks`
    summaries.summary_en = baselineRisks[0].title
    summaries.summary_ko = `${opts.card.name}: ${baselineRisks[0].title}`
    summaries.headline_ko = `${opts.card.name}: 표준 지역 위험`
  }
  const everyGroup = scored.map((item) => item.hypothesis)
  const noveltyCounts = {
    only_us: everyGroup.filter((row) => row.novelty === 'only_us').length,
    also_seen_elsewhere: everyGroup.filter((row) => row.novelty === 'also_seen_elsewhere').length,
  }

  let result: EngineResult | null = null
  let status: 'done' | 'error' | 'partial' | 'running' = partial ? 'partial' : 'done'
  let error: string | null = null
  if (!opts.dryRun) {
    const candidate: EngineResult = {
      headlines,
      missed_by_others,
      ...summaries,
      headline_fallback: headline_fallback || undefined,
      map_focus: { lat: opts.card.lat, lon: opts.card.lon, zoom: opts.card.level === 0 ? 5 : 7 },
      partial,
      baseline_risks: baselineRisks,
      background_coverage: backgroundByUrl.size ? [...backgroundByUrl.values()] : undefined,
      coverage: coverageCounts(coverage),
      novelty_counts: noveltyCounts,
      rejected,
      obvious: obvious.map((row) => row.line),
      zone_key: opts.card.zone_key,
      ...(opts.card.zone_key
        ? (() => {
            const built = buildZoneLinks(
              [...headlines, ...missed_by_others].map((row) => ({
                title: row.title,
                mechanism: row.mechanism,
                regions: row.regions,
                evidence: row.evidence,
                why_humans_miss: row.why_humans_miss,
                entities: row.entities,
                chain: row.chain,
              })),
              {
                members: opts.card.members ?? [],
                neighborEdges: opts.card.neighbor_edges ?? [],
                hydroNames: opts.card.fragility.map((item) => item.name),
              },
            )
            return { cross_border: built.cross_border, intra_zone: built.intra_zone }
          })()
        : {}),
    }
    const parsed = engineResultSchema.safeParse(candidate)
    if (!parsed.success) {
      status = 'error'
      error = parsed.error.issues.map((issue) => issue.message).join('; ')
    } else {
      result = parsed.data
      if (partial) status = 'partial'
    }
  }

  live.cacheKey = key
  live.cacheHit = false
  live.status = opts.dryRun ? 'done' : status
  live.costUsd = spent
  live.tokensIn = tokensIn
  live.tokensOut = tokensOut
  live.result = result
  live.searchUrls = searchItems.map((item) => item.url)
  live.queries = searchQueries
  live.error = error
  if (!opts.dryRun && opts.cache) await opts.cache.put(live)
  return live
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/** The _ko fields must be Korean; models sometimes write the local language there instead. */
export function hangulOnly(value: unknown): string {
  return typeof value === 'string' && /[\uAC00-\uD7A3]/.test(value) ? value : ''
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

export interface JudgeScore {
  non_obviousness: number | null
  on_obvious_list: boolean
  twist: string
  reported_as_news: string
  headline_ko: string
  headline_en: string
  brief_ko: string
  brief_en: string
}

/** One merged group. outsider is true when the judge left the ids out of every group. */
export interface Placed {
  draft: Draft
  outsider: boolean
  rank: number
  sourceIds: string[]
  judge: JudgeScore | null
}

function judgeScoreOf(record: Record<string, unknown>): JudgeScore {
  const raw = typeof record.non_obviousness === 'number' ? record.non_obviousness : Number(record.non_obviousness)
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  return {
    non_obviousness: Number.isFinite(raw) && record.non_obviousness != null ? Math.min(1, Math.max(0, raw)) : null,
    on_obvious_list: record.on_obvious_list === true,
    twist: text(record.twist),
    reported_as_news: /^https?:\/\//i.test(text(record.reported_as_news)) ? text(record.reported_as_news) : '',
    headline_ko: text(record.headline_ko),
    headline_en: text(record.headline_en),
    brief_ko: text(record.brief_ko),
    brief_en: text(record.brief_en),
  }
}

export function applyJudgeGroups(drafts: Draft[], groups: unknown): Placed[] {
  const byId = new Map(drafts.map((draft) => [draft.id, draft]))
  const used = new Set<string>()
  const placed: Placed[] = []
  const rows = Array.isArray(groups) ? groups : []
  rows.forEach((row, index) => {
    const record = asRecord(row)
    if (!record) return
    const ids = stringList(record.ids).filter((id) => byId.has(id) && !used.has(id))
    if (ids.length === 0) return
    ids.forEach((id) => used.add(id))
    const merged = mergeDrafts(ids.map((id) => byId.get(id)!), record)
    const rank = typeof record.rank === 'number' ? record.rank : index + 1
    placed.push({ draft: merged, outsider: false, rank, sourceIds: ids, judge: judgeScoreOf(record) })
  })
  for (const draft of drafts) {
    if (used.has(draft.id)) continue
    placed.push({ draft, outsider: true, rank: placed.length + 1, sourceIds: [draft.id], judge: null })
  }
  return placed
}

/** Code check that the same hazard and a named entity are already in a recent coverage item. */
export function reportedIn(draft: Draft, card: Pick<EngineCard, 'name' | 'country'>, coverage: CoverageItem[], now: Date): CoverageItem | null {
  const words = entityWords(draft, card)
  if (!words.size) return null
  for (const item of coverage) {
    if (!withinDays(item.date, now, REPORTED_DAYS) || !sameHazard(draft.hazards, item.hazards)) continue
    const title = ` ${normalizeName(item.title)} `
    if ([...words].some((word) => title.includes(` ${word} `))) return item
  }
  return null
}

/** Judge fallback: a single-hazard possibility already on the obvious list. */
function obviousByCode(draft: Draft, obvious: ObviousEntry[]): boolean {
  const known = new Set(obvious.flatMap((row) => row.hazards))
  return draft.hazards.length <= 1 && draft.hazards.every((hazard) => known.has(hazard))
}

/**
 * 0 when reported (a judge url must be one the run saw: search items, coverage, or hypothesis links),
 * or on the obvious list without a twist. Otherwise the judge score, else a code fallback.
 */
export function obviousnessOf(
  row: Placed,
  card: EngineCard,
  obvious: ObviousEntry[],
  coverage: CoverageItem[],
  now: Date,
  knownUrls: Set<string> = new Set(coverage.map((item) => item.url)),
): { non: number; reason: string } {
  const reported = reportedIn(row.draft, card, coverage, now)
  const judgeUrl = row.judge?.reported_as_news ?? ''
  if (judgeUrl && knownUrls.has(judgeUrl)) return { non: 0, reason: `reported as news: ${judgeUrl}` }
  if (reported) return { non: 0, reason: `reported as news (${reported.source}): ${reported.url}` }
  if (row.judge) {
    if (row.judge.on_obvious_list && !row.judge.twist) return { non: 0, reason: 'on the obvious list without a twist' }
    if (row.judge.non_obviousness != null) {
      return { non: row.judge.non_obviousness, reason: row.judge.non_obviousness === 0 ? 'judge scored 0' : '' }
    }
  }
  if (obviousByCode(row.draft, obvious)) return { non: 0, reason: 'on the obvious list (code check)' }
  return { non: 0.5, reason: 'judge did not score; code default 0.5' }
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
    hazards: [...new Set(rows.flatMap((row) => row.hazards))],
    departments: [...new Set(rows.flatMap((row) => row.departments))],
    entities: [...new Set(rows.flatMap((row) => row.entities))],
    lead_time_days: {
      min: Math.min(...rows.map((row) => row.lead_time_days.min)),
      max: Math.max(...rows.map((row) => row.lead_time_days.max)),
    },
    early_indicators: [...new Set(rows.flatMap((row) => row.early_indicators))].slice(0, 2),
  }
}

function toHypothesis(
  draft: Draft,
  outsider: boolean,
  card: EngineCard,
  coverage: CoverageItem[],
  nonObviousness: number,
  twist: string,
  evidenceDates: EvidenceDates,
  now: Date,
): { hypothesis: Hypothesis; background: BackgroundCoverageItem[] } {
  const stale = staleStatusFacts(draft, evidenceDates, now)
  const departments = new Set<string>([...draft.departments, ...departmentsTouched(draft)])
  const structure = structureOf({
    hunters: draft.proposed_by.length,
    departments: departments.size,
    weakness: draft.weakness,
    evidence: draft.evidence.length,
  })
  const novelty = noveltyFor(
    { card, entities: draft.entities, mechanism: draft.mechanism, title: draft.title, hazards: draft.hazards },
    coverage,
  )
  const hypothesis: Hypothesis = {
    title: draft.title,
    chain: draft.chain,
    horizon: card.horizon,
    possibility: structure.possibility,
    why_humans_miss: draft.why_humans_miss,
    evidence: draft.evidence,
    what_to_do: draft.what_to_do,
    official_links: draft.official_links,
    proposed_by: draft.proposed_by,
    weakness_notes: draft.weakness_notes,
    novelty: novelty.novelty,
    stage: structure.stage,
    confidence: structure.confidence,
    outsider,
    hazards: draft.hazards,
    departments: [...departments],
    entities: draft.entities,
    mechanism: draft.mechanism,
    lead_time_days: draft.lead_time_days,
    early_indicators: draft.early_indicators,
    falsifier: draft.falsifier,
    non_obviousness: Math.round(nonObviousness * 100) / 100,
    twist: twist ? hedgeStaleStatusText(twist, stale) : undefined,
    novelty_match: novelty.match,
    regions: draft.regions && draft.regions.length > 0 ? draft.regions : undefined,
  }
  hypothesis.title = hedgeStaleStatusText(hypothesis.title, stale)
  hypothesis.why_humans_miss = hedgeStaleStatusText(hypothesis.why_humans_miss, stale)
  if (hypothesis.mechanism) hypothesis.mechanism = hedgeStaleStatusText(hypothesis.mechanism, stale)
  return { hypothesis: hypothesisSchema.parse(hypothesis), background: novelty.background }
}
