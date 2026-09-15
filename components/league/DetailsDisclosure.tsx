import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'

/**
 * Enthusiast-only breakdowns. Collapsed by default so a normal reader
 * sees the conclusion first. Native `<details>` — no client JS required.
 */
export function DetailsDisclosure({
  t,
  children,
  className = '',
  inProgress = false,
}: {
  t: LeagueUiPack
  children: ReactNode
  className?: string
  inProgress?: boolean
}) {
  return (
    <details
      className={`mt-4 rounded-xl border border-league-border/50 bg-league-bg-elevated/50 open:[&_summary_svg]:rotate-180 ${className}`}
      data-testid="verdict-details"
      data-in-progress={inProgress ? 'true' : 'false'}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-[12px] font-semibold text-league-fg-muted [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform" aria-hidden />
        <span className="min-w-0">
          {t.verdict.detailsToggle}
          {inProgress ? <span className="font-medium"> · {t.predictions.inProgressNote}</span> : null}
        </span>
      </summary>
      <div className="border-t border-league-border/40 px-3 pb-3 pt-2">{children}</div>
    </details>
  )
}
