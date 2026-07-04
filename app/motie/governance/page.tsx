import { redirect } from 'next/navigation'

// /motie/governance is now the unified 통합 심의 view.
export default function JejuGovernancePage() {
  redirect('/motie/governance/unified')
}
