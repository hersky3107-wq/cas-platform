import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { hypothesisSchema } from '../schema'
import { localLanguages } from '../languages'
import { analystUser, departmentSliceEmpty, ensureQueries, fallbackQueries, FORECAST_TOTALS_NOTE, hunterUser, judgeSystem, queryWriterSystem, SHARED_PREAMBLE } from '../prompts'
import { buildLedgerInserts, ledgerContentHash, memoryLedger, publishHypotheses } from '../publish'
import { estimateRegionRunUsd, resolveRoster } from '../roster'
import { extractJson } from '../parse'
import { HUNTER_DEEPSEEK_TIMEOUT_MS, ROLE_TIMEOUT_MS, TOKEN_CAPS } from '../prices'
import { persistRun } from '../store'
import { applyJudgeGroups, applyWeakness, runEngine, withTimeout, type Draft, type EngineRunRecord, type ModelCall, type ModelCaller } from '../run'
import type { EngineCard } from '../schema'
import { normalizeSearchItems } from '../search-items'
import { structureOf } from '../structure'

const NOW = new Date('2026-10-09T00:00:00Z')

function card(): EngineCard {
  return {
    region_id: 4242,
    name: 'Badulla',
    country: 'Sri Lanka',
    iso3: 'LKA',
    lat: 6.99,
    lon: 81.06,
    level: 1,
    horizon: '30d',
    components: [
      { key: 'rain', value: 0.82, raw: { marker: 'RAIN_ONLY_9f3' } },
      { key: 'quake', value: 0.2, raw: { marker: 'QUAKE_ONLY_9f3' } },
      { key: 'health_attention', value: 0.3, raw: { marker: 'HEALTH_ONLY_9f3' } },
      { key: 'conflict', value: 0.4, raw: { marker: 'CONFLICT_ONLY_9f3' } },
      { key: 'food', value: 0.5, raw: { marker: 'FOOD_ONLY_9f3' } },
    ],
    fragility: [
      { kind: 'dam', name: 'Victoria Dam' },
      { kind: 'nuclear', name: 'NUCLEAR_ONLY_9f3' },
    ],
    cascades: [{ id: 'c-dam', trigger: 'dam_failure', effect: 'flood' }],
    context: ['wiki: Victoria Dam', 'gdelt: CONFLICT_CONTEXT_9f3'],
    urban: [{ name: 'Badulla', pop: 50000 }],
  }
}

function hypothesisBody(title: string) {
  return {
    title,
    hazards: ['dam', 'flood'],
    departments: ['natural-hydro', 'health'],
    entities: ['Victoria Dam'],
    mechanism: 'A controlled spill is not classed as a dam failure, so the villages below are not warned.',
    lead_time_days: { min: 3, max: 14 },
    early_indicators: ['Spill gates opened two days running'],
    falsifier: 'The reservoir level stays under the spill crest all month.',
    chain: [{ step: 'rain reaches a dam above the town', cascade_id: 'c-dam' }],
    why_humans_miss: 'Hydro holds the rain and the dam. Conflict and health never see that briefing.',
    evidence: [
      { type: 'rain', ref: 'card rain' },
      { type: 'dam', ref: 'Victoria Dam' },
    ],
    what_to_do: ['ජලය ගබඩා කරන්න. Store drinking water and listen to the local radio.'],
    official_links: [{ label: 'Disaster Management Centre', url: 'https://www.dmc.gov.lk/' }],
  }
}

function draft(id: string, title: string, model: string, extra: Partial<Draft> = {}): Draft {
  return {
    id,
    title,
    chain: [{ step: title, cascade_id: null }],
    why_humans_miss: 'x',
    evidence: [],
    what_to_do: ['do'],
    official_links: [],
    proposed_by: [model],
    weakness_notes: [],
    weakness: 'low',
    hazards: ['dam'],
    departments: ['natural-hydro', 'health'],
    entities: ['Victoria Dam'],
    mechanism: 'a spill is not classed as a failure',
    lead_time_days: { min: 2, max: 10 },
    early_indicators: ['gates open'],
    falsifier: 'reservoir stays low',
    ...extra,
  }
}

