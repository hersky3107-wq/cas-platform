import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { HubDoors } from '@/components/league/HubDoors'
import { getIpCountryFromHeaders } from '@/lib/geo/ip-country'
import { redirectForCategorySearch } from '@/lib/league/hub-doors'
import { resolveLeagueLocale } from '@/lib/league/i18n/resolve-locale'
import { admissionStockLane } from '@/lib/league/stock-lane'

/**
 * `/league` — two doors only. `?cat=` deep links go to the matching door.
 * Locale and lane come from headers alone (no DB) for the first paint; the
 * client refines them with the profile signals.
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

  const requestHeaders = await headers()
  const ipCountry = getIpCountryFromHeaders(requestHeaders)
  const initialLocale = resolveLeagueLocale({ acceptLanguage: requestHeaders.get('accept-language'), ipCountry })
  const initialKoreaLane = admissionStockLane({ declaredCountry: null, ipCountry }) === 'korea'
  return <HubDoors initialLocale={initialLocale} initialKoreaLane={initialKoreaLane} />
}
