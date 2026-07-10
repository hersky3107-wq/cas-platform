'use client'

/**
 * 배출·환경 — Jeju resident waste-sorting / environment chip.
 *
 * Data:
 *   GET  /api/domin/environment → dust + centers + context + contextMeta
 *   POST /api/domin/environment/ask { question } → 분리배출 Q&A answer
 *
 * Layout (top to bottom):
 *   1. 🌫️ 오늘 미세먼지 — PM10/PM2.5 + grade badge. null → "정보 없음 (준비 중)"
 *   2. 🗑️ 분리배출 요일제·방법 요약 — Perplexity context + provenance
 *   3. 💬 분리배출 Q&A — text input → POST /ask → answer + provenance
 *   4. 📍 가까운 클린하우스·재활용도움센터 — byDong list or nearest-sorted
 *   5. Source credit
 *
 * Geolocation: optional, permission-gated — if granted, re-fetches with
 * lat/lng for nearest-sort; otherwise falls back to grouped byDong view.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FriendlyErrors } from '@/components/jeju/FriendlyErrors'

// ── Design tokens ─────────────────────────────────────────────────────────────

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
  // Dust grade colours
  gradeGood: '#166534',
  gradeGoodBg: '#DCFCE7',
  gradeMid: '#1E40AF',
  gradeMidBg: '#DBEAFE',
  gradeBad: '#E8590C',
  gradeBadBg: '#FFEDD5',
  gradeVbad: '#991B1B',
  gradeVbadBg: '#FEE2E2',
}

// ── API types ─────────────────────────────────────────────────────────────────

interface DustInfo {
  pm10: number | null
  pm10Grade: string | null
  pm25: number | null
  pm25Grade: string | null
  alert: string | null
  station: string | null
  measuredAt: string | null
}

interface CleanCenter {
  name: string
  dong: string
  address: string
  landmark: string | null
  lat: number | null
  lng: number | null
  items: string[]
  hours: string
  type: string
  distanceKm?: number
}

/** Primary line: landmark for Seogwipo-style; full name for Jeju-style (dong + landmark). */
function centerTitle(c: CleanCenter): string {
  if (c.name && c.landmark && c.name !== c.landmark && c.name.startsWith(c.dong)) return c.name
  return c.landmark?.trim() || c.name?.trim() || c.address
}

interface ContextMeta {
  source: string
  retrievedAt: string
  asOf: string | null
}

interface EnvironmentPayload {
  ok: true
  dust: DustInfo | null
  centers: {
    byDong?: Record<string, CleanCenter[]>
    nearest?: CleanCenter[]
  }
  context: string
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
}

