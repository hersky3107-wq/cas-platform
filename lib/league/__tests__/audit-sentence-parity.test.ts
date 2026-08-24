import { describe, expect, it } from 'vitest'
import { buildCardData } from '../card-aggregate'
import { buildRecordRoomEntries, buildRecordRoomPage } from '../record-room-aggregate'
import { headerWindow } from '../card-header-copy'
import { recordRoomAuditSentence, recordRoomToCsv } from '../record-room-csv'
import { LEAGUE_UI } from '../i18n/dictionary'
import type { LeagueLocale } from '../i18n/locales'

const t = LEAGUE_UI.en
const locale: LeagueLocale = 'en'

type RoundRow = Parameters<typeof buildCardData>[0]
type RecordRoomRoundRow = Parameters<typeof buildRecordRoomEntries>[0][number]

/**
 * The audit sentence must be built ONCE, from the persisted session dates +
 * prices, and rendered identically on the card header and in the record room —
 * so a reader can never see two different accounts of how the same round was
 * measured. These are the exact fields of round fffc1716.
 */
const AUDIT = {
  instrument: 'AAPL',
  anchor_price: 305.59,
  anchor_session_date: '2026-08-17',
  resolution_session_date: '2026-08-18',
  resolution_price: 310.03,
}

function cardWindow(fields: Partial<typeof AUDIT>): string {
  const merged = { ...AUDIT, ...fields }
  const row: RoundRow = {
    id: 'fffc1716',
    proposition_text: 'Will AAPL close higher?',
    category: 'stock',
    color_bucket: 'green',
    instrument: merged.instrument,
    horizon: '24h',
    resolution_rule: 'close vs prior close',
    resolves_at: '2026-08-18T15:31:00.000Z',
    opened_at: '2026-08-17T21:30:00.000Z',
    actual_outcome: 'up (2026-08-18 close 310.03 vs anchor 305.59 @ 2026-08-18T03:12:41.103763+00:00)',
    resolved_at: '2026-08-18T20:00:00.000Z',
    anchor_price: merged.anchor_price,
    anchor_price_at: '2026-08-18T03:12:41.103763+00:00',
    anchor_session_date: merged.anchor_session_date,
    resolution_session_date: merged.resolution_session_date,
    resolution_price: merged.resolution_price,
  }
  const { round } = buildCardData(row, [])
  return headerWindow({
    instrument: round.instrument,
    anchorPrice: round.anchorPrice,
    anchorSessionDate: round.anchorSessionDate,
    resolutionSessionDate: round.resolutionSessionDate,
    resolutionPrice: round.resolutionPrice,
    locale,
    t,
  })
}

function recordRoomRow(fields: Partial<typeof AUDIT>): RecordRoomRoundRow {
  const merged = { ...AUDIT, ...fields }
  return {
    id: 'fffc1716',
    proposition_text: 'Will AAPL close higher?',
    category: 'stock',
    color_bucket: 'green',
    instrument: merged.instrument,
    resolved_at: '2026-08-18T20:00:00.000Z',
    actual_outcome: 'up (2026-08-18 close 310.03 vs anchor 305.59 @ 2026-08-18T03:12:41.103763+00:00)',
    anchor_price: merged.anchor_price,
    anchor_session_date: merged.anchor_session_date,
    resolution_session_date: merged.resolution_session_date,
    resolution_price: merged.resolution_price,
  }
}

function recordRoomWindow(fields: Partial<typeof AUDIT>): string {
  const [entry] = buildRecordRoomEntries([recordRoomRow(fields)], [])
  return headerWindow({
    instrument: entry.instrument,
    anchorPrice: entry.anchorPrice,
    anchorSessionDate: entry.anchorSessionDate,
    resolutionSessionDate: entry.resolutionSessionDate,
    resolutionPrice: entry.resolutionPrice,
    locale,
    t,
  })
}

function csvWindow(fields: Partial<typeof AUDIT>): string {
  const [entry] = buildRecordRoomEntries([recordRoomRow(fields)], [])
  return recordRoomAuditSentence(entry)
}

function csvExportContains(fields: Partial<typeof AUDIT>): { csv: string; header: string } {
  const page = buildRecordRoomPage([recordRoomRow(fields)], [], 1, 20, 1)
  const csv = recordRoomToCsv(page)
  return { csv, header: csv.split('\n')[0] ?? '' }
}

describe('audit sentence parity — card header vs record room vs CSV', () => {
  it('renders an identical sentence for the same fully-graded round on all three surfaces', () => {
    const card = cardWindow({})
    const record = recordRoomWindow({})
    const csv = csvWindow({})
    expect(card).toBe(record)
    expect(record).toBe(csv)
    // Built from the session dates + both closes, never a timestamp.
    expect(card).toContain('Aug 17')
    expect(card).toContain('Aug 18')
    expect(card).toContain('$305.59')
    expect(card).toContain('$310.03')
    expect(card).not.toContain('03:12:41')
    expect(card).not.toContain('T03:12')

    const exported = csvExportContains({})
    expect(exported.header.split(',')).toEqual(expect.arrayContaining(['audit_sentence', 'raw_outcome_internal']))
    expect(exported.header.split(',')).not.toContain('actual_outcome')
    const quoted = `"${card.replace(/"/g, '""')}"`
    expect(exported.csv).toContain(quoted)
    expect(quoted).not.toContain('03:12:41')
  })

  it('blanks the resolution date identically when it is missing — never the resolves_at timestamp', () => {
    const card = cardWindow({ resolution_session_date: undefined })
    const record = recordRoomWindow({ resolution_session_date: undefined })
    const csv = csvWindow({ resolution_session_date: undefined })
    expect(card).toBe(record)
    expect(record).toBe(csv)
    // Anchor-only form: no resolution date, no timestamp.
    expect(card).toContain('Aug 17')
    expect(card).not.toContain('Aug 18')
    expect(card).not.toContain('03:12:41')
  })

  it('blanks both dates identically when neither session is recorded — never invents a date', () => {
    const card = cardWindow({ anchor_session_date: undefined, resolution_session_date: undefined })
    const record = recordRoomWindow({ anchor_session_date: undefined, resolution_session_date: undefined })
    const csv = csvWindow({ anchor_session_date: undefined, resolution_session_date: undefined })
    expect(card).toBe(record)
    expect(record).toBe(csv)
    expect(card).not.toContain('Aug 17')
    expect(card).not.toContain('Aug 18')
    expect(card).not.toContain('03:12:41')
  })
})
