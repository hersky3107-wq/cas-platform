export const SHARE_SITE_URL = 'https://aimani.ai'

export type SharePlatform =
  | 'twitter'
  | 'tiktok'
  | 'kakao'
  | 'whatsapp'
  | 'reddit'
  | 'threads'

export type SharePayload = {
  text: string
  url: string
  copyText: string
  platformUrls: Record<SharePlatform, string>
}

export function buildShareText(modeName: string): string {
  return `I just tried ${modeName} on AIMANI.ai! Check it out: ${SHARE_SITE_URL}`
}

/** Explicit url, else current page (client), else site homepage (SSR). */
export function resolveShareUrl(url?: string): string {
  const trimmed = url?.trim()
  const raw =
    trimmed ||
    (typeof window !== 'undefined' ? window.location.href : '') ||
    SHARE_SITE_URL
  return raw.replace(/\/$/, '') || SHARE_SITE_URL
}

export function buildSharePayload(modeName: string, url?: string): SharePayload {
  const shareUrl = resolveShareUrl(url)
  const text = buildShareText(modeName)
  const combined = text

  return {
    text,
    url: shareUrl,
    copyText: combined,
    platformUrls: {
      twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
      tiktok: `https://www.tiktok.com/share?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`,
      kakao: shareUrl,
      whatsapp: `https://wa.me/?text=${encodeURIComponent(combined)}`,
      reddit: `https://reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(text)}`,
      threads: `https://threads.net/intent/post?text=${encodeURIComponent(text)}`,
    },
  }
}

export function prefersNativeShare(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  if (typeof navigator.share !== 'function') return false
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  const narrow = window.matchMedia('(max-width: 768px)').matches
  return mobileUa || narrow
}

export function shareViaKakaoTalk(payload: SharePayload): void {
  const combined = payload.copyText
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    window.location.href = `kakaotalk://msg/text/${encodeURIComponent(combined)}`
    return
  }
  void navigator.clipboard.writeText(combined)
}
