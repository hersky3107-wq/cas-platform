import { consensusHeadline } from '@/lib/league/compliance'
import type { ConsensusSummary } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import type { ToneTokens } from '@/lib/league/tone'

/**
 * Renders the ONE approved consensus sentence (e.g. "6 of 8 AI models lean
 * UP · 58% avg confidence", or its translation via `t`). The sentence itself
 * comes from `lib/league/compliance.ts` — this component only lays it out; it
 * must never assemble directional wording on its own.
 */
export function ConsensusHeadline({ consensus, tone, t }: { consensus: ConsensusSummary; tone: ToneTokens; t: LeagueUiPack }) {
  const headline = consensusHeadline(consensus, t)
  return (
    <div className="px-4 py-2">
      <p className={`font-bold leading-snug text-league-fg ${tone.emphasizeProbability ? 'text-lg' : 'text-base'}`}>
        {headline}
      </p>
    </div>
  )
}
