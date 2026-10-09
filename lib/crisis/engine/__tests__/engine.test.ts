import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { hypothesisSchema } from '../schema'
import { localLanguages } from '../languages'
import { analystUser, departmentSliceEmpty, ensureQueries, fallbackQueries, hunterUser, queryWriterSystem, SHARED_PREAMBLE } from '../prompts'
import { buildLedgerInserts, ledgerContentHash, memoryLedger, publishHypotheses } from '../publish'
import { estimateRegionRunUsd, resolveRoster } from '../roster'
import { extractJson } from '../parse'
import { TOKEN_CAPS } from '../prices'
import { applyJudgeGroups, applyWeakness, runEngine, withTimeout, type ModelCall, type ModelCaller } from '../run'
import type { EngineCard } from '../schema'
import { normalizeSearchItems } from '../search-items'
import { noveltyOf, structureOf } from '../structure'

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
          groups: kept.map((row) => ({ ids: [row.id], rank: 1, outsider: false, title: row.title })),
          summary_ko: '바다울라에서 비와 댐이 주민 이야기와 떨어져 있다.',
          summary_en: 'In Badulla the rain and the dam are not read together with the people downstream.',
          headline_ko: '바다울라, 비와 댐',
          headline_en: 'Badulla: rain, a dam, and the people downstream',
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
    const roster = resolveRoster({})
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
    expect(resolveRoster({ CRISIS_ENGINE_JUDGE_MODEL: 'claude-opus-5-5-test' }).judgeModel).toBe('claude-opus-5-5-test')
    const estimate = estimateRegionRunUsd(roster)
    expect(estimate).toBeGreaterThan(0.05)
    expect(estimate).toBeLessThan(1.5)
    expect(TOKEN_CAPS.hunter.out).toBe(3000)
    expect(TOKEN_CAPS.dept_analyst.out).toBe(1200)
    expect(TOKEN_CAPS.judge.out).toBe(4000)
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
    expect(record.result?.hypotheses.length).toBe(5)
    expect(record.result?.partial).toBe(false)
  })

  it('puts omitted hypotheses on the outsider list', async () => {
    const record = await runEngine({
      card: card(),
      caller: caller(seen, 'drop'),
      now: NOW,
    })
    const ranked = record.result?.hypotheses.length ?? 0
    const outsider = record.result?.outsider.length ?? 0
    expect(ranked).toBe(1)
    expect(outsider).toBe(5)
    expect(record.result?.outsider.every((row) => row.outsider)).toBe(true)
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
    expect(run.result?.hypotheses[0]?.weakness_notes).toEqual(['thin evidence'])
    const ledger = memoryLedger()
    const written = await publishHypotheses(ledger, run, [0, 1], NOW)
    expect(written[0].prev_hash).toBeNull()
    expect(written[1].prev_hash).toBe(written[0].content_hash)
    expect(written[0].content_hash).not.toBe(written[1].content_hash)
    expect(written[0].content_hash).toBe(ledgerContentHash({ ...written[0] }))
    expect(written[0].evidence_snapshot).toMatchObject({
      card: { name: 'Badulla' },
      search_urls: expect.arrayContaining(['https://www.reuters.com/world/badulla-dam']),
    })
    expect(written[0].ai_roster).toBeTruthy()
    const inserts = buildLedgerInserts(run, [0], NOW.toISOString())
    expect(inserts[0].evidence_snapshot).toHaveProperty('roster')
    expect(run.result?.hypotheses).toHaveLength(6)
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

  it('marks mainstream overlap as also seen, and scores from structure', () => {
    const items = normalizeSearchItems(
      [{ title: 'Badulla dam rain downstream', url: 'https://www.reuters.com/a', published: '2026-10-08' }],
      'sonar',
      NOW,
    )
    expect(noveltyOf('Badulla dam rain', items)).toBe('also_seen_elsewhere')
    expect(noveltyOf('unrelated quarry dust', items)).toBe('only_us')
    expect(structureOf({ hunters: 4, departments: 3, weakness: 'low', evidence: 3 }).stage).toBe(5)
    expect(structureOf({ hunters: 1, departments: 1, weakness: 'high', evidence: 0 }).stage).toBe(1)
  })

  it('does not let red team or the judge remove a hypothesis', () => {
    const drafts = [
      { id: 'h0', title: 'a', chain: [{ step: 'a', cascade_id: null }], why_humans_miss: 'x', evidence: [], what_to_do: ['do'], official_links: [], proposed_by: ['m'], weakness_notes: [], weakness: 'low' as const },
      { id: 'h1', title: 'b', chain: [{ step: 'b', cascade_id: null }], why_humans_miss: 'y', evidence: [], what_to_do: ['do'], official_links: [], proposed_by: ['n'], weakness_notes: [], weakness: 'low' as const },
    ]
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
    expect(hunterUser(card(), [], [])).toContain('Badulla')
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
