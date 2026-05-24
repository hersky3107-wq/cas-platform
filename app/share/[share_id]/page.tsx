import type { Metadata } from 'next'
import Link from 'next/link'
import { parseCompareResponses } from '@/lib/compare/session-types'
import { parsePersonaResponses } from '@/lib/persona/session-types'
import { parseCustomResponses } from '@/lib/custom/session-types'
import { parsePanelResponses } from '@/lib/panel/session-types'
import { parseDeepResponses } from '@/lib/deep/session-types'
import { PUBLIC_SHARE_BASE } from '@/lib/compare/session-types'
import { supabaseAdmin } from '@/lib/supabase/server'

type PageProps = {
  params: Promise<{ share_id: string }>
}

type ShareSession = {
  kind: 'compare' | 'persona' | 'custom' | 'panel' | 'deep'
  question: string
  responses: { ai_name: string; content: string | null }[]
  voted_ai: string | null
  is_public: boolean
  panel_type?: string
  deep_type?: string
}

async function loadFromCompare(shareId: string): Promise<ShareSession | null> {
  const { data, error } = await supabaseAdmin
    .from('compare_sessions')
    .select('question, responses, voted_ai, is_public')
    .eq('share_id', shareId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] compare_sessions lookup:', error.message)
    return null
  }

  return {
    kind: 'compare',
    question: data.question,
    responses: parseCompareResponses(data.responses),
    voted_ai: typeof data.voted_ai === 'string' ? data.voted_ai : null,
    is_public: Boolean(data.is_public),
  }
}

async function loadFromPersona(shareId: string): Promise<ShareSession | null> {
  const { data, error } = await supabaseAdmin
    .from('persona_sessions')
    .select('question, responses, voted_ai, is_public')
    .eq('share_id', shareId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] persona_sessions lookup:', error.message)
    return null
  }

  return {
    kind: 'persona',
    question: data.question,
    responses: parsePersonaResponses(data.responses),
    voted_ai: typeof data.voted_ai === 'string' ? data.voted_ai : null,
    is_public: Boolean(data.is_public),
  }
}

async function loadFromCustom(shareId: string): Promise<ShareSession | null> {
  const { data, error } = await supabaseAdmin
    .from('custom_sessions')
    .select('question, responses, voted_ai, is_public')
    .eq('share_id', shareId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] custom_sessions lookup:', error.message)
    return null
  }

  return {
    kind: 'custom',
    question: data.question,
    responses: parseCustomResponses(data.responses),
    voted_ai: typeof data.voted_ai === 'string' ? data.voted_ai : null,
    is_public: Boolean(data.is_public),
  }
}

async function loadFromPanel(shareId: string): Promise<ShareSession | null> {
  const { data, error } = await supabaseAdmin
    .from('panel_sessions')
    .select('panel_type, question, responses, is_public')
    .eq('share_id', shareId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] panel_sessions lookup:', error.message)
    return null
  }

  return {
    kind: 'panel',
    panel_type: typeof data.panel_type === 'string' ? data.panel_type : '',
    question: data.question,
    responses: parsePanelResponses(data.responses),
    voted_ai: null,
    is_public: Boolean(data.is_public),
  }
}

async function loadFromDeep(shareId: string): Promise<ShareSession | null> {
  const { data, error } = await supabaseAdmin
    .from('deep_sessions')
    .select('deep_type, question, responses, is_public')
    .eq('share_id', shareId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] deep_sessions lookup:', error.message)
    return null
  }

  return {
    kind: 'deep',
    deep_type: typeof data.deep_type === 'string' ? data.deep_type : '',
    question: data.question,
    responses: parseDeepResponses(data.responses),
    voted_ai: null,
    is_public: Boolean(data.is_public),
  }
}

async function loadSession(shareId: string): Promise<ShareSession | null> {
  const id = shareId.trim()
  if (!id) return null

  const compare = await loadFromCompare(id)
  if (compare) return compare

  const persona = await loadFromPersona(id)
  if (persona) return persona

  const custom = await loadFromCustom(id)
  if (custom) return custom

  const panel = await loadFromPanel(id)
  if (panel) return panel

  return loadFromDeep(id)
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { share_id } = await params
  const session = await loadSession(share_id)

  if (!session) {
    return {
      title: 'Session not available — AIMANI',
      robots: { index: false, follow: false },
    }
  }

  const label =
    session.kind === 'persona'
      ? 'AI Persona'
      : session.kind === 'custom'
        ? 'AI Custom'
        : session.kind === 'panel'
          ? `AI Panel (${session.panel_type || 'session'})`
          : session.kind === 'deep'
            ? `AI Deep Research (${session.deep_type || 'session'})`
        : 'AI Compare'
  const title = `${label}: "${session.question.slice(0, 60)}${session.question.length > 60 ? '…' : ''}" — AIMANI`

  const description =
    session.kind === 'persona'
      ? `See how different AI personas answered this question on AIMANI.`
      : session.kind === 'custom'
        ? `See how multiple AIs answered with your custom rules on AIMANI.`
        : session.kind === 'panel'
          ? `See how multiple AIs responded in this AIMANI Panel session.`
          : session.kind === 'deep'
            ? `See this multi-perspective AI deep research session on AIMANI.`
        : `See how ChatGPT, Claude, Gemini, Grok, DeepSeek and Mistral answered this question on AIMANI.`

  return {
    title,
    description,
    openGraph: {
      title: `${label} — AIMANI`,
      description: session.question.slice(0, 150),
      url: `${PUBLIC_SHARE_BASE}/${share_id}`,
    },
    robots: session.is_public
      ? { index: true, follow: true }
      : { index: false, follow: false },
  }
}

export default async function SharePage({ params }: PageProps) {
  const { share_id } = await params
  const session = await loadSession(share_id)

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0a0f1e] px-4 text-white">
        <p className="text-center text-slate-400">This session is not available</p>
      </main>
    )
  }

  const heading =
    session.kind === 'persona'
      ? 'AI Persona Session'
      : session.kind === 'custom'
        ? 'AI Custom Session'
        : session.kind === 'panel'
          ? `AI Panel Session — ${session.panel_type || 'panel'}`
          : session.kind === 'deep'
            ? `AI Deep Research Session — ${session.deep_type || 'deep'}`
        : 'AI Compare Session'

  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-12 text-white">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-cyan-300/85">
          AIMANI
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{heading}</h1>

        <div className="mt-8 rounded-2xl border border-cyan-400/25 bg-[#131c35] px-5 py-4">
          <p className="text-sm leading-relaxed text-slate-100">{session.question}</p>
        </div>

        <div className="mt-8 flex flex-col gap-5">
          {session.responses.map((r, idx) => (
            <article
              key={`${r.ai_name}-${idx}`}
              className="rounded-2xl border border-white/10 bg-[#131c35]/80 p-5"
            >
              <span className="inline-flex rounded-lg bg-white/10 px-2.5 py-0.5 text-sm font-bold text-white">
                {r.ai_name}
              </span>
              {r.content ? (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                  {r.content}
                </p>
              ) : (
                <p className="mt-3 text-sm text-slate-500">No response</p>
              )}
            </article>
          ))}
        </div>

        {session.voted_ai ? (
          <p className="mt-8 text-sm text-slate-300">
            🏆 Community pick: {session.voted_ai}
          </p>
        ) : null}

        <div className="mt-10">
          <Link
            href="https://aimani.ai"
            className="inline-flex rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
          >
            Try it yourself → aimani.ai
          </Link>
        </div>
      </div>
    </main>
  )
}
