/**
 * Prints the Korean consensus hero (lines 1–2, plus graded comparison + hit record)
 * for two known AAPL rounds — verbatim text, not HTML.
 *
 * Run:
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/render-hero-ko.ts
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fetchCardData } from '../lib/league/card'
import { buildConsensusHero, magnitudeCompareLine } from '../lib/league/compliance'
import { LEAGUE_UI } from '../lib/league/i18n/dictionary'
import { PendingVerdictPanel } from '../components/league/PendingVerdictPanel'
import { VerdictPanel } from '../components/league/VerdictPanel'

const ROUNDS = [
  { id: 'fffc1716-cd3d-45f2-883f-1242a373febc', label: 'graded AAPL fffc1716' },
  { id: 'f3752ddd-a0ca-44ab-9a38-3ae0d590d512', label: 'pending AAPL f3752ddd' },
] as const

const t = LEAGUE_UI.ko

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
}

async function main() {
  for (const { id, label } of ROUNDS) {
    const card = await fetchCardData({ roundId: id })
    const hero = buildConsensusHero(card.consensus, card.round.horizon, t)
    const magnitudeCompare =
      card.consensus.aggregateMagnitudePct !== null && card.round.actualMagnitudePct !== null
        ? magnitudeCompareLine(card.consensus.aggregateMagnitudePct, card.round.actualMagnitudePct, t)
        : null

    console.log(`\n=== ${label} (${id}) ===`)
    console.log(`gradingState: ${card.round.gradingState}`)
    console.log(`aggregateDirection: ${card.consensus.aggregateDirection}`)
    console.log(`aggregateProbability (line 2 confidence): ${card.consensus.aggregateProbability}`)
    console.log(`avgProbability (majority avg — NOT in hero): ${card.consensus.avgProbability}`)
    console.log(`aggregateMagnitudePct (line 1): ${card.consensus.aggregateMagnitudePct}`)
    console.log(`actualMagnitudePct: ${card.round.actualMagnitudePct}`)
    console.log(`tally: up=${card.consensus.tally.up} down=${card.consensus.tally.down} abstain=${card.consensus.tally.abstain}`)

    if (hero?.kind === 'answer') {
      console.log('\n--- hero (verbatim Korean) ---')
      console.log(`Line 1: ${hero.line1}`)
      console.log(`Line 2: ${hero.line2}`)
      if (magnitudeCompare) console.log(`Compare: ${magnitudeCompare}`)
      if (card.verdict.hitRecord.graded > 0) {
        console.log(`Hit record: ${t.verdict.heroHits(card.verdict.hitRecord.hits, card.verdict.hitRecord.graded)}`)
      }
    } else {
      console.log('\n--- hero fallback ---')
      console.log(hero?.message ?? '(no hero)')
    }

    const panelHtml =
      card.verdict.hitRecord.graded > 0
        ? renderToStaticMarkup(
            createElement(VerdictPanel, {
              verdict: card.verdict,
              models: card.models,
              t,
              consensus: card.consensus,
              horizon: card.round.horizon,
              magnitudeCompare:
                card.consensus.aggregateMagnitudePct !== null && card.round.actualMagnitudePct !== null
                  ? { predictedPct: card.consensus.aggregateMagnitudePct, actualPct: card.round.actualMagnitudePct }
                  : null,
            })
          )
        : renderToStaticMarkup(
            createElement(PendingVerdictPanel, {
              round: card.round,
              t,
              locale: 'ko',
              consensus: card.consensus,
            })
          )

    console.log('\n--- panel text (stripped) ---')
    console.log(stripHtml(panelHtml))
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
