import type { Metadata } from 'next'
import Link from 'next/link'
import { parseCompareResponses } from '@/lib/compare/session-types'
import { PUBLIC_SHARE_BASE } from '@/lib/compare/session-types'
import { supabaseAdmin } from '@/lib/supabase/server'

type PageProps = {
  params: Promise<{ share_id: string }>
}

type ShareSession = {
  question: string
  responses: ReturnType<typeof parseCompareResponses>
  voted_ai: string | null
  is_public: boolean
}

async function loadSession(shareId: string): Promise<ShareSession | null> {
  const id = shareId.trim()
  if (!id) return null

  const { data, error } = await supabaseAdmin
    .from('compare_sessions')
    .select('question, responses, voted_ai, is_public')
    .eq('share_id', id)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] compare_sessions lookup:', error.message)
    return null
  }

  return {
    question: data.question,
    responses: parseCompareResponses(data.responses),
    voted_ai: typeof data.voted_ai === 'string' ? data.voted_ai : null,
    is_public: Boolean(data.is_public),
  }
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

  const title = `AI Compare: "${session.question.slice(0, 60)}${session.question.length > 60 ? '…' : ''}" — AIMANI`

  return {
    title,
    description: `See how ChatGPT, Claude, Gemini, Grok, DeepSeek and Mistral answered this question on AIMANI.`,
    openGraph: {
      title: 'AI Compare — AIMANI',
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

  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-12 text-white">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-cyan-300/85">
          AIMANI
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">AI Compare Session</h1>

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