function caller(seen: ModelCall[], mode: 'full' | 'drop' | 'throw-hunter' = 'full'): ModelCaller {
  return {
    async complete(call) {
      seen.push(call)
      if (mode === 'throw-hunter' && call.slot === 'hunter-qwen') throw new Error('hunter down')
      if (call.role === 'dept_analyst') return { text: JSON.stringify({ notes: `${call.slot} note`, signals: ['one'] }), tokensIn: 10, tokensOut: 10, costUsd: 0.01 }
      if (call.role === 'query_writer') return { text: JSON.stringify({ queries: ['Badulla dam', 'බදුල්ල වේල්ල', 'Badulla rain'] }), tokensIn: 10, tokensOut: 10, costUsd: 0.01 }
      if (call.role === 'search') {
        return {
          text: JSON.stringify({
            items: [
              { title: 'Badulla dam rain', url: 'https://www.reuters.com/world/badulla-dam', published: '2026-10-08' },
              { title: 'Old Badulla note', url: 'https://example.com/old', published: '2026-08-01' },
              { title: 'no date', url: 'https://example.com/nodate' },
              { title: 'no url', published: '2026-10-08' },
            ],
          }),
          tokensIn: 10,
          tokensOut: 10,
          costUsd: 0.01,
        }
      }
      if (call.role === 'hunter') {
        return {
          text: JSON.stringify({ hypotheses: [hypothesisBody(`${call.model} possibility`)] }) + ` HUNTER_SECRET_${call.model}`,
          tokensIn: 10,
          tokensOut: 10,
          costUsd: 0.01,
        }
      }
      if (call.role === 'red_team') {
        const packet = JSON.parse(call.user) as { hypotheses: Array<{ id: string }> }
        return {
          text: JSON.stringify({
            notes: packet.hypotheses.map((row) => ({ id: row.id, note: 'thin evidence', severity: 'medium' })),
          }),
          tokensIn: 10,
          tokensOut: 10,
          costUsd: 0.01,
        }
      }
      const packet = JSON.parse(call.user) as { hypotheses: Array<{ id: string; title: string }> }
      const kept = mode === 'drop' ? packet.hypotheses.slice(0, 1) : packet.hypotheses
      return {
        text: JSON.stringify({
          groups: kept.map((row, index) => ({
            ids: [row.id],
            title: row.title,
            non_obviousness: index === 0 ? 0.9 : 0.6,
            on_obvious_list: false,
            twist: '',
            reported_as_news: '',
            headline_ko: index === 0 ? '바둘라, 방류는 붕괴가 아니다' : '',
            headline_en: index === 0 ? 'Badulla: a spill is not a failure, so no one is warned' : '',
            brief_ko: index === 0 ? '바둘라에서 비와 댐이 주민 이야기와 떨어져 있다.' : '',
            brief_en: index === 0 ? 'In Badulla the rain and the dam are not read together with the people downstream.' : '',
          })),
          baseline_risks: [
            { title: 'Rain floods low areas', stage: 2, possibility: 'medium', what_to_do: ['Move early.'] },
            { title: 'Dam spill affects downstream roads', stage: 3, possibility: 'medium', what_to_do: ['Watch river levels.'] },
            { title: 'Dengue after rain', stage: 2, possibility: 'medium', what_to_do: ['Clear containers.'] },
          ],
        }),
        tokensIn: 10,
        tokensOut: 10,
        costUsd: 0.01,
      }
    },
  }
}

