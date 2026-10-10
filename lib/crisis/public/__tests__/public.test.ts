import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    auth: { admin: { getUserById: vi.fn() } },
    from: vi.fn(),
  },
}))

import { CRISIS_BRIEF_CREDITS, CRISIS_DEEP_CREDITS, creditsForCrisisBrief, creditsForCrisisDeep, creditsForCrisisDeepCache } from '../../credits'
import { freeLayerFromDetail, lockBriefCard, unlockBriefCard } from '../card'
import { noveltyBadge } from '../labels'
import { evaluateUserLimits } from '../limits'
import { decideDeepAction, isFreshCard, isPublicRun, isTimedOut, shouldPulse, DEEP_FAILED_COPY, DEEP_WAIT_COPY } from '../policy'
import { formatPeopleAbout, formatPeopleShort, keyTriggerFact } from '../format'
import { summarizeEngineProgress } from '../progress'
import { isTimedOutRequest } from '../refund'

const NOW = new Date('2026-10-10T12:00:00.000Z')

describe('credit constants', () => {
  it('keeps brief and deep prices in one file and charges cache the same', () => {
    expect(CRISIS_BRIEF_CREDITS).toBe(8)
    expect(CRISIS_DEEP_CREDITS).toBe(25)
    expect(creditsForCrisisBrief()).toBe(CRISIS_BRIEF_CREDITS)
    expect(creditsForCrisisDeep()).toBe(CRISIS_DEEP_CREDITS)
    expect(creditsForCrisisDeepCache()).toBe(CRISIS_DEEP_CREDITS)
    const src = readFileSync(path.join(process.cwd(), 'lib/crisis/credits.ts'), 'utf8')
    expect(src).toContain('PLACEHOLDER')
    expect(src).not.toContain('lib/league')
  })
})

describe('map and briefing shaping', () => {
  it('pulses stage >= 4 and locks unpublished viewers to headline_ko', () => {
    expect(shouldPulse(3)).toBe(false)
    expect(shouldPulse(4)).toBe(true)
    expect(shouldPulse(5)).toBe(true)
    const locked = lockBriefCard({
      runId: 'r1',
      regionId: 7,
      regionName: 'Badulla',
      country: 'Sri Lanka',
      result: { headline_ko: '바둘라 산사태 위험' },
    })
    expect(locked).toMatchObject({ locked: true, status: 'public', headline_ko: '바둘라 산사태 위험', stage: 1 })
    expect(locked).not.toHaveProperty('headlines')
    expect(noveltyBadge('only_us')).toBe('우리만 포착')
    expect(noveltyBadge('also_seen_elsewhere')).toBe('다른 곳도 보도')
    const free = freeLayerFromDetail({
      people_norm: 0.42,
      fragility_items: [{ name: 'Uma Oya' }],
      urban: [{ name: 'Badulla', pop: 42000 }],
    })
    expect(free).toMatchObject({
      fragility: ['Uma Oya'],
      peopleNorm: 0.42,
      peopleCount: 42000,
      urban: [{ name: 'Badulla', pop: 42000 }],
    })
  })

  it('groups fragility by kind and keeps rain millimetres', () => {
    const free = freeLayerFromDetail({
      people_norm: 0.62,
      urban_pop: 1_500_000,
      fragility_items: [
        { kind: 'dam', name: 'Victoria' },
        { kind: 'dam', name: 'Randenigala' },
        { kind: 'nuclear_plant', name: 'Plant A' },
      ],
      components: [
        { key: 'rain', value: 0.8, raw: { sum_mm: 310, max_day_mm: 154 } },
        { key: 'wiki', value: 0, raw: {} },
      ],
    })
    expect(free.peopleCount).toBe(1_500_000)
    expect(free.fragilityGroups).toEqual([
      { kind: 'dam', names: ['Victoria', 'Randenigala'] },
      { kind: 'nuclear_plant', names: ['Plant A'] },
    ])
    expect(free.triggerFacts).toEqual([{ key: 'rain', sumMm: 310, maxDayMm: 154 }])
  })

  it('unlocks the three tiers and keeps what_to_do for Korean and local', () => {
    const card = unlockBriefCard({
      runId: 'r1',
      regionId: 7,
      regionName: 'Badulla',
      country: 'Sri Lanka',
      iso3: 'LKA',
      searchUrls: ['https://example.com/e'],
      costUsd: 0.4,
      result: {
        headlines: [
          {
            title: 'Spillway',
            novelty: 'only_us',
            stage: 3,
            possibility: 'medium',
            what_to_do: ['Move upslope'],
            official_links: [{ label: 'DMC', url: 'https://dmc.gov.lk' }],
            evidence: [{ type: 'url', ref: 'note', url: 'https://example.com/e' }],
            chain: [{ step: 'rain', cascade_id: null }],
            horizon: '30d',
            why_humans_miss: 'x',
            proposed_by: ['a'],
            weakness_notes: [],
            confidence: 'medium',
            outsider: true,
          },
        ],
        missed_by_others: [],
        baseline_risks: [
          { title: 'Seasonal flood', stage: 2, possibility: 'high', what_to_do: ['Watch river'] },
          { title: 'Landslide', stage: 3, possibility: 'medium', what_to_do: ['Avoid slopes'] },
          { title: 'Road cut', stage: 2, possibility: 'medium', what_to_do: ['Stock fuel'] },
        ],
        summary_ko: '요약',
        summary_en: 'summary',
        headline_ko: '제목',
        headline_en: 'title',
        map_focus: { lat: 7, lon: 81, zoom: 8 },
        partial: false,
        novelty_counts: { only_us: 1, also_seen_elsewhere: 0 },
      },
    })
    expect(card.locked).toBe(false)
    expect(card.headlines[0].noveltyBadge).toBe('우리만 포착')
    expect(card.headlines[0].why_humans_miss).toBe('x')
    expect(card.stage).toBe(3)
    expect(card.headlines[0].what_to_do_ko).toEqual(['Move upslope'])
    expect(card.headlines[0].what_to_do_local).toEqual(['Move upslope'])
    expect(card.baseline_risks).toHaveLength(3)
    expect(card.evidence).toEqual(['https://example.com/e'])
  })
})

