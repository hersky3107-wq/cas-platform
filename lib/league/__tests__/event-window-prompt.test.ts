import { describe, expect, it } from 'vitest'
import { answerContractFor, buildRoundPrompts } from '../answer-contract'
import { buildConsensusUserPrompt } from '../extra/consensus'
import {
  earlierEventExampleFromPacket,
  eventWindowConstraintLine,
  withEventWindowConstraint,
} from '../event-window-prompt'

describe('explicit event-window line', () => {
  it('names the open date and an earlier packet event as the counter-example', () => {
    const packet = [
      'Jan 2026: Samsung showed a tri-fold prototype at a private demo.',
      '2026-10-06: no store listing.',
    ].join('\n')
    expect(earlierEventExampleFromPacket(packet, '2026-10-04')).toMatch(/Jan 2026/)
    const line = eventWindowConstraintLine(
      '2026-10-04',
      earlierEventExampleFromPacket(packet, '2026-10-04'),
    )
    expect(line).toBe(
      'Only events dated on or after 2026-10-04 count. Events before 2026-10-04 (e.g. Jan 2026: Samsung showed a tri-fold prototype at a private demo.) do NOT satisfy this question.',
    )
  })

  it('is on official, scout, and extra prompts for TECH:OPEN', () => {
    const round = {
      proposition_text: 'Will Samsung list a tri-fold by 2026-12-31?',
      instrument: 'TECH:OPEN:samsung:release:tri-fold:20261231:store_listing',
      category: 'tech',
      horizon: '3m',
      resolution_rule: 'Store listing after open.',
      resolves_at: '2026-12-31T15:00:00.000Z',
      opened_at: '2026-10-04T03:00:00.000Z',
      closed_book_packet_text: 'January 2026 tri-fold shown at CES.',
    }
    const prompts = buildRoundPrompts(answerContractFor('binary_subject_outcome'), round, 'PACKET', undefined)
    expect(prompts.price).toContain('Only events dated on or after 2026-10-04 count.')
    expect(prompts.scout).toContain('Events before 2026-10-04')
    expect(prompts.price).toMatch(/January 2026 tri-fold/)
    expect(prompts.scout).toMatch(/do NOT satisfy this question/)

    const extra = withEventWindowConstraint(
      buildConsensusUserPrompt({
        proposition: round.proposition_text,
        instrument: round.instrument,
        horizon: '3m',
        category: 'tech',
        subjectName: 'Samsung',
        propositionKind: 'binary_subject_outcome',
      }),
      {
        instrument: round.instrument,
        category: 'tech',
        openedAt: round.opened_at,
        packet: round.closed_book_packet_text,
      },
    )
    expect(extra).toContain('Only events dated on or after 2026-10-04 count.')
  })

  it('does not rewrite a stock prompt with no event window', () => {
    const round = {
      proposition_text: 'Will AAPL close higher?',
      instrument: 'AAPL',
      category: 'stock',
      horizon: '1d',
      resolution_rule: 'NASDAQ close',
      resolves_at: '2026-10-06T20:00:00.000Z',
      opened_at: '2026-10-05T13:30:00.000Z',
    }
    const prompts = buildRoundPrompts(answerContractFor('binary_close_higher'), round, 'BASE RATE: 53%', undefined)
    expect(prompts.price).not.toContain('Only events dated on or after')
  })
})
