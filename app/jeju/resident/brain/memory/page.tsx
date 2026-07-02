'use client'

/**
 * 그림 짝 맞추기 — emoji memory card matching game for resident mode.
 *
 * Classic pair-matching cognitive exercise, no AI/images needed. Designed for
 * elderly users: large cards, slow flip-back (~1.2s), no timer, no harsh
 * scoring — encouragement only. All state in React (no localStorage).
 *
 * Accessibility: ≥60px targets (cards much larger), high contrast, TTS ko-KR
 * (cancel-before-speak), prefers-reduced-motion (no flip transition), focus.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

const C = {
  bg: '#E8F2F5',
  surface: '#FFFFFF',
  ink: '#0F2233',
  inkSoft: '#33475B',
  sea: '#0A5C7A',
  seaStrong: '#07445B',
  focus: '#C2410C',
  okBg: '#E4F3E6',
  okBorder: '#2E7D32',
  okInk: '#1B5E20',
  warmBg: '#FFF6DE',
  warmBorder: '#B7791F',
  warmInk: '#7A5200',
}

/** Clear, universally recognizable emoji for elderly users. */
const EMOJI_POOL = ['🍎', '🐕', '🌸', '🚌', '🏠', '🌞', '🐟', '🍚', '🌊', '🍊', '☂️', '🐓']

type SizeKey = 'easy' | 'normal' | 'hard'

const SIZES: { key: SizeKey; pairs: number; label: string; sub: string; cols: number }[] = [
  { key: 'easy',   pairs: 4, label: '쉬워요',   sub: '4쌍 · 8장',  cols: 2 },
  { key: 'normal', pairs: 6, label: '보통이에요', sub: '6쌍 · 12장', cols: 3 },
  { key: 'hard',   pairs: 8, label: '어려워요',  sub: '8쌍 · 16장', cols: 4 },
]

interface Card {
  id: number
  emoji: string
  matched: boolean
}

type Phase = 'select' | 'play' | 'done'

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

function buildDeck(pairs: number): Card[] {
  const emojis = shuffle(EMOJI_POOL).slice(0, pairs)
  const deck = emojis.flatMap((emoji, i) => [
    { id: i * 2, emoji, matched: false },
    { id: i * 2 + 1, emoji, matched: false },
  ])
  return shuffle(deck)
}

