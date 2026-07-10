'use client'

/**
 * ResidentLoading — reusable staged-progress loader for resident mode.
 *
 * Props:
 *   steps     - array of messages to cycle through (held on the last one)
 *   intervalMs - how long to show each step before advancing (default 10000ms)
 *   ttsSupported - whether to narrate (caller passes its own ttsSupported state)
 *
 * Accessibility:
 *   - Large text (≥24px heading), centred, high-contrast
 *   - Animated dots — disabled under prefers-reduced-motion (text changes only)
 *   - aria-live="polite" so screen-readers hear step changes
 *   - Narrates once on mount; stops on unmount
 */

import { useEffect, useRef, useState } from 'react'

const C = {
  bg: '#FBF4E6',
  surface: '#FFFFFF',
  ink: '#12263A',
  sea: '#0E4E8A',
  inkSoft: '#3C4C60',
}

interface ResidentLoadingProps {
  steps?: string[]
  intervalMs?: number
  ttsSupported?: boolean
}

export function ResidentLoading({
  steps = ['잠시만 기다려 주세요'],
  intervalMs = 10000,
  ttsSupported = false,
}: ResidentLoadingProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [dotCount, setDotCount] = useState(0)
  const [progress, setProgress] = useState(0)
  /** Detected after mount — never read window during render (SSR-safe). */
  const [reducedMotion, setReducedMotion] = useState(false)
  const hasNarrated = useRef(false)

  const progressDurationMs = steps.length * intervalMs
  const progressCap = 90
  const reducedMotionProgress = 40

  // Client-only: reduced-motion preference (must not run during SSR/first paint).
  useEffect(() => {
    try {
      setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    } catch {
      setReducedMotion(false)
    }
  }, [])

  // Advance through steps (hold on last step until unmount)
  useEffect(() => {
    if (steps.length <= 1) return
    const id = setInterval(() => {
      setStepIndex((i) => (i < steps.length - 1 ? i + 1 : i))
    }, intervalMs)
    return () => clearInterval(id)
  }, [steps, intervalMs])

  // Creep progress toward cap over ~one full step cycle; never reaches 100% on timer
  useEffect(() => {
    if (reducedMotion) {
      setProgress(reducedMotionProgress)
      return
    }

    const start = performance.now()
    let frameId = 0

    const tick = (now: number) => {
      const t = Math.min((now - start) / progressDurationMs, 1)
      const eased = 1 - (1 - t) ** 2
      setProgress(eased * progressCap)
      if (t < 1) frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [reducedMotion, progressDurationMs, progressCap, reducedMotionProgress])

  // Animate dots (3 states: 1 / 2 / 3)
  useEffect(() => {
    if (reducedMotion) return
    const id = setInterval(() => setDotCount((d) => (d + 1) % 4), 600)
    return () => clearInterval(id)
  }, [reducedMotion])

  // Narrate once on mount
  useEffect(() => {
    if (!ttsSupported || hasNarrated.current || typeof window === 'undefined') return
    hasNarrated.current = true
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(
        `잠시만 기다려 주세요. ${steps[0] ?? ''}`
      )
      u.lang = 'ko-KR'
      u.rate = 0.9
      window.speechSynthesis.speak(u)
    } catch {
      /* no-op */
    }
    return () => {
      try { window.speechSynthesis.cancel() } catch { /* no-op */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentStep = steps[stepIndex] ?? ''
  const dots = reducedMotion ? '' : '·'.repeat(dotCount)

  return (
    <div style={ld.root} aria-live="polite" aria-label={`로딩 중: ${currentStep}`}>
      <style>{LOADING_CSS}</style>

      {/* Progress dots visual */}
      {!reducedMotion && (
        <div style={ld.dotsRow} aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="rl-dot"
              style={{
                ...ld.dot,
                background: i < dotCount ? C.sea : '#BFD9F5',
                transform: i < dotCount ? 'scale(1.25)' : 'scale(1)',
              }}
            />
          ))}
        </div>
      )}

      <h2 style={ld.heading}>잠시만 기다려 주세요</h2>

      <p style={ld.step}>
        {currentStep}
        {dots && <span aria-hidden>{dots}</span>}
      </p>

      {/* Progress bar — eases toward 90% then holds; never signals "done" before result */}
      <div
        style={ld.barTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-valuetext={currentStep}
        aria-label="처리 중"
      >
        <div
          style={{
            ...ld.barFill,
            width: `${progress}%`,
          }}
        />
      </div>

      <p style={ld.sub}>시간이 조금 걸려요. 편히 기다려 주세요.</p>
    </div>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────────

const ld: Record<string, React.CSSProperties> = {
  root: {
    background: C.surface,
    borderRadius: 20,
    padding: '36px 24px 40px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 20,
    boxShadow: '0 6px 22px rgba(15,34,51,0.10)',
  },
  dotsRow: {
    display: 'flex',
    gap: 14,
    alignItems: 'center',
  },
  dot: {
    display: 'inline-block',
    width: 18,
    height: 18,
    borderRadius: '50%',
    transition: 'background 0.3s ease, transform 0.3s ease',
  },
  heading: {
    fontSize: 32,
    fontWeight: 900,
    color: C.ink,
    margin: 0,
    textAlign: 'center',
    lineHeight: 1.25,
  },
  step: {
    fontSize: 24,
    fontWeight: 700,
    color: C.sea,
    margin: 0,
    textAlign: 'center',
    lineHeight: 1.5,
    minHeight: '2.2em',
  },
  barTrack: {
    width: '100%',
    height: 12,
    background: '#BFD9F5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    background: C.sea,
    borderRadius: 8,
  },
  sub: {
    fontSize: 20,
    color: C.inkSoft,
    margin: 0,
    textAlign: 'center',
  },
}

const LOADING_CSS = `
  .rl-dot { transition: background 0.3s ease, transform 0.3s ease; }
  @media (prefers-reduced-motion: reduce) {
    .rl-dot { transition: none !important; }
  }
`
