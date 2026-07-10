'use client'

/**
 * 제주 전문 AI 챗봇 — Jeju resident chatbot chip.
 *
 * Endpoint: POST /api/domin/jeju-chat { messages: [{role,content},...] }
 * Response: { reply, usedSearch, searchRaw, contextMeta, routedVia, errors }
 *
 * Layout:
 *   - Sticky header: "🌊 제주 전문 AI" + hint
 *   - Message list (user right / AI left, scrollable)
 *   - Empty state: example prompt chips
 *   - Sticky bottom bar: input + 보내기 (Enter submits)
 *
 * AI bubble extras:
 *   - Collapsible "🔍 검색 결과 보기" when searchRaw present
 *   - Provenance line when contextMeta present
 *   - Small muted routedVia badge (내부지식 / 캐시 / 검색)
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
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
  seaLight: '#DCEAFB',
  focus: '#E8590C',
  mutedBg: '#F5EAD6',
  mutedBorder: '#D9C6A2',
  mutedInk: '#4E5568',
  userBubble: '#0E4E8A',
  userBubbleText: '#FFFFFF',
  aiBubble: '#FFFFFF',
  aiBubbleText: '#12263A',
  searchBg: '#EAF2FB',
  searchBorder: '#BAE6FD',
  searchInk: '#0E4E8A',
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ChatRole = 'user' | 'assistant'

interface Message {
  id: string
  role: ChatRole
  content: string
}

interface ContextMeta {
  source: string
  retrievedAt: string
  asOf: string | null
}

type RoutedVia = 'internal' | 'cache' | 'search-deep' | 'search-light'

interface AiTurn {
  reply: string
  usedSearch: boolean
  searchRaw: string | null
  contextMeta: ContextMeta | null
  routedVia: RoutedVia
  errors: string[]
}

interface MessageBubble {
  msg: Message
  /** Only set for assistant bubbles */
  ai?: AiTurn
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function routeLabel(r: RoutedVia): string {
  if (r === 'internal') return '내부지식'
  if (r === 'cache') return '캐시'
  return '검색'
}

function fmtProvenance(meta: ContextMeta): string {
  const date = meta.retrievedAt.slice(0, 10)
  return meta.asOf
    ? `🔍 검색 · ${meta.asOf} 기준 · ${date} 조회`
    : `🔍 검색 · ${date} 조회`
}

