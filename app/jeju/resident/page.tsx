'use client'

/**
 * Resident mode home screen — "제주 어르신 도우미"
 *
 * Accessibility-first, same palette + TTS pattern as support/page.tsx.
 * Hero card navigates to /jeju/resident/support; grid cards show 준비중 inline.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// ── Theme (identical to support/page.tsx) ─────────────────────────────────────

const C = {
  bg: '#E8F2F5',
  surface: '#FFFFFF',
  ink: '#0F2233',
  inkSoft: '#33475B',
  sea: '#0A5C7A',
  seaStrong: '#07445B',
  focus: '#C2410C',
  mutedBg: '#F0F4F6',
  mutedBorder: '#B7CDD6',
  mutedInk: '#4A6070',
  badgeBg: '#D1E8EE',
  badgeInk: '#225567',
}

// ── Grid card data ─────────────────────────────────────────────────────────────

const GRID_CARDS = [
  { emoji: '🏥', label: '병원·약 찾기' },
  { emoji: '🚌', label: '버스·교통' },
  { emoji: '📰', label: '오늘의 소식' },
  { emoji: '📄', label: '고지서·문서 읽기' },
  { emoji: '🛡️', label: '수상한 문자 확인' },
  { emoji: '🖥️', label: '무인기계 도움' },
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function ResidentHomePage() {
  const router = useRouter()
  const [ttsSupported, setTtsSupported] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [toastTimer, setToastTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setTtsSupported(true)
    }
  }, [])

  // ── TTS ────────────────────────────────────────────────────────────────────

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
    },
    [ttsSupported]
  )

  // ── Toast for 준비중 cards ─────────────────────────────────────────────────

  const showToast = useCallback(
    (label: string) => {
      if (toastTimer) clearTimeout(toastTimer)
      setToastMsg(`${label}: 곧 만나요. 준비 중이에요.`)
      speak('곧 만나요. 준비 중이에요.')
      const t = setTimeout(() => setToastMsg(null), 3500)
      setToastTimer(t)
    },
    [toastTimer, speak]
  )

  const homeNarration =
    '제주 어르신 도우미입니다. 필요한 도움을 골라보세요. 나에게 맞는 복지 찾기를 누르면 시작할 수 있어요.'

  return (
    <div style={styles.root}>
      <style>{GLOBAL_CSS}</style>

      {/* Sticky top bar — same position as support page */}
      <div style={styles.topBar}>
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
        {/* Heading */}
        <header style={styles.header}>
          <h1 style={styles.h1}>제주 어르신 도우미</h1>
          <p style={styles.lead}>필요한 도움을 골라보세요.</p>
        </header>

        {/* Hero card — LIVE */}
        <button
          type="button"
          className="rh-hero"
          style={styles.hero}
          onClick={() => {
            if (ttsSupported && typeof window !== 'undefined') {
              try { window.speechSynthesis.cancel() } catch { /* no-op */ }
            }
            router.push('/jeju/resident/support')
          }}
          aria-label="나에게 맞는 복지 찾기 — 시작하기"
        >
          <span style={styles.heroEmoji} aria-hidden>🏠</span>
          <span style={styles.heroLabel}>나에게 맞는 복지 찾기</span>
          <span style={styles.heroSub}>
            몇 가지 질문에 답하면<br />받을 수 있는 복지를 찾아드려요.
          </span>
          <span style={styles.heroArrow} aria-hidden>→</span>
        </button>

        {/* Peek label */}
        <p style={styles.gridHint} aria-hidden>더 많은 메뉴</p>

        {/* Grid of 준비중 cards */}
        <div style={styles.grid} role="list">
          {GRID_CARDS.map(({ emoji, label }) => (
            <button
              key={label}
              type="button"
              role="listitem"
              className="rh-card"
              style={styles.card}
              onClick={() => showToast(label)}
              aria-label={`${label} — 준비 중`}
            >
              <span style={styles.cardEmoji} aria-hidden>{emoji}</span>
              <span style={styles.cardLabel}>{label}</span>
              <span style={styles.badge} aria-hidden>준비중</span>
            </button>
          ))}
        </div>

        {/* Toast */}
        {toastMsg && (
          <div
            role="status"
            aria-live="polite"
            style={styles.toast}
          >
            {toastMsg}
          </div>
        )}
      </main>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

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
  topBar: {
    width: '100%',
    maxWidth: 640,
    display: 'flex',
    justifyContent: 'flex-end',
    position: 'sticky',
    top: 0,
    background: C.bg,
    paddingTop: 10,
    paddingBottom: 8,
    zIndex: 5,
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
  frame: {
    width: '100%',
    maxWidth: 640,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 4,
  },
  h1: {
    fontSize: 38,
    fontWeight: 900,
    color: C.ink,
    margin: 0,
    textAlign: 'center',
    lineHeight: 1.25,
  },
  lead: {
    fontSize: 22,
    color: C.inkSoft,
    margin: 0,
    textAlign: 'center',
    lineHeight: 1.5,
  },
  // Hero card
  hero: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
    width: '100%',
    minHeight: 160,
    background: C.sea,
    border: 'none',
    borderRadius: 22,
    padding: '24px 24px 20px',
    cursor: 'pointer',
    position: 'relative',
    boxShadow: '0 8px 28px rgba(10,92,122,0.28)',
    textAlign: 'left',
    boxSizing: 'border-box',
  },
  heroEmoji: {
    fontSize: 48,
    lineHeight: 1,
  },
  heroLabel: {
    fontSize: 32,
    fontWeight: 900,
    color: '#FFFFFF',
    lineHeight: 1.25,
  },
  heroSub: {
    fontSize: 21,
    color: '#C8E8F0',
    lineHeight: 1.55,
  },
  heroArrow: {
    position: 'absolute',
    right: 22,
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: 32,
    color: '#FFFFFF',
    opacity: 0.75,
  },
  gridHint: {
    fontSize: 18,
    fontWeight: 700,
    color: C.mutedInk,
    textAlign: 'center',
    margin: '4px 0 0',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 14,
  },
  // Grid card
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 110,
    background: C.mutedBg,
    border: `2px solid ${C.mutedBorder}`,
    borderRadius: 18,
    cursor: 'pointer',
    padding: '18px 12px',
    position: 'relative',
    boxSizing: 'border-box',
  },
  cardEmoji: {
    fontSize: 38,
    lineHeight: 1,
  },
  cardLabel: {
    fontSize: 22,
    fontWeight: 800,
    color: C.mutedInk,
    textAlign: 'center',
    lineHeight: 1.3,
  },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    background: C.badgeBg,
    color: C.badgeInk,
    fontSize: 14,
    fontWeight: 700,
    borderRadius: 8,
    padding: '2px 8px',
  },
  toast: {
    position: 'fixed',
    bottom: 28,
    left: '50%',
    transform: 'translateX(-50%)',
    background: C.ink,
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: 700,
    borderRadius: 16,
    padding: '16px 28px',
    maxWidth: 520,
    width: 'calc(100% - 32px)',
    textAlign: 'center',
    zIndex: 100,
    boxShadow: '0 6px 24px rgba(15,34,51,0.30)',
    boxSizing: 'border-box',
  },
}

// ── Global CSS ────────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
  .rh-hero:focus-visible,
  .rh-card:focus-visible,
  .rh-ctrl:focus-visible {
    outline: 5px solid ${C.focus};
    outline-offset: 3px;
  }
  .rh-hero:hover { background: ${C.seaStrong}; }
  .rh-card:hover { background: #E2ECF0; border-color: ${C.sea}; }
  .rh-hero, .rh-card, .rh-ctrl {
    transition: background 0.12s ease, transform 0.07s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .rh-hero:active { transform: scale(0.985); }
  .rh-card:active { transform: scale(0.97); }
  @media (prefers-reduced-motion: reduce) {
    .rh-hero, .rh-card, .rh-ctrl {
      transition: none !important;
      transform: none !important;
    }
  }
  @media (max-width: 400px) {
    .rh-grid { grid-template-columns: 1fr !important; }
  }
`
