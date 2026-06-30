'use client'

import { useEffect, useState } from 'react'
import type { VisitJejuPlace } from '@/lib/jeju/connectors'
import { useTouristUi } from '@/components/jeju/useTouristUi'
import { localizedDisplayLabel } from './category-labels'
import { PlaceCard } from './place-card'
import { PlaceDetailModal } from './place-detail-modal'
import { type PlaceDetail, detailFromVisitJeju } from './place-detail'

type FeaturedResult = { ok: true; places: VisitJejuPlace[] } | { ok: false }

/**
 * Client wrapper for the "지금 뜨는 제주" grid: renders clickable PlaceCards and
 * owns the shared detail modal.
 *
 * The server renders the Korean (kr) sample (`initialItems`). When a non-Korean
 * UI locale is active, this re-fetches a localized + re-sampled set from
 * VisitJeju's native multilingual data (cached per locale server-side), so cards
 * appear in the chosen language while staying randomized/varied. Korean keeps the
 * server-rendered set exactly as before.
 */
export function FeaturedGrid({
  initialItems = [],
}: {
  initialItems?: VisitJejuPlace[]
}) {
  const { t, locale } = useTouristUi()
  const safeInitial = initialItems ?? []
  const [places, setPlaces] = useState<VisitJejuPlace[]>(() => safeInitial)
  const [detail, setDetail] = useState<PlaceDetail | null>(null)

  useEffect(() => {
    // Korean uses the server-rendered (kr) sample as-is — no refetch, no change.
    if (locale === 'ko') {
      setPlaces(safeInitial)
      return
    }

    let alive = true
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const res = await fetch('/api/jeju/tourist-featured', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locale }),
          signal: ctrl.signal,
        })
        const data = (await res.json()) as FeaturedResult
        if (
          alive &&
          data.ok &&
          Array.isArray(data.places) &&
          data.places.length > 0
        ) {
          setPlaces(data.places)
        }
      } catch {
        // Keep the Korean server-rendered set on any failure (graceful).
      }
    })()

    return () => {
      alive = false
      ctrl.abort()
    }
  }, [locale, safeInitial])

  const items = places ?? safeInitial
  const gridKey = items.map((p) => p.contentsId).join(',')

  return (
    <>
      <div
        key={gridKey}
        className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {items.map((place) => {
          const displayLabel = localizedDisplayLabel(place, t)
          return (
            <PlaceCard
              key={place.contentsId}
              place={place}
              displayLabel={displayLabel}
              onSelect={() => setDetail(detailFromVisitJeju(place, displayLabel))}
            />
          )
        })}
      </div>

      <PlaceDetailModal detail={detail} onClose={() => setDetail(null)} />
    </>
  )
}
