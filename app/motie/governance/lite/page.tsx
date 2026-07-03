'use client'

import { useState, useCallback } from 'react'
import { ChevronDown, ChevronUp, RefreshCw, Search } from 'lucide-react'
import { JejuThemeShell } from '@/components/motie/JejuThemeShell'
import { useJejuUi } from '@/components/motie/useJejuUi'
import { useMotieMode } from '@/components/motie/mode-context'

// ─── Types (mirrors lib/jeju/brief.ts — no direct import) ─────────────────────
type JejuSnapshotSource = {
  id: string
  label: string
  ok: boolean
  text: string
  error?: string
}
type JejuBriefingResult = {
  ok: boolean
  question: string
  snapshot: { ok: boolean; sources: JejuSnapshotSource[] }
  briefing: string | null
  provider: string
  error?: string
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function ProgressHint({ hint }: { hint: string }) {
  return (
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
      <p className="text-sm font-semibold text-jeju-fg">수집 중…</p>
      <p className="max-w-xs text-xs text-jeju-fg-muted leading-relaxed">{hint}</p>
    </div>
  )
}

function EvidenceSection({
  sources,
  showLabel,
  hideLabel,
  sourceOkBadge,
  sourceErrBadge,
  sourcesHeading,
}: {
  sources: JejuSnapshotSource[]
  showLabel: string
  hideLabel: string
  sourceOkBadge: string
  sourceErrBadge: string
  sourcesHeading: string
}) {
  const [open, setOpen] = useState(false)

  if (!sources.length) return null

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-jeju-border bg-jeju-tile-bg px-4 py-2 text-sm font-semibold text-jeju-accent transition hover:bg-jeju-tile-hover"
      >
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        {open ? hideLabel : showLabel}
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-jeju-fg-muted">
            {sourcesHeading}
          </h3>
          {sources.map((src) => (
            <details key={src.id} className="rounded-xl border border-jeju-border bg-jeju-bg-elevated">
              <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-semibold select-none">
                <span className="flex-1 truncate">{src.label}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    src.ok
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-rose-500/20 text-rose-300'
                  }`}
                >
                  {src.ok ? sourceOkBadge : sourceErrBadge}
                </span>
              </summary>
              <div className="border-t border-jeju-border px-4 pb-4 pt-3">
                {src.ok ? (
                  <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-jeju-fg-muted font-sans">
                    {src.text || '(내용 없음)'}
                  </pre>
                ) : (
                  <p className="text-xs text-rose-400">{src.error ?? '알 수 없는 오류'}</p>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function JejuGovernanceLitePage() {
  const { t } = useJejuUi()
  const { mode: councilMode } = useMotieMode()

  const [customQ, setCustomQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<JejuBriefingResult | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const runBriefing = useCallback(async (question?: string) => {
    setLoading(true)
    setResult(null)
    setFetchError(null)
    try {
      const res = await fetch('/api/motie/lite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(question ? { question, councilMode } : { councilMode }),
      })
      const data = (await res.json()) as JejuBriefingResult
      setResult(data)
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : '네트워크 오류')
    } finally {
      setLoading(false)
    }
  }, [councilMode])

  return (
    <JejuThemeShell
      theme="governance"
      title={t.liteTitle}
      tagline={t.liteDesc}
      backHref="/motie/governance"
      backLabel={t.backToGovernance}
    >
      {/* Action bar */}
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start">
        <button
          type="button"
          disabled={loading}
          onClick={() => runBriefing()}
          className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-xl border border-jeju-border bg-jeju-accent px-5 py-2.5 text-sm font-bold text-black shadow-[var(--jeju-shadow)] transition hover:opacity-90 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          {t.liteDailyBtn}
        </button>

        <div className="flex flex-1 gap-2">
          <input
            type="text"
            value={customQ}
            onChange={(e) => setCustomQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && customQ.trim()) runBriefing(customQ.trim()) }}
            placeholder={t.liteCustomPlaceholder}
            disabled={loading}
            className="min-h-[2.75rem] flex-1 rounded-xl border border-jeju-border bg-jeju-bg-elevated px-4 text-sm text-jeju-fg placeholder:text-jeju-fg-muted focus:border-jeju-accent focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            disabled={loading || !customQ.trim()}
            onClick={() => runBriefing(customQ.trim())}
            className="inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-xl border border-jeju-border bg-jeju-tile-bg px-4 text-sm font-semibold text-jeju-accent transition hover:bg-jeju-tile-hover disabled:opacity-40"
          >
            <Search className="h-4 w-4" aria-hidden />
            {t.liteRunBtn}
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && <ProgressHint hint={t.liteLoadingHint} />}

      {/* Network / outer error */}
      {!loading && fetchError && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-300">
          <span className="font-semibold">{t.errorHeading}:</span> {fetchError}
        </div>
      )}

      {/* Result */}
      {!loading && result && (
        <div className="flex flex-col gap-4">
          {/* Effective question */}
          {result.question && (
            <p className="text-xs text-jeju-fg-muted">
              <span className="font-semibold">{t.liteQuestionLabel}:</span>{' '}
              {result.question}
            </p>
          )}

          {/* TOP: briefing card */}
          {result.ok && result.briefing ? (
            <div className="rounded-2xl border border-jeju-border bg-jeju-bg-elevated px-6 py-6 shadow-[var(--jeju-shadow)]">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-jeju-accent">
                {t.liteBriefingHeading}
                {result.provider && (
                  <span className="ml-2 font-normal normal-case text-jeju-fg-muted">
                    · {t.providerLabel}: {result.provider}
                  </span>
                )}
              </h2>
              <div className="whitespace-pre-wrap text-sm leading-7 text-jeju-fg">
                {result.briefing}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-300">
              {result.error ?? t.liteNoBriefing}
            </div>
          )}

          {/* BELOW: collapsible raw sources */}
          {result.snapshot?.sources && result.snapshot.sources.length > 0 && (
            <EvidenceSection
              sources={result.snapshot.sources}
              showLabel={t.evidenceShow}
              hideLabel={t.evidenceHide}
              sourceOkBadge={t.liteSourceOkBadge}
              sourceErrBadge={t.liteSourceErrBadge}
              sourcesHeading={t.liteSourcesHeading}
            />
          )}
        </div>
      )}
    </JejuThemeShell>
  )
}
