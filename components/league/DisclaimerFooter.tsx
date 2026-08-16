import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { ToneTokens } from '@/lib/league/tone'

/**
 * The mandatory disclaimer slot. Rendered by `CardCompliance` ONLY — see that
 * file for why this can never be skipped. `tone.disclaimerWeight` changes how
 * prominent this looks (Layer 3), never whether it renders or what it says
 * beyond picking the short vs long approved copy. Text comes from `t.disclaimer`
 * (Layer A) — every locale in `lib/league/i18n/dictionary.ts` fills this in
 * explicitly, so no locale can render without an approved, translated disclaimer.
 */
export function DisclaimerFooter({ tone, t }: { tone: ToneTokens; t: LeagueUiPack }) {
  if (tone.disclaimerWeight === 'default') {
    return (
      <p className="border-t border-league-border/60 px-4 py-2.5 text-center text-[11px] leading-snug text-league-fg-muted">
        {t.disclaimer.short}
      </p>
    )
  }

  const prominent = tone.disclaimerWeight === 'prominent'
  return (
    <div
      className={`border-t px-4 py-3 text-center leading-snug border-league-border ${
        prominent ? 'bg-league-accent-soft font-medium text-league-fg' : 'text-league-fg-muted'
      }`}
    >
      <p className={prominent ? 'text-xs' : 'text-[11px]'}>{t.disclaimer.long}</p>
    </div>
  )
}
