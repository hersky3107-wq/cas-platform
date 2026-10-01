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
    ko: '단지·주소·동 단위는 예측하지 않습니다. 공식 지수 예: 강남구, 서울, 금천구.',
    en: 'Named complexes, addresses, and neighborhoods are not predicted. Official indexes: Gangnam-gu, Seoul, Geumcheon-gu.',
  },
  brokerage_advice: {
    ko: '중개·매매 권유에 해당하는 질문은 제공하지 않습니다.',
    en: 'Questions that amount to brokerage advice are not provided.',
  },
  politics_window: {
    ko: '해당 국가의 선거 기간 규정에 따라 지금은 이 질문을 열 수 없습니다.',
    en: 'This question cannot be opened now due to that country’s election-period rules.',
  },
  vague_election: {
    ko: '후보 이름이나 선거를 입력해주세요. 예: 조지아 주지사 / 텍사스 주지사 / 일리노이 상원',
    en: 'Enter a candidate or election. e.g. Georgia governor / Texas governor / Illinois senate',
  },
  past_election: {
    ko: '이미 끝난 선거는 예측할 수 없습니다.',
    en: 'Predictions are only available for elections that have not finished.',
  },
  unsupported_election: {
    ko: '3개월 안에 열리는 예측시장 선거만 열 수 있습니다. 예: 조지아 주지사, 텍사스 주지사, 일리노이 상원',
    en: 'Only elections on the prediction-market slate inside the next 3 months can be opened. e.g. Georgia governor, Texas governor, Illinois senate',
  },
  non_public_fixture: {
    ko: '지원 범위: EPL·챔스·라리가·세리에·NBA·MLB·UFC + 주요 국제대회. 지원하지 않는 경기입니다.',
    en: 'Coverage: EPL, Champions League, La Liga, Serie A, NBA, MLB, UFC, plus major internationals. This fixture is not supported.',
  },
  vague_target: {
    ko: '팀 이름과 상대 팀을 함께 입력해주세요. 예: 토트넘 아스날 / 양키스 레드삭스',
    en: 'Enter a team name and the opponent together. e.g. Tottenham Arsenal / Yankees Red Sox',
  },
  past_event: {
    ko: '예측은 앞으로 열릴 경기만 가능합니다.',
    en: 'Predictions are only available for upcoming games.',
  },
  no_result_source: {
    ko: '결과를 확인할 공식 출처가 없어 이 질문은 열 수 없습니다.',
    en: 'No official source exists to verify the result, so this question cannot be opened.',
  },
  unsupported_entity: {
    ko: '이 카테고리에서 지금 열 수 있는 대상은 아래와 같습니다.',
    en: 'That subject is not in this category’s open list. Pick one of the instruments below.',
  },
  korea_listing: {
    ko: '한국 상장 종목은 한국 계정 또는 한국 접속에서만 열립니다.',
    en: 'Korean listings open only for a Korean account or a Korea connection.',
  },
  korea_stock_lane: {
    ko: '한국 주식은 종목 칩으로 엽니다. 지금은 준비 중입니다.',
    en: 'Korean stocks open from the chip grid. That grid is not ready yet.',
  },
  non_us_listing: {
    ko: '해외 현지 상장 종목은 아직 열 수 없습니다. 미국 상장 ADR(예: TSM, TM, BABA)로 입력하거나, 한국 종목은 한국 레인을 이용해 주세요.',
    en: 'Local non-US listings cannot be opened yet. Enter the US-listed ADR (e.g. TSM, TM, BABA), or use the Korea lane for Korean stocks.',
  },
  prompt_not_available: {
    ko: '이 지역에서는 직접 입력으로 이 카테고리 질문을 열 수 없습니다. 아래 종목 칩을 이용해 주세요.',
    en: 'Typed questions are not available for this category in your region. Please use the instrument chips.',
  },
  registered_country_missing: {
    ko: '등록 국가가 없습니다. 계정에 거주 국가를 등록한 뒤에 이용해 주세요.',
    en: 'Your account has no registered country. Register your country of residence, then try again.',
  },
  country_mismatch: {
    ko: '등록 국가와 접속 국가가 다릅니다. 두 지역 중 더 엄격한 기준을 적용하며, 리그 이용은 가능합니다.',
    en: 'Your registered country and connection country differ. The stricter of the two applies; the league stays available.',
  },
  horizon_incompatible: {
    ko: '이 종목은 선택하신 기간으로는 예측할 수 없습니다. 다른 기간을 선택해 주세요.',
    en: 'This instrument cannot be predicted at the selected horizon. Please pick another horizon.',
  },
  price_or_earnings: {
    ko: '주가·실적 숫자는 기술 카테고리에서 열 수 없습니다. 주식 카테고리에서 예측해 주세요.',
    en: 'Share-price and earnings-number questions cannot be opened here. Use the stocks category.',
  },
  vague_claim: {
    ko: '한 개의 공개 링크로 확인할 수 없는 질문은 열 수 없습니다. 공식 출처·대상·날짜를 특정해 주세요.',
    en: 'A claim that cannot be checked from one published link cannot be opened. Name the official source, the object, and the date.',
  },
  celebrity_private: {
    ko: '사생활·범죄·연애·의료에 관한 질문은 열 수 없습니다. 박스오피스, 차트, 시상식처럼 공식 공개 기록만 예측할 수 있습니다.',
    en: 'Private life, crime, romance, and medical questions cannot be opened. Only official public results — box office, charts, awards — can be predicted.',
  },
  subjective_show: {
    ko: '재밌을까·명작일까·평점은 판정할 수 없습니다. 예: 치이카와 첫 주말 1위 / 뉴진스 멜론 1위 / 올해의 게임',
    en: 'Taste and review scores cannot be graded. Try: Chiikawa opening weekend #1 / NewJeans Melon #1 / Game of the Year.',
  },
  vague_show: {
    ko: '작품과 공식 기준을 함께 입력해 주세요. 예: 치이카와 첫 주말 1위 / 뉴진스 멜론 1위 / 올해의 게임',
    en: 'Name the title and an official metric. e.g. Chiikawa opening weekend #1 / NewJeans Melon #1 / Game of the Year.',
  },
  past_show: {
    ko: '이미 개봉했거나 끝난 시상식은 예측할 수 없습니다.',
    en: 'Predictions are only available for releases and ceremonies that have not finished.',
  },
  unsupported_show: {
    ko: '3개월 안에 결과가 나오는 박스오피스·차트·시상식만 열 수 있습니다. 예: 치이카와 첫 주말 1위, 헝거게임 오프닝 1위, 게임 어워드 올해의 게임.',
    en: 'Only box office, charts, and awards with a result inside 3 months can be opened. e.g. Chiikawa opening #1, Hunger Games opening #1, Game Awards Game of the Year.',
  },
}

/** Clarify prompts + option labels, keyed by full i18n key. */
const CLARIFY_COPY: Record<string, Copy> = {
  'league.gateway.clarify.horizon': {
    ko: '어느 기간의 예측을 원하시나요?',
    en: 'Which horizon do you want the prediction for?',
  },
  'league.gateway.clarify.horizon.stocks': {
    ko: '기간 선택',
    en: 'Select horizon',
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
  'league.gateway.clarify.tech.claim_kind': {
    ko: '어떤 종류의 사실인가요?',
    en: 'What kind of published fact is this?',
  },
  'league.gateway.clarify.tech.object': {
    ko: '어떤 대상에 대한 예측인가요?',
    en: 'What is the named object of the claim?',
  },
  'league.gateway.clarify.tech.artifact': {
    ko: '어떤 공개물로 확인할까요?',
    en: 'Which published artifact will verify the claim?',
  },
  'league.gateway.clarify.tech.venue': {
    ko: '어느 공식 출처에서 확인할까요?',
    en: 'Which official venue will host the artifact?',
  },
  'league.gateway.clarify.tech.resolve_by': {
    ko: '언제까지의 공개를 예측하나요?',
    en: 'By which date must the artifact be published?',
  },
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
