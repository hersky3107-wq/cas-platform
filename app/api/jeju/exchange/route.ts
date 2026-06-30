import { getExchangeRates } from '@/lib/jeju/exchange'

export const runtime = 'nodejs'
export const maxDuration = 15

// ─────────────────────────────────────────────────────────────────────────────
// Live exchange rates for foreign visitors (Travel Help panel).
// GET → { ok, data: { date, rates } } | { ok:false, error }.
// Server-side proxy over the Korea Eximbank API; the authkey never reaches the
// client. Result is cached per KST day inside the lib. No Supabase / synod path.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  const result = await getExchangeRates()
  return Response.json(result, { status: result.ok ? 200 : 502 })
}
