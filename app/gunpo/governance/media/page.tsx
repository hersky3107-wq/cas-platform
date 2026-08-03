'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { JejuThemeShell } from '@/components/gunpo/JejuThemeShell'
import { useJejuUi } from '@/components/gunpo/useJejuUi'

// ─── Types (mirrors lib/gunpo/mediawatch.ts — no direct import) ────────────────
type JejuMediaWatch = {
  ok: boolean
  date: string
  mode: string
  searches: Array<{
    id: string
    label: string
    query: string
    ok: boolean
    result: string | null
    sources: string[]
    error?: string
  }>
  coreIssues: string | null
  minorIssues: string | null
  nationalVsLocal: string | null
  summary: string | null
  error?: string
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

// ─── MediaSection (reusable body) ──────────────────────────────────────────────
//
// Extracted so the unified governance page can embed 언론 동향 as a lazy,
// collapse-by-default section (mirrors BriefSection / DeliberateSection). The
// standalone page below wraps this in a JejuThemeShell.
//
// Session cache: the media fan-out is 30–90s + billable AI, so a successful
// result is kept in a module-level variable for the life of the SPA session.
// When the unified page collapses this section it unmounts the component, but a
// re-expand rehydrates from this cache instead of re-running the fan-out. The
// refresh button always forces a fresh run.
let cachedMedia: JejuMediaWatch | null = null

export function MediaSection() {
  const { t } = useJejuUi()

  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<JejuMediaWatch | null>(cachedMedia)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const runMedia = useCallback(async () => {
    setLoading(true)
    setResult(null)
    setFetchError(null)
    try {
      const res = await fetch('/api/gunpo/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'governance' }),
      })
      // Defensive parse: Vercel may return a non-JSON body (e.g. a timeout/
      // platform error page) when the upstream fan-out exceeds maxDuration.
      // Never feed that into res.json() — surface a fixed Korean message instead.
      const contentType = res.headers.get('content-type') ?? ''
      const isJson = contentType.toLowerCase().includes('application/json')
      if (!res.ok || !isJson) {
        // Drain the body so the connection can be reused, but do NOT parse it.
        await res.text().catch(() => {})
        setFetchError(
          '언론 동향을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. (서버 응답 지연 또는 오류)'
        )
        return
      }
      const data = (await res.json()) as JejuMediaWatch
      cachedMedia = data
      setResult(data)
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : '네트워크 오류')
    } finally {
      setLoading(false)
    }
  }, [])

  // Lazy load: fetch on first mount only when nothing is cached yet. On the
  // unified page this component is not mounted until the user expands the
  // (collapsed-by-default) section, so the expensive fan-out never runs on
  // governance-page load. On the standalone route it mounts immediately, which
  // preserves the original auto-load-on-open behavior.
  useEffect(() => {
    if (!cachedMedia) void runMedia()
  }, [runMedia])

  return (
    <div className="flex flex-col gap-6">
      {/* Refresh button */}
      <div className="flex items-center justify-between gap-4">
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

      {/* Result — summary / 핵심 / 주변 / 전국vs지역 only (raw evidence panel removed) */}
      {!loading && result && (
        <div className="flex flex-col gap-6">
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

          <TextSection heading={t.mediaCoreHeading} content={result.coreIssues} />
          <TextSection heading={t.mediaMinorHeading} content={result.minorIssues} />
          <TextSection heading={t.mediaNationalVsLocalHeading} content={result.nationalVsLocal} />
        </div>
      )}
    </div>
  )
}

// ─── Page (standalone route — wraps the section in its own shell) ──────────────

export default function JejuGovernanceMediaPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="governance"
      title={t.mediaTitle}
      tagline={t.mediaDesc}
      backHref="/motie/governance"
      backLabel={t.backToGovernance}
    >
      <MediaSection />
    </JejuThemeShell>
  )
}
