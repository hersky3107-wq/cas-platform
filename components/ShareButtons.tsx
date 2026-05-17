'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  buildSharePayload,
  prefersNativeShare,
  shareViaKakaoTalk,
  type SharePlatform,
} from '@/lib/share/build-share'

export type ShareButtonsProps = {
  modeName: string
  url?: string
  className?: string
  title?: string
}

const PLATFORM_ORDER: SharePlatform[] = ['twitter', 'tiktok', 'kakao', 'whatsapp']

const PLATFORM_LABELS: Record<SharePlatform | 'copy', string> = {
  twitter: 'X',
  tiktok: 'TikTok',
  kakao: 'KakaoTalk',
  whatsapp: 'WhatsApp',
  copy: 'Copy link',
}

export default function ShareButtons({
  modeName,
  url,
  className = '',
  title = 'Share your session',
}: ShareButtonsProps) {
  const payload = useMemo(() => buildSharePayload(modeName, url), [modeName, url])
  const [copyOk, setCopyOk] = useState(false)
  const [kakaoHint, setKakaoHint] = useState(false)
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
    (platform: SharePlatform) => {
      setStatus(null)
      if (platform === 'kakao') {
        shareViaKakaoTalk(payload)
        if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
          setKakaoHint(true)
          window.setTimeout(() => setKakaoHint(false), 3000)
        }
        return
      }
      window.open(payload.platformUrls[platform], '_blank', 'noopener,noreferrer,width=600,height=720')
    },
    [payload]
  )

  const copyLink = useCallback(async () => {
    setStatus(null)
    try {
      await navigator.clipboard.writeText(payload.copyText)
      setCopyOk(true)
      window.setTimeout(() => setCopyOk(false), 2200)
    } catch {
      setStatus('Could not copy link')
    }
  }, [payload.copyText])

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
            <button type="button" onClick={() => void copyLink()} className={platformBtnClass}>
              {copyOk ? 'Copied!' : PLATFORM_LABELS.copy}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
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
          <button
            type="button"
            onClick={() => void copyLink()}
            className={platformBtnClass}
            aria-label="Copy link"
          >
            {copyOk ? 'Copied!' : PLATFORM_LABELS.copy}
          </button>
        </div>
      )}

      {kakaoHint ? (
        <p className="mt-2 text-xs text-slate-400">
          Link copied — paste into KakaoTalk on desktop.
        </p>
      ) : null}
      {status ? <p className="mt-2 text-xs text-amber-300/90">{status}</p> : null}
    </div>
  )
}
