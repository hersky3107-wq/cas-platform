import { redirect } from 'next/navigation'

/**
 * 도민 entry — skip the 일반/어르신 picker and land on the general 10-chip lobby.
 * /jeju/resident/senior remains reachable by direct URL; it is just not linked here.
 */
export default function JejuResidentPage() {
  redirect('/jeju/resident/general')
}
