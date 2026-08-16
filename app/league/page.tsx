import { PublicLeagueHub } from '@/components/league/PublicLeagueHub'

/**
 * `/league` — the public (logged-in) AI Prediction League.
 *
 * Signed-out visitors are redirected to `/auth?redirectTo=/league` by
 * `middleware.ts`; every API route this page calls independently enforces auth,
 * jurisdiction and (for the one paid action) credits, so the redirect is a
 * convenience and never the access control.
 */
export default function LeaguePage() {
  return <PublicLeagueHub initialTab="cards" />
}
