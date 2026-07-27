'use client'

/**
 * 군포 AI — Gunpo resident chatbot chip. Cloned from
 * app/jeju/resident/jeju-chat/page.tsx (labels/prompts swapped to Gunpo terms).
 *
 * Endpoint: POST /api/gunpo/resident/chat { messages: [{role,content},...] }
 * Response: { reply, usedSearch, searchRaw, contextMeta, routedVia, errors }
 */

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { FriendlyErrors } from '@/components/gunpo/FriendlyErrors'

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
  ai?: AiTurn
}

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
  return meta.asOf ? `🔍 검색 · ${meta.asOf} 기준 · ${date} 조회` : `🔍 검색 · ${date} 조회`
}

/** Minimal inline markdown (bold/italic/code) — no dangerouslySetInnerHTML. */
function renderInline(text: string, prefix: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`\n]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[0].startsWith('**')) out.push(<strong key={`${prefix}b${k++}`}>{m[2]}</strong>)
    else if (m[0].startsWith('*')) out.push(<em key={`${prefix}i${k++}`}>{m[3]}</em>)
    else
      out.push(
        <code key={`${prefix}c${k++}`} className="rounded bg-[#EDF1FA] px-1 font-mono text-[0.9em]">
          {m[4]}
        </code>,
      )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Minimal safe markdown renderer: headings, bullets, paragraphs. */
function renderMarkdown(text: string): ReactNode {
  const lines = text.split('\n')
  const nodes: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i].trimEnd()
    if (!l.trim()) {
      i++
      continue
    }
    const h = l.match(/^(#{1,3})\s+(.+)/)
    if (h) {
      nodes.push(
        <div key={`h${i}`} className="mt-2 text-base font-extrabold text-[#1E3A8A]">
          {renderInline(h[2], `h${i}-`)}
        </div>,
      )
      i++
      continue
    }
    const li = l.match(/^[-*+]\s+(.+)/) ?? l.match(/^\d+[.)]\s+(.+)/)
    if (li) {
      const items: string[] = []
      while (i < lines.length) {
        const m2 = lines[i].trimEnd().match(/^[-*+]\s+(.+)/) ?? lines[i].trimEnd().match(/^\d+[.)]\s+(.+)/)
        if (!m2) break
        items.push(m2[1])
        i++
      }
      nodes.push(
        <ul key={`ul${i}`} className="my-1 flex list-disc flex-col gap-1 pl-5">
          {items.map((item, j) => (
            <li key={j} className="text-[15px] leading-relaxed">
              {renderInline(item, `li${i}-${j}-`)}
            </li>
          ))}
        </ul>,
      )
      continue
    }
    nodes.push(
      <p key={`p${i}`} className="my-0.5 whitespace-pre-line text-[15px] leading-relaxed">
        {renderInline(l, `p${i}-`)}
      </p>,
    )
    i++
  }
  return <>{nodes}</>
}

const EXAMPLES = ['오늘 군포 날씨', '군포 이주할 때 챙겨야 할 것', '이번 주 군포 행사', '산본역 근처 맛집', '군포 전기차 충전소']

export default function GunpoChatPage() {
  const router = useRouter()
  const [bubbles, setBubbles] = useState<MessageBubble[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingDeep, setLoadingDeep] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [bubbles, loading])

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || loading) return

      const userMsg: Message = { id: uid(), role: 'user', content: trimmed }
      const history = [...bubbles.map((b) => b.msg), userMsg]
      setBubbles((prev) => [...prev, { msg: userMsg }])
      setInput('')
      setError(null)
      setLoading(true)
      setLoadingDeep(false)

      const deepTimer = setTimeout(() => setLoadingDeep(true), 4000)

      try {
        const res = await fetch('/api/gunpo/resident/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, content: m.content })) }),
          signal: AbortSignal.timeout(90_000),
        })
        const json = (await res.json()) as AiTurn & { ok: boolean; error?: string }
        if (!json.ok && json.error) {
          setError(json.error)
        } else {
          const aiMsg: Message = { id: uid(), role: 'assistant', content: json.reply ?? '' }
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
        setError(
          e instanceof Error && e.name === 'AbortError'
            ? '응답 시간이 초과되었어요. 다시 시도해 주세요.'
            : '오류가 발생했어요. 다시 시도해 주세요.',
        )
      } finally {
        clearTimeout(deepTimer)
        setLoading(false)
        setLoadingDeep(false)
        setTimeout(() => inputRef.current?.focus(), 80)
      }
    },
    [loading, bubbles],
  )

  const isEmpty = bubbles.length === 0

  return (
    <div className="flex h-dvh flex-col bg-[#F3F6FB] text-[#0F172A]">
      <div className="flex flex-shrink-0 items-center gap-3 border-b-2 border-[#E2E8F0] bg-white px-4 py-3">
        <button
          type="button"
          onClick={() => router.push('/gunpo/resident/general')}
          className="min-h-[40px] rounded-lg border-2 border-[#1E3A8A] px-3 text-sm font-bold text-[#1E3A8A]"
        >
          ← 뒤로
        </button>
        <div className="flex-1">
          <p className="text-lg font-black text-[#1E3A8A]">🤖 군포 AI</p>
          <p className="text-xs text-[#64748B]">군포에 관한 건 뭐든 물어보세요</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite" aria-label="대화 내용">
        {isEmpty && !loading && (
          <div className="flex flex-col items-center gap-2 pt-8">
            <span className="text-5xl">🏙️</span>
            <p className="text-lg font-black text-[#1E3A8A]">군포 전문 AI</p>
            <p className="text-center text-sm text-[#64748B]">
              군포 생활, 날씨, 행정, 행사, 이주…
              <br />
              뭐든 물어보세요.
            </p>
            <div className="mt-2 flex max-w-md flex-wrap justify-center gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setInput(ex)
                    setTimeout(() => inputRef.current?.focus(), 50)
                  }}
                  className="rounded-full border border-[#CBD5E1] bg-[#E0E7FF] px-3 py-1.5 text-xs font-bold text-[#1E3A8A]"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {bubbles.map(({ msg, ai }) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'user' ? (
                <div className="max-w-[78%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-[#1E3A8A] px-4 py-2.5 text-[15px] text-white">
                  {msg.content}
                </div>
              ) : (
                <div className="flex max-w-[88%] flex-col gap-2 rounded-2xl rounded-bl-sm border-2 border-[#E2E8F0] bg-white px-4 py-2.5">
                  <div>{renderMarkdown(msg.content)}</div>
                  {ai?.searchRaw && (
                    <details className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] p-2">
                      <summary className="cursor-pointer text-xs font-bold text-[#1E3A8A]">🔍 검색 결과 보기</summary>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-[#334155]">{ai.searchRaw}</p>
                    </details>
                  )}
                  {ai?.contextMeta ? (
                    <p className="text-xs text-[#64748B]">{fmtProvenance(ai.contextMeta)}</p>
                  ) : ai ? (
                    <span className="w-fit rounded bg-[#F1F5F9] px-2 py-0.5 text-[11px] font-bold text-[#64748B]">
                      {ai.routedVia === 'cache' ? '📦' : '🧠'} {routeLabel(ai.routedVia)}
                    </span>
                  ) : null}
                  {ai && <FriendlyErrors errors={ai.errors} />}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border-2 border-[#E2E8F0] bg-white px-4 py-2.5">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#94A3B8]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#94A3B8] [animation-delay:0.2s]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#94A3B8] [animation-delay:0.4s]" />
                </span>
                <span className="text-xs italic text-[#64748B]">
                  {loadingDeep ? '군포 AI가 검색하는 중…' : '군포 AI가 생각하는 중…'}
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="flex justify-start">
              <div className="flex flex-col gap-2 rounded-2xl rounded-bl-sm border-2 border-red-300 bg-red-50 px-4 py-2.5" role="alert">
                <p className="text-sm font-bold text-red-700">⚠ {error}</p>
                <button
                  type="button"
                  onClick={() => {
                    setError(null)
                    void sendMessage(input || (bubbles.at(-2)?.msg.content ?? ''))
                  }}
                  className="w-fit rounded-lg border-2 border-[#1E3A8A] px-3 py-1 text-sm font-bold text-[#1E3A8A]"
                >
                  다시 시도
                </button>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="flex flex-shrink-0 items-end gap-2 border-t-2 border-[#E2E8F0] bg-white px-4 py-3">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void sendMessage(input)
            }
          }}
          placeholder="군포에 관해 물어보세요… (Enter 보내기)"
          rows={1}
          disabled={loading}
          aria-label="메시지 입력"
          className="max-h-[120px] min-h-[44px] flex-1 resize-none rounded-xl border-2 border-[#CBD5E1] px-3 py-2.5 text-[15px] outline-none focus:border-[#1E3A8A]"
        />
        <button
          type="button"
          onClick={() => void sendMessage(input)}
          disabled={loading || !input.trim()}
          aria-label="보내기"
          className="min-h-[44px] min-w-[68px] rounded-xl bg-[#1E3A8A] px-4 text-[15px] font-bold text-white disabled:opacity-50"
        >
          {loading ? '⏳' : '보내기'}
        </button>
      </div>
    </div>
  )
}
