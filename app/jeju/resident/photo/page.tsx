'use client'

/**
 * 사진 도우미 — multimodal photo helper for resident mode.
 *
 * One page, four modes (via ?mode=document|phishing|kiosk|medicine).
 * Phishing mode also accepts typed/pasted text — no photo required.
 * Accessibility-first (same palette + TTS as support/page.tsx).
 *
 * PRIVACY: the chosen photo/text is sent once to the stateless analyze endpoint
 * and never stored anywhere (no upload persistence, no localStorage).
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { residentHome } from '@/app/jeju/resident/_lib/origin'

// ── Theme ──────────────────────────────────────────────────────────────────────

const C = {
  bg: '#FBF4E6',
  surface: '#FFFFFF',
  ink: '#12263A',
  inkSoft: '#3C4C60',
  sea: '#0E4E8A',
  seaStrong: '#0A3A66',
  focus: '#E8590C',
  warnBg: '#FCE8E6',
  warnBorder: '#B91C1C',
  warnInk: '#7F1D1D',
  cautionBg: '#FEF6E4',
  cautionBorder: '#B7791F',
}

type PhotoMode = 'document' | 'phishing' | 'kiosk' | 'medicine'

const MODE_META: Record<PhotoMode, { emoji: string; title: string; hint: string }> = {
  document: { emoji: '📄', title: '고지서·문서 읽기', hint: '고지서나 안내문을 찍으면 쉽게 알려드려요.' },
  phishing: { emoji: '🛡️', title: '수상한 문자 확인', hint: '문자 내용을 붙여넣거나, 사진으로 찍어 위험한지 확인하세요.' },
  kiosk: { emoji: '🖥️', title: '무인기계 도움', hint: '무인기계 화면을 찍으면 다음에 뭘 할지 알려드려요.' },
  medicine: { emoji: '💊', title: '약 알아보기', hint: '약봉투나 약통을 찍으면 무슨 약인지 알려드려요.' },
}

const RISK_COLORS: Record<string, { bg: string; border: string; ink: string }> = {
  높음: { bg: '#FCE8E6', border: '#B91C1C', ink: '#7F1D1D' },
  의심: { bg: '#FEF6E4', border: '#B7791F', ink: '#7A5410' },
  확인불가: { bg: '#F5EAD6', border: '#5E5A50', ink: '#3C4C60' },
}

// ── Help guide (phishing) ──────────────────────────────────────────────────────

const GUIDE_ITEMS = [
  "문자를 손가락으로 꾹 누르면 '복사'가 나와요. 복사한 뒤, 위 '복사한 문자 가져오기'를 누르세요.",
  '또는 문자 내용을 위 칸에 직접 적어도 돼요.',
  "사진으로 찍거나, 화면을 캡처해서 '사진 고르기'로 불러와도 돼요.",
  '이 방법들이 어려우시면, 가족이나 가까운 분께 함께 봐달라고 부탁하세요. 그게 가장 안전해요.',
]

const GUIDE_NARRATION =
  '수상한 문자를 확인하는 방법이에요. 첫째, 문자를 손가락으로 꾹 누르면 복사가 나와요. 복사한 뒤, 복사한 문자 가져오기를 누르세요. 둘째, 문자 내용을 위 칸에 직접 적어도 돼요. 셋째, 사진으로 찍거나, 화면을 캡처해서 사진 고르기로 불러와도 돼요. 넷째, 이 방법들이 어려우시면, 가족이나 가까운 분께 함께 봐달라고 부탁하세요. 그게 가장 안전해요.'

// ── Result type ────────────────────────────────────────────────────────────────

type AnalyzeResult = {
  mode?: PhotoMode
  unreadable?: boolean
  message?: string
  error?: string
  // document
  mainAction?: string
  amount?: string | null
  dueDate?: string | null
  where?: string | null
  details?: string[]
  warning?: string
  // phishing
  risk?: string
  reasons?: string[]
  dontDo?: string[]
  verifyHow?: string
  // kiosk
  screenIs?: string
  nextStep?: string
  caution?: string | null
  // medicine
  mainInfo?: string
  whatFor?: string | null
  howToTake?: string[]
  cautions?: string[]
}

type Phase = 'capture' | 'loading' | 'result'

// ── Inner component (uses useSearchParams → needs Suspense) ─────────────────────

function PhotoHelper() {
  const router = useRouter()
  const params = useSearchParams()
  const rawMode = params.get('mode')
  const mode: PhotoMode = (['document', 'phishing', 'kiosk', 'medicine'] as const).includes(
    rawMode as PhotoMode
  )
    ? (rawMode as PhotoMode)
    : 'document'
  const meta = MODE_META[mode]

  const [phase, setPhase] = useState<Phase>('capture')
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [ttsSupported, setTtsSupported] = useState(false)
  // Phishing text input
  const [phishingText, setPhishingText] = useState('')
  const [loadingMsg, setLoadingMsg] = useState('살펴보고 있어요…')

  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) setTtsSupported(true)
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

  // ── Clipboard paste (phishing only) ────────────────────────────────────────

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setPhishingText(text)
    } catch {
      // Browser blocked clipboard or unsupported — silent no-op; manual paste still works.
    }
  }, [])

  // ── Text → analyze (phishing only) ─────────────────────────────────────────

  const handlePhishingText = useCallback(async () => {
    const trimmed = phishingText.trim()
    if (!trimmed) return
    stopSpeaking()
    setErrorMsg(null)
    setResult(null)
    setLoadingMsg('문자 내용을 살펴보고 있어요…')
    setPhase('loading')

    try {
      const res = await fetch('/api/jeju/resident/photo-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, mode: 'phishing' }),
      })
      const data = (await res.json()) as AnalyzeResult
      if (!res.ok && !data.unreadable) {
        setErrorMsg('확인하지 못했어요. 잠시 후 다시 시도해 주세요.')
        setPhase('capture')
        return
      }
      setResult(data)
      setPhase('result')
    } catch {
      setErrorMsg('연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.')
      setPhase('capture')
    }
  }, [phishingText, stopSpeaking])

  // ── File → base64 → analyze ──────────────────────────────────────────────

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      stopSpeaking()
      setErrorMsg(null)
      setResult(null)
      setLoadingMsg('사진을 살펴보고 있어요…')
      setPhase('loading')

      let dataUrl: string
      try {
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(new Error('read-failed'))
          reader.readAsDataURL(file)
        })
      } catch {
        setErrorMsg('사진을 불러오지 못했어요. 다시 시도해 주세요.')
        setPhase('capture')
        return
      }

      try {
        const res = await fetch('/api/jeju/resident/photo-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl, mode }),
        })
        const data = (await res.json()) as AnalyzeResult
        if (!res.ok && !data.unreadable) {
          setErrorMsg('사진을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.')
          setPhase('capture')
          return
        }
        setResult(data)
        setPhase('result')
      } catch {
        setErrorMsg('연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.')
        setPhase('capture')
      }
    },
    [mode, stopSpeaking]
  )

  const retake = useCallback(() => {
    stopSpeaking()
    setResult(null)
    setErrorMsg(null)
    setPhishingText('')
    setPhase('capture')
  }, [stopSpeaking])

  const goHome = useCallback(() => {
    stopSpeaking()
    router.push(residentHome())
  }, [router, stopSpeaking])

  // ── Build narration for results ───────────────────────────────────────────

  const resultSpeech = useCallback((r: AnalyzeResult): string => {
    if (r.unreadable) return r.message ?? '다시 시도해 주세요.'
    const parts: string[] = []
    if (mode === 'document') {
      parts.push(r.mainAction ?? '')
      if (r.amount) parts.push(`금액. ${r.amount}`)
      if (r.dueDate) parts.push(`기한. ${r.dueDate}`)
      if (r.where) parts.push(`방법. ${r.where}`)
      ;(r.details ?? []).forEach((d) => parts.push(d))
      if (r.warning) parts.push(r.warning)
    } else if (mode === 'phishing') {
      parts.push(`위험도. ${r.risk ?? '확인불가'}`)
      ;(r.reasons ?? []).forEach((d) => parts.push(d))
      if ((r.dontDo ?? []).length) parts.push('하지 마세요. ' + (r.dontDo ?? []).join(', '))
      if (r.verifyHow) parts.push(r.verifyHow)
    } else if (mode === 'kiosk') {
      parts.push(r.screenIs ?? '')
      if (r.nextStep) parts.push(`다음 할 일. ${r.nextStep}`)
      if (r.caution) parts.push(`주의. ${r.caution}`)
    } else if (mode === 'medicine') {
      parts.push(r.mainInfo ?? '')
      if (r.whatFor) parts.push(`이 약은. ${r.whatFor}`)
      if ((r.howToTake ?? []).length) parts.push('드시는 방법. ' + (r.howToTake ?? []).join(', '))
      if ((r.cautions ?? []).length) parts.push('주의. ' + (r.cautions ?? []).join(', '))
      if (r.warning) parts.push(r.warning)
    }
    return parts.filter(Boolean).join('. ')
  }, [mode])

  const retakeLabel = mode === 'phishing' ? '다시 확인하기' : '다시 찍기'
  const retakeIcon = mode === 'phishing' ? '🔄' : '📷'

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={styles.root}>
      <style>{GLOBAL_CSS}</style>

      {/* hidden file inputs */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      <main style={styles.frame}>
        {/* Persistent top controls */}
        <div style={styles.topBar}>
          <button type="button" className="ph-ctrl" style={styles.ctrlBtn} onClick={goHome} aria-label="처음으로 돌아가기">
            <span aria-hidden>↩</span> 처음으로
          </button>
          {phase === 'result' && (
            <button type="button" className="ph-ctrl" style={styles.ctrlBtn} onClick={retake} aria-label={retakeLabel}>
              <span aria-hidden>{retakeIcon}</span> {retakeLabel}
            </button>
          )}
        </div>

        {/* Header */}
        <header style={styles.header}>
          <span style={styles.headerEmoji} aria-hidden>{meta.emoji}</span>
          <h1 style={styles.h1}>{meta.title}</h1>
        </header>

        {/* ── CAPTURE phase ─────────────────────────────────────────────────── */}
        {phase === 'capture' && (
          mode === 'phishing' ? (
            // Phishing: text input + photo input + guide
            <>
              <section style={styles.card}>
                <p style={styles.privacy}>🔒 내용은 저장되지 않고 바로 사라집니다.</p>
                {errorMsg && <p style={styles.errorLine} role="alert">{errorMsg}</p>}

                {/* Text input section */}
                <div style={styles.sectionHead}>
                  <span style={styles.sectionLabel}>✍️ 문자 내용으로 확인하기</span>
                </div>

                <label htmlFor="phishing-textarea" style={styles.textareaLabel}>
                  문자 내용 붙여넣기
                </label>
                <textarea
                  id="phishing-textarea"
                  ref={textareaRef}
                  className="ph-textarea"
                  style={styles.textarea}
                  value={phishingText}
                  onChange={(e) => setPhishingText(e.target.value)}
                  placeholder="여기에 문자 내용을 붙여넣거나 직접 입력하세요"
                  rows={5}
                  aria-label="수상한 문자 내용 입력"
                />
                <button
                  type="button"
                  className="ph-clipboard"
                  style={styles.clipboardBtn}
                  onClick={pasteFromClipboard}
                  aria-label="복사한 문자 가져오기 (클립보드에서 자동으로 붙여넣기)"
                >
                  <span aria-hidden>📋</span> 복사한 문자 가져오기
                </button>
                <button
                  type="button"
                  className="ph-primary"
                  style={phishingText.trim() ? styles.primaryBtn : { ...styles.primaryBtn, opacity: 0.45, cursor: 'not-allowed' }}
                  onClick={handlePhishingText}
                  disabled={!phishingText.trim()}
                  aria-disabled={!phishingText.trim()}
                >
                  <span aria-hidden>🔍</span> 확인하기
                </button>

                {/* Photo input section */}
                <div style={styles.sectionDivider} role="separator" aria-hidden />
                <div style={styles.sectionHead}>
                  <span style={styles.sectionLabel}>📷 사진으로 확인하기</span>
                </div>

                <button type="button" className="ph-primary" style={styles.primaryBtn} onClick={() => cameraRef.current?.click()}>
                  <span aria-hidden>📷</span> 사진 찍기
                </button>
                <button type="button" className="ph-secondary" style={styles.secondaryBtn} onClick={() => galleryRef.current?.click()}>
                  <span aria-hidden>🖼️</span> 사진 고르기
                </button>
              </section>

              {/* Help guide */}
              <PhishingGuide ttsSupported={ttsSupported} speak={speak} />
            </>
          ) : (
            // Other modes: photo only
            <section style={styles.card}>
              <p style={styles.lead}>{meta.hint}</p>
              <p style={styles.privacy}>🔒 사진은 저장되지 않고 바로 사라집니다.</p>
              {errorMsg && <p style={styles.errorLine} role="alert">{errorMsg}</p>}
              <button type="button" className="ph-primary" style={styles.primaryBtn} onClick={() => cameraRef.current?.click()}>
                <span aria-hidden>📷</span> 사진 찍기
              </button>
              <button type="button" className="ph-secondary" style={styles.secondaryBtn} onClick={() => galleryRef.current?.click()}>
                <span aria-hidden>🖼️</span> 사진 고르기
              </button>
            </section>
          )
        )}

        {/* ── LOADING phase ─────────────────────────────────────────────────── */}
        {phase === 'loading' && (
          <section style={styles.card} aria-live="polite">
            <div className="ph-spinner" style={styles.spinner} aria-hidden />
            <h2 style={styles.loadingText}>{loadingMsg}</h2>
            <p style={styles.lead}>잠시만 기다려 주세요.</p>
          </section>
        )}

        {/* ── RESULT phase ──────────────────────────────────────────────────── */}
        {phase === 'result' && result && (
          <section style={styles.resultWrap} aria-live="polite">
            {result.unreadable ? (
              <div style={styles.card}>
                <p style={styles.unreadableText}>{result.message ?? '다시 시도해 주세요.'}</p>
                {ttsSupported && (
                  <button type="button" className="ph-read" style={styles.readBtn} onClick={() => speak(result.message ?? '')}>
                    <span aria-hidden>🔊</span> 읽어주기
                  </button>
                )}
                <button type="button" className="ph-primary" style={styles.primaryBtn} onClick={retake}>
                  <span aria-hidden>{retakeIcon}</span> {retakeLabel}
                </button>
              </div>
            ) : (
              <>
                <ResultBody mode={mode} r={result} />
                {ttsSupported && (
                  <button type="button" className="ph-read" style={styles.readBtn} onClick={() => speak(resultSpeech(result))}>
                    <span aria-hidden>🔊</span> 읽어주기
                  </button>
                )}
                <button type="button" className="ph-primary" style={styles.primaryBtn} onClick={retake}>
                  <span aria-hidden>{retakeIcon}</span> {retakeLabel}
                </button>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

// ── Phishing help guide ─────────────────────────────────────────────────────────

function PhishingGuide({ ttsSupported, speak }: { ttsSupported: boolean; speak: (t: string) => void }) {
  return (
    <div style={styles.guideCard} role="complementary" aria-label="수상한 문자 확인 방법 안내">
      <div style={styles.guideHeader}>
        <span style={styles.guideTitle}>수상한 문자를 확인하는 방법이에요</span>
        {ttsSupported && (
          <button
            type="button"
            className="ph-read"
            style={styles.readBtn}
            onClick={() => speak(GUIDE_NARRATION)}
            aria-label="도움말 읽어주기"
          >
            <span aria-hidden>🔊</span> 읽어주기
          </button>
        )}
      </div>
      <ol style={styles.guideList}>
        {GUIDE_ITEMS.map((item, i) => (
          <li key={i} style={styles.guideItem}>
            <span style={styles.guideNum} aria-hidden>{i + 1}</span>
            <span style={styles.guideText}>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ── Per-mode result rendering ───────────────────────────────────────────────────

function ResultBody({ mode, r }: { mode: PhotoMode; r: AnalyzeResult }) {
  if (mode === 'document') {
    return (
      <div style={styles.card}>
        <p style={styles.heroLine}>{r.mainAction}</p>
        <div style={styles.factRow}>
          {r.amount && <FactChip label="금액" value={r.amount} />}
          {r.dueDate && <FactChip label="기한" value={r.dueDate} />}
        </div>
        {r.where && <Block label="어떻게" body={r.where} />}
        {(r.details ?? []).length > 0 && <BulletBlock label="자세히" items={r.details ?? []} />}
        {r.warning && <p style={styles.warnNote}>{r.warning}</p>}
      </div>
    )
  }

  if (mode === 'phishing') {
    const rc = RISK_COLORS[r.risk ?? '확인불가'] ?? RISK_COLORS['확인불가']!
    return (
      <div style={styles.card}>
        <div style={{ ...styles.riskBanner, background: rc.bg, borderColor: rc.border, color: rc.ink }}>
          <span style={styles.riskLabel}>위험도</span>
          <span style={styles.riskValue}>{r.risk ?? '확인불가'}</span>
        </div>
        {(r.reasons ?? []).length > 0 && <BulletBlock label="이유" items={r.reasons ?? []} />}
        {(r.dontDo ?? []).length > 0 && (
          <div style={styles.dontBlock}>
            <span style={styles.dontLabel}>절대 하지 마세요</span>
            <ul style={styles.checkList}>
              {(r.dontDo ?? []).map((d, i) => (
                <li key={i} style={styles.dontItem}><span aria-hidden style={styles.xMark}>✕</span>{d}</li>
              ))}
            </ul>
          </div>
        )}
        {r.verifyHow && <p style={styles.warnNote}>{r.verifyHow}</p>}
      </div>
    )
  }

  if (mode === 'kiosk') {
    return (
      <div style={styles.card}>
        <p style={styles.heroLine}>{r.screenIs}</p>
        {r.nextStep && <Block label="다음에 할 일" body={r.nextStep} emphasize />}
        {r.caution && <p style={styles.cautionNote}>{r.caution}</p>}
      </div>
    )
  }

  // medicine
  return (
    <div style={styles.card}>
      <p style={styles.heroLine}>{r.mainInfo}</p>
      {r.whatFor && <Block label="이 약은" body={r.whatFor} />}
      {(r.howToTake ?? []).length > 0 && <BulletBlock label="드시는 방법" items={r.howToTake ?? []} />}
      {(r.cautions ?? []).length > 0 && <BulletBlock label="주의할 점" items={r.cautions ?? []} />}
      {r.warning && <p style={styles.warnNote}>{r.warning}</p>}
    </div>
  )
}

function FactChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.factChip}>
      <span style={styles.factLabel}>{label}</span>
      <span style={styles.factValue}>{value}</span>
    </div>
  )
}

function Block({ label, body, emphasize }: { label: string; body: string; emphasize?: boolean }) {
  return (
    <div style={styles.block}>
      <span style={styles.blockLabel}>{label}</span>
      <p style={emphasize ? styles.blockBodyStrong : styles.blockBody}>{body}</p>
    </div>
  )
}

function BulletBlock({ label, items }: { label: string; items: string[] }) {
  return (
    <div style={styles.block}>
      <span style={styles.blockLabel}>{label}</span>
      <ul style={styles.checkList}>
        {items.map((it, i) => (
          <li key={i} style={styles.bulletItem}><span aria-hidden style={styles.dot}>•</span>{it}</li>
        ))}
      </ul>
    </div>
  )
}

// ── Suspense wrapper ────────────────────────────────────────────────────────────

export default function PhotoPage() {
  return (
    <Suspense fallback={<div style={styles.root} />}>
      <PhotoHelper />
    </Suspense>
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
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 },
  headerEmoji: { fontSize: 46, lineHeight: 1 },
  h1: { fontSize: 34, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.25 },
  card: {
    background: C.surface, borderRadius: 20, padding: '26px 22px 30px',
    display: 'flex', flexDirection: 'column', gap: 18, boxShadow: '0 6px 22px rgba(15,34,51,0.10)',
  },
  resultWrap: { display: 'flex', flexDirection: 'column', gap: 16 },
  lead: { fontSize: 22, lineHeight: 1.6, color: C.inkSoft, margin: 0, textAlign: 'center' },
  privacy: {
    fontSize: 19, lineHeight: 1.5, color: C.sea, fontWeight: 700, margin: 0, textAlign: 'center',
    background: '#DCEAFB', border: `2px solid ${C.sea}`, borderRadius: 12, padding: '10px 14px',
  },
  errorLine: { fontSize: 20, color: C.warnInk, fontWeight: 700, margin: 0, textAlign: 'center' },
  primaryBtn: {
    minHeight: 76, fontSize: 28, fontWeight: 800, color: '#FFFFFF', background: C.sea,
    border: 'none', borderRadius: 16, cursor: 'pointer', padding: '12px 20px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  secondaryBtn: {
    minHeight: 68, fontSize: 24, fontWeight: 800, color: C.sea, background: '#FFFFFF',
    border: `3px solid ${C.sea}`, borderRadius: 16, cursor: 'pointer', padding: '10px 18px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  readBtn: {
    alignSelf: 'center', minHeight: 62, fontSize: 24, fontWeight: 700, color: C.sea, background: '#FFFFFF',
    border: `3px solid ${C.sea}`, borderRadius: 14, cursor: 'pointer', padding: '8px 28px',
  },
  spinner: {
    alignSelf: 'center', width: 60, height: 60, borderRadius: '50%',
    border: '8px solid #CFE3FA', borderTopColor: C.sea,
  },
  loadingText: { fontSize: 28, fontWeight: 800, color: C.ink, margin: 0, textAlign: 'center' },
  unreadableText: { fontSize: 26, fontWeight: 800, lineHeight: 1.5, color: C.ink, margin: 0, textAlign: 'center' },
  heroLine: {
    fontSize: 30, fontWeight: 900, lineHeight: 1.4, color: C.ink, margin: 0,
    background: '#CFE3FA', border: `3px solid ${C.sea}`, borderRadius: 16, padding: '18px 18px',
  },
  factRow: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  factChip: {
    flex: 1, minWidth: 140, display: 'flex', flexDirection: 'column', gap: 4,
    background: '#FCFAF4', border: `2px solid ${C.sea}`, borderRadius: 14, padding: '12px 14px',
  },
  factLabel: { fontSize: 18, fontWeight: 800, color: C.sea },
  factValue: { fontSize: 26, fontWeight: 800, color: C.ink },
  block: { display: 'flex', flexDirection: 'column', gap: 8 },
  blockLabel: { fontSize: 20, fontWeight: 800, color: C.sea },
  blockBody: { fontSize: 21, lineHeight: 1.6, color: C.inkSoft, margin: 0 },
  blockBodyStrong: { fontSize: 24, lineHeight: 1.55, color: C.ink, fontWeight: 700, margin: 0 },
  checkList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 },
  bulletItem: { fontSize: 21, lineHeight: 1.55, color: C.ink, display: 'flex', gap: 10, alignItems: 'flex-start' },
  dot: { color: C.sea, fontWeight: 800, fontSize: 22, flexShrink: 0 },
  warnNote: {
    fontSize: 20, lineHeight: 1.6, color: C.warnInk, fontWeight: 600, margin: 0,
    background: C.warnBg, border: `2px solid ${C.warnBorder}`, borderRadius: 12, padding: '14px 16px',
  },
  cautionNote: {
    fontSize: 20, lineHeight: 1.6, color: '#7A5410', fontWeight: 700, margin: 0,
    background: C.cautionBg, border: `2px solid ${C.cautionBorder}`, borderRadius: 12, padding: '14px 16px',
  },
  // phishing result
  riskBanner: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    border: '3px solid', borderRadius: 18, padding: '18px 16px',
  },
  riskLabel: { fontSize: 20, fontWeight: 800 },
  riskValue: { fontSize: 44, fontWeight: 900, lineHeight: 1.1 },
  dontBlock: { display: 'flex', flexDirection: 'column', gap: 8 },
  dontLabel: { fontSize: 20, fontWeight: 900, color: C.warnInk },
  dontItem: { fontSize: 22, lineHeight: 1.5, color: C.warnInk, fontWeight: 700, display: 'flex', gap: 10, alignItems: 'flex-start' },
  xMark: { color: C.warnBorder, fontWeight: 900, fontSize: 24, flexShrink: 0 },
  // phishing input
  sectionHead: { display: 'flex', alignItems: 'center', paddingTop: 4 },
  sectionLabel: { fontSize: 23, fontWeight: 900, color: C.sea },
  sectionDivider: {
    height: 2, background: '#BFD9F5', borderRadius: 2, margin: '6px 0',
  },
  textareaLabel: { fontSize: 21, fontWeight: 800, color: C.ink },
  textarea: {
    fontSize: 22, lineHeight: 1.6, color: C.ink,
    background: '#FDFBF6', border: `3px solid ${C.sea}`, borderRadius: 14,
    padding: '14px 16px', resize: 'vertical', minHeight: 148,
    fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif",
    width: '100%', boxSizing: 'border-box',
  },
  clipboardBtn: {
    minHeight: 66, fontSize: 22, fontWeight: 700, color: C.sea,
    background: '#EAF2FB', border: `2px solid ${C.sea}`, borderRadius: 14, cursor: 'pointer',
    padding: '10px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  // phishing guide
  guideCard: {
    background: '#FAF6EE', borderRadius: 20, padding: '24px 22px',
    border: `2px solid ${C.sea}`, display: 'flex', flexDirection: 'column', gap: 18,
  },
  guideHeader: { display: 'flex', flexDirection: 'column', gap: 12 },
  guideTitle: { fontSize: 24, fontWeight: 900, color: C.sea, lineHeight: 1.3 },
  guideList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 18 },
  guideItem: { display: 'flex', gap: 14, alignItems: 'flex-start' },
  guideNum: {
    fontSize: 20, fontWeight: 900, color: C.sea,
    background: '#DCEAFB', borderRadius: '50%',
    width: 36, height: 36, minWidth: 36, minHeight: 36,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  guideText: { fontSize: 22, lineHeight: 1.65, color: C.ink },
}

const GLOBAL_CSS = `
  .ph-primary:focus-visible, .ph-secondary:focus-visible, .ph-ctrl:focus-visible,
  .ph-read:focus-visible, .ph-clipboard:focus-visible {
    outline: 5px solid ${C.focus}; outline-offset: 3px;
  }
  .ph-textarea:focus { outline: 4px solid ${C.sea}; outline-offset: 0; border-color: ${C.seaStrong} !important; }
  .ph-textarea:focus-visible { outline: 5px solid ${C.focus}; outline-offset: 2px; }
  .ph-primary:hover:not(:disabled) { background: ${C.seaStrong}; }
  .ph-primary:disabled { cursor: not-allowed !important; }
  .ph-clipboard:hover { background: #CFE3FA; }
  .ph-primary, .ph-secondary, .ph-ctrl, .ph-read, .ph-clipboard {
    transition: transform 0.08s ease, background 0.15s ease; -webkit-tap-highlight-color: transparent;
  }
  .ph-primary:active:not(:disabled), .ph-secondary:active { transform: scale(0.98); }
  .ph-spinner { animation: ph-spin 0.9s linear infinite; }
  @keyframes ph-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .ph-primary, .ph-secondary, .ph-ctrl, .ph-read, .ph-clipboard, .ph-spinner {
      transition: none !important; animation: none !important;
    }
  }
`
