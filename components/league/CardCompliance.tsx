'use client'

import type { ReactNode } from 'react'
import type { ColorBucket } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import { toneFor } from '@/lib/league/tone'
import { DisclaimerFooter } from './DisclaimerFooter'

/**
 * AI Prediction League — REGULATORY / COMPLIANCE LAYER (Layer 2), the wrapper.
 *
 * WHY THIS IS A HARD BOUNDARY, NOT A CONVENTION (regulatory lifeline):
 * A prediction card that ever renders without its disclaimer, or that lets
 * a component slip in buy/sell/odds language, is a legal liability — see
 * `lib/league/compliance.ts` for the full rationale. "Please remember to
 * render the disclaimer" is not good enough; a future contributor WILL
 * forget. So this file makes it structurally impossible to render card
 * content any other way:
 *
 *   1. `CardBody` (the actual prediction content) requires a `receipt` prop
 *      of type `ComplianceReceipt`.
 *   2. `ComplianceReceipt` is branded with a real runtime `Symbol()` that is
 *      created and used ONLY in this file, and never exported (a `declare
 *      const ... unique symbol` would be erased at compile time with no
 *      runtime value to key the object with — this MUST be a real `Symbol()`
 *      call). TypeScript's structural typing means `{ ...some object... }`
 *      can normally satisfy any shape — but nothing outside this module can
 *      construct a value keyed by a symbol it has no reference to. There is
 *      therefore no way to call `CardBody` with a fabricated receipt from
 *      outside this file.
 *   3. The only value of that type in existence is created inside
 *      `CardCompliance`'s render body and handed to `children` as a plain
 *      function argument (a render-prop) — i.e. the only way to obtain one
 *      is to already be rendering inside `CardCompliance`, which has, by
 *      that point, ALSO rendered `<DisclaimerFooter>` in the same tree.
 *
 * Net effect: `grep`-ing for `CardBody(` anywhere that isn't inside a
 * `<CardCompliance>` render-prop will fail to type-check. There is no code
 * path that renders prediction content without the disclaimer.
 */
const COMPLIANCE_BRAND = Symbol('league-card-compliance-receipt')
export type ComplianceReceipt = { readonly [COMPLIANCE_BRAND]: true }
const RECEIPT: ComplianceReceipt = { [COMPLIANCE_BRAND]: true }

export type CardComplianceProps = {
  colorBucket: ColorBucket
  /** Locale chrome pack (Layer A) — only used here to render the disclaimer in the current language; never affects whether/what disclaimer renders. */
  t: LeagueUiPack
  /** Render-prop: receives the receipt that unlocks `CardBody`. */
  children: (receipt: ComplianceReceipt) => ReactNode
}

export function CardCompliance({ colorBucket, t, children }: CardComplianceProps) {
  const tone = toneFor(colorBucket)
  return (
    <div
      data-league-tone={tone.dataAttr}
      className="flex flex-col overflow-hidden rounded-2xl border border-league-border bg-league-bg text-league-fg"
    >
      {children(RECEIPT)}
      <DisclaimerFooter tone={tone} t={t} />
    </div>
  )
}
