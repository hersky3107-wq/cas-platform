/**
 * Admin generate — fill proposition_kind / subject_label / observation_shape
 * from the adapter's compose output. The caller cannot type those fields
 * into existence; a mismatch with the adapter is a 400, not a persist.
 *
 * Pure: the adapter is a parameter so tests do not import server-only.
 */

import type { CategoryAdapter, PacketRound, PropositionKind } from './types'
import { isObservationShape, type ObservationShape } from '../observation-shape'
import { isPropositionKind } from '../answer-contract'

export type HydratableRoundInput = {
  proposition_text: string
  category: string
  instrument: string
  horizon: string
  resolution_rule: string
  resolves_at: string
  item_type?: 'ranked' | 'on_demand'
  season_id?: string | null
  cache_key?: string | null
  proposition_kind?: string
  subject_label?: string | null
  observation_shape?: string | null
}

export type HydrateOk = { ok: true; input: HydratableRoundInput }
export type HydrateFail = { ok: false; error: string }
export type HydrateResult = HydrateOk | HydrateFail

function fail(error: string): HydrateFail {
  return { ok: false, error }
}

function callerKind(raw: HydratableRoundInput): string | undefined {
  return typeof raw.proposition_kind === 'string' && raw.proposition_kind.length > 0
    ? raw.proposition_kind
    : undefined
}

function callerLabel(raw: HydratableRoundInput): string | undefined {
  return typeof raw.subject_label === 'string' && raw.subject_label.length > 0
    ? raw.subject_label
    : undefined
}

function callerShape(raw: HydratableRoundInput): string | undefined {
  return typeof raw.observation_shape === 'string' && raw.observation_shape.length > 0
    ? raw.observation_shape
    : undefined
}

/**
 * When `adapter` is null the row stays as the caller wrote it, except a
 * forced non-price kind is refused (there is no adapter to declare one).
 */
export function applyAdapterComposeToRoundInput(
  raw: HydratableRoundInput,
  adapter: CategoryAdapter | null,
  now: Date = new Date(),
): HydrateResult {
  if (!adapter) {
    if (callerKind(raw) && callerKind(raw) !== 'binary_close_higher') {
      return fail('proposition_kind does not match the adapter for this category')
    }
    if (callerShape(raw)) {
      return fail('observation_shape does not match the adapter for this category')
    }
    return { ok: true, input: raw }
  }

  const seed: PacketRound = {
    proposition_text: raw.proposition_text,
    category: raw.category,
    instrument: raw.instrument,
    horizon: raw.horizon,
    resolution_rule: raw.resolution_rule,
    resolves_at: raw.resolves_at,
  }
  const slots = adapter.slotsForRound(seed)

  if (!adapter.isDecidable(slots)) {
    if (adapter.observation_shape === 'occurrence' || adapter.ledger_category === 'tech') {
      return fail('adapter cannot compose a decidable proposition from this instrument')
    }
    if (callerKind(raw) && callerKind(raw) !== 'binary_close_higher') {
      return fail('proposition_kind does not match the adapter for this category')
    }
    if (callerShape(raw)) {
      return fail('observation_shape does not match the adapter for this category')
    }
    return { ok: true, input: raw }
  }

  const composed = adapter.composeProposition(slots, now)
  const kind: PropositionKind = composed.proposition_kind ?? slots.proposition_kind
  if (!isPropositionKind(kind)) {
    return fail('adapter compose produced an unknown proposition_kind')
  }
  if (callerKind(raw) && callerKind(raw) !== kind) {
    return fail('proposition_kind does not match the adapter for this category')
  }

  const subject = composed.subject_label ?? null
  if (callerLabel(raw) && callerLabel(raw) !== subject) {
    return fail('subject_label does not match the adapter compose output')
  }

  const shape: ObservationShape | null = composed.observation_shape ?? adapter.observation_shape
  if (shape != null && !isObservationShape(shape)) {
    return fail('adapter compose produced an unknown observation_shape')
  }
  if (callerShape(raw)) {
    if (shape == null || callerShape(raw) !== shape) {
      return fail('observation_shape does not match the adapter for this category')
    }
  }

  return {
    ok: true,
    input: {
      ...raw,
      proposition_text: composed.proposition_text,
      category: composed.category,
      instrument: composed.instrument,
      horizon: composed.horizon,
      resolution_rule: composed.resolution_rule,
      resolves_at: composed.resolves_at,
      cache_key: composed.cache_key,
      proposition_kind: kind,
      subject_label: subject,
      observation_shape: shape,
    },
  }
}