describe('deep cache and timeout policy', () => {
  it('replays a finished own card, waits on queue, else uses a <24h cache', () => {
    expect(isFreshCard(new Date(NOW.getTime() - 23 * 3600_000).toISOString(), NOW)).toBe(true)
    expect(isFreshCard(new Date(NOW.getTime() - 25 * 3600_000).toISOString(), NOW)).toBe(false)
    expect(isPublicRun([1])).toBe(true)
    expect(isPublicRun([])).toBe(false)
    expect(
      decideDeepAction({
        ownStatus: 'running',
        ownHasCard: false,
        ownCreatedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
        freshPublicAt: NOW.toISOString(),
        now: NOW,
      }),
    ).toBe('pending')
    expect(
      decideDeepAction({ ownStatus: 'done', ownHasCard: true, freshPublicAt: null, now: NOW }),
    ).toBe('replay')
    expect(
      decideDeepAction({
        ownStatus: null,
        ownHasCard: false,
        freshPublicAt: new Date(NOW.getTime() - 3600_000).toISOString(),
        now: NOW,
      }),
    ).toBe('cache')
    expect(decideDeepAction({ ownStatus: null, ownHasCard: false, freshPublicAt: null, now: NOW })).toBe('start')
  })

  it('marks running/queued requests older than 60m as failed for refund', () => {
    const recent = new Date(NOW.getTime() - 30 * 60_000).toISOString()
    const timedOut = new Date(NOW.getTime() - 61 * 60_000).toISOString()
    expect(isTimedOut(recent, NOW)).toBe(false)
    expect(isTimedOut(timedOut, NOW)).toBe(true)
    expect(isTimedOutRequest({ status: 'queued', created_at: timedOut }, NOW)).toBe(true)
    expect(isTimedOutRequest({ status: 'running', created_at: timedOut }, NOW)).toBe(true)
    expect(isTimedOutRequest({ status: 'done', created_at: timedOut }, NOW)).toBe(false)
    expect(isTimedOutRequest({ status: 'queued', created_at: recent }, NOW)).toBe(false)

    expect(
      decideDeepAction({
        ownStatus: 'queued',
        ownHasCard: false,
        ownCreatedAt: timedOut,
        freshPublicAt: null,
        now: NOW,
      }),
    ).toBe('failed')
    expect(
      decideDeepAction({
        ownStatus: 'failed',
        ownHasCard: false,
        freshPublicAt: null,
        now: NOW,
      }),
    ).toBe('failed')
    expect(DEEP_FAILED_COPY).toBe('분석 실패, 크레딧 환불됨')
    expect(DEEP_WAIT_COPY).toBe('분석 중, 최대 15분')
  })
})

