'use client'

/**
 * 오늘의 소식 — daily elderly-friendly news for the 동반자 (care) app.
 *
 * Loads the cached/generated news from /api/care/news, then presents
 * it for LISTENING first: a big "전체 읽어주기" reads the whole broadcast in
 * order (national by section, then regional), plus per-item 🔊 buttons.
 *
 * Accessibility: large text (≥20/24/32), high contrast, TTS ko-KR with
 * cancel-before-speak, reduced-motion (via ResidentLoading), focus-visible,
 * persistent 처음으로 bar. No localStorage.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ResidentLoading } from '@/app/care/_components/Loading'
import { getResidence, DEFAULT_RESIDENCE } from '@/lib/care/residence'

const C = {
  bg: '#E8F2F5',
  surface: '#FFFFFF',
  ink: '#0F2233',
  inkSoft: '#33475B',
  sea: '#0A5C7A',
  seaStrong: '#07445B',
  focus: '#C2410C',
  muted: '#6B7A88',
  warnBg: '#FDECEC',
  warnBorder: '#C0392B',
  warnInk: '#8A241A',
}

const SECTION_ORDER = ['정치', '경제', '사회', '국제', '문화·예술', '스포츠'] as const
type SectionName = (typeof SECTION_ORDER)[number]

interface NationalItem {
  section: SectionName
  title: string
  summary: string
}
interface RegionNewsItem {
  title: string
  summary: string
}
interface NewsData {
  error: boolean
  message?: string
  freshLabel?: string
  /** Region label for the local section, e.g. "서울특별시 종로구". */
  regionLabel?: string
  national?: NationalItem[]
  /** Regional ("우리 지역") news bucket. */
  region_news?: RegionNewsItem[]
  sources?: string[]
  generated_at?: string | null
}

