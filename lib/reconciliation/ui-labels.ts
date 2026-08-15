/**
 * 대사기 (Reconciliation) UI strings — Stage 1, transfer-only slice.
 *
 * Mirrors the repo's ui-labels pattern (see lib/synod/ui-labels.ts,
 * lib/jeju/ui-labels.ts): a Locale union, a flat UiPack of strings, a
 * `getReconciliationUiPack(locale)` lookup, and `normalizeReconciliationLocale`
 * to resolve `navigator.language` → a supported locale (English fallback).
 *
 * Kept to two locales (en/ko) for this Stage-1 slice — deliberately NOT the
 * full 8-locale JEJU_LOCALES set, since this feature has no Korean-primary
 * requirement. Add locales here, not by inlining strings in components.
 *
 * No client module — this file has no 'server-only' import and no server-only
 * dependency, so app/reconciliation/page.tsx can import it directly.
 */

export const RECONCILIATION_LOCALES = ['en', 'ko'] as const
export type ReconciliationLocale = (typeof RECONCILIATION_LOCALES)[number]

export type ReconciliationUiPack = {
  pageTitle: string
  pageTagline: string
  signInRequiredTitle: string
  signInRequiredBody: string
  checkingSessionMsg: string
  setupChannelMsg: string

  saleSectionTitle: string
  saleDateLabel: string
  saleAmountLabel: string
  saleSubmitBtn: string
  saleSubmittingBtn: string
  saleListEmptyMsg: string
  saleListTitle: string

  depositSectionTitle: string
  depositTextLabel: string
  depositTextPlaceholder: string
  depositParseBtn: string
  depositParsingBtn: string
  depositParsedMsg: string
  depositParseFailedMsg: string

  reviewSectionTitle: string
  reviewTagline: string
  reviewEmptyMsg: string
  reviewDateLabel: string
  reviewAmountLabel: string
  reviewConfidenceLabel: string
  reviewLowConfidenceBadge: string
  reviewConfirmBtn: string
  reviewSaveEditBtn: string
  reviewSavingBtn: string

  reconcileBtn: string
  reconcileRunningBtn: string
  reconcileSummaryTitle: string
  reconcileNothingMsg: string

  resultsSectionTitle: string
  resultsEmptyMsg: string
  statusMatched: string
  statusMissingDeposit: string
  statusAmountMismatch: string
  statusOther: string
  discrepancyLabel: string
  matchesCountLabel: string
  refreshBtn: string
  errorPrefix: string
}

const en: ReconciliationUiPack = {
  pageTitle: 'Reconciliation — Bank Transfer (Stage 1)',
  pageTagline: 'Paste a sale and a deposit alert, then reconcile them. Transfer channel only.',
  signInRequiredTitle: 'Sign-in required',
  signInRequiredBody: 'Sign in elsewhere, then return to this page.',
  checkingSessionMsg: 'Checking session…',
  setupChannelMsg: 'Setting up the transfer channel…',

  saleSectionTitle: '1. Record a sale',
  saleDateLabel: 'Sale date',
  saleAmountLabel: 'Gross amount (KRW)',
  saleSubmitBtn: 'Add sale',
  saleSubmittingBtn: 'Adding…',
  saleListEmptyMsg: 'No sales yet.',
  saleListTitle: 'Sales',

  depositSectionTitle: '2. Paste a deposit-alert message',
  depositTextLabel: 'Deposit alert text',
  depositTextPlaceholder: 'Paste the bank deposit-alert message here…',
  depositParseBtn: 'Parse deposit',
  depositParsingBtn: 'Parsing…',
  depositParsedMsg: 'Parsed deposit',
  depositParseFailedMsg: 'Could not extract a date and amount from that text.',

  reviewSectionTitle: '3. Review parsed deposits',
  reviewTagline: 'Confirm or correct AI-parsed values before reconciling.',
  reviewEmptyMsg: 'No deposits awaiting review.',
  reviewDateLabel: 'Date',
  reviewAmountLabel: 'Amount (KRW)',
  reviewConfidenceLabel: 'Confidence',
  reviewLowConfidenceBadge: 'LOW CONFIDENCE',
  reviewConfirmBtn: 'Confirm as-is',
  reviewSaveEditBtn: 'Save edit',
  reviewSavingBtn: 'Saving…',

  reconcileBtn: 'Run reconciliation',
  reconcileRunningBtn: 'Reconciling…',
  reconcileSummaryTitle: 'Last run',
  reconcileNothingMsg: 'Nothing new to reconcile.',

  resultsSectionTitle: '4. Results',
  resultsEmptyMsg: 'No reconciliations yet.',
  statusMatched: 'Matched',
  statusMissingDeposit: 'Missing deposit',
  statusAmountMismatch: 'Amount mismatch',
  statusOther: 'Other',
  discrepancyLabel: 'Discrepancy',
  matchesCountLabel: 'linked rows',
  refreshBtn: 'Refresh',
  errorPrefix: 'Error',
}

