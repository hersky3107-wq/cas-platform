'use client'

import { useCallback, useEffect, useState } from 'react'

/** Update this text when you have a new announcement. */
const ANNOUNCEMENT_TEXT =
  'AIMANI is now live. More modes and features coming soon. Thank you for being here.'

/** Bump version (v1 → v2 → …) when ANNOUNCEMENT_TEXT changes so everyone sees the new banner. */
const ANNOUNCEMENT_DISMISS_KEY = 'announcement_dismissed_v1'

function isDismissed(): boolean {
  try {
    return localStorage.getItem(ANNOUNCEMENT_DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export default function AnnouncementBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!isDismissed()) {
      setVisible(true)
    }
  }, [])

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(ANNOUNCEMENT_DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
    setVisible(false)
  }, [])

  if (!visible) return null

  return (
    <div
      role="region"
      aria-label="Announcement"
      className="flex w-full items-center gap-3 bg-[#0b1020] px-4 py-2.5 text-white"
    >
      <p className="min-w-0 flex-1 text-center text-sm leading-snug sm:text-left">
        {ANNOUNCEMENT_TEXT}
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="shrink-0 rounded p-1 text-lg leading-none text-white/80 hover:bg-white/10 hover:text-white"
      >
        ×
      </button>
    </div>
  )
}
