const IN_APP_BROWSER_PATTERNS: RegExp[] = [
  /KAKAOTALK/i,
  /musical_ly|BytedanceWebview/i,
  /Instagram/i,
  /Line\//i,
  /NAVER/i,
  /FBAN|FBAV/i,
  /Twitter/i,
]

export function isInAppBrowser(userAgent?: string): boolean {
  const ua =
    userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  if (!ua) return false
  return IN_APP_BROWSER_PATTERNS.some((pattern) => pattern.test(ua))
}

export function isAndroid(userAgent?: string): boolean {
  const ua =
    userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  return /Android/i.test(ua)
}

export function isIOS(userAgent?: string): boolean {
  const ua =
    userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  return /iPhone|iPad|iPod/i.test(ua)
}

export function getCurrentPageUrl(): string {
  if (typeof window === 'undefined') return ''
  return window.location.href
}

export function buildAndroidChromeIntentUrl(): string {
  if (typeof window === 'undefined') return ''
  const { host, pathname, search } = window.location
  return `intent://${host}${pathname}${search}#Intent;scheme=https;package=com.android.chrome;end`
}

export async function copyUrlToClipboard(url: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url)
      return true
    } catch {
      // fall through to legacy copy
    }
  }

  if (typeof document === 'undefined') return false

  try {
    const textarea = document.createElement('textarea')
    textarea.value = url
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

export type OpenInBrowserResult = 'android-intent' | 'ios-redirect' | 'copied' | 'copy-failed'

/**
 * Android: Chrome intent URL. iOS: same-page navigation. Else: clipboard copy.
 */
export async function openInExternalBrowser(): Promise<OpenInBrowserResult> {
  if (typeof window === 'undefined') return 'copy-failed'

  const url = getCurrentPageUrl()

  if (isAndroid()) {
    window.location.href = buildAndroidChromeIntentUrl()
    return 'android-intent'
  }

  if (isIOS()) {
    window.location.replace(url)
    return 'ios-redirect'
  }

  const copied = await copyUrlToClipboard(url)
  return copied ? 'copied' : 'copy-failed'
}
