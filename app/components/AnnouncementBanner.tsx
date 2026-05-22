'use client'

import { useCallback, useEffect, useState } from 'react'

type AnnouncementPayload = {
  text: string
  version: string
}

function dismissKeyForVersion(version: string): string {
  return `announcement_dismissed_${version}`
}

function isDismissed(version: string): boolean {
  try {
    return localStorage.getItem(dismissKeyForVersion(version)) === '1'
  } catch {
    return false
  }
}

export default function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<AnnouncementPayload | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let mounted = true

    const loadAnnouncement = async () => {
      try {
        const res = await fetch('/api/announcement', { cache: 'no-store' })
        if (!mounted) return
        if (!res.ok) return

        const j = (await res.json().catch(() => null)) as {
          text?: string | null
          version?: string | null
          error?: string
        }
        if (!mounted) return
        if (!j?.text || !j?.version) return

        const payload = { text: String(j.text), version: String(j.version) }
        setAnnouncement(payload)
        if (!isDismissed(payload.version)) {
          setVisible(true)
        }
      } catch {
        /* fail silently — no banner */
      }
    }

    const deferId = window.setTimeout(() => {
      if (!mounted) return
      void loadAnnouncement()
    }, 0)

    return () => {
      mounted = false
      window.clearTimeout(deferId)
    }
  }, [])

  const dismiss = useCallback(() => {
    if (!announcement) return
    try {
      localStorage.setItem(dismissKeyForVersion(announcement.version), '1')
    } catch {
      /* ignore */
    }
    setVisible(false)
  }, [announcement])

  if (!visible || !announcement?.text) return null

  return (
    <div
      role="region"
      aria-label="Announcement"
      className="flex w-full items-center gap-3 bg-[#0b1020] px-4 py-2.5 text-white"
    >
      <p className="min-w-0 flex-1 text-center text-sm leading-snug sm:text-left">
        {announcement.text}
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