describe('roster', () => {
  it('resolves distinct brands from the registries', () => {
    const roster = resolveRoster({} as unknown as NodeJS.ProcessEnv)
    const analysts = roster.slots.filter((slot) => slot.role === 'dept_analyst')
    const hunters = roster.slots.filter((slot) => slot.role === 'hunter')
    expect(new Set(analysts.map((slot) => slot.brand)).size).toBe(analysts.length)
    expect(new Set(hunters.map((slot) => slot.brand)).size).toBe(hunters.length)
    expect(hunters.map((slot) => slot.brand).sort()).toEqual(
      ['DeepSeek', 'Mistral', 'NVIDIA', 'Qwen', 'Upstage', 'Z.ai'].sort(),
    )
    expect(analysts.find((slot) => slot.slot === 'health')?.model).toBe('claude-sonnet-5')
    expect(analysts.find((slot) => slot.slot === 'natural-hydro')?.model).toBe('gemini-3.6-flash')
    expect(analysts.find((slot) => slot.slot === 'natural-geo')?.model).toBe('moonshotai/kimi-k2.6')
    expect(analysts.find((slot) => slot.slot === 'conflict-political')?.model).toBe('grok-4.3')
    expect(analysts.find((slot) => slot.slot === 'infrastructure-economy')?.model).toBe('gpt-5.6-terra')
    expect(roster.slots.find((slot) => slot.slot === 'query_writer')?.model).toBe('gemini-3.5-flash-lite')
    expect(roster.slots.find((slot) => slot.slot === 'grok-live')).toMatchObject({
      model: 'grok-4.6',
      search: true,
      maxTurns: 1,
    })
    expect(roster.slots.find((slot) => slot.slot === 'perplexity-sonar')?.model).toBe('sonar-reasoning-pro')
    expect(hunters.some((slot) => slot.model === 'qwen/qwen3.5-plus-20260420')).toBe(true)
    expect(hunters.some((slot) => slot.model === 'deepseek/deepseek-v3.2')).toBe(true)
    expect(hunters.some((slot) => slot.model === 'mistralai/mistral-medium-3-5')).toBe(true)
    expect(hunters.some((slot) => slot.model === 'solar-pro4')).toBe(true)
    expect(hunters.some((slot) => slot.model === 'nvidia/nemotron-3-ultra-550b-a55b')).toBe(true)
    expect(hunters.some((slot) => slot.model === 'z-ai/glm-5.3')).toBe(true)
    expect(roster.slots.find((slot) => slot.slot === 'red_team')?.model).toBe('cohere/command-a')
    expect(roster.judgeModel).toBe('claude-opus-5-5')
    expect(resolveRoster({ CRISIS_ENGINE_JUDGE_MODEL: 'claude-opus-5-5-test' } as unknown as NodeJS.ProcessEnv).judgeModel).toBe('claude-opus-5-5-test')
    const estimate = estimateRegionRunUsd(roster)
    expect(estimate).toBeGreaterThan(0.05)
    expect(estimate).toBeLessThan(1.5)
    expect(TOKEN_CAPS.hunter.out).toBe(3000)
    expect(TOKEN_CAPS.dept_analyst.out).toBe(1200)
    expect(TOKEN_CAPS.judge.out).toBe(9000)
    expect(ROLE_TIMEOUT_MS.dept_analyst).toBe(90_000)
    expect(ROLE_TIMEOUT_MS.hunter).toBe(90_000)
    expect(ROLE_TIMEOUT_MS.search).toBe(90_000)
    expect(ROLE_TIMEOUT_MS.red_team).toBe(120_000)
    expect(ROLE_TIMEOUT_MS.judge).toBe(240_000)
    expect(HUNTER_DEEPSEEK_TIMEOUT_MS).toBe(120_000)
    expect(hunters.find((slot) => slot.slot === 'hunter-qwen')?.extraBody).toEqual({ reasoning: { enabled: false } })
    expect(hunters.find((slot) => slot.slot === 'hunter-deepseek')?.extraBody).toEqual({ reasoning: { enabled: false } })
  })
})

