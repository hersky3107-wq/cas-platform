'use client'

/**
 * National senior-care home screen.
 *
 * Nationalized:
 *   - Gated on the one-time 거주지 설정: if no residence is saved we send the
 *     user to /care/setup first. Once set, the current residence shows as a
 *     small "○○ 기준 · 바꾸기" chip that returns to setup.
 *   - Neutral national name ("어르신 도우미"); 버스·교통 card excluded.
 *
 * Accessibility-first, same palette + TTS pattern as support/page.tsx.
 * Hero card navigates to /care/support; grid cards show 준비중 inline.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getResidence, shortLabel, type Residence } from '@/lib/care/residence'

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

const GRID_CARDS: { emoji: string; label: string; href?: string }[] = [
  { emoji: '🧠', label: '오늘의 뇌 운동', href: '/care/brain' },
  { emoji: '📅', label: '오늘 날짜·날씨', href: '/care/today' },
  { emoji: '🏥', label: '병원·약 찾기', href: '/care/medical' },
  { emoji: '📰', label: '오늘의 소식', href: '/care/news' },
  { emoji: '📖', label: '이야기 · 좋은 말', href: '/care/tale' },
  { emoji: '📄', label: '고지서·문서 읽기', href: '/care/photo?mode=document' },
  { emoji: '🛡️', label: '수상한 문자 확인', href: '/care/photo?mode=phishing' },
  { emoji: '🖥️', label: '무인기계 도움', href: '/care/photo?mode=kiosk' },
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function ResidentHomePage() {
  const router = useRouter()
  const [ttsSupported, setTtsSupported] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [toastTimer, setToastTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  // Residence gate: unset → go to setup first; set → render home + show chip.
  const [residence, setResidenceState] = useState<Residence | null>(null)
  const [ready, setReady] = useState(false)

  // Emergency 119 — two-gate state
  // null = closed; 'confirm' = Gate 1 "정말?"; 'countdown' = Gate 2 timer
  const [sosPhase, setSosPhase] = useState<null | 'confirm' | 'countdown'>(null)
  const [countdown, setCountdown] = useState(5)
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setTtsSupported(true)
    }
  }, [])

  // Gate on residence — redirect to setup when nothing is saved yet.
  useEffect(() => {
    const r = getResidence()
    if (!r) {
      router.replace('/care/setup')
      return
    }
    setResidenceState(r)
    setReady(true)
  }, [router])

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
      if (countdownTimer.current) clearInterval(countdownTimer.current)
    },
    [ttsSupported]
  )

  // ── Emergency 119 — two-gate flow ───────────────────────────────────────────

  const clearTimer = useCallback(() => {
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current)
      countdownTimer.current = null
    }
  }, [])

  // Tap "🚨 긴급 도움" → Gate 1 confirm overlay
  const startEmergency = useCallback(() => {
    speak('119에 전화하시겠어요? 예 또는 아니요를 누르세요.')
    setSosPhase('confirm')
  }, [speak])

  // Gate 1 "아니요" → close, nothing happens
  const confirmNo = useCallback(() => {
    setSosPhase(null)
  }, [])

  // Gate 1 "예" → Gate 2 countdown (5 s)
  const confirmYes = useCallback(() => {
    speak('5초 뒤에 119에 전화합니다. 취소하려면 취소를 누르세요.')
    setCountdown(5)
    setSosPhase('countdown')
  }, [speak])

  // "취소" during countdown → abort
  const cancelEmergency = useCallback(() => {
    clearTimer()
    setSosPhase(null)
    speak('취소되었습니다.')
  }, [clearTimer, speak])

  // "지금 바로 전화" — dial without waiting
  const dialNow = useCallback(() => {
    clearTimer()
    setSosPhase(null)
    if (typeof window !== 'undefined') {
      try { window.speechSynthesis.cancel() } catch { /* no-op */ }
      window.location.href = 'tel:119'
    }
  }, [clearTimer])

  // Run the countdown interval while in 'countdown' phase
  useEffect(() => {
    if (sosPhase !== 'countdown') return
    clearTimer()
    countdownTimer.current = setInterval(() => {
      setCountdown((n) => Math.max(0, n - 1))
    }, 1000)
    return clearTimer
  }, [sosPhase]) // eslint-disable-line react-hooks/exhaustive-deps

  // When countdown hits 0, place the call
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
    '어르신 도우미입니다. 필요한 도움을 골라보세요. 나에게 맞는 복지 찾기를 누르면 시작할 수 있어요. 말벗 안부에서 오늘 하루 이야기도 나눌 수 있어요.'

  const goTo = useCallback(
    (href: string) => {
      if (ttsSupported && typeof window !== 'undefined') {
        try { window.speechSynthesis.cancel() } catch { /* no-op */ }
      }
      router.push(href)
    },
    [router, ttsSupported]
  )

  // While deciding the residence gate, avoid flashing the home behind a redirect.
  if (!ready) {
    return (
      <div style={{ ...styles.root, justifyContent: 'center' }}>
        <p style={{ fontSize: 22, fontWeight: 700, color: C.inkSoft }}>잠시만요…</p>
      </div>
    )
  }

  return (
    <div style={styles.root}>
      <style>{GLOBAL_CSS}</style>

      {/* Sticky top bar — residence chip (left) + 읽어주기 (right) */}
      <div style={styles.topBar}>
        {residence && (
          <button
            type="button"
            className="rh-ctrl"
            style={styles.regionChip}
            onClick={() => goTo('/care/setup')}
            aria-label={`지금은 ${shortLabel(residence)} 기준이에요. 사는 곳 바꾸기`}
          >
            <span aria-hidden>📍</span> {shortLabel(residence)} 기준 · 바꾸기
          </button>
        )}
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
          <h1 style={styles.h1}>어르신 도우미</h1>
          <p style={styles.lead}>필요한 도움을 골라보세요.</p>
        </header>

        {/* Two-gate emergency — top priority, above everything */}
        <button
          type="button"
          className="rh-sos"
          style={styles.sosBtn}
          onClick={startEmergency}
          aria-label="긴급 도움 — 119에 전화할 때 누르세요"
        >
          <span style={styles.sosEmoji} aria-hidden>🚨</span>
          <span style={styles.sosText}>긴급 도움</span>
          <span style={styles.sosSub}>119가 필요할 때 누르세요</span>
        </button>

        {/* Hero card — LIVE */}
        <button
          type="button"
          className="rh-hero"
          style={styles.hero}
          onClick={() => {
            if (ttsSupported && typeof window !== 'undefined') {
              try { window.speechSynthesis.cancel() } catch { /* no-op */ }
            }
            router.push('/care/support')
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

        {/* 말벗·안부 — LIVE, daily-return companion */}
        <button
          type="button"
          className="rh-companion"
          style={styles.companionCard}
          onClick={() => goTo('/care/companion')}
          aria-label="말벗, 안부 — 오늘 하루 이야기 나누기"
        >
          <span style={styles.companionEmoji} aria-hidden>💬</span>
          <span style={styles.companionTextWrap}>
            <span style={styles.companionLabel}>말벗·안부</span>
            <span style={styles.companionSub}>오늘 하루, 이야기 나눠요</span>
          </span>
          <span style={styles.companionArrow} aria-hidden>→</span>
        </button>

        {/* Peek label */}
        <p style={styles.gridHint} aria-hidden>더 많은 메뉴</p>

        {/* Grid of feature cards — live (photo modes) or 준비중 */}
        <div style={styles.grid} role="list">
          {GRID_CARDS.map(({ emoji, label, href }) => {
            const live = Boolean(href)
            return (
              <button
                key={label}
                type="button"
                role="listitem"
                className={live ? 'rh-card rh-card-live' : 'rh-card'}
                style={live ? { ...styles.card, ...styles.cardLive } : styles.card}
                onClick={() => (href ? goTo(href) : showToast(label))}
                aria-label={live ? label : `${label} — 준비 중`}
              >
                <span style={styles.cardEmoji} aria-hidden>{emoji}</span>
                <span style={live ? { ...styles.cardLabel, ...styles.cardLabelLive } : styles.cardLabel}>{label}</span>
                {!live && <span style={styles.badge} aria-hidden>준비중</span>}
              </button>
            )
          })}
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

      {/* Gate 1 — Confirm intent */}
      {sosPhase === 'confirm' && (
        <div style={styles.sosOverlay} role="alertdialog" aria-modal="true" aria-label="119 전화 확인">
          <p style={styles.sosOverlayTitle}>정말 119에<br />전화할까요?</p>
          <div style={styles.sosGateRow}>
            {/* "예" — smaller but very clear */}
            <button
              type="button"
              className="rh-confirm-yes"
              style={styles.sosYesBtn}
              onClick={confirmYes}
              aria-label="예, 119에 전화하기"
            >
              예
            </button>
            {/* "아니요" — large / easy to hit, the safe default */}
            <button
              type="button"
              className="rh-cancel"
              style={styles.sosNoBtn}
              onClick={confirmNo}
              aria-label="아니요, 취소하기"
            >
              아니요
            </button>
          </div>
        </div>
      )}

      {/* Gate 2 — 5-second countdown */}
      {sosPhase === 'countdown' && (
        <div style={styles.sosOverlay} role="alertdialog" aria-modal="true" aria-label="119 전화 카운트다운">
          <p style={styles.sosOverlayTitle}>119에 전화합니다</p>
          <div style={styles.sosCount} aria-live="assertive" aria-atomic="true">{countdown}</div>
          <p style={styles.sosOverlayHint}>잠시 후 전화가 걸려요</p>
          {/* "지금 바로 전화" — secondary, for those who don't want to wait */}
          <button
            type="button"
            className="rh-confirm-yes"
            style={styles.sosDialNowBtn}
            onClick={dialNow}
            aria-label="지금 바로 119 전화하기"
          >
            지금 바로 전화
          </button>
          {/* 취소 — biggest, most forgiving tap target */}
          <button
            type="button"
            className="rh-cancel"
            style={styles.sosCancelBtn}
            onClick={cancelEmergency}
            aria-label="전화 취소하기"
          >
            취소
          </button>
        </div>
      )}
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
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    position: 'sticky',
    top: 0,
    background: C.bg,
    paddingTop: 10,
    paddingBottom: 8,
    zIndex: 5,
  },
  regionChip: {
    minHeight: 54,
    fontSize: 18,
    fontWeight: 800,
    color: C.badgeInk,
    background: C.badgeBg,
    border: `2px solid ${C.sea}`,
    borderRadius: 14,
    cursor: 'pointer',
    padding: '6px 14px',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
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
  // One-touch 119 button (home)
  sosBtn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    width: '100%',
    minHeight: 96,
    background: '#C0392B',
    border: '4px solid #8A241A',
    borderRadius: 20,
    cursor: 'pointer',
    padding: '14px 18px',
    boxShadow: '0 8px 26px rgba(192,57,43,0.40)',
    boxSizing: 'border-box',
  },
  sosEmoji: { fontSize: 40, lineHeight: 1 },
  sosText: { fontSize: 36, fontWeight: 900, color: '#FFFFFF', lineHeight: 1.1 },
  sosSub: { fontSize: 20, fontWeight: 700, color: '#FFE3DE', lineHeight: 1.2 },
  // Overlays — shared outer container
  sosOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    background: '#8A241A',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    padding: '32px 20px',
    boxSizing: 'border-box',
  },
  sosOverlayTitle: {
    fontSize: 44,
    fontWeight: 900,
    color: '#FFFFFF',
    textAlign: 'center',
    margin: 0,
    lineHeight: 1.25,
  },
  // Gate 1 — 예 / 아니요 row
  sosGateRow: {
    display: 'flex',
    gap: 16,
    width: '100%',
    maxWidth: 540,
  },
  // "예" button — clearly visible but not the largest
  sosYesBtn: {
    flex: 1,
    minHeight: 110,
    background: '#FFFFFF',
    color: '#8A241A',
    border: '5px solid #FFFFFF',
    borderRadius: 20,
    fontSize: 42,
    fontWeight: 900,
    cursor: 'pointer',
  },
  // "아니요" / "취소" — dominant, full width, tallest
  sosNoBtn: {
    flex: 2,
    minHeight: 110,
    background: '#FFE3DE',
    color: '#8A241A',
    border: '5px solid #FFFFFF',
    borderRadius: 20,
    fontSize: 42,
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: '0 8px 28px rgba(0,0,0,0.25)',
  },
  // Gate 2 — countdown number
  sosCount: {
    fontSize: 160,
    fontWeight: 900,
    color: '#FFFFFF',
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
  },
  sosOverlayHint: {
    fontSize: 24,
    fontWeight: 700,
    color: '#FFE3DE',
    textAlign: 'center',
    margin: 0,
  },
  // Gate 2 — "지금 바로 전화" secondary button
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
  // Gate 2 — "취소" — the biggest, safest target
  sosCancelBtn: {
    width: '100%',
    maxWidth: 520,
    minHeight: 140,
    background: '#FFFFFF',
    color: '#8A241A',
    border: '5px solid #FFFFFF',
    borderRadius: 24,
    fontSize: 56,
    fontWeight: 900,
    cursor: 'pointer',
    boxShadow: '0 8px 28px rgba(0,0,0,0.30)',
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
  // 말벗·안부 card — warm accent, full width, prominent
  companionCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    width: '100%',
    minHeight: 100,
    background: '#B45309',
    border: '4px solid #92400E',
    borderRadius: 20,
    padding: '16px 22px',
    cursor: 'pointer',
    position: 'relative',
    boxShadow: '0 8px 26px rgba(180,83,9,0.30)',
    textAlign: 'left',
    boxSizing: 'border-box',
  },
  companionEmoji: { fontSize: 44, lineHeight: 1, flexShrink: 0 },
  companionTextWrap: { display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 },
  companionLabel: { fontSize: 30, fontWeight: 900, color: '#FFFFFF', lineHeight: 1.2 },
  companionSub: { fontSize: 20, fontWeight: 700, color: '#FDE8CC', lineHeight: 1.3 },
  companionArrow: { fontSize: 30, color: '#FFFFFF', opacity: 0.75, flexShrink: 0 },
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
  cardLive: {
    background: C.surface,
    border: `3px solid ${C.sea}`,
  },
  cardLabelLive: {
    color: C.ink,
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
  .rh-ctrl:focus-visible,
  .rh-sos:focus-visible,
  .rh-cancel:focus-visible,
  .rh-confirm-yes:focus-visible,
  .rh-companion:focus-visible {
    outline: 5px solid ${C.focus};
    outline-offset: 3px;
  }
  .rh-companion:hover { background: #92400E; }
  .rh-companion { transition: background 0.12s ease, transform 0.07s ease; -webkit-tap-highlight-color: transparent; }
  .rh-companion:active { transform: scale(0.985); }
  @media (prefers-reduced-motion: reduce) {
    .rh-companion { transition: none !important; transform: none !important; }
  }
  .rh-cancel:focus-visible, .rh-confirm-yes:focus-visible { outline-color: #FFD400; }
  .rh-hero:hover { background: ${C.seaStrong}; }
  .rh-card:hover { background: #E2ECF0; border-color: ${C.sea}; }
  .rh-card-live:hover { background: #EAF4F8; }
  .rh-sos:hover { background: #A93226; }
  .rh-cancel:hover { filter: brightness(0.94); }
  .rh-confirm-yes:hover { filter: brightness(0.94); }
  .rh-hero, .rh-card, .rh-ctrl, .rh-sos, .rh-cancel, .rh-confirm-yes {
    transition: background 0.12s ease, transform 0.07s ease, filter 0.12s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .rh-hero:active { transform: scale(0.985); }
  .rh-card:active { transform: scale(0.97); }
  .rh-sos:active { transform: scale(0.98); }
  .rh-cancel:active, .rh-confirm-yes:active { transform: scale(0.97); }
  @media (prefers-reduced-motion: reduce) {
    .rh-hero, .rh-card, .rh-ctrl, .rh-sos, .rh-cancel, .rh-confirm-yes {
      transition: none !important;
      transform: none !important;
      filter: none !important;
    }
  }
  @media (max-width: 400px) {
    .rh-grid { grid-template-columns: 1fr !important; }
  }
`
