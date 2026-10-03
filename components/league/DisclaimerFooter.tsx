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
export function DisclaimerFooter({
  tone,
  t,
  category,
  omitLegacyDisclaimer = false,
}: {
  tone: ToneTokens
  t: LeagueUiPack
  category?: string
  omitLegacyDisclaimer?: boolean
}) {
  const extra =
    category === 'real_estate' ? t.disclaimer.realEstate : category === 'sports' ? t.disclaimer.sports : null
  const scope = category === 'real_estate' ? t.disclaimer.realEstateScope : null
  const extraExperimental = omitLegacyDisclaimer ? null : t.disclaimer.extraExperimental

  if (tone.disclaimerWeight === 'default') {
    if (omitLegacyDisclaimer && !extra && !scope) return null
    return (
      <div className="border-t border-league-border/60 px-4 py-2.5 text-center text-[11px] leading-snug text-league-fg-muted">
        {omitLegacyDisclaimer ? null : <p>{t.disclaimer.short}</p>}
        {extraExperimental ? <p className={omitLegacyDisclaimer ? '' : 'mt-1.5'}>{extraExperimental}</p> : null}
        {extra ? <p className="mt-1.5 font-medium text-league-fg">{extra}</p> : null}
        {scope ? <p className="mt-1 font-medium text-league-fg">{scope}</p> : null}
      </div>
    )
  }

  const prominent = tone.disclaimerWeight === 'prominent'
  if (omitLegacyDisclaimer && !extra && !scope) return null
  return (
    <div
      className={`border-t px-4 py-3 text-center leading-snug border-league-border ${
        prominent ? 'bg-league-accent-soft font-medium text-league-fg' : 'text-league-fg-muted'
      }`}
    >
      {omitLegacyDisclaimer ? null : (
        <p className={prominent ? 'text-xs' : 'text-[11px]'}>{t.disclaimer.long}</p>
      )}
      {extraExperimental ? <p className="mt-1.5 text-[11px]">{extraExperimental}</p> : null}
      {extra ? <p className="mt-1.5 text-[11px] font-medium text-league-fg">{extra}</p> : null}
      {scope ? <p className="mt-1 text-[11px] font-medium text-league-fg">{scope}</p> : null}
    </div>
  )
}