interface AskResult {
  ok: boolean
  question: string
  answer: string
  contextMeta: ContextMeta
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function gradeStyle(grade: string | null): React.CSSProperties {
  if (!grade) return { color: C.mutedInk, background: C.mutedBg }
  if (grade === '좋음') return { color: C.gradeGood, background: C.gradeGoodBg }
  if (grade === '보통') return { color: C.gradeMid, background: C.gradeMidBg }
  if (grade === '나쁨') return { color: C.gradeBad, background: C.gradeBadBg }
  if (grade === '매우나쁨') return { color: C.gradeVbad, background: C.gradeVbadBg }
  return { color: C.mutedInk, background: C.mutedBg }
}

function fmtProvenance(meta: ContextMeta): string {
  const date = meta.retrievedAt.slice(0, 10)
  return meta.asOf
    ? `🔍 검색 · ${meta.asOf} 기준 · ${date} 조회`
    : `🔍 검색 · ${date} 조회`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EnvironmentPage() {
  const router = useRouter()
  const [data, setData] = useState<EnvironmentPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [geoStatus, setGeoStatus] = useState<'idle' | 'pending' | 'granted' | 'denied'>('idle')
  const abortRef = useRef<AbortController | null>(null)

  // Q&A state
  const [question, setQuestion] = useState('')
  const [askLoading, setAskLoading] = useState(false)
  const [askResult, setAskResult] = useState<AskResult | null>(null)
  const [askError, setAskError] = useState<string | null>(null)

  // cleanup
  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  const fetchData = useCallback(async (lat?: number, lng?: number) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setFetchError(null)
    try {
      const qs = lat != null && lng != null ? `?lat=${lat}&lng=${lng}` : ''
      const res = await fetch(`/api/domin/environment${qs}`, { signal: ctrl.signal, cache: 'no-store' })
      const json = await res.json() as EnvironmentPayload | { ok: false; error: string }
      if (!json.ok) {
        setFetchError((json as { ok: false; error: string }).error)
        setData(null)
      } else {
        setData(json as EnvironmentPayload)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setFetchError('환경 정보를 불러오지 못했어요.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchData() }, [fetchData])

  // Try to get geolocation once (permission-gated, no popup prompt on load)
  const requestGeo = useCallback(() => {
    if (!navigator.geolocation) { setGeoStatus('denied'); return }
    setGeoStatus('pending')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoStatus('granted')
        void fetchData(pos.coords.latitude, pos.coords.longitude)
      },
      () => setGeoStatus('denied'),
      { timeout: 8000 },
    )
  }, [fetchData])

  // Q&A submit
  const onAsk = useCallback(async () => {
    const q = question.trim()
    if (!q || askLoading) return
    setAskLoading(true)
    setAskError(null)
    setAskResult(null)
    try {
      const res = await fetch('/api/domin/environment/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const json = await res.json() as AskResult
      if (!json.ok) {
        setAskError(json.error ?? '답변을 받지 못했어요.')
      } else {
        setAskResult(json)
      }
    } catch (e: unknown) {
      setAskError(e instanceof Error ? e.message : '오류가 발생했어요.')
    } finally {
      setAskLoading(false)
    }
  }, [question, askLoading])

  // Flatten centers into a list for display
  const centersList: CleanCenter[] = (() => {
    if (!data) return []
    const c = data.centers
    if (c.nearest) return c.nearest
    if (c.byDong) return Object.values(c.byDong).flat()
    return []
  })()

  const isNearest = Boolean(data?.centers.nearest)

  return (
    <div style={S.root}>
      <style>{GLOBAL_CSS}</style>

      {/* Top bar */}
      <div style={S.topBar}>
        <button type="button" className="env-back" style={S.backBtn}
          onClick={() => router.push('/jeju/resident/general')} aria-label="뒤로 가기">
          ← 뒤로
        </button>
        <h1 style={S.pageTitle}>♻️ 배출·환경</h1>
        <button type="button" className="env-ctrl" style={S.refreshBtn}
          onClick={() => { void fetchData() }}
          aria-label="새로 고침" disabled={loading}>
          {loading ? '⏳' : '🔄'}
        </button>
      </div>

      <div style={S.body}>

        {/* Loading */}
        {loading && (
          <div style={S.loadingBox} aria-live="polite" aria-busy="true">
            <span style={{ fontSize: 40 }} aria-hidden>⏳</span>
            <p style={S.loadingText}>환경 정보 불러오는 중…</p>
          </div>
        )}

        {/* Route error */}
        {!loading && fetchError && (
          <div style={S.errorBox} role="alert">
            <p style={S.errorText}>⚠ {fetchError}</p>
            <button type="button" className="env-ctrl" style={S.retryBtn}
              onClick={() => void fetchData()}>다시 시도</button>
          </div>
        )}

        {!loading && data && (
          <>
            {/* ── 1. 미세먼지 ─────────────────────────────────────────────── */}
            <section style={S.card} aria-label="오늘 미세먼지">
              <h2 style={S.sectionTitle}>🌫️ 오늘 미세먼지</h2>
              {data.dust ? (
                <>
                  <div style={S.dustRow}>
                    <DustCell label="미세먼지 PM10" value={data.dust.pm10} grade={data.dust.pm10Grade} unit="㎍/㎥" />
                    <DustCell label="초미세먼지 PM2.5" value={data.dust.pm25} grade={data.dust.pm25Grade} unit="㎍/㎥" />
                  </div>
                  {data.dust.alert && (
                    <p style={S.dustAlert}>⚠ 경보: {data.dust.alert}</p>
                  )}
                  {(data.dust.station || data.dust.measuredAt) && (
                    <p style={S.dustMeta}>
                      {data.dust.station ? `측정소: ${data.dust.station}` : ''}
                      {data.dust.station && data.dust.measuredAt ? ' · ' : ''}
                      {data.dust.measuredAt ? `측정: ${data.dust.measuredAt}` : ''}
                    </p>
                  )}
                </>
              ) : (
                <p style={S.empty}>정보 없음 (에어코리아 데이터 준비 중)</p>
              )}
            </section>

            {/* ── 2. 분리배출 요일제·방법 요약 ─────────────────────────────── */}
            {data.context ? (
              <section style={S.card} aria-label="분리배출 요일제·방법 요약">
                <h2 style={S.sectionTitle}>🗑️ 분리배출 요일제·방법 요약</h2>
                <p style={S.contextText}>{data.context}</p>
                <p style={S.provenance}>{fmtProvenance(data.contextMeta)}</p>
              </section>
            ) : null}

            {/* ── 3. 분리배출 Q&A ──────────────────────────────────────────── */}
            <section style={S.card} aria-label="분리배출 Q&A">
              <h2 style={S.sectionTitle}>💬 분리배출 Q&A</h2>
              <p style={S.qaHint}>버리기 어려운 물건이 있으면 물어보세요.</p>
              <div style={S.qaInputRow}>
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void onAsk() }}
                  placeholder="폐형광등 어디에 버려요?"
                  style={S.qaInput}
                  aria-label="분리배출 질문 입력"
                  disabled={askLoading}
                />
                <button
                  type="button"
                  className="env-ctrl"
                  style={{ ...S.qaBtn, ...(askLoading ? S.qaBtnLoading : {}) }}
                  onClick={() => void onAsk()}
                  disabled={askLoading || !question.trim()}
                  aria-label="물어보기">
                  {askLoading ? '⏳' : '물어보기'}
                </button>
              </div>

              {askLoading && (
                <p style={S.qaWait} aria-live="polite">답변 찾는 중…</p>
              )}

              {askError && (
                <p style={S.qaError} role="alert">⚠ {askError}</p>
              )}

              {askResult && !askLoading && (
                <div style={S.qaAnswer}>
                  <p style={S.qaQ}>Q. {askResult.question}</p>
                  <p style={S.qaA}>{askResult.answer || '답변을 받지 못했어요.'}</p>
                  <p style={S.provenance}>{fmtProvenance(askResult.contextMeta)}</p>
                </div>
              )}
            </section>

            {/* ── 4. 가까운 클린하우스·재활용도움센터 ─────────────────────── */}
            <section style={S.card} aria-label="클린하우스·재활용도움센터">
              <div style={S.centersHeader}>
                <h2 style={S.sectionTitle}>
                  📍 {isNearest ? '가까운 ' : ''}클린하우스·재활용도움센터
                </h2>
                {geoStatus === 'idle' && (
                  <button type="button" className="env-ctrl" style={S.geoBtn}
                    onClick={requestGeo} aria-label="내 위치로 가까운 순 정렬">
                    📍 내 위치 사용
                  </button>
                )}
                {geoStatus === 'pending' && (
                  <span style={S.geoPending}>위치 확인 중…</span>
                )}
                {geoStatus === 'denied' && (
                  <span style={S.geoDenied}>위치 사용 불가</span>
                )}
              </div>

              {centersList.length === 0 ? (
                <p style={S.empty}>정보 없음</p>
              ) : (
                <div style={S.centerList} role="list">
                  {centersList.map((c, i) => (
                    <div key={i} role="listitem" style={S.centerRow}>
                      <div style={S.centerTopRow}>
                        <span style={S.centerName}>{centerTitle(c)}</span>
                        <span style={c.type === '재활용도움센터' ? S.typeBadgeRecycle : S.typeBadgeClean}>
                          {c.type}
                        </span>
                      </div>
                      <p style={S.centerDong}>{c.dong}</p>
                      {c.address && c.address !== centerTitle(c) && (
                        <p style={S.centerAddrSecondary}>주소: {c.address}</p>
                      )}
                      <p style={S.centerHours}>⏰ {c.hours}</p>
                      {c.distanceKm != null && (
                        <p style={S.centerDist}>📏 {c.distanceKm}km</p>
                      )}
                      {c.items.length > 0 && (
                        <div style={S.itemChips} aria-label="배출 가능 품목">
                          {c.items.map((it, j) => (
                            <span key={j} style={S.itemChip}>{it}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Source + freshness ───────────────────────────────────────── */}
            <div style={S.bottomRow}>
              <p style={S.freshnessNote}>{data.freshnessNote}</p>
              <p style={S.sourceCredit}>자료: 에어코리아(한국환경공단) + 🔍 검색</p>
            </div>

            {/* Non-fatal errors */}
                <FriendlyErrors errors={data.errors} />
          </>
        )}
      </div>
    </div>
  )
}

// ── DustCell sub-component ────────────────────────────────────────────────────

function DustCell({
  label, value, grade, unit,
}: { label: string; value: number | null; grade: string | null; unit: string }) {
  const hasData = value != null
  return (
    <div style={S.dustCell}>
      <p style={S.dustLabel}>{label}</p>
      {hasData ? (
        <>
          <p style={S.dustValue}>{value} <span style={S.dustUnit}>{unit}</span></p>
          <span style={{ ...S.gradeBadge, ...gradeStyle(grade) }}>
            {grade ?? '—'}
          </span>
        </>
      ) : (
        <p style={S.dustNoData}>정보 없음</p>
      )}
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
    minHeight: 44,
    fontSize: 18,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `2px solid ${C.sea}`,
    borderRadius: 10,
    cursor: 'pointer',
    padding: '5px 14px',
    whiteSpace: 'nowrap',
  },
  pageTitle: {
    flex: 1,
    fontSize: 24,
    fontWeight: 900,
    color: C.ink,
    margin: 0,
    textAlign: 'center',
    lineHeight: 1.2,
  },
  refreshBtn: {
    minHeight: 44,
    minWidth: 44,
    fontSize: 20,
    color: C.sea,
    background: C.surface,
    border: `2px solid ${C.sea}`,
    borderRadius: 10,
    cursor: 'pointer',
    padding: '5px 10px',
    fontWeight: 700,
  },
  body: {
    width: '100%',
    maxWidth: 640,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    padding: '4px 16px 0',
    boxSizing: 'border-box',
  },
  loadingBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    padding: '40px 0',
  },
  loadingText: { fontSize: 18, fontWeight: 700, color: C.inkSoft, margin: 0 },
  errorBox: {
    background: '#FEF2F2',
    border: '2px solid #FCA5A5',
    borderRadius: 14,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  errorText: { fontSize: 17, fontWeight: 700, color: '#B91C1C', margin: 0 },
  retryBtn: {
    minHeight: 40,
    fontSize: 17,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `2px solid ${C.sea}`,
    borderRadius: 10,
    cursor: 'pointer',
    padding: '6px 18px',
    alignSelf: 'flex-start',
  },
  card: {
    background: C.surface,
    border: `1.5px solid ${C.mutedBorder}`,
    borderRadius: 16,
    padding: '14px 14px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 900,
    color: C.seaStrong,
    margin: 0,
    paddingBottom: 6,
    borderBottom: `1.5px solid ${C.mutedBorder}`,
  },
  empty: { fontSize: 15, color: C.mutedInk, margin: 0 },
  // Dust
  dustRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
  },
  dustCell: {
    background: C.mutedBg,
    borderRadius: 12,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  dustLabel: { fontSize: 12, fontWeight: 700, color: C.mutedInk, margin: 0 },
  dustValue: { fontSize: 22, fontWeight: 900, color: C.ink, margin: 0, lineHeight: 1.2 },
  dustUnit: { fontSize: 13, fontWeight: 400, color: C.inkSoft },
  dustNoData: { fontSize: 15, color: C.mutedInk, margin: 0, fontStyle: 'italic' },
  gradeBadge: {
    display: 'inline-block',
    fontSize: 13,
    fontWeight: 700,
    borderRadius: 8,
    padding: '3px 10px',
    alignSelf: 'flex-start',
  },
  dustAlert: {
    fontSize: 15,
    fontWeight: 700,
    color: '#991B1B',
    background: '#FEE2E2',
    borderRadius: 8,
    padding: '6px 10px',
    margin: 0,
  },
  dustMeta: { fontSize: 12, color: C.mutedInk, margin: 0 },
  // Context
  contextText: { fontSize: 15, lineHeight: 1.7, color: C.inkSoft, margin: 0 },
  provenance: { fontSize: 12, color: C.mutedInk, margin: '2px 0 0', lineHeight: 1.4 },
  // Q&A
  qaHint: { fontSize: 14, color: C.inkSoft, margin: 0 },
  qaInputRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'stretch',
  },
  qaInput: {
    flex: 1,
    fontSize: 15,
    color: C.ink,
    background: C.mutedBg,
    border: `1.5px solid ${C.mutedBorder}`,
    borderRadius: 10,
    padding: '9px 12px',
    outline: 'none',
    minHeight: 44,
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  qaBtn: {
    minHeight: 44,
    fontSize: 15,
    fontWeight: 700,
    color: C.surface,
    background: C.sea,
    border: `2px solid ${C.sea}`,
    borderRadius: 10,
    cursor: 'pointer',
    padding: '6px 16px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  qaBtnLoading: {
    opacity: 0.65,
    cursor: 'default',
  },
  qaWait: { fontSize: 14, color: C.mutedInk, margin: 0, fontStyle: 'italic' },
  qaError: { fontSize: 14, color: '#B91C1C', margin: 0, fontWeight: 700 },
  qaAnswer: {
    background: '#EAF2FB',
    border: '1.5px solid #BAE6FD',
    borderRadius: 12,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  qaQ: { fontSize: 13, fontWeight: 700, color: C.mutedInk, margin: 0 },
  qaA: { fontSize: 15, lineHeight: 1.7, color: C.ink, margin: 0 },
  // Centers
  centersHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  geoBtn: {
    minHeight: 36,
    fontSize: 13,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `1.5px solid ${C.sea}`,
    borderRadius: 8,
    cursor: 'pointer',
    padding: '4px 12px',
    whiteSpace: 'nowrap',
  },
  geoPending: { fontSize: 13, color: C.mutedInk, fontStyle: 'italic' },
  geoDenied: { fontSize: 13, color: C.mutedInk },
  centerList: { display: 'flex', flexDirection: 'column', gap: 12 },
  centerRow: {
    borderBottom: `1px solid ${C.mutedBg}`,
    paddingBottom: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  centerTopRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  centerName: { fontSize: 16, fontWeight: 800, color: C.ink, lineHeight: 1.35 },
  typeBadgeRecycle: {
    fontSize: 11,
    fontWeight: 700,
    color: '#166534',
    background: '#DCFCE7',
    borderRadius: 6,
    padding: '2px 7px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  typeBadgeClean: {
    fontSize: 11,
    fontWeight: 700,
    color: '#1E40AF',
    background: '#DBEAFE',
    borderRadius: 6,
    padding: '2px 7px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  centerDong: { fontSize: 13, fontWeight: 600, color: C.sea, margin: 0 },
  centerAddrSecondary: { fontSize: 12, color: C.mutedInk, margin: 0, lineHeight: 1.45 },
  centerHours: { fontSize: 13, color: C.mutedInk, margin: 0 },
  centerDist: { fontSize: 13, color: C.sea, fontWeight: 700, margin: 0 },
  itemChips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  itemChip: {
    fontSize: 11,
    fontWeight: 700,
    color: C.mutedInk,
    background: C.mutedBg,
    borderRadius: 6,
    padding: '2px 7px',
  },
  // Bottom
  bottomRow: { display: 'flex', flexDirection: 'column', gap: 4 },
  freshnessNote: { fontSize: 13, color: C.mutedInk, margin: 0 },
  sourceCredit: { fontSize: 13, color: C.mutedInk, margin: 0 },
  errDetails: {
    background: '#FFFBEB',
    border: '1.5px solid #FCD34D',
    borderRadius: 10,
    padding: '8px 12px',
  },
  errSummary: { fontSize: 14, fontWeight: 700, color: '#8A3F04', cursor: 'pointer' },
  errList: { margin: '6px 0 0 14px', padding: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  errItem: { fontSize: 13, color: C.mutedInk, lineHeight: 1.5 },
}

const GLOBAL_CSS = `
  .env-back:focus-visible, .env-ctrl:focus-visible {
    outline: 4px solid ${C.focus};
    outline-offset: 3px;
  }
  .env-back:hover, .env-ctrl:hover { background: #EAF2FB; }
  .env-back, .env-ctrl {
    transition: background 0.12s ease, transform 0.07s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .env-back:active, .env-ctrl:active { transform: scale(0.97); }
  .env-qa-input:focus {
    border-color: ${C.sea};
    box-shadow: 0 0 0 3px ${C.sea}30;
  }
  @media (prefers-reduced-motion: reduce) {
    .env-back, .env-ctrl { transition: none !important; transform: none !important; }
  }
`
