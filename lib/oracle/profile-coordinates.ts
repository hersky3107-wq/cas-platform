import 'server-only'

import { geocodeBirthCity } from '@/lib/oracle/geocode'
import { supabaseAdmin } from '@/lib/supabase/server'

/**
 * Re-geocode a runner profile when lat/lng are missing but a birth place is
 * stored. Used on astro session create so a failed save-time geocode is not
 * silently replaced with Seoul.
 */
export async function refreshProfileCoordinates(
  userId: string,
  profileId: string,
): Promise<{ lat: number | null; lng: number | null; coordinatesDefaulted: boolean }> {
  const { data, error } = await supabaseAdmin
    .from('oracle_profiles')
    .select('id, birth_place, lat, lng, tz')
    .eq('id', profileId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !data) {
    return { lat: null, lng: null, coordinatesDefaulted: true }
  }

  const lat = typeof data.lat === 'number' ? data.lat : data.lat != null ? Number(data.lat) : null
  const lng = typeof data.lng === 'number' ? data.lng : data.lng != null ? Number(data.lng) : null
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng, coordinatesDefaulted: false }
  }

  const place = typeof data.birth_place === 'string' ? data.birth_place.trim() : ''
  if (!place) {
    return { lat: null, lng: null, coordinatesDefaulted: true }
  }

  const geo = await geocodeBirthCity(place).catch(() => null)
  if (!geo) {
    return { lat: null, lng: null, coordinatesDefaulted: true }
  }

  await supabaseAdmin
    .from('oracle_profiles')
    .update({
      lat: geo.latitude,
      lng: geo.longitude,
      tz: geo.timezone ?? data.tz,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profileId)
    .eq('user_id', userId)

  return { lat: geo.latitude, lng: geo.longitude, coordinatesDefaulted: false }
}
