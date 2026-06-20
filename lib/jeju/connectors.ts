import 'server-only'

import { extract, type ExtractedContent } from '@/lib/extract'

/**
 * Jeju public-data connector registry.
 *
 * DESIGN CONSTRAINT — loosely coupled & self-contained:
 *   This module is the data backbone for a future Jeju governance site. It may
 *   import from `lib/extract`, but it must NOT be imported by or wired into any
 *   existing AIMANI module, router, or credit system. Keeping the dependency
 *   arrow one-directional (jeju → extract, never extract → jeju, never
 *   aimani → jeju) means the whole `lib/jeju` folder can later be lifted into a
 *   standalone project with only `lib/extract` coming along for the ride.
 */

export type JejuSourceFormat = 'xml' | 'json' | 'csv'

export type JejuMode = 'governance' | 'tourist' | 'resident'

export interface JejuSource {
  /** Stable identifier used by `fetchJejuSource`. */
  id: string
  /** Human-readable label. */
  label: string
  /** Builds the full request URL (including any service key from the env). */
  buildUrl: () => string
  /** Expected response format, routed through the extract json-api adapter. */
  format: JejuSourceFormat
  /** Which Jeju site mode(s) this source serves. */
  modes: JejuMode[]
}

/**
 * Registered Jeju data sources.
 *
 * To add a source: append a `JejuSource` entry below. `buildUrl` should read any
 * secret strictly from `process.env` (never hardcode keys). Once registered, the
 * source is immediately fetchable via `fetchJejuSource(id)` and listable via
 * `listJejuSources(mode)`.
 */
const JEJU_SOURCES: readonly JejuSource[] = [
  {
    id: 'kpx-jeju-power',
    label: 'KPX Jeju 5-minute Power Supply',
    format: 'xml',
    modes: ['governance', 'resident'],
    buildUrl: () => {
      const key = process.env.KPX_SERVICE_KEY ?? ''
      return `https://openapi.kpx.or.kr/openapi/chejusukub5mToday/getChejuSukub5mToday?serviceKey=${encodeURIComponent(key)}`
    },
  },

  // ── Registry slots for upcoming sources (NOT yet implemented) ─────────────
  // Add each as a JejuSource entry following the KPX pattern above. Read the
  // service key from process.env; pick the correct `format`; set `modes`.
  //
  // TODO: KAMIS — agricultural wholesale/retail prices
  //   env: KAMIS_CERT_KEY (+ KAMIS_CERT_ID if required)
  //   format: 'json' (KAMIS supports json) ; modes: ['resident','tourist']
  //
  // TODO: 기상청 (KMA) — Jeju weather / forecast
  //   env: KMA_SERVICE_KEY
  //   format: 'xml' ; modes: ['governance','resident','tourist']
  //
  // TODO: 제주 traffic — real-time road/traffic conditions
  //   env: JEJU_TRAFFIC_SERVICE_KEY
  //   format: 'json' ; modes: ['governance','resident','tourist']
] as const

/** Returns the registered source for `id`, or null if unknown. */
function getJejuSource(id: string): JejuSource | null {
  return JEJU_SOURCES.find((s) => s.id === id) ?? null
}

/**
 * Lists registered Jeju sources, optionally filtered by mode.
 * Returns lightweight descriptors (no `buildUrl`) safe to expose to a UI.
 */
export function listJejuSources(
  mode?: JejuMode
): Array<Pick<JejuSource, 'id' | 'label' | 'format' | 'modes'>> {
  const filtered = mode ? JEJU_SOURCES.filter((s) => s.modes.includes(mode)) : JEJU_SOURCES
  return filtered.map(({ id, label, format, modes }) => ({ id, label, format, modes }))
}

/**
 * Fetches a registered Jeju source by id through the shared extract layer.
 *
 * Never throws: an unknown id or any fetch/parse failure comes back as an
 * `ExtractedContent` with `ok: false` (the extract layer already handles failure
 * gracefully — including Korean public-API resultCode errors for XML responses).
 */
export async function fetchJejuSource(id: string): Promise<ExtractedContent> {
  const source = getJejuSource(id)
  if (!source) {
    return {
      sourceType: 'json-api',
      title: null,
      text: '',
      fetchedAt: new Date().toISOString(),
      sourceLabel: id,
      truncated: false,
      ok: false,
      error: `unknown Jeju source: ${id}`,
    }
  }

  return extract({
    type: 'json-api',
    value: source.buildUrl(),
    meta: {
      format: source.format,
      title: source.label,
      sourceLabel: source.id,
    },
  })
}
