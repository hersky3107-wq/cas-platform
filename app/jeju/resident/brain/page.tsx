'use client'

/**
 * 오늘의 뇌 운동 — daily cognitive exercise for resident mode.
 *
 * Loads 6 code-graded multiple-choice questions from /api/jeju/resident/brain
 * (cached once daily). One question per screen, warm feedback, encouraging end
 * screen, and an on-device streak counter (localStorage, try/catch guarded).
 *
 * FRAMING: light "뇌 운동 / 머리 맑게" fun — never a medical/치매 claim.
 *
 * Accessibility: large text (≥20/26/32), high contrast, ≥60px targets, TTS
 * ko-KR (cancel-before-speak), reduced-motion (via ResidentLoading), focus.
 * No localStorage EXCEPT the intentional, guarded streak counter.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ResidentLoading } from '@/app/jeju/resident/_components/Loading'

const C = {
  bg: '#E8F2F5',
  surface: '#FFFFFF',
  ink: '#0F2233',
  inkSoft: '#33475B',
  sea: '#0A5C7A',
  seaStrong: '#07445B',
  focus: '#C2410C',
  muted: '#6B7A88',
  okBg: '#E4F3E6',
  okBorder: '#2E7D32',
  okInk: '#1B5E20',
  warmBg: '#FFF6DE',
  warmBorder: '#B7791F',
  warmInk: '#7A5200',
}

type Domain = 'memory' | 'attention' | 'language' | 'category' | 'calculation' | 'knowledge'
type Level = 'easy' | 'normal' | 'hard'

const LEVEL_OPTIONS: { value: Level; label: string; emoji: string }[] = [
  { value: 'easy',   label: '쉬워요',    emoji: '😊' },
  { value: 'normal', label: '보통이에요', emoji: '🙂' },
  { value: 'hard',   label: '어려워요',  emoji: '💪' },
]

const DOMAIN_LABEL: Record<Domain, string> = {
  memory: '기억력 문제',
  attention: '집중력 문제',
  language: '속담 맞히기',
  category: '같은 종류 찾기',
  calculation: '계산 문제',
  knowledge: '상식 문제',
}

interface BrainQuestion {
  domain: Domain
  question: string
  choices: string[]
  answerIndex: number
  explanation: string
  memoryPrep?: string
}

interface BrainData {
  error: boolean
  message?: string
  questions?: BrainQuestion[]
}

type Phase = 'intro' | 'loading' | 'play' | 'end'

// ── Streak (localStorage, guarded) ─────────────────────────────────────────────

const LS_LAST = 'resident.brain.lastDay'
const LS_STREAK = 'resident.brain.streak'

function kstDayStr(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`
}

function yesterdayStr(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000)
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')}`
}

function readStreak(): { lastDay: string; streak: number } {
  try {
    if (typeof window === 'undefined') return { lastDay: '', streak: 0 }
    const lastDay = window.localStorage.getItem(LS_LAST) ?? ''
    const streak = Number(window.localStorage.getItem(LS_STREAK) ?? '0') || 0
    return { lastDay, streak }
  } catch {
    return { lastDay: '', streak: 0 }
  }
}

/** Advance the streak for today's completion; returns the new streak (0 if unavailable). */
function commitStreak(): number {
  try {
    if (typeof window === 'undefined') return 0
    const today = kstDayStr()
    const { lastDay, streak } = readStreak()
    let next: number
    if (lastDay === today) next = streak || 1 // already done today → keep
    else if (lastDay === yesterdayStr()) next = streak + 1 // consecutive
    else next = 1 // first time or gap → reset
    window.localStorage.setItem(LS_LAST, today)
    window.localStorage.setItem(LS_STREAK, String(next))
    return next
  } catch {
    return 0
  }
}

