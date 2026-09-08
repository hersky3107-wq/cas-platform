/**
 * Create-path behaviour: charge once, compute everything inline, and give the
 * credits back if the calculation cannot produce anything.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRISM_COLORS } from '../../engines/prism'
import { layer1Entry } from '../../ai/registry'
import { resetAiSlots } from '../concurrency'
import { creditsForOracleSession, ORACLE_CREDITS_MODULE, ORACLE_PROMPT_VERSION, readerRosterFor } from '../conventions'
import { createOracleSession, type CreateSessionRequest } from '../create'
import { readingUnit, verdictUnit } from '../progress'
import { createFakeCredits, createFakeStore, makeProfile, type FakeCredits, type FakeStore } from './fakes'

const NOW = new Date('2026-08-20T03:00:00.000Z')
const USER = 'user-1'
const PRISM_INPUTS = {
  prism: {
    impulse: PRISM_COLORS[0],
    need: PRISM_COLORS[1],
    identity: PRISM_COLORS[2],
    microCheck: [3, 4, 2, 3] as const,
  },
}

const REQUEST: CreateSessionRequest = {
  kind: 'personal',
  subjectProfileId: 'profile-subject',
  scope: 'combined',
  systems: [],
  question: null,
  sessionInputs: PRISM_INPUTS,
  readerCount: 3,
  locale: 'ko',
}

function harness(profileOverrides?: Parameters<typeof makeProfile>[0]): {
  store: FakeStore
  credits: FakeCredits
  create: (request?: Partial<CreateSessionRequest>) => ReturnType<typeof createOracleSession>
} {
  const profile = makeProfile(profileOverrides)
  const store = createFakeStore({ profiles: [profile] })
  const credits = createFakeCredits()
  return {
    store,
    credits,
    create: (request) =>
      createOracleSession(
        USER,
        { ...REQUEST, ...request },
        { store, credits, now: () => NOW, seed: () => 'seed-create' },
      ),
  }
}

beforeEach(() => {
  resetAiSlots()
  vi.stubEnv('ORACLE_AI_MODE', 'live')
})

describe('createOracleSession', () => {
  it('uses the parameterized provisional credit table, including synthesis', () => {
    expect(creditsForOracleSession('single', 3)).toBe(6)
    expect(creditsForOracleSession('single', 5)).toBe(10)
    expect(creditsForOracleSession('single', 7)).toBe(15)
    expect(creditsForOracleSession('combined', 3)).toBe(25)
    expect(creditsForOracleSession('combined', 5)).toBe(32)
    expect(creditsForOracleSession('combined', 7)).toBe(40)
    expect(creditsForOracleSession('combined', 9)).toBe(50)
  })

  it('requires exactly one valid system in single scope before charging', async () => {
    const { credits, create } = harness()
    const empty = await create({ scope: 'single', systems: [] })
    expect(empty.ok).toBe(false)
    const many = await create({ scope: 'single', systems: ['saju', 'astro'] })
    expect(many.ok).toBe(false)
    expect(credits.charges).toHaveLength(0)
  })

  it('charges once, computes all twelve systems, and hands back a layer1 session', async () => {
    const { store, credits, create } = harness()
    const outcome = await create()

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.reused).toBe(false)
    expect(outcome.session.status).toBe('layer1')
    expect(outcome.session.next_action).toBe('layer1')
    expect(outcome.session.seed).toBe('seed-create')
    expect(outcome.computations).toHaveLength(12)
    expect(outcome.computations.every((row) => row.unreadable === false)).toBe(true)

    const cost = creditsForOracleSession('combined', 3)
    expect(credits.charges).toEqual([{ userId: USER, amount: cost, module: ORACLE_CREDITS_MODULE }])
    expect(credits.refunds).toHaveLength(0)
    expect(store.sessions[0]!.credits_charged).toBe(cost)
    expect(store.sessions[0]!.charged_at).toBe(NOW.toISOString())
    expect(store.sessions[0]!.session_inputs).toEqual(PRISM_INPUTS)
  })

  it('initializes progress with every reading and verdict unit', async () => {
    const { store, create } = harness()
    await create({ readerCount: 5 })

    const progress = store.sessions[0]!.progress
    expect(progress.pending).toContain(readingUnit('saju', layer1Entry('saju')!.brand))
    expect(progress.pending).toContain(verdictUnit(readerRosterFor(5)[4]!))
    expect(progress.pending).toHaveLength(12 + 1 + 5)
    expect(progress.done).toHaveLength(0)
    expect(progress.failed).toHaveLength(0)
  })

  it('writes the consensus row including the deficiency vector', async () => {
    const { store, create } = harness()
    await create()

    const consensus = store.consensus[0]!
    expect(consensus.system_agreement).not.toBeNull()
    expect(consensus.deficiency_vector).not.toBeNull()
    expect(consensus.ballot_tally).toBeNull()
  })

  it('marks a system that produced no vote as a 결번 before layer 1 starts', async () => {
    // No name on the profile and no PRISM colours: two systems cannot compute.
    const { store, create } = harness({ name_local: null, name_latin: null, name_hanja: null })
    const outcome = await create({ sessionInputs: null })

    expect(outcome.ok).toBe(true)
    const progress = store.sessions[0]!.progress
    expect(progress.failed).toContain(readingUnit('name', layer1Entry('name')!.brand))
    expect(progress.failed).toContain(readingUnit('prism', layer1Entry('prism')!.brand))
    expect(progress.pending).not.toContain(readingUnit('name', layer1Entry('name')!.brand))

    const nameRow = store.computations.find((row) => row.system === 'name')!
    expect(nameRow.axes).toBeNull()
    expect(nameRow.ai_payload).toBeNull()
  })

  it('keeps PRISM as a 결번 when session inputs are absent', async () => {
    const { store, create } = harness({
      // A legacy profile-level copy must be ignored: PRISM state belongs to
      // the session and reading it here would overwrite re-test history.
      derived: {
        prism: {
          mbti: 'INTJ',
          colors: {
            impulse: PRISM_COLORS[0],
            need: PRISM_COLORS[1],
            identity: PRISM_COLORS[2],
          },
        },
      },
    })
    const outcome = await create({ sessionInputs: null })

    expect(outcome.ok).toBe(true)
    expect(store.sessions[0]!.session_inputs).toBeNull()
    expect(store.sessions[0]!.progress.failed).toContain(readingUnit('prism', layer1Entry('prism')!.brand))

    const prism = store.computations.find((row) => row.system === 'prism')!
    expect(prism.axes).toBeNull()
    expect(prism.ai_payload).toBeNull()
  })

  it('rejects duplicate PRISM colors before deducting credits', async () => {
    const { store, credits, create } = harness()
    const duplicate = PRISM_COLORS[0]
    const outcome = await create({
      sessionInputs: {
        prism: {
          impulse: duplicate,
          need: duplicate,
          identity: PRISM_COLORS[1],
        },
      },
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('invalid_input')
    expect(outcome.message).toContain('distinct')
    expect(credits.charges).toHaveLength(0)
    expect(store.sessions).toHaveLength(0)
  })

  it('returns the existing session instead of creating a second one', async () => {
    const { store, credits, create } = harness()
    const first = await create()
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = await create({ readerCount: 9 })
    expect(second.ok).toBe(true)
    if (!second.ok) return

    expect(second.reused).toBe(true)
    expect(second.session.id).toBe(first.session.id)
    expect(second.session.reader_count).toBe(3)
    expect(store.sessions).toHaveLength(1)
    expect(credits.charges).toHaveLength(1)
  })

  it('refunds and marks the session failed when nothing is computable', async () => {
    const { store, credits, create } = harness({ birth_date: 'not-a-date' })
    const outcome = await create({ systems: ['saju', 'ziwei'] })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('compute_failed')

    const cost = creditsForOracleSession('combined', 3)
    expect(credits.charges).toHaveLength(1)
    expect(credits.refunds).toEqual([{ userId: USER, amount: cost }])
    expect(credits.balance).toBe(1_000)

    const session = store.sessions[0]!
    expect(session.status).toBe('failed')
    expect(session.next_action).toBeNull()
    expect(session.completed_at).toBe(NOW.toISOString())
  })

  it('rejects an unknown profile without charging', async () => {
    const { credits, create } = harness()
    const outcome = await create({ subjectProfileId: 'profile-someone-else' })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('profile_not_found')
    expect(credits.charges).toHaveLength(0)
  })

  it('reports insufficient credits without creating a session', async () => {
    const { store, credits, create } = harness()
    credits.failWith = 'insufficient'

    const outcome = await create()
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('insufficient_credits')
    expect(store.sessions).toHaveLength(0)
  })

  it('records a skipped (admin) charge as 0 so a later refund cannot grant credits', async () => {
    const { store, credits, create } = harness({ birth_date: 'not-a-date' })
    credits.skip = true

    const outcome = await create({ systems: ['saju'] })
    expect(outcome.ok).toBe(false)
    expect(store.sessions[0]!.credits_charged).toBe(0)
    expect(credits.refunds).toHaveLength(0)
    expect(credits.balance).toBe(1_000)
  })

  it('records user-drawn tarot positions on the computation', async () => {
    const { store, create } = harness()
    const pickedPositions = [14, 3, 71]
    const outcome = await create({
      scope: 'single',
      systems: ['tarot'],
      sessionInputs: { tarot: { spread: 3, pickedPositions } },
    })

    expect(outcome.ok).toBe(true)
    const tarot = store.computations.find((row) => row.system === 'tarot')!
    const draw = tarot.result as { draw?: { cards?: Array<{ pickedPosition: number }> } }
    expect(draw.draw?.cards?.map((card) => card.pickedPosition)).toEqual(pickedPositions)
  })

  it('surfaces coordinatesDefaulted when astro has no lat/lng', async () => {
    const { create } = harness({ lat: null, lng: null })
    const outcome = await create({ scope: 'single', systems: ['astro'] })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.assumptions?.coordinatesDefaulted).toBe(true)
  })

  it('does not charge credits when the AI adapter is in stub mode', async () => {
    vi.stubEnv('ORACLE_AI_MODE', 'stub')
    const { store, credits, create } = harness()
    const outcome = await create({ scope: 'single', systems: ['saju'] })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(credits.charges).toHaveLength(0)
    expect(store.sessions[0]!.credits_charged).toBe(0)
    expect(store.sessions[0]!.prompt_version).toBe(ORACLE_PROMPT_VERSION)
  })
})

describe('createOracleSession (kind=compat)', () => {
  const PARTNER = { birthDate: '1991-03-08', birthTime: '21:40', sex: 'M' as const, name: '박도윤' }
  const COMPAT_REQUEST: Partial<CreateSessionRequest> = {
    kind: 'compat',
    scope: 'combined',
    systems: [],
    sessionInputs: { ...PRISM_INPUTS, partner: PARTNER },
    readerCount: 3,
  }

  it('reads the 궁합 credit table from config: 단일 4/6, 통합 15/19/23', () => {
    expect(creditsForOracleSession('single', 3, 'compat')).toBe(4)
    expect(creditsForOracleSession('single', 5, 'compat')).toBe(6)
    expect(creditsForOracleSession('combined', 3, 'compat')).toBe(15)
    expect(creditsForOracleSession('combined', 5, 'compat')).toBe(19)
    expect(creditsForOracleSession('combined', 7, 'compat')).toBe(23)
    // Seat counts the 궁합 product does not sell have NO price row.
    expect(() => creditsForOracleSession('single', 7, 'compat')).toThrow()
    expect(() => creditsForOracleSession('combined', 9, 'compat')).toThrow()
  })

  it('charges the compat price and stores Person B ONLY on the session row', async () => {
    const { store, credits, create } = harness()
    const outcome = await create(COMPAT_REQUEST)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.session.kind).toBe('compat')
    expect(outcome.computations).toHaveLength(12)
    expect(credits.charges).toEqual([{ userId: USER, amount: 15, module: ORACLE_CREDITS_MODULE }])

    // Session-scoped: partner rides on session_inputs…
    expect(store.sessions[0]!.session_inputs?.partner).toEqual(PARTNER)
    // …and NEVER becomes a profile row (the ★ rule).
    expect(store.profiles).toHaveLength(1)
    expect(store.profiles[0]!.id).toBe('profile-subject')
  })

  it('rejects a compat session without Person B before charging', async () => {
    const { store, credits, create } = harness()
    const outcome = await create({ ...COMPAT_REQUEST, sessionInputs: PRISM_INPUTS })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('invalid_input')
    expect(outcome.message).toContain('partner')
    expect(credits.charges).toHaveLength(0)
    expect(store.sessions).toHaveLength(0)
  })

  it('rejects partnerProfileId on a compat session — Person B is never a profile', async () => {
    const { credits, create } = harness()
    const outcome = await create({ ...COMPAT_REQUEST, partnerProfileId: 'profile-other' })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('invalid_input')
    expect(credits.charges).toHaveLength(0)
  })

  it('rejects tzolkin as 단일 궁합 (no two-person rule) before charging', async () => {
    const { credits, create } = harness()
    const outcome = await create({ ...COMPAT_REQUEST, scope: 'single', systems: ['tzolkin'] })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.code).toBe('invalid_input')
    expect(outcome.message).toContain('단일 궁합')
    expect(credits.charges).toHaveLength(0)
  })

  it('enforces compat reader counts: single 3/5 only, combined 3/5/7 only', async () => {
    const { credits, create } = harness()
    const single7 = await create({ ...COMPAT_REQUEST, scope: 'single', systems: ['saju'], readerCount: 7 })
    expect(single7.ok).toBe(false)
    const combined9 = await create({ ...COMPAT_REQUEST, readerCount: 9 })
    expect(combined9.ok).toBe(false)
    expect(credits.charges).toHaveLength(0)

    const single5 = await create({ ...COMPAT_REQUEST, scope: 'single', systems: ['saju'], readerCount: 5 })
    expect(single5.ok).toBe(true)
    expect(credits.charges).toEqual([{ userId: USER, amount: 6, module: ORACLE_CREDITS_MODULE }])
  })

  it('surfaces the partner assumption flags on the create outcome', async () => {
    const { create } = harness()
    const outcome = await create({
      ...COMPAT_REQUEST,
      sessionInputs: { ...PRISM_INPUTS, partner: { birthDate: '1991-03-08', birthTime: null, sex: null, name: null } },
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.assumptions?.partnerBirthTimeUnknown).toBe(true)
    expect(outcome.assumptions?.partnerSexDefaulted).toBe(true)
    expect(outcome.assumptions?.partnerLocationAssumed).toBe(true)
  })
})

describe('createOracleSession (kind=daily)', () => {
  const DAILY_REQUEST: Partial<CreateSessionRequest> = {
    kind: 'daily',
    scope: 'combined',
    systems: [],
    sessionInputs: null,
    readerCount: 1,
    question: 'ignored',
  }

  it('wires an explicit 2 through the credit table', () => {
    expect(creditsForOracleSession('combined', 1, 'daily')).toBe(2)
    expect(() => creditsForOracleSession('combined', 3, 'daily')).toThrow()
    expect(() => creditsForOracleSession('single', 1, 'daily')).toThrow()
  })

  it('charges 2, pins seven day-moving systems, one Z.ai seat, and a civil-day seed', async () => {
    const { store, credits, create } = harness()
    const outcome = await create(DAILY_REQUEST)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.session.kind).toBe('daily')
    expect(outcome.session.reader_count).toBe(1)
    expect(outcome.session.reader_roster).toEqual(['Z.ai'])
    expect(outcome.session.question_raw).toBeNull()
    expect(outcome.session.seed).toBe('daily:user-1:2026-08-20')
    expect(outcome.session.session_inputs).toMatchObject({ asOfDate: '2026-08-20' })
    expect(outcome.computations.map((row) => row.system)).toEqual([
      'saju',
      'astro',
      'tarot',
      'runes',
      'ninestar',
      'sukuyou',
      'tzolkin',
    ])
    expect(credits.charges).toEqual([{ userId: USER, amount: 2, module: ORACLE_CREDITS_MODULE }])
    expect(store.sessions[0]!.credits_charged).toBe(2)

    const progress = store.sessions[0]!.progress
    expect(progress.pending).toEqual([readingUnit('saju', 'Z.ai')])
    expect(progress.pending).not.toContain('synthesis')
  })

  it('does not reuse a personal session in flight', async () => {
    const { store, create } = harness()
    const personal = await create()
    expect(personal.ok).toBe(true)
    const daily = await create(DAILY_REQUEST)
    expect(daily.ok).toBe(true)
    if (!personal.ok || !daily.ok) return
    expect(daily.reused).toBe(false)
    expect(daily.session.id).not.toBe(personal.session.id)
    expect(store.sessions).toHaveLength(2)
  })
})
