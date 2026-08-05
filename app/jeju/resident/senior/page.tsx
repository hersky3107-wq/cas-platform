'use client'

/**
 * 어르신 도민 mode home — "제주 어르신 도우미"
 *
 * Layout deliberately differs from care's "3 stacked hero banners + grid":
 *   - Compact sticky 긴급 strip at the top (always visible, not a hero card)
 *   - Uniform 2-col tile grid for ALL features (복지·말벗 included as equal tiles)
 *
 * Accessibility-first: large text, TTS, two-gate 119.
 */

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

const C = {
  bg: '#FBF4E6',
  surface: '#FFFFFF',
  ink: '#12263A',
  inkSoft: '#3C4C60',
  sea: '#0E4E8A',
  seaStrong: '#0A3A66',
  focus: '#E8590C',
  mutedBg: '#F5EAD6',
  mutedBorder: '#D9C6A2',
  mutedInk: '#4E5568',
  badgeBg: '#FCE6C6',
  badgeInk: '#0A3A66',
}

/**
 * Uniform tiles. Icons deliberately differ from care's set (🧠📅🏥📰📖📄🛡️🖥️)
 * so the home doesn't look like the same app. `?from=senior` makes shared
 * feature pages return here on "처음으로".
 */
const TILES: { emoji: string; label: string; href: string; ariaLabel?: string }[] = [
  { emoji: '🤝', label: '나에게 맞는 복지 찾기', href: '/jeju/resident/support?from=senior', ariaLabel: '나에게 맞는 복지 찾기 — 시작하기' },
  { emoji: '🗣️', label: '말벗·안부', href: '/jeju/resident/companion', ariaLabel: '말벗, 안부 — 오늘 하루 이야기 나누기' },
  { emoji: '🧩', label: '오늘의 뇌 운동', href: '/jeju/resident/brain?from=senior' },
  { emoji: '☀️', label: '오늘 날짜·날씨', href: '/jeju/resident/today?from=senior' },
  { emoji: '🩺', label: '병원·약 찾기', href: '/jeju/resident/medical?from=senior' },
  { emoji: '🚌', label: '버스·교통', href: '/jeju/resident/bus?from=senior' },
  { emoji: '📻', label: '오늘의 소식', href: '/jeju/resident/news-senior' },
  { emoji: '📕', label: '이야기 · 좋은 말', href: '/jeju/resident/tale' },
  { emoji: '🧾', label: '고지서·문서 읽기', href: '/jeju/resident/photo?mode=document&from=senior' },
  { emoji: '🔒', label: '수상한 문자 확인', href: '/jeju/resident/photo?mode=phishing&from=senior' },
  { emoji: '🏧', label: '무인기계 도움', href: '/jeju/resident/photo?mode=kiosk&from=senior' },
]

