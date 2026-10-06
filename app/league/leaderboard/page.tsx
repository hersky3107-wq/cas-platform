import { redirect } from 'next/navigation'
import { doorForCategory, doorPath } from '@/lib/league/hub-doors'

/** Old share link. A category goes to that door; otherwise the landing. */
export default async function LeagueLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>
}) {
  const { cat } = await searchParams
  const door = cat ? doorForCategory(cat) : null
  if (door && cat) {
    redirect(`${doorPath(door)}?tab=leaderboard&cat=${encodeURIComponent(cat)}`)
  }
  redirect('/league')
}
