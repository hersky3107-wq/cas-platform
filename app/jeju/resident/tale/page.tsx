'use client'

/**
 * 이야기(TALE) — listen-first daily content for Jeju resident senior mode.
 *
 * INDEPENDENT of the care app: fetches /api/jeju/resident/tale (caches in
 * jeju_resident_tale), imports nothing from app/care/** or lib/care/**.
 *
 * A home with 5 big cards → tap one → its items load (cached instantly, or
 * generated once/day). Everything is meant to be LISTENED to:
 *   📖 인생 이야기        life stories   — per-story 🔊 + 전체 읽어주기
 *   🌿 오늘의 건강 이야기  health talk    — per-tip 🔊 + 전체 읽어주기
 *   💭 그 시절 회상        reminiscence   — per-topic 🔊 (intro + questions)
 *   🌸 오늘의 좋은 말      words of wisdom— per-line 🔊
 *   🌊 제주 이야기         Jeju stories   — per-story 🔊 + 전체 읽어주기
 *
 * Accessibility: large text (≥20/24/32), high contrast, TTS ko-KR with the best
 * available Korean voice (reused from the companion), cancel-before-speak,
 * reduced-motion (via ResidentLoading), focus-visible, persistent 처음으로 bar.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ResidentLoading } from '@/app/jeju/resident/_components/Loading'

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

// ── Kinds ────────────────────────────────────────────────────────────────────

type Kind = 'life' | 'health' | 'reminisce' | 'wisdom' | 'jeju'

interface KindMeta {
  kind: Kind
  emoji: string
  label: string
  sub: string
  /** card + accent color */
  color: string
  colorStrong: string
  bg: string
  /** whether this kind offers a "전체 읽어주기" (life / health / jeju) */
  readAll: boolean
}

const KIND_META: KindMeta[] = [
  { kind: 'life', emoji: '📖', label: '인생 이야기', sub: '내 얘기 같은 짧은 이야기', color: '#8A4B2B', colorStrong: '#6E3A20', bg: '#FBEFE6', readAll: true },
  { kind: 'health', emoji: '🌿', label: '오늘의 건강 이야기', sub: '뭐가 어디에 좋은지', color: '#2F6B4F', colorStrong: '#245640', bg: '#E9F5EE', readAll: true },
  { kind: 'reminisce', emoji: '💭', label: '그 시절 회상', sub: '옛날 그 시절을 떠올려요', color: '#7A5B0A', colorStrong: '#634A08', bg: '#FBF3DE', readAll: false },
  { kind: 'wisdom', emoji: '🌸', label: '오늘의 좋은 말', sub: '하루에 힘이 되는 말', color: '#9A3E63', colorStrong: '#7C314F', bg: '#FBEAF1', readAll: false },
  { kind: 'jeju', emoji: '🌊', label: '제주 이야기', sub: '설화·역사·우리 섬 삶', color: '#0A5C7A', colorStrong: '#07445B', bg: '#E4F1F6', readAll: true },
]

function metaOf(kind: Kind): KindMeta {
  return KIND_META.find((m) => m.kind === kind) ?? KIND_META[0]!
}

interface TaleItem {
  title?: string
  body?: string
  questions?: string[]
  text?: string
  source?: string
  note?: string
}

interface TaleData {
  error: boolean
  message?: string
  kind?: Kind
  items?: TaleItem[]
  generated_at?: string | null
}

// ── Component ────────────────────────────────────────────────────────────────

