import type { RefusalCode } from './types'

/**
 * Gateway refusal + clarify copy (pure data).
 *
 * Keyed by i18n key so adapters stay copy-free: an adapter declares
 * `message_i18n_key` per refusal code; the shell resolves the localized
 * string here. Korean is the primary product language; English is the
 * fallback. When the freeform UI ships, these keys fold into the main
 * `LeagueUiPack` dictionary — until then this module keeps the gateway
 * self-contained and server-side testable.
 *
 * COMPLIANCE: every string below is served verbatim to users. No investment
 * advice, no banned framing (see `lib/league/compliance.ts`), no echo of
 * user input — refusal copy is 100% server-authored.
 */

export type GatewayLocale = 'ko' | 'en'

type Copy = { ko: string; en: string }

/** Canonical i18n key for a refusal code. */
export function refusalMessageKey(code: RefusalCode): string {
  return `league.gateway.refusal.${code}`
}

const REFUSAL_COPY: Record<RefusalCode, Copy> = {
  jurisdiction_blocked: {
    ko: '현재 계정 또는 지역에서는 이 카테고리를 이용할 수 없습니다.',
    en: 'This category is not available for your account or region.',
  },
  election_blackout: {
    ko: '선거 기간에는 이 카테고리의 예측을 열 수 없습니다.',
    en: 'Predictions in this category are paused during the election period.',
  },
  category_unavailable: {
    ko: '이 카테고리는 아직 준비 중입니다. 다른 카테고리를 이용해 주세요.',
    en: 'This category is not open yet. Please try another category.',
  },
  low_confidence: {
    ko: '이 질문은 열 수 없습니다. 종목과 기간을 넣어 더 구체적으로 다시 입력해 주세요.',
    en: 'This question could not be opened. Please retry with a specific instrument and horizon.',
  },
  ambiguous_entity: {
    ko: '어떤 대상을 말씀하시는지 분명하지 않습니다. 아래 선택지에서 골라 주세요.',
    en: 'The target is ambiguous. Please pick one of the candidates below.',
  },
  missing_slot: {
    ko: '예측을 열기에 필요한 정보가 부족합니다. 다시 입력해 주세요.',
    en: 'Required details are missing. Please try again.',
  },
  ungradeable: {
    ko: '이 질문은 결과를 객관적으로 판정할 수 없어 열 수 없습니다.',
    en: 'This question cannot be graded objectively, so it cannot be opened.',
  },
  insufficient_credits: {
    ko: '크레딧이 부족합니다. 충전 후 다시 시도해 주세요.',
    en: 'Not enough credits. Please top up and try again.',
  },
  betting_framing: {
    ko: '베팅·도박성 표현이 포함된 질문은 열 수 없습니다. 정보성 예측 질문으로 다시 입력해 주세요.',
    en: 'Questions framed around betting cannot be opened. Please rephrase as an informational prediction.',
  },
  specific_property: {
    ko: '특정 부동산(주소·매물)에 대한 가치 판단은 제공하지 않습니다.',
    en: 'Valuations of specific properties are not provided.',
  },
  brokerage_advice: {
    ko: '중개·매매 권유에 해당하는 질문은 제공하지 않습니다.',
    en: 'Questions that amount to brokerage advice are not provided.',
  },
  politics_window: {
    ko: '해당 국가의 선거 기간 규정에 따라 지금은 이 질문을 열 수 없습니다.',
    en: 'This question cannot be opened now due to that country’s election-period rules.',
  },
  non_public_fixture: {
    ko: '공식 일정에서 확인되지 않는 경기는 열 수 없습니다.',
    en: 'Fixtures not confirmed on an official schedule cannot be opened.',
  },
  no_result_source: {
    ko: '결과를 확인할 공식 출처가 없어 이 질문은 열 수 없습니다.',
    en: 'No official source exists to verify the result, so this question cannot be opened.',
  },
  unsupported_entity: {
    ko: '지원하지 않는 종목입니다. 현재 카탈로그에 있는 종목만 예측할 수 있습니다.',
    en: 'This instrument is not supported. Only instruments in the current catalog can be predicted.',
  },
  horizon_incompatible: {
    ko: '이 종목은 선택하신 기간으로는 예측할 수 없습니다. 다른 기간을 선택해 주세요.',
    en: 'This instrument cannot be predicted at the selected horizon. Please pick another horizon.',
  },
}

/** Clarify prompts + option labels, keyed by full i18n key. */
const CLARIFY_COPY: Record<string, Copy> = {
  'league.gateway.clarify.horizon': {
    ko: '어느 기간의 예측을 원하시나요?',
    en: 'Which horizon do you want the prediction for?',
  },
  'league.gateway.clarify.entity': {
    ko: '어떤 종목을 말씀하시나요?',
    en: 'Which instrument do you mean?',
  },
  'league.gateway.clarify.confirm_entity': {
    ko: '이 종목이 맞는지 확인해 주세요.',
    en: 'Please confirm this is the instrument you meant.',
  },
  'league.gateway.clarify.option.confirm_yes': {
    ko: '네, 맞아요',
    en: 'Yes, that’s right',
  },
  'league.gateway.horizon.1d': { ko: '1일', en: '1 day' },
  'league.gateway.horizon.1w': { ko: '1주', en: '1 week' },
  'league.gateway.horizon.1m': { ko: '1개월', en: '1 month' },
  'league.gateway.horizon.3m': { ko: '3개월', en: '3 months' },
}

export function resolveGatewayLocale(locale: string): GatewayLocale {
  return locale === 'ko' ? 'ko' : 'en'
}

/** Localized refusal message for an i18n key produced by `refusalMessageKey`. */
export function refusalMessageForKey(key: string, locale: string): string {
  const code = key.startsWith('league.gateway.refusal.')
    ? (key.slice('league.gateway.refusal.'.length) as RefusalCode)
    : null
  const copy = code ? REFUSAL_COPY[code] : undefined
  if (!copy) return REFUSAL_COPY.low_confidence[resolveGatewayLocale(locale)]
  return copy[resolveGatewayLocale(locale)]
}

/** Localized clarify prompt / option label; '' when the key is unknown (UI hides it). */
export function clarifyCopyForKey(key: string, locale: string): string {
  const copy = CLARIFY_COPY[key]
  return copy ? copy[resolveGatewayLocale(locale)] : ''
}
