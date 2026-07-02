'use client'

/**
 * 사진 도우미 — multimodal photo helper for resident mode.
 *
 * One page, four modes (via ?mode=document|phishing|kiosk|medicine).
 * Accessibility-first (same palette + TTS as support/page.tsx).
 *
 * PRIVACY: the chosen photo is sent once to the stateless analyze endpoint and
 * never stored anywhere (no upload persistence, no localStorage).
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

// ── Theme (identical to support/page.tsx) ─────────────────────────────────────

const C = {
  bg: '#E8F2F5',
  surface: '#FFFFFF',
  ink: '#0F2233',
  inkSoft: '#33475B',
  sea: '#0A5C7A',
  seaStrong: '#07445B',
  focus: '#C2410C',
  warnBg: '#FDECEC',
  warnBorder: '#C0392B',
  warnInk: '#8A241A',
  cautionBg: '#FEF6E4',
  cautionBorder: '#B7791F',
}

type PhotoMode = 'document' | 'phishing' | 'kiosk' | 'medicine'

const MODE_META: Record<PhotoMode, { emoji: string; title: string; hint: string }> = {
  document: { emoji: '📄', title: '고지서·문서 읽기', hint: '고지서나 안내문을 찍으면 쉽게 알려드려요.' },
  phishing: { emoji: '🛡️', title: '수상한 문자 확인', hint: '이상한 문자를 찍으면 위험한지 확인해드려요.' },
  kiosk: { emoji: '🖥️', title: '무인기계 도움', hint: '무인기계 화면을 찍으면 다음에 뭘 할지 알려드려요.' },
  medicine: { emoji: '💊', title: '약 알아보기', hint: '약봉투나 약통을 찍으면 무슨 약인지 알려드려요.' },
}

const RISK_COLORS: Record<string, { bg: string; border: string; ink: string }> = {
  높음: { bg: '#FDECEC', border: '#C0392B', ink: '#8A241A' },
  의심: { bg: '#FEF6E4', border: '#B7791F', ink: '#7A5410' },
  확인불가: { bg: '#ECF1F4', border: '#54708A', ink: '#33475B' },
}

// ── Result type (loose — shape varies per mode) ────────────────────────────────

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

  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

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

  // ── File → base64 → analyze ──────────────────────────────────────────────

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      stopSpeaking()
      setErrorMsg(null)
      setResult(null)
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
    setPhase('capture')
  }, [stopSpeaking])

  const goHome = useCallback(() => {
    stopSpeaking()
    router.push('/jeju/resident')
  }, [router, stopSpeaking])

  // ── Build the narration string for a result ──────────────────────────────

  const resultSpeech = useCallback((r: AnalyzeResult): string => {
    if (r.unreadable) return r.message ?? '사진이 잘 안 보여요. 다시 찍어주세요.'
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

  // ── Render ───────────────────────────────────────────────────────────────

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
        {/* Persistent controls — same position every screen */}
        <div style={styles.topBar}>
          <button type="button" className="ph-ctrl" style={styles.ctrlBtn} onClick={goHome} aria-label="처음으로 돌아가기">
            <span aria-hidden>↩</span> 처음으로
          </button>
          {phase === 'result' && (
            <button type="button" className="ph-ctrl" style={styles.ctrlBtn} onClick={retake} aria-label="다시 찍기">
              <span aria-hidden>📷</span> 다시 찍기
            </button>
          )}
        </div>

        {/* Header */}
        <header style={styles.header}>
          <span style={styles.headerEmoji} aria-hidden>{meta.emoji}</span>
          <h1 style={styles.h1}>{meta.title}</h1>
        </header>

        {phase === 'capture' && (
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
        )}

        {phase === 'loading' && (
          <section style={styles.card} aria-live="polite">
            <div className="ph-spinner" style={styles.spinner} aria-hidden />
            <h2 style={styles.loadingText}>사진을 살펴보고 있어요…</h2>
            <p style={styles.lead}>잠시만 기다려 주세요.</p>
          </section>
        )}

        {phase === 'result' && result && (
          <section style={styles.resultWrap} aria-live="polite">
            {result.unreadable ? (
              <div style={styles.card}>
                <p style={styles.unreadableText}>{result.message ?? '사진이 잘 안 보여요. 밝은 곳에서 다시 찍어주세요.'}</p>
                {ttsSupported && (
                  <button type="button" className="ph-read" style={styles.readBtn} onClick={() => speak(result.message ?? '')}>
                    <span aria-hidden>🔊</span> 읽어주기
                  </button>
                )}
                <button type="button" className="ph-primary" style={styles.primaryBtn} onClick={retake}>
                  <span aria-hidden>📷</span> 다시 찍기
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
                  <span aria-hidden>📷</span> 다시 찍기
                </button>
              </>
            )}
          </section>
        )}
      </main>
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

// ── Suspense wrapper (required for useSearchParams) ─────────────────────────────

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
    background: '#DCEEF3', border: `2px solid ${C.sea}`, borderRadius: 12, padding: '10px 14px',
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
    border: '8px solid #CDE1E8', borderTopColor: C.sea,
  },
  loadingText: { fontSize: 28, fontWeight: 800, color: C.ink, margin: 0, textAlign: 'center' },
  unreadableText: { fontSize: 26, fontWeight: 800, lineHeight: 1.5, color: C.ink, margin: 0, textAlign: 'center' },
  // hero line — biggest/first result element
  heroLine: {
    fontSize: 30, fontWeight: 900, lineHeight: 1.4, color: C.ink, margin: 0,
    background: '#D4EDF5', border: `3px solid ${C.sea}`, borderRadius: 16, padding: '18px 18px',
  },
  factRow: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  factChip: {
    flex: 1, minWidth: 140, display: 'flex', flexDirection: 'column', gap: 4,
    background: '#F4F9FB', border: `2px solid ${C.sea}`, borderRadius: 14, padding: '12px 14px',
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
  // phishing
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
}

const GLOBAL_CSS = `
  .ph-primary:focus-visible, .ph-secondary:focus-visible, .ph-ctrl:focus-visible, .ph-read:focus-visible {
    outline: 5px solid ${C.focus}; outline-offset: 3px;
  }
  .ph-primary:hover { background: ${C.seaStrong}; }
  .ph-primary, .ph-secondary, .ph-ctrl, .ph-read {
    transition: transform 0.08s ease, background 0.15s ease; -webkit-tap-highlight-color: transparent;
  }
  .ph-primary:active, .ph-secondary:active { transform: scale(0.98); }
  .ph-spinner { animation: ph-spin 0.9s linear infinite; }
  @keyframes ph-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .ph-primary, .ph-secondary, .ph-ctrl, .ph-read, .ph-spinner {
      transition: none !important; animation: none !important;
    }
  }
`
