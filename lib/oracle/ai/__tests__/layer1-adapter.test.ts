import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRISM_COLORS } from '../../engines/prism'
import { advanceOracleSession } from '../../runner/advance'
import { createOracleSession } from '../../runner/create'
import { readOracleSession } from '../../runner/poll'
import { resetAiSlots } from '../../runner/concurrency'
import type { OracleAiAdapter, OracleAiRequest } from '../../runner/types'
import { createFakeCredits, createFakeStore, createScheduler, makeProfile } from '../../runner/__tests__/fakes'
import { createOracleAiAdapter } from '../create-adapter'
import { createLayer1AiAdapter } from '../layer1-adapter'
import type { Layer1Call, Layer1CallResult } from '../call'
import { LAYER1_REGISTRY } from '../registry'

const NOW = new Date('2026-08-20T03:00:00.000Z')
const SECRET_MODEL = 'gpt-5.6-terra'

const VALID_JSON = JSON.stringify({
  narrative: '추진·불·전진이 한 줄로 묶인다. 일은 열리지만 과신은 접어야 한다.',
  one_line: '일은 밀되 과신은 접어라',
  direction: 'advance',
  focus: 'work',
  axis_emphasis: ['drive', 'fire', 'advance'],
})

function readingRequest(unit = 'saju'): OracleAiRequest {
  return {
    kind: 'reading',
    sessionId: 'session-1',
    unit,
    locale: 'ko',
    seed: 'seed',
    payload: { system: unit, traits: { drive: 40 } },
  }
}

function okCall(overrides: Partial<Layer1CallResult> = {}): Layer1CallResult {
  return {
    text: VALID_JSON,
    emptyContent: false,
    tokensIn: 11,
    tokensOut: 22,
    latencyMs: 5,
    brand: 'DeepSeek',
    model: 'deepseek/deepseek-v3.2',
    reasoningTokens: null,
    contentTokens: 22,
    costUsd: null,
    diagnostics: null,
    ...overrides,
  }
}

describe('createOracleAiAdapter isolation', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('with ORACLE_AI_MODE=stub never constructs the live path', async () => {
    vi.stubEnv('ORACLE_AI_MODE', 'stub')
    const liveRun = vi.fn()
    const adapter = createOracleAiAdapter({
      stub: { minDelayMs: 0, maxDelayMs: 0, sleep: async () => {} },
      layer1: {
        run: async () => {
          liveRun()
          throw new Error('live adapter constructed')
        },
      },
    })
    const result = await adapter.run(readingRequest(), { timeoutMs: 1_000 })
    expect(liveRun).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.brand).toBe('stub')
  })

  it('does not statically import a network client', () => {
    const source = readFileSync(resolve(__dirname, '../create-adapter.ts'), 'utf8')
    expect(source).not.toMatch(/from ['"]@\/lib\/ai/)
    expect(source).not.toMatch(/from ['"]\.\/call['"]/)
    expect(source).toMatch(/import\('\.\/layer1-adapter'\)/)
  })

  it('keeps verdicts on the stub even when live', async () => {
    vi.stubEnv('ORACLE_AI_MODE', 'live')
    const liveRun = vi.fn()
    const adapter = createOracleAiAdapter({
      stub: { minDelayMs: 0, maxDelayMs: 0, sleep: async () => {} },
      layer1: { run: async () => { liveRun(); throw new Error('layer1 must not run verdicts') } },
    })
    const result = await adapter.run(
      { ...readingRequest(), kind: 'verdict', unit: 'archivist' },
      { timeoutMs: 1_000 },
    )
    expect(liveRun).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.brand).toBe('stub')
  })
})

describe('createLayer1AiAdapter', () => {
  it('retries exactly once on empty-content 200, then 결번', async () => {
    const calls: Layer1CallResult[] = []
    const call: Layer1Call = async () => {
      const result = okCall({ text: null, emptyContent: true, tokensOut: 0 })
      calls.push(result)
      return result
    }
    const adapter = createLayer1AiAdapter({ call })
    const result = await adapter.run(readingRequest(), { timeoutMs: 1_000 })
    expect(calls).toHaveLength(2)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe('error')
      expect(result.message).toMatch(/empty content/)
    }
  })

  it('retries once on parse failure, then 결번', async () => {
    let n = 0
    const call: Layer1Call = async () => {
      n += 1
      return okCall({ text: '<<< not json >>>' })
    }
    const adapter = createLayer1AiAdapter({ call })
    const result = await adapter.run(readingRequest(), { timeoutMs: 1_000 })
    expect(n).toBe(2)
    expect(result.ok).toBe(false)
  })

  it('parses fenced JSON on the first attempt', async () => {
    let n = 0
    const call: Layer1Call = async () => {
      n += 1
      return okCall({ text: '```json\n' + VALID_JSON + '\n```' })
    }
    const adapter = createLayer1AiAdapter({ call })
    const result = await adapter.run(readingRequest(), { timeoutMs: 1_000 })
    expect(n).toBe(1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.brand).toBe('DeepSeek')
      expect(result.model).toBe(LAYER1_REGISTRY.saju.model)
      expect(result.summary).toMatchObject({ direction: 'advance', focus: 'work' })
    }
  })
})

