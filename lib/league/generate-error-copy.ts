/**
 * Localized generate / card failure copy. Gateway refusals already carry a
 * message; this maps the generate-route codes so the hub never shows a bare
 * "문제가 발생했습니다" when a reason code exists.
 */

import { refusalMessageForKey } from './gateway/refusal-copy'

type Copy = { ko: string; en: string }

const GENERATE_COPY: Record<string, Copy> = {
  no_round: {
    ko: '이 질문은 아직 열 수 있는 라운드가 없습니다. 질문을 다시 입력해 주세요.',
    en: 'This question does not have an openable round yet. Please enter the question again.',
  },
  unknown_instrument: {
    ko: '알 수 없는 대상입니다. 질문을 다시 입력해 주세요.',
    en: 'That instrument is not recognized. Please enter the question again.',
  },
  missing_target: {
    ko: '대상이 없습니다. 질문을 다시 입력해 주세요.',
    en: 'A target is missing. Please enter the question again.',
  },
  unknown_horizon: {
    ko: '지원하지 않는 기간입니다. 1일·1주·1개월·3개월 안에서 골라 주세요.',
    en: 'That horizon is not supported. Choose 1 day, 1 week, 1 month, or 3 months.',
  },
  not_public: {
    ko: '이 질문은 지금 공개로 열 수 없습니다.',
    en: 'This question cannot be opened on the public hub.',
  },
  jurisdiction_blocked: {
    ko: '현재 계정 또는 지역에서는 이 질문을 열 수 없습니다.',
    en: 'This question is not available for your account or region.',
  },
  open_failed: {
    ko: '라운드를 열지 못했습니다. 결제는 되지 않았습니다. 잠시 후 다시 시도해 주세요.',
    en: 'The round could not be opened. Nothing was charged. Please try again in a moment.',
  },
  busy: {
    ko: '지금 많은 분들이 이용 중입니다 · 잠시 후 다시 시도해 주세요',
    en: 'A lot of people are using this right now. Please try again in a moment.',
  },
  market_data_unavailable: {
    ko: '시세 데이터를 잠시 가져오지 못했습니다. 결제되지 않았습니다. 잠시 후 다시 시도해 주세요.',
    en: 'Market data was briefly unavailable. Nothing was charged. Please try again in a moment.',
  },
}

const TRY_AGAIN: Copy = {
  ko: '잠시 후 다시 시도해 주세요.',
  en: 'Please try again in a moment.',
}

function loc(locale: string): 'ko' | 'en' {
  return locale === 'ko' ? 'ko' : 'en'
}

export function generateErrorMessage(code: string | undefined, locale: string, status: number): string {
  const language = loc(locale)
  if (code && GENERATE_COPY[code]) return GENERATE_COPY[code][language]
  if (code) {
    const fromGateway = refusalMessageForKey(`league.gateway.refusal.${code}`, locale)
    const unknownFallback = refusalMessageForKey('league.gateway.refusal.low_confidence', locale)
    if (fromGateway && (code === 'low_confidence' || fromGateway !== unknownFallback)) return fromGateway
    return language === 'ko' ? `이 질문은 열 수 없습니다. (${code})` : `This question cannot be opened. (${code})`
  }
  if (status >= 500) return TRY_AGAIN[language]
  return TRY_AGAIN[language]
}

export function tryAgainSoonMessage(locale: string): string {
  return TRY_AGAIN[loc(locale)]
}
