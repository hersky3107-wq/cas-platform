'use client'

/**
 * 해녀 물질 안전 — Haenyeo safety chip for 도민 일반 mode.
 *
 * Target: 40–60s working / apprentice haenyeo. LOW digital literacy.
 * Korean-only (no i18n hook). Read-only dashboard — no AI call.
 *
 * Data: GET /api/domin/marine?spot=... (BeachInfoservice + WthrWrnInfoService)
 *
 * Signal light logic
 *   RED    : 풍랑/태풍/폭풍해일 경보 active  OR  파고 ≥ 2.0m  OR  수온 ≤ 12°C
 *   YELLOW : 주의보 active                  OR  파고 1.0–2.0m OR  수온 12–15°C
 *   GREEN  : none of the above
 *
 * Accessibility
 *   - Font sizes ≥ 20px body, ≥ 32px headings (larger than tourist cards)
 *   - Tap targets ≥ 48px (most ≥ 60px)
 *   - High-contrast palette
 *   - 🔊 TTS button (SpeechSynthesis, lang ko-KR)
 *   - Focus-visible rings
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// ── Design tokens (resident palette) ─────────────────────────────────────────

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
  // Signal colours
  red: '#B91C1C',
  redBg: '#FEF2F2',
  redBorder: '#FCA5A5',
  yellow: '#92400E',
  yellowBg: '#FFFBEB',
  yellowBorder: '#FCD34D',
  green: '#14532D',
  greenBg: '#F0FDF4',
  greenBorder: '#86EFAC',
}

// ── Spot chips ────────────────────────────────────────────────────────────────

const SPOTS = [
  { label: '이호', value: '이호테우' },
  { label: '함덕', value: '함덕' },
  { label: '협재', value: '협재' },
  { label: '중문', value: '중문' },
  { label: '표선', value: '표선' },
  { label: '신양', value: '신양섭지' },
]

// ── Marine API types ──────────────────────────────────────────────────────────

interface TideEvent { time: string; level: number | null }
interface MarineWarning { type: string; level: string; area: string; issuedAt: string }

interface MarineData {
  ok: true
  spot: string
  beachNum: string
  tide: { lowTides: TideEvent[]; highTides: TideEvent[] } | null
  wave: { heightM: number | null } | null
  waterTempC: number | null
  sun: { sunrise: string | null; sunset: string | null } | null
  warnings: MarineWarning[]
  updatedAt: string
  errors: string[]
}

type MarineResult = MarineData | { ok: false; error: string }

// ── Signal light computation ──────────────────────────────────────────────────

type SignalColor = 'red' | 'yellow' | 'green'

interface Signal {
  color: SignalColor
  headline: string
  reasons: string[]
}

function computeSignal(data: MarineData): Signal {
  const reasons: string[] = []
  let redDanger = false
  let yellowCaution = false

  // Check 경보 (경보 = alarm / watch vs 주의보 = advisory)
  const dangerWarnings = data.warnings.filter(
    (w) =>
      w.level === '경보' &&
      (w.type.includes('풍랑') ||
        w.type.includes('태풍') ||
        w.type.includes('폭풍해일') ||
        w.type.includes('강풍')),
  )
  const cautionWarnings = data.warnings.filter(
    (w) =>
      w.level === '주의보' &&
      (w.type.includes('풍랑') ||
        w.type.includes('태풍') ||
        w.type.includes('폭풍해일') ||
        w.type.includes('강풍')),
  )

  if (dangerWarnings.length > 0) {
    redDanger = true
    reasons.push(`${dangerWarnings.map((w) => `${w.type}${w.level}`).join(', ')}가 있어요`)
  }
  if (cautionWarnings.length > 0 && !redDanger) {
    yellowCaution = true
    reasons.push(`${cautionWarnings.map((w) => `${w.type}${w.level}`).join(', ')}가 있어요`)
  }

  // Wave height
  const wh = data.wave?.heightM
  if (wh != null) {
    if (wh >= 2.0) {
      redDanger = true
      reasons.push(`파도 높이 ${wh.toFixed(1)}m — 너무 높아요`)
    } else if (wh >= 1.0) {
      yellowCaution = true
      reasons.push(`파도 높이 ${wh.toFixed(1)}m — 조심하세요`)
    }
  }

  // Water temperature
  const wt = data.waterTempC
  if (wt != null) {
    if (wt <= 12) {
      redDanger = true
      reasons.push(`수온 ${wt}°C — 매우 차가워요`)
    } else if (wt <= 15) {
      yellowCaution = true
      reasons.push(`수온 ${wt}°C — 물이 차요`)
    }
  }

  if (redDanger) {
    return {
      color: 'red',
      headline: '오늘은 물질하기 위험해요',
      reasons: reasons.length > 0 ? reasons : ['기상 상태를 확인해 주세요'],
    }
  }
  if (yellowCaution) {
    return {
      color: 'yellow',
      headline: '오늘은 물질에 주의가 필요해요',
      reasons: reasons.length > 0 ? reasons : ['기상 상태를 확인해 주세요'],
    }
  }
  return {
    color: 'green',
    headline: '오늘 물질 괜찮아요',
    reasons: ['특별한 위험 신호 없어요'],
  }
}

// ── TTS text builder ─────────────────────────────────────────────────────────

function buildTtsText(signal: Signal, data: MarineData): string {
  const parts: string[] = [`해녀 물질 안전 정보입니다.`, signal.headline + '.']
  if (signal.reasons.length > 0) parts.push(signal.reasons.join('. ') + '.')
  if (data.tide) {
    const low = data.tide.lowTides[0]
    if (low) parts.push(`오늘 첫 간조 시간은 ${low.time}입니다.`)
  }
  if (data.sun?.sunset) parts.push(`일몰 시각은 ${data.sun.sunset}입니다. 해가 지기 전에 나오세요.`)
  if (data.waterTempC != null && data.waterTempC <= 15) {
    parts.push(`수온이 ${data.waterTempC}도입니다. 저체온 조심하세요.`)
  }
  return parts.join(' ')
}

// ── Format helpers ────────────────────────────────────────────────────────────

function fmtTime(raw: string): string {
  // Handles: "0425", "04:25", "04:25:00+09:00", etc.
  const clean = raw.replace(/^.*T/, '').replace(/[+Z].*$/, '').replace(/^(\d{4})$/, '$1').trim()
  if (/^\d{4}$/.test(clean)) return `${clean.slice(0, 2)}:${clean.slice(2)}`
  if (/^\d{2}:\d{2}/.test(clean)) return clean.slice(0, 5)
  return raw.slice(0, 5)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function HaenyeoPage() {
  const router = useRouter()
  const [spot, setSpot] = useState(SPOTS[0].value)
  const [data, setData] = useState<MarineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [ttsSupported, setTtsSupported] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setTtsSupported(true)
    }
  }, [])

  // Cancel TTS when leaving
  useEffect(
    () => () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel()
        } catch {
          /* no-op */
        }
      }
      abortRef.current?.abort()
    },
    [],
  )

  const fetchData = useCallback(async (targetSpot: string) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(
        `/api/domin/marine?spot=${encodeURIComponent(targetSpot)}`,
        { signal: ctrl.signal, cache: 'no-store' },
      )
      const json = (await res.json()) as MarineResult
      if (!json.ok) {
        setFetchError((json as { ok: false; error: string }).error)
        setData(null)
      } else {
        setData(json as MarineData)
        setFetchError(null)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setFetchError('자료를 불러오지 못했어요. 잠시 후 다시 해주세요.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData(spot)
  }, [fetchData, spot])

  const speak = useCallback(
    (text: string) => {
      if (!ttsSupported || typeof window === 'undefined') return
      try {
        window.speechSynthesis.cancel()
        setSpeaking(true)
        const u = new SpeechSynthesisUtterance(text)
        u.lang = 'ko-KR'
        u.rate = 0.9
        u.onend = () => setSpeaking(false)
        u.onerror = () => setSpeaking(false)
        window.speechSynthesis.speak(u)
      } catch {
        setSpeaking(false)
      }
    },
    [ttsSupported],
  )

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel()
        setSpeaking(false)
      } catch {
        /* no-op */
      }
    }
  }, [])

  const signal = data ? computeSignal(data) : null

  const onSpeak = useCallback(() => {
    if (speaking) {
      stopSpeaking()
      return
    }
    if (!data || !signal) return
    speak(buildTtsText(signal, data))
  }, [speaking, data, signal, speak, stopSpeaking])

  const onSpotChange = useCallback(
    (s: string) => {
      stopSpeaking()
      setSpot(s)
    },
    [stopSpeaking],
  )

  // ── Derived UI data ─────────────────────────────────────────────────────────

  const signalStyle = signal
    ? {
        red: { dot: C.red, bg: C.redBg, border: C.redBorder, label: '위험' },
        yellow: { dot: '#D97706', bg: C.yellowBg, border: C.yellowBorder, label: '주의' },
        green: { dot: '#15803D', bg: C.greenBg, border: C.greenBorder, label: '괜찮음' },
      }[signal.color]
    : null

  const todayLowTides = data?.tide?.lowTides?.slice(0, 4) ?? []
  const todayHighTides = data?.tide?.highTides?.slice(0, 4) ?? []
  const sunset = data?.sun?.sunset
  const waterTemp = data?.waterTempC ?? null   // explicit null, never 0
  const waveH = data?.wave?.heightM ?? null    // explicit null, never 0

  const tempCold = waterTemp !== null && waterTemp <= 15
  const tempVeryCold = waterTemp !== null && waterTemp <= 12

  // True when neither numeric source is available yet (BeachInfoservice pending)
  const numericMissing = waveH === null && waterTemp === null

  return (
    <div style={S.root}>
      <style>{GLOBAL_CSS}</style>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div style={S.topBar}>
        <button
          type="button"
          className="rh-back"
          style={S.backBtn}
          onClick={() => {
            stopSpeaking()
            router.push('/jeju/resident/general')
          }}
          aria-label="뒤로 가기"
        >
          ← 뒤로
        </button>
        <h1 style={S.pageTitle}>🌊 해녀 물질 안전</h1>
      </div>

      <div style={S.body}>
        {/* ── Spot selector ──────────────────────────────────────────────── */}
        <div style={S.spotRow} role="group" aria-label="해수욕장 선택">
          {SPOTS.map((s) => (
            <button
              key={s.value}
              type="button"
              className="rh-spot"
              style={
                spot === s.value
                  ? { ...S.spotBtn, ...S.spotBtnActive }
                  : S.spotBtn
              }
              onClick={() => onSpotChange(s.value)}
              aria-pressed={spot === s.value}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* ── Loading ─────────────────────────────────────────────────────── */}
        {loading && (
          <div style={S.loadingBox} aria-live="polite" aria-busy="true">
            <span style={S.loadingDot} aria-hidden>⏳</span>
            <p style={S.loadingText}>자료 불러오는 중…</p>
          </div>
        )}

        {/* ── Fetch error ──────────────────────────────────────────────────── */}
        {!loading && fetchError && (
          <div style={S.errorBox} role="alert">
            <p style={S.errorText}>⚠ {fetchError}</p>
            <button
              type="button"
              className="rh-btn"
              style={S.retryBtn}
              onClick={() => void fetchData(spot)}
            >
              다시 시도
            </button>
          </div>
        )}

        {/* ── Main content ────────────────────────────────────────────────── */}
        {!loading && data && signal && signalStyle && (
          <>
            {/* ── Signal light ──────────────────────────────────────────── */}
            <section
              style={{ ...S.signalCard, background: signalStyle.bg, borderColor: signalStyle.border }}
              aria-label={`안전 신호: ${signalStyle.label}`}
            >
              <div style={S.signalTop}>
                <div
                  style={{ ...S.signalDot, background: signalStyle.dot }}
                  role="img"
                  aria-label={signalStyle.label}
                />
                <div style={S.signalTextCol}>
                  <p style={{ ...S.signalLabel, color: signalStyle.dot }}>
                    {signalStyle.label}
                  </p>
                  <p style={{ ...S.signalHeadline, color: C.ink }}>
                    {signal.headline}
                  </p>
                </div>
              </div>
              {signal.reasons.map((r) => (
                <p key={r} style={{ ...S.signalReason, color: C.inkSoft }}>
                  • {r}
                </p>
              ))}

              {/* ── Numeric-data missing note ──────────────────────── */}
              {numericMissing && (
                <p style={S.numericNote} role="note">
                  ※ 파도·수온 정보를 불러오지 못했어요 — 특보 기준으로만 안내 중
                </p>
              )}

              {/* ── TTS button ────────────────────────────────────────── */}
              {ttsSupported && (
                <button
                  type="button"
                  className="rh-tts"
                  style={speaking ? { ...S.ttsBtn, ...S.ttsBtnActive } : S.ttsBtn}
                  onClick={onSpeak}
                  aria-label={speaking ? '읽기 중지' : '이 정보 읽어주기'}
                >
                  <span aria-hidden>{speaking ? '⏹' : '🔊'}</span>
                  {speaking ? '읽기 중지' : '읽어주기'}
                </button>
              )}
            </section>

            {/* ── Data cards ──────────────────────────────────────────── */}
            <div style={S.cardGrid}>
              {/* 물때 card */}
              <section style={S.dataCard} aria-label="물때 정보">
                <h2 style={S.cardTitle}>
                  <span aria-hidden>🌊</span> 물때
                </h2>

                {todayLowTides.length === 0 && todayHighTides.length === 0 ? (
                  <p style={S.noData}>정보 없음</p>
                ) : (
                  <>
                    {todayLowTides.length > 0 && (
                      <div style={S.tideGroup}>
                        <p style={S.tideTypeLabel}>
                          간조 <span style={S.tideHint}>(물질 좋은 시간)</span>
                        </p>
                        {todayLowTides.map((t, i) => (
                          <div key={i} style={S.tideRowLow}>
                            <span style={S.tideTimeLow}>{fmtTime(t.time)}</span>
                            {t.level != null && (
                              <span style={S.tideLevelLow}>{t.level}cm</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {todayHighTides.length > 0 && (
                      <div style={S.tideGroup}>
                        <p style={S.tideTypeLabelMuted}>만조</p>
                        {todayHighTides.map((t, i) => (
                          <div key={i} style={S.tideRowHigh}>
                            <span style={S.tideTimeHigh}>{fmtTime(t.time)}</span>
                            {t.level != null && (
                              <span style={S.tideLevelHigh}>{t.level}cm</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* 일몰 card */}
              <section style={S.dataCard} aria-label="일몰 시각">
                <h2 style={S.cardTitle}>
                  <span aria-hidden>🌅</span> 일몰
                </h2>
                {sunset ? (
                  <>
                    <p style={S.sunsetTime}>{fmtTime(sunset)}</p>
                    <p style={S.sunsetReminder}>해가 지기 전에{'\n'}나오세요</p>
                  </>
                ) : (
                  <p style={S.noData}>정보 없음</p>
                )}
              </section>

              {/* 수온 card */}
              <section
                style={
                  tempVeryCold
                    ? { ...S.dataCard, borderColor: C.red, background: '#FFF5F5' }
                    : tempCold
                      ? { ...S.dataCard, borderColor: C.yellowBorder, background: C.yellowBg }
                      : S.dataCard
                }
                aria-label="수온"
              >
                <h2 style={S.cardTitle}>
                  <span aria-hidden>🌡️</span> 수온
                </h2>
                {waterTemp != null ? (
                  <>
                    <p
                      style={{
                        ...S.tempValue,
                        color: tempVeryCold ? C.red : tempCold ? C.yellow : C.sea,
                      }}
                    >
                      {waterTemp}°C
                    </p>
                    {tempVeryCold && (
                      <p style={{ ...S.tempWarning, color: C.red }}>
                        물이 매우 차요{'\n'}저체온 위험!
                      </p>
                    )}
                    {!tempVeryCold && tempCold && (
                      <p style={{ ...S.tempWarning, color: C.yellow }}>
                        물이 차요{'\n'}저체온 조심하세요
                      </p>
                    )}
                  </>
                ) : (
                  <p style={S.noData}>정보 없음</p>
                )}
              </section>

              {/* 파고 card */}
              <section style={S.dataCard} aria-label="파도 높이">
                <h2 style={S.cardTitle}>
                  <span aria-hidden>🌊</span> 파도
                </h2>
                {waveH != null ? (
                  <>
                    <p
                      style={{
                        ...S.tempValue,
                        color:
                          waveH >= 2.0 ? C.red : waveH >= 1.0 ? C.yellow : C.sea,
                      }}
                    >
                      {waveH.toFixed(1)}m
                    </p>
                    {waveH >= 2.0 && (
                      <p style={{ ...S.tempWarning, color: C.red }}>입수 위험</p>
                    )}
                    {waveH >= 1.0 && waveH < 2.0 && (
                      <p style={{ ...S.tempWarning, color: C.yellow }}>주의</p>
                    )}
                  </>
                ) : (
                  <p style={S.noData}>정보 없음</p>
                )}
              </section>
            </div>

            {/* ── Active warnings list ──────────────────────────────── */}
            {data.warnings.length > 0 && (
              <section style={S.warnSection} aria-label="기상 특보">
                <h2 style={S.warnTitle}>⚠ 현재 기상 특보</h2>
                {data.warnings.map((w, i) => {
                  const isAlarm = w.level === '경보'
                  return (
                    <div
                      key={i}
                      style={{
                        ...S.warnRow,
                        background: isAlarm ? '#FEF2F2' : '#FFFBEB',
                        borderLeftColor: isAlarm ? C.red : '#D97706',
                      }}
                    >
                      <span
                        style={{
                          ...S.warnBadge,
                          background: isAlarm ? C.red : '#D97706',
                        }}
                      >
                        {w.level}
                      </span>
                      <span style={S.warnType}>{w.type}</span>
                      <span style={S.warnTime}>{fmtTime(w.issuedAt)}</span>
                    </div>
                  )
                })}
              </section>
            )}

            {/* ── Partial-data notice ───────────────────────────────── */}
            {data.errors.length > 0 && (
              <p style={S.partialNotice} role="note">
                일부 자료 미제공 (베타){' '}
                <span style={{ fontWeight: 400, fontSize: 14 }}>
                  — BeachInfoservice 활용신청 필요
                </span>
              </p>
            )}
          </>
        )}

        {/* ── Source credit ─────────────────────────────────────────────────── */}
        <p style={S.source}>자료: 기상청·국립해양조사원</p>
      </div>
    </div>
  )
}

// ── Global CSS (focus / hover hooks that inline styles can't do) ──────────────

const GLOBAL_CSS = `
  .rh-back:focus-visible,
  .rh-spot:focus-visible,
  .rh-tts:focus-visible,
  .rh-btn:focus-visible {
    outline: 4px solid #C2410C;
    outline-offset: 3px;
  }
  .rh-spot:hover { opacity: 0.85; }
  .rh-tts:hover { filter: brightness(0.92); }
  .rh-back:hover { opacity: 0.80; }
  .rh-btn:hover  { opacity: 0.85; }
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
  pageTitle: {
    fontSize: 26,
    fontWeight: 900,
    color: '#FFFFFF',
    margin: 0,
    lineHeight: 1.2,
  },
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

  // Spot selector
  spotRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  spotBtn: {
    background: C.surface,
    border: `2px solid ${C.mutedBorder}`,
    borderRadius: 24,
    color: C.mutedInk,
    fontSize: 18,
    fontWeight: 700,
    padding: '10px 18px',
    minHeight: 48,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  spotBtnActive: {
    background: C.sea,
    borderColor: C.sea,
    color: '#FFFFFF',
  },

  // Loading
  loadingBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    padding: '48px 0',
  },
  loadingDot: { fontSize: 48 },
  loadingText: {
    fontSize: 22,
    fontWeight: 700,
    color: C.inkSoft,
    margin: 0,
  },

  // Error
  errorBox: {
    background: '#FEF2F2',
    border: `2px solid ${C.redBorder}`,
    borderRadius: 18,
    padding: '24px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
  },
  errorText: {
    fontSize: 20,
    fontWeight: 700,
    color: C.red,
    margin: 0,
    textAlign: 'center',
  },
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

  // Signal card
  signalCard: {
    border: '3px solid',
    borderRadius: 22,
    padding: '22px 20px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    boxShadow: '0 4px 20px rgba(0,0,0,0.07)',
  },
  signalTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 18,
  },
  signalDot: {
    width: 72,
    height: 72,
    borderRadius: '50%',
    flexShrink: 0,
    boxShadow: '0 4px 16px rgba(0,0,0,0.22)',
  },
  signalTextCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flex: 1,
  },
  signalLabel: {
    fontSize: 20,
    fontWeight: 900,
    margin: 0,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  signalHeadline: {
    fontSize: 26,
    fontWeight: 800,
    margin: 0,
    lineHeight: 1.25,
  },
  signalReason: {
    fontSize: 19,
    fontWeight: 600,
    margin: 0,
    lineHeight: 1.5,
    paddingLeft: 4,
  },

  // TTS button
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
  ttsBtnActive: {
    background: C.seaStrong,
    outline: `3px solid ${C.focus}`,
  },

  // Data card grid
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 14,
  },
  dataCard: {
    background: C.surface,
    border: `2px solid ${C.mutedBorder}`,
    borderRadius: 20,
    padding: '18px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    boxSizing: 'border-box',
    transition: 'border-color 0.2s',
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

  // Tide
  tideGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  tideTypeLabel: {
    fontSize: 16,
    fontWeight: 700,
    color: C.sea,
    margin: 0,
    lineHeight: 1.4,
  },
  tideHint: {
    fontSize: 13,
    fontWeight: 600,
    color: C.mutedInk,
  },
  tideTypeLabelMuted: {
    fontSize: 15,
    fontWeight: 700,
    color: C.mutedInk,
    margin: 0,
    marginTop: 8,
  },
  tideRowLow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
  },
  tideTimeLow: {
    fontSize: 28,
    fontWeight: 900,
    color: C.ink,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.02em',
  },
  tideLevelLow: {
    fontSize: 15,
    fontWeight: 600,
    color: C.sea,
  },
  tideRowHigh: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 5,
  },
  tideTimeHigh: {
    fontSize: 22,
    fontWeight: 700,
    color: C.inkSoft,
    fontVariantNumeric: 'tabular-nums',
  },
  tideLevelHigh: {
    fontSize: 13,
    fontWeight: 600,
    color: C.mutedInk,
  },

  // Sunset
  sunsetTime: {
    fontSize: 48,
    fontWeight: 900,
    color: '#C2410C',
    margin: 0,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.02em',
    lineHeight: 1,
  },
  sunsetReminder: {
    fontSize: 18,
    fontWeight: 700,
    color: C.inkSoft,
    margin: 0,
    lineHeight: 1.5,
    whiteSpace: 'pre-line',
  },

  // Temp / wave values
  tempValue: {
    fontSize: 44,
    fontWeight: 900,
    margin: 0,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.02em',
    lineHeight: 1,
  },
  tempWarning: {
    fontSize: 18,
    fontWeight: 800,
    margin: 0,
    lineHeight: 1.45,
    whiteSpace: 'pre-line',
  },

  // No data
  noData: {
    fontSize: 18,
    color: C.mutedInk,
    margin: 0,
    fontWeight: 600,
  },

  // Numeric-data missing note (shown under signal when wave/waterTemp unavailable)
  numericNote: {
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

  // Warnings list
  warnSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  warnTitle: {
    fontSize: 22,
    fontWeight: 900,
    color: C.red,
    margin: 0,
  },
  warnRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '14px 14px',
    borderRadius: 14,
    borderLeft: '5px solid',
    boxSizing: 'border-box',
  },
  warnBadge: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 800,
    padding: '3px 10px',
    borderRadius: 8,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  warnType: {
    fontSize: 20,
    fontWeight: 800,
    color: C.ink,
    flex: 1,
  },
  warnTime: {
    fontSize: 15,
    fontWeight: 600,
    color: C.mutedInk,
    whiteSpace: 'nowrap',
  },

  // Partial data notice
  partialNotice: {
    fontSize: 15,
    fontWeight: 700,
    color: C.mutedInk,
    margin: 0,
    textAlign: 'center',
    padding: '4px 0',
  },

  // Source credit
  source: {
    fontSize: 14,
    fontWeight: 600,
    color: C.mutedInk,
    textAlign: 'center',
    margin: '8px 0 0',
  },
}
