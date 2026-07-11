'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { JejuThemeShell } from '@/components/jeju/JejuThemeShell'
import { useJejuUi } from '@/components/jeju/useJejuUi'

// ─── Types (mirrors lib/jeju/mediawatch.ts — no direct import) ─────────────────
type JejuMediaWatchSearch = {
  id: string
  label: string
  query: string
  ok: boolean
  result: string | null
  sources: string[]
  error?: string
}
type JejuMediaWatch = {
  ok: boolean
  date: string
  mode: string
  searches: JejuMediaWatchSearch[]
  coreIssues: string | null
  minorIssues: string | null
  nationalVsLocal: string | null
  summary: string | null
  error?: string
  fromCache?: boolean
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

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
      <p className="text-sm font-semibold text-jeju-fg">검색 중…</p>
      <p className="max-w-xs text-xs text-jeju-fg-muted leading-relaxed">{hint}</p>
    </div>
  )
}

function TextSection({
  heading,
  content,
}: {
  heading: string
  content: string | null
}) {
  if (!content) return null
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-jeju-accent">
        {heading}
      </h3>
      <div className="rounded-xl border border-jeju-border bg-jeju-bg-elevated px-5 py-4">
        <p className="whitespace-pre-wrap text-sm leading-7 text-jeju-fg">{content}</p>
      </div>
    </section>
  )
}

function SearchRow({
  search,
  queryLabel,
  sourcesLabel,
  failedLabel,
}: {
  search: JejuMediaWatchSearch
  queryLabel: string
  sourcesLabel: string
  failedLabel: string
}) {
  return (
    <details className="rounded-xl border border-jeju-border bg-jeju-bg-elevated">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-semibold select-none">
        <span className="flex-1 truncate">{search.label}</span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
            search.ok
              ? 'bg-emerald-500/20 text-emerald-300'
              : 'bg-rose-500/20 text-rose-300'
          }`}
        >
          {search.ok ? 'OK' : failedLabel}
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-jeju-border px-4 pb-4 pt-3">
        <p className="text-xs text-jeju-fg-muted">
          <span className="font-semibold">{queryLabel}:</span> {search.query}
        </p>
        {search.ok && search.result ? (
          <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-jeju-fg font-sans">
            {search.result}
          </pre>
        ) : (
          <p className="text-xs text-rose-400">{search.error ?? failedLabel}</p>
        )}
        {search.sources.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-jeju-fg-muted">{sourcesLabel}</p>
            <ul className="flex flex-col gap-1">
              {search.sources.map((url, i) => (
                <li key={i}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-xs text-jeju-accent underline-offset-2 hover:underline"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}

function SearchesSection({
  searches,
  showLabel,
  hideLabel,
  heading,
  queryLabel,
  sourcesLabel,
  failedLabel,
}: {
  searches: JejuMediaWatchSearch[]
  showLabel: string
  hideLabel: string
  heading: string
  queryLabel: string
  sourcesLabel: string
  failedLabel: string
}) {
  const [open, setOpen] = useState(false)
  if (!searches.length) return null

  return (
    <section>
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
            {heading}
          </h3>
          {searches.map((s) => (
            <SearchRow
              key={s.id}
              search={s}
              queryLabel={queryLabel}
              sourcesLabel={sourcesLabel}
              failedLabel={failedLabel}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────────

export default function JejuGovernanceMediaPage() {
  const { t } = useJejuUi()

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<JejuMediaWatch | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const runMedia = useCallback(async () => {
    setLoading(true)
    setResult(null)
    setFetchError(null)
    try {
      const res = await fetch('/api/jeju/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'governance' }),
      })
      const data = (await res.json()) as JejuMediaWatch
      setResult(data)
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : '네트워크 오류')
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-load on mount
  useEffect(() => { runMedia() }, [runMedia])

  return (
    <JejuThemeShell
      theme="governance"
      title={t.mediaTitle}
      tagline={t.mediaDesc}
      backHref="/jeju/governance"
      backLabel={t.backToGovernance}
    >
      {/* Refresh button */}
      <div className="mb-8 flex items-center justify-between gap-4">
        <button
          type="button"
          disabled={loading}
          onClick={runMedia}
          className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-xl border border-jeju-border bg-jeju-tile-bg px-5 py-2.5 text-sm font-semibold text-jeju-accent shadow-[var(--jeju-shadow)] transition hover:bg-jeju-tile-hover disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          {t.mediaRefreshBtn}
        </button>
        {result?.date && (
          <p className="text-xs text-jeju-fg-muted">
            {t.mediaDateLabel}: {result.date}
            {result.fromCache && (
              <span className="ml-2 rounded-full bg-jeju-accent/15 px-2 py-0.5 text-[10px] font-semibold text-jeju-accent">
                캐시됨
              </span>
            )}
          </p>
        )}
      </div>

      {/* Loading */}
      {loading && <ProgressHint hint={t.mediaLoadingHint} />}

      {/* Network / outer error */}
      {!loading && fetchError && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-300">
          <span className="font-semibold">{t.errorHeading}:</span> {fetchError}
        </div>
      )}

      {/* Result */}
      {!loading && result && (
        <div className="flex flex-col gap-6">
          {/* TOP: summary card */}
          {result.ok && result.summary ? (
            <div className="rounded-2xl border border-jeju-border bg-jeju-bg-elevated px-6 py-6 shadow-[var(--jeju-shadow)]">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-jeju-accent">
                {t.mediaSummaryHeading}
              </h2>
              <p className="whitespace-pre-wrap text-sm leading-7 text-jeju-fg">{result.summary}</p>
            </div>
          ) : (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-300">
              {result.error ?? t.mediaNoSummary}
            </div>
          )}

          {/* BELOW: structured detail sections */}
          <TextSection heading={t.mediaCoreHeading} content={result.coreIssues} />
          <TextSection heading={t.mediaMinorHeading} content={result.minorIssues} />
          <TextSection heading={t.mediaNationalVsLocalHeading} content={result.nationalVsLocal} />

          {/* Collapsible individual searches */}
          {result.searches && result.searches.length > 0 && (
            <SearchesSection
              searches={result.searches}
              showLabel={t.evidenceShow}
              hideLabel={t.evidenceHide}
              heading={t.mediaSearchesHeading}
              queryLabel={t.mediaSearchQueryLabel}
              sourcesLabel={t.mediaSearchSourcesLabel}
              failedLabel={t.mediaSearchFailed}
            />
          )}
        </div>
      )}
    </JejuThemeShell>
  )
}
