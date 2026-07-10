'use client'

/**
 * 교통 — Jeju resident transport chip.
 *
 * Data: GET /api/domin/transport (bus + airport + ferry + Perplexity context)
 *
 * Layout (top → bottom):
 *   1. 🚌 버스  — next arrivals sorted soonest-first
 *   2. ✈️ 제주공항 — 출발/도착 tabs, ~10 rows near current time
 *   3. ⛴️ 여객선 — compact route list
 *   4. 생활 교통 요약 — Perplexity context + provenance
 *   5. 🔊 읽어주기 (ko-KR) + source credit
 *
 * Accessibility mirrors haenyeo/weather chips: ≥20px body, ≥48px targets,
 * ko-KR TTS. Korean-first hardcoded strings; no i18n hook.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FriendlyErrors } from '@/components/jeju/FriendlyErrors'

// ── Design tokens (resident palette — identical to weather/haenyeo) ───────────

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
  // status colours
  green: '#14532D',
  greenBg: '#F0FDF4',
  greenBorder: '#86EFAC',
  yellow: '#92400E',
  yellowBg: '#FFFBEB',
  yellowBorder: '#FCD34D',
  red: '#B91C1C',
  redBg: '#FEF2F2',
  redBorder: '#FCA5A5',
  blue: '#1E3A5F',
  blueBg: '#EFF6FF',
  blueBorder: '#93C5FD',
}

// ── API types ─────────────────────────────────────────────────────────────────

interface BusRow {
  route: string
  arrivalMin: number
  stopsLeft: number
  stopName: string
  lowFloor?: boolean
}

interface FlightRow {
  flightId: string
  airline: string | null
  origin: string
  dest: string
  schedTime: string | null
  estTime: string | null
  status: string
}

interface FerryRow {
  route: string
  dep: string
  arr: string
  schedTime: string | null
  status: string
}

interface ContextMeta {
  source: string
  retrievedAt: string
  asOf: string | null
}

interface TransportPayload {
  ok: true
  source: string
  confidence: string
  bus: BusRow[]
  airport: { departures: FlightRow[]; arrivals: FlightRow[] }
  ferry: FerryRow[]
  context: string
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
}

type TransportResult = TransportPayload | { ok: false; error: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRetrieval(meta: ContextMeta): string {
  const date = meta.retrievedAt.slice(0, 10)
  return meta.asOf
    ? `🔍 검색 · ${meta.asOf} 기준 · ${date} 조회`
    : `🔍 검색 · ${date} 조회`
}

function statusStyle(status: string): React.CSSProperties {
  if (!status) return {}
  if (status.includes('결항')) return { background: C.redBg, color: C.red, borderColor: C.redBorder }
  if (status.includes('지연')) return { background: C.yellowBg, color: C.yellow, borderColor: C.yellowBorder }
  if (status.includes('출발') || status.includes('도착')) return { background: C.greenBg, color: C.green, borderColor: C.greenBorder }
  return { background: C.blueBg, color: C.blue, borderColor: C.blueBorder }
}

// ── Component ─────────────────────────────────────────────────────────────────

type FlightTab = '출발' | '도착'

export default function TransportPage() {
  const router = useRouter()
  const [data, setData] = useState<TransportPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [flightTab, setFlightTab] = useState<FlightTab>('출발')
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

  const fetchData = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/domin/transport?type=both', {
        signal: ctrl.signal,
        cache: 'no-store',
      })
      const json = (await res.json()) as TransportResult
      if (!json.ok) {
        setFetchError((json as { ok: false; error: string }).error)
        setData(null)
      } else {
        setData(json as TransportPayload)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setFetchError('교통 정보를 불러오지 못했어요. 잠시 후 다시 해주세요.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchData() }, [fetchData])

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel() } catch { /* no-op */ }
    }
    setSpeaking(false)
  }, [])

  const buildTts = useCallback((d: TransportPayload): string => {
    const parts: string[] = ['제주 교통 안내입니다.']
    // Next bus
    if (d.bus.length > 0) {
      const b = d.bus[0]
      parts.push(`버스 ${b.route}번이 ${b.arrivalMin}분 후 도착합니다. ${b.stopName} 정류장입니다.`)
    } else {
      parts.push('버스 정보가 없습니다.')
    }
    // Disrupted flights
    const disrupted = [
      ...(d.airport?.departures ?? []),
      ...(d.airport?.arrivals ?? []),
    ].filter(f => f.status.includes('지연') || f.status.includes('결항'))
    if (disrupted.length > 0) {
      parts.push(`항공 특이사항: ${disrupted.map(f => `${f.flightId} ${f.status}`).join(', ')}.`)
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

  // ── Derived ────────────────────────────────────────────────────────────────
  const departures = data?.airport?.departures ?? []
  const arrivals = data?.airport?.arrivals ?? []
  const flightRows = flightTab === '출발' ? departures : arrivals

  return (
    <div style={S.root}>
      <style>{GLOBAL_CSS}</style>

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div style={S.topBar}>
        <button type="button" className="rt-back" style={S.backBtn}
          onClick={() => { stopSpeaking(); router.push('/jeju/resident/general') }} aria-label="뒤로 가기">
          ← 뒤로
        </button>
        <h1 style={S.pageTitle}>🚌 교통</h1>
        <button type="button" className="rt-ctrl" style={S.refreshBtn}
          onClick={() => { stopSpeaking(); void fetchData() }}
          aria-label="새로 고침" disabled={loading}>
          {loading ? '⏳' : '🔄'}
        </button>
      </div>

      <div style={S.body}>
        {/* ── Loading ────────────────────────────────────────────────────── */}
        {loading && (
          <div style={S.loadingBox} aria-live="polite" aria-busy="true">
            <span style={{ fontSize: 48 }} aria-hidden>⏳</span>
            <p style={S.loadingText}>교통 정보 불러오는 중…</p>
          </div>
        )}

        {/* ── Fetch error ───────────────────────────────────────────────── */}
        {!loading && fetchError && (
          <div style={S.errorBox} role="alert">
            <p style={S.errorText}>⚠ {fetchError}</p>
            <button type="button" className="rt-ctrl" style={S.retryBtn}
              onClick={() => void fetchData()}>다시 시도</button>
          </div>
        )}

        {/* ── Main content ──────────────────────────────────────────────── */}
        {!loading && data && (
          <>
            {/* ── 1. 버스 ────────────────────────────────────────────────── */}
            <section style={S.card} aria-label="버스 도착 정보">
              <h2 style={S.sectionTitle}>🚌 버스 다음 도착</h2>
              {data.bus.length === 0 ? (
                <p style={S.empty}>정보 없음</p>
              ) : (
                <div style={S.busList} role="list">
                  {data.bus.map((b, i) => (
                    <div key={i} role="listitem" style={S.busRow}>
                      <span style={S.busRoute}>{b.route}</span>
                      <div style={S.busMeta}>
                        <span style={S.busArrival}>
                          {b.arrivalMin}분 후
                        </span>
                        <span style={S.busDetail}>
                          남은 정류장 {b.stopsLeft}개 · {b.stopName}
                        </span>
                      </div>
                      {b.lowFloor && (
                        <span style={S.lowFloorBadge} aria-label="저상버스">저상</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── 2. 제주공항 ────────────────────────────────────────────── */}
            <section style={S.card} aria-label="제주공항 운항 정보">
              <h2 style={S.sectionTitle}>✈️ 제주공항</h2>

              {/* Tab row */}
              <div style={S.tabRow} role="group" aria-label="출발/도착 선택">
                {(['출발', '도착'] as FlightTab[]).map(tab => (
                  <button key={tab} type="button" className="rt-tab"
                    style={flightTab === tab ? { ...S.tab, ...S.tabActive } : S.tab}
                    onClick={() => setFlightTab(tab)}
                    aria-pressed={flightTab === tab}>
                    {tab}
                  </button>
                ))}
              </div>

              {flightRows.length === 0 ? (
                <p style={S.empty}>정보 없음</p>
              ) : (
                <div style={S.flightList} role="list">
                  {flightRows.map((f, i) => (
                    <div key={i} role="listitem" style={S.flightRow}>
                      <div style={S.flightLeft}>
                        <span style={S.flightTime}>{f.schedTime ?? '--:--'}</span>
                        {f.estTime && f.estTime !== f.schedTime && (
                          <span style={S.flightEst}>실제 {f.estTime}</span>
                        )}
                      </div>
                      <div style={S.flightMid}>
                        <span style={S.flightId}>{f.flightId}</span>
                        <span style={S.flightAirline}>{f.airline ?? ''}</span>
                        <span style={S.flightRoute}>
                          {flightTab === '출발'
                            ? `→ ${f.dest}`
                            : `${f.origin} →`}
                        </span>
                      </div>
                      <span style={{ ...S.statusBadge, ...statusStyle(f.status) }}>
                        {f.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── 3. 여객선 ─────────────────────────────────────────────── */}
            <section style={S.card} aria-label="여객선 운항 정보">
              <h2 style={S.sectionTitle}>⛴️ 여객선</h2>
              {data.ferry.length === 0 ? (
                <p style={S.empty}>정보 없음</p>
              ) : (
                <div style={S.ferryList} role="list">
                  {data.ferry.map((f, i) => (
                    <div key={i} role="listitem" style={S.ferryRow}>
                      <span style={S.ferryTime}>{f.schedTime ?? '--:--'}</span>
                      <span style={S.ferryRoute}>{f.dep} → {f.arr}</span>
                      <span style={{ ...S.statusBadge, ...statusStyle(f.status) }}>
                        {f.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── 4. 생활 교통 요약 ───────────────────────────────────────── */}
            {data.context && (
              <section style={S.card} aria-label="생활 교통 요약">
                <h2 style={S.sectionTitle}>📋 생활 교통 요약</h2>
                <p style={S.contextText}>{data.context}</p>
                <p style={S.provenanceLine}>{fmtRetrieval(data.contextMeta)}</p>
              </section>
            )}

            {/* ── 5. TTS + source ─────────────────────────────────────────── */}
            <div style={S.bottomRow}>
              {ttsSupported && (
                <button type="button" className="rt-ctrl" style={S.ttsBtn}
                  onClick={onSpeak}
                  aria-label={speaking ? '읽기 중단' : '이 화면 읽어주기'}>
                  <span aria-hidden>{speaking ? '⏹' : '🔊'}</span>
                  {speaking ? ' 중단' : ' 읽어주기'}
                </button>
              )}
              <p style={S.sourceCredit}>자료: 국토교통부(TAGO) + 🔍 검색</p>
            </div>

            {/* API errors (non-fatal, soft display) */}
            <FriendlyErrors errors={data.errors} />
          </>
        )}
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100dvh',
    background: C.bg,
    color: C.ink,
    fontFamily:
      "'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '0 0 48px',
    boxSizing: 'border-box',
  },
  topBar: {
    width: '100%',
    maxWidth: 640,
    display: 'flex',
    alignItems: 'center',
    position: 'sticky',
    top: 0,
    background: C.bg,
    paddingTop: 12,
    paddingBottom: 10,
    paddingLeft: 16,
    paddingRight: 16,
    zIndex: 5,
    gap: 10,
    boxSizing: 'border-box',
  },
  backBtn: {
    minHeight: 48,
    fontSize: 20,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `2px solid ${C.sea}`,
    borderRadius: 12,
    cursor: 'pointer',
    padding: '6px 16px',
    whiteSpace: 'nowrap',
  },
  pageTitle: {
    flex: 1,
    fontSize: 28,
    fontWeight: 900,
    color: C.ink,
    margin: 0,
    textAlign: 'center',
    lineHeight: 1.2,
  },
  refreshBtn: {
    minHeight: 48,
    minWidth: 48,
    fontSize: 22,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `2px solid ${C.sea}`,
    borderRadius: 12,
    cursor: 'pointer',
    padding: '6px 10px',
  },
  body: {
    width: '100%',
    maxWidth: 640,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: '4px 16px 0',
    boxSizing: 'border-box',
  },
  loadingBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    padding: '48px 0',
  },
  loadingText: {
    fontSize: 22,
    fontWeight: 700,
    color: C.inkSoft,
    margin: 0,
  },
  errorBox: {
    background: '#FEF2F2',
    border: '2px solid #FCA5A5',
    borderRadius: 16,
    padding: '20px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    alignItems: 'flex-start',
  },
  errorText: {
    fontSize: 20,
    fontWeight: 700,
    color: C.red,
    margin: 0,
  },
  retryBtn: {
    minHeight: 48,
    fontSize: 20,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `2px solid ${C.sea}`,
    borderRadius: 12,
    cursor: 'pointer',
    padding: '8px 22px',
  },
  // Card wrapper
  card: {
    background: C.surface,
    border: `2px solid ${C.mutedBorder}`,
    borderRadius: 18,
    padding: '20px 18px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: 900,
    color: C.ink,
    margin: 0,
    lineHeight: 1.25,
  },
  empty: {
    fontSize: 20,
    color: C.mutedInk,
    margin: 0,
    padding: '8px 0',
  },
  // ── Bus ──
  busList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  busRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: C.mutedBg,
    borderRadius: 12,
    padding: '12px 14px',
    minHeight: 62,
    boxSizing: 'border-box',
    position: 'relative',
  },
  busRoute: {
    fontSize: 30,
    fontWeight: 900,
    color: C.sea,
    minWidth: 64,
    lineHeight: 1.1,
    whiteSpace: 'nowrap',
  },
  busMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: 1,
    overflow: 'hidden',
  },
  busArrival: {
    fontSize: 24,
    fontWeight: 800,
    color: C.ink,
    lineHeight: 1.2,
  },
  busDetail: {
    fontSize: 16,
    color: C.mutedInk,
    lineHeight: 1.3,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  lowFloorBadge: {
    background: '#E0F2FE',
    color: '#0369A1',
    fontSize: 14,
    fontWeight: 700,
    borderRadius: 8,
    padding: '3px 8px',
    whiteSpace: 'nowrap',
    alignSelf: 'center',
  },
  // ── Airport tabs ──
  tabRow: {
    display: 'flex',
    gap: 10,
  },
  tab: {
    minHeight: 48,
    flex: 1,
    fontSize: 20,
    fontWeight: 700,
    color: C.mutedInk,
    background: C.mutedBg,
    border: `2px solid ${C.mutedBorder}`,
    borderRadius: 12,
    cursor: 'pointer',
  },
  tabActive: {
    color: C.surface,
    background: C.sea,
    border: `2px solid ${C.seaStrong}`,
  },
  // ── Flight rows ──
  flightList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  flightRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: C.mutedBg,
    borderRadius: 12,
    padding: '10px 12px',
    minHeight: 58,
    boxSizing: 'border-box',
  },
  flightLeft: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    minWidth: 68,
    gap: 2,
  },
  flightTime: {
    fontSize: 22,
    fontWeight: 800,
    color: C.ink,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.2,
  },
  flightEst: {
    fontSize: 14,
    color: C.yellow,
    fontWeight: 700,
    lineHeight: 1.2,
  },
  flightMid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: 1,
    overflow: 'hidden',
  },
  flightId: {
    fontSize: 18,
    fontWeight: 800,
    color: C.sea,
    lineHeight: 1.2,
  },
  flightAirline: {
    fontSize: 14,
    color: C.inkSoft,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  flightRoute: {
    fontSize: 16,
    fontWeight: 700,
    color: C.ink,
    lineHeight: 1.2,
  },
  statusBadge: {
    fontSize: 15,
    fontWeight: 700,
    borderRadius: 8,
    padding: '4px 10px',
    border: '1.5px solid transparent',
    whiteSpace: 'nowrap',
    alignSelf: 'center',
  },
  // ── Ferry ──
  ferryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  ferryRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: C.mutedBg,
    borderRadius: 12,
    padding: '10px 14px',
    minHeight: 52,
    boxSizing: 'border-box',
  },
  ferryTime: {
    fontSize: 20,
    fontWeight: 800,
    color: C.ink,
    minWidth: 60,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  ferryRoute: {
    flex: 1,
    fontSize: 17,
    fontWeight: 600,
    color: C.inkSoft,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // ── Context / provenance ──
  contextText: {
    fontSize: 19,
    lineHeight: 1.7,
    color: C.inkSoft,
    margin: 0,
  },
  provenanceLine: {
    fontSize: 15,
    color: C.mutedInk,
    margin: '4px 0 0',
    lineHeight: 1.5,
  },
  // ── Bottom bar ──
  bottomRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
  },
  ttsBtn: {
    minHeight: 54,
    fontSize: 21,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `3px solid ${C.sea}`,
    borderRadius: 14,
    cursor: 'pointer',
    padding: '6px 22px',
    whiteSpace: 'nowrap',
  },
  sourceCredit: {
    fontSize: 15,
    color: C.mutedInk,
    margin: 0,
    lineHeight: 1.5,
  },
  // ── Error details (non-fatal) ──
  errDetails: {
    background: '#FFFBEB',
    border: `1.5px solid ${C.yellowBorder}`,
    borderRadius: 12,
    padding: '10px 14px',
  },
  errSummary: {
    fontSize: 16,
    fontWeight: 700,
    color: C.yellow,
    cursor: 'pointer',
  },
  errList: {
    margin: '8px 0 0 16px',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  errItem: {
    fontSize: 14,
    color: C.mutedInk,
    lineHeight: 1.5,
  },
}

// ── Global CSS ─────────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
  .rt-back:focus-visible,
  .rt-ctrl:focus-visible,
  .rt-tab:focus-visible {
    outline: 5px solid ${C.focus};
    outline-offset: 3px;
  }
  .rt-back:hover { background: #EAF4F8; }
  .rt-ctrl:hover { background: #EAF4F8; }
  .rt-tab:hover { background: #E2ECF0; }
  .rt-back, .rt-ctrl, .rt-tab {
    transition: background 0.12s ease, transform 0.07s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .rt-back:active, .rt-ctrl:active { transform: scale(0.97); }
  .rt-tab:active { transform: scale(0.96); }
  @media (prefers-reduced-motion: reduce) {
    .rt-back, .rt-ctrl, .rt-tab {
      transition: none !important;
      transform: none !important;
    }
  }
`
