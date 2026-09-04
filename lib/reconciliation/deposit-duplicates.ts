/**
 * HITL duplicate detection for deposit candidates.
 *
 * Compares (date, amount, normalized memo) against existing deposit_records.
 * NEVER drops a row — callers only flag 중복 의심 for the review UI.
 * Two genuine identical deposits on the same day are valid; the user un-skips.
 */

export type DepositFingerprint = {
  id: string
  deposit_date: string
  actual_amount: number
  memo: string | null
}

export type DepositCandidateCore = {
  date: string | null
  amount: number | null
  memo: string | null
  confidence: number
  year_ambiguous: boolean
  method: 'ai' | 'regex' | 'ai+regex' | 'none'
  extra: Record<string, string | null> | null
  channel_hint?: string | null
}

export type DepositCandidate = DepositCandidateCore & {
  duplicate_suspect: boolean
  matching_deposit_ids: string[]
}

export function normalizeDepositMemo(memo: string | null | undefined): string {
  return (memo ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function depositAmountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005
}

export function findMatchingDepositIds(
  candidate: { date: string | null; amount: number | null; memo: string | null },
  existing: DepositFingerprint[]
): string[] {
  if (candidate.date == null || candidate.amount == null) return []
  const memo = normalizeDepositMemo(candidate.memo)
  return existing
    .filter(
      (row) =>
        row.deposit_date === candidate.date &&
        depositAmountsEqual(Number(row.actual_amount), candidate.amount!) &&
        normalizeDepositMemo(row.memo) === memo
    )
    .map((row) => row.id)
}

export function annotateDuplicates(
  rows: DepositCandidateCore[],
  existing: DepositFingerprint[]
): DepositCandidate[] {
  return rows.map((row) => {
    const matching_deposit_ids = findMatchingDepositIds(row, existing)
    return {
      ...row,
      matching_deposit_ids,
      duplicate_suspect: matching_deposit_ids.length > 0,
    }
  })
}

export function fingerprintsFromDeposits(
  rows: Array<{
    id: string
    deposit_date: string
    actual_amount: number
    memo?: string | null
  }>
): DepositFingerprint[] {
  return rows.map((row) => ({
    id: row.id,
    deposit_date: row.deposit_date,
    actual_amount: Number(row.actual_amount),
    memo: row.memo ?? null,
  }))
}
