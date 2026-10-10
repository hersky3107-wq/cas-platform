import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CRISIS_BRIEF_CREDITS, CRISIS_DEEP_CREDITS, creditsForCrisisBrief, creditsForCrisisDeep, creditsForCrisisDeepCache } from '../../credits'
import { freeLayerFromDetail, lockBriefCard, unlockBriefCard } from '../card'
import { noveltyBadge } from '../labels'
import { decideDeepAction, isFreshCard, isPublicRun, shouldPulse } from '../policy'

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
    expect(locked).toMatchObject({ locked: true, status: 'public', headline_ko: '바둘라 산사태 위험' })
    expect(locked).not.toHaveProperty('headlines')
    expect(noveltyBadge('only_us')).toBe('우리만 봤다')
    expect(noveltyBadge('also_seen_elsewhere')).toBeNull()
    const free = freeLayerFromDetail({
      people_norm: 0.42,
      fragility_items: [{ name: 'Uma Oya' }],
      urban: [{ name: 'Badulla', pop: 42000 }],
    })
    expect(free).toEqual({
      fragility: ['Uma Oya'],
      peopleNorm: 0.42,
      urban: [{ name: 'Badulla', pop: 42000 }],
    })
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
    expect(card.headlines[0].noveltyBadge).toBe('우리만 봤다')
    expect(card.headlines[0].what_to_do_ko).toEqual(['Move upslope'])
    expect(card.headlines[0].what_to_do_local).toEqual(['Move upslope'])
    expect(card.baseline_risks).toHaveLength(3)
    expect(card.evidence).toEqual(['https://example.com/e'])
  })
})

describe('deep cache policy', () => {
  it('replays a finished own card, waits on queue, else uses a <24h cache', () => {
    expect(isFreshCard(new Date(NOW.getTime() - 23 * 3600_000).toISOString(), NOW)).toBe(true)
    expect(isFreshCard(new Date(NOW.getTime() - 25 * 3600_000).toISOString(), NOW)).toBe(false)
    expect(isPublicRun([1])).toBe(true)
    expect(isPublicRun([])).toBe(false)
    expect(
      decideDeepAction({ ownStatus: 'running', ownHasCard: false, freshPublicAt: NOW.toISOString(), now: NOW }),
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
})

describe('public migration', () => {
  it('adds user RLS on the request queue', () => {
    const sql = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261010000002_crisis_public_access.sql'),
      'utf8',
    )
    expect(sql).toContain('crisis_engine_requests_user_insert')
    expect(sql).toContain('requested_by = auth.uid()')
    expect(sql).toContain('crisis_unlocks')
    const apply = readFileSync(path.join(process.cwd(), 'docs/crisis/APPLY_PUBLIC.md'), 'utf8')
    expect(apply).toContain("VALUES ('20261010000002','20261010000002_crisis_public_access')")
  })
})
