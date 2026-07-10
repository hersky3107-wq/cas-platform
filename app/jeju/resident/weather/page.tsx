'use client'

/**
 * 날씨·재난 — Jeju resident weather & disaster chip.
 *
 * Data: GET /api/domin/weather-alert?region=제주시|서귀포
 *
 * Layout (top → bottom, priority order):
 *   1. Active warnings banner (특보) — most prominent
 *   2. 오늘 forecast card
 *   3. 내일 forecast card
 *   4. 주간 (week) horizontal scroll
 *   5. 생활 기상 요약 (Perplexity context + provenance)
 *   6. 🔊 TTS · Source credit
 *
 * Accessibility mirrors haenyeo chip: ≥20px body, ≥48px targets, ko-KR TTS.
 * Korean-first hardcoded strings; no i18n hook.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FriendlyErrors } from '@/components/jeju/FriendlyErrors'

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

// ── Types (mirror lib/jeju/weather-alert.ts payload) ─────────────────────────

interface MarineWarning { type: string; level: string; area: string; issuedAt: string }
interface TodayWeather {
  skyText: string | null; tempC: number | null; rainProb: number | null
  precipType: string | null; windMs: number | null
}
interface TomorrowWeather {
  skyText: string | null; tempMinC: number | null; tempMaxC: number | null; rainProb: number | null
}
interface WeekDay {
  date: string; amText: string | null; pmText: string | null
  tempMinC: number | null; tempMaxC: number | null
  rainProbAm: number | null; rainProbPm: number | null
}
interface ContextMeta { source: string; retrievedAt: string; asOf: string | null }
interface WeatherPayload {
  ok: true; region: string; source: string; confidence: string
  today: TodayWeather | null; tomorrow: TomorrowWeather | null; week: WeekDay[]
  warnings: MarineWarning[]; context: string; contextMeta: ContextMeta
  freshnessNote: string; updatedAt: string; errors: string[]
}
type WeatherResult = WeatherPayload | { ok: false; error: string }

// ── Sky → icon map ────────────────────────────────────────────────────────────

function skyIcon(sky: string | null, rain: string | null): string {
  if (rain && rain !== '없음' && rain !== '0') {
    if (rain.includes('눈')) return '❄️'
    if (rain.includes('소나기')) return '⛈️'
    return '🌧️'
  }
  if (!sky) return '🌤️'
  if (sky.includes('맑')) return '☀️'
  if (sky.includes('구름많')) return '⛅'
  return '☁️'
}

function skyOneLiner(today: TodayWeather): string {
  const icon = skyIcon(today.skyText, today.precipType)
  const sky = today.skyText ?? '날씨 정보 없음'
  const rain = today.rainProb != null ? `, 비 올 확률 ${today.rainProb}%` : ''
  const temp = today.tempC != null ? `, ${today.tempC}℃` : ''
  return `오늘은 ${icon} ${sky}${rain}${temp}예요.`
}

function fmtDate(iso: string): string {
  const m = iso.match(/\d{4}-(\d{2})-(\d{2})/)
  return m ? `${Number(m[1])}/${Number(m[2])}` : iso.slice(5)
}

function fmtRetrieval(meta: ContextMeta): string {
  const date = meta.retrievedAt.slice(0, 10)
  return meta.asOf ? `🔍 검색 · ${meta.asOf} 기준 · ${date} 조회` : `🔍 검색 · ${date} 조회`
}

// ── Component ─────────────────────────────────────────────────────────────────

const REGIONS = ['제주시', '서귀포']

export default function WeatherPage() {
  const router = useRouter()
  const [region, setRegion] = useState(REGIONS[0])
  const [data, setData] = useState<WeatherPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [ttsSupported, setTtsSupported] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) setTtsSupported(true)
  }, [])

  useEffect(
    () => () => {
      abortRef.current?.abort()
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try { window.speechSynthesis.cancel() } catch { /* no-op */ }
      }
    },
    [],
  )

  const fetchData = useCallback(async (r: string) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(`/api/domin/weather-alert?region=${encodeURIComponent(r)}`, {
        signal: ctrl.signal, cache: 'no-store',
      })
      const json = (await res.json()) as WeatherResult
      if (!json.ok) {
        setFetchError((json as { ok: false; error: string }).error)
        setData(null)
      } else {
        setData(json as WeatherPayload)
        setFetchError(null)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setFetchError('날씨 정보를 불러오지 못했어요. 잠시 후 다시 해주세요.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchData(region) }, [fetchData, region])

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel() } catch { /* no-op */ }
    }
    setSpeaking(false)
  }, [])

  const buildTts = useCallback((d: WeatherPayload): string => {
    const parts: string[] = [`${d.region} 날씨 안내입니다.`]
    const alarmWarns = d.warnings.filter(w => w.level === '경보')
    const cautionWarns = d.warnings.filter(w => w.level === '주의보')
    if (alarmWarns.length) parts.push(`경보: ${alarmWarns.map(w => `${w.type}${w.level}`).join(', ')}.`)
    else if (cautionWarns.length) parts.push(`주의보: ${cautionWarns.map(w => w.type).join(', ')}.`)
    if (d.today) parts.push(skyOneLiner(d.today))
    if (d.today?.windMs != null) parts.push(`바람 ${d.today.windMs}미터 퍼 세컨드.`)
    if (d.tomorrow) {
      const mn = d.tomorrow.tempMinC ?? '?'; const mx = d.tomorrow.tempMaxC ?? '?'
      parts.push(`내일은 최저 ${mn}도, 최고 ${mx}도${d.tomorrow.rainProb != null ? `, 강수확률 ${d.tomorrow.rainProb}퍼센트` : ''}.`)
    }
    return parts.join(' ')
  }, [])

  const onSpeak = useCallback(() => {
    if (speaking) { stopSpeaking(); return }
    if (!data || typeof window === 'undefined') return
    try {
      window.speechSynthesis.cancel()
      setSpeaking(true)
      const u = new SpeechSynthesisUtterance(buildTts(data))
      u.lang = 'ko-KR'; u.rate = 0.9
      u.onend = () => setSpeaking(false)
      u.onerror = () => setSpeaking(false)
      window.speechSynthesis.speak(u)
    } catch { setSpeaking(false) }
  }, [speaking, data, buildTts, stopSpeaking])

  const onRegion = useCallback((r: string) => { stopSpeaking(); setRegion(r) }, [stopSpeaking])

  // ── Alarm vs caution partition for warnings banner ─────────────────────────
  const alarmWarns = data?.warnings.filter(w => w.level === '경보') ?? []
  const cautionWarns = data?.warnings.filter(w => w.level === '주의보') ?? []
  const hasWarnings = (data?.warnings.length ?? 0) > 0

  return (
    <div style={S.root}>
      <style>{GLOBAL_CSS}</style>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div style={S.topBar}>
        <button type="button" className="rw-back" style={S.backBtn}
          onClick={() => { stopSpeaking(); router.push('/jeju/resident/general') }} aria-label="뒤로 가기">
          ← 뒤로
        </button>
        <h1 style={S.pageTitle}>🌦 날씨·재난</h1>
      </div>

      <div style={S.body}>
        {/* ── Region toggle ────────────────────────────────────────────────── */}
        <div style={S.chipRow} role="group" aria-label="지역 선택">
          {REGIONS.map(r => (
            <button key={r} type="button" className="rw-chip"
              style={region === r ? { ...S.chip, ...S.chipActive } : S.chip}
              onClick={() => onRegion(r)} aria-pressed={region === r} disabled={loading}>
              {r}
            </button>
          ))}
        </div>

        {/* ── Loading ──────────────────────────────────────────────────────── */}
        {loading && (
          <div style={S.loadingBox} aria-live="polite" aria-busy="true">
            <span style={{ fontSize: 48 }} aria-hidden>⏳</span>
            <p style={S.loadingText}>날씨 불러오는 중…</p>
          </div>
        )}

        {/* ── Fetch error ───────────────────────────────────────────────────── */}
        {!loading && fetchError && (
          <div style={S.errorBox} role="alert">
            <p style={S.errorText}>⚠ {fetchError}</p>
            <button type="button" className="rw-btn" style={S.retryBtn}
              onClick={() => void fetchData(region)}>다시 시도</button>
          </div>
        )}

        {!loading && data && (
          <>
            {/* ── 1. Warnings banner (most prominent) ─────────────────────── */}
            {hasWarnings ? (
              <section aria-label="기상 특보">
                {alarmWarns.map((w, i) => (
                  <div key={i} style={S.alarmRow}>
                    <span style={S.alarmBadge}>경보</span>
                    <span style={S.alarmType}>{w.type}</span>
                    <span style={S.warnArea}>{w.area}</span>
                  </div>
                ))}
                {cautionWarns.map((w, i) => (
                  <div key={i} style={S.cautionRow}>
                    <span style={S.cautionBadge}>주의보</span>
                    <span style={S.cautionType}>{w.type}</span>
                    <span style={S.warnArea}>{w.area}</span>
                  </div>
                ))}
              </section>
            ) : (
              <div style={S.noWarnRow} role="status">
                <span aria-hidden>🟢</span> 현재 기상 특보 없음
              </div>
            )}

            {/* ── 2. 오늘 card ──────────────────────────────────────────────── */}
            <section style={S.todayCard} aria-label="오늘 날씨">
              <h2 style={S.cardTitle}>오늘</h2>
              {data.today ? (
                <>
                  <div style={S.todayMain}>
                    <span style={S.skyEmoji} aria-hidden>
                      {skyIcon(data.today.skyText, data.today.precipType)}
                    </span>
                    <div>
                      <p style={S.todaySky}>{data.today.skyText ?? '정보 없음'}</p>
                      {data.today.tempC != null && (
                        <p style={S.todayTemp}>{data.today.tempC}℃</p>
                      )}
                    </div>
                  </div>
                  <p style={S.todayOneliner}>{skyOneLiner(data.today)}</p>
                  <div style={S.todayFacts}>
                    <span style={S.fact}>
                      🌧 강수확률&nbsp;
                      <strong>{data.today.rainProb != null ? `${data.today.rainProb}%` : '정보 없음'}</strong>
                    </span>
                    <span style={S.fact}>
                      💨 바람&nbsp;
                      <strong>{data.today.windMs != null ? `${data.today.windMs}m/s` : '정보 없음'}</strong>
                    </span>
                    {data.today.precipType && data.today.precipType !== '없음' && (
                      <span style={{ ...S.fact, color: C.sea }}>
                        ☔ {data.today.precipType}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <p style={S.noData}>정보 없음</p>
              )}
            </section>

            {/* ── 3. 내일 card ──────────────────────────────────────────────── */}
            <section style={S.infoCard} aria-label="내일 날씨">
              <h2 style={S.cardTitle}>내일</h2>
              {data.tomorrow ? (
                <div style={S.tmrRow}>
                  {data.tomorrow.skyText && (
                    <span style={S.tmrSky}>
                      {skyIcon(data.tomorrow.skyText, null)} {data.tomorrow.skyText}
                    </span>
                  )}
                  <span style={S.tmrTemp}>
                    {data.tomorrow.tempMinC != null || data.tomorrow.tempMaxC != null
                      ? `${data.tomorrow.tempMinC ?? '?'}~${data.tomorrow.tempMaxC ?? '?'}℃`
                      : '기온 정보 없음'}
                  </span>
                  <span style={S.tmrRain}>
                    강수 {data.tomorrow.rainProb != null ? `${data.tomorrow.rainProb}%` : '정보 없음'}
                  </span>
                </div>
              ) : (
                <p style={S.noData}>정보 없음</p>
              )}
            </section>

            {/* ── 4. 주간 horizontal scroll ─────────────────────────────────── */}
            {data.week.length > 0 && (
              <section aria-label="주간 예보">
                <h2 style={S.sectionTitle}>주간 예보</h2>
                <div style={S.weekScroll}>
                  {data.week.map(d => (
                    <div key={d.date} style={S.weekCard}>
                      <p style={S.weekDate}>{fmtDate(d.date)}</p>
                      <p style={S.weekSky}>
                        {skyIcon(d.amText, null)} {d.amText ?? '?'}
                      </p>
                      {d.pmText && d.pmText !== d.amText && (
                        <p style={S.weekSkyPm}>오후 {d.pmText}</p>
                      )}
                      <p style={S.weekTemp}>
                        {d.tempMinC ?? '?'}~{d.tempMaxC ?? '?'}℃
                      </p>
                      <p style={S.weekRain}>
                        {d.rainProbAm != null ? `${d.rainProbAm}%` : '?'}
                        {d.rainProbPm != null && d.rainProbPm !== d.rainProbAm
                          ? `/${d.rainProbPm}%` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── 5. 생활 기상 요약 (Perplexity context) ───────────────────── */}
            {(data.context || data.contextMeta) && (
              <section style={S.contextCard} aria-label="생활 기상 요약">
                <h2 style={S.cardTitle}>생활 기상 요약</h2>
                {data.context ? (
                  <p style={S.contextText}>{data.context}</p>
                ) : (
                  <p style={S.noData}>요약 정보 없음</p>
                )}
                {data.contextMeta && (
                  <p style={S.provenance}>{fmtRetrieval(data.contextMeta)}</p>
                )}
              </section>
            )}

            {/* ── 6. TTS button ────────────────────────────────────────────── */}
            {ttsSupported && (
              <button type="button" className="rw-tts"
                style={speaking ? { ...S.ttsBtn, ...S.ttsBtnActive } : S.ttsBtn}
                onClick={onSpeak} aria-label={speaking ? '읽기 중지' : '이 날씨 읽어주기'}>
                <span aria-hidden>{speaking ? '⏹' : '🔊'}</span>
                {speaking ? '읽기 중지' : '읽어주기'}
              </button>
            )}

            {/* partial errors notice */}
            <FriendlyErrors errors={data.errors} />
          </>
        )}

        <p style={S.source}>자료: 기상청 + 🔍 검색</p>
      </div>
    </div>
  )
}

// ── Global CSS ────────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
  .rw-back:focus-visible, .rw-chip:focus-visible, .rw-tts:focus-visible,
  .rw-btn:focus-visible { outline: 4px solid #C2410C; outline-offset: 3px; }
  .rw-chip:hover:not(:disabled) { opacity: 0.85; }
  .rw-tts:hover { filter: brightness(0.92); }
  .rw-back:hover { opacity: 0.80; }
  .rw-btn:hover { opacity: 0.85; }
  .rw-chip:disabled { opacity: 0.5; cursor: default; }
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
    position: 'sticky', top: 0, zIndex: 40,
    background: C.seaStrong,
    display: 'flex', alignItems: 'center', gap: 16,
    padding: '12px 16px',
    boxShadow: '0 2px 12px rgba(7,68,91,0.28)',
  },
  backBtn: {
    background: 'rgba(255,255,255,0.15)',
    border: '2px solid rgba(255,255,255,0.35)',
    borderRadius: 12, color: '#FFFFFF',
    fontSize: 20, fontWeight: 700,
    padding: '10px 16px', minHeight: 48, cursor: 'pointer',
  },
  pageTitle: { fontSize: 24, fontWeight: 900, color: '#FFFFFF', margin: 0, lineHeight: 1.2 },

  body: {
    flex: 1, display: 'flex', flexDirection: 'column', gap: 14,
    padding: '18px 16px 32px',
    maxWidth: 600, width: '100%', alignSelf: 'center', boxSizing: 'border-box',
  },

  chipRow: { display: 'flex', gap: 10 },
  chip: {
    background: C.surface, borderWidth: 2, borderStyle: 'solid', borderColor: C.mutedBorder,
    borderRadius: 24, color: C.mutedInk,
    fontSize: 18, fontWeight: 700, padding: '10px 20px', minHeight: 48, cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  chipActive: { background: C.sea, borderColor: C.sea, color: '#FFFFFF' },

  loadingBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '48px 0' },
  loadingText: { fontSize: 22, fontWeight: 700, color: C.inkSoft, margin: 0 },

  errorBox: {
    background: C.redBg, border: `2px solid ${C.redBorder}`,
    borderRadius: 18, padding: '24px 20px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
  },
  errorText: { fontSize: 20, fontWeight: 700, color: C.red, margin: 0, textAlign: 'center' },
  retryBtn: {
    background: C.sea, border: 'none', borderRadius: 14, color: '#FFFFFF',
    fontSize: 20, fontWeight: 800, padding: '14px 32px', minHeight: 56, cursor: 'pointer',
  },

  // Warnings
  alarmRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: C.redBg, border: `2px solid ${C.redBorder}`,
    borderLeft: `6px solid ${C.red}`,
    borderRadius: 16, padding: '14px 16px',
  },
  alarmBadge: {
    background: C.red, color: '#FFFFFF',
    fontSize: 16, fontWeight: 900, padding: '4px 12px',
    borderRadius: 8, whiteSpace: 'nowrap', flexShrink: 0,
  },
  alarmType: { fontSize: 22, fontWeight: 800, color: C.red, flex: 1 },
  cautionRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: C.yellowBg, border: `2px solid ${C.yellowBorder}`,
    borderLeft: '6px solid #D97706',
    borderRadius: 16, padding: '14px 16px',
  },
  cautionBadge: {
    background: '#D97706', color: '#FFFFFF',
    fontSize: 16, fontWeight: 900, padding: '4px 12px',
    borderRadius: 8, whiteSpace: 'nowrap', flexShrink: 0,
  },
  cautionType: { fontSize: 22, fontWeight: 800, color: '#92400E', flex: 1 },
  warnArea: { fontSize: 16, fontWeight: 600, color: C.mutedInk, whiteSpace: 'nowrap' },
  noWarnRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: C.greenBg, border: `1px solid ${C.greenBorder}`,
    borderRadius: 14, padding: '12px 16px',
    fontSize: 18, fontWeight: 700, color: C.green,
  },

  // Today card
  todayCard: {
    background: C.surface, border: `2px solid ${C.mutedBorder}`,
    borderRadius: 22, padding: '20px 18px',
    display: 'flex', flexDirection: 'column', gap: 12,
    boxShadow: '0 4px 18px rgba(0,0,0,0.07)',
  },
  cardTitle: { fontSize: 20, fontWeight: 900, color: C.sea, margin: 0 },
  todayMain: { display: 'flex', alignItems: 'center', gap: 16 },
  skyEmoji: { fontSize: 64, lineHeight: 1, flexShrink: 0 },
  todaySky: { fontSize: 28, fontWeight: 800, color: C.ink, margin: 0 },
  todayTemp: { fontSize: 44, fontWeight: 900, color: C.sea, margin: 0, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 },
  todayOneliner: { fontSize: 20, fontWeight: 600, color: C.inkSoft, margin: 0, lineHeight: 1.5 },
  todayFacts: { display: 'flex', flexWrap: 'wrap', gap: 12 },
  fact: { fontSize: 18, fontWeight: 600, color: C.inkSoft },

  // Tomorrow card
  infoCard: {
    background: C.surface, border: `2px solid ${C.mutedBorder}`,
    borderRadius: 20, padding: '16px 18px',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  tmrRow: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  tmrSky: { fontSize: 20, fontWeight: 700, color: C.ink, flex: 1, minWidth: 120 },
  tmrTemp: { fontSize: 24, fontWeight: 900, color: C.sea, fontVariantNumeric: 'tabular-nums' },
  tmrRain: { fontSize: 18, fontWeight: 700, color: C.inkSoft },

  // Week
  sectionTitle: { fontSize: 20, fontWeight: 900, color: C.sea, margin: '0 0 10px' },
  weekScroll: {
    display: 'flex', gap: 10,
    overflowX: 'auto',
    paddingBottom: 8,
    scrollbarWidth: 'thin',
  },
  weekCard: {
    flexShrink: 0, minWidth: 96,
    background: C.surface, border: `2px solid ${C.mutedBorder}`,
    borderRadius: 18, padding: '14px 12px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    textAlign: 'center',
  },
  weekDate: { fontSize: 16, fontWeight: 800, color: C.sea, margin: 0 },
  weekSky: { fontSize: 16, fontWeight: 700, color: C.ink, margin: 0 },
  weekSkyPm: { fontSize: 14, fontWeight: 600, color: C.mutedInk, margin: 0 },
  weekTemp: { fontSize: 18, fontWeight: 900, color: C.ink, margin: 0, fontVariantNumeric: 'tabular-nums' },
  weekRain: { fontSize: 14, fontWeight: 700, color: C.inkSoft, margin: 0 },

  // Context / Perplexity
  contextCard: {
    background: C.surface, border: `2px solid ${C.mutedBorder}`,
    borderRadius: 20, padding: '16px 18px',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  contextText: { fontSize: 18, fontWeight: 500, color: C.inkSoft, margin: 0, lineHeight: 1.65 },
  provenance: {
    fontSize: 14, fontWeight: 700, color: '#225567',
    background: '#D1E8EE', borderRadius: 8,
    padding: '5px 10px', margin: 0, alignSelf: 'flex-start',
  },

  // TTS
  ttsBtn: {
    alignSelf: 'flex-start',
    display: 'flex', alignItems: 'center', gap: 8,
    background: C.sea, border: 'none', borderRadius: 14,
    color: '#FFFFFF', fontSize: 20, fontWeight: 800,
    padding: '13px 22px', minHeight: 52, cursor: 'pointer',
    transition: 'filter 0.15s',
  },
  ttsBtnActive: { background: C.seaStrong, outline: `3px solid ${C.focus}` },

  noData: { fontSize: 18, color: C.mutedInk, margin: 0, fontWeight: 600 },
  partialNotice: { fontSize: 14, fontWeight: 700, color: C.mutedInk, textAlign: 'center', margin: 0 },
  source: { fontSize: 14, fontWeight: 600, color: C.mutedInk, textAlign: 'center', margin: '8px 0 0' },
}
