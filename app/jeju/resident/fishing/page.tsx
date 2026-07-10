'use client'

/**
 * 오늘 조업 나갈까? — 도민(resident) 농수산 AI 조업 판단 widget.
 *
 * The FIRST AI-powered resident-mode chip. Combines marine safety + fishery
 * price/시황 into a 3-level go/no-go verdict for 40–60s fishers.
 *
 * Flow (sequential polling — mirrors Arena/DEEP/tourist-course):
 *   POST /api/domin/fishing-decision/start { species, spot } → { jobId }
 *   GET  /api/domin/fishing-decision/status?jobId → { status, result? }
 *   poll every 3s until done/error → render verdict.
 *
 * Verdict signal colour:
 *   나가도 좋음 → green ·  주의 → yellow ·  오늘은 접자 → red
 * The safety floor (풍랑/태풍/폭풍해일 경보 OR 파고 ≥ 2.0m → 접자) is enforced
 * server-side; this UI only renders the already-clamped verdict.
 *
 * Accessibility mirrors the haenyeo chip: large fonts, high contrast, ≥48px
 * targets, 🔊 TTS, honest "정보 없음" for missing data.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ResidentLoading } from '../_components/Loading'

// ── Design tokens (resident palette — identical to haenyeo) ──────────────────

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
  red: '#B91C1C',
  redBg: '#FEF2F2',
  redBorder: '#FCA5A5',
  yellow: '#8A3F04',
  yellowBg: '#FFFBEB',
  yellowBorder: '#FCD34D',
  green: '#14532D',
  greenBg: '#F0FDF4',
  greenBorder: '#86EFAC',
}

// ── Selectors ────────────────────────────────────────────────────────────────

const SPECIES = ['갈치', '한치', '옥돔', '고등어', '자리돔', '방어']

const SPOTS = [
  { label: '이호', value: '이호테우' },
  { label: '함덕', value: '함덕' },
  { label: '협재', value: '협재' },
  { label: '중문', value: '중문' },
  { label: '표선', value: '표선' },
  { label: '신양', value: '신양섭지' },
]

// ── Result types (mirror lib/jeju/fishing-decision.ts payload) ───────────────

type Verdict = '나가도 좋음' | '주의' | '오늘은 접자'

interface Decision {
  verdict: Verdict
  headline: string
  reasons: string[]
  priceNote: string
  safetyNote: string
}
interface MarineWarning { type: string; level: string; area: string; issuedAt: string }
interface TideEvent { time: string; level: number | null }
interface MarineSummary {
  waveHeightM: number | null
  waterTempC: number | null
  warnings: MarineWarning[]
  lowTides: TideEvent[]
  highTides: TideEvent[]
  sun: { sunrise: string | null; sunset: string | null } | null
  missing: string[]
}
interface FisheryLatest {
  date: string
  avgPrice: number | null
  highPrice: number | null
  lowPrice: number | null
  volumeKg: number | null
  market: string | null
}
interface FisherySummary {
  source: 'datago' | 'perplexity'
  confidence: 'high' | 'low'
  latest: FisheryLatest | null
  context: string
}
interface ContextMeta { source: string; retrievedAt: string; asOf: string | null }

interface DecisionPayload {
  ok: true
  species: string
  spot: string
  verdict: Verdict
  decision: Decision
  safetyFloor: { forced: boolean; reasons: string[] }
  marine: MarineSummary
  fishery: FisherySummary
  contextMeta: ContextMeta
  updatedAt: string
  errors: string[]
}
type DecisionResult = DecisionPayload | { ok: false; error: string }

// ── Format helpers ────────────────────────────────────────────────────────────

function fmtTime(raw: string): string {
  const clean = raw.replace(/^.*T/, '').replace(/[+Z].*$/, '').trim()
  if (/^\d{4}$/.test(clean)) return `${clean.slice(0, 2)}:${clean.slice(2)}`
  if (/^\d{2}:\d{2}/.test(clean)) return clean.slice(0, 5)
  return raw.slice(0, 5)
}

function fmtDate(iso: string): string {
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[2]}월 ${m[3]}일` : iso.slice(0, 10)
}

const VERDICT_STYLE: Record<Verdict, { color: string; bg: string; border: string; emoji: string }> = {
  '나가도 좋음': { color: C.green, bg: C.greenBg, border: C.greenBorder, emoji: '🟢' },
  '주의': { color: '#C25A10', bg: C.yellowBg, border: C.yellowBorder, emoji: '🟡' },
  '오늘은 접자': { color: C.red, bg: C.redBg, border: C.redBorder, emoji: '🔴' },
}

// ── Component ─────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'polling' | 'done' | 'error'

export default function FishingPage() {
  const router = useRouter()
  const [species, setSpecies] = useState(SPECIES[0])
  const [spot, setSpot] = useState(SPOTS[0].value)
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState<DecisionPayload | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [ttsSupported, setTtsSupported] = useState(false)
  const [speaking, setSpeaking] = useState(false)

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const activeJob = useRef<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) setTtsSupported(true)
  }, [])

  const stopTimers = useCallback(() => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null }
    if (elapsedTimer.current) { clearInterval(elapsedTimer.current); elapsedTimer.current = null }
  }, [])

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel() } catch { /* no-op */ }
    }
    setSpeaking(false)
  }, [])

  useEffect(
    () => () => {
      stopTimers()
      abortRef.current?.abort()
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try { window.speechSynthesis.cancel() } catch { /* no-op */ }
      }
    },
    [stopTimers],
  )

  const finishWithResult = useCallback((payload: DecisionResult) => {
    stopTimers()
    activeJob.current = null
    if (payload.ok) {
      setResult(payload)
      setPhase('done')
    } else {
      setErrMsg(payload.error || '조업 판단을 만들지 못했어요.')
      setPhase('error')
    }
  }, [stopTimers])

  const poll = useCallback(
    async (jobId: string) => {
      try {
        const res = await fetch(
          `/api/domin/fishing-decision/status?jobId=${encodeURIComponent(jobId)}`,
          { cache: 'no-store' },
        )
        const json = (await res.json()) as {
          ok?: boolean
          status?: string
          result?: DecisionResult
          error?: string
        }
        if (activeJob.current !== jobId) return // stale poll (user restarted)
        if (json.status === 'done' && json.result) {
          finishWithResult(json.result)
        } else if (json.status === 'error') {
          stopTimers()
          activeJob.current = null
          setErrMsg(json.error || '조업 판단을 만들지 못했어요.')
          setPhase('error')
        }
        // else 'pending' → keep polling
      } catch {
        /* transient network error — next tick retries */
      }
    },
    [finishWithResult, stopTimers],
  )

  const start = useCallback(async () => {
    stopSpeaking()
    stopTimers()
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setResult(null)
    setErrMsg(null)
    setElapsed(0)
    setPhase('polling')

    // elapsed timer for the wait banner
    elapsedTimer.current = setInterval(() => setElapsed((s) => s + 1), 1000)

    try {
      const res = await fetch('/api/domin/fishing-decision/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ species, spot }),
        signal: ctrl.signal,
      })
      const json = (await res.json()) as { ok?: boolean; jobId?: string; error?: string }
      if (!json.ok || !json.jobId) {
        stopTimers()
        setErrMsg(json.error || '작업을 시작하지 못했어요.')
        setPhase('error')
        return
      }
      activeJob.current = json.jobId
      // Poll every 3s; first poll after 3s.
      pollTimer.current = setInterval(() => {
        void poll(json.jobId as string)
      }, 3000)
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      stopTimers()
      setErrMsg('연결에 실패했어요. 잠시 후 다시 해주세요.')
      setPhase('error')
    }
  }, [species, spot, poll, stopTimers, stopSpeaking])

  // ── TTS ───────────────────────────────────────────────────────────────────
  const buildTts = useCallback((p: DecisionPayload): string => {
    const d = p.decision
    const parts = [`${p.species} 조업 판단입니다.`, `${d.verdict}.`, `${d.headline}`]
    if (d.reasons.length) parts.push(d.reasons.join('. ') + '.')
    if (d.safetyNote) parts.push(d.safetyNote)
    return parts.join(' ')
  }, [])

  const onSpeak = useCallback(() => {
    if (speaking) { stopSpeaking(); return }
    if (!result || typeof window === 'undefined') return
    try {
      window.speechSynthesis.cancel()
      setSpeaking(true)
      const u = new SpeechSynthesisUtterance(buildTts(result))
      u.lang = 'ko-KR'
      u.rate = 0.9
      u.onend = () => setSpeaking(false)
      u.onerror = () => setSpeaking(false)
      window.speechSynthesis.speak(u)
    } catch {
      setSpeaking(false)
    }
  }, [speaking, result, buildTts, stopSpeaking])

  // ── Derived ─────────────────────────────────────────────────────────────────
  const vStyle = result ? VERDICT_STYLE[result.verdict] : null
  const meta = result?.contextMeta
  const provenance = meta
    ? meta.asOf
      ? `🔍 검색 · ${meta.asOf} 기준`
      : `🔍 검색 · ${fmtDate(meta.retrievedAt)} 조회`
    : null

  return (
    <div style={S.root}>
      <style>{GLOBAL_CSS}</style>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div style={S.topBar}>
        <button
          type="button"
          className="rf-back"
          style={S.backBtn}
          onClick={() => { stopSpeaking(); router.push('/jeju/resident/general') }}
          aria-label="뒤로 가기"
        >
          ← 뒤로
        </button>
        <h1 style={S.pageTitle}>🎣 오늘 조업 나갈까?</h1>
      </div>

      <div style={S.body}>
        {/* ── Species selector ─────────────────────────────────────────────── */}
        <div>
          <p style={S.selLabel}>어종</p>
          <div style={S.chipRow} role="group" aria-label="어종 선택">
            {SPECIES.map((s) => (
              <button
                key={s}
                type="button"
                className="rf-chip"
                style={species === s ? { ...S.chip, ...S.chipActive } : S.chip}
                onClick={() => setSpecies(s)}
                aria-pressed={species === s}
                disabled={phase === 'polling'}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* ── Spot selector ────────────────────────────────────────────────── */}
        <div>
          <p style={S.selLabel}>지점</p>
          <div style={S.chipRow} role="group" aria-label="지점 선택">
            {SPOTS.map((s) => (
              <button
                key={s.value}
                type="button"
                className="rf-chip"
                style={spot === s.value ? { ...S.chip, ...S.chipActive } : S.chip}
                onClick={() => setSpot(s.value)}
                aria-pressed={spot === s.value}
                disabled={phase === 'polling'}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Start button ─────────────────────────────────────────────────── */}
        {phase !== 'polling' && (
          <button type="button" className="rf-go" style={S.goBtn} onClick={() => void start()}>
            {phase === 'idle' ? '오늘 조업 판단하기' : '다시 판단하기'}
          </button>
        )}

        {/* ── Polling banner + elapsed timer ──────────────────────────────── */}
        {phase === 'polling' && (
          <div>
            <ResidentLoading
              steps={[
                '바다 상황을 확인하고 있어요',
                '어가·시황을 알아보고 있어요',
                'AI가 조업 판단을 내리고 있어요',
              ]}
              intervalMs={8000}
              ttsSupported={ttsSupported}
            />
            <p style={S.elapsed} aria-live="polite">
              ⏱ {elapsed}초 경과 — 보통 30초~1분 걸려요
            </p>
          </div>
        )}

        {/* ── Error ────────────────────────────────────────────────────────── */}
        {phase === 'error' && (
          <div style={S.errorBox} role="alert">
            <p style={S.errorText}>⚠ {errMsg}</p>
            <button type="button" className="rf-retry" style={S.retryBtn} onClick={() => void start()}>
              다시 시도
            </button>
          </div>
        )}

        {/* ── Result ───────────────────────────────────────────────────────── */}
        {phase === 'done' && result && vStyle && (
          <>
            {/* Verdict signal */}
            <section
              style={{ ...S.verdictCard, background: vStyle.bg, borderColor: vStyle.border }}
              aria-label={`조업 판단: ${result.verdict}`}
            >
              <div style={S.verdictTop}>
                <span style={S.verdictEmoji} aria-hidden>{vStyle.emoji}</span>
                <div style={S.verdictTextCol}>
                  <p style={{ ...S.verdictLabel, color: vStyle.color }}>{result.verdict}</p>
                  <p style={S.verdictHeadline}>{result.decision.headline}</p>
                </div>
              </div>

              {result.decision.reasons.map((r) => (
                <p key={r} style={S.reason}>• {r}</p>
              ))}

              {result.safetyFloor.forced && (
                <p style={S.floorNote} role="note">
                  ※ 위험 기준(경보·높은 파도)에 걸려 안전을 위해 &ldquo;오늘은 접자&rdquo;로 안내합니다.
                </p>
              )}

              {ttsSupported && (
                <button
                  type="button"
                  className="rf-tts"
                  style={speaking ? { ...S.ttsBtn, ...S.ttsBtnActive } : S.ttsBtn}
                  onClick={onSpeak}
                  aria-label={speaking ? '읽기 중지' : '이 판단 읽어주기'}
                >
                  <span aria-hidden>{speaking ? '⏹' : '🔊'}</span>
                  {speaking ? '읽기 중지' : '읽어주기'}
                </button>
              )}
            </section>

            {/* 어가·시황 card */}
            <section style={S.infoCard} aria-label="어가와 시황">
              <h2 style={S.cardTitle}><span aria-hidden>💰</span> 어가·시황</h2>
              <p style={S.priceNote}>{result.decision.priceNote}</p>
              {result.fishery.context && (
                <p style={S.contextText}>{result.fishery.context}</p>
              )}
              {provenance && <p style={S.provenance}>{provenance}</p>}
              {result.fishery.source === 'perplexity' && (
                <p style={S.honestNote} role="note">
                  ※ 공식 위판 자료가 없어 검색으로 추정한 시세예요. 참고만 하세요.
                </p>
              )}
            </section>

            {/* 안전 card */}
            <section style={S.infoCard} aria-label="바다 안전">
              <h2 style={S.cardTitle}><span aria-hidden>🌊</span> 바다 안전</h2>
              <p style={S.safetyText}>{result.decision.safetyNote}</p>
              <div style={S.factGrid}>
                <div style={S.fact}>
                  <span style={S.factK}>파고</span>
                  <span style={S.factV}>
                    {result.marine.waveHeightM != null ? `${result.marine.waveHeightM.toFixed(1)}m` : '정보 없음'}
                  </span>
                </div>
                <div style={S.fact}>
                  <span style={S.factK}>수온</span>
                  <span style={S.factV}>
                    {result.marine.waterTempC != null ? `${result.marine.waterTempC}°C` : '정보 없음'}
                  </span>
                </div>
                <div style={S.fact}>
                  <span style={S.factK}>간조</span>
                  <span style={S.factV}>
                    {result.marine.lowTides.length > 0
                      ? result.marine.lowTides.slice(0, 2).map((t) => fmtTime(t.time)).join(', ')
                      : '정보 없음'}
                  </span>
                </div>
                <div style={S.fact}>
                  <span style={S.factK}>일몰</span>
                  <span style={S.factV}>
                    {result.marine.sun?.sunset ? fmtTime(result.marine.sun.sunset) : '정보 없음'}
                  </span>
                </div>
              </div>

              {/* Active warnings */}
              {result.marine.warnings.length > 0 && (
                <div style={S.warnList}>
                  {result.marine.warnings.map((w, i) => {
                    const isAlarm = w.level === '경보'
                    return (
                      <span
                        key={i}
                        style={{
                          ...S.warnBadge,
                          background: isAlarm ? C.red : '#D97706',
                        }}
                      >
                        {w.type}{w.level}
                      </span>
                    )
                  })}
                </div>
              )}

              {result.marine.missing.length > 0 && (
                <p style={S.honestNote} role="note">
                  ※ {result.marine.missing.join('·')} 정보를 불러오지 못했어요 — 있는 자료로만 판단했어요.
                </p>
              )}
            </section>
          </>
        )}

        {/* ── Source credit ────────────────────────────────────────────────── */}
        <p style={S.source}>자료: 기상청·국립해양조사원·해양수산부 + 🔍 검색</p>
      </div>
    </div>
  )
}

// ── Global CSS ────────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
  .rf-back:focus-visible, .rf-chip:focus-visible, .rf-go:focus-visible,
  .rf-tts:focus-visible, .rf-retry:focus-visible {
    outline: 4px solid #E8590C; outline-offset: 3px;
  }
  .rf-chip:hover:not(:disabled) { opacity: 0.85; }
  .rf-go:hover { filter: brightness(0.94); }
  .rf-tts:hover { filter: brightness(0.92); }
  .rf-back:hover { opacity: 0.80; }
  .rf-chip:disabled { opacity: 0.5; cursor: default; }
`

// ── Inline styles ─────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100dvh',
    background: C.bg,
    display: 'flex',
    flexDirection: 'column',
    fontFamily:
      "'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif",
    color: C.ink,
  },
  topBar: {
    position: 'sticky',
    top: 0,
    zIndex: 40,
    background: C.seaStrong,
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '12px 16px',
    boxShadow: '0 2px 12px rgba(7,68,91,0.28)',
  },
  backBtn: {
    background: 'rgba(255,255,255,0.15)',
    border: '2px solid rgba(255,255,255,0.35)',
    borderRadius: 12,
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 700,
    padding: '10px 16px',
    minHeight: 48,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  pageTitle: { fontSize: 24, fontWeight: 900, color: '#FFFFFF', margin: 0, lineHeight: 1.2 },
  body: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: '18px 16px 32px',
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
    boxSizing: 'border-box',
  },

  selLabel: { fontSize: 18, fontWeight: 800, color: C.sea, margin: '0 0 8px' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  chip: {
    background: C.surface,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: C.mutedBorder,
    borderRadius: 24,
    color: C.mutedInk,
    fontSize: 18,
    fontWeight: 700,
    padding: '10px 18px',
    minHeight: 48,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  chipActive: { background: C.sea, borderColor: C.sea, color: '#FFFFFF' },

  goBtn: {
    background: C.sea,
    border: 'none',
    borderRadius: 18,
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 900,
    padding: '18px 24px',
    minHeight: 64,
    cursor: 'pointer',
    transition: 'filter 0.15s',
  },

  elapsed: {
    fontSize: 18,
    fontWeight: 700,
    color: C.inkSoft,
    textAlign: 'center',
    margin: '12px 0 0',
    fontVariantNumeric: 'tabular-nums',
  },

  errorBox: {
    background: C.redBg,
    border: `2px solid ${C.redBorder}`,
    borderRadius: 18,
    padding: '24px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
  },
  errorText: { fontSize: 20, fontWeight: 700, color: C.red, margin: 0, textAlign: 'center' },
  retryBtn: {
    background: C.sea,
    border: 'none',
    borderRadius: 14,
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 800,
    padding: '14px 32px',
    minHeight: 56,
    cursor: 'pointer',
  },

  // Verdict card
  verdictCard: {
    border: '3px solid',
    borderRadius: 22,
    padding: '22px 20px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    boxShadow: '0 4px 20px rgba(0,0,0,0.07)',
  },
  verdictTop: { display: 'flex', alignItems: 'center', gap: 16 },
  verdictEmoji: { fontSize: 56, lineHeight: 1, flexShrink: 0 },
  verdictTextCol: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1 },
  verdictLabel: { fontSize: 30, fontWeight: 900, margin: 0, lineHeight: 1.15 },
  verdictHeadline: { fontSize: 22, fontWeight: 800, color: C.ink, margin: 0, lineHeight: 1.35 },
  reason: { fontSize: 19, fontWeight: 600, color: C.inkSoft, margin: 0, lineHeight: 1.5, paddingLeft: 4 },
  floorNote: {
    fontSize: 16,
    fontWeight: 700,
    color: C.red,
    background: '#FFF5F5',
    border: `1px solid ${C.redBorder}`,
    borderRadius: 10,
    padding: '8px 12px',
    margin: '2px 0 0',
    lineHeight: 1.5,
  },

  ttsBtn: {
    alignSelf: 'flex-start',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: C.sea,
    border: 'none',
    borderRadius: 14,
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 800,
    padding: '13px 22px',
    minHeight: 52,
    cursor: 'pointer',
    marginTop: 4,
    transition: 'filter 0.15s',
  },
  ttsBtnActive: { background: C.seaStrong, outline: `3px solid ${C.focus}` },

  // Info cards
  infoCard: {
    background: C.surface,
    border: `2px solid ${C.mutedBorder}`,
    borderRadius: 20,
    padding: '18px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    boxSizing: 'border-box',
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: 900,
    color: C.sea,
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  priceNote: { fontSize: 22, fontWeight: 800, color: C.ink, margin: 0, lineHeight: 1.4 },
  contextText: { fontSize: 18, fontWeight: 500, color: C.inkSoft, margin: 0, lineHeight: 1.6 },
  provenance: {
    fontSize: 15,
    fontWeight: 700,
    color: '#0A3A66',
    background: '#FCE6C6',
    borderRadius: 8,
    padding: '5px 10px',
    margin: '2px 0 0',
    alignSelf: 'flex-start',
  },
  safetyText: { fontSize: 20, fontWeight: 700, color: C.ink, margin: 0, lineHeight: 1.5 },

  factGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginTop: 4 },
  fact: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
    background: C.mutedBg,
    borderRadius: 12,
    padding: '10px 14px',
  },
  factK: { fontSize: 16, fontWeight: 700, color: C.mutedInk },
  factV: { fontSize: 20, fontWeight: 800, color: C.ink, fontVariantNumeric: 'tabular-nums' },

  warnList: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  warnBadge: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 800,
    padding: '5px 12px',
    borderRadius: 999,
    whiteSpace: 'nowrap',
  },

  honestNote: {
    fontSize: 16,
    fontWeight: 600,
    color: C.mutedInk,
    background: C.mutedBg,
    border: `1px solid ${C.mutedBorder}`,
    borderRadius: 10,
    padding: '8px 12px',
    margin: '2px 0 0',
    lineHeight: 1.5,
  },

  source: {
    fontSize: 14,
    fontWeight: 600,
    color: C.mutedInk,
    textAlign: 'center',
    margin: '8px 0 0',
    lineHeight: 1.5,
  },
}
