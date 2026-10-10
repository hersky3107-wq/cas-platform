'use client'

import { useEffect, useState } from 'react'
import { worldCountryPaths, type WorldTopology } from '@/lib/crisis/ui/world-paths'

export function WorldBasemap({ width, height }: { width: number; height: number }) {
  const [paths, setPaths] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void fetch('/crisis/countries-110m.json')
      .then((res) => (res.ok ? (res.json() as Promise<WorldTopology>) : null))
      .then((topo) => {
        if (!cancelled && topo) setPaths(worldCountryPaths(topo, width, height))
      })
      .catch(() => {
        /* outline is optional; dots still render */
      })
    return () => {
      cancelled = true
    }
  }, [width, height])

  return (
    <g aria-hidden>
      <rect width={width} height={height} fill="#071018" />
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="rgba(148,163,184,0.08)"
          stroke="rgba(148,163,184,0.28)"
          strokeWidth={0.4}
        />
      ))}
    </g>
  )
}
