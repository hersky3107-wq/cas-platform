'use client'

import { useCallback, useMemo, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  buildSharePayload,
  prefersNativeShare,
  type SharePlatform,
} from '@/lib/share/build-share'

export type ShareButtonsProps = {
  modeName: string
  url?: string
  className?: string
  title?: string
}

const PLATFORM_ORDER = [
  'twitter',
  'whatsapp',
  'reddit',
  'threads',
] as const satisfies readonly SharePlatform[]

type VisibleSharePlatform = (typeof PLATFORM_ORDER)[number]

const PLATFORM_LABELS: Record<VisibleSharePlatform | 'copy', string> = {
  twitter: 'X',
  whatsapp: 'WhatsApp',
  reddit: 'Reddit',
  threads: 'Threads',
  copy: 'Copy link',
}

function CopyLinkButton({
  copyOk,
  onCopy,
  className,
}: {
  copyOk: boolean
  onCopy: () => void
  className: string
}) {
  return (
    <div className="flex w-full min-w-[7rem] flex-col items-start sm:w-auto">
      <button type="button" onClick={onCopy} className={className} aria-label="Copy link">
        {copyOk ? 'Copied!' : PLATFORM_LABELS.copy}
      </button>
      <p className="mt-1 max-w-[14rem] text-xs italic text-zinc-500">
        KakaoTalk / TikTok / Instagram / Discord — copy link and paste
      </p>
    </div>
  )
}

export default function ShareButtons({
  modeName,
  url,
  className = '',
  title = 'Share your session',
}: ShareButtonsProps) {
  const pathname = usePathname()
  const payload = useMemo(() => {
    const pageUrl =
      url ?? (typeof window !== 'undefined' ? window.location.href : undefined)
    return buildSharePayload(modeName, pageUrl)
  }, [modeName, url, pathname])
  const [copyOk, setCopyOk] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const useNative = prefersNativeShare()

  const handleNativeShare = useCallback(async () => {
    if (!navigator.share) return
    setStatus(null)
    try {
      await navigator.share({
        title: 'AIMANI.ai',
        text: payload.text,
        url: payload.url,
      })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setStatus('Could not open share sheet')
      }
    }
  }, [payload])

  const openPlatform = useCallback(
    (platform: VisibleSharePlatform) => {
      setStatus(null)
      window.open(payload.platformUrls[platform], '_blank', 'noopener,noreferrer,width=600,height=720')
    },
    [payload]
  )

  const copyLink = useCallback(async () => {
    setStatus(null)
    try {
      await navigator.clipboard.writeText(payload.url)
      setCopyOk(true)
      window.setTimeout(() => setCopyOk(false), 2200)
    } catch {
      setStatus('Could not copy link')
    }
  }, [payload.url])

  const platformBtnClass =
    'inline-flex items-center justify-center rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:border-white/25 hover:bg-white/10'

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.03] p-4 ${className}`.trim()}
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/50">
        {title}
      </p>

      {useNative ? (
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void handleNativeShare()}
            className="w-full rounded-xl bg-cyan-500 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
          >
            Share
          </button>
          <div className="flex flex-wrap gap-2">
            {PLATFORM_ORDER.map((platform) => (
              <button
                key={platform}
                type="button"
                onClick={() => openPlatform(platform)}
                className={platformBtnClass}
              >
                {PLATFORM_LABELS[platform]}
              </button>
            ))}
            <CopyLinkButton
              copyOk={copyOk}
              onCopy={() => void copyLink()}
              className={platformBtnClass}
            />
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {PLATFORM_ORDER.map((platform) => (
            <button
              key={platform}
              type="button"
              onClick={() => openPlatform(platform)}
              className={platformBtnClass}
              aria-label={`Share on ${PLATFORM_LABELS[platform]}`}
            >
              {PLATFORM_LABELS[platform]}
            </button>
          ))}
          <CopyLinkButton
            copyOk={copyOk}
            onCopy={() => void copyLink()}
            className={platformBtnClass}
          />
        </div>
      )}

      {status ? <p className="mt-2 text-xs text-amber-300/90">{status}</p> : null}
    </div>
  )
}