describe('department isolation and hunters', () => {
  const seen: ModelCall[] = []

  beforeEach(() => {
    seen.length = 0
  })

  it('shows each analyst only its own department', async () => {
    const record = await runEngine({
      card: card(),
      caller: caller(seen),
      dryRun: true,
      now: NOW,
    })
    const hydro = record.steps.find((step) => step.slot === 'natural-hydro')
    const conflict = record.steps.find((step) => step.slot === 'conflict-political')
    const health = record.steps.find((step) => step.slot === 'health')
    expect(hydro?.user).toContain('RAIN_ONLY_9f3')
    expect(hydro?.user).not.toContain('CONFLICT_ONLY_9f3')
    expect(hydro?.user).not.toContain('HEALTH_ONLY_9f3')
    expect(hydro?.user).not.toContain('QUAKE_ONLY_9f3')
    expect(hydro?.user).not.toContain('FOOD_ONLY_9f3')
    expect(hydro?.user).not.toContain('NUCLEAR_ONLY_9f3')
    expect(conflict?.user).toContain('CONFLICT_ONLY_9f3')
    expect(conflict?.user).toContain('CONFLICT_CONTEXT_9f3')
    expect(conflict?.user).not.toContain('RAIN_ONLY_9f3')
    expect(health?.user).toContain('HEALTH_ONLY_9f3')
    expect(health?.user).not.toContain('RAIN_ONLY_9f3')
    expect(record.steps.some((step) => step.role === 'red_team')).toBe(true)
    expect(record.steps.some((step) => step.role === 'judge')).toBe(true)
    const hunterUsers = record.steps.filter((step) => step.role === 'hunter').map((step) => step.user)
    expect(new Set(hunterUsers).size).toBe(1)
    expect(seen).toHaveLength(0)
    expect(SHARED_PREAMBLE).toContain('possibility and signals')
    expect(SHARED_PREAMBLE).toContain('Do not call them warnings or alerts')
  })

  it('gives every hunter the same packet and keeps a failed hunter from stopping the run', async () => {
    const record = await runEngine({
      card: card(),
      caller: caller(seen, 'throw-hunter'),
      now: NOW,
    })
    const hunters = seen.filter((call) => call.role === 'hunter')
    expect(hunters.length).toBeGreaterThan(1)
    expect(new Set(hunters.map((call) => call.user)).size).toBe(1)
    expect(hunters.every((call) => !call.user.includes('HUNTER_SECRET'))).toBe(true)
    const searches = seen.filter((call) => call.role === 'search')
    expect(searches).toHaveLength(2)
    expect(searches[0].user).toBe(searches[1].user)
    expect(record.status).toBe('done')
    expect(record.steps.some((step) => step.slot === 'hunter-qwen' && step.error === 'hunter down')).toBe(true)
    expect(record.result?.headlines.length).toBeGreaterThanOrEqual(1)
    expect(record.result?.headlines.length).toBeLessThanOrEqual(3)
    expect(record.result?.missed_by_others.length).toBeGreaterThanOrEqual(0)
    expect(record.result?.partial).toBe(false)
  })

  it('puts omitted hypotheses on the outsider list', async () => {
    const record = await runEngine({
      card: card(),
      caller: caller(seen, 'drop'),
      now: NOW,
    })
    expect(record.result?.headlines.length ?? 0).toBe(1)
    expect(record.result?.missed_by_others.length ?? 0).toBe(5)
    expect(record.result?.missed_by_others.every((row) => row.outsider)).toBe(true)
  })
})

describe('schema, budget, cache, publish', () => {
  it('rejects a hypothesis that is missing what to do', () => {
    const parsed = hypothesisSchema.safeParse({
      title: 'Rain on the dam',
      chain: [{ step: 'rain', cascade_id: null }],
      horizon: '30d',
      possibility: 'medium',
      why_humans_miss: 'Two desks.',
      evidence: [],
      official_links: [],
      proposed_by: ['gpt-4o'],
      weakness_notes: [],
      novelty: 'only_us',
      stage: 2,
      confidence: 'low',
      outsider: false,
    })
    expect(parsed.success).toBe(false)
  })

  it('stops once the cost cap is crossed and marks the run partial', async () => {
    const seen: ModelCall[] = []
    const record = await runEngine({
      card: card(),
      caller: {
        async complete(call) {
          seen.push(call)
          return { text: JSON.stringify({ notes: 'partial', signals: [] }), tokensIn: 10, tokensOut: 10, costUsd: 1 }
        },
      },
      now: NOW,
      costCapUsd: 1.5,
      costOf: () => 1,
    })
    expect(seen).toHaveLength(1)
    expect(record.result?.partial).toBe(true)
    expect(record.steps.filter((step) => step.skipped && step.error === 'budget').length).toBeGreaterThan(0)
  })

  it('returns the stored run for the same region, horizon, and UTC date', async () => {
    const seen: ModelCall[] = []
    const store = new Map<string, Awaited<ReturnType<typeof runEngine>>>()
    const cache = {
      async get(key: string) {
        return store.get(key) ?? null
      },
      async put(record: Awaited<ReturnType<typeof runEngine>>) {
        store.set(record.cacheKey, record)
      },
    }
    const first = await runEngine({ card: card(), caller: caller(seen), now: NOW, cache })
    const calls = seen.length
    const second = await runEngine({ card: card(), caller: caller(seen), now: NOW, cache })
    expect(first.cacheHit).toBe(false)
    expect(second.cacheHit).toBe(true)
    expect(second.cacheKey).toBe('4242|30d|2026-10-09')
    expect(seen).toHaveLength(calls)
  })

  it('publishes hash-chained ledger rows and does not drop red-team notes', async () => {
    const seen: ModelCall[] = []
    const run = await runEngine({ card: card(), caller: caller(seen), now: NOW })
    expect(run.result?.headlines[0]?.weakness_notes).toEqual(['thin evidence'])
    const ledger = memoryLedger()
    const written = await publishHypotheses(ledger, run, [0], NOW)
    expect(written[0].prev_hash).toBeNull()
    expect(written[0].content_hash).toBe(ledgerContentHash({ ...written[0] }))
    expect(written[0].evidence_snapshot).toMatchObject({
      card: { name: 'Badulla' },
      search_urls: expect.arrayContaining(['https://www.reuters.com/world/badulla-dam']),
    })
    expect(written[0].ai_roster).toBeTruthy()
    const inserts = buildLedgerInserts(run, [0], NOW.toISOString())
    expect(inserts[0].evidence_snapshot).toHaveProperty('roster')
    expect(run.result?.headlines.length).toBeGreaterThanOrEqual(1)
    expect(run.result?.headlines[0]?.expected_window?.label).toMatch(/^예상 시기: \d+~\d+일 뒤$/)
    expect(run.result?.predictions?.length).toBeGreaterThanOrEqual(1)
    expect(run.result?.predictions?.[0]?.what).toBe('dam spill')
    expect(written.some((row) => (row.evidence_snapshot as { kind?: string }).kind === 'prediction')).toBe(true)
    expect(run.result?.baseline_risks.length).toBeGreaterThanOrEqual(3)
    expect(run.result?.headline_en).toBe('Badulla: a spill is not a failure, so no one is warned')
  })
})

