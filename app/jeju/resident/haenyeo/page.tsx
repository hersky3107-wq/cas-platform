'use client'

/**
 * 해녀 물질 안전 — Haenyeo safety chip for 도민 일반 mode.
 *
 * Target: 40–60s working / apprentice haenyeo. LOW digital literacy.
 * Korean-only (no i18n hook). Read-only dashboard.
 *
 * Data: GET /api/domin/haenyeo-safety?spot=... (lib/jeju/haenyeo-marine.ts)
 *   - wave/일몰/특보 pass through from the SHARED lib/jeju/marine.ts (unmodified)
 *   - 수온/조석(물때)/조류 come from KHOA (국립해양조사원), NEW in this feature
 *
 * Signal light — TWO SEPARATE LAYERS (do not confuse them):
 *   LAYER 1 (code, server-side, in haenyeo-marine.ts computeVerdict): the
 *     ONLY thing that decides the 🔴/🟡/🟢 dot. This page just renders
 *     data.verdict.color/reasons — it never recomputes the verdict itself.
 *   LAYER 2 (AI explanation, data.aiExplanation): Perplexity explaining
 *     LAYER 1's already-decided verdict in elderly-friendly Korean. Pure
 *     enrichment — if it's missing, the verdict + numbers still render.
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
import { FriendlyErrors } from '@/components/jeju/FriendlyErrors'

// ── Design tokens (resident palette) ─────────────────────────────────────────

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
  badgeBg: '#FCE6C6',
  badgeInk: '#0A3A66',
  // Signal colours
  red: '#B91C1C',
  redBg: '#FEF2F2',
  redBorder: '#FCA5A5',
  yellow: '#8A3F04',
  yellowBg: '#FFFBEB',
  yellowBorder: '#FCD34D',
  green: '#14532D',
  greenBg: '#F0FDF4',
  greenBorder: '#86EFAC',
  ai: '#5B21B6',
  aiBg: '#F5F3FF',
  aiBorder: '#DDD6FE',
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

// ── API types (mirrors lib/jeju/haenyeo-marine.ts — that module is server-only,
//    so its types are re-declared here rather than imported) ─────────────────

interface MarineWarning { type: string; level: string; area: string; issuedAt: string }
interface KhoaTideEvent { time: string; levelCm: number | null; kind: 'high' | 'low'; label: string }
interface KhoaCurrentPoint { time: string; dir: string | null; speedCmS: number | null }
interface KhoaCurrentInfo {
  hourly: KhoaCurrentPoint[]
  nowSpeedCmS: number | null
  nowDir: string | null
  maxSpeedCmS: number | null
  stationName: string | null
}
interface KhoaWaterTemp { tempC: number | null; observedAt: string | null; stationName: string | null }
type SignalColor = 'red' | 'yellow' | 'green'
interface SafetyVerdict { color: SignalColor; reasons: string[] }
interface AiMeta { source: '검색'; retrievedAt: string; asOf: string | null }

interface HaenyeoData {
  ok: true
  spot: string
  beachNum: string
  wave: { heightM: number | null } | null
  sun: { sunrise: string | null; sunset: string | null } | null
  warnings: MarineWarning[]
  waterTemp: KhoaWaterTemp | null
  waterTempStationLabel: string | null
  tideEvents: KhoaTideEvent[] | null
  tideStationLabel: string | null
  current: KhoaCurrentInfo | null
  currentStationLabel: string | null
  verdict: SafetyVerdict
  aiExplanation: string | null
  aiMeta: AiMeta | null
  updatedAt: string
  errors: string[]
}

type HaenyeoResult = HaenyeoData | { ok: false; error: string }

// ── Verdict display mapping (LAYER 1's color is server-decided; this is ONLY
//    the Korean copy for each color, not a re-judgment) ──────────────────────

const VERDICT_HEADLINE: Record<SignalColor, string> = {
  red: '오늘은 물질하기 위험해요',
  yellow: '오늘은 물질에 주의가 필요해요',
  green: '오늘 물질 괜찮아요',
}

const SIGNAL_STYLE: Record<SignalColor, { dot: string; bg: string; border: string; label: string }> = {
  red: { dot: C.red, bg: C.redBg, border: C.redBorder, label: '위험' },
  yellow: { dot: '#D97706', bg: C.yellowBg, border: C.yellowBorder, label: '주의' },
  green: { dot: '#15803D', bg: C.greenBg, border: C.greenBorder, label: '괜찮음' },
}

/** Display-only word for 물살 strength — mirrors the 30/50cm/s tiers used by
 *  the server verdict, but this is just UI copy, not a safety decision. */
