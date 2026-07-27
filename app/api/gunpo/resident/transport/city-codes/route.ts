import { fetchCityCodeList } from '@/lib/gunpo/resident/transport'

export const runtime = 'nodejs'
export const maxDuration = 30

// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME lookup helper — GET /api/gunpo/resident/transport/city-codes
// → { ok, data: [{ cityCode, cityName }, ...] }.
//
// NOT used by the regular 교통 chip UI. Visit this endpoint once to find
// 군포시's TAGO cityCode (search the returned list for "군포"), then hardcode
// it into GUNPO_CITY_CODE in lib/gunpo/resident/transport.ts.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  try {
    const result = await fetchCityCodeList()
    return Response.json(result, { status: result.ok ? 200 : 502 })
  } catch (e: unknown) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'City code list fetch failed' },
      { status: 500 },
    )
  }
}
