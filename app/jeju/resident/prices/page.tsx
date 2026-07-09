'use client'

/**
 * 물가·생활 — Jeju resident daily prices chip.
 *
 * Data: GET /api/domin/prices
 * Layout: three groups (농산물 / 수산물 / 가공축산), each a compact item list,
 * followed by Perplexity 생활물가 요약 + provenance, freshness, source credit.
 * Styling: adult density (not senior-mode) — readable but more compact than
 * haenyeo/weather chips. Mirrors transport chip tone.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

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
  up: '#B91C1C',
  upBg: '#FEF2F2',
  down: '#1D4ED8',
  downBg: '#EFF6FF',
  neutral: '#374151',
}

// ── API types ─────────────────────────────────────────────────────────────────

interface PriceItem {
  itemName: string
  unit: string
  cls: string
  retailPrice: number | null
  dayAgo: number | null
  monthAgo: number | null
  yearAgo: number | null
  direction: 0 | 1 | null
  changePct: number | null
}

interface PriceGroups {
  농산물: PriceItem[]
  수산물: PriceItem[]
  가공축산: PriceItem[]
}

interface ContextMeta {
  source: string
  retrievedAt: string
  asOf: string | null
}

interface PricesPayload {
  ok: true
  source: 'kamis' | 'perplexity'
  confidence: 'high' | 'low'
  updated: string
  groups: PriceGroups
  context: string
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
}

type PricesResult = PricesPayload | { ok: false; error: string }

const GROUP_ORDER: (keyof PriceGroups)[] = ['농산물', '수산물', '가공축산']

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(n: number | null): string {
  if (n == null) return '—'
  return `${n.toLocaleString('ko-KR')}원`
}

function fmtRetrieval(meta: ContextMeta): string {
  const date = meta.retrievedAt.slice(0, 10)
  return meta.asOf
    ? `🔍 검색 · ${meta.asOf} 기준 · ${date} 조회`
    : `🔍 검색 · ${date} 조회`
}

// Strip unit sub-labels like "(냉장)(大)" for display — keep the main name
function shortName(full: string): string {
  return full.split('/')[0]?.trim() ?? full
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PricesPage() {
  const router = useRouter()
  const [data, setData] = useState<PricesPayload | null>(null)
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
      const res = await fetch('/api/domin/prices', { signal: ctrl.signal, cache: 'no-store' })
      const json = (await res.json()) as PricesResult
      if (!json.ok) {
        setFetchError((json as { ok: false; error: string }).error)
        setData(null)
      } else {
        setData(json as PricesPayload)
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
      setFetchError('물가 정보를 불러오지 못했어요.')
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

  const buildTts = useCallback((d: PricesPayload): string => {
    const parts: string[] = ['제주 생활물가 안내입니다.']
    for (const group of GROUP_ORDER) {
      const items = d.groups[group]
      if (!items?.length) continue
      parts.push(`${group} 시세입니다.`)
      for (const it of items.slice(0, 3)) {
        const dir = it.direction === 1 ? '올랐고' : it.direction === 0 ? '내렸고' : '변동 없고'
        parts.push(`${shortName(it.itemName)} ${it.unit} ${fmtPrice(it.retailPrice)}, ${dir}`)
      }
    }
    if (d.context) parts.push(`생활물가 요약: ${d.context}`)
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
    ? GROUP_ORDER.reduce((s, g) => s + (data.groups[g]?.length ?? 0), 0)
    : 0

  return (
    <div style={S.root}>
      <style>{GLOBAL_CSS}</style>

      {/* Top bar */}
      <div style={S.topBar}>
        <button type="button" className="rp-back" style={S.backBtn}
          onClick={() => { stopSpeaking(); router.back() }} aria-label="뒤로 가기">
          ← 뒤로
        </button>
        <h1 style={S.pageTitle}>💰 물가·생활</h1>
        <button type="button" className="rp-ctrl" style={S.refreshBtn}
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
            <p style={S.loadingText}>시세 불러오는 중…</p>
          </div>
        )}

        {/* Error */}
        {!loading && fetchError && (
          <div style={S.errorBox} role="alert">
            <p style={S.errorText}>⚠ {fetchError}</p>
            <button type="button" className="rp-ctrl" style={S.retryBtn}
              onClick={() => void fetchData()}>다시 시도</button>
          </div>
        )}

        {/* Main content */}
        {!loading && data && (
          <>
            {/* Meta bar */}
            <div style={S.metaBar}>
              <span style={S.metaBadge}>{data.updated} 기준</span>
              <span style={S.metaBadge}>{totalItems}개 품목</span>
              {data.source === 'perplexity' && (
                <span style={{ ...S.metaBadge, ...S.lowConfBadge }}>참고용 (추정치)</span>
              )}
            </div>

            {/* Three groups */}
            {GROUP_ORDER.map((group) => {
              const items = data.groups[group] ?? []
              return (
                <section key={group} style={S.card} aria-label={`${group} 시세`}>
                  <h2 style={S.groupTitle}>{group}</h2>
                  {items.length === 0 ? (
                    <p style={S.empty}>정보 없음</p>
                  ) : (
                    <div style={S.itemList} role="list">
                      {items.map((it, i) => {
                        const isUp = it.direction === 1
                        const isDown = it.direction === 0
                        return (
                          <div key={i} role="listitem" style={S.itemRow}>
                            <div style={S.itemLeft}>
                              <span style={S.itemName}>{shortName(it.itemName)}</span>
                              <span style={S.itemUnit}>{it.unit}</span>
                            </div>
                            <span style={S.itemPrice}>{fmtPrice(it.retailPrice)}</span>
                            {(isUp || isDown) ? (
                              <span style={{
                                ...S.changeBadge,
                                background: isUp ? C.upBg : C.downBg,
                                color: isUp ? C.up : C.down,
                              }}>
                                {isUp ? '▲' : '▼'}
                                {it.changePct != null
                                  ? ` ${Math.abs(it.changePct)}%`
                                  : ''}
                              </span>
                            ) : (
                              <span style={{ ...S.changeBadge, background: C.mutedBg, color: C.mutedInk }}>─</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
              )
            })}

            {/* Perplexity context */}
            {data.context && (
              <section style={S.card} aria-label="생활물가 요약">
                <h2 style={S.groupTitle}>📋 생활물가 요약</h2>
                <p style={S.contextText}>{data.context}</p>
                <p style={S.provenance}>{fmtRetrieval(data.contextMeta)}</p>
              </section>
            )}

            {/* Bottom row — TTS + freshness + source */}
            <div style={S.bottomRow}>
              {ttsSupported && (
                <button type="button" className="rp-ctrl" style={S.ttsBtn}
                  onClick={onSpeak}
                  aria-label={speaking ? '읽기 중단' : '읽어주기'}>
                  {speaking ? '⏹ 중단' : '🔊 읽어주기'}
                </button>
              )}
              <p style={S.freshnessNote}>{data.freshnessNote}</p>
              <p style={S.sourceCredit}>자료: KAMIS(농수산물유통정보) + 🔍 검색</p>
            </div>

            {/* Non-fatal errors */}
            {data.errors.length > 0 && (
              <details style={S.errDetails}>
                <summary style={S.errSummary}>⚠ 일부 정보를 불러오지 못했어요</summary>
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
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  errorText: { fontSize: 17, fontWeight: 700, color: C.up, margin: 0 },
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
  // Meta bar
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
  lowConfBadge: {
    color: '#92400E',
    background: '#FEF3C7',
  },
  // Card wrapper (groups)
  card: {
    background: C.surface,
    border: `1.5px solid ${C.mutedBorder}`,
    borderRadius: 16,
    padding: '14px 14px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  groupTitle: {
    fontSize: 18,
    fontWeight: 900,
    color: C.seaStrong,
    margin: 0,
    paddingBottom: 6,
    borderBottom: `1.5px solid ${C.mutedBorder}`,
  },
  itemList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  itemRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
    padding: '4px 2px',
    borderBottom: `1px solid ${C.mutedBg}`,
  },
  itemLeft: {
    flex: 1,
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    overflow: 'hidden',
  },
  itemName: {
    fontSize: 16,
    fontWeight: 700,
    color: C.ink,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 160,
  },
  itemUnit: {
    fontSize: 12,
    color: C.mutedInk,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  itemPrice: {
    fontSize: 17,
    fontWeight: 800,
    color: C.ink,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    minWidth: 80,
    textAlign: 'right',
  },
  changeBadge: {
    fontSize: 13,
    fontWeight: 700,
    borderRadius: 6,
    padding: '2px 8px',
    whiteSpace: 'nowrap',
    minWidth: 56,
    textAlign: 'center',
    flexShrink: 0,
  },
  empty: { fontSize: 16, color: C.mutedInk, margin: 0 },
  // Context / provenance
  contextText: {
    fontSize: 16,
    lineHeight: 1.7,
    color: C.inkSoft,
    margin: 0,
  },
  provenance: {
    fontSize: 13,
    color: C.mutedInk,
    margin: '2px 0 0',
    lineHeight: 1.5,
  },
  // Bottom row
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
  // Errors
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
  .rp-back:focus-visible, .rp-ctrl:focus-visible {
    outline: 4px solid ${C.focus};
    outline-offset: 3px;
  }
  .rp-back:hover, .rp-ctrl:hover { background: #EAF4F8; }
  .rp-back, .rp-ctrl {
    transition: background 0.12s ease, transform 0.07s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .rp-back:active, .rp-ctrl:active { transform: scale(0.97); }
  @media (prefers-reduced-motion: reduce) {
    .rp-back, .rp-ctrl { transition: none !important; transform: none !important; }
  }
`