function currentSpeedWord(speedCmS: number | null): string | null {
  if (speedCmS == null) return null
  if (speedCmS < 30) return '약함'
  if (speedCmS < 50) return '다소 강함'
  return '매우 강함'
}

function fmtProvenance(meta: AiMeta): string {
  const date = meta.retrievedAt.slice(0, 10)
  return meta.asOf ? `🔍 검색 · ${meta.asOf} 기준 · ${date} 조회` : `🔍 검색 · ${date} 조회`
}

// ── TTS text builder ─────────────────────────────────────────────────────────

function buildTtsText(data: HaenyeoData): string {
  const parts: string[] = ['해녀 물질 안전 정보입니다.', VERDICT_HEADLINE[data.verdict.color] + '.']
  if (data.verdict.reasons.length > 0) parts.push(data.verdict.reasons.join('. ') + '.')
  const firstLow = data.tideEvents?.find((e) => e.kind === 'low')
  if (firstLow) parts.push(`오늘 간조 시간은 ${firstLow.time}입니다.`)
  if (data.sun?.sunset) parts.push(`일몰 시각은 ${data.sun.sunset}입니다. 해가 지기 전에 나오세요.`)
  if (data.waterTemp?.tempC != null && data.waterTemp.tempC < 20) {
    parts.push(`수온이 ${data.waterTemp.tempC}도입니다. 저체온 조심하세요.`)
  }
  if (data.aiExplanation) parts.push(data.aiExplanation)
  return parts.join(' ')
}

// ── Format helpers ────────────────────────────────────────────────────────────

