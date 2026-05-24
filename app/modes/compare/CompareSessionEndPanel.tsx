'use client'

import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import { PUBLIC_SHARE_BASE } from '@/lib/compare/session-types'

const SHARE_TWEET_TEXT = 'Check out this AI comparison on AIMANI!'
const SHARE_PLATFORMS = ['twitter', 'whatsapp', 'reddit', 'threads'] as const

type SharePlatform = (typeof SHARE_PLATFORMS)[number]

const PLATFORM_LABELS: Record<(typeof SHARE_PLATFORMS)[number] | 'copy', string> = {
  twitter: 'X',
  whatsapp: 'WhatsApp',
  reddit: 'Reddit',
  threads: 'Threads',
  copy: 'Copy link',
}

function sharePageUrl(shareId: string): string {
  return `${PUBLIC_SHARE_BASE}/${shareId}`
}

function platformIntentUrl(platform: SharePlatform, shareUrl: string): string | null {
  switch (platform) {
    case 'twitter':
      return `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(SHARE_TWEET_TEXT)}`
    case 'whatsapp':
      return `https://wa.me/?text=${encodeURIComponent(`Check this AI comparison: ${shareUrl}`)}`
    case 'reddit':
      return `https://reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent('AI Compare on AIMANI')}`
    case 'threads':
      return `https://www.threads.net/intent/post?text=${encodeURIComponent(shareUrl)}`
    default:
      return null
  }
}

type CompareSessionEndPanelProps = {
  votedAi: string | null
  compareSessionId: string
  shareId: string
  visible: boolean
  saveFailed?: boolean
  onResolveShareUrl: () => Promise<string | null>
  onDone: () => void
}

export function CompareSessionEndPanel({
  votedAi,
  compareSessionId,
  shareId,
  visible,
  saveFailed = false,
  onResolveShareUrl,
  onDone,
}: CompareSessionEndPanelProps) {
  const [goPublicDone, setGoPublicDone] = useState(false)
  const [goPublicLoading, setGoPublicLoading] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [shareResolving, setShareResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setGoPublicDone(false)
    setGoPublicLoading(false)
    setShareCopied(false)
    setShareResolving(false)
    setError(null)
  }, [compareSessionId, shareId])

  const resolveShareUrl = useCallback(async (): Promise<string | null> => {
    if (shareId) {
      return sharePageUrl(shareId)
    }
    setShareResolving(true)
    try {
      return await onResolveShareUrl()
    } finally {
      setShareResolving(false)
    }
  }, [shareId, onResolveShareUrl])

  const withShareUrl = useCallback(
    async (action: (shareUrl: string) => void) => {
      setError(null)
      const shareUrl = await resolveShareUrl()
      if (!shareUrl) {
        setError('Could not save session for sharing')
        return
      }
      action(shareUrl)
    },
    [resolveShareUrl]
  )

  const openPlatform = useCallback(
    (platform: SharePlatform) => {
      void withShareUrl((shareUrl) => {
        const intent = platformIntentUrl(platform, shareUrl)
        if (intent) {
          window.open(intent, '_blank', 'noopener,noreferrer,width=600,height=720')
        }
      })
    },
    [withShareUrl]
  )

  const copyShareLink = useCallback(() => {
    void withShareUrl(async (shareUrl) => {
      try {
        await navigator.clipboard.writeText(shareUrl)
        setShareCopied(true)
        window.setTimeout(() => setShareCopied(false), 2000)
      } catch {
        setError('Could not copy')
      }
    })
  }, [withShareUrl])

  const handleGoPublic = useCallback(async () => {
    if (saveFailed || goPublicDone || goPublicLoading || !compareSessionId) return
    setGoPublicLoading(true)
    setError(null)
    try {
      const res = await authenticatedFetch('/api/compare/go-public', {
        method: 'POST',
        json: { session_id: compareSessionId },
      })
      const j = (await res.json()) as { share_id?: string; error?: string }
      if (!res.ok) {
        setError(j.error ?? 'Could not go public')
        return
      }
      setGoPublicDone(true)
    } catch {
      setError('Could not go public')
    } finally {
      setGoPublicLoading(false)
    }
  }, [compareSessionId, goPublicDone, goPublicLoading, saveFailed])

  const pillClass =
    'inline-flex items-center justify-center rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:border-white/25 hover:bg-white/10 disabled:opacity-50'

  const handleDone = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      onDone()
    },
    [onDone]
  )

  return (
    <div
      className={[
        'mt-4 rounded-2xl border border-white/10 bg-[#121a2e] p-4 shadow-[0_-8px_32px_rgba(0,0,0,0.45)] transition-all duration-300 ease-out',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      ].join(' ')}
    >
      {votedAi ? (
        <p className="text-sm text-slate-200">🏆 {votedAi} answered best</p>
      ) : null}

      <p className="mt-4 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
        SHARE YOUR SESSION
      </p>
      <div className="mt-2 flex flex-wrap items-start gap-2">
        {SHARE_PLATFORMS.map((platform) => (
          <button
            key={platform}
            type="button"
            className={pillClass}
            disabled={shareResolving}
            onClick={() => openPlatform(platform)}
          >
            {PLATFORM_LABELS[platform]}
          </button>
        ))}
        <div className="flex min-w-[7rem] flex-col items-start">
          <button
            type="button"
            className={pillClass}
            disabled={shareResolving}
            onClick={copyShareLink}
          >
            {shareCopied ? 'Copied!' : PLATFORM_LABELS.copy}
          </button>
          <p className="mt-1 max-w-[14rem] text-xs italic text-slate-500">
            KakaoTalk / TikTok / Instagram / Discord — copy link and paste
          </p>
        </div>
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={handleDone}
          className="inline-flex w-full items-center justify-center rounded-full border border-white/25 bg-transparent px-4 py-2 text-xs font-semibold text-white transition hover:border-white/40 hover:bg-white/10 sm:w-auto"
        >
          Exit
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-white/12 bg-[#1a2438]/90 p-3">
        {saveFailed ? (
          <p className="text-sm text-slate-400">Could not save session</p>
        ) : goPublicDone ? (
          <div className="text-sm">
            <p className="font-medium text-slate-200">✅ Indexed!</p>
            <p className="mt-1 text-slate-400">aimani.ai/share/{shareId}</p>
          </div>
        ) : (
          <>
            <p className="text-sm font-bold text-white">
              <span className="mr-1.5" aria-hidden>
                🔍
              </span>
              Put this on Google
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Let search engines find this debate · No personal info shared
            </p>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => void handleGoPublic()}
                disabled={goPublicLoading || !compareSessionId}
                className="inline-flex items-center justify-center rounded-full bg-cyan-500 px-4 py-1.5 text-sm font-semibold text-slate-950 shadow-[0_0_20px_rgba(34,211,238,0.25)] transition hover:bg-cyan-400 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {goPublicLoading ? 'Publishing…' : 'Go Public'}
              </button>
            </div>
          </>
        )}
      </div>
      {error ? <p className="mt-2 text-xs text-amber-300/90">{error}</p> : null}
    </div>
  )
}
