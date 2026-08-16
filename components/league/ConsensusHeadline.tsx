import { consensusHeadline } from '@/lib/league/compliance'
import type { ConsensusSummary } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { ToneTokens } from '@/lib/league/tone'

/**
 * Renders the ONE approved consensus sentence (e.g. "6 of 8 AI models lean
 * UP · 58% avg confidence", or its translation via `t`). The sentence itself
 * comes from `lib/league/compliance.ts` — this component only lays it out; it
 * must never assemble directional wording on its own.
 *
 * `variant="verdict"` is the Cards-tab money shot at the bottom of the board.
 * Same sentence, denser scoreboard chrome. The disclaimer still lives in
 * `CardCompliance` immediately below this panel.
 */
export function ConsensusHeadline({
  consensus,
  tone,
  t,
  variant = 'inline',
}: {
  consensus: ConsensusSummary
  tone: ToneTokens
  t: LeagueUiPack
  variant?: 'inline' | 'verdict'
}) {
  const headline = consensusHeadline(consensus, t)
  const tally = t.bracket.compactTally(consensus.tally)

  if (variant === 'verdict') {
    return (
      <div className="mx-2 mb-3 mt-1 rounded-xl border border-league-accent bg-league-accent-soft px-4 py-4 md:mx-3 md:px-5 md:py-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-league-accent-strong">
          {t.bracket.finalVerdict}
        </p>
        <p
          className={`mt-1.5 font-bold leading-snug text-league-fg ${
            tone.emphasizeProbability ? 'text-xl md:text-2xl' : 'text-lg md:text-xl'
          }`}
        >
          {headline}
        </p>
        <p className="mt-2 font-mono text-sm font-semibold tabular-nums text-league-accent-strong">{tally}</p>
      </div>
    )
  }

  return (
    <div className="px-4 py-2">
      <p className={`font-bold leading-snug text-league-fg ${tone.emphasizeProbability ? 'text-lg' : 'text-base'}`}>
        {headline}
      </p>
    </div>
  )
}
