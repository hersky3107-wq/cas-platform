'use client'

/**
 * 병원·약 찾기 — resident medical hub.
 *
 * Menu of 3 sub-features:
 *   - 약 알아보기        → /care/photo?mode=medicine (built)
 *   - 증상으로 병원 찾기  → in-page symptom → department → hospital flow
 *   - 지금 문 연 곳       → 준비중 (next task)
 *
 * Accessibility: same palette + TTS + SpeechRecognition patterns as the other
 * resident pages. No localStorage.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ResidentLoading } from '@/app/care/_components/Loading'
import { getResidence, DEFAULT_RESIDENCE, shortLabel, regionLabel, type Residence } from '@/lib/care/residence'

// ── Theme (shared with photo/support pages) ────────────────────────────────────

const C = {
  bg: '#E8F2F5',
  surface: '#FFFFFF',
  ink: '#0F2233',
  inkSoft: '#33475B',
  sea: '#0A5C7A',
  seaStrong: '#07445B',
  focus: '#C2410C',
  muted: '#6B7A88',
  warnBg: '#FDECEC',
  warnBorder: '#C0392B',
  warnInk: '#8A241A',
}

type View = 'menu' | 'symptom' | 'open-now'
type SymptomPhase = 'input' | 'loading' | 'result'
type OpenNowPhase = 'select' | 'loading' | 'result'

interface Hospital {
  name: string
  addr: string | null
  tel: string | null
  type: string | null
  sgguCdNm: string | null
  area: string | null
  source: 'hira' | 'perplexity'
}

interface SymptomResult {
  emergency: boolean
  message?: string
  department?: string
  advice?: string
  minor?: boolean
  tierNote?: string | null
  hospitals?: Hospital[]
  sources?: string[]
  disclaimer?: string
}

interface OpenNowItem {
  name: string
  area: string | null
  addr: string | null
  tel: string | null
  type: string | null
  hoursNote: string | null
  source: 'hira' | 'perplexity'
}

interface OpenNowResult {
  items: OpenNowItem[]
  advice: string
  disclaimer: string
  sources?: string[]
}

export default function MedicalPage() {
  const router = useRouter()

  const [view, setView] = useState<View>('menu')
  const [phase, setPhase] = useState<SymptomPhase>('input')
  const [symptomText, setSymptomText] = useState('')
  const [result, setResult] = useState<SymptomResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)

  // open-now state
  const [onPhase, setOnPhase] = useState<OpenNowPhase>('select')
  const [onKind, setOnKind] = useState<'병원' | '약국' | null>(null)
  const [onResult, setOnResult] = useState<OpenNowResult | null>(null)
  const [onError, setOnError] = useState<string | null>(null)

  // Residence (region context for hospital/pharmacy search).
  const [residence, setResidenceState] = useState<Residence>(DEFAULT_RESIDENCE)

  const [ttsSupported, setTtsSupported] = useState(false)
  const [micSupported, setMicSupported] = useState(false)
  const [listening, setListening] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) setTtsSupported(true)
    const SR =
      typeof window !== 'undefined'
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null
    if (SR) setMicSupported(true)
    setResidenceState(getResidence() ?? DEFAULT_RESIDENCE)
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

  // ── Mic (SpeechRecognition) ─────────────────────────────────────────────────

  const toggleMic = useCallback(() => {
    if (!micSupported || typeof window === 'undefined') return
    if (listening && recognitionRef.current) {
      try { recognitionRef.current.stop() } catch { /* no-op */ }
      setListening(false)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    rec.lang = 'ko-KR'
    rec.interimResults = false
    rec.continuous = false
    rec.maxAlternatives = 1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let transcript = ''
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0]?.transcript ?? ''
      }
      if (transcript) setSymptomText((prev) => (prev ? prev + ' ' : '') + transcript)
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

  // ── Navigation helpers ──────────────────────────────────────────────────────

  const goHome = useCallback(() => {
    stopSpeaking()
    router.push('/care')
  }, [router, stopSpeaking])

  const backToMenu = useCallback(() => {
    stopSpeaking()
    setView('menu')
    setPhase('input')
    setResult(null)
    setErrorMsg(null)
    // reset open-now
    setOnPhase('select')
    setOnKind(null)
    setOnResult(null)
    setOnError(null)
  }, [stopSpeaking])

  const showToast = useCallback(
    (msg: string) => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
      setToastMsg(msg)
      speak(msg)
      toastTimer.current = setTimeout(() => setToastMsg(null), 3500)
    },
    [speak]
  )

  // ── Symptom submit ────────────────────────────────────────────────────────

  const submitSymptom = useCallback(async () => {
    const trimmed = symptomText.trim()
    if (!trimmed) return
    stopSpeaking()
    if (listening && recognitionRef.current) {
      try { recognitionRef.current.stop() } catch { /* no-op */ }
      setListening(false)
    }
    setErrorMsg(null)
    setResult(null)
    setPhase('loading')
    try {
      const res = await fetch('/api/care/symptom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symptom: trimmed, sidoCd: residence.sidoCode, regionLabel: regionLabel(residence) }),
      })
      const data = (await res.json()) as SymptomResult & { error?: string }
      if (!res.ok) {
        setErrorMsg(data.error ?? '지금은 확인이 어려워요. 잠시 후 다시 시도해 주세요.')
        setPhase('input')
        return
      }
      setResult(data)
      setPhase('result')
    } catch {
      setErrorMsg('연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.')
      setPhase('input')
    }
  }, [symptomText, listening, stopSpeaking, residence])

  const retrySymptom = useCallback(() => {
    stopSpeaking()
    setResult(null)
    setErrorMsg(null)
    setSourcesOpen(false)
    setPhase('input')
  }, [stopSpeaking])

  // ── Open-now submit ────────────────────────────────────────────────────────

  const submitOpenNow = useCallback(async (kind: '병원' | '약국') => {
    stopSpeaking()
    setOnError(null)
    setOnResult(null)
    setOnPhase('loading')
    try {
      const res = await fetch('/api/care/open-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          sidoCd: residence.sidoCode,
          regionLabel: regionLabel(residence),
          ...(residence.sigungu ? { area: residence.sigungu } : {}),
        }),
      })
      const data = (await res.json()) as OpenNowResult & { error?: string }
      if (!res.ok) {
        setOnError(data.error ?? '지금은 확인이 어려워요. 잠시 후 다시 시도해 주세요.')
        setOnPhase('select')
        return
      }
      setOnResult(data)
      setOnPhase('result')
    } catch {
      setOnError('연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.')
      setOnPhase('select')
    }
  }, [stopSpeaking, residence])

  // ── Result narration ────────────────────────────────────────────────────────

  const resultSpeech = useCallback((r: SymptomResult): string => {
    if (r.emergency) return r.message ?? '지금 바로 119에 전화하시거나 응급실로 가세요.'
    const parts: string[] = []
    if (r.department) parts.push(`${r.department}에 가시는 것이 좋겠어요.`)
    if (r.advice) parts.push(r.advice)
    const list = r.hospitals ?? []
    if (list.length > 0) {
      parts.push(`${shortLabel(residence)}에서 가실 수 있는 병원을 알려드릴게요.`)
      list.slice(0, 5).forEach((h) => {
        const loc = h.addr ?? h.area ?? ''
        parts.push(`${h.name}.${loc ? ' ' + loc + '.' : ''}${h.tel ? ' 전화 ' + h.tel + '.' : ''}`)
      })
    }
    if (r.disclaimer) parts.push(r.disclaimer)
    return parts.filter(Boolean).join(' ')
  }, [residence])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={styles.root}>
      <style>{GLOBAL_CSS}</style>

      <main style={styles.frame}>
        {/* Persistent top controls */}
        <div style={styles.topBar}>
          <button type="button" className="md-ctrl" style={styles.ctrlBtn} onClick={goHome} aria-label="처음으로 돌아가기">
            <span aria-hidden>↩</span> 처음으로
          </button>
          {(view === 'symptom' || view === 'open-now') && (
            <button type="button" className="md-ctrl" style={styles.ctrlBtn} onClick={backToMenu} aria-label="병원·약 메뉴로">
              <span aria-hidden>≡</span> 메뉴
            </button>
          )}
        </div>

        {/* ── MENU ─────────────────────────────────────────────────────────── */}
        {view === 'menu' && (
          <>
            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>🏥</span>
              <h1 style={styles.h1}>병원·약 찾기</h1>
              {ttsSupported && (
                <button
                  type="button"
                  className="md-read"
                  style={styles.readBtn}
                  onClick={() => speak('병원과 약 찾기입니다. 약 알아보기, 증상으로 병원 찾기, 지금 문 연 곳 중에서 골라보세요.')}
                  aria-label="이 화면 읽어주기"
                >
                  <span aria-hidden>🔊</span> 읽어주기
                </button>
              )}
            </header>

            <div style={styles.menuList}>
              <button
                type="button"
                className="md-card md-card-live"
                style={{ ...styles.menuCard, ...styles.menuCardLive }}
                onClick={() => { stopSpeaking(); router.push('/care/photo?mode=medicine') }}
                aria-label="약 알아보기 — 약봉투나 약통을 사진으로 확인"
              >
                <span style={styles.menuEmoji} aria-hidden>💊</span>
                <span style={styles.menuText}>
                  <span style={styles.menuTitle}>약 알아보기</span>
                  <span style={styles.menuSub}>약봉투·약통을 찍으면 무슨 약인지 알려드려요.</span>
                </span>
                <span style={styles.menuArrow} aria-hidden>→</span>
              </button>

              <button
                type="button"
                className="md-card md-card-live"
                style={{ ...styles.menuCard, ...styles.menuCardLive }}
                onClick={() => { stopSpeaking(); setView('symptom'); setPhase('input') }}
                aria-label="증상으로 병원 찾기"
              >
                <span style={styles.menuEmoji} aria-hidden>🩺</span>
                <span style={styles.menuText}>
                  <span style={styles.menuTitle}>증상으로 병원 찾기</span>
                  <span style={styles.menuSub}>어디가 아픈지 말하면 어느 병원에 가면 좋을지 알려드려요.</span>
                </span>
                <span style={styles.menuArrow} aria-hidden>→</span>
              </button>

              <button
                type="button"
                className="md-card md-card-live"
                style={{ ...styles.menuCard, ...styles.menuCardLive }}
                onClick={() => { stopSpeaking(); setView('open-now'); setOnPhase('select') }}
                aria-label="지금 문 연 곳 — 지금 열어 있는 병원·약국 찾기"
              >
                <span style={styles.menuEmoji} aria-hidden>🕘</span>
                <span style={styles.menuText}>
                  <span style={styles.menuTitle}>지금 문 연 곳</span>
                  <span style={styles.menuSub}>지금 문을 열어 있는 병원·약국을 알려드려요.</span>
                </span>
                <span style={styles.menuArrow} aria-hidden>→</span>
              </button>

              <button
                type="button"
                className="md-card md-card-live"
                style={{ ...styles.menuCard, ...styles.menuCardEmergency }}
                onClick={() => { stopSpeaking(); router.push('/care/emergency') }}
                aria-label="긴급·상담 전화 — 119, 112, 상담 번호, 가족, 주민센터"
              >
                <span style={styles.menuEmoji} aria-hidden>🆘</span>
                <span style={styles.menuText}>
                  <span style={styles.menuTitle}>긴급·상담 전화</span>
                  <span style={styles.menuSub}>119·112·상담·가족·주민센터 번호를 한곳에 모았어요.</span>
                </span>
                <span style={styles.menuArrow} aria-hidden>→</span>
              </button>
            </div>

            {toastMsg && <div role="status" aria-live="polite" style={styles.toast}>{toastMsg}</div>}
          </>
        )}

        {/* ── SYMPTOM ──────────────────────────────────────────────────────── */}
        {view === 'symptom' && (
          <>
            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>🩺</span>
              <h1 style={styles.h1}>증상으로 병원 찾기</h1>
            </header>

            {phase === 'input' && (
              <section style={styles.card}>
                <p style={styles.lead}>어디가 어떻게 아프세요?</p>
                {ttsSupported && (
                  <button
                    type="button"
                    className="md-read"
                    style={styles.readBtn}
                    onClick={() => speak('어디가 어떻게 아프세요? 아래 칸에 적으시거나, 말로 입력하기를 누르고 말씀해 주세요.')}
                    aria-label="안내 읽어주기"
                  >
                    <span aria-hidden>🔊</span> 읽어주기
                  </button>
                )}

                {errorMsg && <p style={styles.errorLine} role="alert">{errorMsg}</p>}

                <textarea
                  className="md-textarea"
                  style={styles.textarea}
                  value={symptomText}
                  onChange={(e) => setSymptomText(e.target.value)}
                  placeholder="예: 무릎이 아파요 / 며칠째 기침이 나요"
                  rows={4}
                  aria-label="증상 입력"
                />

                {micSupported && (
                  <button
                    type="button"
                    className="md-mic"
                    style={listening ? { ...styles.micBtn, ...styles.micBtnOn } : styles.micBtn}
                    onClick={toggleMic}
                    aria-label={listening ? '듣는 중 — 멈추기' : '말로 입력하기'}
                  >
                    <span aria-hidden>🎤</span> {listening ? '듣는 중… (멈추려면 누르세요)' : '말로 입력하기'}
                  </button>
                )}

                <button
                  type="button"
                  className="md-primary"
                  style={symptomText.trim() ? styles.primaryBtn : { ...styles.primaryBtn, opacity: 0.45, cursor: 'not-allowed' }}
                  onClick={submitSymptom}
                  disabled={!symptomText.trim()}
                  aria-disabled={!symptomText.trim()}
                >
                  <span aria-hidden>🔍</span> 병원 찾기
                </button>
              </section>
            )}

            {phase === 'loading' && (
              <ResidentLoading
                steps={[
                  '증상을 살펴보고 있어요',
                  `${shortLabel(residence)} 병원을 찾고 있어요`,
                  '전화번호를 확인하고 있어요',
                ]}
                ttsSupported={ttsSupported}
              />
            )}

            {phase === 'result' && result && (
              <section style={styles.resultWrap} aria-live="polite">
                {result.emergency ? (
                  <div style={styles.emergencyCard}>
                    <span style={styles.emergencyEmoji} aria-hidden>🚨</span>
                    <p style={styles.emergencyText}>{result.message ?? '지금 바로 119에 전화하시거나 응급실로 가세요.'}</p>
                    <a href="tel:119" className="md-primary" style={{ ...styles.primaryBtn, ...styles.callBtn, textDecoration: 'none' }}>
                      <span aria-hidden>📞</span> 119 전화하기
                    </a>
                    {ttsSupported && (
                      <button type="button" className="md-read" style={styles.readBtn} onClick={() => speak(result.message ?? '지금 바로 119에 전화하시거나 응급실로 가세요.')}>
                        <span aria-hidden>🔊</span> 읽어주기
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <div style={styles.card}>
                      <div style={styles.deptBanner}>
                        <span style={styles.deptLabel}>가시면 좋은 곳</span>
                        <span style={styles.deptValue}>{result.department}</span>
                      </div>
                      {result.advice && <p style={styles.advice}>{result.advice}</p>}
                      {result.tierNote && <p style={styles.tierNote}>{result.tierNote}</p>}
                      {ttsSupported && (
                        <button type="button" className="md-read" style={styles.readBtn} onClick={() => speak(resultSpeech(result))}>
                          <span aria-hidden>🔊</span> 읽어주기
                        </button>
                      )}
                    </div>

                    {(result.hospitals ?? []).length > 0 && (
                      <div style={styles.hospitalList}>
                        <h2 style={styles.listHeading}>{shortLabel(residence)}에서 가실 수 있는 병원</h2>
                        {(result.hospitals ?? []).map((h, i) => {
                          const digits = h.tel ? h.tel.replace(/[^0-9+]/g, '') : ''
                          const metaParts = [h.sgguCdNm ?? h.area, h.type].filter(Boolean) as string[]
                          return (
                            <div key={i} style={styles.hospitalCard}>
                              <div style={styles.hospitalName}>{h.name}</div>
                              {metaParts.length > 0 && (
                                <div style={styles.hospitalMeta}>{metaParts.join('  ·  ')}</div>
                              )}
                              {h.addr ? (
                                <div style={styles.hospitalAddr}>{h.addr}</div>
                              ) : (
                                <div style={styles.hospitalAddrSoft}>
                                  {h.area ? `${h.area} 부근` : '위치는 확인이 필요해요'} · 검색으로 찾은 정보예요
                                </div>
                              )}
                              {h.tel ? (
                                <a href={`tel:${digits}`} className="md-call" style={styles.telLink}>
                                  <span aria-hidden>📞</span> 전화하기 ({h.tel})
                                </a>
                              ) : (
                                <div style={styles.telUnknown}>전화번호는 확인이 필요해요</div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {(result.sources ?? []).length > 0 && (
                      <div style={styles.sourceWrap}>
                        <button
                          type="button"
                          className="md-source-toggle"
                          style={styles.sourceToggle}
                          onClick={() => setSourcesOpen((o) => !o)}
                          aria-expanded={sourcesOpen}
                        >
                          {sourcesOpen ? '▲ 정보 출처 닫기' : '이 정보는 어디서 왔나요? ▾'}
                        </button>
                        {sourcesOpen && (
                          <div style={styles.sourceList}>
                            {(result.sources ?? []).slice(0, 5).map((s, i) => (
                              <a key={i} href={s} target="_blank" rel="noopener noreferrer" style={styles.sourceLink}>
                                {s}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {result.disclaimer && <p style={styles.disclaimer}>{result.disclaimer}</p>}
                  </>
                )}

                <button type="button" className="md-primary" style={styles.primaryBtn} onClick={retrySymptom}>
                  <span aria-hidden>🔄</span> 다시 물어보기
                </button>
              </section>
            )}
          </>
        )}
        {/* ── OPEN-NOW ─────────────────────────────────────────────────── */}
        {view === 'open-now' && (
          <>
            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>🕘</span>
              <h1 style={styles.h1}>지금 문 연 곳</h1>
            </header>

            {/* Emergency line — always visible at top */}
            <div style={styles.emergencyNote} role="note">
              <span aria-hidden>🚨</span> 급하시면 <strong>119</strong> 또는 응급실로 바로 가세요.
              <a href="tel:119" style={styles.emergencyNoteLink} aria-label="119 전화하기">📞 119</a>
            </div>

            {onPhase === 'select' && (
              <section style={styles.card}>
                <p style={styles.lead}>병원을 찾으세요? 약국을 찾으세요?</p>

                {onError && <p style={styles.errorLine} role="alert">{onError}</p>}

                <div style={styles.kindRow}>
                  <button
                    type="button"
                    className="md-kind"
                    style={onKind === '병원' ? { ...styles.kindBtn, ...styles.kindBtnOn } : styles.kindBtn}
                    onClick={() => setOnKind('병원')}
                    aria-pressed={onKind === '병원'}
                  >
                    <span aria-hidden>🏥</span> 병원
                  </button>
                  <button
                    type="button"
                    className="md-kind"
                    style={onKind === '약국' ? { ...styles.kindBtn, ...styles.kindBtnOn } : styles.kindBtn}
                    onClick={() => setOnKind('약국')}
                    aria-pressed={onKind === '약국'}
                  >
                    <span aria-hidden>💊</span> 약국
                  </button>
                </div>

                <p style={styles.areaLabel}><span aria-hidden>📍</span> {regionLabel(residence)} 기준으로 찾아드려요.</p>

                <button
                  type="button"
                  className="md-primary"
                  style={onKind ? styles.primaryBtn : { ...styles.primaryBtn, opacity: 0.45, cursor: 'not-allowed' }}
                  onClick={() => onKind && submitOpenNow(onKind)}
                  disabled={!onKind}
                  aria-disabled={!onKind}
                >
                  <span aria-hidden>🔍</span> 지금 찾기
                </button>
              </section>
            )}

            {onPhase === 'loading' && (
              <ResidentLoading
                steps={[
                  '지금 문 연 곳을 찾고 있어요',
                  '전화번호를 확인하고 있어요',
                ]}
                ttsSupported={ttsSupported}
              />
            )}

            {onPhase === 'result' && onResult && (
              <section style={styles.resultWrap} aria-live="polite">
                {/* Phone-check note — prominent */}
                <div style={styles.callCheckNote} role="note">
                  <span aria-hidden>📞</span> <strong>영업 시간은 바뀔 수 있으니, 가시기 전에 꼭 전화로 확인하세요.</strong>
                </div>

                {onResult.items.length === 0 ? (
                  <div style={styles.card}>
                    <p style={{ ...styles.lead, fontSize: 22 }}>
                      지금 열려 있는 곳을 찾지 못했어요.<br />직접 전화해서 확인하시거나 119에 문의하세요.
                    </p>
                  </div>
                ) : (
                  <div style={styles.hospitalList}>
                    <h2 style={styles.listHeading}>
                      {onKind} · {shortLabel(residence)}
                    </h2>
                    {onResult.items.map((item, i) => {
                      const digits = item.tel ? item.tel.replace(/[^0-9+]/g, '') : ''
                      const metaParts = [item.area, item.type].filter(Boolean) as string[]
                      return (
                        <div key={i} style={styles.hospitalCard}>
                          <div style={styles.hospitalName}>{item.name}</div>
                          {item.hoursNote && (
                            <div style={styles.hoursNote}>{item.hoursNote}</div>
                          )}
                          {metaParts.length > 0 && (
                            <div style={styles.hospitalMeta}>{metaParts.join('  ·  ')}</div>
                          )}
                          {item.addr ? (
                            <div style={styles.hospitalAddr}>{item.addr}</div>
                          ) : (
                            <div style={styles.hospitalAddrSoft}>
                              {item.area ? `${item.area} 부근` : '위치는 확인이 필요해요'} · 검색으로 찾은 정보예요
                            </div>
                          )}
                          {item.tel ? (
                            <a href={`tel:${digits}`} className="md-call" style={styles.telLink}>
                              <span aria-hidden>📞</span> 전화하기 ({item.tel})
                            </a>
                          ) : (
                            <div style={styles.telUnknown}>전화번호는 확인이 필요해요 — 검색해 보세요</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {onResult.disclaimer && (
                  <p style={styles.disclaimer}>{onResult.disclaimer}</p>
                )}

                <button
                  type="button"
                  className="md-primary"
                  style={styles.primaryBtn}
                  onClick={() => {
                    setOnResult(null)
                    setOnError(null)
                    setOnPhase('select')
                  }}
                >
                  <span aria-hidden>🔄</span> 다시 찾기
                </button>
              </section>
            )}
          </>
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
    justifyContent: 'center',
    padding: '0 16px 40px',
    boxSizing: 'border-box',
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
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  headerEmoji: { fontSize: 46, lineHeight: 1 },
  h1: { fontSize: 34, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.25 },
  menuList: { display: 'flex', flexDirection: 'column', gap: 16 },
  menuCard: {
    position: 'relative', display: 'flex', alignItems: 'center', gap: 16,
    minHeight: 108, background: C.surface, border: `2px solid #CBD9E1`, borderRadius: 18,
    padding: '18px 20px', cursor: 'pointer', textAlign: 'left', width: '100%',
  },
  menuCardLive: { border: `3px solid ${C.sea}` },
  menuCardEmergency: { border: `3px solid ${C.warnBorder}`, background: '#FFF7F6' },
  menuEmoji: { fontSize: 42, lineHeight: 1, flexShrink: 0 },
  menuText: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1 },
  menuTitle: { fontSize: 26, fontWeight: 900, color: C.ink, lineHeight: 1.25 },
  menuSub: { fontSize: 19, fontWeight: 500, color: C.inkSoft, lineHeight: 1.45 },
  menuArrow: { fontSize: 30, fontWeight: 900, color: C.sea, flexShrink: 0 },
  badge: {
    position: 'absolute', top: 10, right: 12, fontSize: 15, fontWeight: 800, color: C.muted,
    background: '#EDF1F4', border: `1px solid ${C.muted}`, borderRadius: 8, padding: '2px 8px',
  },
  card: {
    background: C.surface, borderRadius: 20, padding: '24px 22px 28px',
    display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 6px 22px rgba(15,34,51,0.10)',
  },
  resultWrap: { display: 'flex', flexDirection: 'column', gap: 16 },
  lead: { fontSize: 24, lineHeight: 1.5, color: C.ink, fontWeight: 800, margin: 0, textAlign: 'center' },
  errorLine: { fontSize: 20, color: C.warnInk, fontWeight: 700, margin: 0, textAlign: 'center' },
  textarea: {
    fontSize: 22, lineHeight: 1.6, color: C.ink,
    background: '#FAFCFD', border: `3px solid ${C.sea}`, borderRadius: 14,
    padding: '14px 16px', resize: 'vertical', minHeight: 120,
    fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif",
    width: '100%', boxSizing: 'border-box',
  },
  micBtn: {
    minHeight: 66, fontSize: 22, fontWeight: 700, color: C.sea,
    background: '#EAF4F8', border: `2px solid ${C.sea}`, borderRadius: 14, cursor: 'pointer',
    padding: '10px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  micBtnOn: { background: C.sea, color: '#FFFFFF' },
  primaryBtn: {
    minHeight: 76, fontSize: 28, fontWeight: 800, color: '#FFFFFF', background: C.sea,
    border: 'none', borderRadius: 16, cursor: 'pointer', padding: '12px 20px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  callBtn: { background: C.warnBorder },
  readBtn: {
    alignSelf: 'center', minHeight: 60, fontSize: 22, fontWeight: 700, color: C.sea, background: '#FFFFFF',
    border: `3px solid ${C.sea}`, borderRadius: 14, cursor: 'pointer', padding: '8px 26px',
  },
  // department
  deptBanner: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    background: '#D4EDF5', border: `3px solid ${C.sea}`, borderRadius: 16, padding: '18px 16px',
  },
  deptLabel: { fontSize: 20, fontWeight: 800, color: C.sea },
  deptValue: { fontSize: 40, fontWeight: 900, color: C.ink, lineHeight: 1.1 },
  advice: { fontSize: 21, lineHeight: 1.65, color: C.inkSoft, margin: 0 },
  tierNote: {
    fontSize: 20, lineHeight: 1.6, color: C.seaStrong, fontWeight: 700, margin: 0,
    background: '#DCEEF3', border: `2px solid ${C.sea}`, borderRadius: 12, padding: '12px 14px',
  },
  // hospital list
  hospitalList: { display: 'flex', flexDirection: 'column', gap: 16 },
  listHeading: { fontSize: 24, fontWeight: 900, color: C.ink, margin: '4px 0 0' },
  hospitalCard: {
    display: 'block',
    background: C.surface, border: `2px solid #CBD9E1`, borderRadius: 16, padding: '20px 20px',
    boxShadow: '0 3px 12px rgba(15,34,51,0.06)',
  },
  hospitalName: {
    display: 'block', fontSize: 26, fontWeight: 900, color: C.ink, lineHeight: 1.3,
    wordBreak: 'keep-all', marginBottom: 8,
  },
  hospitalMeta: {
    display: 'block', fontSize: 18, fontWeight: 700, color: C.sea, lineHeight: 1.4, marginBottom: 6,
  },
  hospitalAddr: {
    display: 'block', fontSize: 20, lineHeight: 1.55, color: C.inkSoft, wordBreak: 'keep-all', marginBottom: 14,
  },
  hospitalAddrSoft: {
    display: 'block', fontSize: 19, lineHeight: 1.55, color: C.muted, fontStyle: 'normal',
    wordBreak: 'keep-all', marginBottom: 14,
  },
  telLink: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    width: '100%', boxSizing: 'border-box', minHeight: 62,
    fontSize: 23, fontWeight: 800, color: '#FFFFFF', background: C.sea,
    borderRadius: 14, padding: '12px 16px', textDecoration: 'none',
  },
  telUnknown: {
    display: 'block', textAlign: 'center', fontSize: 18, fontWeight: 700, color: C.muted,
    background: '#F0F3F5', borderRadius: 12, padding: '14px 16px',
  },
  // emergency
  emergencyCard: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
    background: C.warnBg, border: `4px solid ${C.warnBorder}`, borderRadius: 20, padding: '28px 22px',
  },
  emergencyEmoji: { fontSize: 60, lineHeight: 1 },
  emergencyText: { fontSize: 30, fontWeight: 900, color: C.warnInk, textAlign: 'center', lineHeight: 1.4, margin: 0 },
  // sources / disclaimer
  sourceWrap: { display: 'flex', flexDirection: 'column', gap: 0 },
  sourceToggle: {
    alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 17, fontWeight: 700, color: C.muted, padding: '8px 4px',
    textDecoration: 'underline', textUnderlineOffset: 3,
  },
  sourceList: {
    display: 'flex', flexDirection: 'column', gap: 6,
    background: '#F0F5F8', borderRadius: 12, padding: '14px 16px', marginTop: 6,
  },
  sourceLink: { fontSize: 16, color: C.sea, wordBreak: 'break-all', lineHeight: 1.5 },
  disclaimer: {
    fontSize: 20, lineHeight: 1.6, color: C.warnInk, fontWeight: 700, margin: 0, textAlign: 'center',
    background: C.warnBg, border: `2px solid ${C.warnBorder}`, borderRadius: 12, padding: '14px 16px',
  },
  toast: {
    marginTop: 4, fontSize: 20, fontWeight: 700, color: C.ink, textAlign: 'center',
    background: '#FFF6DE', border: '2px solid #B7791F', borderRadius: 14, padding: '14px 16px',
  },
  // emergency line (inline, always top of open-now view)
  emergencyNote: {
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const,
    background: C.warnBg, border: `3px solid ${C.warnBorder}`, borderRadius: 16,
    padding: '16px 18px', fontSize: 22, fontWeight: 800, color: C.warnInk,
  },
  emergencyNoteLink: {
    marginLeft: 'auto', minHeight: 52, padding: '8px 18px',
    fontSize: 21, fontWeight: 800, color: '#FFFFFF', background: C.warnBorder,
    borderRadius: 12, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6,
  },
  // call-check note
  callCheckNote: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    background: '#FFF6DE', border: '3px solid #B7791F', borderRadius: 16,
    padding: '16px 18px', fontSize: 21, fontWeight: 700, color: '#744210', lineHeight: 1.5,
  },
  // kind / area selectors
  kindRow: { display: 'flex', gap: 14 },
  kindBtn: {
    flex: 1, minHeight: 90, fontSize: 30, fontWeight: 900,
    color: C.ink, background: '#F0F5F8', border: `3px solid #CBD9E1`,
    borderRadius: 18, cursor: 'pointer', display: 'flex', flexDirection: 'column' as const,
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  kindBtnOn: { background: C.sea, color: '#FFFFFF', border: `3px solid ${C.sea}` },
  areaLabel: { fontSize: 20, fontWeight: 700, color: C.inkSoft, margin: '4px 0 2px' },
  areaRow: { display: 'flex', gap: 10 },
  areaBtn: {
    flex: 1, minHeight: 58, fontSize: 20, fontWeight: 800,
    color: C.sea, background: '#EAF4F8', border: `2px solid ${C.sea}`,
    borderRadius: 14, cursor: 'pointer',
  },
  areaBtnOn: { background: C.sea, color: '#FFFFFF' },
  // hours note badge inside hospital card
  hoursNote: {
    display: 'inline-block', fontSize: 17, fontWeight: 800, color: C.seaStrong,
    background: '#D4EDF5', border: `2px solid ${C.sea}`, borderRadius: 8,
    padding: '3px 10px', marginBottom: 6,
  },
}

const GLOBAL_CSS = `
  .md-primary:focus-visible, .md-ctrl:focus-visible, .md-read:focus-visible,
  .md-card:focus-visible, .md-mic:focus-visible, .md-call:focus-visible,
  .md-source-toggle:focus-visible, .md-kind:focus-visible, .md-area:focus-visible {
    outline: 5px solid ${C.focus}; outline-offset: 3px;
  }
  .md-textarea:focus { outline: 4px solid ${C.sea}; outline-offset: 0; border-color: ${C.seaStrong} !important; }
  .md-textarea:focus-visible { outline: 5px solid ${C.focus}; outline-offset: 2px; }
  .md-primary:hover:not(:disabled) { background: ${C.seaStrong}; }
  .md-primary:disabled { cursor: not-allowed !important; }
  .md-card-live:hover { background: #EAF4F8; }
  .md-card:hover { border-color: ${C.sea}; }
  .md-primary, .md-ctrl, .md-read, .md-card, .md-mic, .md-call, .md-kind, .md-area {
    transition: transform 0.08s ease, background 0.15s ease; -webkit-tap-highlight-color: transparent;
  }
  .md-primary:active:not(:disabled), .md-card:active, .md-kind:active, .md-area:active { transform: scale(0.98); }
  .md-spinner { animation: md-spin 0.9s linear infinite; }
  @keyframes md-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .md-primary, .md-ctrl, .md-read, .md-card, .md-mic, .md-call, .md-kind, .md-area, .md-spinner {
      transition: none !important; animation: none !important; transform: none !important;
    }
  }
`