export default function NewsPage() {
  const router = useRouter()

  const [data, setData] = useState<NewsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [ttsSupported, setTtsSupported] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const queueRef = useRef<string[]>([])

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) setTtsSupported(true)
  }, [])

  // ── Fetch news ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    setData(null)
    try {
      const r = getResidence() ?? DEFAULT_RESIDENCE
      const qs = new URLSearchParams({ sido: r.sido, sigungu: r.sigungu, sidoCode: r.sidoCode })
      const res = await fetch(`/api/care/news?${qs.toString()}`, { method: 'GET' })
      const json = (await res.json()) as NewsData
      setData(json)
    } catch {
      setData({ error: true, message: '지금은 소식을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // ── TTS ────────────────────────────────────────────────────────────────────

  const stopSpeaking = useCallback(() => {
    queueRef.current = []
    setSpeaking(false)
    if (ttsSupported && typeof window !== 'undefined') {
      try { window.speechSynthesis.cancel() } catch { /* no-op */ }
    }
  }, [ttsSupported])

  useEffect(() => () => stopSpeaking(), [stopSpeaking])

  // Speak a single line (cancels anything in progress).
  const speakOne = useCallback(
    (text: string) => {
      if (!ttsSupported || typeof window === 'undefined' || !text) return
      stopSpeaking()
      try {
        const u = new SpeechSynthesisUtterance(text)
        u.lang = 'ko-KR'
        u.rate = 0.92
        window.speechSynthesis.speak(u)
      } catch {
        /* no-op */
      }
    },
    [ttsSupported, stopSpeaking]
  )

  // Speak a whole queue in order (radio broadcast).
  const speakQueue = useCallback(
    (lines: string[]) => {
      if (!ttsSupported || typeof window === 'undefined' || lines.length === 0) return
      stopSpeaking()
      queueRef.current = [...lines]
      setSpeaking(true)

      const speakNext = () => {
        const next = queueRef.current.shift()
        if (next === undefined) {
          setSpeaking(false)
          return
        }
        try {
          const u = new SpeechSynthesisUtterance(next)
          u.lang = 'ko-KR'
          u.rate = 0.92
          // onend advances the queue; when stopSpeaking empties it, this ends.
          u.onend = () => speakNext()
          u.onerror = () => setSpeaking(false)
          window.speechSynthesis.speak(u)
        } catch {
          setSpeaking(false)
        }
      }
      speakNext()
    },
    [ttsSupported, stopSpeaking]
  )

  // Build the full broadcast script in reading order.
  const buildFullScript = useCallback((d: NewsData): string[] => {
    const lines: string[] = []
    lines.push(`오늘의 소식입니다. ${d.freshLabel ?? ''}`)
    const national = d.national ?? []
    if (national.length > 0) {
      lines.push('먼저 전국 소식입니다.')
      for (const section of SECTION_ORDER) {
        const items = national.filter((it) => it.section === section)
        if (items.length === 0) continue
        lines.push(`${section} 소식입니다.`)
        items.forEach((it) => lines.push(`${it.title}. ${it.summary}`))
      }
    }
    const regionNews = d.region_news ?? []
    if (regionNews.length > 0) {
      lines.push(`다음은 ${d.regionLabel ?? '우리 지역'} 소식입니다.`)
      regionNews.forEach((it) => lines.push(`${it.title}. ${it.summary}`))
    }
    lines.push('오늘의 소식을 마칩니다.')
    return lines.filter((l) => l.trim().length > 0)
  }, [])

  const goHome = useCallback(() => {
    stopSpeaking()
    router.push('/care')
  }, [router, stopSpeaking])

  // ── Render ────────────────────────────────────────────────────────────────

  const national = data?.national ?? []
  const regionNews = data?.region_news ?? []
  const regionNewsLabel = data?.regionLabel ?? '우리 지역'
  const hasContent = !data?.error && (national.length > 0 || regionNews.length > 0)

  return (
    <div style={styles.root}>
      <style>{GLOBAL_CSS}</style>

      <main style={styles.frame}>
        {/* Persistent top bar */}
        <div style={styles.topBar}>
          <button type="button" className="nw-ctrl" style={styles.ctrlBtn} onClick={goHome} aria-label="처음으로 돌아가기">
            <span aria-hidden>↩</span> 처음으로
          </button>
          {speaking && (
            <button type="button" className="nw-ctrl" style={{ ...styles.ctrlBtn, borderColor: C.warnBorder, color: C.warnInk }} onClick={stopSpeaking} aria-label="읽기 멈추기">
              <span aria-hidden>⏹</span> 그만 읽기
            </button>
          )}
        </div>

        <header style={styles.header}>
          <span style={styles.headerEmoji} aria-hidden>📰</span>
          <h1 style={styles.h1}>오늘의 소식</h1>
          {data?.freshLabel && !data.error && <p style={styles.fresh}>{data.freshLabel}</p>}
        </header>

        {/* Loading (generation only; cache hits return fast) */}
        {loading && (
          <ResidentLoading
            steps={['오늘 소식을 모으고 있어요', '쉬운 말로 정리하고 있어요']}
            ttsSupported={ttsSupported}
          />
        )}

        {/* Error */}
        {!loading && data?.error && (
          <section style={styles.errorCard}>
            <span style={styles.errorEmoji} aria-hidden>😥</span>
            <p style={styles.errorText}>{data.message ?? '지금은 소식을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'}</p>
            <div style={styles.errorBtnRow}>
              <button type="button" className="nw-primary" style={styles.primaryBtn} onClick={load}>
                <span aria-hidden>🔄</span> 다시 시도
              </button>
              {ttsSupported && (
                <button type="button" className="nw-read" style={styles.readBtn} onClick={() => speakOne(data.message ?? '지금은 소식을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')}>
                  <span aria-hidden>🔊</span> 읽어주기
                </button>
              )}
            </div>
          </section>
        )}

        {/* Content */}
        {!loading && hasContent && (
          <>
            {/* Primary: read the whole broadcast */}
            {ttsSupported && (
              <button
                type="button"
                className="nw-readall"
                style={styles.readAllBtn}
                onClick={() => (speaking ? stopSpeaking() : data && speakQueue(buildFullScript(data)))}
                aria-label={speaking ? '읽기 멈추기' : '오늘 소식 전체 읽어주기'}
              >
                <span aria-hidden>{speaking ? '⏹' : '🔊'}</span>
                {speaking ? ' 그만 읽기' : ' 전체 읽어주기'}
              </button>
            )}

            {/* 전국 소식 */}
            {national.length > 0 && (
              <section style={styles.sectionWrap} aria-label="전국 소식">
                <h2 style={styles.sectionHeading}>전국 소식</h2>
                {SECTION_ORDER.map((section) => {
                  const items = national.filter((it) => it.section === section)
                  if (items.length === 0) return null
                  return (
                    <div key={section} style={styles.groupWrap}>
                      <h3 style={styles.groupLabel}>{section}</h3>
                      {items.map((it, i) => (
                        <article key={`${section}-${i}`} style={styles.newsCard}>
                          <div style={styles.newsCardHead}>
                            <h4 style={styles.newsTitle}>{it.title}</h4>
                            {ttsSupported && (
                              <button
                                type="button"
                                className="nw-item-read"
                                style={styles.itemReadBtn}
                                onClick={() => speakOne(`${it.title}. ${it.summary}`)}
                                aria-label={`${it.title} 읽어주기`}
                              >
                                <span aria-hidden>🔊</span>
                              </button>
                            )}
                          </div>
                          <p style={styles.newsSummary}>{it.summary}</p>
                        </article>
                      ))}
                    </div>
                  )
                })}
              </section>
            )}

            {/* 우리 지역 소식 */}
            {regionNews.length > 0 && (
              <section style={styles.sectionWrap} aria-label={`${regionNewsLabel} 소식`}>
                <h2 style={{ ...styles.sectionHeading, color: C.seaStrong }}>{regionNewsLabel} 소식</h2>
                {regionNews.map((it, i) => (
                  <article key={`region-${i}`} style={{ ...styles.newsCard, borderColor: C.sea }}>
                    <div style={styles.newsCardHead}>
                      <h4 style={styles.newsTitle}>{it.title}</h4>
                      {ttsSupported && (
                        <button
                          type="button"
                          className="nw-item-read"
                          style={styles.itemReadBtn}
                          onClick={() => speakOne(`${it.title}. ${it.summary}`)}
                          aria-label={`${it.title} 읽어주기`}
                        >
                          <span aria-hidden>🔊</span>
                        </button>
                      )}
                    </div>
                    <p style={styles.newsSummary}>{it.summary}</p>
                  </article>
                ))}
              </section>
            )}

            {/* Sources */}
            {(data?.sources ?? []).length > 0 && (
              <div style={styles.sourceWrap}>
                <button
                  type="button"
                  className="nw-source-toggle"
                  style={styles.sourceToggle}
                  onClick={() => setSourcesOpen((o) => !o)}
                  aria-expanded={sourcesOpen}
                >
                  {sourcesOpen ? '▲ 소식 출처 닫기' : '이 소식은 어디서 왔나요? ▾'}
                </button>
                {sourcesOpen && (
                  <div style={styles.sourceList}>
                    {(data?.sources ?? []).slice(0, 12).map((s, i) => (
                      <a key={i} href={s} target="_blank" rel="noopener noreferrer" style={styles.sourceLink}>
                        {s}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            <p style={styles.footNote}>소식은 하루 두 번, 오전과 저녁에 새로 정리해 드려요.</p>
          </>
        )}
      </main>
    </div>
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
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  headerEmoji: { fontSize: 46, lineHeight: 1 },
  h1: { fontSize: 34, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.25 },
  fresh: {
    fontSize: 20, fontWeight: 700, color: C.sea, margin: 0, textAlign: 'center',
    background: '#D8ECF2', borderRadius: 10, padding: '6px 16px',
  },
  // read-all
  readAllBtn: {
    width: '100%', minHeight: 84, fontSize: 30, fontWeight: 900, color: '#FFFFFF', background: C.sea,
    border: 'none', borderRadius: 18, cursor: 'pointer', padding: '12px 20px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    boxShadow: '0 6px 20px rgba(10,92,122,0.28)',
  },
  // sections
  sectionWrap: { display: 'flex', flexDirection: 'column', gap: 14 },
  sectionHeading: { fontSize: 28, fontWeight: 900, color: C.ink, margin: '4px 0 0' },
  groupWrap: { display: 'flex', flexDirection: 'column', gap: 10 },
  groupLabel: {
    fontSize: 22, fontWeight: 900, color: '#FFFFFF', background: C.sea,
    borderRadius: 10, padding: '6px 16px', margin: '6px 0 2px', alignSelf: 'flex-start',
  },
  newsCard: {
    display: 'block', background: C.surface, border: `2px solid #CBD9E1`, borderRadius: 16,
    padding: '18px 18px', boxShadow: '0 3px 12px rgba(15,34,51,0.06)',
  },
  newsCardHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  newsTitle: { fontSize: 25, fontWeight: 900, color: C.ink, lineHeight: 1.35, margin: 0, wordBreak: 'keep-all', flex: 1 },
  itemReadBtn: {
    flexShrink: 0, width: 56, height: 56, fontSize: 24, color: C.sea, background: '#EAF4F8',
    border: `2px solid ${C.sea}`, borderRadius: 12, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  newsSummary: { fontSize: 21, lineHeight: 1.6, color: C.inkSoft, margin: '10px 0 0', wordBreak: 'keep-all' },
  // sources
  sourceWrap: { display: 'flex', flexDirection: 'column', gap: 0 },
  sourceToggle: {
    alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 18, fontWeight: 700, color: C.muted, padding: '8px 4px',
    textDecoration: 'underline', textUnderlineOffset: 3,
  },
  sourceList: {
    display: 'flex', flexDirection: 'column', gap: 6,
    background: '#F0F5F8', borderRadius: 12, padding: '14px 16px', marginTop: 6,
  },
  sourceLink: { fontSize: 16, color: C.sea, wordBreak: 'break-all', lineHeight: 1.5 },
  footNote: { fontSize: 18, color: C.muted, textAlign: 'center', margin: 0, lineHeight: 1.5 },
  // primary / read buttons (error card)
  primaryBtn: {
    minHeight: 72, fontSize: 24, fontWeight: 800, color: '#FFFFFF', background: C.sea,
    border: 'none', borderRadius: 16, cursor: 'pointer', padding: '12px 24px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  readBtn: {
    minHeight: 72, fontSize: 22, fontWeight: 700, color: C.sea, background: '#FFFFFF',
    border: `3px solid ${C.sea}`, borderRadius: 14, cursor: 'pointer', padding: '10px 24px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  // error card
  errorCard: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
    background: C.warnBg, border: `3px solid ${C.warnBorder}`, borderRadius: 20, padding: '28px 22px',
  },
  errorEmoji: { fontSize: 54, lineHeight: 1 },
  errorText: { fontSize: 24, fontWeight: 800, color: C.warnInk, textAlign: 'center', lineHeight: 1.5, margin: 0 },
  errorBtnRow: { display: 'flex', flexDirection: 'column', gap: 12, width: '100%', alignItems: 'stretch' },
}

const GLOBAL_CSS = `
  .nw-ctrl:focus-visible, .nw-readall:focus-visible, .nw-read:focus-visible,
  .nw-primary:focus-visible, .nw-item-read:focus-visible, .nw-source-toggle:focus-visible {
    outline: 5px solid ${C.focus}; outline-offset: 3px;
  }
  .nw-readall:hover, .nw-primary:hover { background: ${C.seaStrong}; }
  .nw-item-read:hover { background: #DCEEF3; }
  .nw-ctrl, .nw-readall, .nw-read, .nw-primary, .nw-item-read {
    transition: transform 0.08s ease, background 0.15s ease; -webkit-tap-highlight-color: transparent;
  }
  .nw-readall:active, .nw-primary:active, .nw-item-read:active, .nw-ctrl:active { transform: scale(0.98); }
  @media (prefers-reduced-motion: reduce) {
    .nw-ctrl, .nw-readall, .nw-read, .nw-primary, .nw-item-read {
      transition: none !important; transform: none !important;
    }
  }
`
