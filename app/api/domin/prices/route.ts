import { getPrices } from '@/lib/jeju/prices'

export const runtime = 'nodejs'
// 40s (was 30s) — upstream timeout is now 15s w/ 1 retry (~31s worst case).
export const maxDuration = 40

// ─────────────────────────────────────────────────────────────────────────────
// Jeju daily prices — 도민(resident) mode 물가·생활 chip.
// GET /api/domin/prices → groups (농산물/수산물/가공축산) + Perplexity context.
// KAMIS dailySalesList via reused connector allowlist + filterKamisJejuItems.
// Failure degrades gracefully; never throws.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  try {
    const result = await getPrices()
    if (!result.ok) {
      return Response.json(result, { status: 502 })
    }
    return Response.json(result, { status: 200 })
  } catch (e: unknown) {
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'Prices fetch failed',
      },
      { status: 500 },
    )
  }
}
