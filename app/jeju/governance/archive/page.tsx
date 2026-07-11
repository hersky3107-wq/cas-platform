'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { JejuThemeShell } from '@/components/jeju/JejuThemeShell'
import { useJejuUi } from '@/components/jeju/useJejuUi'

// ─── Types (mirrors app/api/jeju/archive/route.ts — no direct import) ─────────
type JejuArchiveMode = 'deliberate' | 'diagnostic' | 'brief' | 'other'

type JejuArchiveEntry = {
  id: string
  question: string
  mode: JejuArchiveMode
  createdAt: string
  summary: string
  detail: {
    keyIssues: string | null
    judgment: string | null
    minorityReport: string | null
    mediaRisk: string | null
    voteSummary: string | null
    statusText: string | null
    issuesText: string | null
    synthesisText: string | null
  }
}

type JejuArchiveResponse = {
  ok: boolean
  entries: JejuArchiveEntry[]
  error?: string
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function TextSection({ heading, content }: { heading: string; content: string | null }) {
  if (!content) return null
  return (
    <section>
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-jeju-accent">
        {heading}
      </h4>
      <div className="rounded-lg border border-jeju-border bg-jeju-bg px-4 py-3">
        <p className="whitespace-pre-wrap text-sm leading-6 text-jeju-fg">{content}</p>
      </div>
    </section>
  )
}

function ModeBadge({ mode, t }: { mode: JejuArchiveMode; t: ReturnType<typeof useJejuUi>['t'] }) {
  const label =
    mode === 'deliberate'
      ? t.archiveModeDeliberate
      : mode === 'diagnostic'
        ? t.archiveModeDiagnostic
        : mode === 'brief'
          ? t.archiveModeBrief
          : t.archiveModeOther
  return (
    <span className="shrink-0 rounded-full border border-jeju-accent/40 bg-jeju-accent/10 px-2.5 py-0.5 text-[11px] font-bold text-jeju-accent">
      {label}
    </span>
  )
}

function formatKstDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function ArchiveCard({
  entry,
  expanded,
  onToggle,
  t,
}: {
  entry: JejuArchiveEntry
  expanded: boolean
  onToggle: () => void
  t: ReturnType<typeof useJejuUi>['t']
}) {
  const { detail } = entry
  return (
    <div className="rounded-2xl border border-jeju-border bg-jeju-bg-elevated shadow-[var(--jeju-shadow)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <ModeBadge mode={entry.mode} t={t} />
            <span className="text-[11px] text-jeju-fg-muted">
              {t.archiveDateLabel}: {formatKstDate(entry.createdAt)}
            </span>
          </div>
          <p className="truncate text-sm font-bold text-jeju-fg sm:text-base">{entry.question}</p>
          <p className="mt-1 line-clamp-2 text-xs text-jeju-fg-muted sm:text-sm">{entry.summary}</p>
        </div>
        <span className="mt-1 shrink-0 text-jeju-accent">
          {expanded ? <ChevronUp className="h-5 w-5" aria-hidden /> : <ChevronDown className="h-5 w-5" aria-hidden />}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-4 border-t border-jeju-border px-5 py-4">
          {entry.mode === 'deliberate' && (
            <>
              {detail.voteSummary && (
                <p className="text-sm font-semibold text-jeju-accent">
                  {t.archiveVoteSummaryLabel}: {detail.voteSummary}
                </p>
              )}
              <TextSection heading={t.deepKeyIssuesHeading} content={detail.keyIssues} />
              <TextSection heading={t.deepJudgmentHeading} content={detail.judgment} />
              <TextSection heading={t.deepMinorityHeading} content={detail.minorityReport} />
              <TextSection heading={t.deepMediaRiskHeading} content={detail.mediaRisk} />
            </>
          )}
          {entry.mode === 'diagnostic' && (
            <>
              <TextSection heading={t.diagnosticStatusHeading} content={detail.statusText} />
              <TextSection heading={t.diagnosticIssuesHeading} content={detail.issuesText} />
            </>
          )}
          {entry.mode === 'brief' && (
            <TextSection heading={t.briefSynthesisHeading} content={detail.synthesisText} />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────────

export default function JejuGovernanceArchivePage() {
  const { t } = useJejuUi()

  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<JejuArchiveEntry[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setFetchError(null)
      try {
        const res = await fetch('/api/jeju/archive')
        const data = (await res.json()) as JejuArchiveResponse
        if (cancelled) return
        if (!data.ok) {
          setFetchError(data.error ?? t.archiveErrorMsg)
          setEntries([])
        } else {
          setEntries(data.entries ?? [])
        }
      } catch (e: unknown) {
        if (cancelled) return
        setFetchError(e instanceof Error ? e.message : t.archiveErrorMsg)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [t.archiveErrorMsg])

  return (
    <JejuThemeShell
      theme="governance"
      title={t.archiveTitle}
      tagline={t.archiveDesc}
      backHref="/jeju/governance"
      backLabel={t.backToGovernance}
    >
      {loading && (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-2 w-2 rounded-full bg-jeju-accent"
                style={{ animation: `pulse 1.2s ease-in-out ${i * 0.3}s infinite` }}
              />
            ))}
          </div>
          <p className="text-sm font-semibold text-jeju-fg">{t.archiveLoadingMsg}</p>
        </div>
      )}

      {!loading && fetchError && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-300">
          <span className="font-semibold">{t.errorHeading}:</span> {fetchError}
        </div>
      )}

      {!loading && !fetchError && entries.length === 0 && (
        <div className="rounded-xl border border-jeju-border bg-jeju-bg-elevated px-5 py-10 text-center text-sm text-jeju-fg-muted">
          {t.archiveEmptyMsg}
        </div>
      )}

      {!loading && !fetchError && entries.length > 0 && (
        <div className="flex flex-col gap-3">
          {entries.map((entry) => (
            <ArchiveCard
              key={entry.id}
              entry={entry}
              expanded={expandedId === entry.id}
              onToggle={() => setExpandedId((cur) => (cur === entry.id ? null : entry.id))}
              t={t}
            />
          ))}
        </div>
      )}
    </JejuThemeShell>
  )
}
