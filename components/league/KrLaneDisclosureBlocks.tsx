import { KR_DISCLOSURE } from '@/lib/league/korea-disclosure'

const muted = 'text-[11px] leading-relaxed text-slate-500'

/** Mandatory usage notices under the generate guidance (Korean lane hub only). */
export function KrUsageNoticeList() {
  return (
    <ul
      data-testid="kr-lane-usage-notice"
      className={`mt-2 list-disc space-y-1 pl-4 ${muted}`}
    >
      {KR_DISCLOSURE.usageNotice.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

/** Bottom of every prediction card for Korean-lane viewers. */
export function KrCardDisclosureFooter() {
  return (
    <div
      data-testid="kr-card-disclosure"
      className={`mt-3 space-y-2 border-t border-slate-200 px-4 pt-3 ${muted}`}
    >
      <p>{KR_DISCLOSURE.card}</p>
      <p>{KR_DISCLOSURE.confidence}</p>
    </div>
  )
}

/** Leaderboard / record room track-record disclaimer. */
export function KrTrackRecordNotice({ text }: { text: string }) {
  return (
    <p data-testid="kr-track-record-notice" className={`px-4 pb-2 ${muted}`}>
      {text}
    </p>
  )
}

/** Near the price header on Korean-lane cards. */
export function KrDataNotice() {
  return (
    <p data-testid="kr-data-notice" className={`mt-1 ${muted}`}>
      {KR_DISCLOSURE.data}
    </p>
  )
}
