'use client'

import { useEffect, useRef, useState } from 'react'
import { Sparkles, Loader2, Wand2, RefreshCw } from 'lucide-react'
import type { Course, CourseId } from '@/lib/jeju/tourist-course'
import type { TouristUiPack } from '@/lib/jeju/tourist-labels'
import { useTouristUi } from '@/components/jeju/useTouristUi'
import { CourseTimeline } from './course-timeline'

type CourseResult = { ok: true; courses: Course[] } | { ok: false; error: string }

/** Kick-off + poll response shapes (mirror the tourist-course route). */
type KickoffResult = { ok: true; jobId: string } | { ok: false; error?: string }
type PollResult =
  | { ok: true; status: 'pending' }
  | { ok: true; status: 'done'; result: CourseResult }
  | { ok: true; status: 'error'; error?: string }
  | { ok: false; error?: string }

type Duration = '반나절' | '하루'
type PanelMode = 'custom' | 'standard'

/** Poll cadence + ceiling. Polling survives backgrounding: a phone that sleeps
 *  mid-generation resumes polling on foreground and the persisted job is picked
 *  up, so a dropped connection no longer loses the result. */
const POLL_INTERVAL_MS = 3_000
const MAX_POLL_MS = 180_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Values are sent to the API and must stay Korean; only the displayed label is
// localized via the maps below.
const AREAS = ['상관없음', '제주시', '서귀포', '동부', '서부'] as const
type Area = (typeof AREAS)[number]

const COMPANIONS = ['가족', '친구', '혼자', '단체'] as const
const AGE_GROUPS = ['20대', '30대', '40대', '50대 이상', '혼합'] as const

/** Emoji per standard course id (labels are localized at render time). */
const STANDARD_TAB_EMOJI: Record<CourseId, string> = {
  A: '✨',
  B: '🌿',
  C: '🧭',
  D: '🤿',
}

/** Korean value → localized label resolvers (values stay KO for the API). */
function durationLabel(d: Duration, t: TouristUiPack): string {
  return d === '반나절' ? t.durationHalf : t.durationFull
}
function areaLabel(a: Area, t: TouristUiPack): string {
  const map: Record<Area, string> = {
    상관없음: t.areaAny,
    제주시: t.areaJejuCity,
    서귀포: t.areaSeogwipo,
    동부: t.areaEast,
    서부: t.areaWest,
  }
  return map[a]
}
function companionLabel(c: string, t: TouristUiPack): string {
  const map: Record<string, string> = {
    가족: t.compFamily,
    친구: t.compFriends,
    혼자: t.compSolo,
    단체: t.compGroup,
  }
  return map[c] ?? c
}
function ageLabel(g: string, t: TouristUiPack): string {
  const map: Record<string, string> = {
    '20대': t.age20,
    '30대': t.age30,
    '40대': t.age40,
    '50대 이상': t.age50plus,
    혼합: t.ageMixed,
  }
  return map[g] ?? g
}
function standardTabLabel(id: CourseId, t: TouristUiPack): string {
  const map: Record<CourseId, string> = {
    A: t.tabPopular,
    B: t.tabHealing,
    C: t.tabLocal,
    D: t.tabActive,
  }
  return map[id]
}