export default function JejuResidentSeniorPage() {
  const router = useRouter()
  const [ttsSupported, setTtsSupported] = useState(false)
  const [sosPhase, setSosPhase] = useState<null | 'confirm' | 'countdown'>(null)
  const [countdown, setCountdown] = useState(5)
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setTtsSupported(true)
    }
  }, [])

  const speak = useCallback(
    (text: string) => {
      if (!ttsSupported || typeof window === 'undefined') return
      try {
        window.speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(text)
        u.lang = 'ko-KR'
        u.rate = 0.92
        window.speechSynthesis.speak(u)
      } catch {
        /* no-op */
      }
    },
    [ttsSupported]
  )

  useEffect(
    () => () => {
      if (ttsSupported && typeof window !== 'undefined') {
        try { window.speechSynthesis.cancel() } catch { /* no-op */ }
      }
      if (countdownTimer.current) clearInterval(countdownTimer.current)
    },
    [ttsSupported]
  )

  const clearTimer = useCallback(() => {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current)
      countdownTimer.current = null
    }
  }, [])

  const startEmergency = useCallback(() => {
    speak('119에 전화하시겠어요? 예 또는 아니요를 누르세요.')
    setSosPhase('confirm')
  }, [speak])

  const confirmNo = useCallback(() => setSosPhase(null), [])

  const confirmYes = useCallback(() => {
    speak('5초 뒤에 119에 전화합니다. 취소하려면 취소를 누르세요.')
    setCountdown(5)
    setSosPhase('countdown')
  }, [speak])

  const cancelEmergency = useCallback(() => {
    clearTimer()
    setSosPhase(null)
    speak('취소되었습니다.')
  }, [clearTimer, speak])

  const dialNow = useCallback(() => {
    clearTimer()
    setSosPhase(null)
    if (typeof window !== 'undefined') {
      try { window.speechSynthesis.cancel() } catch { /* no-op */ }
      window.location.href = 'tel:119'
    }
  }, [clearTimer])

  useEffect(() => {
    if (sosPhase !== 'countdown') return
    clearTimer()
    countdownTimer.current = setInterval(() => {
      setCountdown((n) => Math.max(0, n - 1))
    }, 1000)
    return clearTimer
  }, [sosPhase]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (sosPhase === 'countdown' && countdown === 0) {
      clearTimer()
      setSosPhase(null)
      if (typeof window !== 'undefined') {
        try { window.speechSynthesis.cancel() } catch { /* no-op */ }
        window.location.href = 'tel:119'
      }
    }
  }, [countdown, sosPhase, clearTimer])

  const homeNarration =
    '혼저 옵서. 제주 어르신 도우미우다. 필요한 걸 골릅서. 위쪽 빨간 줄은 긴급 도움이고, 아래 칸에서 복지·말벗·병원 등 메뉴를 고르면 됩니다.'

  const goTo = useCallback(
    (href: string) => {
      if (ttsSupported && typeof window !== 'undefined') {
        try { window.speechSynthesis.cancel() } catch { /* no-op */ }
      }
      router.push(href)
    },
    [router, ttsSupported]
  )

  return (
    <div style={styles.root}>
      <style>{GLOBAL_CSS}</style>

      {/* Compact sticky 긴급 strip — always visible, NOT a hero card */}
      <div style={styles.sosStripWrap}>
        <button
          type="button"
          className="rh-sos"
          style={styles.sosStrip}
          onClick={startEmergency}
          aria-label="긴급 도움 — 119에 전화할 때 누르세요"
        >
          <span style={styles.sosStripEmoji} aria-hidden>🚨</span>
          <span style={styles.sosStripText}>긴급 도움 · 119</span>
          <span style={styles.sosStripHint}>필요할 때 누르세요</span>
        </button>
      </div>

      <div style={styles.topBar}>
        <Link href="/jeju/resident" style={styles.backLink} aria-label="도민 홈으로">
          ← 도민
        </Link>
        {ttsSupported && (
          <button
            type="button"
            className="rh-ctrl"
            style={styles.ctrlBtn}
            onClick={() => speak(homeNarration)}
            aria-label="이 화면 읽어주기"
          >
            <span aria-hidden>🔊</span> 읽어주기
          </button>
        )}
      </div>

      <main style={styles.frame}>
        <header style={styles.header}>
          <h1 style={styles.h1}>제주 어르신 도우미</h1>
          <p style={styles.lead}>혼저 옵서. 필요한 걸 골릅서.</p>
        </header>

        {/* Uniform 2-col tile grid — every feature same size, no stacked banners */}
        <div style={styles.grid} role="list">
          {TILES.map(({ emoji, label, href, ariaLabel }) => (
            <button
              key={label}
              type="button"
              role="listitem"
              className="rh-tile"
              style={styles.tile}
              onClick={() => goTo(href)}
              aria-label={ariaLabel ?? label}
            >
              <span style={styles.tileEmoji} aria-hidden>{emoji}</span>
              <span style={styles.tileLabel}>{label}</span>
            </button>
          ))}
        </div>
      </main>

      {sosPhase === 'confirm' && (
        <div style={styles.sosOverlay} role="alertdialog" aria-modal="true" aria-label="119 전화 확인">
          <p style={styles.sosOverlayTitle}>정말 119에<br />전화할까요?</p>
          <div style={styles.sosGateRow}>
            <button type="button" className="rh-confirm-yes" style={styles.sosYesBtn} onClick={confirmYes} aria-label="예, 119에 전화하기">
              예
            </button>
            <button type="button" className="rh-cancel" style={styles.sosNoBtn} onClick={confirmNo} aria-label="아니요, 취소하기">
              아니요
            </button>
          </div>
        </div>
      )}

      {sosPhase === 'countdown' && (
        <div style={styles.sosOverlay} role="alertdialog" aria-modal="true" aria-label="119 전화 카운트다운">
          <p style={styles.sosOverlayTitle}>119에 전화합니다</p>
          <div style={styles.sosCount} aria-live="assertive" aria-atomic="true">{countdown}</div>
          <p style={styles.sosOverlayHint}>잠시 후 전화가 걸려요</p>
          <button type="button" className="rh-confirm-yes" style={styles.sosDialNowBtn} onClick={dialNow} aria-label="지금 바로 119 전화하기">
            지금 바로 전화
          </button>
          <button type="button" className="rh-cancel" style={styles.sosCancelBtn} onClick={cancelEmergency} aria-label="전화 취소하기">
            취소
          </button>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100dvh',
    background: C.bg,
    color: C.ink,
    fontFamily:
      "'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '0 16px 40px',
    boxSizing: 'border-box',
  },
  sosStripWrap: {
    position: 'sticky',
    top: 0,
    zIndex: 10,
    width: '100vw',
    marginLeft: 'calc(50% - 50vw)',
    marginRight: 'calc(50% - 50vw)',
  },
  sosStrip: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    minHeight: 56,
    background: '#B91C1C',
    border: 'none',
    borderBottom: '3px solid #7F1D1D',
    borderRadius: 0,
    cursor: 'pointer',
    padding: '10px 16px',
    boxSizing: 'border-box',
  },
  sosStripEmoji: { fontSize: 26, lineHeight: 1 },
  sosStripText: { fontSize: 24, fontWeight: 900, color: '#FFFFFF', lineHeight: 1.1 },
  sosStripHint: { fontSize: 16, fontWeight: 700, color: '#FEE2E2', lineHeight: 1.2 },
  topBar: {
    width: '100%',
    maxWidth: 640,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
    zIndex: 5,
  },
  backLink: {
    fontSize: 20,
    fontWeight: 800,
    color: C.sea,
    textDecoration: 'none',
    padding: '8px 4px',
  },
  ctrlBtn: {
    minHeight: 54,
    fontSize: 21,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `3px solid ${C.sea}`,
    borderRadius: 14,
    cursor: 'pointer',
    padding: '6px 20px',
  },
  frame: { width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 18 },
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingBottom: 2 },
  h1: { fontSize: 38, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.25 },
  lead: { fontSize: 22, color: C.inkSoft, margin: 0, textAlign: 'center', lineHeight: 1.5 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 128,
    background: C.surface,
    border: `3px solid ${C.sea}`,
    borderRadius: 18,
    cursor: 'pointer',
    padding: '20px 12px',
    boxSizing: 'border-box',
    boxShadow: '0 2px 0 rgba(14,78,138,0.12)',
  },
  tileEmoji: { fontSize: 42, lineHeight: 1 },
  tileLabel: {
    fontSize: 22,
    fontWeight: 800,
    color: C.ink,
    textAlign: 'center',
    lineHeight: 1.3,
  },
  sosOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    background: '#7F1D1D',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    padding: '32px 20px',
    boxSizing: 'border-box',
  },
  sosOverlayTitle: { fontSize: 44, fontWeight: 900, color: '#FFFFFF', textAlign: 'center', margin: 0, lineHeight: 1.25 },
  sosGateRow: { display: 'flex', gap: 16, width: '100%', maxWidth: 540 },
  sosYesBtn: {
    flex: 1,
    minHeight: 110,
    background: '#FFFFFF',
    color: '#7F1D1D',
    border: '5px solid #FFFFFF',
    borderRadius: 20,
    fontSize: 42,
    fontWeight: 900,
    cursor: 'pointer',
  },
  sosNoBtn: {
    flex: 2,
    minHeight: 110,
    background: '#FEE2E2',
    color: '#7F1D1D',
    border: '5px solid #FFFFFF',
    borderRadius: 20,
    fontSize: 42,
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: '0 8px 28px rgba(0,0,0,0.25)',
  },
  sosCount: { fontSize: 160, fontWeight: 900, color: '#FFFFFF', lineHeight: 1, fontVariantNumeric: 'tabular-nums' },
  sosOverlayHint: { fontSize: 24, fontWeight: 700, color: '#FEE2E2', textAlign: 'center', margin: 0 },
  sosDialNowBtn: {
    width: '100%',
    maxWidth: 520,
    minHeight: 80,
    background: 'rgba(255,255,255,0.18)',
    color: '#FFFFFF',
    border: '3px solid rgba(255,255,255,0.60)',
    borderRadius: 18,
    fontSize: 28,
    fontWeight: 800,
    cursor: 'pointer',
  },
  sosCancelBtn: {
    width: '100%',
    maxWidth: 520,
    minHeight: 140,
    background: '#FFFFFF',
    color: '#7F1D1D',
    border: '5px solid #FFFFFF',
    borderRadius: 24,
    fontSize: 56,
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: '0 8px 28px rgba(0,0,0,0.30)',
  },
}

const GLOBAL_CSS = `
  .rh-tile:focus-visible,
  .rh-ctrl:focus-visible,
  .rh-sos:focus-visible,
  .rh-cancel:focus-visible,
  .rh-confirm-yes:focus-visible {
    outline: 5px solid ${C.focus};
    outline-offset: 3px;
  }
  .rh-cancel:focus-visible, .rh-confirm-yes:focus-visible { outline-color: #FFD400; }
  .rh-tile:hover { background: #EAF2FB; border-color: ${C.seaStrong}; }
  .rh-sos:hover { background: #991B1B; }
  .rh-cancel:hover, .rh-confirm-yes:hover { filter: brightness(0.94); }
  .rh-tile, .rh-ctrl, .rh-sos, .rh-cancel, .rh-confirm-yes {
    transition: background 0.12s ease, transform 0.07s ease, filter 0.12s ease, border-color 0.12s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .rh-tile:active { transform: scale(0.97); }
  .rh-sos:active { transform: scale(0.99); }
  .rh-cancel:active, .rh-confirm-yes:active { transform: scale(0.97); }
`
