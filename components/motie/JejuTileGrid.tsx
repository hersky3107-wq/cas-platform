'use client'

import type { ReactNode } from 'react'

type JejuTileGridProps = {
  children: ReactNode
  columns?: 2 | 3
}

export function JejuTileGrid({ children, columns = 3 }: JejuTileGridProps) {
  return (
    <div
      className={`grid justify-items-center gap-[var(--jeju-gap)] ${
        columns === 2
          ? 'grid-cols-1 sm:grid-cols-2'
          : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
      }`}
    >
      {children}
    </div>
  )
}