describe('search items and structure', () => {
  it('drops items without a url or date and tags items older than 14 days', () => {
    const items = normalizeSearchItems(
      [
        { title: 'fresh', url: 'https://example.com/a', published: '2026-10-01' },
        { title: 'old', url: 'https://example.com/b', published: '2026-09-01' },
        { title: 'missing', url: 'https://example.com/c' },
      ],
      'grok-live',
      NOW,
    )
    expect(items.map((item) => item.title)).toEqual(['fresh', '[past] old'])
    expect(items[1].past).toBe(true)
  })

  it('scores stage from structure', () => {
    expect(structureOf({ hunters: 4, departments: 3, weakness: 'low', evidence: 3 }).stage).toBe(5)
    expect(structureOf({ hunters: 1, departments: 1, weakness: 'high', evidence: 0 }).stage).toBe(1)
  })

  it('does not let red team or the judge remove a hypothesis', () => {
    const drafts = [draft('h0', 'a', 'm'), draft('h1', 'b', 'n')]
    applyWeakness(drafts, [{ id: 'h0', note: 'weak', severity: 'high' }])
    expect(drafts).toHaveLength(2)
    expect(drafts[1].weakness_notes[0]).toContain('did not return')
    const placed = applyJudgeGroups(drafts, [{ ids: ['h0'], rank: 1, outsider: false }])
    expect(placed.flatMap((row) => row.sourceIds).sort()).toEqual(['h0', 'h1'])
    expect(placed.find((row) => row.sourceIds.includes('h1'))?.outsider).toBe(true)
  })

  it('asks for Sinhala, Tamil, and English on a Sri Lanka card', () => {
    expect(localLanguages('LKA').sort()).toEqual(['en', 'si', 'ta'])
    expect(queryWriterSystem(card())).toContain('Sinhala')
    expect(queryWriterSystem(card())).toContain('Tamil')
    expect(analystUser(card(), 'natural-hydro')).toContain('Victoria Dam')
    expect(analystUser(card(), 'natural-hydro')).toContain('7-day (7일)')
    expect(hunterUser(card(), [], [])).toContain('Badulla')
    expect(hunterUser(card(), [], [])).toContain(FORECAST_TOTALS_NOTE)
    expect(judgeSystem()).toContain('7일')
    expect(judgeSystem()).toContain('dam spill')
    const queries = ensureQueries(card(), ['Badulla flood'])
    expect(queries.length).toBeGreaterThanOrEqual(3)
    expect(queries.some((query) => /[\u0D80-\u0DFF]/.test(query))).toBe(true)
    expect(queries.some((query) => /[\u0B80-\u0BFF]/.test(query))).toBe(true)
    expect(fallbackQueries(card()).length).toBeGreaterThanOrEqual(3)
  })
})

