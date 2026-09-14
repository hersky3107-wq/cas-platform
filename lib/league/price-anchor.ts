import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { fetchDataPacket, sessionDateForPrice } from '@/lib/league/market-data'
import {
  decidePriceAnchorGate,
  hasUsableAnchor,
  propositionNeedsPriceAnchor,
  type PriceAnchorFacts,
} from '@/lib/league/price-anchor-policy'

export type ObtainableAnchor =
  | { ok: true; price: number; sessionDate: string | null }
  | { ok: false; error: string }

export type EnsurePriceAnchorResult =
  | { ok: true; needed: false }
  | { ok: true; needed: true; source: 'existing' | 'fetched' }
  | { ok: false; code: 'market_data_unavailable'; error?: string }
  | { ok: false; code: 'round_not_found' }

/**
 * Write-once persist. Returns true only after a re-read shows a usable
 * `anchor_price` — a swallowed update must not be treated as success, or
 * the generate route would charge a still-unanchored price round.
 */
export async function persistAnchorPrice(
  roundId: string,
  price: number,
  sessionDate: string | null
): Promise<boolean> {
  if (!hasUsableAnchor(price)) return false
  try {
    const { error } = await supabaseAdmin
      .from('prediction_rounds')
      .update({
        anchor_price: price,
        anchor_price_at: new Date().toISOString(),
        ...(sessionDate ? { anchor_session_date: sessionDate } : {}),
      })
      .eq('id', roundId)
      .is('anchor_price', null)
    if (error) return false
    const { data } = await supabaseAdmin
      .from('prediction_rounds')
      .select('anchor_price')
      .eq('id', roundId)
      .maybeSingle()
    return hasUsableAnchor((data as { anchor_price: number | null } | null)?.anchor_price)
  } catch {
    return false
  }
}

export async function probeObtainablePriceAnchor(instrument: string): Promise<ObtainableAnchor> {
  const packet = await fetchDataPacket(instrument)
  if (!packet.available || !hasUsableAnchor(packet.latestClose)) {
    return { ok: false, error: packet.error ?? 'TWELVE_DATA_UNAVAILABLE' }
  }
  return {
    ok: true,
    price: packet.latestClose!,
    sessionDate: sessionDateForPrice(packet, packet.latestClose!),
  }
}

export async function loadRoundPriceAnchorFacts(roundId: string): Promise<PriceAnchorFacts | null> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('proposition_kind, anchor_price')
    .eq('id', roundId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { proposition_kind: string | null; anchor_price: number | null }
  return { propositionKind: row.proposition_kind, anchorPrice: row.anchor_price }
}

/**
 * Runner safety net: persisted facts only. Does not fetch. A job with no
 * usable close-higher anchor must fail-and-refund, not fan out.
 */
export async function runnerPriceAnchorGate(roundId: string): Promise<'proceed' | 'fail'> {
  const facts = await loadRoundPriceAnchorFacts(roundId)
  if (!facts) return 'fail'
  return decidePriceAnchorGate(facts).action
}

/**
 * Obtain and persist the open-time anchor for a price round, or skip when
 * the contract does not need one. Callers that are about to charge MUST
 * treat `{ ok: false }` as a hard refuse.
 *
 * If the round already has model rows and still no anchor, we refuse to
 * invent a late baseline — that round cannot be graded honestly.
 */
export async function ensurePriceRoundAnchor(roundId: string): Promise<EnsurePriceAnchorResult> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, instrument, proposition_kind, anchor_price')
    .eq('id', roundId)
    .maybeSingle()
  if (error || !data) return { ok: false, code: 'round_not_found' }

  const row = data as {
    id: string
    instrument: string
    proposition_kind: string | null
    anchor_price: number | null
  }

  if (!propositionNeedsPriceAnchor(row.proposition_kind)) return { ok: true, needed: false }
  if (hasUsableAnchor(row.anchor_price)) return { ok: true, needed: true, source: 'existing' }

  const { count, error: countError } = await supabaseAdmin
    .from('model_predictions')
    .select('id', { count: 'exact', head: true })
    .eq('round_id', roundId)
  if (countError) return { ok: false, code: 'market_data_unavailable', error: countError.message }
  if ((count ?? 0) > 0) {
    return { ok: false, code: 'market_data_unavailable', error: 'missing_anchor_after_generation' }
  }

  const probed = await probeObtainablePriceAnchor(row.instrument)
  if (!probed.ok) return { ok: false, code: 'market_data_unavailable', error: probed.error }

  const persisted = await persistAnchorPrice(roundId, probed.price, probed.sessionDate)
  if (!persisted) return { ok: false, code: 'market_data_unavailable', error: 'anchor_persist_failed' }
  return { ok: true, needed: true, source: 'fetched' }
}