describe('user request limits', () => {
  it('exempts admin from all limits', () => {
    const res = evaluateUserLimits({ isAdmin: true, activeCount: 5, dailyCount: 10 })
    expect(res.allowed).toBe(true)
  })

  it('enforces max 1 active (queued/running) request per user', () => {
    const allow0 = evaluateUserLimits({ isAdmin: false, activeCount: 0, dailyCount: 0 })
    expect(allow0.allowed).toBe(true)

    const block1 = evaluateUserLimits({ isAdmin: false, activeCount: 1, dailyCount: 0 })
    expect(block1.allowed).toBe(false)
    expect(block1.reason).toBe('active_request_exists')
    expect(block1.message).toBe('이미 진행 중인 분석 요청이 있습니다.')
  })

  it('enforces max 3 requests per day per user', () => {
    const allow2 = evaluateUserLimits({ isAdmin: false, activeCount: 0, dailyCount: 2 })
    expect(allow2.allowed).toBe(true)

    const block3 = evaluateUserLimits({ isAdmin: false, activeCount: 0, dailyCount: 3 })
    expect(block3.allowed).toBe(false)
    expect(block3.reason).toBe('daily_limit_exceeded')
    expect(block3.message).toBe('하루 최대 3회까지 분석을 요청할 수 있습니다.')
  })
})

describe('readable free layer', () => {
  it('formats people as about 1.2 million in Korean', () => {
    expect(formatPeopleShort(1_200_000, 'ko')).toBe('120만')
    expect(formatPeopleAbout(1_200_000, 'ko')).toBe('인구 약 120만 명')
    expect(keyTriggerFact([{ key: 'rain', sumMm: 310, maxDayMm: 154 }])?.sumMm).toBe(310)
  })
})

describe('engine progress', () => {
  it('marks the first group running and waits for the worker after 2 minutes', () => {
    const queued = summarizeEngineProgress({
      requestStatus: 'queued',
      createdAt: new Date(NOW.getTime() - 130_000).toISOString(),
      now: NOW,
      steps: [],
    })
    expect(queued.waitingForWorker).toBe(true)
    expect(queued.groups.every((row) => row.mark === 'waiting')).toBe(true)

    const running = summarizeEngineProgress({
      requestStatus: 'running',
      createdAt: new Date(NOW.getTime() - 30_000).toISOString(),
      now: NOW,
      steps: [{ role: 'dept_analyst' }, { role: 'dept_analyst' }],
    })
    expect(running.waitingForWorker).toBe(false)
    expect(running.groups[0]).toMatchObject({ id: 'analyst', done: 2, expected: 5, mark: 'running' })
    expect(running.groups[1].mark).toBe('waiting')
    expect(running.elapsedSec).toBe(30)
  })
})

describe('refund idempotency', () => {
  it('returns already: true if deep_refund already exists in crisis_unlocks', async () => {
    const { refundUserRequest } = await import('../refund')
    const mockClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'existing-refund' }, error: null }),
      }),
    }
    const res = await refundUserRequest(mockClient as never, 'req-1', 'user-1', 42)
    expect(res).toEqual({ refunded: false, already: true, reason: 'already_refunded' })
  })
})

describe('public migration', () => {
  it('adds user RLS on the request queue and deep_refund to crisis_unlocks', () => {
    const sql = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261010000002_crisis_public_access.sql'),
      'utf8',
    )
    expect(sql).toContain('crisis_engine_requests_user_insert')
    expect(sql).toContain('requested_by = auth.uid()')
    expect(sql).toContain('crisis_unlocks')
    expect(sql).toContain('deep_refund')
    expect(sql).toContain('request_id')
    expect(sql).toContain('crisis_unlocks_refund_unique')
    const apply = readFileSync(path.join(process.cwd(), 'docs/crisis/APPLY_PUBLIC.md'), 'utf8')
    expect(apply).toContain("VALUES ('20261010000002','20261010000002_crisis_public_access')")
  })
})
