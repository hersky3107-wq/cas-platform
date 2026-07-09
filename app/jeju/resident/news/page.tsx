'use client'

/**
 * 오늘의 소식 — Jeju resident local-news briefing chip.
 *
 * Data: GET /api/domin/news (cached daily Perplexity briefing, Jeju-only,
 * resident-life categories, last 3 days).
 *
 * Layout:
 *   - Category-grouped article cards (headline, summary, why, source, asOf)
 *   - 🔍 검색 provenance line
 *   - 🔊 읽어주기 (ko-KR): reads headlines + summaries in order
 *   - Source credit
 *
 * Accessibility mirrors weather/transport chips: ≥20px body, ≥48px targets,
 * ko-KR TTS. Korean-first hardcoded strings; adult reading level.
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
}

const CATEGORY_ORDER = [
  '생활·물가',
  '교통·공항',
  '날씨·재난·안전',
  '행사·축제',
  '복지·행정',
  '부동산·개발',
] as const

// ── API types ─────────────────────────────────────────────────────────────────

interface NewsItem {
  category: string
  headline: string
  summary: string
  why: string
  source: string | null
  asOf: string | null
}

interface ContextMeta {
  source: string
  retrievedAt: string
  asOf: string | null
}

interface NewsPayload {
  ok: true
  briefing: NewsItem[]
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
  fromCache?: boolean
}

type NewsResult = NewsPayload | { ok: false; error: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRetrieval(meta: ContextMeta): string {
  const date = meta.retrievedAt.slice(0, 10)
  return meta.asOf
    ? `🔍 검색 · ${meta.asOf} 기준 · ${date} 조회`
    : `🔍 검색 · ${date} 조회`
}

function fmtAsOf(ymd: string | null): string {
  if (!ymd) return ''
  const m = ymd.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ymd
  return `${Number(m[2])}월 ${Number(m[3])}일`
}

function groupByCategory(items: NewsItem[]): Map<string, NewsItem[]> {
  const map = new Map<string, NewsItem[]>()
  for (const cat of CATEGORY_ORDER) map.set(cat, [])
  for (const it of items) {
    const list = map.get(it.category) ?? []
    list.push(it)
    map.set(it.category, list)
  }
  return map
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewsPage() {
  const router = useRouter()
  const [data, setData] = useState<NewsPayload | null>(null)
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
      const res = await fetch('/api/domin/news', {
        signal: ctrl.signal,
        cache: 'no-store',
      })
      const json = (await res.json()) as NewsResult
      if (!json.ok) {
        setFetchError((json as { ok: false; error: string }).error)
        setData(null)
      } else {
        setData(json as NewsPayload)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setFetchError('소식을 불러오지 못했어요. 잠시 후 다시 해주세요.')
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

  const buildTts = useCallback((d: NewsPayload): string => {
    const parts: string[] = ['제주 오늘의 소식입니다.']
    for (const it of d.briefing) {
      parts.push(`${it.headline}. ${it.summary}`)
    }
    if (d.briefing.length === 0) parts.push('최근 소식이 없습니다.')
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

  const speakItem = useCallback((it: NewsItem) => {
    stopSpeaking()
    if (typeof window === 'undefined' || !ttsSupported) return
    try {
      const u = new SpeechSynthesisUtterance(`${it.headline}. ${it.summary}`)
      u.lang = 'ko-KR'; u.rate = 0.9
      window.speechSynthesis.speak(u)
    } catch { /* no-op */ }
  }, [ttsSupported, stopSpeaking])

  const grouped = data ? groupByCategory(data.briefing) : null
  const hasItems = (data?.briefing.length ?? 0) > 0

  return (
    <div style={S.root}>
      <style>{GLOBAL_CSS}</style>

      <div style={S.topBar}>
        <button type="button" className="rn-back" style={S.backBtn}
          onClick={() => { stopSpeaking(); router.push('/jeju/resident/general') }} aria-label="뒤로 가기">
          ← 뒤로
        </button>
        <h1 style={S.pageTitle}>📰 오늘의 소식</h1>
        <button type="button" className="rn-ctrl" style={S.refreshBtn}
          onClick={() => { stopSpeaking(); void fetchData() }}
          aria-label="새로 고침" disabled={loading}>
          {loading ? '⏳' : '🔄'}
        </button>
      </div>

      <div style={S.body}>
        {loading && (
          <div style={S.loadingBox} aria-live="polite" aria-busy="true">
            <span style={{ fontSize: 48 }} aria-hidden>⏳</span>
            <p style={S.loadingText}>제주 소식 불러오는 중…</p>
            <p style={S.loadingHint}>처음 불러올 때는 10~20초 걸릴 수 있어요</p>
          </div>
        )}

        {!loading && fetchError && (
          <div style={S.errorBox} role="alert">
            <p style={S.errorText}>⚠ {fetchError}</p>
            <button type="button" className="rn-ctrl" style={S.retryBtn}
              onClick={() => void fetchData()}>다시 시도</button>
          </div>
        )}

        {!loading && data && (
          <>
            {/* Freshness + cache hint */}
            <div style={S.metaBar}>
              <p style={S.freshness}>{data.freshnessNote}</p>
              {data.fromCache && (
                <span style={S.cacheBadge} aria-label="오늘 저장된 소식">오늘 정리본</span>
              )}
            </div>

            {!hasItems ? (
              <div style={S.card}>
                <p style={S.empty}>최근 3일 안에 제주 관련 소식이 없어요.</p>
              </div>
            ) : (
              CATEGORY_ORDER.map((cat) => {
                const items = grouped?.get(cat) ?? []
                if (items.length === 0) return null
                return (
                  <section key={cat} style={S.card} aria-label={`${cat} 소식`}>
                    <h2 style={S.categoryTitle}>{cat}</h2>
                    <div style={S.itemList}>
                      {items.map((it, i) => (
                        <article key={`${cat}-${i}`} style={S.item}>
                          <div style={S.itemHead}>
                            <h3 style={S.headline}>{it.headline}</h3>
                            {ttsSupported && (
                              <button type="button" className="rn-item-tts" style={S.itemTtsBtn}
                                onClick={() => speakItem(it)}
                                aria-label={`${it.headline} 읽어주기`}>
                                🔊
                              </button>
                            )}
                          </div>
                          <p style={S.summary}>{it.summary}</p>
                          {it.why && (
                            <p style={S.why}>
                              <span style={S.whyLabel}>왜 중요한가</span> {it.why}
                            </p>
                          )}
                          <div style={S.itemMeta}>
                            {it.source && <span style={S.sourceTag}>{it.source}</span>}
                            {it.asOf && <span style={S.dateTag}>{fmtAsOf(it.asOf)}</span>}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                )
              })
            )}

            {/* Provenance + TTS + source */}
            <div style={S.bottomRow}>
              {ttsSupported && hasItems && (
                <button type="button" className="rn-ctrl" style={S.ttsBtn}
                  onClick={onSpeak}
                  aria-label={speaking ? '읽기 중단' : '전체 읽어주기'}>
                  <span aria-hidden>{speaking ? '⏹' : '🔊'}</span>
                  {speaking ? ' 중단' : ' 전체 읽어주기'}
                </button>
              )}
              <p style={S.provenance}>{fmtRetrieval(data.contextMeta)}</p>
              <p style={S.sourceCredit}>자료: 🔍 검색 (제주 지역·전국지 제주 보도)</p>
            </div>

            {data.errors.length > 0 && (
              <details style={S.errDetails}>
                <summary style={S.errSummary}>⚠ 일부 처리 중 문제가 있었어요</summary>
                <ul style={S.errList}>
                  {data.errors.map((e, i) => <li key={i} style={S.errItem}>{e}</li>)}
                </ul>
              </details>
            )}
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
    fontSize: 26,
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
    gap: 10,
    padding: '48px 0',
  },
  loadingText: {
    fontSize: 22,
    fontWeight: 700,
    color: C.inkSoft,
    margin: 0,
  },
  loadingHint: {
    fontSize: 17,
    color: C.mutedInk,
    margin: 0,
  },
  errorBox: {
    background: '#FEF2F2',
    border: '2px solid #FCA5A5',
    borderRadius: 16,
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  errorText: {
    fontSize: 20,
    fontWeight: 700,
    color: '#B91C1C',
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
    alignSelf: 'flex-start',
  },
  metaBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  freshness: {
    fontSize: 17,
    fontWeight: 600,
    color: C.sea,
    margin: 0,
    background: '#D8ECF2',
    borderRadius: 10,
    padding: '6px 14px',
  },
  cacheBadge: {
    fontSize: 14,
    fontWeight: 700,
    color: C.mutedInk,
    background: C.mutedBg,
    border: `1.5px solid ${C.mutedBorder}`,
    borderRadius: 8,
    padding: '4px 10px',
  },
  card: {
    background: C.surface,
    border: `2px solid ${C.mutedBorder}`,
    borderRadius: 18,
    padding: '18px 16px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  categoryTitle: {
    fontSize: 22,
    fontWeight: 900,
    color: C.seaStrong,
    margin: 0,
    paddingBottom: 4,
    borderBottom: `2px solid ${C.mutedBorder}`,
  },
  itemList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    paddingBottom: 14,
    borderBottom: `1px solid ${C.mutedBg}`,
  },
  itemHead: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
  },
  headline: {
    flex: 1,
    fontSize: 21,
    fontWeight: 800,
    color: C.ink,
    margin: 0,
    lineHeight: 1.4,
    wordBreak: 'keep-all',
  },
  itemTtsBtn: {
    flexShrink: 0,
    width: 48,
    height: 48,
    fontSize: 22,
    color: C.sea,
    background: '#EAF4F8',
    border: `2px solid ${C.sea}`,
    borderRadius: 12,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summary: {
    fontSize: 19,
    lineHeight: 1.65,
    color: C.inkSoft,
    margin: 0,
    wordBreak: 'keep-all',
  },
  why: {
    fontSize: 17,
    lineHeight: 1.55,
    color: C.mutedInk,
    margin: 0,
    background: C.mutedBg,
    borderRadius: 10,
    padding: '10px 12px',
  },
  whyLabel: {
    fontWeight: 800,
    color: C.sea,
    marginRight: 6,
  },
  itemMeta: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  sourceTag: {
    fontSize: 14,
    fontWeight: 700,
    color: C.sea,
    background: '#EAF4F8',
    borderRadius: 8,
    padding: '3px 10px',
  },
  dateTag: {
    fontSize: 14,
    fontWeight: 600,
    color: C.mutedInk,
  },
  empty: {
    fontSize: 20,
    color: C.mutedInk,
    margin: 0,
    padding: '8px 0',
  },
  bottomRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
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
    alignSelf: 'flex-start',
  },
  provenance: {
    fontSize: 15,
    color: C.mutedInk,
    margin: 0,
    lineHeight: 1.5,
  },
  sourceCredit: {
    fontSize: 15,
    color: C.mutedInk,
    margin: 0,
    lineHeight: 1.5,
  },
  errDetails: {
    background: '#FFFBEB',
    border: '1.5px solid #FCD34D',
    borderRadius: 12,
    padding: '10px 14px',
  },
  errSummary: {
    fontSize: 16,
    fontWeight: 700,
    color: '#92400E',
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

const GLOBAL_CSS = `
  .rn-back:focus-visible, .rn-ctrl:focus-visible, .rn-item-tts:focus-visible {
    outline: 5px solid ${C.focus};
    outline-offset: 3px;
  }
  .rn-back:hover, .rn-ctrl:hover { background: #EAF4F8; }
  .rn-item-tts:hover { background: #DCEEF3; }
  .rn-back, .rn-ctrl, .rn-item-tts {
    transition: background 0.12s ease, transform 0.07s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .rn-back:active, .rn-ctrl:active, .rn-item-tts:active { transform: scale(0.97); }
  @media (prefers-reduced-motion: reduce) {
    .rn-back, .rn-ctrl, .rn-item-tts { transition: none !important; transform: none !important; }
  }
`
