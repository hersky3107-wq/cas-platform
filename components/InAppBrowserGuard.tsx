'use client'

import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'
import {
  getCurrentPageUrl,
  isInAppBrowser,
  openInExternalBrowser,
} from '@/lib/inAppBrowser'

export default function InAppBrowserGuard() {
  const [blocked, setBlocked] = useState(false)
  const [pageUrl, setPageUrl] = useState('')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    if (!isInAppBrowser()) return
    setBlocked(true)
    setPageUrl(getCurrentPageUrl())
  }, [])

  const handleOpenInBrowser = useCallback(async () => {
    setOpening(true)
    setStatusMessage(null)

    const result = await openInExternalBrowser()

    if (result === 'copied') {
      setStatusMessage('URL copied, please paste in your browser')
    } else if (result === 'copy-failed') {
      setStatusMessage('Could not copy URL. Please copy the link below manually.')
    }

    setOpening(false)
  }, [])

  if (!blocked) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0b1020] px-5 py-10"
      role="dialog"
      aria-modal="true"
      aria-labelledby="in-app-browser-title"
    >
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-lg">
          <Image
            src="/icon-192x192.png"
            alt="AIMANI"
            width={64}
            height={64}
            className="h-14 w-14 object-contain"
            priority
          />
        </div>

        <p className="text-xs font-medium uppercase tracking-[0.24em] text-cyan-300/85">
          AIMANI
        </p>

        <h1
          id="in-app-browser-title"
          className="mt-3 text-lg font-semibold leading-snug text-white sm:text-xl"
        >
          For the best experience, please open this page in your browser.
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          원활한 이용을 위해 외부 브라우저에서 열어주세요.
        </p>

        <button
          type="button"
          onClick={() => void handleOpenInBrowser()}
          disabled={opening}
          className="mt-8 w-full rounded-2xl bg-cyan-400 px-4 py-3.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {opening ? 'Opening…' : 'Open in Browser'}
        </button>

        {statusMessage ? (
          <p className="mt-4 text-sm text-cyan-200/90" role="status">
            {statusMessage}
          </p>
        ) : null}

        <div className="mt-8 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Current URL
          </p>
          <p className="mt-2 break-all font-mono text-xs leading-relaxed text-slate-300">
            {pageUrl}
          </p>
        </div>
      </div>
    </div>
  )
}
