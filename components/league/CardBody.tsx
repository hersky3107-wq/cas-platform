import type { CardData } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import { toneFor } from '@/lib/league/tone'
import type { ComplianceReceipt } from './CardCompliance'
import { CardHeader } from './CardHeader'
import { ConsensusHeadline } from './ConsensusHeadline'
import { DivisionBoard } from './DivisionBoard'

/**
 * The actual prediction content (header, division board, final verdict).
 *
 * Do NOT render this outside `<CardCompliance>`. That is not just a
 * convention: `receipt` is typed as `ComplianceReceipt`, whose brand symbol
 * is private to `CardCompliance.tsx`, so no caller outside that file can
 * construct a valid one — see the comment block there for the full
 * explanation. `receipt` carries no runtime information; it exists purely to
 * make that guarantee visible in this component's signature.
 *
 * `t` (Layer A chrome pack) only affects labels/templates rendered below —
 * `data` (predictions) is passed through unchanged regardless of locale.
 */
export function CardBody({ data, receipt, t }: { data: CardData; receipt: ComplianceReceipt; t: LeagueUiPack }) {
  void receipt
  const tone = toneFor(data.round.color_bucket)
  return (
    <>
      <CardHeader round={data.round} hitRate={data.hitRate} tone={tone} t={t} />
      <DivisionBoard models={data.models} tierSplit={data.tierSplit} t={t} />
      {data.hitRate.graded > 0 ? (
        <p className="border-t border-league-border/50 px-3 py-2 text-[10px] leading-snug text-league-fg-muted md:px-4">
          {t.bracket.resultLegend}
        </p>
      ) : null}
      <ConsensusHeadline
        consensus={data.consensus}
        combinedTrack={data.combinedTrack}
        tone={tone}
        t={t}
        variant="verdict"
      />
    </>
  )
}
