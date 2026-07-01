'use client'

/**
 * 맞춤 지원찾기 — Welfare finder for Jeju elderly / digitally-vulnerable residents.
 *
 * Accessibility-first: very large text, high contrast, one thing per screen,
 * audio narration everywhere, keyboard-visible focus, reduced-motion aware.
 *
 * Standalone flow (not wired into the resident home yet).
 * Engine: lib/jeju/welfare.ts via /api/jeju/resident/{interpret,welfare-match}.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

// Type-only import — erased at build time, so no server code enters the client bundle.
import type { WelfareProfile } from '@/lib/jeju/welfare'

// ── Result shape (mirrors the welfare-match API) ───────────────────────────────

type WelfareResult = {
  seq: string
  name: string
  oneLineSummary: string | null
  target: string[]
  situation: string[]
  application: string | null
  contact: string | null
  score: number
  eligibilityPlain: string[]
  benefitPlain: string | null
  preparePlain: string[]
  applyWherePlain: string | null
}

// ── Questions (one per screen) ─────────────────────────────────────────────────

const QUESTIONS: { key: keyof WelfareProfile; q: string; allowMaybe: boolean }[] = [
  { key: 'isElderly',     q: '만 65세 이상이신가요?',           allowMaybe: false },
  { key: 'hasDisability', q: '몸이 불편하거나 장애가 있으신가요?', allowMaybe: false },
  { key: 'isLowIncome',   q: '형편이 어려운 편이신가요?',         allowMaybe: true  },
  { key: 'livesAlone',    q: '혼자 지내고 계신가요?',             allowMaybe: false },
  { key: 'seeksJob',      q: '일자리를 찾고 계신가요?',           allowMaybe: false },
  { key: 'needsCare',     q: '돌봄이나 간병이 필요하신가요?',     allowMaybe: true  },
]

const EMPTY_PROFILE: WelfareProfile = {
  isElderly: null,
  hasDisability: null,
  isLowIncome: null,
  livesAlone: null,
  seeksJob: null,
  needsCare: null,
}

type Phase = 'intro' | 'question' | 'freetext' | 'loading' | 'results'

// ── Theme (high-contrast, Jeju-sea accent) ─────────────────────────────────────

const C = {
  bg: '#E8F2F5',
  surface: '#FFFFFF',
  ink: '#0F2233', // deep navy — AAA on light
  inkSoft: '#33475B',
  sea: '#0A5C7A', // deep sea accent
  seaStrong: '#07445B',
  yesBg: '#0A5C7A',
  line: '#0F2233',
  focus: '#C2410C', // strong amber-orange focus ring
}

export default function ResidentSupportPage() {
  const [phase, setPhase] = useState<Phase>('intro')
  const [qIndex, setQIndex] = useState(0)
  const [answers, setAnswers] = useState<WelfareProfile>({ ...EMPTY_PROFILE })
  const [freeText, setFreeText] = useState('')
  const [results, setResults] = useState<WelfareResult[]>([])

  const [ttsSupported, setTtsSupported] = useState(false)
  const [micSupported, setMicSupported] = useState(false)
  const [listening, setListening] = useState(false)

  const recognitionRef = useRef<any>(null)

  // Detect browser capabilities after mount (avoids SSR mismatch).
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) setTtsSupported(true)
    const SR =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null
    if (SR) setMicSupported(true)
  }, [])

  // ── TTS ──────────────────────────────────────────────────────────────────────

  const speak = useCallback(
    (text: string) => {
      if (!ttsSupported || typeof window === 'undefined') return
      try {
        window.speechSynthesis.cancel() // global stop — new read cancels previous
        const u = new SpeechSynthesisUtterance(text)
        u.lang = 'ko-KR'
        u.rate = 0.92
        u.pitch = 1
        window.speechSynthesis.speak(u)
      } catch {
        /* no-op */
      }
    },
    [ttsSupported]
  )

  const stopSpeaking = useCallback(() => {
    if (ttsSupported && typeof window !== 'undefined') {
      try {
        window.speechSynthesis.cancel()
      } catch {
        /* no-op */
      }
    }
  }, [ttsSupported])

  // The main narration text for the current screen (used by 🔊 and 다시 듣기).
  const screenSpeech = useCallback((): string => {
    if (phase === 'intro') {
      return '받을 수 있는 복지를 찾아드려요. 간단한 질문 몇 개에 답하면, 받을 수 있는 도움을 찾아드려요. 시작하려면 시작하기 단추를 누르세요.'
    }
    if (phase === 'question') {
      const cur = QUESTIONS[qIndex]
      const opts = cur?.allowMaybe ? '예, 아니요, 또는 잘 모르겠어요' : '예 또는 아니요'
      return `질문 ${qIndex + 1}. ${cur?.q ?? ''} ${opts} 중에서 골라주세요.`
    }
    if (phase === 'freetext') {
      return '더 알려주실 것이 있나요? 몸 상태나 형편, 어려운 점을 편하게 적어주세요. 없으면 건너뛰어도 괜찮아요.'
    }
    if (phase === 'results') {
      if (results.length === 0) {
        return '지금은 딱 맞는 결과를 찾지 못했어요. 가까운 읍면동 주민센터나 보건복지상담센터 백이십구 번으로 문의해 주세요.'
      }
      return '이런 도움을 받으실 수 있어요. 정확한 자격은 아래 연락처나 가까운 주민센터에서 꼭 확인하세요.'
    }
    return ''
  }, [phase, qIndex, results.length])

  // Auto-narrate questions on arrival (audio is already unlocked after 시작하기).
  useEffect(() => {
    if (phase === 'question') {
      speak(screenSpeech())
    }
    // Stop any narration when leaving into loading/results transitions handled elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, qIndex])

  // Stop narration on unmount.
  useEffect(() => () => stopSpeaking(), [stopSpeaking])

  // ── Mic (SpeechRecognition) ────────────────────────────────────────────────

  const toggleMic = useCallback(() => {
    if (!micSupported || typeof window === 'undefined') return
    if (listening) {
      try {
        recognitionRef.current?.stop()
      } catch {
        /* no-op */
      }
      setListening(false)
      return
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    rec.lang = 'ko-KR'
    rec.interimResults = false
    rec.continuous = false
    rec.maxAlternatives = 1
    rec.onresult = (e: any) => {
      let transcript = ''
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0]?.transcript ?? ''
      }
      transcript = transcript.trim()
      if (transcript) {
        setFreeText((prev) => (prev ? `${prev} ${transcript}` : transcript))
      }
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recognitionRef.current = rec
    try {
      stopSpeaking()
      rec.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }, [micSupported, listening, stopSpeaking])

  // ── Flow actions ───────────────────────────────────────────────────────────

  const restart = useCallback(() => {
    stopSpeaking()
    setAnswers({ ...EMPTY_PROFILE })
    setFreeText('')
    setResults([])
    setQIndex(0)
    setPhase('intro')
  }, [stopSpeaking])

  const startFlow = useCallback(() => {
    stopSpeaking()
    setQIndex(0)
    setPhase('question')
  }, [stopSpeaking])

  const answerCurrent = useCallback(
    (value: boolean | null) => {
      stopSpeaking()
      const cur = QUESTIONS[qIndex]
      if (cur) {
        setAnswers((prev) => ({ ...prev, [cur.key]: value }))
      }
      if (qIndex < QUESTIONS.length - 1) {
        setQIndex((i) => i + 1)
      } else {
        setPhase('freetext')
      }
    },
    [qIndex, stopSpeaking]
  )

  const goBack = useCallback(() => {
    stopSpeaking()
    if (qIndex > 0) {
      setQIndex((i) => i - 1)
    } else {
      setPhase('intro')
    }
  }, [qIndex, stopSpeaking])

  const submit = useCallback(async () => {
    stopSpeaking()
    setPhase('loading')

    let profile: WelfareProfile = { ...answers }
    const text = freeText.trim()

    // Phase 2.5 → interpret free text into profile (silent fallback on failure).
    if (text) {
      try {
        const res = await fetch('/api/jeju/resident/interpret', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile, freeText: text }),
        })
        if (res.ok) {
          const data = (await res.json()) as { profile?: WelfareProfile }
          if (data.profile) profile = data.profile
        }
      } catch {
        /* fall back to the 6-answer profile */
      }
    }

    try {
      const res = await fetch('/api/jeju/resident/welfare-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...profile, region: 'jeju', limit: 15 }),
      })
      if (res.ok) {
        const data = (await res.json()) as { results?: WelfareResult[] }
        setResults(Array.isArray(data.results) ? data.results : [])
      } else {
        setResults([])
      }
    } catch {
      setResults([])
    }
    setPhase('results')
  }, [answers, freeText, stopSpeaking])

  // Narrate a single result card.
  const speakCard = useCallback(
    (r: WelfareResult) => {
      const benefit = r.benefitPlain ?? r.oneLineSummary ?? ''
      const eligibility =
        r.eligibilityPlain.length > 0 ? `이런 분이 받아요. ${r.eligibilityPlain.join(', ')}.` : ''
      const prepare =
        r.preparePlain.length > 0
          ? `가져갈 것. ${r.preparePlain.join(', ')}.`
          : '가져갈 것은 신청처에서 안내받으세요.'
      const where = r.applyWherePlain ?? r.contact ?? '가까운 읍면동 주민센터에 문의하세요'
      const parts = [r.name, benefit, eligibility, prepare, `신청처. ${where}`].filter(Boolean)
      speak(parts.join(' '))
    },
    [speak]
  )

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={styles.root}>
      <style>{GLOBAL_CSS}</style>

      <main style={styles.frame}>
        {/* Persistent controls — SAME position on every screen */}
        <div style={styles.topBar}>
          <button
            type="button"
            className="wf-ctrl"
            style={styles.ctrlBtn}
            onClick={restart}
            aria-label="처음으로 돌아가기"
          >
            <span aria-hidden>↩</span> 처음으로
          </button>
          {ttsSupported && (
            <button
              type="button"
              className="wf-ctrl"
              style={styles.ctrlBtn}
              onClick={() => speak(screenSpeech())}
              aria-label="이 화면 다시 듣기"
            >
              <span aria-hidden>🔊</span> 다시 듣기
            </button>
          )}
        </div>

        {phase === 'intro' && (
          <section style={styles.screen} aria-labelledby="wf-title">
            <h1 id="wf-title" style={styles.h1}>
              받을 수 있는 복지를<br />찾아드려요
            </h1>
            <p style={styles.lead}>
              간단한 질문 몇 개에 답하면,<br />받을 수 있는 도움을 찾아드려요.
            </p>
            <ReadAloud show={ttsSupported} onClick={() => speak(screenSpeech())} />
            <button type="button" className="wf-primary" style={styles.primaryBtn} onClick={startFlow}>
              시작하기
            </button>
          </section>
        )}

        {phase === 'question' && (
          <section style={styles.screen} aria-labelledby="wf-q">
            <ProgressDots total={QUESTIONS.length} current={qIndex} />
            <p style={styles.progressText} aria-hidden>
              {qIndex + 1} / {QUESTIONS.length}
            </p>
            <h1 id="wf-q" style={styles.h1}>
              {QUESTIONS[qIndex]?.q}
            </h1>
            <ReadAloud show={ttsSupported} onClick={() => speak(screenSpeech())} />

            <div style={styles.answerCol}>
              <button
                type="button"
                className="wf-answer wf-yes"
                style={{ ...styles.answerBtn, ...styles.answerYes }}
                onClick={() => answerCurrent(true)}
              >
                예
              </button>
              <button
                type="button"
                className="wf-answer wf-no"
                style={{ ...styles.answerBtn, ...styles.answerNo }}
                onClick={() => answerCurrent(false)}
              >
                아니요
              </button>
              {QUESTIONS[qIndex]?.allowMaybe && (
                <button
                  type="button"
                  className="wf-answer wf-maybe"
                  style={{ ...styles.answerBtn, ...styles.answerMaybe }}
                  onClick={() => answerCurrent(null)}
                >
                  잘 모르겠어요
                </button>
              )}
            </div>

            <button type="button" className="wf-back" style={styles.backBtn} onClick={goBack}>
              <span aria-hidden>←</span> 이전
            </button>
          </section>
        )}

        {phase === 'freetext' && (
          <section style={styles.screen} aria-labelledby="wf-ft">
            <h1 id="wf-ft" style={styles.h1}>
              더 알려주실 것이 있나요?
            </h1>
            <p style={styles.lead}>
              몸 상태나 형편, 어려운 점을 편하게 적어주세요.<br />없으면 건너뛰어도 괜찮아요.
            </p>
            <ReadAloud show={ttsSupported} onClick={() => speak(screenSpeech())} />

            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="예) 허리가 아파서 병원비가 부담돼요. 혼자 지내고 있어요."
              style={styles.textarea}
              aria-label="추가로 알려주실 내용"
              rows={5}
            />

            {micSupported && (
              <button
                type="button"
                className={listening ? 'wf-mic wf-mic-on' : 'wf-mic'}
                style={{ ...styles.micBtn, ...(listening ? styles.micOn : null) }}
                onClick={toggleMic}
                aria-pressed={listening}
              >
                <span aria-hidden>🎤</span> {listening ? '듣고 있어요… (다시 누르면 멈춤)' : '말로 입력하기'}
              </button>
            )}

            <div style={styles.ftActions}>
              <button
                type="button"
                className="wf-skip"
                style={styles.skipBtn}
                onClick={() => {
                  setFreeText('')
                  submit()
                }}
              >
                건너뛰기
              </button>
              <button type="button" className="wf-primary" style={styles.primaryBtn} onClick={submit}>
                다음
              </button>
            </div>
          </section>
        )}

        {phase === 'loading' && (
          <section style={styles.screen} aria-live="polite">
            <div className="wf-spinner" style={styles.spinner} aria-hidden />
            <h1 style={styles.h1}>도움을 찾고 있어요…</h1>
            <p style={styles.lead}>잠시만 기다려 주세요.</p>
          </section>
        )}

        {phase === 'results' && (
          <section style={styles.screenWide} aria-labelledby="wf-res">
            <h1 id="wf-res" style={styles.h1}>
              이런 도움을<br />받으실 수 있어요
            </h1>

            {results.length > 0 ? (
              <>
                <p style={styles.note}>
                  정확한 자격은 아래 연락처나 가까운 주민센터에서 꼭 확인하세요.
                </p>
                <ReadAloud show={ttsSupported} onClick={() => speak(screenSpeech())} />

                <ul style={styles.cardList}>
                  {results.map((r) => {
                    const benefit = r.benefitPlain ?? r.oneLineSummary
                    const where =
                      r.applyWherePlain ?? r.contact ?? '가까운 읍·면·동 주민센터에 문의하세요.'
                    return (
                      <li key={r.seq} style={styles.card}>
                        {/* ① 제도명 */}
                        <h2 style={styles.cardTitle}>{r.name}</h2>

                        {/* ② 받는 내용 — most important, shown prominently */}
                        {benefit && (
                          <p style={styles.cardBenefit}>{benefit}</p>
                        )}

                        {/* ③ 이런 분이 받아요 */}
                        {r.eligibilityPlain.length > 0 && (
                          <div style={styles.cardBlock}>
                            <span style={styles.cardLabel}>이런 분이 받아요</span>
                            <ul style={styles.checkList}>
                              {r.eligibilityPlain.map((item, i) => (
                                <li key={i} style={styles.checkItem}>
                                  <span aria-hidden style={styles.checkMark}>✓</span>
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* ④ 가져갈 것 */}
                        <div style={styles.cardBlock}>
                          <span style={styles.cardLabel}>가져갈 것</span>
                          {r.preparePlain.length > 0 ? (
                            <ul style={styles.checkList}>
                              {r.preparePlain.map((item, i) => (
                                <li key={i} style={styles.checkItem}>
                                  <span aria-hidden style={styles.checkMark}>•</span>
                                  {item}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p style={styles.cardBodySoft}>
                              신분증을 챙기시고, 자세한 준비물은 신청처에서 안내받으세요.
                            </p>
                          )}
                        </div>

                        {/* ⑤ 어디서 신청하나 */}
                        <div style={styles.cardBlock}>
                          <span style={styles.cardLabel}>어디서 신청하나</span>
                          <p style={styles.cardWhere}>{where}</p>
                        </div>

                        {ttsSupported && (
                          <button
                            type="button"
                            className="wf-cardread"
                            style={styles.cardReadBtn}
                            onClick={() => speakCard(r)}
                          >
                            <span aria-hidden>🔊</span> 이 내용 읽어주기
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : (
              <div style={styles.card}>
                <p style={styles.cardSummary}>
                  지금은 딱 맞는 결과를 찾지 못했어요.
                </p>
                <p style={styles.cardBody}>
                  가까운 읍·면·동 주민센터를 방문하시거나, 보건복지상담센터{' '}
                  <strong style={{ color: C.sea }}>☎ 129</strong> 로 전화해 물어보세요.
                </p>
                <ReadAloud show={ttsSupported} onClick={() => speak(screenSpeech())} />
              </div>
            )}

            <button type="button" className="wf-primary" style={styles.primaryBtn} onClick={restart}>
              처음으로
            </button>
          </section>
        )}
      </main>
    </div>
  )
}

// ── Small presentational components ────────────────────────────────────────────

function ReadAloud({ show, onClick }: { show: boolean; onClick: () => void }) {
  if (!show) return null
  return (
    <button type="button" className="wf-read" style={styles.readBtn} onClick={onClick}>
      <span aria-hidden>🔊</span> 읽어주기
    </button>
  )
}

function ProgressDots({ total, current }: { total: number; current: number }) {
  return (
    <div style={styles.dots} role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current + 1}>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          aria-hidden
          style={{
            ...styles.dot,
            background: i <= current ? C.sea : '#B7CDD6',
            transform: i === current ? 'scale(1.25)' : 'scale(1)',
          }}
        />
      ))}
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Collapse leftover whitespace/newlines from API text into readable prose. */
function cleanText(s: string): string {
  return s
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    background: C.bg,
    color: C.ink,
    fontFamily:
      "'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
    display: 'flex',
    justifyContent: 'center',
    padding: '16px',
    boxSizing: 'border-box',
  },
  frame: {
    width: '100%',
    maxWidth: 640,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    position: 'sticky',
    top: 0,
    background: C.bg,
    paddingTop: 8,
    paddingBottom: 8,
    zIndex: 5,
  },
  ctrlBtn: {
    flex: 1,
    minHeight: 60,
    fontSize: 22,
    fontWeight: 700,
    color: C.ink,
    background: C.surface,
    border: `3px solid ${C.ink}`,
    borderRadius: 14,
    cursor: 'pointer',
    padding: '8px 12px',
  },
  screen: {
    background: C.surface,
    borderRadius: 20,
    padding: '28px 22px 32px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 22,
    boxShadow: '0 6px 22px rgba(15,34,51,0.10)',
  },
  screenWide: {
    background: C.surface,
    borderRadius: 20,
    padding: '28px 20px 32px',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    boxShadow: '0 6px 22px rgba(15,34,51,0.10)',
  },
  h1: {
    fontSize: 36,
    lineHeight: 1.3,
    fontWeight: 800,
    color: C.ink,
    margin: 0,
    textAlign: 'center',
  },
  lead: {
    fontSize: 22,
    lineHeight: 1.6,
    color: C.inkSoft,
    margin: 0,
    textAlign: 'center',
  },
  note: {
    fontSize: 20,
    lineHeight: 1.6,
    color: C.ink,
    background: '#DCEEF3',
    border: `2px solid ${C.sea}`,
    borderRadius: 14,
    padding: '14px 16px',
    margin: 0,
    textAlign: 'center',
  },
  primaryBtn: {
    minHeight: 72,
    fontSize: 28,
    fontWeight: 800,
    color: '#FFFFFF',
    background: C.sea,
    border: 'none',
    borderRadius: 16,
    cursor: 'pointer',
    padding: '12px 20px',
  },
  readBtn: {
    alignSelf: 'center',
    minHeight: 60,
    fontSize: 24,
    fontWeight: 700,
    color: C.sea,
    background: '#FFFFFF',
    border: `3px solid ${C.sea}`,
    borderRadius: 14,
    cursor: 'pointer',
    padding: '8px 24px',
  },
  answerCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  answerBtn: {
    minHeight: 78,
    fontSize: 30,
    fontWeight: 800,
    borderRadius: 16,
    cursor: 'pointer',
    padding: '12px 20px',
  },
  answerYes: {
    color: '#FFFFFF',
    background: C.yesBg,
    border: `3px solid ${C.seaStrong}`,
  },
  answerNo: {
    color: C.ink,
    background: '#FFFFFF',
    border: `3px solid ${C.ink}`,
  },
  answerMaybe: {
    color: C.ink,
    background: '#EAEFF2',
    border: `3px solid ${C.inkSoft}`,
  },
  backBtn: {
    alignSelf: 'center',
    minHeight: 60,
    fontSize: 24,
    fontWeight: 700,
    color: C.inkSoft,
    background: 'transparent',
    border: `3px solid ${C.inkSoft}`,
    borderRadius: 14,
    cursor: 'pointer',
    padding: '8px 28px',
  },
  dots: {
    display: 'flex',
    justifyContent: 'center',
    gap: 12,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: '50%',
    display: 'inline-block',
  },
  progressText: {
    fontSize: 22,
    fontWeight: 700,
    textAlign: 'center',
    color: C.inkSoft,
    margin: 0,
  },
  textarea: {
    fontSize: 22,
    lineHeight: 1.6,
    color: C.ink,
    background: '#FFFFFF',
    border: `3px solid ${C.ink}`,
    borderRadius: 14,
    padding: '14px 16px',
    minHeight: 160,
    resize: 'vertical',
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
  },
  micBtn: {
    minHeight: 68,
    fontSize: 24,
    fontWeight: 800,
    color: C.sea,
    background: '#FFFFFF',
    border: `3px solid ${C.sea}`,
    borderRadius: 16,
    cursor: 'pointer',
    padding: '10px 18px',
  },
  micOn: {
    color: '#FFFFFF',
    background: C.sea,
  },
  ftActions: {
    display: 'flex',
    gap: 14,
  },
  skipBtn: {
    flex: 1,
    minHeight: 72,
    fontSize: 26,
    fontWeight: 700,
    color: C.ink,
    background: '#EAEFF2',
    border: `3px solid ${C.inkSoft}`,
    borderRadius: 16,
    cursor: 'pointer',
    padding: '12px 16px',
  },
  spinner: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: '50%',
    border: `8px solid #CDE1E8`,
    borderTopColor: C.sea,
  },
  cardList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  card: {
    background: '#F4F9FB',
    border: `3px solid ${C.sea}`,
    borderRadius: 18,
    padding: '22px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  cardTitle: {
    fontSize: 30,
    fontWeight: 800,
    color: C.ink,
    margin: 0,
    lineHeight: 1.35,
  },
  cardSummary: {
    fontSize: 23,
    lineHeight: 1.6,
    color: C.ink,
    margin: 0,
    fontWeight: 600,
  },
  cardBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  cardLabel: {
    fontSize: 20,
    fontWeight: 800,
    color: C.sea,
  },
  cardBody: {
    fontSize: 20,
    lineHeight: 1.65,
    color: C.inkSoft,
    margin: 0,
  },
  cardReadBtn: {
    minHeight: 64,
    fontSize: 23,
    fontWeight: 800,
    color: '#FFFFFF',
    background: C.sea,
    border: 'none',
    borderRadius: 14,
    cursor: 'pointer',
    padding: '10px 16px',
    marginTop: 4,
  },
  cardBenefit: {
    fontSize: 26,
    fontWeight: 800,
    lineHeight: 1.45,
    color: C.ink,
    background: '#D4EDF5',
    border: `2px solid ${C.sea}`,
    borderRadius: 12,
    padding: '12px 16px',
    margin: 0,
  },
  checkList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  checkItem: {
    fontSize: 21,
    lineHeight: 1.55,
    color: C.ink,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkMark: {
    color: C.sea,
    fontWeight: 800,
    fontSize: 22,
    flexShrink: 0,
    marginTop: 1,
  },
  cardBodySoft: {
    fontSize: 20,
    lineHeight: 1.65,
    color: C.inkSoft,
    margin: 0,
    fontStyle: 'italic',
  },
  cardWhere: {
    fontSize: 22,
    lineHeight: 1.55,
    fontWeight: 700,
    color: C.sea,
    margin: 0,
  },
}

// Global CSS for focus visibility, reduced motion, spinner + mic animation.
const GLOBAL_CSS = `
  .wf-primary:focus-visible,
  .wf-answer:focus-visible,
  .wf-ctrl:focus-visible,
  .wf-read:focus-visible,
  .wf-back:focus-visible,
  .wf-skip:focus-visible,
  .wf-mic:focus-visible,
  .wf-cardread:focus-visible,
  textarea:focus-visible {
    outline: 5px solid ${C.focus};
    outline-offset: 3px;
  }
  .wf-primary:hover { background: ${C.seaStrong}; }
  .wf-answer, .wf-primary, .wf-ctrl, .wf-read, .wf-back, .wf-skip, .wf-mic, .wf-cardread {
    transition: transform 0.08s ease, background 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .wf-answer:active, .wf-primary:active { transform: scale(0.98); }
  .wf-spinner { animation: wf-spin 0.9s linear infinite; }
  .wf-mic-on { animation: wf-pulse 1.2s ease-in-out infinite; }
  @keyframes wf-spin { to { transform: rotate(360deg); } }
  @keyframes wf-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(10,92,122,0.5); }
    50% { box-shadow: 0 0 0 12px rgba(10,92,122,0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .wf-answer, .wf-primary, .wf-ctrl, .wf-read, .wf-back, .wf-skip, .wf-mic, .wf-cardread,
    .wf-spinner, .wf-mic-on {
      transition: none !important;
      animation: none !important;
    }
  }
`
