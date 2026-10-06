import { redirect } from 'next/navigation'
import { PublicLeagueHub } from '@/components/league/PublicLeagueHub'
import { parseHubTab, redirectForDoorSearch } from '@/lib/league/hub-doors'

/** Self-contained finance door — the 유사투자자문업 service URL. */
export default async function LeagueFinancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; cat?: string }>
}) {
  const { tab, cat } = await searchParams
  const query = new URLSearchParams()
  if (cat) query.set('cat', cat)
  if (tab) query.set('tab', tab)
  const target = redirectForDoorSearch('finance', query.toString())
  if (target) redirect(target)
  return <PublicLeagueHub door="finance" initialTab={parseHubTab(tab) ?? 'cards'} />
}