function fmtTime(raw: string): string {
  const clean = raw.replace(/^.*T/, '').replace(/[+Z].*$/, '').replace(/^(\d{4})$/, '$1').trim()
  if (/^\d{4}$/.test(clean)) return `${clean.slice(0, 2)}:${clean.slice(2)}`
  if (/^\d{2}:\d{2}/.test(clean)) return clean.slice(0, 5)
  return raw.slice(0, 5)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function HaenyeoPage() {
  const router = useRouter()
  const [spot, setSpot] = useState(SPOTS[0].value)
  const [data, setData] = useState<HaenyeoData | null>(null)
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
        `/api/domin/haenyeo-safety?spot=${encodeURIComponent(targetSpot)}`,
        { signal: ctrl.signal, cache: 'no-store' },
      )
      const json = (await res.json()) as HaenyeoResult
      if (!json.ok) {
        setFetchError((json as { ok: false; error: string }).error)
        setData(null)
      } else {
        setData(json as HaenyeoData)
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

  const onSpeak = useCallback(() => {
    if (speaking) {
      stopSpeaking()
      return
    }
    if (!data) return
    speak(buildTtsText(data))
  }, [speaking, data, speak, stopSpeaking])

  const onSpotChange = useCallback(
    (s: string) => {
      stopSpeaking()
      setSpot(s)
    },
    [stopSpeaking],
  )

  // ── Derived UI data ─────────────────────────────────────────────────────────

  const verdict = data?.verdict ?? null
  const signalStyle = verdict ? SIGNAL_STYLE[verdict.color] : null

  const sunset = data?.sun?.sunset
  const waveH = data?.wave?.heightM ?? null

  const waterTemp = data?.waterTemp ?? null
  const tempC = waterTemp?.tempC ?? null
  const tempCold = tempC !== null && tempC < 20 // matches server's COLD_WATER_C tier
  const showWaterTempCard = waterTemp !== null

  const tideEvents = data?.tideEvents ?? []
  const showTideCard = tideEvents.length > 0
  const lowTideEvents = tideEvents.filter((e) => e.kind === 'low')
  const highTideEvents = tideEvents.filter((e) => e.kind === 'high')

  const current = data?.current ?? null
  const showCurrentCard = current !== null
  const currentWord = current ? currentSpeedWord(current.nowSpeedCmS ?? current.maxSpeedCmS) : null
  const currentMaxWord = current ? currentSpeedWord(current.maxSpeedCmS) : null
  const currentWillStrengthen =
    current != null &&
    current.maxSpeedCmS != null &&
    current.nowSpeedCmS != null &&
    current.maxSpeedCmS > current.nowSpeedCmS + 5

  // True when the core numeric sources are all missing — the verdict then
  // leans only on 특보 (or defaults green), so we say so honestly.
  const numericMissing = waveH === null && tempC === null && current?.nowSpeedCmS == null

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
        {!loading && data && verdict && signalStyle && (
          <>
            {/* ── Signal light (LAYER 1 — code-decided, never AI) ─────────── */}
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
                    {VERDICT_HEADLINE[verdict.color]}
                  </p>
                </div>
              </div>
              {verdict.reasons.map((r) => (
                <p key={r} style={{ ...S.signalReason, color: C.inkSoft }}>
                  • {r}
                </p>
              ))}

              {numericMissing && (
                <p style={S.numericNote} role="note">
                  ※ 파도·수온·물살 정보를 불러오지 못했어요 — 특보 기준으로만 안내 중
                </p>
              )}

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

            {/* ── AI 해석 (LAYER 2 — explains the verdict above, never overrides it) ── */}
            {data.aiExplanation && (
              <section style={S.aiCard} aria-label="오늘 물질 조건 해설">
                <h2 style={S.aiTitle}>
                  <span aria-hidden>💬</span> 오늘 물질 조건 해설
                </h2>
                <p style={S.aiText}>{data.aiExplanation}</p>
                {data.aiMeta && <p style={S.aiMetaText}>{fmtProvenance(data.aiMeta)}</p>}
              </section>
            )}

            {/* ── Data cards ──────────────────────────────────────────── */}
            <div style={S.cardGrid}>
              {/* 물때 card (KHOA 조석) */}
              {showTideCard && (
                <section style={S.dataCard} aria-label="물때 정보">
                  <h2 style={S.cardTitle}>
                    <span aria-hidden>🌊</span> 물때
                  </h2>
                  <>
                    {lowTideEvents.length > 0 && (
                      <div style={S.tideGroup}>
                        <p style={S.tideTypeLabel}>
                          간조 <span style={S.tideHint}>(물질 좋은 시간)</span>
                        </p>
                        {lowTideEvents.map((t, i) => (
                          <div key={i} style={S.tideRowLow}>
                            <span style={S.tideTimeLow}>{t.time}</span>
                            {t.levelCm != null && (
                              <span style={S.tideLevelLow}>{t.levelCm}cm</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {highTideEvents.length > 0 && (
                      <div style={S.tideGroup}>
                        <p style={S.tideTypeLabelMuted}>만조</p>
                        {highTideEvents.map((t, i) => (
                          <div key={i} style={S.tideRowHigh}>
                            <span style={S.tideTimeHigh}>{t.time}</span>
                            {t.levelCm != null && (
                              <span style={S.tideLevelHigh}>{t.levelCm}cm</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                  {data.tideStationLabel && (
                    <p style={S.stationNote}>{data.tideStationLabel}</p>
                  )}
                </section>
              )}

              {/* 일몰 card (local suncalc — unchanged) */}
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

              {/* 수온 card (KHOA 수온) */}
              {showWaterTempCard && (
                <section
                  style={
                    tempCold
                      ? { ...S.dataCard, borderColor: C.yellowBorder, background: C.yellowBg }
                      : S.dataCard
                  }
                  aria-label="수온"
                >
                  <h2 style={S.cardTitle}>
                    <span aria-hidden>🌡️</span> 수온
                  </h2>
                  <p style={{ ...S.tempValue, color: tempCold ? C.yellow : C.sea }}>
                    {tempC}°C
                  </p>
                  {tempCold && (
                    <p style={{ ...S.tempWarning, color: C.yellow }}>
                      물이 차요{'\n'}저체온 조심하세요
                    </p>
                  )}
                  {data.waterTempStationLabel && (
                    <p style={S.stationNote}>{data.waterTempStationLabel}</p>
                  )}
                </section>
              )}

              {/* 조류(물살) card (KHOA 조류) — harbor/channel-based reference value */}
              {showCurrentCard && current && (
                <section style={S.dataCard} aria-label="물살(조류)">
                  <h2 style={S.cardTitle}>
                    <span aria-hidden>🌀</span> 물살
                  </h2>
                  <p
                    style={{
                      ...S.currentWord,
                      color:
                        currentWord === '매우 강함'
                          ? C.red
                          : currentWord === '다소 강함'
                            ? C.yellow
                            : C.sea,
                    }}
                  >
                    {currentWord ?? '정보 없음'}
                  </p>
                  {current.nowDir && (
                    <p style={S.currentSub}>{current.nowDir}쪽으로 흐름</p>
                  )}
                  {currentWillStrengthen && (
                    <p style={{ ...S.tempWarning, color: C.yellow }}>
                      오늘 중 물살이{'\n'}{currentMaxWord}까지 강해질 수 있어요
                    </p>
                  )}
                  {data.currentStationLabel && (
                    <p style={S.stationNote}>{data.currentStationLabel}</p>
                  )}
                </section>
              )}

              {/* 파고 card — sourced from shared marine.ts wave logic, unchanged */}
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
                          waveH >= 1.5 ? C.red : waveH >= 1.0 ? C.yellow : C.sea,
                      }}
                    >
                      {waveH.toFixed(1)}m
                    </p>
                    {waveH >= 1.5 && (
                      <p style={{ ...S.tempWarning, color: C.red }}>입수 위험</p>
                    )}
                    {waveH >= 1.0 && waveH < 1.5 && (
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
            <FriendlyErrors errors={data.errors} />
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
    outline: 4px solid #E8590C;
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

  // AI 해석 card (LAYER 2)
  aiCard: {
    background: C.aiBg,
    border: `2px solid ${C.aiBorder}`,
    borderRadius: 20,
    padding: '18px 18px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  aiTitle: {
    fontSize: 20,
    fontWeight: 900,
    color: C.ai,
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  aiText: {
    fontSize: 19,
    fontWeight: 600,
    color: C.ink,
    margin: 0,
    lineHeight: 1.6,
  },
  aiMetaText: {
    fontSize: 14,
    fontWeight: 600,
    color: C.mutedInk,
    margin: 0,
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
    color: '#E8590C',
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

  // Current (조류) word display
  currentWord: {
    fontSize: 32,
    fontWeight: 900,
    margin: 0,
    lineHeight: 1.15,
  },
  currentSub: {
    fontSize: 16,
    fontWeight: 700,
    color: C.inkSoft,
    margin: 0,
  },

  // Station attribution note (수온/물때/조류 cards)
  stationNote: {
    fontSize: 13,
    fontWeight: 600,
    color: C.mutedInk,
    margin: '4px 0 0',
    lineHeight: 1.4,
  },

  // No data
  noData: {
    fontSize: 18,
    color: C.mutedInk,
    margin: 0,
    fontWeight: 600,
  },

  // Numeric-data missing note (shown under signal when wave/waterTemp/current unavailable)
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