export default function JejuResidentTalePage() {
  const router = useRouter()

  const [active, setActive] = useState<Kind | null>(null)
  const [data, setData] = useState<TaleData | null>(null)
  const [loading, setLoading] = useState(false)

  const [ttsSupported, setTtsSupported] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const queueRef = useRef<string[]>([])
  const koVoiceRef = useRef<SpeechSynthesisVoice | null>(null)

  // ── Best Korean TTS voice (same selection as the companion) ────────────────
  const pickKoVoice = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const voices = window.speechSynthesis.getVoices()
    const ko = voices.filter((v) => v.lang.startsWith('ko'))
    if (ko.length === 0) { koVoiceRef.current = null; return }
    const PREF = ['neural', 'natural', 'google', 'microsoft', 'yuna', 'heami']
    let best: SpeechSynthesisVoice = ko[0]!
    let bestScore = -1
    for (const v of ko) {
      const name = v.name.toLowerCase()
      let score = 0
      PREF.forEach((kw, i) => { if (name.includes(kw)) score = Math.max(score, PREF.length - i) })
      if (score > bestScore) { bestScore = score; best = v }
    }
    koVoiceRef.current = best
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setTtsSupported(true)
      pickKoVoice()
      window.speechSynthesis.onvoiceschanged = pickKoVoice
    }
  }, [pickKoVoice])

  // ── TTS ────────────────────────────────────────────────────────────────────

  const stopSpeaking = useCallback(() => {
    queueRef.current = []
    setSpeaking(false)
    if (ttsSupported && typeof window !== 'undefined') {
      try { window.speechSynthesis.cancel() } catch { /* no-op */ }
    }
  }, [ttsSupported])

  useEffect(() => () => stopSpeaking(), [stopSpeaking])

  const makeUtter = useCallback((text: string) => {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ko-KR'
    if (koVoiceRef.current) u.voice = koVoiceRef.current
    u.rate = 0.92
    u.pitch = 1.0
    u.volume = 1.0
    return u
  }, [])

  /** Speak one line (cancels anything in progress). */
  const speakOne = useCallback(
    (text: string) => {
      if (!ttsSupported || typeof window === 'undefined' || !text) return
      stopSpeaking()
      try {
        window.speechSynthesis.speak(makeUtter(text))
      } catch {
        /* no-op */
      }
    },
    [ttsSupported, stopSpeaking, makeUtter]
  )

  /** Speak a queue of lines in order (radio broadcast). */
  const speakQueue = useCallback(
    (lines: string[]) => {
      const clean = lines.filter((l) => l && l.trim().length > 0)
      if (!ttsSupported || typeof window === 'undefined' || clean.length === 0) return
      stopSpeaking()
      queueRef.current = [...clean]
      setSpeaking(true)
      const speakNext = () => {
        const next = queueRef.current.shift()
        if (next === undefined) {
          setSpeaking(false)
          return
        }
        try {
          const u = makeUtter(next)
          u.onend = () => speakNext()
          u.onerror = () => setSpeaking(false)
          window.speechSynthesis.speak(u)
        } catch {
          setSpeaking(false)
        }
      }
      speakNext()
    },
    [ttsSupported, stopSpeaking, makeUtter]
  )

  // ── Fetch a kind ─────────────────────────────────────────────────────────────

  const openKind = useCallback(
    async (kind: Kind) => {
      stopSpeaking()
      setActive(kind)
      setData(null)
      setLoading(true)
      try {
        const res = await fetch(`/api/jeju/resident/tale?kind=${kind}`, { method: 'GET' })
        const json = (await res.json()) as TaleData
        setData(json)
      } catch {
        setData({ error: true, message: '지금은 이야기를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' })
      } finally {
        setLoading(false)
      }
    },
    [stopSpeaking]
  )

  const backToList = useCallback(() => {
    stopSpeaking()
    setActive(null)
    setData(null)
  }, [stopSpeaking])

  const goHome = useCallback(() => {
    stopSpeaking()
    router.push('/jeju/resident/senior')
  }, [router, stopSpeaking])

  // ── Read-aloud script builders ─────────────────────────────────────────────

  const readItem = useCallback((kind: Kind, it: TaleItem) => {
    if (kind === 'wisdom') {
      speakOne([it.text, it.source ? `${it.source}의 말이에요.` : ''].filter(Boolean).join(' '))
      return
    }
    if (kind === 'reminisce') {
      speakQueue([it.title ? `${it.title}.` : '', it.body ?? '', ...(it.questions ?? [])])
      return
    }
    // life / health / jeju
    speakQueue([it.title ? `${it.title}.` : '', ...(it.body ?? '').split('\n'), it.note ?? ''])
  }, [speakOne, speakQueue])

  const readAll = useCallback((kind: Kind, items: TaleItem[]) => {
    const m = metaOf(kind)
    const lines: string[] = [`${m.label}입니다.`]
    items.forEach((it) => {
      if (it.title) lines.push(`${it.title}.`)
      if (it.body) lines.push(...it.body.split('\n'))
      if (it.note) lines.push(it.note)
    })
    lines.push(`${m.label}를 마칩니다.`)
    speakQueue(lines)
  }, [speakQueue])

  // ── Render ────────────────────────────────────────────────────────────────

  const meta = active ? metaOf(active) : null
  const items = data?.items ?? []
  const hasContent = !data?.error && items.length > 0

  return (
    <div style={styles.root}>
      <style>{GLOBAL_CSS}</style>

      <main style={styles.frame}>
        {/* Persistent top bar */}
        <div style={styles.topBar}>
          <button
            type="button"
            className="tl-ctrl"
            style={styles.ctrlBtn}
            onClick={active ? backToList : goHome}
            aria-label={active ? '이야기 목록으로 돌아가기' : '처음으로 돌아가기'}
          >
            <span aria-hidden>↩</span> {active ? '이야기 목록' : '처음으로'}
          </button>
          {speaking && (
            <button
              type="button"
              className="tl-ctrl"
              style={{ ...styles.ctrlBtn, borderColor: C.warnBorder, color: C.warnInk }}
              onClick={stopSpeaking}
              aria-label="읽기 멈추기"
            >
              <span aria-hidden>⏹</span> 그만 읽기
            </button>
          )}
        </div>

        {/* ── HOME — 5 kind cards ─────────────────────────────────────────── */}
        {!active && (
          <>
            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>📖</span>
              <h1 style={styles.h1}>이야기 · 좋은 말</h1>
              <p style={styles.lead}>듣고 싶은 이야기를 골라보세요.</p>
            </header>

            <div style={styles.cardCol} role="list">
              {KIND_META.map((m) => (
                <button
                  key={m.kind}
                  type="button"
                  role="listitem"
                  className="tl-card"
                  style={{ ...styles.kindCard, background: m.bg, borderColor: m.color }}
                  onClick={() => openKind(m.kind)}
                  aria-label={`${m.label} — ${m.sub}`}
                >
                  <span style={styles.kindEmoji} aria-hidden>{m.emoji}</span>
                  <span style={styles.kindTextWrap}>
                    <span style={{ ...styles.kindLabel, color: m.colorStrong }}>{m.label}</span>
                    <span style={styles.kindSub}>{m.sub}</span>
                  </span>
                  <span style={{ ...styles.kindArrow, color: m.color }} aria-hidden>→</span>
                </button>
              ))}
            </div>

            <p style={styles.footNote}>이야기는 하루에 한 번 새로워져요.</p>
          </>
        )}

        {/* ── DETAIL — items for the active kind ──────────────────────────── */}
        {active && meta && (
          <>
            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>{meta.emoji}</span>
              <h1 style={{ ...styles.h1, color: meta.colorStrong }}>{meta.label}</h1>
              <p style={styles.lead}>{meta.sub}</p>
            </header>

            {loading && (
              <ResidentLoading
                steps={['이야기를 준비하고 있어요', '정성껏 쓰고 있어요']}
                ttsSupported={ttsSupported}
              />
            )}

            {!loading && data?.error && (
              <section style={styles.errorCard}>
                <span style={styles.errorEmoji} aria-hidden>😥</span>
                <p style={styles.errorText}>{data.message ?? '지금은 이야기를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'}</p>
                <button type="button" className="tl-primary" style={styles.primaryBtn} onClick={() => openKind(active)}>
                  <span aria-hidden>🔄</span> 다시 시도
                </button>
              </section>
            )}

            {!loading && hasContent && (
              <>
                {/* 전체 읽어주기 — life & health & jeju */}
                {meta.readAll && ttsSupported && (
                  <button
                    type="button"
                    className="tl-readall"
                    style={{ ...styles.readAllBtn, background: meta.color }}
                    onClick={() => (speaking ? stopSpeaking() : readAll(active, items))}
                    aria-label={speaking ? '읽기 멈추기' : `${meta.label} 전체 읽어주기`}
                  >
                    <span aria-hidden>{speaking ? '⏹' : '🔊'}</span>
                    {speaking ? ' 그만 읽기' : ' 전체 읽어주기'}
                  </button>
                )}

                {items.map((it, i) => (
                  <TaleCard
                    key={i}
                    kind={active}
                    item={it}
                    meta={meta}
                    ttsSupported={ttsSupported}
                    onRead={() => readItem(active, it)}
                  />
                ))}

                <p style={styles.footNote}>
                  {active === 'health'
                    ? '건강 정보는 참고용이에요. 아프시면 병원·약국에 꼭 상담하세요.'
                    : '이야기는 하루에 한 번 새로워져요.'}
                </p>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}

// ── Item card ────────────────────────────────────────────────────────────────

function TaleCard({
  kind,
  item,
  meta,
  ttsSupported,
  onRead,
}: {
  kind: Kind
  item: TaleItem
  meta: KindMeta
  ttsSupported: boolean
  onRead: () => void
}) {
  // Wisdom — quote card, centered
  if (kind === 'wisdom') {
    return (
      <article style={{ ...styles.card, borderColor: meta.color, background: meta.bg }}>
        <p style={styles.wisdomText}>“{item.text}”</p>
        {item.source && <p style={styles.wisdomSource}>— {item.source}</p>}
        {ttsSupported && (
          <button type="button" className="tl-item-read" style={{ ...styles.itemReadWide, color: meta.color, borderColor: meta.color }} onClick={onRead} aria-label="이 좋은 말 읽어주기">
            <span aria-hidden>🔊</span> 읽어주기
          </button>
        )}
      </article>
    )
  }

  // Life / health / reminisce / jeju — title + body (+ questions / note)
  const paras = (item.body ?? '').split('\n').filter((p) => p.trim().length > 0)
  return (
    <article style={{ ...styles.card, borderColor: meta.color }}>
      <div style={styles.cardHead}>
        <h2 style={{ ...styles.cardTitle, color: meta.colorStrong }}>{item.title}</h2>
        {ttsSupported && (
          <button
            type="button"
            className="tl-item-read"
            style={{ ...styles.itemReadBtn, color: meta.color, borderColor: meta.color }}
            onClick={onRead}
            aria-label={`${item.title ?? ''} 읽어주기`}
          >
            <span aria-hidden>🔊</span>
          </button>
        )}
      </div>

      {paras.map((p, i) => (
        <p key={i} style={styles.bodyText}>{p}</p>
      ))}

      {/* reminisce questions */}
      {kind === 'reminisce' && (item.questions?.length ?? 0) > 0 && (
        <ul style={styles.qList}>
          {item.questions!.map((q, i) => (
            <li key={i} style={styles.qItem}>{q}</li>
          ))}
        </ul>
      )}

      {/* health consult note (only when present) */}
      {kind === 'health' && item.note && (
        <p style={styles.noteText}><span aria-hidden>💡</span> {item.note}</p>
      )}
    </article>
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
  lead: { fontSize: 22, color: C.inkSoft, margin: 0, textAlign: 'center', lineHeight: 1.5 },
  // kind cards (home)
  cardCol: { display: 'flex', flexDirection: 'column', gap: 14 },
  kindCard: {
    display: 'flex', alignItems: 'center', gap: 16, width: '100%', minHeight: 104,
    border: '3px solid', borderRadius: 20, padding: '18px 20px', cursor: 'pointer',
    textAlign: 'left', boxSizing: 'border-box', boxShadow: '0 4px 16px rgba(15,34,51,0.08)',
  },
  kindEmoji: { fontSize: 46, lineHeight: 1, flexShrink: 0 },
  kindTextWrap: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 },
  kindLabel: { fontSize: 28, fontWeight: 900, lineHeight: 1.2 },
  kindSub: { fontSize: 19, fontWeight: 700, color: C.inkSoft, lineHeight: 1.35 },
  kindArrow: { fontSize: 30, opacity: 0.8, flexShrink: 0 },
  // read-all
  readAllBtn: {
    width: '100%', minHeight: 84, fontSize: 30, fontWeight: 900, color: '#FFFFFF',
    border: 'none', borderRadius: 18, cursor: 'pointer', padding: '12px 20px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    boxShadow: '0 6px 20px rgba(15,34,51,0.20)',
  },
  // item card
  card: {
    display: 'block', background: C.surface, border: '2px solid #CBD9E1', borderRadius: 18,
    padding: '20px 20px 22px', boxShadow: '0 3px 12px rgba(15,34,51,0.06)',
  },
  cardHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  cardTitle: { fontSize: 27, fontWeight: 900, lineHeight: 1.35, margin: 0, wordBreak: 'keep-all', flex: 1 },
  itemReadBtn: {
    flexShrink: 0, width: 58, height: 58, fontSize: 24, background: '#FFFFFF',
    border: '2px solid', borderRadius: 12, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  itemReadWide: {
    marginTop: 14, minHeight: 60, width: '100%', fontSize: 22, fontWeight: 800, background: '#FFFFFF',
    border: '2px solid', borderRadius: 14, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  bodyText: { fontSize: 22, lineHeight: 1.75, color: C.ink, margin: '12px 0 0', wordBreak: 'keep-all' },
  qList: { margin: '14px 0 0', padding: '0 0 0 4px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 },
  qItem: {
    fontSize: 21, lineHeight: 1.6, color: C.seaStrong, fontWeight: 700, wordBreak: 'keep-all',
    background: '#F0F5F8', borderRadius: 12, padding: '12px 16px',
  },
  noteText: {
    fontSize: 18, lineHeight: 1.55, color: C.inkSoft, margin: '16px 0 0', wordBreak: 'keep-all',
    background: '#FFF6DE', border: '2px solid #E0C066', borderRadius: 12, padding: '12px 14px',
  },
  wisdomText: { fontSize: 26, lineHeight: 1.6, color: C.ink, fontWeight: 800, margin: 0, textAlign: 'center', wordBreak: 'keep-all' },
  wisdomSource: { fontSize: 19, color: C.muted, fontWeight: 700, margin: '12px 0 0', textAlign: 'center' },
  footNote: { fontSize: 18, color: C.muted, textAlign: 'center', margin: 0, lineHeight: 1.5 },
  // error
  errorCard: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
    background: C.warnBg, border: `3px solid ${C.warnBorder}`, borderRadius: 20, padding: '28px 22px',
  },
  errorEmoji: { fontSize: 54, lineHeight: 1 },
  errorText: { fontSize: 24, fontWeight: 800, color: C.warnInk, textAlign: 'center', lineHeight: 1.5, margin: 0 },
  primaryBtn: {
    minHeight: 72, fontSize: 24, fontWeight: 800, color: '#FFFFFF', background: C.sea,
    border: 'none', borderRadius: 16, cursor: 'pointer', padding: '12px 24px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
}

const GLOBAL_CSS = `
  .tl-ctrl:focus-visible, .tl-card:focus-visible, .tl-readall:focus-visible,
  .tl-item-read:focus-visible, .tl-primary:focus-visible {
    outline: 5px solid ${C.focus}; outline-offset: 3px;
  }
  .tl-card, .tl-readall, .tl-item-read, .tl-ctrl, .tl-primary {
    transition: transform 0.08s ease, background 0.15s ease, filter 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .tl-card:hover { filter: brightness(0.97); }
  .tl-readall:hover, .tl-primary:hover { filter: brightness(0.94); }
  .tl-item-read:hover { background: #F0F5F8; }
  .tl-card:active, .tl-readall:active, .tl-item-read:active, .tl-ctrl:active, .tl-primary:active {
    transform: scale(0.98);
  }
  @media (prefers-reduced-motion: reduce) {
    .tl-card, .tl-readall, .tl-item-read, .tl-ctrl, .tl-primary {
      transition: none !important; transform: none !important; filter: none !important;
    }
  }
`