export default function MemoryGamePage() {
  const router = useRouter()

  const [phase, setPhase] = useState<Phase>('select')
  const [ttsSupported, setTtsSupported] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  const [sizeKey, setSizeKey] = useState<SizeKey>('easy')
  const [deck, setDeck] = useState<Card[]>([])
  const [faceUp, setFaceUp] = useState<number[]>([]) // ids of currently face-up (unmatched) cards, max 2
  const [tries, setTries] = useState(0)
  const [justMatched, setJustMatched] = useState(false)
  const flipBackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) setTtsSupported(true)
    try {
      setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    } catch {
      setReducedMotion(false)
    }
  }, [])

  // ── TTS ────────────────────────────────────────────────────────────────────

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

  useEffect(
    () => () => {
      stopSpeaking()
      if (flipBackTimer.current) clearTimeout(flipBackTimer.current)
    },
    [stopSpeaking]
  )

  // ── Game flow ────────────────────────────────────────────────────────────

  const size = SIZES.find((s) => s.key === sizeKey) ?? SIZES[0]!

  const startGame = useCallback((key: SizeKey) => {
    stopSpeaking()
    if (flipBackTimer.current) clearTimeout(flipBackTimer.current)
    const s = SIZES.find((x) => x.key === key) ?? SIZES[0]!
    setSizeKey(key)
    setDeck(buildDeck(s.pairs))
    setFaceUp([])
    setTries(0)
    setJustMatched(false)
    setPhase('play')
  }, [stopSpeaking])

  const matchedCount = deck.filter((c) => c.matched).length / 2

  const flipCard = useCallback(
    (card: Card) => {
      if (card.matched || faceUp.includes(card.id) || faceUp.length >= 2) return

      const nowUp = [...faceUp, card.id]
      setFaceUp(nowUp)
      setJustMatched(false)

      if (nowUp.length < 2) return

      // Two cards up → grade the try
      setTries((t) => t + 1)
      const [aId, bId] = [nowUp[0]!, nowUp[1]!]
      const a = deck.find((c) => c.id === aId)
      const b = deck.find((c) => c.id === bId)
      if (!a || !b) return

      if (a.emoji === b.emoji) {
        // Match — keep them up, mark matched
        const nextDeck = deck.map((c) => (c.id === aId || c.id === bId ? { ...c, matched: true } : c))
        setDeck(nextDeck)
        setFaceUp([])
        setJustMatched(true)

        const remaining = nextDeck.filter((c) => !c.matched).length
        if (remaining === 0) {
          setPhase('done')
          speak(`다 맞히셨어요! 참 잘하셨어요.`)
        } else {
          speak('잘 하셨어요!')
        }
      } else {
        // No match — flip back after a slow, forgiving pause
        if (flipBackTimer.current) clearTimeout(flipBackTimer.current)
        flipBackTimer.current = setTimeout(() => {
          setFaceUp([])
        }, 1200)
      }
    },
    [deck, faceUp, speak]
  )

  const goHome = useCallback(() => {
    stopSpeaking()
    router.push('/jeju/resident')
  }, [router, stopSpeaking])

  const goBrain = useCallback(() => {
    stopSpeaking()
    router.push('/jeju/resident/brain')
  }, [router, stopSpeaking])

  const backToSelect = useCallback(() => {
    stopSpeaking()
    if (flipBackTimer.current) clearTimeout(flipBackTimer.current)
    setPhase('select')
    setDeck([])
    setFaceUp([])
  }, [stopSpeaking])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={styles.root}>
      <style>{GLOBAL_CSS}</style>

      <main style={styles.frame}>
        <div style={styles.topBar}>
          <button type="button" className="mg-ctrl" style={styles.ctrlBtn} onClick={goHome} aria-label="처음으로 돌아가기">
            <span aria-hidden>↩</span> 처음으로
          </button>
          <button type="button" className="mg-ctrl" style={styles.ctrlBtn} onClick={phase === 'select' ? goBrain : backToSelect} aria-label={phase === 'select' ? '뇌 운동으로' : '크기 다시 고르기'}>
            <span aria-hidden>≡</span> {phase === 'select' ? '뇌 운동' : '다른 크기'}
          </button>
        </div>

        {/* ── SELECT ───────────────────────────────────────────────────────── */}
        {phase === 'select' && (
          <>
            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>🃏</span>
              <h1 style={styles.h1}>그림 짝 맞추기</h1>
              <p style={styles.lead}>같은 그림 두 개를 찾는 놀이예요.<br />몇 장으로 해볼까요?</p>
            </header>

            {ttsSupported && (
              <button type="button" className="mg-read" style={styles.readBtn} onClick={() => speak('그림 짝 맞추기입니다. 카드를 눌러 뒤집고, 같은 그림 두 개를 찾으세요. 쉬워요, 보통이에요, 어려워요 중에서 골라보세요.')} aria-label="놀이 방법 읽어주기">
                <span aria-hidden>🔊</span> 읽어주기
              </button>
            )}

            <div style={styles.sizeList}>
              {SIZES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className="mg-size"
                  style={styles.sizeBtn}
                  onClick={() => startGame(s.key)}
                  aria-label={`${s.label} — ${s.sub}로 시작하기`}
                >
                  <span style={styles.sizeLabel}>{s.label}</span>
                  <span style={styles.sizeSub}>{s.sub}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── PLAY ─────────────────────────────────────────────────────────── */}
        {phase === 'play' && (
          <>
            <header style={styles.headerCompact}>
              <h1 style={styles.h1Small}>같은 그림 두 개를 찾으세요</h1>
              <p style={styles.progressLine}>
                {matchedCount} / {size.pairs}쌍 찾았어요
                {justMatched && <span style={styles.cheer}> · 잘 하셨어요 👏</span>}
              </p>
            </header>

            <div
              style={{
                ...styles.grid,
                gridTemplateColumns: `repeat(${size.cols}, 1fr)`,
              }}
              role="group"
              aria-label="카드 판"
            >
              {deck.map((card) => {
                const isUp = card.matched || faceUp.includes(card.id)
                return (
                  <button
                    key={card.id}
                    type="button"
                    className={reducedMotion ? 'mg-card mg-card-static' : 'mg-card'}
                    style={{
                      ...styles.cardBtn,
                      ...(isUp ? (card.matched ? styles.cardMatched : styles.cardUp) : styles.cardDown),
                    }}
                    onClick={() => flipCard(card)}
                    disabled={card.matched || (faceUp.length >= 2 && !faceUp.includes(card.id))}
                    aria-label={isUp ? `카드: ${card.emoji}` : '뒤집힌 카드'}
                  >
                    <span style={styles.cardFace} aria-hidden>
                      {isUp ? card.emoji : '❓'}
                    </span>
                  </button>
                )
              })}
            </div>

            <p style={styles.triesLine}>지금까지 {tries}번 뒤집어 보셨어요. 천천히 하셔도 돼요.</p>
          </>
        )}

        {/* ── DONE ─────────────────────────────────────────────────────────── */}
        {phase === 'done' && (
          <section style={styles.doneWrap} aria-live="polite">
            <span style={styles.doneEmoji} aria-hidden>🎉</span>
            <h2 style={styles.doneTitle}>다 맞히셨어요!<br />참 잘하셨어요</h2>
            <p style={styles.doneScore}>{size.pairs}쌍을 {tries}번 만에 모두 찾으셨어요.</p>
            <p style={styles.donePraise}>
              {tries <= size.pairs + 2
                ? '기억력이 아주 좋으시네요! 👏'
                : '끝까지 다 찾으신 것이 정말 멋져요 😊'}
            </p>

            <div style={styles.doneBtnRow}>
              {ttsSupported && (
                <button type="button" className="mg-read" style={styles.readBtn} onClick={() => speak(`다 맞히셨어요! 참 잘하셨어요. ${size.pairs}쌍을 ${tries}번 만에 모두 찾으셨어요.`)} aria-label="결과 읽어주기">
                  <span aria-hidden>🔊</span> 읽어주기
                </button>
              )}
              <button type="button" className="mg-primary" style={styles.primaryBtn} onClick={() => startGame(sizeKey)} aria-label="같은 크기로 다시 하기">
                <span aria-hidden>🔄</span> 다시 하기
              </button>
              <button type="button" className="mg-ctrl" style={styles.ctrlBtnWide} onClick={backToSelect} aria-label="다른 크기 고르기">
                다른 크기 고르기
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100dvh', background: C.bg, color: C.ink,
    fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
    display: 'flex', justifyContent: 'center', padding: '0 16px 40px', boxSizing: 'border-box',
  },
  frame: { width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 18 },
  topBar: {
    display: 'flex', justifyContent: 'space-between', gap: 12,
    position: 'sticky', top: 0, background: C.bg, paddingTop: 10, paddingBottom: 8, zIndex: 5,
  },
  ctrlBtn: {
    flex: 1, minHeight: 58, fontSize: 21, fontWeight: 700, color: C.ink,
    background: C.surface, border: `3px solid ${C.ink}`, borderRadius: 14, cursor: 'pointer', padding: '6px 12px',
  },
  ctrlBtnWide: {
    width: '100%', minHeight: 62, fontSize: 22, fontWeight: 800, color: C.ink,
    background: C.surface, border: `3px solid ${C.ink}`, borderRadius: 14, cursor: 'pointer', padding: '8px 16px',
  },
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  headerCompact: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 },
  headerEmoji: { fontSize: 56, lineHeight: 1 },
  h1: { fontSize: 36, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.2 },
  h1Small: { fontSize: 28, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.3 },
  lead: { fontSize: 22, lineHeight: 1.55, color: C.inkSoft, margin: 0, textAlign: 'center', fontWeight: 600 },
  readBtn: {
    alignSelf: 'center', minHeight: 62, fontSize: 22, fontWeight: 700, color: C.sea, background: '#FFFFFF',
    border: `3px solid ${C.sea}`, borderRadius: 14, cursor: 'pointer', padding: '8px 26px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  // size select
  sizeList: { display: 'flex', flexDirection: 'column', gap: 14 },
  sizeBtn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    width: '100%', minHeight: 96, background: C.surface, border: `3px solid ${C.sea}`,
    borderRadius: 18, cursor: 'pointer', padding: '16px 20px', boxSizing: 'border-box',
  },
  sizeLabel: { fontSize: 28, fontWeight: 900, color: C.ink, lineHeight: 1.2 },
  sizeSub: { fontSize: 20, fontWeight: 700, color: C.sea },
  // play
  progressLine: { fontSize: 22, fontWeight: 800, color: C.sea, margin: 0, textAlign: 'center' },
  cheer: { color: C.okBorder },
  grid: { display: 'grid', gap: 12 },
  cardBtn: {
    aspectRatio: '3 / 4', minHeight: 92, width: '100%',
    borderRadius: 16, cursor: 'pointer', boxSizing: 'border-box',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0,
  },
  cardDown: { background: C.sea, border: `3px solid ${C.seaStrong}` },
  cardUp: { background: C.surface, border: `3px solid ${C.sea}` },
  cardMatched: { background: C.okBg, border: `3px solid ${C.okBorder}`, cursor: 'default' },
  cardFace: { fontSize: 48, lineHeight: 1 },
  triesLine: { fontSize: 20, fontWeight: 600, color: C.inkSoft, margin: 0, textAlign: 'center', lineHeight: 1.5 },
  // done
  doneWrap: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
    background: C.surface, borderRadius: 22, padding: '36px 24px 40px', boxShadow: '0 6px 22px rgba(15,34,51,0.10)',
  },
  doneEmoji: { fontSize: 68, lineHeight: 1 },
  doneTitle: { fontSize: 34, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.3 },
  doneScore: { fontSize: 25, fontWeight: 700, color: C.inkSoft, margin: 0, textAlign: 'center' },
  donePraise: { fontSize: 23, fontWeight: 700, color: C.sea, margin: 0, textAlign: 'center', lineHeight: 1.5 },
  doneBtnRow: { display: 'flex', flexDirection: 'column', gap: 12, width: '100%', alignItems: 'stretch', marginTop: 6 },
  primaryBtn: {
    minHeight: 76, fontSize: 26, fontWeight: 900, color: '#FFFFFF', background: C.sea,
    border: 'none', borderRadius: 16, cursor: 'pointer', padding: '12px 24px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
}

const GLOBAL_CSS = `
  .mg-ctrl:focus-visible, .mg-read:focus-visible, .mg-primary:focus-visible,
  .mg-size:focus-visible, .mg-card:focus-visible {
    outline: 5px solid ${C.focus}; outline-offset: 3px;
  }
  .mg-primary:hover { background: ${C.seaStrong}; }
  .mg-size:hover { background: #EAF4F8; }
  .mg-card { transition: background 0.25s ease, transform 0.25s ease; -webkit-tap-highlight-color: transparent; }
  .mg-card:active:not(:disabled) { transform: scale(0.96); }
  .mg-card-static { transition: none !important; transform: none !important; }
  .mg-ctrl, .mg-read, .mg-primary, .mg-size {
    transition: transform 0.08s ease, background 0.15s ease; -webkit-tap-highlight-color: transparent;
  }
  .mg-primary:active, .mg-size:active, .mg-ctrl:active { transform: scale(0.98); }
  @media (prefers-reduced-motion: reduce) {
    .mg-ctrl, .mg-read, .mg-primary, .mg-size, .mg-card {
      transition: none !important; transform: none !important;
    }
  }
`
