import { redirect } from 'next/navigation'
import { HubDoors } from '@/components/league/HubDoors'
import { redirectForCategorySearch } from '@/lib/league/hub-doors'

/**
 * `/league` — two doors only. `?cat=` deep links go to the matching door.
 */
export default async function LeaguePage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; tab?: string }>
}) {
  const params = await searchParams
  const query = new URLSearchParams()
  if (params.cat) query.set('cat', params.cat)
  if (params.tab) query.set('tab', params.tab)
  const target = redirectForCategorySearch(query.toString())
  if (target) redirect(target)
  return <HubDoors />
}
