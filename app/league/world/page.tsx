import { redirect } from 'next/navigation'
import { PublicLeagueHub } from '@/components/league/PublicLeagueHub'
import { parseHubTab, redirectForDoorSearch } from '@/lib/league/hub-doors'

export default async function LeagueWorldPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; cat?: string }>
}) {
  const { tab, cat } = await searchParams
  const query = new URLSearchParams()
  if (cat) query.set('cat', cat)
  if (tab) query.set('tab', tab)
  const target = redirectForDoorSearch('world', query.toString())
  if (target) redirect(target)
  return <PublicLeagueHub door="world" initialTab={parseHubTab(tab) ?? 'cards'} />
}
