import { redirect } from 'next/navigation'
import { canonicalCategoryParam, doorForCategory, doorPath } from '@/lib/league/hub-doors'

/** Old share link. A category goes to that door; otherwise the landing. */
export default async function LeagueRecordRoomPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>
}) {
  const cat = canonicalCategoryParam((await searchParams).cat)
  const door = cat ? doorForCategory(cat) : null
  if (door && cat) {
    redirect(`${doorPath(door)}?tab=recordRoom&cat=${encodeURIComponent(cat)}`)
  }
  redirect('/league')
}
