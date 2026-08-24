import { headerWindow } from './card-header-copy'
import { LEAGUE_UI } from './i18n/dictionary'
import type { RecordRoomPage, RecordRoomRoundEntry } from './record-room-aggregate'

/**
 * Deep-archive CSV. The user-facing audit column is the SAME sentence the
 * card header and record room render (`headerWindow`), never the date
 * embedded in `actual_outcome`. The stored string is kept as
 * `raw_outcome_internal` so it cannot be mistaken for an audit date.
 *
 * Export locale is English so a downloaded file is locale-stable.
 */

export function recordRoomAuditSentence(round: Pick<
  RecordRoomRoundEntry,
  'instrument' | 'anchorPrice' | 'anchorSessionDate' | 'resolutionSessionDate' | 'resolutionPrice'
>): string {
  return headerWindow({
    instrument: round.instrument,
    anchorPrice: round.anchorPrice,
    anchorSessionDate: round.anchorSessionDate,
    resolutionSessionDate: round.resolutionSessionDate,
    resolutionPrice: round.resolutionPrice,
    locale: 'en',
    t: LEAGUE_UI.en,
  })
}

export function recordRoomToCsv(page: RecordRoomPage): string {
  const header = [
    'resolved_at',
    'instrument',
    'category',
    'proposition',
    'audit_sentence',
    'raw_outcome_internal',
    'model_id',
    'brand',
    'camp',
    'league_tier',
    'direction',
    'is_correct',
  ]
  const lines = [header.join(',')]
  for (const round of page.rounds) {
    const audit = recordRoomAuditSentence(round)
    if (round.models.length === 0) {
      lines.push(
        [
          csv(round.resolved_at),
          csv(round.instrument),
          csv(round.category),
          csv(round.proposition_text),
          csv(audit),
          csv(round.actual_outcome),
          '',
          '',
          '',
          '',
          '',
          '',
        ].join(',')
      )
      continue
    }
    for (const model of round.models) {
      lines.push(
        [
          csv(round.resolved_at),
          csv(round.instrument),
          csv(round.category),
          csv(round.proposition_text),
          csv(audit),
          csv(round.actual_outcome),
          csv(model.model_id),
          csv(model.brand),
          csv(model.camp),
          csv(model.league_tier),
          csv(model.direction),
          model.is_correct === null ? '' : model.is_correct ? 'true' : 'false',
        ].join(',')
      )
    }
  }
  return `${lines.join('\n')}\n`
}

function csv(value: string | null | undefined): string {
  const raw = value ?? ''
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`
  return raw
}
