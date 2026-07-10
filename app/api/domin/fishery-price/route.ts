import { getFisheryPrice } from '@/lib/jeju/fishery'

export const runtime = 'nodejs'
// 40s (was 30s) — upstream timeout is now 15s w/ 1 retry (~31s worst case).
export const maxDuration = 40

// ─────────────────────────────────────────────────────────────────────────────
// SHARED Jeju fishery-price data — 도민 일반 mode 농수산 chip.
// GET ?species=갈치&days=7 → latest / trend / context (Perplexity enrichment).
// Pure server-side proxy: data.go.kr (해양수산부 위판 집계) + Perplexity context,
// with a Perplexity price fallback when the official source is empty/403.
// No Supabase / synod / DEEP / credit path. Partial failures degrade to null
// sections + errors[] rather than failing the whole response.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const species = url.searchParams.get('species')
  const days = url.searchParams.get('days')

  try {
    const result = await getFisheryPrice(species, days)
    if (!result.ok) {
      return Response.json(result, { status: 400 })
    }
    return Response.json(result, { status: 200 })
  } catch (e: unknown) {
    // getFisheryPrice never throws; this is a last-resort safety net.
    return Response.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'Fishery price fetch failed',
      },
      { status: 500 },
    )
  }
}
