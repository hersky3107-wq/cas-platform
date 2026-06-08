'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '@/lib/db/supabase'
import {
  firstTimeContent,
  detectFirstTimeLocale,
  type FirstTimeLocale,
} from '@/lib/firsttime/content'

const MODAL_LANGUAGES: { code: FirstTimeLocale; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'ko', label: '한국어' },
  { code: 'ja', label: '日本語' },
  { code: 'zh-TW', label: '繁中' },
  { code: 'fr', label: 'Français' },
  { code: 'ar', label: 'العربية' },
]

type FirstTimeControls = {
  open: () => void
}

const FirstTimeCtx = createContext<FirstTimeControls | null>(null)

export function useFirstTimeHereOptional(): FirstTimeControls | null {
  return useContext(FirstTimeCtx)
}

type SlideId = number | 'terms' | 'privacy' | 'refund'

const ONBOARDING_SLIDE_COUNT = 5
const LAST_ONBOARDING_SLIDE = 4

function isOnboardingSlide(slide: SlideId): slide is number {
  return typeof slide === 'number'
}

function PolicySection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="space-y-2 text-slate-300">
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <div className="text-sm leading-relaxed">{children}</div>
    </section>
  )
}

function SlideDots({ active, total }: { active: number; total: number }) {
  return (
    <div className="flex justify-center gap-2 pt-2" role="tablist" aria-label="Onboarding slides">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full transition-colors ${
            i === active ? 'bg-cyan-400' : 'bg-white/25'
          }`}
          aria-current={i === active ? 'true' : undefined}
        />
      ))}
    </div>
  )
}

function FirstTimeModal({
  open,
  onDismiss,
  initialLocale,
}: {
  open: boolean
  onDismiss: () => void
  initialLocale: FirstTimeLocale
}) {
  const [slide, setSlide] = useState<SlideId>(0)
  const [locale, setLocale] = useState<FirstTimeLocale>(initialLocale)
  const content = firstTimeContent[locale] ?? firstTimeContent['en']
  const onPolicySlide = !isOnboardingSlide(slide)
  const onboardingIndex = isOnboardingSlide(slide) ? slide : LAST_ONBOARDING_SLIDE
  const lastSlide = onboardingIndex === LAST_ONBOARDING_SLIDE

  const backToSetup = useCallback(() => {
    setSlide(LAST_ONBOARDING_SLIDE)
  }, [])

  useEffect(() => {
    if (open) {
      setSlide(0)
      setLocale(initialLocale)
    }
  }, [open, initialLocale])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (onPolicySlide) {
        backToSetup()
        return
      }
      onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onDismiss, onPolicySlide, backToSetup])

  const goNext = useCallback(() => {
    setSlide((s) => (isOnboardingSlide(s) ? Math.min(LAST_ONBOARDING_SLIDE, s + 1) : s))
  }, [])

  const goPrev = useCallback(() => {
    setSlide((s) => (isOnboardingSlide(s) ? Math.max(0, s - 1) : s))
  }, [])

  if (!open) return null

  const activePolicies =
    slide === 'terms'
      ? content.policies.terms
      : slide === 'privacy'
        ? content.policies.privacy
        : slide === 'refund'
          ? content.policies.refund
          : null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-time-heading"
    >
      <div className="relative flex max-h-[min(90vh,800px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-[#0f1629] shadow-2xl ring-1 ring-white/10">
        {!onPolicySlide ? (
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
            <div className="flex items-center gap-0.5 overflow-x-auto">
              {MODAL_LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => setLocale(lang.code)}
                  className={[
                    'shrink-0 rounded-full px-2 py-1 text-[10px] font-medium transition-all',
                    locale === lang.code
                      ? 'bg-cyan-500/20 text-cyan-300'
                      : 'text-slate-500 hover:text-slate-300',
                  ].join(' ')}
                >
                  {lang.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/10 hover:text-white"
            >
              {content.nav.skip}
            </button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Slide 1 */}
          {slide === 0 ? (
            <div className="space-y-4 text-slate-200">
              <p className="text-center text-[11px] leading-relaxed text-amber-200/90">
                {content.slide0.chromeNote}
              </p>
              <h2 id="first-time-heading" className="text-center text-xl font-semibold text-white">
                {content.slide0.title}
              </h2>
              <p className="text-center text-sm font-medium text-cyan-200/95">
                {content.slide0.subtitle}
              </p>
              <p className="text-sm leading-relaxed text-slate-300">
                {content.slide0.body1}
              </p>
              <p className="text-sm leading-relaxed text-slate-300">
                {content.slide0.body2}
              </p>
              <p className="text-sm leading-relaxed text-slate-300">
                {content.slide0.body3}
              </p>
              <p className="text-center text-sm font-semibold text-white">
                {content.slide0.tagline}
              </p>
              <p className="text-center text-base font-semibold text-white">
                {content.slide0.headline}
              </p>
              <p className="text-xs leading-relaxed text-slate-500">
                {content.slide0.description}
              </p>
              <p className="text-center text-sm text-emerald-300/95">
                {content.slide0.credits}
              </p>
            </div>
          ) : null}

          {/* Slide 2 */}
          {slide === 1 ? (
            <div className="space-y-4 text-slate-200">
              <h2 id="first-time-heading" className="text-center text-xl font-semibold text-white">
                {content.slide1.title}
              </h2>
              <div className="space-y-4 text-sm leading-relaxed text-slate-300">
                {content.slide1.ais.map((entry, idx) => (
                  <div key={idx}>
                    <p className="font-medium text-slate-200">{entry.heading}</p>
                    <p className="mt-1">{entry.body}</p>
                  </div>
                ))}
              </div>
              <p className="text-center text-sm font-medium text-white">
                {content.slide1.closing}
              </p>
              <p className="text-center text-xs text-slate-500">
                {content.slide1.disclaimer}
              </p>
              <p className="text-xs leading-relaxed text-slate-500">
                {content.slide1.lineup}
              </p>
            </div>
          ) : null}

          {/* Slide 3 */}
          {slide === 2 ? (
            <div className="space-y-4 text-slate-200">
              <h2 id="first-time-heading" className="text-center text-xl font-semibold text-white">
                {content.slide2.title}
              </h2>
              <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-slate-300">
                {content.slide2.modules.map((line, idx) => (
                  <li key={idx}>{line}</li>
                ))}
              </ol>
            </div>
          ) : null}

          {/* Slide 4 */}
          {slide === 3 ? (
            <div className="space-y-4 text-slate-200">
              <h2 id="first-time-heading" className="text-center text-xl font-semibold text-white">
                {content.slide3.title}
              </h2>
              <p className="text-sm leading-relaxed text-slate-300">
                {content.slide3.body}
              </p>
              <p className="text-center text-sm font-medium text-cyan-200">{content.slide3.closing}</p>
            </div>
          ) : null}

          {/* Slide 5 */}
          {slide === 4 ? (
            <div className="space-y-4 text-slate-200">
              <h2 id="first-time-heading" className="text-center text-xl font-semibold text-white">
                {content.slide4.title}
              </h2>
              <p className="text-center text-sm">
                <a
                  href="mailto:support@aimani.ai"
                  className="font-medium text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
                >
                  support@aimani.ai
                </a>
              </p>
              <p className="text-sm leading-relaxed text-slate-300">
                {content.slide4.body1}
              </p>
              <p className="text-sm leading-relaxed text-slate-300">
                {content.slide4.pwa}
              </p>
              <p className="text-center text-xs text-slate-500">
                {content.slide4.handdrawn}
              </p>
              <p className="text-xs leading-relaxed text-slate-400">
                {content.slide4.aiwarning}
              </p>
              <p className="text-center text-xs leading-relaxed text-slate-600">
                {content.slide4.response}
              </p>
              <p className="text-xs leading-relaxed text-slate-400">
                {content.slide4.legalPrefix}
                <button
                  type="button"
                  onClick={() => setSlide('terms')}
                  className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
                >
                  {content.slide4.legalTerms}
                </button>
                {content.slide4.legalSep1}
                <button
                  type="button"
                  onClick={() => setSlide('privacy')}
                  className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
                >
                  {content.slide4.legalPrivacy}
                </button>
                {content.slide4.legalSep2}
                <button
                  type="button"
                  onClick={() => setSlide('refund')}
                  className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
                >
                  {content.slide4.legalRefund}
                </button>
                {content.slide4.legalSuffix}
              </p>
            </div>
          ) : null}

          {activePolicies ? (
            <div className="space-y-4 text-slate-200">
              <button
                type="button"
                onClick={backToSetup}
                className="text-sm font-medium text-cyan-300 hover:text-cyan-200"
              >
                {content.nav.backToSetup}
              </button>
              <div className="space-y-6 text-slate-200">
                <p className="text-sm text-slate-400">{activePolicies.lastUpdated}</p>
                <h2 className="text-2xl font-semibold text-white">{activePolicies.title}</h2>
                {activePolicies.sections.map((section, idx) => (
                  <PolicySection key={idx} title={section.title}>
                    <p>{section.body}</p>
                  </PolicySection>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {!onPolicySlide ? (
          <SlideDots active={onboardingIndex} total={ONBOARDING_SLIDE_COUNT} />
        ) : null}

        {!onPolicySlide ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
            <button
              type="button"
              onClick={goPrev}
              disabled={onboardingIndex === 0}
              className="rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30"
            >
              {content.nav.previous}
            </button>

            {!lastSlide ? (
              <button
                type="button"
                onClick={goNext}
                className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
              >
                {content.nav.next}
              </button>
            ) : (
              <button
                type="button"
                onClick={onDismiss}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                {content.nav.getStarted}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function FirstTimeHereProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [locale, setLocale] = useState<FirstTimeLocale>('en')

  useEffect(() => {
    const detected = detectFirstTimeLocale()
    const hasContent = firstTimeContent[detected] && firstTimeContent[detected].nav
    setLocale(hasContent ? detected : 'en')
  }, [])

  const markSeen = useCallback(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('users').update({ show_onboarding: false }).eq('id', user.id)
    })()
    setOpen(false)
  }, [])

  const openManual = useCallback(() => setOpen(true), [])

  const dismiss = useCallback(() => {
    markSeen()
  }, [markSeen])

  const value = useMemo(() => ({ open: openManual }), [openManual])

  return (
    <FirstTimeCtx.Provider value={value}>
      {children}
      <FirstTimeModal open={open} onDismiss={dismiss} initialLocale={locale} />
    </FirstTimeCtx.Provider>
  )
}
