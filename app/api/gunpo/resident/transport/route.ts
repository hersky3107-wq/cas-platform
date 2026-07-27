import { getGunpoTransport } from '@/lib/gunpo/resident/transport'

export const runtime = 'nodejs'
export const maxDuration = 30

// ─────────────────────────────────────────────────────────────────────────────
// Gunpo 교통 chip — GET /api/gunpo/resident/transport
// → { ok, cityCode, stops[], freshnessNote, updatedAt, errors }.
// Pure server-side proxy over TAGO (버스도착정보), fixed key-stop list
// (GUNPO_KEY_STOPS). Never throws upstream.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  try {
    const result = await getGunpoTransport()
    return Response.json(result, { status: 200 })
  } catch (e: unknown) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Transport fetch failed' },
      { status: 500 },
    )
  }
}