describe('empty slice, force, and failed-run cache', () => {
  it('skips an analyst whose department slice is empty', async () => {
    const slim = card()
    slim.components = slim.components.filter((row) => row.key !== 'quake')
    slim.fragility = slim.fragility.filter((row) => row.kind !== 'volcano')
    slim.cascades = []
    slim.context = ['wiki: Victoria Dam']
    expect(departmentSliceEmpty(slim, 'natural-geo')).toBe(true)
    const seen: ModelCall[] = []
    const record = await runEngine({ card: slim, caller: caller(seen), now: NOW })
    const geo = record.steps.find((step) => step.slot === 'natural-geo')
    expect(geo?.skipped).toBe(true)
    expect(geo?.error).toBe('skipped: empty slice')
    expect(seen.some((call) => call.slot === 'natural-geo')).toBe(false)
  })

  it('does not reuse a partial cached run and --force bypasses a complete one', async () => {
    const store = new Map<string, Awaited<ReturnType<typeof runEngine>>>()
    const cache = {
      async get(key: string) {
        return store.get(key) ?? null
      },
      async put(record: Awaited<ReturnType<typeof runEngine>>) {
        store.set(record.cacheKey, record)
      },
    }
    const failHunters: ModelCaller = {
      async complete(call) {
        if (call.role === 'hunter') throw new Error('no json')
        return caller([]).complete(call)
      },
    }
    const first = await runEngine({ card: card(), caller: failHunters, now: NOW, cache })
    expect(first.status).toBe('partial')
    expect(first.result?.partial).toBe(true)
    const seen: ModelCall[] = []
    const second = await runEngine({ card: card(), caller: caller(seen), now: NOW, cache })
    expect(second.cacheHit).toBe(false)
    expect(seen.length).toBeGreaterThan(0)
    const after = seen.length
    const forced = await runEngine({ card: card(), caller: caller(seen), now: NOW, cache, force: true })
    expect(forced.cacheHit).toBe(false)
    expect(seen.length).toBeGreaterThan(after)
  })
})

describe('json parse', () => {
  it('strips think tags, fences, and leading prose, then repairs', () => {
    const messy = '<think>plan</think>\nSure.\n```json\n{"hypotheses":[{"title":"Rain"}]}\n```'
    expect(extractJson(messy)).toEqual({ hypotheses: [{ title: 'Rain' }] })
    const repaired = 'Here you go {hypotheses:[{title:"Dam"}]}'
    expect(extractJson(repaired)).toEqual({ hypotheses: [{ title: 'Dam' }] })
  })
})

describe('timeouts', () => {
  it('rejects when the call outlasts the deadline', async () => {
    vi.useFakeTimers()
    let settle: (error: Error) => void = () => {}
    const work = new Promise<string>((_, reject) => {
      settle = reject
    })
    work.catch(() => {})
    const raced = withTimeout(work, 20)
    vi.advanceTimersByTime(25)
    await expect(raced).rejects.toThrow(/timeout 20ms/)
    settle(new Error('late'))
    vi.useRealTimers()
  })
})

