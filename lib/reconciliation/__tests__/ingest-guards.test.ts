import { describe, expect, it } from 'vitest'
import { crossCheckClassifications, type RawClassified } from '@/lib/reconciliation/classify-merge'
import {
  KIND_DISAGREE_MAX_CONFIDENCE,
  SALE_REJECTED_AS_BANK_KO,
  WITHDRAWAL_REJECTED_KO,
  depositBlockedBySource,
  isWithdrawalLine,
  looksLikeIssuerDepositMemo,
  parsePrintedDates,
  resolveClassifiedDate,
  saleBlockedBySource,
} from '@/lib/reconciliation/ingest-guards'

const sale = (partial: Partial<RawClassified> & Pick<RawClassified, 'amount'>): RawClassified => ({
  kind: 'sale',
  method: 'card',
  issuer: '삼성',
  date: '2026-09-02',
  memo: null,
  confidence: 0.8,
  ...partial,
})

const deposit = (partial: Partial<RawClassified> & Pick<RawClassified, 'amount'>): RawClassified => ({
  kind: 'deposit',
  method: 'card',
  issuer: '삼성',
  date: '2026-09-02',
  memo: '삼성17938696',
  confidence: 0.8,
  ...partial,
})

describe('sale-vs-deposit guards', () => {
  it('treats issuer-code memos as deposits, never sales', () => {
    expect(looksLikeIssuerDepositMemo('삼성17938696')).toBe(true)
    expect(looksLikeIssuerDepositMemo('NH15524303')).toBe(true)
    expect(looksLikeIssuerDepositMemo('하나90343621')).toBe(true)
    expect(looksLikeIssuerDepositMemo('신한11895817')).toBe(true)
    expect(looksLikeIssuerDepositMemo('NH카드 31,500')).toBe(false)
    expect(looksLikeIssuerDepositMemo('하나 94,500')).toBe(false)
  })

  it('does not treat 입출금안내 as a withdrawal', () => {
    expect(isWithdrawalLine('[국민은행] 입출금안내 09/02 삼성17938696 42,636원 입금')).toBe(false)
    expect(isWithdrawalLine('제민신협(체크기) 5,500 출금')).toBe(true)
  })

  it('rejects saving a bank line as a sale', () => {
    const text = '[국민은행] 입출금안내\n거래일자 09/02\n적요 삼성17938696\n입금 42,636\n잔액 1,200,000'
    expect(
      saleBlockedBySource({ snippet: '삼성17938696', documentText: text, amount: 42636 })
    ).toBe(SALE_REJECTED_AS_BANK_KO)
    expect(
      saleBlockedBySource({ snippet: 'NH카드 31,500', documentText: '9/1 NH카드 31,500', amount: 31500 })
    ).toBeNull()
  })

  it('does not block a real POS sale just because the same paste also has a bank header', () => {
    const mixed =
      '9/1 NH카드 31,500\n[국민은행] 입출금안내\n거래일자 09/02\n적요 삼성17938696\n입금 42,636\n잔액 1,315,000'
    expect(saleBlockedBySource({ snippet: 'NH카드 31,500', documentText: mixed, amount: 31500 })).toBeNull()
    expect(saleBlockedBySource({ snippet: '삼성17938696', documentText: mixed, amount: 42636 })).toBe(
      SALE_REJECTED_AS_BANK_KO
    )
  })

  it('rejects 출금 as neither sale nor deposit', () => {
    expect(
      saleBlockedBySource({ snippet: '제민신협(체크기) 5,500 출금', documentText: null, amount: 5500 })
    ).toBe(WITHDRAWAL_REJECTED_KO)
    expect(
      depositBlockedBySource({ snippet: '제민신협(체크기) 5,500 출금', documentText: null, amount: 5500 })
    ).toBe(WITHDRAWAL_REJECTED_KO)
  })
})

describe('printed date extraction', () => {
  it('reads POS YY/MM/DD from 집계일시 / 집계기간', () => {
    const text = '승인내역\n집계일시 26/09/05 21:43\n집계기간 26/09/05 ~ 26/09/05\nNH카드 31,500'
    const printed = parsePrintedDates(text)
    expect(printed.some((p) => p.iso === '2026-09-05')).toBe(true)
    expect(
      resolveClassifiedDate({
        modelDate: '2026-09-06',
        memo: 'NH카드 31,500',
        sourceText: text,
        amount: 31500,
      }).date
    ).toBe('2026-09-05')
  })

  it('never fills today when no date is printed', () => {
    const resolved = resolveClassifiedDate({
      modelDate: '2026-09-06',
      memo: '뭔가 있음 42636',
      sourceText: '읽을 수 없는 메모 42636',
      amount: 42636,
    })
    expect(resolved.date).toBeNull()
    expect(resolved.unreadable).toBe(true)
  })

  it('keeps a printed M/D and uses the model only for the year', () => {
    const resolved = resolveClassifiedDate({
      modelDate: '2026-09-06',
      memo: '9/1 NH카드 31,500',
      sourceText: '9/1 NH카드 31,500',
      amount: 31500,
    })
    expect(resolved.date).toBe('2026-09-01')
    expect(resolved.unreadable).toBe(false)
  })

  it('leaves M/D empty when there is no year anywhere', () => {
    const resolved = resolveClassifiedDate({
      modelDate: null,
      memo: '9/5 삼성 176,000',
      sourceText: '9/5 삼성 176,000',
      amount: 176000,
    })
    expect(resolved.date).toBeNull()
    expect(resolved.unreadable).toBe(true)
  })
})

describe('classifier kind disagreement', () => {
  it('emits one low-confidence row when models split 매출 vs 입금', () => {
    const source = '[국민은행] 입출금안내 09/02 삼성17938696 42,636원 입금'
    const rows = crossCheckClassifications(
      [sale({ amount: 42636, date: '2026-09-02', memo: '삼성17938696' })],
      [deposit({ amount: 42636, date: '2026-09-02' })],
      source,
      new Map()
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.kind).toBe('deposit')
    expect(rows[0]!.kind_disputed).toBe(true)
    expect(rows[0]!.needs_review).toBe(true)
    expect(rows[0]!.confidence).toBeLessThanOrEqual(KIND_DISAGREE_MAX_CONFIDENCE)
    expect(rows[0]!.agreement).toBe('종류 불일치')
  })

  it('drops 출금 lines from both models', () => {
    const source = '제민신협(체크기) 5,500 출금'
    const rows = crossCheckClassifications(
      [sale({ amount: 5500, date: '2026-09-02', memo: '제민신협(체크기) 5,500 출금' })],
      [deposit({ amount: 5500, date: '2026-09-02', memo: '제민신협(체크기) 5,500 출금' })],
      source,
      new Map()
    )
    expect(rows).toHaveLength(0)
  })
})
