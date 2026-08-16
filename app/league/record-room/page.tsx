import { PublicLeagueHub } from '@/components/league/PublicLeagueHub'

/** `/league/record-room` — same hub, record room tab preselected (shareable link). */
export default function LeagueRecordRoomPage() {
  return <PublicLeagueHub initialTab="recordRoom" />
}
