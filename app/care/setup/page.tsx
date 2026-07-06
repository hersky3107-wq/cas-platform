'use client'

/**
 * 거주지 설정 — one-time residence setup (the backbone of nationalization).
 *
 * Two big, elderly-friendly steps:
 *   1) pick 시·도 (17 large buttons)
 *   2) pick 시·군·구 (large buttons for that province) — or "이 지역 전체"
 *
 * Saves to localStorage via lib/care/residence, then returns to /care. A
 * "잘 모르겠어요 / 나중에 하기" option saves a sensible default (서울) so the
 * flow never dead-ends. Accessibility: ≥24px text, high contrast, ≥64px tap
 * targets, TTS (ko-KR), focus-visible, reduced-motion.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  REGIONS,
  buildResidence,
  setResidence,
  DEFAULT_RESIDENCE,
  type SidoInfo,
  type Sigungu,
} from '@/lib/care/residence'

const C = {
  bg: '#E8F2F5',
  surface: '#FFFFFF',
  ink: '#0F2233',
  inkSoft: '#33475B',
  sea: '#0A5C7A',
  seaStrong: '#07445B',
  focus: '#C2410C',
  muted: '#6B7A88',
}

type Step = 'sido' | 'sigungu'

export default function SetupPage() {
  const router = useRouter()

  const [step, setStep] = useState<Step>('sido')
  const [sido, setSido] = useState<SidoInfo | null>(null)
  const [ttsSupported, setTtsSupported] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) setTtsSupported(true)
  }, [])

  const speak = useCallback(
    (text: string) => {
      if (!ttsSupported || typeof window === 'undefined' || !text) return
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

  const stopSpeaking = useCallback(() => {
    if (ttsSupported && typeof window !== 'undefined') {
      try { window.speechSynthesis.cancel() } catch { /* no-op */ }
    }
  }, [ttsSupported])

  useEffect(() => () => stopSpeaking(), [stopSpeaking])

  const finish = useCallback(
    (r: ReturnType<typeof buildResidence>) => {
      stopSpeaking()
      setResidence(r)
      router.replace('/care')
    },
    [router, stopSpeaking]
  )

  // Step 1 → pick a 시·도.
  const pickSido = useCallback(
    (s: SidoInfo) => {
      stopSpeaking()
      // Single-district 시·도 (세종) → save immediately (whole area).
      if (s.sigungu.length <= 1) {
        finish(buildResidence(s, null))
        return
      }
      setSido(s)
      setStep('sigungu')
    },
    [finish, stopSpeaking]
  )

  // Step 2 → pick a 시·군·구 (or whole province).
  const pickSigungu = useCallback(
    (sg: Sigungu | null) => {
      if (!sido) return
      finish(buildResidence(sido, sg))
    },
    [sido, finish]
  )

  const skip = useCallback(() => {
    finish(DEFAULT_RESIDENCE)
  }, [finish])

  return (
    <div style={styles.root}>
      <style>{GLOBAL_CSS}</style>

      <main style={styles.frame}>
        {step === 'sido' && (
          <>
            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>🏠</span>
              <h1 style={styles.h1}>어디에 사세요?</h1>
              <p style={styles.lead}>사시는 지역을 한 번만 골라 주세요. 날씨·병원·소식을 그 지역에 맞게 알려드려요.</p>
              {ttsSupported && (
                <button
                  type="button"
                  className="su-read"
                  style={styles.readBtn}
                  onClick={() => speak('어디에 사세요? 사시는 지역을 한 번만 골라 주세요. 아래에서 시와 도를 눌러 주세요.')}
                  aria-label="안내 읽어주기"
                >
                  <span aria-hidden>🔊</span> 읽어주기
                </button>
              )}
            </header>

            <div style={styles.grid} role="list">
              {REGIONS.map((r) => (
                <button
                  key={r.code}
                  type="button"
                  className="su-btn"
                  style={styles.gridBtn}
                  onClick={() => pickSido(r)}
                  aria-label={`${r.name} 선택`}
                  role="listitem"
                >
                  {r.name}
                </button>
              ))}
            </div>

            <button type="button" className="su-skip" style={styles.skipBtn} onClick={skip} aria-label="잘 모르겠어요, 나중에 하기">
              잘 모르겠어요 · 나중에 할게요
            </button>
          </>
        )}

        {step === 'sigungu' && sido && (
          <>
            <button
              type="button"
              className="su-back"
              style={styles.backBtn}
              onClick={() => { stopSpeaking(); setStep('sido'); setSido(null) }}
              aria-label="시·도 다시 고르기"
            >
              <span aria-hidden>↩</span> 다시 고르기
            </button>

            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>🏠</span>
              <h1 style={styles.h1}>{sido.name}<br />어디에 사세요?</h1>
              {ttsSupported && (
                <button
                  type="button"
                  className="su-read"
                  style={styles.readBtn}
                  onClick={() => speak(`${sido.name} 어디에 사세요? 시나 군, 구를 눌러 주세요. 잘 모르시면 이 지역 전체를 누르셔도 돼요.`)}
                  aria-label="안내 읽어주기"
                >
                  <span aria-hidden>🔊</span> 읽어주기
                </button>
              )}
            </header>

            <button
              type="button"
              className="su-btn su-whole"
              style={{ ...styles.gridBtn, ...styles.wholeBtn }}
              onClick={() => pickSigungu(null)}
              aria-label={`${sido.name} 전체로 설정`}
            >
              {sido.name} 전체로 할게요
            </button>

            <div style={styles.grid} role="list">
              {sido.sigungu.map((sg) => (
                <button
                  key={sg.name}
                  type="button"
                  className="su-btn"
                  style={styles.gridBtn}
                  onClick={() => pickSigungu(sg)}
                  aria-label={`${sg.name} 선택`}
                  role="listitem"
                >
                  {sg.name}
                </button>
              ))}
            </div>
          </>
        )}
      </main>
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
    justifyContent: 'center',
    padding: '0 16px 48px',
    boxSizing: 'border-box',
  },
  frame: { width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 18 },
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  headerEmoji: { fontSize: 52, lineHeight: 1 },
  h1: { fontSize: 36, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.25 },
  lead: { fontSize: 22, lineHeight: 1.55, color: C.inkSoft, margin: 0, textAlign: 'center', wordBreak: 'keep-all' },
  readBtn: {
    alignSelf: 'center', minHeight: 60, fontSize: 22, fontWeight: 700, color: C.sea, background: '#FFFFFF',
    border: `3px solid ${C.sea}`, borderRadius: 14, cursor: 'pointer', padding: '8px 26px',
  },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12,
  },
  gridBtn: {
    minHeight: 84, fontSize: 25, fontWeight: 800, color: C.ink,
    background: C.surface, border: `3px solid ${C.sea}`, borderRadius: 16, cursor: 'pointer',
    padding: '10px 12px', lineHeight: 1.25, wordBreak: 'keep-all',
    display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
  },
  wholeBtn: {
    gridColumn: '1 / -1', minHeight: 76, background: C.sea, color: '#FFFFFF',
    border: `3px solid ${C.seaStrong}`, fontSize: 24, fontWeight: 900,
  },
  skipBtn: {
    marginTop: 6, minHeight: 66, fontSize: 21, fontWeight: 700, color: C.inkSoft,
    background: '#F0F5F8', border: `2px solid ${C.muted}`, borderRadius: 14, cursor: 'pointer', padding: '10px 18px',
  },
  backBtn: {
    alignSelf: 'flex-start', minHeight: 58, fontSize: 21, fontWeight: 700, color: C.ink,
    background: C.surface, border: `3px solid ${C.ink}`, borderRadius: 14, cursor: 'pointer', padding: '8px 20px',
  },
}

const GLOBAL_CSS = `
  .su-btn:focus-visible, .su-read:focus-visible, .su-skip:focus-visible, .su-back:focus-visible {
    outline: 5px solid ${C.focus}; outline-offset: 3px;
  }
  .su-btn:hover { background: #EAF4F8; }
  .su-whole:hover { background: ${C.seaStrong}; }
  .su-btn, .su-read, .su-skip, .su-back {
    transition: transform 0.08s ease, background 0.15s ease; -webkit-tap-highlight-color: transparent;
  }
  .su-btn:active, .su-skip:active, .su-back:active { transform: scale(0.98); }
  @media (prefers-reduced-motion: reduce) {
    .su-btn, .su-read, .su-skip, .su-back { transition: none !important; transform: none !important; }
  }
`
