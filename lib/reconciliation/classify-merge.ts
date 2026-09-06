/**
 * Deterministic post-process for the two-model ingest classifier.
 * Pure: drop 출금, resolve printed dates, force review when models
 * disagree on 매출 vs 입금. No I/O.
 */

import {
  KIND_DISAGREE_MAX_CONFIDENCE,
  looksLikeBankDepositHint,
  resolveClassifiedDate,
  rowLooksLikeWithdrawal,
} from '@/lib/reconciliation/ingest-guards'

export type RawClassified = {
  kind: 'sale' | 'deposit'
  method: string | null
  issuer: string | null
  date: string | null
  amount: number
  memo: string | null
  confidence: number
  date_unreadable?: boolean
}

export type MergedClassified = {
  kind: 'sale' | 'deposit'
  method_code: string | null
  issuer_id: string | null
  issuer_name: string | null
  date: string | null
  amount: number
  memo: string | null
  confidence: number
  needs_review: boolean
  agreement: string
  kind_disputed: boolean
  date_unreadable: boolean
}

export function refineRawRow(row: RawClassified, sourceText: string): RawClassified | null {
  if (rowLooksLikeWithdrawal(row.memo, row.amount, sourceText)) return null
  const resolved = resolveClassifiedDate({
    modelDate: row.date,
    memo: row.memo,
    sourceText,
    amount: row.amount,
  })
  return {
    ...row,
    date: resolved.date,
    date_unreadable: resolved.unreadable,
  }
}

const amountDateKey = (r: RawClassified): string => `${r.date ?? '?'}|${r.amount}`

function pickIssuer(
  name: string | null,
  issuerByName: Map<string, { id: string; name: string }>
): { id: string; name: string } | null {
  if (!name) return null
  return issuerByName.get(name.toLowerCase()) ?? null
}

function toMerged(
  best: RawClassified,
  opts: {
    issuerByName: Map<string, { id: string; name: string }>
    confidence: number
    needsReview: boolean
    agreement: string
    kind: 'sale' | 'deposit'
    kindDisputed: boolean
  }
): MergedClassified {
  const issuer = pickIssuer(best.issuer, opts.issuerByName)
  const dateUnreadable = best.date_unreadable === true || best.date == null
  return {
    kind: opts.kind,
    method_code: best.method ?? (issuer ? 'card' : null),
    issuer_id: issuer?.id ?? null,
    issuer_name: issuer?.name ?? (best.issuer || null),
    date: best.date,
    amount: best.amount,
    memo: best.memo,
    confidence: opts.confidence,
    needs_review:
      opts.needsReview || dateUnreadable || opts.kindDisputed || (issuer == null && best.issuer != null),
    agreement: opts.agreement,
    kind_disputed: opts.kindDisputed,
    date_unreadable: dateUnreadable,
  }
}

function bucketByKey(list: RawClassified[]): Map<string, RawClassified[]> {
  const map = new Map<string, RawClassified[]>()
  for (const row of list) {
    const key = amountDateKey(row)
    const bucket = map.get(key) ?? []
    bucket.push(row)
    map.set(key, bucket)
  }
  return map
}

/**
 * Cross-check two models' refined rows. Same amount+date with different
 * kinds → one row, low confidence, kind_disputed (owner must confirm).
 */
export function crossCheckClassifications(
  modelA: RawClassified[],
  modelB: RawClassified[] | null,
  sourceText: string,
  issuerByName: Map<string, { id: string; name: string }>
): MergedClassified[] {
  const aRefined = modelA.map((r) => refineRawRow(r, sourceText)).filter((r): r is RawClassified => r != null)
  const bRefined = (modelB ?? [])
    .map((r) => refineRawRow(r, sourceText))
    .filter((r): r is RawClassified => r != null)
  const bothResponded = modelB != null
  const mapA = bucketByKey(aRefined)
  const mapB = bucketByKey(bRefined)
  const rows: MergedClassified[] = []

  for (const key of new Set([...mapA.keys(), ...mapB.keys()])) {
    const a = mapA.get(key) ?? []
    const b = mapB.get(key) ?? []
    const kinds = new Set([...a, ...b].map((r) => r.kind))
    const kindClash = bothResponded && a.length > 0 && b.length > 0 && kinds.size > 1

    if (kindClash) {
      const best = [...a, ...b].sort((x, y) => y.confidence - x.confidence)[0]!
      const hintText = [best.memo ?? '', sourceText].join('\n')
      const kind: 'sale' | 'deposit' = looksLikeBankDepositHint(hintText) ? 'deposit' : best.kind
      rows.push(
        toMerged(best, {
          issuerByName,
          confidence: Math.min(KIND_DISAGREE_MAX_CONFIDENCE, best.confidence),
          needsReview: true,
          agreement: '종류 불일치',
          kind,
          kindDisputed: true,
        })
      )
      continue
    }

    const agreedCount = bothResponded ? Math.min(a.length, b.length) : 0
    const total = Math.max(a.length, b.length)
    for (let i = 0; i < total; i++) {
      const rowA = a[i]
      const rowB = b[i]
      const agreed = i < agreedCount
      const best = rowA && rowB ? (rowB.confidence > rowA.confidence ? rowB : rowA) : (rowA ?? rowB)!
      const confidence = agreed
        ? Math.min(0.95, Math.max(rowA?.confidence ?? 0, rowB?.confidence ?? 0, 0.8))
        : Math.min(bothResponded ? 0.55 : 0.65, best.confidence)
      rows.push(
        toMerged(best, {
          issuerByName,
          confidence,
          needsReview: !agreed,
          agreement: agreed ? '2/2' : `1/${bothResponded ? 2 : 1}`,
          kind: best.kind,
          kindDisputed: false,
        })
      )
    }
  }

  rows.sort(
    (x, y) =>
      Number(y.kind_disputed) - Number(x.kind_disputed) ||
      Number(y.needs_review) - Number(x.needs_review) ||
      (x.date ?? '9999').localeCompare(y.date ?? '9999') ||
      x.kind.localeCompare(y.kind)
  )
  return rows
}
