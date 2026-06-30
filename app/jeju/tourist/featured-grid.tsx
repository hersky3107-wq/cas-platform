'use client'

import { useState } from 'react'
import type { VisitJejuPlace } from '@/lib/jeju/connectors'
import { PlaceCard } from './place-card'
import { PlaceDetailModal } from './place-detail-modal'
import { type PlaceDetail, detailFromVisitJeju } from './place-detail'

/**
 * Client wrapper for the server page's "지금 뜨는 제주" grid: renders clickable
 * PlaceCards and owns the shared detail modal. Items are randomly sampled on each
 * server render from the cached VisitJeju pool (category spread preserved).
 */
export function FeaturedGrid({
  items,
}: {
  items: Array<{ place: VisitJejuPlace; displayLabel: string }>
}) {
  const [detail, setDetail] = useState<PlaceDetail | null>(null)
  const gridKey = items.map(({ place }) => place.contentsId).join(',')

  return (
    <>
      <div
        key={gridKey}
        className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {items.map(({ place, displayLabel }) => (
          <PlaceCard
            key={place.contentsId}
            place={place}
            displayLabel={displayLabel}
            onSelect={() => setDetail(detailFromVisitJeju(place, displayLabel))}
          />
        ))}
      </div>

      <PlaceDetailModal detail={detail} onClose={() => setDetail(null)} />
    </>
  )
}
