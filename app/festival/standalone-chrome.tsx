'use client'

import { useEffect } from 'react'

/**
 * Competition demo shell — hide global AIMANI credit gauge / low-credit banners
 * on /festival only. Root layout providers stay mounted; their fixed chrome is
 * suppressed here so judges see a self-contained page with no lobby/credit UI.
 */
export function FestivalStandaloneChrome() {
  useEffect(() => {
    const root = document.documentElement
    root.dataset.festivalStandalone = 'true'

    const style = document.createElement('style')
    style.id = 'festival-standalone-chrome-hide'
    style.textContent = `
      html[data-festival-standalone] div.pointer-events-none.fixed.right-4.top-4 {
        display: none !important;
      }
      html[data-festival-standalone] div.fixed.inset-x-0.bottom-0.z-\\[95\\] {
        display: none !important;
      }
    `
    document.head.appendChild(style)

    return () => {
      delete root.dataset.festivalStandalone
      style.remove()
    }
  }, [])

  return null
}