/** Inline markdown: **bold**, *italic*, `code` → React nodes (no dangerouslySetInnerHTML). */
function renderInline(text: string, prefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  // Matches **bold**, *italic*, `code` in one pass
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`\n]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[0].startsWith('**'))
      out.push(<strong key={`${prefix}b${k++}`}>{m[2]}</strong>)
    else if (m[0].startsWith('*'))
      out.push(<em key={`${prefix}i${k++}`}>{m[3]}</em>)
    else
      out.push(
        <code key={`${prefix}c${k++}`} style={{ background: '#EDF1FA', borderRadius: 4, padding: '1px 5px', fontSize: '0.9em', fontFamily: 'monospace' }}>
          {m[4]}
        </code>,
      )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * Minimal safe markdown renderer — no dangerouslySetInnerHTML.
 * Handles: ## headings, - bullets, | tables |, **bold**, *italic*, `code`.
 */
function renderMarkdown(text: string): React.ReactNode {
  const raw = text.split('\n')

  // Categorize each line
  type Parsed =
    | { k: 'h1' | 'h2' | 'h3'; body: string }
    | { k: 'li'; body: string }
    | { k: 'tr'; cells: string[] }
    | { k: 'sep' }   // table separator | --- | --- |
    | { k: 'hr' }
    | { k: 'blank' }
    | { k: 'p'; body: string }

  const parsed: Parsed[] = raw.map((line) => {
    const l = line.trimEnd()
    if (!l.trim()) return { k: 'blank' } as Parsed
    const h3 = l.match(/^###\s+(.+)/); if (h3) return { k: 'h3', body: h3[1] } as Parsed
    const h2 = l.match(/^##\s+(.+)/);  if (h2) return { k: 'h2', body: h2[1] } as Parsed
    const h1 = l.match(/^#\s+(.+)/);   if (h1) return { k: 'h1', body: h1[1] } as Parsed
    const li = l.match(/^[-*+]\s+(.+)/) ?? l.match(/^\d+[.)]\s+(.+)/)
    if (li) return { k: 'li', body: li[1] } as Parsed
    if (l.startsWith('|') && l.endsWith('|')) {
      const cells = l.slice(1, -1).split('|').map((c) => c.trim())
      if (cells.every((c) => /^[-:\s]+$/.test(c))) return { k: 'sep' } as Parsed
      return { k: 'tr', cells } as Parsed
    }
    if (/^[-*_]{3,}$/.test(l.trim())) return { k: 'hr' } as Parsed
    return { k: 'p', body: l } as Parsed
  })

  const nodes: React.ReactNode[] = []
  let i = 0
  while (i < parsed.length) {
    const p = parsed[i]

    if (p.k === 'blank') { i++; continue }

    if (p.k === 'hr') {
      nodes.push(<hr key={`hr${i}`} style={{ border: 'none', borderTop: `1px solid ${C.mutedBorder}`, margin: '8px 0' }} />)
      i++; continue
    }

    if (p.k === 'h1' || p.k === 'h2' || p.k === 'h3') {
      const sz = p.k === 'h1' ? 17 : p.k === 'h2' ? 16 : 15
      const mt = p.k === 'h1' ? 12 : 8
      nodes.push(
        <div key={`h${i}`} style={{ fontSize: sz, fontWeight: 800, color: C.seaStrong, marginTop: mt, marginBottom: 2, lineHeight: 1.4 }}>
          {renderInline(p.body, `h${i}-`)}
        </div>,
      )
      i++; continue
    }

    if (p.k === 'li') {
      const items: string[] = []
      while (i < parsed.length && parsed[i].k === 'li') {
        items.push((parsed[i] as { k: 'li'; body: string }).body)
        i++
      }
      nodes.push(
        <ul key={`ul${i}`} style={{ margin: '4px 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.map((item, j) => (
            <li key={j} style={{ fontSize: 15, lineHeight: 1.6, color: C.ink }}>
              {renderInline(item, `li${i}-${j}-`)}
            </li>
          ))}
        </ul>,
      )
      continue
    }

    if (p.k === 'tr') {
      const rows: string[][] = []
      let isFirst = true
      while (i < parsed.length && (parsed[i].k === 'tr' || parsed[i].k === 'sep')) {
        if (parsed[i].k === 'tr') rows.push((parsed[i] as { k: 'tr'; cells: string[] }).cells)
        i++
      }
      nodes.push(
        <div key={`tbl${i}`} style={{ overflowX: 'auto', margin: '4px 0' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 13, width: '100%' }}>
            <tbody>
              {rows.map((cells, ri) => {
                const isHeader = isFirst && ri === 0
                isFirst = false
                return (
                  <tr key={ri} style={{ background: isHeader ? C.seaLight : ri % 2 === 0 ? C.surface : C.mutedBg }}>
                    {cells.map((cell, ci) => (
                      <td key={ci} style={{ border: `1px solid ${C.mutedBorder}`, padding: '4px 8px', whiteSpace: 'nowrap', fontWeight: isHeader ? 700 : 400 }}>
                        {renderInline(cell, `td${i}-${ri}-${ci}-`)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // Paragraph: collect consecutive 'p' lines
    const lines: string[] = []
    while (i < parsed.length && parsed[i].k === 'p') {
      lines.push((parsed[i] as { k: 'p'; body: string }).body)
      i++
    }
    const inlines: React.ReactNode[] = []
    lines.forEach((ln, li2) => {
      if (li2 > 0) inlines.push(<br key={`br${i}-${li2}`} />)
      inlines.push(...renderInline(ln, `p${i}-${li2}-`))
    })
    nodes.push(
      <p key={`p${i}`} style={{ margin: '3px 0', fontSize: 15, lineHeight: 1.65, color: C.ink, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
        {inlines}
      </p>,
    )
  }

  return <>{nodes}</>
}

// ── Example prompts ───────────────────────────────────────────────────────────

const EXAMPLES = [
  '오늘 제주 날씨',
  '제주 방언 알려줘',
  '이번 주 제주 행사',
  '제주 이주할 때 챙겨야 할 것',
  '제주 감귤 언제 나와?',
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function JejuChatPage() {
  const router = useRouter()
  const [bubbles, setBubbles] = useState<MessageBubble[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingDeep, setLoadingDeep] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom on new message
  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [bubbles, loading])

  const historyMessages = useCallback((): Message[] => {
    return bubbles.map((b) => b.msg)
  }, [bubbles])

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || loading) return

      const userMsg: Message = { id: uid(), role: 'user', content: trimmed }
      setBubbles((prev) => [...prev, { msg: userMsg }])
      setInput('')
      setError(null)
      setLoading(true)
      setLoadingDeep(false)

      // Build history including this new user turn
      const history: Message[] = [...historyMessages(), userMsg]

      // Brief delay then hint "검색 중" for search-bound questions
      const deepTimer = setTimeout(() => setLoadingDeep(true), 4000)

      try {
        const res = await fetch('/api/domin/jeju-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: history.map((m) => ({ role: m.role, content: m.content })),
          }),
          signal: AbortSignal.timeout(90_000),
        })
        const json = (await res.json()) as AiTurn & { ok: boolean; error?: string }

        if (!json.ok && json.error) {
          setError(json.error)
        } else {
          const aiMsg: Message = {
            id: uid(),
            role: 'assistant',
            content: json.reply ?? '',
          }
          const ai: AiTurn = {
            reply: json.reply ?? '',
            usedSearch: Boolean(json.usedSearch),
            searchRaw: json.searchRaw ?? null,
            contextMeta: json.contextMeta ?? null,
            routedVia: json.routedVia ?? 'internal',
            errors: Array.isArray(json.errors) ? json.errors : [],
          }
          setBubbles((prev) => [...prev, { msg: aiMsg, ai }])
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') {
          setError('응답 시간이 초과되었어요. 다시 시도해 주세요.')
        } else {
          setError(e instanceof Error ? e.message : '오류가 발생했어요. 다시 시도해 주세요.')
        }
      } finally {
        clearTimeout(deepTimer)
        setLoading(false)
        setLoadingDeep(false)
        // refocus input after reply
        setTimeout(() => inputRef.current?.focus(), 80)
      }
    },
    [loading, historyMessages],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void sendMessage(input)
      }
    },
    [input, sendMessage],
  )

  const onExampleClick = useCallback(
    (text: string) => {
      setInput(text)
      setTimeout(() => inputRef.current?.focus(), 50)
    },
    [],
  )

  const isEmpty = bubbles.length === 0

  return (
    <div style={S.root}>
      <style>{GLOBAL_CSS}</style>

      {/* ── Sticky header ──────────────────────────────────────────────── */}
      <div style={S.header}>
        <button
          type="button"
          className="jc-back"
          style={S.backBtn}
          onClick={() => router.push('/jeju/resident/general')}
          aria-label="뒤로 가기"
        >
          ← 뒤로
        </button>
        <div style={S.headerCenter}>
          <span style={S.headerTitle}>🌊 제주 전문 AI</span>
          <span style={S.headerHint}>제주에 관한 건 뭐든 물어보세요</span>
        </div>
      </div>

      {/* ── Message list ───────────────────────────────────────────────── */}
      <div style={S.msgArea} aria-live="polite" aria-label="대화 내용">

        {/* Empty state */}
        {isEmpty && !loading && (
          <div style={S.emptyState}>
            <span style={S.emptyEmoji} aria-hidden>🌊</span>
            <p style={S.emptyTitle}>제주 전문 AI</p>
            <p style={S.emptyHint}>제주 생활, 날씨, 방언, 행사, 교통, 이주…<br />뭐든 물어보세요.</p>
            <div style={S.exampleList}>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="jc-example"
                  style={S.exampleChip}
                  onClick={() => onExampleClick(ex)}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Conversation */}
        {bubbles.map(({ msg, ai }) => (
          <div
            key={msg.id}
            style={msg.role === 'user' ? S.rowUser : S.rowAi}
          >
            {msg.role === 'user' ? (
              <div style={S.userBubble}>{msg.content}</div>
            ) : (
              <div style={S.aiBubble}>
                {/* Reply text — rendered as markdown */}
                <div style={S.aiText}>{renderMarkdown(msg.content)}</div>

                {/* Search-deep raw block */}
                {ai?.searchRaw && (
                  <details style={S.searchDetails}>
                    <summary style={S.searchSummary} className="jc-summary">
                      🔍 검색 결과 보기
                    </summary>
                    <p style={S.searchRaw}>{ai.searchRaw}</p>
                  </details>
                )}

                {/* Provenance (search/cache) OR route badge (internal only) — never both */}
                {ai?.contextMeta ? (
                  <p style={S.provenance}>{fmtProvenance(ai.contextMeta)}</p>
                ) : ai && (
                  <div style={S.badgeRow}>
                    <span style={S.routeBadge}>
                      {ai.routedVia === 'cache' ? '📦' : '🧠'}{' '}
                      {routeLabel(ai.routedVia)}
                    </span>
                  </div>
                )}

                {/* Per-bubble errors */}
                {ai && <FriendlyErrors errors={ai.errors} />}
              </div>
            )}
          </div>
        ))}

        {/* Loading bubble */}
        {loading && (
          <div style={S.rowAi}>
            <div style={{ ...S.aiBubble, ...S.loadingBubble }}>
              <span style={S.loadingDots} aria-label="답변 생성 중">
                <span className="jc-dot" />
                <span className="jc-dot" />
                <span className="jc-dot" />
              </span>
              <span style={S.loadingHint}>
                {loadingDeep ? '제주 AI가 검색하는 중…' : '제주 AI가 생각하는 중…'}
              </span>
            </div>
          </div>
        )}

        {/* Inline error */}
        {error && (
          <div style={S.rowAi}>
            <div style={S.errorBubble} role="alert">
              <p style={S.errorText}>⚠ {error}</p>
              <button
                type="button"
                className="jc-ctrl"
                style={S.retryBtn}
                onClick={() => { setError(null); void sendMessage(input || (bubbles.at(-2)?.msg.content ?? '')) }}
              >
                다시 시도
              </button>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Sticky input bar ───────────────────────────────────────────── */}
      <div style={S.inputBar}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="제주에 관해 물어보세요… (Enter 보내기)"
          style={S.textarea}
          className="jc-input"
          rows={1}
          disabled={loading}
          aria-label="메시지 입력"
        />
        <button
          type="button"
          className="jc-ctrl jc-send"
          style={{
            ...S.sendBtn,
            ...(loading || !input.trim() ? S.sendBtnDisabled : {}),
          }}
          onClick={() => void sendMessage(input)}
          disabled={loading || !input.trim()}
          aria-label="보내기"
        >
          {loading ? '⏳' : '보내기'}
        </button>
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  root: {
    height: '100dvh',
    background: C.bg,
    color: C.ink,
    fontFamily:
      "'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
    display: 'flex',
    flexDirection: 'column',
    maxWidth: 680,
    margin: '0 auto',
    overflow: 'hidden',
    position: 'relative',
  },

  // Header
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    background: C.bg,
    borderBottom: `1.5px solid ${C.mutedBorder}`,
    flexShrink: 0,
    position: 'sticky',
    top: 0,
    zIndex: 6,
    boxSizing: 'border-box',
  },
  backBtn: {
    minHeight: 40,
    fontSize: 17,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `2px solid ${C.sea}`,
    borderRadius: 10,
    cursor: 'pointer',
    padding: '4px 12px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  headerCenter: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 900,
    color: C.seaStrong,
    lineHeight: 1.2,
  },
  headerHint: {
    fontSize: 12,
    color: C.mutedInk,
    lineHeight: 1.3,
  },

  // Message area
  msgArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '14px 14px 6px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    boxSizing: 'border-box',
    scrollBehavior: 'smooth',
  },

  // Empty state
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    paddingTop: 32,
    paddingBottom: 8,
  },
  emptyEmoji: { fontSize: 48, lineHeight: 1 },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 900,
    color: C.seaStrong,
    margin: 0,
  },
  emptyHint: {
    fontSize: 14,
    color: C.mutedInk,
    textAlign: 'center',
    margin: 0,
    lineHeight: 1.6,
  },
  exampleList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginTop: 6,
    maxWidth: 520,
  },
  exampleChip: {
    fontSize: 13,
    fontWeight: 700,
    color: C.sea,
    background: C.seaLight,
    border: `1.5px solid ${C.mutedBorder}`,
    borderRadius: 20,
    padding: '6px 14px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },

  // Message rows
  rowUser: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  rowAi: {
    display: 'flex',
    justifyContent: 'flex-start',
  },

  // Bubbles
  userBubble: {
    background: C.userBubble,
    color: C.userBubbleText,
    borderRadius: '18px 18px 4px 18px',
    padding: '10px 14px',
    maxWidth: '78%',
    fontSize: 15,
    lineHeight: 1.55,
    wordBreak: 'keep-all',
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  aiBubble: {
    background: C.aiBubble,
    color: C.aiBubbleText,
    borderRadius: '18px 18px 18px 4px',
    padding: '10px 14px',
    maxWidth: '88%',
    border: `1.5px solid ${C.mutedBorder}`,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  aiText: {
    fontSize: 15,
    lineHeight: 1.65,
    color: C.ink,
    wordBreak: 'keep-all',
    overflowWrap: 'anywhere',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },

  // Loading
  loadingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    border: `1.5px solid ${C.mutedBorder}`,
  },
  loadingDots: {
    display: 'flex',
    gap: 4,
    alignItems: 'center',
  },
  loadingHint: {
    fontSize: 13,
    color: C.mutedInk,
    fontStyle: 'italic',
  },

  // Search raw
  searchDetails: {
    background: C.searchBg,
    border: `1px solid ${C.searchBorder}`,
    borderRadius: 10,
    padding: '6px 10px',
  },
  searchSummary: {
    fontSize: 13,
    fontWeight: 700,
    color: C.searchInk,
    cursor: 'pointer',
    userSelect: 'none',
  },
  searchRaw: {
    fontSize: 13,
    lineHeight: 1.7,
    color: C.inkSoft,
    margin: '6px 0 0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'keep-all',
    overflowWrap: 'anywhere',
  },

  // Provenance
  provenance: {
    fontSize: 12,
    color: C.mutedInk,
    margin: 0,
    lineHeight: 1.4,
  },

  // Badge row
  badgeRow: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  routeBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: C.mutedInk,
    background: C.mutedBg,
    borderRadius: 6,
    padding: '2px 7px',
  },

  // Error bubble
  errorBubble: {
    background: '#FEF2F2',
    border: '1.5px solid #FCA5A5',
    borderRadius: '18px 18px 18px 4px',
    padding: '10px 14px',
    maxWidth: '88%',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  errorText: {
    fontSize: 14,
    fontWeight: 700,
    color: '#B91C1C',
    margin: 0,
  },
  retryBtn: {
    minHeight: 36,
    fontSize: 14,
    fontWeight: 700,
    color: C.sea,
    background: C.surface,
    border: `1.5px solid ${C.sea}`,
    borderRadius: 8,
    cursor: 'pointer',
    padding: '4px 14px',
    alignSelf: 'flex-start',
  },

  // Per-bubble errors
  errDetails: { marginTop: 2 },
  errSummary: {
    fontSize: 12,
    color: '#8A3F04',
    cursor: 'pointer',
    fontWeight: 700,
  },
  errList: {
    margin: '4px 0 0 12px',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  errItem: { fontSize: 12, color: C.mutedInk },

  // Input bar
  inputBar: {
    display: 'flex',
    gap: 8,
    padding: '10px 14px',
    background: C.bg,
    borderTop: `1.5px solid ${C.mutedBorder}`,
    alignItems: 'flex-end',
    flexShrink: 0,
    position: 'sticky',
    bottom: 0,
    boxSizing: 'border-box',
  },
  textarea: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    fontSize: 15,
    color: C.ink,
    background: C.surface,
    border: `1.5px solid ${C.mutedBorder}`,
    borderRadius: 12,
    padding: '10px 12px',
    outline: 'none',
    resize: 'none',
    lineHeight: 1.5,
    fontFamily: 'inherit',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  sendBtn: {
    minHeight: 44,
    minWidth: 68,
    fontSize: 15,
    fontWeight: 700,
    color: C.surface,
    background: C.sea,
    border: 'none',
    borderRadius: 12,
    cursor: 'pointer',
    padding: '6px 16px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  sendBtnDisabled: {
    opacity: 0.5,
    cursor: 'default',
  },
}

// ── Global CSS ────────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
  .jc-back:focus-visible, .jc-ctrl:focus-visible, .jc-example:focus-visible {
    outline: 3px solid ${C.focus};
    outline-offset: 2px;
  }
  .jc-back:hover { background: #EAF2FB; }
  .jc-example:hover { background: #BFD9F5; border-color: ${C.sea}; }
  .jc-send:not(:disabled):hover { background: ${C.seaStrong}; }
  .jc-input:focus {
    border-color: ${C.sea};
    box-shadow: 0 0 0 3px ${C.sea}26;
  }
  .jc-summary:hover { opacity: 0.8; }
  .jc-back, .jc-ctrl, .jc-example, .jc-send {
    transition: background 0.12s ease, opacity 0.12s ease;
    -webkit-tap-highlight-color: transparent;
  }
  /* Animated loading dots */
  .jc-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${C.mutedInk};
    animation: jc-pulse 1.2s ease-in-out infinite;
  }
  .jc-dot:nth-child(1) { animation-delay: 0s; }
  .jc-dot:nth-child(2) { animation-delay: 0.2s; }
  .jc-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes jc-pulse {
    0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
    40%           { opacity: 1;    transform: scale(1.1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .jc-dot { animation: none !important; opacity: 1; }
    .jc-back, .jc-ctrl, .jc-example, .jc-send { transition: none !important; }
  }
`
