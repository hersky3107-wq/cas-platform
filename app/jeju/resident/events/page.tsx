'use client'

/**
 * 축제·행사 — Jeju resident events chip.
 *
 * Data: GET /api/domin/events
 * Groups: 축제 / 공연전시 / 체험강좌 / 도정시정 / 기타. Empty groups hidden.
 * Each card: status badge (진행중=green / 예정=blue), date range, place, price,
 * thumbnail, url, and a source badge (문화정보 vs 🔍 검색 with asOf provenance).
 * Styling: adult density — mirrors prices / transport chip tone.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FriendlyErrors } from '@/components/jeju/FriendlyErrors'

// ── Design tokens ─────────────────────────────────────────────────────────────

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
  green: '#166534',
  greenBg: '#DCFCE7',
  blue: '#1E40AF',
  blueBg: '#DBEAFE',
  searchBg: '#F0F9FF',
  searchInk: '#0369A1',
}

// ── API types ─────────────────────────────────────────────────────────────────

interface EventItem {
  title: string
  category: string
  group: string
  place: string | null
  startDate: string | null
  endDate: string | null
  time: string | null
  price: string | null
  lat: number | null
  lng: number | null
  thumbnail: string | null
  url: string | null
  status: '진행중' | '예정'
  source: '문화정보' | '검색'
  asOf: string | null
}

type EventGroups = Record<string, EventItem[]>

interface ContextMeta {
  source: string
  retrievedAt: string
  asOf: string | null
}

interface EventsPayload {
  ok: true
  windowDays: number
  today: string
  groups: EventGroups
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
  fromCache: boolean
}

type EventsResult = EventsPayload | { ok: false; error: string }

const GROUP_LABELS: { key: string; label: string; emoji: string }[] = [
  { key: '축제',   label: '축제',       emoji: '🎉' },
  { key: '공연전시', label: '공연·전시', emoji: '🎭' },
  { key: '체험강좌', label: '체험·강좌', emoji: '🎨' },
  { key: '도정시정', label: '도정·시정 행사', emoji: '🏛' },
  { key: '기타',   label: '기타',       emoji: '📌' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateRange(start: string | null, end: string | null): string {
  if (!start) return '날짜 미정'
  if (!end || end === start) return start
  // If same month: "7월 10일~23일"; else full range
  const [sy, sm, sd] = start.split('-')
  const [ey, em, ed] = end.split('-')
  if (sy === ey && sm === em) {
    return `${Number(sm)}월 ${Number(sd)}일~${Number(ed)}일`
  }
  if (sy === ey) {
    return `${Number(sm)}월 ${Number(sd)}일 ~ ${Number(em)}월 ${Number(ed)}일`
  }
  return `${start} ~ ${end}`
}

function fmtRetrieval(meta: ContextMeta): string {
  const date = meta.retrievedAt.slice(0, 10)
  return meta.asOf
    ? `🔍 검색 · ${meta.asOf} 기준 · ${date} 조회`
    : `🔍 검색 · ${date} 조회`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EventsPage() {
  const router = useRouter()
  const [data, setData] = useState<EventsPayload | null>(null)
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

  const fetchData = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/domin/events', { signal: ctrl.signal, cache: 'no-store' })
      const json = (await res.json()) as EventsResult
      if (!json.ok) {
        setFetchError((json as { ok: false; error: string }).error)
        setData(null)
      } else {
        setData(json as EventsPayload)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setFetchError('행사 정보를 불러오지 못했어요.')
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

  const buildTts = useCallback((d: EventsPayload): string => {
    const parts: string[] = [`제주 행사 안내입니다. 오늘 ${d.today}부터 ${d.windowDays}일 이내 행사입니다.`]
    for (const { key, label } of GROUP_LABELS) {
      const items = d.groups[key] ?? []
      if (!items.length) continue
      parts.push(`${label} ${items.length}건.`)
      for (const ev of items.slice(0, 3)) {
        const range = ev.startDate
          ? `${ev.startDate}${ev.endDate && ev.endDate !== ev.startDate ? '부터 ' + ev.endDate + '까지' : ''}`
          : ''
        parts.push(`${ev.title}. ${range} ${ev.place ?? ''}`.trim())
      }
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

  const totalItems = data
    ? GROUP_LABELS.reduce((s, { key }) => s + (data.groups[key]?.length ?? 0), 0)
    : 0

  return (
    <div style={S.root}>
      <style>{GLOBAL_CSS}</style>

      {/* Top bar */}
      <div style={S.topBar}>
        <button type="button" className="re-back" style={S.backBtn}
          onClick={() => { stopSpeaking(); router.push('/jeju/resident/general') }} aria-label="뒤로 가기">
          ← 뒤로
        </button>
        <h1 style={S.pageTitle}>🎉 축제·행사</h1>
        <button type="button" className="re-ctrl" style={S.refreshBtn}
          onClick={() => { stopSpeaking(); void fetchData() }}
          aria-label="새로 고침" disabled={loading}>
          {loading ? '⏳' : '🔄'}
        </button>
      </div>

      <div style={S.body}>

        {/* Loading */}
        {loading && (
          <div style={S.loadingBox} aria-live="polite" aria-busy="true">
            <span style={{ fontSize: 40 }} aria-hidden>⏳</span>
            <p style={S.loadingText}>행사 정보 불러오는 중…</p>
          </div>
        )}

        {/* Error */}
        {!loading && fetchError && (
          <div style={S.errorBox} role="alert">
            <p style={S.errorText}>⚠ {fetchError}</p>
            <button type="button" className="re-ctrl" style={S.retryBtn}
              onClick={() => void fetchData()}>다시 시도</button>
          </div>
        )}

        {/* Main content */}
        {!loading && data && (
          <>
            {/* Meta bar */}
            <div style={S.metaBar}>
              <span style={S.metaBadge}>오늘부터 {data.windowDays}일 이내 제주 행사</span>
              <span style={S.metaBadge}>{totalItems}건</span>
              {data.fromCache && (
                <span style={{ ...S.metaBadge, ...S.cacheBadge }}>오늘 정리본</span>
              )}
            </div>

            {/* Group sections — skip empty */}
            {GROUP_LABELS.map(({ key, label, emoji }) => {
              const items = data.groups[key] ?? []
              if (items.length === 0) return null
              return (
                <section key={key} style={S.card} aria-label={`${label}`}>
                  <h2 style={S.groupTitle}>{emoji} {label}</h2>
                  <div style={S.eventList} role="list">
                    {items.map((ev, i) => (
                      <EventCard key={i} ev={ev} />
                    ))}
                  </div>
                </section>
              )
            })}

            {/* All groups empty */}
            {totalItems === 0 && (
              <div style={S.emptyBox}>
                <p style={S.emptyText}>오늘부터 2주 이내 등록된 행사가 없어요.</p>
              </div>
            )}

            {/* Bottom row */}
            <div style={S.bottomRow}>
              {ttsSupported && (
                <button type="button" className="re-ctrl" style={S.ttsBtn}
                  onClick={onSpeak}
                  aria-label={speaking ? '읽기 중단' : '읽어주기'}>
                  {speaking ? '⏹ 중단' : '🔊 읽어주기'}
                </button>
              )}
              <p style={S.freshnessNote}>{data.freshnessNote}</p>
              <p style={S.sourceCredit}>자료: 한국문화정보원 + 🔍 검색</p>
            </div>

            {/* Non-fatal errors */}
            <FriendlyErrors errors={data.errors} />
          </>
        )}
      </div>
    </div>
  )
}

