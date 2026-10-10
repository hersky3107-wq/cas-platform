'use client'

import { useEffect, useState } from 'react'
import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import { projectLonLat } from '@/lib/crisis/admin/geo'
import type { CrisisUiPack } from '@/lib/crisis/i18n/dictionary'

export interface PrecursorGeo {
  plates: number[][][]
  volcanoes: Array<{ lat: number; lon: number; name: string; alert: string | null }>
  cells: Array<{ lat: number; lon: number; multiplier: number; count7d: number; usual7d: number }>
}

export function usePrecursorGeo(enabled: boolean): PrecursorGeo | null {
  const [data, setData] = useState<PrecursorGeo | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void authenticatedFetch('/api/crisis/geo-layers')
      .then((res) => (res.ok ? res.json() : null))
      .then((body: PrecursorGeo | null) => {
        if (!cancelled && body) setData(body)
      })
      .catch(() => {
        /* layers are optional */
      })
    return () => {
      cancelled = true
    }
  }, [enabled])
  return data
}

function alertFill(alert: string | null): string {
  const key = (alert ?? '').toLowerCase()
  if (key.includes('warning') || key === 'red') return '#ef4444'
  if (key.includes('watch') || key === 'orange') return '#f97316'
  if (key.includes('advisory') || key === 'yellow') return '#eab308'
  return '#94a3b8'
}

export function PrecursorLayerToggles({
  t,
  plates,
  volcanoes,
  cells,
  onPlates,
  onVolcanoes,
  onCells,
}: {
  t: CrisisUiPack
  plates: boolean
  volcanoes: boolean
  cells: boolean
  onPlates: (value: boolean) => void
  onVolcanoes: (value: boolean) => void
  onCells: (value: boolean) => void
}) {
  const button = (on: boolean, label: string, set: (value: boolean) => void) => (
    <button
      type="button"
      onClick={() => set(!on)}
      className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
        on ? 'border-cyan-300/50 bg-cyan-500/20 text-cyan-50' : 'border-white/15 bg-white/5 text-slate-300'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex flex-wrap items-center gap-2">
      {button(plates, t.layerPlates, onPlates)}
      {button(volcanoes, t.layerVolcanoes, onVolcanoes)}
      {button(cells, t.layerRateCells, onCells)}
    </div>
  )
}

export function PrecursorLayerShapes({
  data,
  showPlates,
  showVolcanoes,
  showCells,
  width,
  height,
}: {
  data: PrecursorGeo | null
  showPlates: boolean
  showVolcanoes: boolean
  showCells: boolean
  width: number
  height: number
}) {
  if (!data) return null
  return (
    <g>
      {showPlates
        ? data.plates.map((line, index) => {
            const d = line
              .map((pair, i) => {
                const pt = projectLonLat(pair[0], pair[1], width, height)
                return `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`
              })
              .join(' ')
            return <path key={`plate-${index}`} d={d} fill="none" stroke="rgba(251,191,36,0.55)" strokeWidth={0.7} />
          })
        : null}
      {showCells
        ? data.cells.map((cell) => {
            const sw = projectLonLat(cell.lon - 0.5, cell.lat - 0.5, width, height)
            const ne = projectLonLat(cell.lon + 0.5, cell.lat + 0.5, width, height)
            return (
              <rect
                key={`${cell.lat},${cell.lon}`}
                x={Math.min(sw.x, ne.x)}
                y={Math.min(sw.y, ne.y)}
                width={Math.abs(ne.x - sw.x)}
                height={Math.abs(ne.y - sw.y)}
                fill="rgba(244,63,94,0.28)"
                stroke="rgba(244,63,94,0.7)"
                strokeWidth={0.4}
              >
                <title>{`${cell.multiplier.toFixed(1)}× · ${cell.count7d} / ${cell.usual7d}`}</title>
              </rect>
            )
          })
        : null}
      {showVolcanoes
        ? data.volcanoes.map((volcano) => {
            const pt = projectLonLat(volcano.lon, volcano.lat, width, height)
            return (
              <circle key={`${volcano.name}-${volcano.lat}`} cx={pt.x} cy={pt.y} r={2.2} fill={alertFill(volcano.alert)}>
                <title>{`${volcano.name}${volcano.alert ? ` · ${volcano.alert}` : ''}`}</title>
              </circle>
            )
          })
        : null}
    </g>
  )
}