describe('live layer-1 through a session', () => {
  beforeEach(() => {
    resetAiSlots()
  })

  async function bootstrap(ai: OracleAiAdapter) {
    const profile = makeProfile()
    const store = createFakeStore({ profiles: [profile] })
    const credits = createFakeCredits()
    const created = await createOracleSession(
      'user-1',
      {
        kind: 'personal',
        subjectProfileId: profile.id,
        scope: 'single',
        systems: [],
        question: null,
        sessionInputs: {
          prism: {
            impulse: PRISM_COLORS[0],
            need: PRISM_COLORS[1],
            identity: PRISM_COLORS[2],
            microCheck: [3, 4, 2, 3],
          },
        },
        readerCount: 3,
        locale: 'ko',
      },
      { store, credits, now: () => NOW, seed: () => 'seed-layer1' },
    )
    if (!created.ok) throw new Error('create failed')

    const runToDone = async () => {
      for (let i = 0; i < 20; i += 1) {
        const scheduler = createScheduler()
        await advanceOracleSession(created.session.id, {
          store,
          credits,
          ai,
          schedule: scheduler.schedule,
          now: () => NOW,
          unitTimeoutMs: 50,
        })
        await scheduler.drain()
        const current = await store.getSession(created.session.id)
        if (current && (current.status === 'done' || current.status === 'partial' || current.status === 'failed')) {
          return current
        }
      }
      throw new Error('session did not finish')
    }

    return { store, session: created.session, runToDone }
  }

  it('never leaks model strings into the poll body', async () => {
    const call: Layer1Call = async ({ entry }) =>
      okCall({
        brand: entry.brand,
        model: entry.model,
        text: VALID_JSON,
      })
    const ai = createLayer1AiAdapter({
      call,
      layer2: {
        async run() {
          return {
            ok: true,
            brand: 'stub',
            model: 'stub-oracle-v0',
            text: 'stub verdict',
            summary: { ballot: { phase: 'hold', confidence: 50 }, dissent: null },
            latencyMs: 1,
            tokensIn: 1,
            tokensOut: 1,
          }
        },
      },
    })
    const { store, session, runToDone } = await bootstrap(ai)
    const final = await runToDone()
    const view = await readOracleSession(final, store, NOW)
    const body = JSON.stringify(view)

    for (const entry of Object.values(LAYER1_REGISTRY)) {
      expect(body).not.toContain(entry.model)
    }
    expect(body).not.toContain(SECRET_MODEL)
    expect(body).not.toContain('"model"')
    expect(view.readings.some((row) => row.brand === 'DeepSeek')).toBe(true)
    expect(store.readings.every((row) => row.model.length > 0)).toBe(true)
    expect(session.id).toBe(final.id)
  })

  it('lets a 결번 system still reach done', async () => {
    const call: Layer1Call = async ({ entry }) => {
      if (entry.system === 'saju') {
        return okCall({ text: null, emptyContent: true, brand: entry.brand, model: entry.model })
      }
      return okCall({ brand: entry.brand, model: entry.model })
    }
    const ai = createLayer1AiAdapter({
      call,
      layer2: {
        async run() {
          return {
            ok: true,
            brand: 'stub',
            model: 'stub-oracle-v0',
            text: 'stub verdict',
            summary: { ballot: { phase: 'hold', confidence: 50 }, dissent: null },
            latencyMs: 1,
            tokensIn: 1,
            tokensOut: 1,
          }
        },
      },
    })
    const { store, runToDone } = await bootstrap(ai)
    const final = await runToDone()
    expect(final.status).toBe('done')
    const saju = store.readings.find((row) => row.system === 'saju')
    expect(saju?.status).toBe('error')
    expect(store.readings.filter((row) => row.status === 'done').length).toBeGreaterThan(0)
  })
})