export function CoursePanel() {
  const { t, locale } = useTouristUi()
  const [panelMode, setPanelMode] = useState<PanelMode>('custom')

  // Shared inputs
  const [query, setQuery] = useState('')
  const [duration, setDuration] = useState<Duration>('하루')
  const [area, setArea] = useState<Area>('상관없음')

  // Mode 1 (맞춤)-only optional inputs
  const [companion, setCompanion] = useState<string | null>(null)
  const [ageGroup, setAgeGroup] = useState<string | null>(null)
  const [groupSize, setGroupSize] = useState('')

  const [loading, setLoading] = useState(false)
  const [stepIdx, setStepIdx] = useState(0)
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [resultMode, setResultMode] = useState<PanelMode>('custom')
  const [activeTab, setActiveTab] = useState<CourseId>('A')
  const [error, setError] = useState<string | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  // Monotonic run id — invalidates any stale poll loop when a new run starts.
  const runIdRef = useRef(0)

  const loadingSteps = resultMode === 'custom' ? t.loadCourseCustom : t.loadCourseStandard

  // Cycle the loading sub-message while generating.
  useEffect(() => {
    if (loading) {
      setStepIdx(0)
      stepTimer.current = setInterval(() => {
        setStepIdx((i) => (i + 1) % loadingSteps.length)
      }, 4500)
    } else if (stepTimer.current) {
      clearInterval(stepTimer.current)
      stepTimer.current = null
    }
    return () => {
      if (stepTimer.current) {
        clearInterval(stepTimer.current)
        stepTimer.current = null
      }
    }
  }, [loading, loadingSteps])

  function switchPanelMode(next: PanelMode) {
    if (next === panelMode) return
    setPanelMode(next)
    // Reset results cleanly when switching modes.
    setCourses(null)
    setError(null)
  }

  /** Toggle a single-select chip: clicking the active one clears it (optional fields). */
  function toggle<T extends string>(
    current: T | null,
    value: T,
    set: (v: T | null) => void
  ) {
    set(current === value ? null : value)
  }

  /** Applies a finished CourseResult to the UI (shared by all completion paths). */
  function applyResult(data: CourseResult) {
    if (data.ok && data.courses.length > 0) {
      setCourses(data.courses)
      setActiveTab(data.courses[0].id)
    } else {
      setError((data as { error?: string }).error || t.courseErrFail)
    }
  }

  async function runCourse() {
    if (loading) return

    const mode = panelMode
    const runId = ++runIdRef.current
    setLoading(true)
    setResultMode(mode)
    setCourses(null)
    setError(null)
    setTimedOut(false)

    const body: Record<string, unknown> = {
      mode: mode === 'custom' ? 'custom' : 'standard',
      query: query.trim(),
      duration,
      area: area === '상관없음' ? undefined : area,
      locale,
    }
    if (mode === 'custom') {
      if (companion) body.companion = companion
      if (ageGroup) body.ageGroup = ageGroup
      const n = parseInt(groupSize, 10)
      if (Number.isFinite(n) && n > 0) body.groupSize = n
    }

    try {
      // 1. Kick off the job — returns a jobId in <200ms (compute runs server-side).
      const kickRes = await fetch('/api/jeju/tourist-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const kick = (await kickRes.json()) as KickoffResult
      if (!kick.ok || !kick.jobId) {
        if (runId === runIdRef.current) {
          setError((kick as { error?: string }).error || t.courseErrFail)
        }
        return
      }
      const jobId = kick.jobId

      // 2. Poll for the persisted result. Transient poll failures (e.g. connection
      //    dropped while the phone is backgrounded) are ignored so the next poll
      //    recovers — the result lives in the job row, not the connection.
      const startedAt = Date.now()
      while (Date.now() - startedAt < MAX_POLL_MS) {
        await delay(POLL_INTERVAL_MS)
        if (runId !== runIdRef.current) return // superseded by a newer run

        let poll: PollResult | null = null
        try {
          const pollRes = await fetch(
            `/api/jeju/tourist-course?jobId=${encodeURIComponent(jobId)}`,
            { cache: 'no-store' }
          )
          poll = (await pollRes.json()) as PollResult
        } catch {
          continue // network hiccup / backgrounded — retry on the next tick
        }
        if (runId !== runIdRef.current) return

        if (!poll.ok) continue // transient (e.g. 404 before the row is visible)
        if (poll.status === 'pending') continue
        if (poll.status === 'error') {
          setError(poll.error || t.courseErrFail)
          return
        }
        // status === 'done'
        applyResult(poll.result)
        return
      }

      // Exceeded the poll ceiling — offer a retry (same UX as the old timeout).
      if (runId === runIdRef.current) setTimedOut(true)
    } catch {
      if (runId === runIdRef.current) setError(t.errConnection)
    } finally {
      if (runId === runIdRef.current) setLoading(false)
    }
  }

  const active = courses?.find((c) => c.id === activeTab) ?? courses?.[0] ?? null
  const isCustom = panelMode === 'custom'

  return (
    <section className="mt-6">
      {/* Input panel */}
      <div className="rounded-[22px] bg-gradient-to-br from-[#E7FBFD] to-[#EFEAFE] p-4 shadow-[0_12px_34px_-16px_rgba(0,112,122,0.5)] ring-1 ring-[#00A8B5]/15 sm:p-5">
        {/* MODE TOGGLE */}
        <div className="grid grid-cols-2 gap-2">
          {([
            {
              key: 'custom' as PanelMode,
              emoji: '✏️',
              title: t.courseModeCustomTitle,
              sub: t.courseModeCustomSub,
            },
            {
              key: 'standard' as PanelMode,
              emoji: '✨',
              title: t.courseModeStandardTitle,
              sub: t.courseModeStandardSub,
            },
          ]).map((opt) => {
            const selected = panelMode === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => switchPanelMode(opt.key)}
                className={`rounded-[16px] px-3 py-2.5 text-left transition-all ${
                  selected
                    ? 'bg-white shadow-[0_8px_20px_-10px_rgba(0,112,122,0.6)] ring-2 ring-[#00A8B5]'
                    : 'bg-white/55 ring-1 ring-[#00A8B5]/10 hover:bg-white/80'
                }`}
              >
                <span
                  className={`text-[14px] font-extrabold ${selected ? 'text-[#0A2B30]' : 'text-[#5A7176]'}`}
                >
                  <span aria-hidden>{opt.emoji}</span> {opt.title}
                </span>
                <span
                  className={`mt-0.5 block text-[10.5px] font-semibold leading-snug ${
                    selected ? 'text-[#00707A]' : 'text-[#9AAAAD]'
                  }`}
                >
                  {opt.sub}
                </span>
              </button>
            )
          })}
        </div>

        {/* Free-text — 맞춤 mode only */}
        {isCustom && (
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={3}
            placeholder={t.coursePlaceholder}
            className="mt-4 w-full resize-none rounded-[16px] bg-white px-4 py-3 text-[14px] font-medium leading-relaxed text-[#0A2B30] placeholder:text-[#00A8B5]/55 shadow-sm ring-1 ring-[#00A8B5]/10 focus:outline-none focus:ring-2 focus:ring-[#00A8B5]/40"
          />
        )}

        {/* duration toggle (both modes) */}
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-bold text-[#5A7176]">{t.courseDuration}</p>
          <div className="inline-flex rounded-full bg-white/70 p-1 shadow-sm ring-1 ring-[#00A8B5]/10">
            {(['반나절', '하루'] as Duration[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                className={`rounded-full px-4 py-1.5 text-[13px] font-bold transition-colors ${
                  duration === d
                    ? 'bg-[#00A8B5] text-white shadow-sm'
                    : 'text-[#00707A] hover:bg-white'
                }`}
              >
                {durationLabel(d, t)}
              </button>
            ))}
          </div>
        </div>

        {/* area selector (both modes) */}
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-bold text-[#5A7176]">{t.courseArea}</p>
          <div className="flex flex-wrap gap-1.5">
            {AREAS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setArea(a)}
                className={`rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors ${
                  area === a
                    ? 'bg-[#6B4FB8] text-white shadow-sm'
                    : 'bg-white/70 text-[#5B3EA8] ring-1 ring-[#6B4FB8]/15 hover:bg-white'
                }`}
              >
                {areaLabel(a, t)}
              </button>
            ))}
          </div>
        </div>

        {/* Mode 1 (맞춤)-only optional inputs */}
        {isCustom && (
          <>
            <div className="mt-3">
              <p className="mb-1.5 text-[11px] font-bold text-[#5A7176]">{t.courseCompanion}</p>
              <div className="flex flex-wrap gap-1.5">
                {COMPANIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggle(companion, c, setCompanion)}
                    className={`rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors ${
                      companion === c
                        ? 'bg-[#00A8B5] text-white shadow-sm'
                        : 'bg-white/70 text-[#00707A] ring-1 ring-[#00A8B5]/15 hover:bg-white'
                    }`}
                  >
                    {companionLabel(c, t)}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <p className="mb-1.5 text-[11px] font-bold text-[#5A7176]">{t.courseAge}</p>
              <div className="flex flex-wrap gap-1.5">
                {AGE_GROUPS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggle(ageGroup, g, setAgeGroup)}
                    className={`rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors ${
                      ageGroup === g
                        ? 'bg-[#00A8B5] text-white shadow-sm'
                        : 'bg-white/70 text-[#00707A] ring-1 ring-[#00A8B5]/15 hover:bg-white'
                    }`}
                  >
                    {ageLabel(g, t)}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <p className="mb-1.5 text-[11px] font-bold text-[#5A7176]">{t.courseGroupSize}</p>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={groupSize}
                  onChange={(e) => setGroupSize(e.target.value)}
                  placeholder={t.groupSizePlaceholder}
                  className="w-24 rounded-full bg-white px-3.5 py-1.5 text-[13px] font-bold text-[#0A2B30] placeholder:text-[#00A8B5]/45 shadow-sm ring-1 ring-[#00A8B5]/10 focus:outline-none focus:ring-2 focus:ring-[#00A8B5]/40"
                />
                <span className="text-[12px] font-semibold text-[#5A7176]">{t.groupSizeUnit}</span>
              </div>
            </div>
          </>
        )}

        {/* submit */}
        <button
          type="button"
          onClick={runCourse}
          disabled={loading}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-[16px] bg-gradient-to-r from-[#00A8B5] to-[#6B4FB8] px-4 py-3 text-[15px] font-extrabold text-white shadow-[0_10px_24px_-10px_rgba(107,79,184,0.7)] transition-opacity disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={18} className="animate-spin" aria-hidden />
          ) : (
            <Wand2 size={18} aria-hidden />
          )}
          {loading
            ? t.courseSubmitLoading
            : isCustom
              ? t.courseSubmitCustom
              : t.courseSubmitStandard}
        </button>
      </div>

      {/* Loading state — reassuring, animated */}
      {loading && (
        <div className="mt-5 flex flex-col items-center gap-3 rounded-[22px] bg-white/70 p-8 text-center backdrop-blur">
          <div className="relative flex h-14 w-14 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-[#00A8B5]/20" />
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#00A8B5] to-[#6B4FB8] text-white shadow-lg">
              <Sparkles size={26} aria-hidden />
            </span>
          </div>
          <p className="text-[14px] font-bold text-[#00707A]">
            {loadingSteps[stepIdx % loadingSteps.length]}
          </p>
          <p className="text-[11px] font-medium text-slate-400">
            {t.courseLoadingNote}
          </p>
        </div>
      )}

      {/* Error */}
      {!loading && timedOut && (
        <div className="mt-5 flex flex-col items-center gap-3 rounded-[20px] bg-white/80 px-6 py-6 text-center shadow-sm backdrop-blur">
          <p className="text-sm font-semibold text-[#00707A]">{t.retryMessage}</p>
          <button
            type="button"
            onClick={runCourse}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#00A8B5] px-5 py-2 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            <RefreshCw size={14} aria-hidden />
            {t.retryButton}
          </button>
        </div>
      )}

      {!loading && !timedOut && error && (
        <div className="mt-5 flex items-center gap-2 rounded-[18px] bg-[#FFF3DC] px-4 py-3.5 text-sm font-semibold text-[#B84A00]">
          <span aria-hidden>🍊</span>
          {error}
        </div>
      )}

      {/* Results — tabs + timeline (2 tabs for 맞춤, 4 for 추천) */}
      {!loading && courses && courses.length > 0 && active && (
        <div className="mt-5">
          {/* tabs */}
          <div className="flex flex-wrap gap-2">
            {courses.map((c, i) => {
              const selected = c.id === active.id
              const label =
                resultMode === 'custom' ? c.theme : standardTabLabel(c.id, t) ?? c.theme
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveTab(c.id)}
                  className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-extrabold transition-all ${
                    selected
                      ? 'bg-[#00A8B5] text-white shadow-[0_8px_18px_-8px_rgba(0,112,122,0.8)]'
                      : 'bg-white text-[#00707A] shadow-sm ring-1 ring-[#00A8B5]/15 hover:-translate-y-0.5'
                  }`}
                >
                  <span aria-hidden>
                    {resultMode === 'custom' ? `${i + 1}` : STANDARD_TAB_EMOJI[c.id]}
                  </span>
                  <span className="truncate">{label}</span>
                </button>
              )
            })}
          </div>

          {/* selected course detail */}
          <div className="mt-4">
            <h3 className="mb-3 text-[17px] font-extrabold tracking-tight text-[#0A2B30]">
              {active.theme}
            </h3>
            <CourseTimeline course={active} />
          </div>
        </div>
      )}
    </section>
  )
}