// ── EventCard sub-component ────────────────────────────────────────────────────

function EventCard({ ev }: { ev: EventItem }) {
  const isActive = ev.status === '진행중'
  const isSearch = ev.source === '검색'

  return (
    <article role="listitem" style={S.eventCard}>
      {/* Thumbnail */}
      {ev.thumbnail && (
        <img
          src={ev.thumbnail}
          alt=""
          aria-hidden
          style={S.thumb}
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      )}

      <div style={S.eventBody}>
        {/* Badges row */}
        <div style={S.badgeRow}>
          <span style={isActive ? S.activeBadge : S.upcomingBadge}>
            {ev.status}
          </span>
          {isSearch ? (
            <span style={S.searchBadge}>🔍 검색</span>
          ) : (
            <span style={S.officialBadge}>문화정보</span>
          )}
        </div>

        {/* Title */}
        {ev.url ? (
          <a href={ev.url} target="_blank" rel="noopener noreferrer" style={S.titleLink}>
            {ev.title}
          </a>
        ) : (
          <p style={S.titleText}>{ev.title}</p>
        )}

        {/* Meta row — date, place, price */}
        <div style={S.metaRow}>
          <span style={S.metaItem}>📅 {fmtDateRange(ev.startDate, ev.endDate)}</span>
          {ev.place && <span style={S.metaItem}>📍 {ev.place}</span>}
          {ev.price && <span style={S.metaItem}>💵 {ev.price}</span>}
        </div>

        {/* Provenance for search items */}
        {isSearch && ev.asOf && (
          <p style={S.provenance}>🔍 검색 · {ev.asOf} 기준</p>
        )}
      </div>
    </article>
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
  metaBar: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  metaBadge: {
    fontSize: 13,
    fontWeight: 700,
    color: C.sea,
    background: '#D8ECF2',
    borderRadius: 8,
    padding: '4px 10px',
  },
  cacheBadge: {
    color: '#166534',
    background: '#DCFCE7',
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
  groupTitle: {
    fontSize: 18,
    fontWeight: 900,
    color: C.seaStrong,
    margin: 0,
    paddingBottom: 8,
    borderBottom: `1.5px solid ${C.mutedBorder}`,
  },
  eventList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  eventCard: {
    display: 'flex',
    gap: 10,
    paddingBottom: 12,
    borderBottom: `1px solid ${C.mutedBg}`,
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    objectFit: 'cover',
    flexShrink: 0,
    background: C.mutedBg,
  },
  eventBody: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
  },
  badgeRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  activeBadge: {
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 6,
    padding: '2px 8px',
    color: C.green,
    background: C.greenBg,
    whiteSpace: 'nowrap',
  },
  upcomingBadge: {
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 6,
    padding: '2px 8px',
    color: C.blue,
    background: C.blueBg,
    whiteSpace: 'nowrap',
  },
  searchBadge: {
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 6,
    padding: '2px 8px',
    color: C.searchInk,
    background: C.searchBg,
    whiteSpace: 'nowrap',
  },
  officialBadge: {
    fontSize: 12,
    fontWeight: 700,
    borderRadius: 6,
    padding: '2px 8px',
    color: C.mutedInk,
    background: C.mutedBg,
    whiteSpace: 'nowrap',
  },
  titleLink: {
    fontSize: 16,
    fontWeight: 700,
    color: C.sea,
    textDecoration: 'underline',
    textDecorationColor: `${C.sea}60`,
    lineHeight: 1.4,
    wordBreak: 'keep-all',
    overflowWrap: 'anywhere',
  },
  titleText: {
    fontSize: 16,
    fontWeight: 700,
    color: C.ink,
    margin: 0,
    lineHeight: 1.4,
    wordBreak: 'keep-all',
    overflowWrap: 'anywhere',
  },
  metaRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  metaItem: {
    fontSize: 13,
    color: C.inkSoft,
    lineHeight: 1.5,
  },
  provenance: {
    fontSize: 12,
    color: C.mutedInk,
    margin: '2px 0 0',
  },
  emptyBox: {
    background: C.surface,
    border: `1.5px solid ${C.mutedBorder}`,
    borderRadius: 16,
    padding: '24px 16px',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: C.mutedInk,
    margin: 0,
  },
  bottomRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  ttsBtn: {
    minHeight: 44,
    fontSize: 17,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `2px solid ${C.sea}`,
    borderRadius: 12,
    cursor: 'pointer',
    padding: '6px 20px',
    alignSelf: 'flex-start',
  },
  freshnessNote: { fontSize: 13, color: C.mutedInk, margin: 0 },
  sourceCredit: { fontSize: 13, color: C.mutedInk, margin: 0 },
  errDetails: {
    background: '#FFFBEB',
    border: '1.5px solid #FCD34D',
    borderRadius: 10,
    padding: '8px 12px',
  },
  errSummary: { fontSize: 14, fontWeight: 700, color: '#92400E', cursor: 'pointer' },
  errList: { margin: '6px 0 0 14px', padding: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  errItem: { fontSize: 13, color: C.mutedInk, lineHeight: 1.5 },
}

const GLOBAL_CSS = `
  .re-back:focus-visible, .re-ctrl:focus-visible {
    outline: 4px solid ${C.focus};
    outline-offset: 3px;
  }
  .re-back:hover, .re-ctrl:hover { background: #EAF4F8; }
  .re-back, .re-ctrl {
    transition: background 0.12s ease, transform 0.07s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .re-back:active, .re-ctrl:active { transform: scale(0.97); }
  @media (prefers-reduced-motion: reduce) {
    .re-back, .re-ctrl { transition: none !important; transform: none !important; }
  }
`