const ko: ReconciliationUiPack = {
  pageTitle: '대사 — 계좌이체 (1단계)',
  pageTagline: '판매 내역과 입금 알림을 입력하면 자동으로 대사합니다. 계좌이체 채널만 지원합니다.',
  signInRequiredTitle: '로그인이 필요합니다',
  signInRequiredBody: '다른 곳에서 로그인한 뒤 이 페이지로 돌아와 주세요.',
  checkingSessionMsg: '세션 확인 중…',
  setupChannelMsg: '이체 채널 준비 중…',

  saleSectionTitle: '1. 판매 등록',
  saleDateLabel: '판매일',
  saleAmountLabel: '판매 금액(원)',
  saleSubmitBtn: '판매 추가',
  saleSubmittingBtn: '추가 중…',
  saleListEmptyMsg: '등록된 판매 내역이 없습니다.',
  saleListTitle: '판매 내역',

  depositSectionTitle: '2. 입금 알림 문자 붙여넣기',
  depositTextLabel: '입금 알림 문자',
  depositTextPlaceholder: '은행 입금 알림 문자를 여기에 붙여넣으세요…',
  depositParseBtn: '입금 분석',
  depositParsingBtn: '분석 중…',
  depositParsedMsg: '입금 분석 완료',
  depositParseFailedMsg: '해당 문자에서 날짜와 금액을 추출할 수 없습니다.',

  reviewSectionTitle: '3. 분석된 입금 확인',
  reviewTagline: '대사 전에 AI가 분석한 값을 확인하거나 수정하세요.',
  reviewEmptyMsg: '확인이 필요한 입금 내역이 없습니다.',
  reviewDateLabel: '날짜',
  reviewAmountLabel: '금액(원)',
  reviewConfidenceLabel: '신뢰도',
  reviewLowConfidenceBadge: '신뢰도 낮음',
  reviewConfirmBtn: '그대로 확인',
  reviewSaveEditBtn: '수정 저장',
  reviewSavingBtn: '저장 중…',

  reconcileBtn: '대사 실행',
  reconcileRunningBtn: '대사 중…',
  reconcileSummaryTitle: '최근 실행 결과',
  reconcileNothingMsg: '새로 대사할 내역이 없습니다.',

  resultsSectionTitle: '4. 결과',
  resultsEmptyMsg: '아직 대사 결과가 없습니다.',
  statusMatched: '일치',
  statusMissingDeposit: '입금 누락',
  statusAmountMismatch: '금액 불일치',
  statusOther: '기타',
  discrepancyLabel: '차액',
  matchesCountLabel: '연결된 항목',
  refreshBtn: '새로고침',
  errorPrefix: '오류',
}

const PACKS: Record<ReconciliationLocale, ReconciliationUiPack> = { en, ko }

export function normalizeReconciliationLocale(
  uiLocale: string | null | undefined
): ReconciliationLocale {
  if (!uiLocale) return 'en'
  const raw = uiLocale.trim().toLowerCase()
  if (raw.startsWith('ko')) return 'ko'
  return 'en'
}

export function getReconciliationUiPack(locale: ReconciliationLocale): ReconciliationUiPack {
  return PACKS[locale] ?? en
}