export default function BrainPage() {
  const router = useRouter()

  const [phase, setPhase] = useState<Phase>('intro')
  const [ttsSupported, setTtsSupported] = useState(false)
  const [questions, setQuestions] = useState<BrainQuestion[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [correctCount, setCorrectCount] = useState(0)
  const [memoryRevealed, setMemoryRevealed] = useState(false)

  const [streak, setStreak] = useState(0)
  const [finalStreak, setFinalStreak] = useState(0)
  const [level, setLevel] = useState<Level>('normal')

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) setTtsSupported(true)
    setStreak(readStreak().streak)
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

  useEffect(() => () => stopSpeaking(), [stopSpeaking])

  // ── Fetch ────────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    stopSpeaking()
    setLoadError(null)
    setPhase('loading')
    try {
      const res = await fetch(`/api/jeju/resident/brain?level=${level}`, { method: 'GET' })
      const json = (await res.json()) as BrainData
      if (json.error || !json.questions || json.questions.length === 0) {
        setLoadError(json.message ?? '지금은 문제를 불러오지 못했어요. 잠시 후 다시 해주세요.')
        setPhase('intro')
        return
      }
      setQuestions(json.questions)
      setIndex(0)
      setSelected(null)
      setCorrectCount(0)
      setMemoryRevealed(false)
      setPhase('play')
    } catch {
      setLoadError('연결에 문제가 있어요. 잠시 후 다시 해주세요.')
      setPhase('intro')
    }
  }, [stopSpeaking, level])

  const current = questions[index]

  // Auto-narrate a memory-prep word list when a new memory question appears.
  const prepSpeakGuard = useRef<string>('')
  useEffect(() => {
    if (phase !== 'play' || !current) return
    if (current.memoryPrep && !memoryRevealed) {
      const key = `${index}:${current.memoryPrep}`
      if (prepSpeakGuard.current !== key) {
        prepSpeakGuard.current = key
        speak(`다음 낱말을 기억하세요. ${current.memoryPrep}`)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, memoryRevealed])

  // ── Answer / advance ─────────────────────────────────────────────────────

  const choose = useCallback(
    (i: number) => {
      if (selected !== null || !current) return
      setSelected(i)
      const isCorrect = i === current.answerIndex
      if (isCorrect) {
        setCorrectCount((c) => c + 1)
        speak(`맞았어요! 잘하셨어요. ${current.explanation}`)
      } else {
        const answer = current.choices[current.answerIndex] ?? ''
        speak(`괜찮아요. 정답은 ${answer} 이에요. ${current.explanation}`)
      }
    },
    [selected, current, speak]
  )

  const next = useCallback(() => {
    stopSpeaking()
    if (index < questions.length - 1) {
      setIndex((n) => n + 1)
      setSelected(null)
      setMemoryRevealed(false)
    } else {
      const s = commitStreak()
      setFinalStreak(s)
      setPhase('end')
      speak(`오늘도 다 하셨어요! 참 잘하셨어요. ${questions.length}개 중 ${correctCount}개 맞히셨어요.`)
    }
  }, [index, questions.length, stopSpeaking, correctCount, speak])

  const goHome = useCallback(() => {
    stopSpeaking()
    router.push('/jeju/resident')
  }, [router, stopSpeaking])

  const speakQuestion = useCallback(() => {
    if (!current) return
    const body = `${current.question}. 보기. ${current.choices.map((c, i) => `${i + 1}번, ${c}`).join('. ')}`
    speak(body)
  }, [current, speak])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={styles.root}>
      <style>{GLOBAL_CSS}</style>

      <main style={styles.frame}>
        <div style={styles.topBar}>
          <button type="button" className="br-ctrl" style={styles.ctrlBtn} onClick={goHome} aria-label="처음으로 돌아가기">
            <span aria-hidden>↩</span> 처음으로
          </button>
        </div>

        {/* ── INTRO ────────────────────────────────────────────────────────── */}
        {phase === 'intro' && (
          <>
            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>🧠</span>
              <h1 style={styles.h1}>오늘의 뇌 운동</h1>
              <p style={styles.lead}>머리를 맑게 하는 간단한 문제예요.<br />편하게 풀어보세요.</p>
            </header>

            {streak > 0 && (
              <div style={styles.streakBanner}>
                <span aria-hidden>🔥</span> 지금까지 <strong>{streak}일 연속</strong> 하셨어요!
              </div>
            )}

            {loadError && <p style={styles.errorLine} role="alert">{loadError}</p>}

            {/* Difficulty picker */}
            <div style={styles.levelSection}>
              <p style={styles.levelHeading}>문제 난이도를 골라보세요</p>
              <div style={styles.levelRow}>
                {LEVEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className="br-level"
                    style={level === opt.value ? { ...styles.levelBtn, ...styles.levelBtnOn } : styles.levelBtn}
                    onClick={() => setLevel(opt.value)}
                    aria-pressed={level === opt.value}
                    aria-label={`난이도 ${opt.label}`}
                  >
                    <span aria-hidden style={styles.levelEmoji}>{opt.emoji}</span>
                    <span style={{ ...styles.levelLabel, color: level === opt.value ? '#FFFFFF' : C.ink }}>
                      {opt.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <button type="button" className="br-primary" style={styles.startBtn} onClick={start} aria-label="오늘의 뇌 운동 시작하기">
              <span aria-hidden>▶</span> 시작하기
            </button>

            {/* Second activity: emoji pair-matching game */}
            <button
              type="button"
              className="br-alt"
              style={styles.altBtn}
              onClick={() => { stopSpeaking(); router.push('/jeju/resident/brain/memory') }}
              aria-label="그림 짝 맞추기 놀이하기"
            >
              <span style={styles.altEmoji} aria-hidden>🃏</span>
              <span style={styles.altText}>
                <span style={styles.altTitle}>그림 짝 맞추기</span>
                <span style={styles.altSub}>같은 그림 두 개를 찾는 놀이예요.</span>
              </span>
              <span style={styles.altArrow} aria-hidden>→</span>
            </button>

            {ttsSupported && (
              <button type="button" className="br-read" style={styles.readBtn} onClick={() => speak('오늘의 뇌 운동입니다. 머리를 맑게 하는 간단한 문제예요. 편하게 풀어보세요. 시작하려면 시작하기를 누르세요. 그림 짝 맞추기 놀이도 할 수 있어요.')} aria-label="안내 읽어주기">
                <span aria-hidden>🔊</span> 읽어주기
              </button>
            )}
          </>
        )}

        {/* ── LOADING ──────────────────────────────────────────────────────── */}
        {phase === 'loading' && (
          <ResidentLoading steps={['오늘의 문제를 준비하고 있어요']} ttsSupported={ttsSupported} />
        )}

        {/* ── PLAY ─────────────────────────────────────────────────────────── */}
        {phase === 'play' && current && (
          <section style={styles.playWrap} aria-live="polite">
            {/* progress */}
            <div style={styles.progressRow}>
              <span style={styles.progressText}>{index + 1} / {questions.length}</span>
              <div style={styles.dotsRow} aria-hidden>
                {questions.map((_, i) => (
                  <span key={i} style={{ ...styles.dot, background: i <= index ? C.sea : '#C5D9E2' }} />
                ))}
              </div>
            </div>

            <span style={styles.domainLabel}>{DOMAIN_LABEL[current.domain]}</span>

            {/* memory prep gate */}
            {current.memoryPrep && !memoryRevealed ? (
              <div style={styles.card}>
                <p style={styles.prepPrompt}>다음 낱말을 기억하세요</p>
                <p style={styles.prepWords}>{current.memoryPrep}</p>
                <div style={styles.btnRow}>
                  {ttsSupported && (
                    <button type="button" className="br-read" style={styles.readBtn} onClick={() => speak(`다음 낱말을 기억하세요. ${current.memoryPrep}`)} aria-label="낱말 읽어주기">
                      <span aria-hidden>🔊</span> 읽어주기
                    </button>
                  )}
                  <button type="button" className="br-primary" style={styles.startBtn} onClick={() => { stopSpeaking(); setMemoryRevealed(true); speakQuestion() }} aria-label="다 외웠어요">
                    다 외웠어요
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div style={styles.questionCard}>
                  <p style={styles.questionText}>{current.question}</p>
                  {ttsSupported && (
                    <button type="button" className="br-read" style={styles.readBtnSmall} onClick={speakQuestion} aria-label="문제 읽어주기">
                      <span aria-hidden>🔊</span> 읽어주기
                    </button>
                  )}
                </div>

                <div style={styles.choiceList}>
                  {current.choices.map((choice, i) => {
                    const isAnswer = i === current.answerIndex
                    const isPicked = i === selected
                    let cstyle: React.CSSProperties = styles.choiceBtn
                    if (selected !== null) {
                      if (isAnswer) cstyle = { ...styles.choiceBtn, ...styles.choiceCorrect }
                      else if (isPicked) cstyle = { ...styles.choiceBtn, ...styles.choiceWrong }
                      else cstyle = { ...styles.choiceBtn, ...styles.choiceDim }
                    }
                    return (
                      <button
                        key={i}
                        type="button"
                        className="br-choice"
                        style={cstyle}
                        onClick={() => choose(i)}
                        disabled={selected !== null}
                        aria-label={`${i + 1}번 ${choice}`}
                      >
                        <span style={styles.choiceNum}>{i + 1}</span>
                        <span style={styles.choiceText}>{choice}</span>
                        {selected !== null && isAnswer && <span style={styles.choiceMark} aria-hidden>✓</span>}
                      </button>
                    )
                  })}
                </div>

                {/* feedback */}
                {selected !== null && (
                  <div style={selected === current.answerIndex ? styles.feedbackOk : styles.feedbackGentle}>
                    <p style={styles.feedbackTitle}>
                      {selected === current.answerIndex
                        ? '맞았어요! 잘하셨어요 👏'
                        : `괜찮아요. 정답은 "${current.choices[current.answerIndex]}" 이에요.`}
                    </p>
                    {current.explanation && <p style={styles.feedbackExp}>{current.explanation}</p>}
                    <div style={styles.btnRow}>
                      {ttsSupported && (
                        <button
                          type="button"
                          className="br-read"
                          style={styles.readBtn}
                          onClick={() =>
                            speak(
                              selected === current.answerIndex
                                ? `맞았어요! 잘하셨어요. ${current.explanation}`
                                : `괜찮아요. 정답은 ${current.choices[current.answerIndex]} 이에요. ${current.explanation}`
                            )
                          }
                          aria-label="설명 읽어주기"
                        >
                          <span aria-hidden>🔊</span> 읽어주기
                        </button>
                      )}
                      <button type="button" className="br-primary" style={styles.startBtn} onClick={next} aria-label={index < questions.length - 1 ? '다음 문제' : '결과 보기'}>
                        {index < questions.length - 1 ? '다음 →' : '다 했어요'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* ── END ──────────────────────────────────────────────────────────── */}
        {phase === 'end' && (
          <section style={styles.endWrap} aria-live="polite">
            <span style={styles.endEmoji} aria-hidden>🎉</span>
            <h2 style={styles.endTitle}>오늘도 다 하셨어요!<br />참 잘하셨어요</h2>
            <p style={styles.endScore}>{questions.length}개 중 <strong>{correctCount}개</strong> 맞히셨어요.</p>
            <p style={styles.endPraise}>
              {correctCount === questions.length
                ? '완벽해요! 머리가 아주 맑으시네요 👏'
                : correctCount >= questions.length - 2
                ? '아주 잘하셨어요. 꾸준함이 최고예요 👍'
                : '끝까지 다 푸신 것이 정말 멋져요. 내일 또 만나요 😊'}
            </p>

            {finalStreak > 0 && (
              <div style={styles.streakBanner}>
                <span aria-hidden>🔥</span> <strong>{finalStreak}일 연속!</strong> 꾸준히 하고 계세요.
              </div>
            )}

            <div style={styles.endBtnRow}>
              {ttsSupported && (
                <button type="button" className="br-read" style={styles.readBtn} onClick={() => speak(`오늘도 다 하셨어요! 참 잘하셨어요. ${questions.length}개 중 ${correctCount}개 맞히셨어요.${finalStreak > 0 ? ` ${finalStreak}일 연속입니다.` : ''}`)} aria-label="결과 읽어주기">
                  <span aria-hidden>🔊</span> 읽어주기
                </button>
              )}
              <button type="button" className="br-primary" style={styles.startBtn} onClick={goHome} aria-label="처음으로 돌아가기">
                <span aria-hidden>🏠</span> 처음으로
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
    display: 'flex', justifyContent: 'flex-start', gap: 12,
    position: 'sticky', top: 0, background: C.bg, paddingTop: 10, paddingBottom: 8, zIndex: 5,
  },
  ctrlBtn: {
    minHeight: 58, fontSize: 21, fontWeight: 700, color: C.ink,
    background: C.surface, border: `3px solid ${C.ink}`, borderRadius: 14, cursor: 'pointer', padding: '6px 24px',
  },
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  headerEmoji: { fontSize: 56, lineHeight: 1 },
  h1: { fontSize: 36, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.2 },
  lead: { fontSize: 22, lineHeight: 1.55, color: C.inkSoft, margin: 0, textAlign: 'center', fontWeight: 600 },
  streakBanner: {
    fontSize: 22, fontWeight: 800, color: C.warmInk, textAlign: 'center', lineHeight: 1.5,
    background: C.warmBg, border: `3px solid ${C.warmBorder}`, borderRadius: 16, padding: '16px 18px',
  },
  errorLine: { fontSize: 21, color: '#8A241A', fontWeight: 700, margin: 0, textAlign: 'center' },
  startBtn: {
    minHeight: 84, fontSize: 30, fontWeight: 900, color: '#FFFFFF', background: C.sea,
    border: 'none', borderRadius: 18, cursor: 'pointer', padding: '12px 24px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    boxShadow: '0 6px 20px rgba(10,92,122,0.28)',
  },
  readBtn: {
    minHeight: 62, fontSize: 22, fontWeight: 700, color: C.sea, background: '#FFFFFF',
    border: `3px solid ${C.sea}`, borderRadius: 14, cursor: 'pointer', padding: '8px 26px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  readBtnSmall: {
    alignSelf: 'flex-start', minHeight: 52, fontSize: 20, fontWeight: 700, color: C.sea, background: '#EAF4F8',
    border: `2px solid ${C.sea}`, borderRadius: 12, cursor: 'pointer', padding: '6px 18px',
    display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 12,
  },
  // play
  playWrap: { display: 'flex', flexDirection: 'column', gap: 16 },
  progressRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  progressText: { fontSize: 22, fontWeight: 900, color: C.sea },
  dotsRow: { display: 'flex', gap: 8 },
  dot: { width: 16, height: 16, borderRadius: '50%', display: 'inline-block' },
  domainLabel: {
    alignSelf: 'flex-start', fontSize: 19, fontWeight: 800, color: '#FFFFFF', background: C.sea,
    borderRadius: 10, padding: '5px 16px',
  },
  card: {
    background: C.surface, borderRadius: 20, padding: '28px 22px',
    display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', boxShadow: '0 6px 22px rgba(15,34,51,0.10)',
  },
  prepPrompt: { fontSize: 24, fontWeight: 800, color: C.inkSoft, margin: 0, textAlign: 'center' },
  prepWords: {
    fontSize: 40, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.4,
    letterSpacing: '0.02em',
  },
  questionCard: {
    background: C.surface, borderRadius: 20, padding: '24px 22px',
    display: 'flex', flexDirection: 'column', boxShadow: '0 6px 22px rgba(15,34,51,0.10)',
  },
  questionText: { fontSize: 28, fontWeight: 900, color: C.ink, margin: 0, lineHeight: 1.5, wordBreak: 'keep-all' },
  choiceList: { display: 'flex', flexDirection: 'column', gap: 12 },
  choiceBtn: {
    display: 'flex', alignItems: 'center', gap: 14, width: '100%', minHeight: 72,
    background: C.surface, border: `2px solid #CBD9E1`, borderRadius: 16, padding: '14px 18px',
    cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box',
  },
  choiceNum: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    width: 44, height: 44, borderRadius: '50%', background: '#E7F3F7', color: C.sea,
    fontSize: 22, fontWeight: 900,
  },
  choiceText: { fontSize: 25, fontWeight: 800, color: C.ink, flex: 1, wordBreak: 'keep-all', lineHeight: 1.35 },
  choiceMark: { fontSize: 30, fontWeight: 900, color: C.okBorder, flexShrink: 0 },
  choiceCorrect: { background: C.okBg, border: `4px solid ${C.okBorder}` },
  choiceWrong: { background: '#FDECEC', border: `4px solid #C0392B` },
  choiceDim: { opacity: 0.55 },
  // feedback
  feedbackOk: {
    display: 'flex', flexDirection: 'column', gap: 12,
    background: C.okBg, border: `3px solid ${C.okBorder}`, borderRadius: 18, padding: '20px 20px',
  },
  feedbackGentle: {
    display: 'flex', flexDirection: 'column', gap: 12,
    background: C.warmBg, border: `3px solid ${C.warmBorder}`, borderRadius: 18, padding: '20px 20px',
  },
  feedbackTitle: { fontSize: 26, fontWeight: 900, color: C.ink, margin: 0, lineHeight: 1.4, wordBreak: 'keep-all' },
  feedbackExp: { fontSize: 21, fontWeight: 600, color: C.inkSoft, margin: 0, lineHeight: 1.6 },
  btnRow: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'center' },
  // end
  endWrap: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
    background: C.surface, borderRadius: 22, padding: '36px 24px 40px', boxShadow: '0 6px 22px rgba(15,34,51,0.10)',
  },
  endEmoji: { fontSize: 68, lineHeight: 1 },
  endTitle: { fontSize: 34, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.3 },
  endScore: { fontSize: 26, fontWeight: 700, color: C.inkSoft, margin: 0, textAlign: 'center' },
  endPraise: { fontSize: 23, fontWeight: 700, color: C.sea, margin: 0, textAlign: 'center', lineHeight: 1.5 },
  endBtnRow: { display: 'flex', flexDirection: 'column', gap: 12, width: '100%', alignItems: 'stretch', marginTop: 6 },
  // difficulty picker
  levelSection: { display: 'flex', flexDirection: 'column', gap: 10 },
  levelHeading: { fontSize: 21, fontWeight: 800, color: C.inkSoft, margin: 0, textAlign: 'center' },
  levelRow: { display: 'flex', gap: 12 },
  levelBtn: {
    flex: 1, minHeight: 90, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 4, background: '#F0F5F8', border: `3px solid #CBD9E1`,
    borderRadius: 18, cursor: 'pointer', padding: '12px 6px',
  },
  levelBtnOn: { background: C.sea, border: `3px solid ${C.seaStrong}` },
  levelEmoji: { fontSize: 30, lineHeight: 1 },
  levelLabel: { fontSize: 20, fontWeight: 900, color: C.ink, lineHeight: 1.2 },
  // alt activity (memory game link)
  altBtn: {
    display: 'flex', alignItems: 'center', gap: 16, width: '100%', minHeight: 92,
    background: C.surface, border: `3px solid ${C.sea}`, borderRadius: 18,
    padding: '16px 20px', cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box',
  },
  altEmoji: { fontSize: 38, lineHeight: 1, flexShrink: 0 },
  altText: { display: 'flex', flexDirection: 'column', gap: 3, flex: 1 },
  altTitle: { fontSize: 25, fontWeight: 900, color: C.ink, lineHeight: 1.25 },
  altSub: { fontSize: 19, fontWeight: 500, color: C.inkSoft, lineHeight: 1.4 },
  altArrow: { fontSize: 28, fontWeight: 900, color: C.sea, flexShrink: 0 },
}

const GLOBAL_CSS = `
  .br-ctrl:focus-visible, .br-read:focus-visible, .br-primary:focus-visible,
  .br-choice:focus-visible, .br-level:focus-visible, .br-alt:focus-visible {
    outline: 5px solid ${C.focus}; outline-offset: 3px;
  }
  .br-primary:hover { background: ${C.seaStrong}; }
  .br-choice:hover:not(:disabled) { background: #EAF4F8; border-color: ${C.sea}; }
  .br-choice:disabled { cursor: default; }
  .br-level:hover { background: #DCEEF3; }
  .br-alt:hover { background: #EAF4F8; }
  .br-ctrl, .br-read, .br-primary, .br-choice, .br-level, .br-alt {
    transition: transform 0.08s ease, background 0.15s ease; -webkit-tap-highlight-color: transparent;
  }
  .br-primary:active, .br-choice:active:not(:disabled), .br-ctrl:active, .br-level:active, .br-alt:active { transform: scale(0.98); }
  @media (prefers-reduced-motion: reduce) {
    .br-ctrl, .br-read, .br-primary, .br-choice, .br-level, .br-alt { transition: none !important; transform: none !important; }
  }
`
