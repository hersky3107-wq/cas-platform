/**
 * 대사기 (Reconciliation) UI strings — manual sales + transfer reconciliation.
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
  saleDiscountLabel: string
  saleDiscountHint: string
  saleKindLabel: string
  saleKindCard: string
  saleKindAppVoucher: string
  saleKindPaperVoucher: string
  saleKindManualTotal: string
  saleKindCash: string
  saleKindHelper: string
  saleSubmitBtn: string
  saleSubmittingBtn: string
  saleCreatedMsg: string
  saleListEmptyMsg: string
  saleListTitle: string
  saleExemptBadge: string
  salePaperVoucherPendingBadge: string
  salePaperVoucherHint: string
  saleDeleteBtn: string
  saleDeleteConfirmBtn: string
  saleDeleteCancelBtn: string
  saleDeletingBtn: string
  saleImageLabel: string
  saleImageHint: string
  saleImageParsingBtn: string
  saleImageParsedMsg: string
  saleKindGuessBadge: string
  saleKindUnknownBadge: string

  depositSectionTitle: string
  depositTextLabel: string
  depositTextPlaceholder: string
  depositParseBtn: string
  depositParsingBtn: string
  depositParsedMsg: string
  depositParseFailedMsg: string
  depositImageLabel: string
  depositImageHint: string
  depositImageBtn: string
  depositImageParsingBtn: string

  spreadsheetSectionTitle: string
  spreadsheetKindLabel: string
  spreadsheetKindDeposits: string
  spreadsheetKindSales: string
  spreadsheetHint: string
  spreadsheetBtn: string
  spreadsheetParsingBtn: string
  spreadsheetParsedMsg: string
  spreadsheetNeedsReviewLabel: string
  spreadsheetFailedLabel: string
  spreadsheetCapHint: string

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
  reconcilePassTransfer: string
  reconcilePassCard: string
  reconcilePassAppVoucher: string

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

  advisoryCardTitle: string
  advisoryConsensusLabel: string
  advisoryConfidenceLabel: string
  advisoryAgreementLabel: string
  advisoryPerModelTitle: string
  advisoryConfidenceHigh: string
  advisoryConfidenceMedium: string
  advisoryConfidenceLow: string
}

const en: ReconciliationUiPack = {
  pageTitle: 'Reconciliation — Manual sales entry',
  pageTagline: 'Record sales manually, review deposit alerts, and run supported reconciliation channels.',
  signInRequiredTitle: 'Sign-in required',
  signInRequiredBody: 'Sign in elsewhere, then return to this page.',
  checkingSessionMsg: 'Checking session…',
  setupChannelMsg: 'Setting up the transfer channel…',

  saleSectionTitle: '1. Record a sale',
  saleDateLabel: 'Sale date',
  saleAmountLabel: 'Amount charged (KRW)',
  saleDiscountLabel: 'Discount (KRW)',
  saleDiscountHint: 'Optional. Reporting only — not used for expected net or matching.',
  saleKindLabel: 'Sale kind',
  saleKindCard: 'Card sale',
  saleKindAppVoucher: 'Barcode / app sale',
  saleKindPaperVoucher: 'Paper voucher',
  saleKindManualTotal: 'Manual total',
  saleKindCash: 'Cash sale',
  saleKindHelper:
    'If the receipt shows a card issuer, classify it as a card sale. If paid with a Tamna Jeon or Onnuri app barcode, classify it as a barcode/app sale. If you received a paper gift voucher, classify it as a paper voucher.',
  saleSubmitBtn: 'Add sale',
  saleSubmittingBtn: 'Adding…',
  saleCreatedMsg: 'Sale created',
  saleListEmptyMsg: 'No sales yet.',
  saleListTitle: 'Sales',
  saleExemptBadge: 'Complete (no reconcile)',
  salePaperVoucherPendingBadge: 'Awaiting bank deposit',
  salePaperVoucherHint:
    'Paper vouchers credit from the day they are banked (Onnuri same day, Tamna Jeon 2–3 days).',
  saleDeleteBtn: 'Delete',
  saleDeleteConfirmBtn: 'Confirm delete',
  saleDeleteCancelBtn: 'Cancel',
  saleDeletingBtn: 'Deleting…',
  saleImageLabel: 'Or upload a receipt / POS screenshot',
  saleImageHint:
    'Photo of a paper receipt or POS screen. Vision cannot reliably tell card vs cash — you must confirm the sale kind.',
  saleImageParsingBtn: 'Reading receipt…',
  saleImageParsedMsg: 'Parsed sale from photo',
  saleKindGuessBadge: 'KIND GUESSED — CONFIRM',
  saleKindUnknownBadge: 'KIND UNKNOWN — SET IT',

  depositSectionTitle: '2. Paste a deposit-alert message',
  depositTextLabel: 'Deposit alert text',
  depositTextPlaceholder: 'Paste the bank deposit-alert message here…',
  depositParseBtn: 'Parse deposit',
  depositParsingBtn: 'Parsing…',
  depositParsedMsg: 'Parsed deposit',
  depositParseFailedMsg: 'Could not extract a date and amount from that text.',
  depositImageLabel: 'Or upload a deposit screenshot',
  depositImageHint: 'Photo of a bank deposit alert or passbook. Vision is unreliable — you must confirm the values.',
  depositImageBtn: 'Parse photo',
  depositImageParsingBtn: 'Reading photo…',

  spreadsheetSectionTitle: 'Spreadsheet import (Excel/CSV)',
  spreadsheetKindLabel: 'This file is',
  spreadsheetKindDeposits: 'Deposits',
  spreadsheetKindSales: 'Sales',
  spreadsheetHint:
    'One POS or hand-kept sheet, many rows. Columns are mapped automatically — confirm low-confidence rows before reconciling. Max 300 data rows. Nothing is auto-reconciled.',
  spreadsheetBtn: 'Parse spreadsheet',
  spreadsheetParsingBtn: 'Reading spreadsheet…',
  spreadsheetParsedMsg: 'Imported',
  spreadsheetNeedsReviewLabel: 'need review',
  spreadsheetFailedLabel: 'could not parse',
  spreadsheetCapHint: 'Max 300 data rows per upload.',

  reviewSectionTitle: '3. Review parsed deposits',
  reviewTagline: 'Confirm or correct pending sales and deposits before reconciling.',
  reviewEmptyMsg: 'No rows awaiting review.',
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
  reconcilePassTransfer: 'Transfer',
  reconcilePassCard: 'Card',
  reconcilePassAppVoucher: 'Barcode / app',

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

  advisoryCardTitle: 'AI analysis',
  advisoryConsensusLabel: 'Consensus',
  advisoryConfidenceLabel: 'Confidence',
  advisoryAgreementLabel: 'Models in agreement',
  advisoryPerModelTitle: 'Per-model votes',
  advisoryConfidenceHigh: 'High',
  advisoryConfidenceMedium: 'Medium',
  advisoryConfidenceLow: 'Low',
}

const ko: ReconciliationUiPack = {
  pageTitle: '대사 — 수기 판매 등록',
  pageTagline: '판매 내역을 직접 등록하고 입금 알림을 확인한 뒤 지원되는 채널을 대사합니다.',
  signInRequiredTitle: '로그인이 필요합니다',
  signInRequiredBody: '다른 곳에서 로그인한 뒤 이 페이지로 돌아와 주세요.',
  checkingSessionMsg: '세션 확인 중…',
  setupChannelMsg: '이체 채널 준비 중…',

  saleSectionTitle: '1. 판매 등록',
  saleDateLabel: '판매일',
  saleAmountLabel: '판매 금액(원)',
  saleDiscountLabel: '할인액(원)',
  saleDiscountHint: '선택. 기록용이며 정산 예정액·대사 계산에는 넣지 않습니다.',
  saleKindLabel: '매출 구분',
  saleKindCard: '카드매출',
  saleKindAppVoucher: '바코드·앱매출',
  saleKindPaperVoucher: '지류상품권',
  saleKindManualTotal: '수기총액',
  saleKindCash: '현금매출',
  saleKindHelper:
    '영수증에 카드사명이 찍히면 카드매출, 탐나는전·온누리 앱 바코드로 결제하면 바코드·앱매출, 종이 상품권을 받으면 지류상품권.',
  saleSubmitBtn: '판매 추가',
  saleSubmittingBtn: '추가 중…',
  saleCreatedMsg: '판매 등록 완료',
  saleListEmptyMsg: '등록된 판매 내역이 없습니다.',
  saleListTitle: '판매 내역',
  saleExemptBadge: '완료(대사 불필요)',
  salePaperVoucherPendingBadge: '은행 입금 대기',
  salePaperVoucherHint:
    '종이 상품권은 은행에 넣은 날 기준으로 입금됩니다(온누리 당일, 탐나는전 2~3일).',
  saleDeleteBtn: '삭제',
  saleDeleteConfirmBtn: '삭제 확인',
  saleDeleteCancelBtn: '취소',
  saleDeletingBtn: '삭제 중…',
  saleImageLabel: '또는 영수증/POS 화면 사진 올리기',
  saleImageHint:
    '종이 영수증 또는 POS 화면 사진. 카드/현금은 사진만으로 확실하지 않으니 매출 구분을 반드시 확인하세요.',
  saleImageParsingBtn: '영수증 읽는 중…',
  saleImageParsedMsg: '사진에서 매출 분석 완료',
  saleKindGuessBadge: '구분 추정 — 확인 필요',
  saleKindUnknownBadge: '구분 모름 — 직접 선택',

  depositSectionTitle: '2. 입금 알림 문자 붙여넣기',
  depositTextLabel: '입금 알림 문자',
  depositTextPlaceholder: '은행 입금 알림 문자를 여기에 붙여넣으세요…',
  depositParseBtn: '입금 분석',
  depositParsingBtn: '분석 중…',
  depositParsedMsg: '입금 분석 완료',
  depositParseFailedMsg: '해당 문자에서 날짜와 금액을 추출할 수 없습니다.',
  depositImageLabel: '또는 입금 알림 사진 올리기',
  depositImageHint: '입금 알림 화면 또는 통장 사진. 사진 인식은 틀릴 수 있으니 반드시 값을 확인하세요.',
  depositImageBtn: '사진 분석',
  depositImageParsingBtn: '사진 읽는 중…',

  spreadsheetSectionTitle: '엑셀/CSV 가져오기',
  spreadsheetKindLabel: '이 파일은',
  spreadsheetKindDeposits: '입금',
  spreadsheetKindSales: '매출',
  spreadsheetHint:
    'POS 내보내기나 수기 장부 한 장, 여러 행. 열 이름은 자동으로 맞춥니다. 신뢰도가 낮은 행은 대사 전에 확인하세요. 한 번에 최대 300행. 가져오기만 하며 대사는 실행하지 않습니다.',
  spreadsheetBtn: '스프레드시트 분석',
  spreadsheetParsingBtn: '스프레드시트 읽는 중…',
  spreadsheetParsedMsg: '가져옴',
  spreadsheetNeedsReviewLabel: '확인 필요',
  spreadsheetFailedLabel: '분석 실패',
  spreadsheetCapHint: '한 번에 최대 300행.',

  reviewSectionTitle: '3. 분석된 입금 확인',
  reviewTagline: '대사 전에 대기 중인 매출·입금 값을 확인하거나 수정하세요.',
  reviewEmptyMsg: '확인이 필요한 내역이 없습니다.',
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
  reconcilePassTransfer: '이체',
  reconcilePassCard: '카드',
  reconcilePassAppVoucher: '바코드·앱',

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

  advisoryCardTitle: 'AI 분석',
  advisoryConsensusLabel: '합의된 추정 원인',
  advisoryConfidenceLabel: '신뢰도',
  advisoryAgreementLabel: '모델 일치',
  advisoryPerModelTitle: '모델별 의견',
  advisoryConfidenceHigh: '높음',
  advisoryConfidenceMedium: '중간',
  advisoryConfidenceLow: '낮음',
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
