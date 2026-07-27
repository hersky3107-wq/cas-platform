import { getGunpoWeatherAlert } from '@/lib/gunpo/resident/weather'

export const runtime = 'nodejs'
export const maxDuration = 45

// ─────────────────────────────────────────────────────────────────────────────
// Gunpo 날씨·재난 — 시민(resident) mode. Cloned from app/api/domin/weather-alert.
// GET /api/gunpo/resident/weather → current/midterm/warning + context.
// Reuses the gunpo governance KMA connectors (nx/ny/regId/stnId TODOs live in
// lib/gunpo/connectors.ts, not here). Never throws upstream.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  try {
    const result = await getGunpoWeatherAlert()
    if (!result.ok) {
      return Response.json(result, { status: 502 })
    }
    return Response.json(result, { status: 200 })
  } catch (e: unknown) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Weather alert fetch failed' },
      { status: 500 },
    )
  }
}
