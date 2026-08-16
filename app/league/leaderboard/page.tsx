import { PublicLeagueHub } from '@/components/league/PublicLeagueHub'

/** `/league/leaderboard` — same hub, leaderboard tab preselected (shareable link). */
export default function LeagueLeaderboardPage() {
  return <PublicLeagueHub initialTab="leaderboard" />
}
