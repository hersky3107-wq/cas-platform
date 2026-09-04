import 'server-only'

import { listDeposits } from '@/lib/reconciliation/db'
import {
  annotateDuplicates,
  fingerprintsFromDeposits,
  type DepositCandidate,
  type DepositCandidateCore,
  type DepositFingerprint,
} from '@/lib/reconciliation/deposit-duplicates'
import type { DalResult } from '@/lib/reconciliation/types'
import type { OwnedScope } from '@/lib/reconciliation/scope'

export async function attachDuplicateFlags(
  scope: OwnedScope,
  rows: DepositCandidateCore[]
): Promise<DalResult<{ rows: DepositCandidate[]; fingerprints: DepositFingerprint[] }>> {
  const listed = await listDeposits(scope)
  if (!listed.ok) return listed
  const fingerprints = fingerprintsFromDeposits(listed.data)
  return {
    ok: true,
    data: {
      rows: annotateDuplicates(rows, fingerprints),
      fingerprints,
    },
  }
}
