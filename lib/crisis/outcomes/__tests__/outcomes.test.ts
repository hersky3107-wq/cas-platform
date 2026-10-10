import { describe, expect, it } from 'vitest'
import { decideOutcome, parseVerdict } from '../check'
import { predictionDropReason, settlePredictions } from '../predictions'
import { outcomesDue } from '../schedule'
import { summarizeScoreboard } from '../scoreboard'
import { checkOpenPredictions } from '../run-check'
import { windowLabel } from '../window'
import { getOutcomeUi } from '../../i18n/dictionary'

const NOW = new Date('2026-10-10T01:30:00Z')

describe('prediction windows', () => {
  it('labels a 3 to 7 day window in Korean', () => {
    expect(windowLabel(3, 7)).toBe('예상 시기: 3~7일 뒤')
    expect(getOutcomeUi('ko').expectedWindow(3, 7)).toBe('예상 시기: 3~7일 뒤')
    expect(getOutcomeUi('ko').hitLine('10월 10일 18:40', '10월 14일')).toBe('10월 10일 18:40 예측 → 10월 14일 적중')
  })

  it('drops a restated public forecast and keeps a dam spill inside 90 days', () => {
    const forecast = predictionDropReason(
      {
        what: '7-day rain forecast of 310 mm',
        where: 'Badulla',
        window_start: '2026-10-13',
        window_end: '2026-10-17',
        probability: 0.8,
        observable: 'The forecast map still shows rain',
        counts_as_hit: 'Rain is forecast',
      },
      NOW,
    )
    expect(forecast).toBe('restates_public_forecast')
    const kept = settlePredictions(
      [
        {
          what: 'Victoria Dam spill',
          where: 'Badulla',
          window_start: '2026-10-13',
          window_end: '2026-10-17',
          probability: 0.6,
          observable: 'Spill gates open and downstream roads flood',
          counts_as_hit: 'An official report says the dam spilled.',
        },
      ],
      NOW,
      [],
    )
    expect(kept).toHaveLength(1)
    expect(kept[0]?.what).toBe('dam spill')
    expect(kept[0]?.label).toContain('예상 시기')
  })

  it('rejects a window longer than 90 days', () => {
    expect(
      predictionDropReason(
        {
          what: 'dam spill',
          where: 'Badulla',
          window_start: '2026-10-10',
          window_end: '2027-02-01',
          probability: 0.4,
          observable: 'Spill reported',
          counts_as_hit: 'The dam spilled.',
        },
        NOW,
      ),
    ).toBe('window_over_90_days')
  })
})

describe('outcome check and scoreboard', () => {
  it('records a public miss when the window has ended with no evidence', async () => {
    const writes = await checkOpenPredictions({
      now: new Date('2026-10-20T00:00:00Z'),
      rows: [
        {
          id: 9,
          createdAt: '2026-10-10T09:40:00Z',
          outcomeCount: 0,
          prediction: {
            what: 'dam spill',
            where: 'Badulla',
            window_start: '2026-10-13',
            window_end: '2026-10-17',
            probability: 0.6,
            observable: 'Spill gates open',
            counts_as_hit: 'An official report says the dam spilled.',
            label: '예상 시기: 3~7일 뒤',
          },
        },
      ],
      search: async () => [],
    })
    expect(writes[0]?.outcome).toBe('did_not_happen')
    expect(writes[0]?.event_description.startsWith('miss:')).toBe(true)
    const decision = decideOutcome({
      prediction: writes[0]
        ? {
            what: 'eruption',
            where: 'Etna',
            window_start: '2026-10-10',
            window_end: '2026-10-20',
            probability: 0.4,
            observable: 'Ashfall reported',
            counts_as_hit: 'USGS reports an eruption.',
            label: '예상 시기: 7~14일 뒤',
          }
        : {
            what: 'eruption',
            where: 'Etna',
            window_start: '2026-10-10',
            window_end: '2026-10-20',
            probability: 0.4,
            observable: 'Ashfall reported',
            counts_as_hit: 'USGS reports an eruption.',
            label: '예상 시기: 7~14일 뒤',
          },
      createdAt: '2026-10-10T00:00:00Z',
      now: new Date('2026-10-12T00:00:00Z'),
      evidence: [{ title: 'Etna eruption ash', url: 'https://volcano.example/etna', source: 'usgs' }],
      judged: parseVerdict('{"verdict":"hit","note":"Ashfall confirmed","url":"https://volcano.example/etna"}'),
    })
    expect(decision?.outcome).toBe('happened')
  })

  it('counts hits, misses, pending, and unclear', () => {
    const board = summarizeScoreboard(
      [
        { id: 1, createdAt: '2026-10-10T09:40:00Z', title: 'dam spill', where: 'Badulla', windowEnd: '2026-10-17', probability: 0.6 },
        { id: 2, createdAt: '2026-10-10T09:40:00Z', title: 'outbreak', where: 'Colombo', windowEnd: '2026-10-20', probability: 0.4 },
        { id: 3, createdAt: '2026-10-10T09:40:00Z', title: 'road cut', where: 'Kandy', windowEnd: '2026-11-01', probability: 0.3 },
        { id: 4, createdAt: '2026-10-10T09:40:00Z', title: 'collapse', where: 'Galle', windowEnd: '2026-10-12', probability: 0.5 },
      ],
      [
        {
          hypothesisId: 1,
          outcome: 'happened',
          eventDescription: 'hit: spill reported',
          eventDate: '2026-10-14',
          recordedAt: '2026-10-14T00:00:00Z',
          sourceUrls: ['https://example.com/spill'],
        },
        {
          hypothesisId: 2,
          outcome: 'did_not_happen',
          eventDescription: 'miss: no outbreak',
          eventDate: '2026-10-20',
          recordedAt: '2026-10-20T00:00:00Z',
          sourceUrls: [],
        },
        {
          hypothesisId: 4,
          outcome: 'partially',
          eventDescription: 'unclear: related flood only',
          eventDate: '2026-10-12',
          recordedAt: '2026-10-12T00:00:00Z',
          sourceUrls: [],
        },
      ],
      new Date('2026-10-15T00:00:00Z'),
    )
    expect(board).toMatchObject({ total: 4, hits: 1, misses: 1, pending: 1, unclear: 1 })
    expect(board.latestHits[0]?.hitAt).toBe('2026-10-14')
  })

  it('is due daily at 10:30 KST and not again the same day', () => {
    expect(outcomesDue(null, new Date('2026-10-10T01:29:00Z'))).toBe(false)
    expect(outcomesDue(null, new Date('2026-10-10T01:30:00Z'))).toBe(true)
    expect(outcomesDue('2026-10-10T01:40:00Z', new Date('2026-10-10T06:00:00Z'))).toBe(false)
    expect(outcomesDue('2026-10-10T01:40:00Z', new Date('2026-10-11T01:30:00Z'))).toBe(true)
  })
})