describe('parallel stages and live step writes', () => {
  it('runs analysts, both search providers, and hunters concurrently', async () => {
    const flight = { analyst: 0, search: 0, hunter: 0 }
    const peak = { analyst: 0, search: 0, hunter: 0 }
    const recordFlight = (role: 'analyst' | 'search' | 'hunter', delta: number) => {
      flight[role] += delta
      peak[role] = Math.max(peak[role], flight[role])
    }
    const seen: ModelCall[] = []
    const base = caller(seen)
    const record = await runEngine({
      card: card(),
      now: NOW,
      caller: {
        async complete(call) {
          const kind = call.role === 'dept_analyst' ? 'analyst' : call.role === 'search' ? 'search' : call.role === 'hunter' ? 'hunter' : null
          if (kind) recordFlight(kind, 1)
          await new Promise((resolve) => setTimeout(resolve, 25))
          if (kind) recordFlight(kind, -1)
          return base.complete(call)
        },
      },
    })
    expect(peak.analyst).toBeGreaterThan(1)
    expect(peak.search).toBe(2)
    expect(peak.hunter).toBeGreaterThan(1)
    expect(record.status).toBe('done')
    expect(seen.filter((call) => call.role === 'search')).toHaveLength(2)
  })

  it('skips a timed-out hunter and keeps the run moving', async () => {
    const seen: ModelCall[] = []
    const base = caller(seen)
    const record = await runEngine({
      card: card(),
      now: NOW,
      roleTimeouts: { hunter: 20 },
      caller: {
        async complete(call) {
          if (call.slot === 'hunter-qwen') {
            await new Promise((resolve) => setTimeout(resolve, 60))
            return base.complete(call)
          }
          return base.complete(call)
        },
      },
    })
    const qwen = record.steps.find((step) => step.slot === 'hunter-qwen')
    expect(qwen?.skipped).toBe(true)
    expect(qwen?.error).toMatch(/timeout 20ms/)
    expect(record.status).toBe('done')
    expect(record.result?.headlines.length).toBeGreaterThanOrEqual(1)
  })

  it('writes a running snapshot before a step finishes', async () => {
    const puts: Array<{ status: string; stepErrors: Array<string | null>; latencies: number[] }> = []
    const seen: ModelCall[] = []
    await runEngine({
      card: card(),
      caller: caller(seen),
      now: NOW,
      cache: {
        async get() {
          return null
        },
        async put(record) {
          puts.push({
            status: record.status,
            stepErrors: record.steps.map((step) => step.error),
            latencies: record.steps.map((step) => step.latencyMs),
          })
        },
      },
    })
    expect(puts[0]?.status).toBe('running')
    expect(puts.some((row) => row.status === 'running' && row.latencies.includes(0))).toBe(true)
    expect(puts.at(-1)?.status).toBe('done')
    expect(puts.length).toBeGreaterThan(4)
  })
})

describe('persistRun live writes', () => {
  it('inserts the run once, then inserts new steps and updates finished ones', async () => {
    const runs: Array<Record<string, unknown>> = []
    const steps: Array<Record<string, unknown>> = []
    let runId = ''
    let stepSeq = 0
    const client = {
      from(table: string) {
        return {
          insert(row: Record<string, unknown> | Array<Record<string, unknown>>) {
            if (table === 'crisis_engine_runs') {
              runId = 'run-live'
              runs.push({ id: runId, ...(row as Record<string, unknown>) })
              return {
                select: () => ({
                  single: async () => ({ data: { id: runId }, error: null }),
                }),
              }
            }
            const rows = Array.isArray(row) ? row : [row]
            const inserted = rows.map((item) => {
              stepSeq += 1
              const saved = { id: stepSeq, ...item }
              steps.push(saved)
              return saved
            })
            return {
              select: async () => ({ data: inserted.map((item) => ({ id: item.id })), error: null }),
            }
          },
          update(patch: Record<string, unknown>) {
            return {
              async eq(col: string, value: unknown) {
                if (table === 'crisis_engine_runs' && col === 'id') {
                  const found = runs.find((row) => row.id === value)
                  if (found) Object.assign(found, patch)
                }
                if (table === 'crisis_engine_steps' && col === 'id') {
                  const found = steps.find((row) => row.id === value)
                  if (found) Object.assign(found, patch)
                }
                return { error: null }
              },
            }
          },
        }
      },
    }
    const record = await runEngine({
      card: card(),
      caller: caller([]),
      now: NOW,
      dryRun: true,
    })
    record.status = 'running'
    record.result = null
    const startStep = record.steps.find((step) => step.role === 'dept_analyst' && !step.skipped)
    expect(startStep).toBeTruthy()
    const live: EngineRunRecord = {
      ...record,
      status: 'running',
      result: null,
      steps: startStep ? [{ ...startStep, latencyMs: 0, output: null, error: null }] : [],
    }
    const id = await persistRun(client as never, live, 'admin')
    expect(id).toBe('run-live')
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('running')
    expect(live.steps[0].dbId).toBe(1)
    live.steps[0].latencyMs = 42
    live.steps[0].error = null
    live.status = 'done'
    await persistRun(client as never, live, 'admin')
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('done')
    expect(steps).toHaveLength(1)
    expect(steps[0].latency_ms).toBe(42)
  })
})
