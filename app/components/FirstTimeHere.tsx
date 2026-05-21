'use client'

import Link from 'next/link'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export const AIMANI_FIRST_TIME_STORAGE_KEY = 'aimani_first_time_seen'

type FirstTimeControls = {
  open: () => void
}

const FirstTimeCtx = createContext<FirstTimeControls | null>(null)

export function useFirstTimeHereOptional(): FirstTimeControls | null {
  return useContext(FirstTimeCtx)
}

const SLIDE_AI_LINES: string[] = [
  '🇺🇸 ChatGPT — OpenAI. CEO Sam Altman. The AI that started the revolution. The most widely used AI in the world. Altman is one of Silicon Valley\'s most famous — and most controversial — CEOs.',
  '🇺🇸 Claude — Anthropic. CEO Dario Amodei. Built by researchers who left OpenAI over safety concerns. Dario Amodei and Sam Altman have publicly clashed — at a summit with India\'s Prime Minister, the two reportedly refused to shake hands for a group photo. Two CEOs. One industry. Zero agreement.',
  '🇺🇸 Gemini — Google DeepMind. The company that literally invented the transformer technology behind all modern AI — yet got blindsided by ChatGPT. Google declared an internal emergency and came back swinging. Now deeply embedded across Android and all Google services.',
  '🇺🇸 Grok — xAI. CEO Elon Musk. The man behind Tesla, SpaceX, and X. Co-founded OpenAI with Sam Altman in 2015 — then walked away. Eventually sued Altman, claiming he betrayed their shared mission of building AI for humanity. A jury ruled against Musk just days ago. He\'s already vowed to appeal. The most unfiltered AI in the game. The most anti-OpenAI voice in the room.',
  '🇫🇷 Mistral — Mistral AI. Paris, France. Europe\'s answer to American AI dominance. Built to reflect European values, European regulation, and European independence. Not Silicon Valley. Not Beijing. Paris.',
  '🇨🇳 DeepSeek — DeepSeek AI. Hangzhou, China. Founder Liang Wenfeng. A hedge fund built an AI — and shocked the world. Burst onto the scene in early 2025 and crashed U.S. tech stocks overnight. OpenAI accused them of stealing its technology. DeepSeek denied it. The U.S.-China AI war has a face now.',
]

const SLIDE_MODULES: string[] = [
  'Compare — Ask the same question to all 6 AIs at once. You can choose which AIs to include — same answers or completely different ones, see for yourself.',
  'Persona — Assign a role or character to each AI. Get answers from different perspectives, viewpoints, and professional expertise.',
  'Panel — AIs score, vote, rank, predict, and fact-check. Five tools, one conclusion. | Score: See it rated and scored | Vote: The AIs cast their votes. What will they choose? | Rank: All 6 AIs ranked in order | Predict: Probability and outcome prediction | Fact Check: Truth vs. fiction',
  'Arena — 6 AIs battle over your topic. Logic Battle or Street Fight — pure AI combat, two ways.',
  'SUIT — A full courtroom drama. AI lawyers argue. An AI judge delivers the verdict. Watch the trial unfold.',
  'Custom — When you don\'t need the complexity. Ask one or two AIs simply and quickly — almost like a search engine. Or go deep with full system prompt control for power users.',
  'DEEP — Depth and volume no other AI can match. From a quick brief to a full report.',
  'Oracle — Daily fortune, tarot, astrology and more. 6 AIs each read your future differently. No birth time needed. A full fortune experience without the price tag.',
  'Mindgame — AIs deceive and betray each other. Who can you trust? | Career: A zombie infection is spreading among the AIs. More humans than zombies means victory. Find the infected and stop the spread! | Wolf: Who is the wolf hiding among the AIs?',
  'Stage — Creative performances by AI. | Comedy Talk: AI tiki-taka banter, talk shows, and stand-up comedy | TALE: AI storytelling — Horror, Romance, Absurd, Sci-Fi, Fairy Tale, Sad Story and more | Archive: A vault of AI creative works',
]

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
}: {
  open: boolean
  onDismiss: () => void
}) {
  const [slide, setSlide] = useState(0)
  const total = 5
  const lastSlide = slide === total - 1

  useEffect(() => {
    if (open) setSlide(0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onDismiss])

  const goNext = useCallback(() => {
    setSlide((s) => Math.min(total - 1, s + 1))
  }, [total])

  const goPrev = useCallback(() => {
    setSlide((s) => Math.max(0, s - 1))
  }, [])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-time-heading"
    >
      <div className="relative flex max-h-[min(90vh,800px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-[#0f1629] shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center justify-end gap-2 border-b border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/10 hover:text-white"
          >
            Skip
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Slide 1 */}
          {slide === 0 ? (
            <div className="space-y-4 text-slate-200">
              <p className="text-center text-[11px] leading-relaxed text-amber-200/90">
                For the best experience in your language, use Chrome&apos;s built-in auto-translate.
              </p>
              <h2 id="first-time-heading" className="text-center text-xl font-semibold text-white">
                We had a simple question.
              </h2>
              <p className="text-center text-sm font-medium text-cyan-200/95">
                Why do we only talk to one AI at a time?
              </p>
              <p className="text-sm leading-relaxed text-slate-300">
                Every AI thinks differently. GPT is precise. Claude is thoughtful. Gemini is fast. Grok is
                blunt. DeepSeek surprises you. Mistral challenges everyone. We built AIMANI because the
                real intelligence doesn&apos;t come from one answer — it comes from the friction between all
                of them.
              </p>
              <p className="text-sm leading-relaxed text-slate-300">
                Research consistently shows that multiple perspectives outperform any single expert. Same
                goes for AI.
              </p>
              <p className="text-sm leading-relaxed text-slate-300">
                Ask. Compare. Watch them fight, collaborate, and surprise you. Decide for yourself.
              </p>
              <p className="text-center text-sm font-semibold text-white">
                AIMANI — Where AI meets AI.
              </p>
              <p className="text-center text-sm text-emerald-300/95">
                🎁 You&apos;ve received 30 free credits to get started. No card required.
              </p>
            </div>
          ) : null}

          {/* Slide 2 */}
          {slide === 1 ? (
            <div className="space-y-4 text-slate-200">
              <h2 id="first-time-heading" className="text-center text-xl font-semibold text-white">
                Six AIs. Six countries. Six agendas.
              </h2>
              <ul className="space-y-3 text-sm leading-relaxed text-slate-300">
                {SLIDE_AI_LINES.map((line, idx) => (
                  <li key={idx}>{line}</li>
                ))}
              </ul>
              <p className="text-center text-sm font-medium text-white">
                Same question. Six minds. Always something to discover.
              </p>
              <p className="text-xs leading-relaxed text-slate-500">
                Our AI lineup will continue to grow. Agents may also be updated or replaced over time.
                Thank you for your understanding.
              </p>
            </div>
          ) : null}

          {/* Slide 3 */}
          {slide === 2 ? (
            <div className="space-y-4 text-slate-200">
              <h2 id="first-time-heading" className="text-center text-xl font-semibold text-white">
                Every module. One platform.
              </h2>
              <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed text-slate-300">
                {SLIDE_MODULES.map((line, idx) => (
                  <li key={idx}>{line}</li>
                ))}
              </ol>
            </div>
          ) : null}

          {/* Slide 4 */}
          {slide === 3 ? (
            <div className="space-y-4 text-slate-200">
              <h2 id="first-time-heading" className="text-center text-xl font-semibold text-white">
                AIMANI never stops growing.
              </h2>
              <p className="text-sm leading-relaxed text-slate-300">
                New modules drop on the 1st, 10th, and 20th of every month. Creative, unexpected, and wildly
                different ways to experience AI — we keep finding them. Bookmark it. Come back. Something new
                is always waiting.
              </p>
              <p className="text-center text-sm font-medium text-cyan-200">The AIs have more to say.</p>
            </div>
          ) : null}

          {/* Slide 5 */}
          {slide === 4 ? (
            <div className="space-y-4 text-slate-200">
              <h2 id="first-time-heading" className="text-center text-xl font-semibold text-white">
                Something wrong? We&apos;re here.
              </h2>
              <p className="text-sm leading-relaxed text-slate-300">
                Bug, error, payment issue, refund request — whatever it is, reach out. We respond fast.
              </p>
              <p className="text-center text-sm">
                <a
                  href="mailto:hersky3107@gmail.com"
                  className="font-medium text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
                >
                  hersky3107@gmail.com
                </a>
              </p>
              <p className="text-sm leading-relaxed text-slate-300">
                We take every message seriously. If something broke, we want to know. If you were charged and
                shouldn&apos;t have been, we&apos;ll make it right.
              </p>
              <p className="text-sm leading-relaxed text-slate-300">
                📱 Install AIMANI on your home screen for the fastest experience. On mobile: tap Share → Add
                to Home Screen. On desktop: click the install icon in your browser address bar.
              </p>
              <p className="text-sm leading-relaxed text-amber-200/95">
                ⚠️ If your antivirus shows a warning during PWA installation, it&apos;s safe to proceed. This is
                common with PWA apps in Korea and some regions. Tap Allow to continue.
              </p>
              <p className="text-xs leading-relaxed text-slate-400">
                By using AIMANI, you agree to our{' '}
                <Link href="/terms" className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200">
                  Terms of Service
                </Link>{' '}
                /{' '}
                <Link
                  href="/privacy"
                  className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
                >
                  Privacy Policy
                </Link>{' '}
                /{' '}
                <Link href="/refund" className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200">
                  Refund Policy
                </Link>
              </p>
            </div>
          ) : null}
        </div>

        <SlideDots active={slide} total={total} />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
          <button
            type="button"
            onClick={goPrev}
            disabled={slide === 0}
            className="rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30"
          >
            Previous
          </button>

          {!lastSlide ? (
            <button
              type="button"
              onClick={goNext}
              className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Get Started
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function hasSeenFirstTimeHere(): boolean {
  try {
    return localStorage.getItem(AIMANI_FIRST_TIME_STORAGE_KEY) !== null
  } catch {
    return true
  }
}

export function FirstTimeHereProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const autoOpenChecked = useRef(false)

  useEffect(() => {
    if (autoOpenChecked.current) return
    autoOpenChecked.current = true
    if (!hasSeenFirstTimeHere()) {
      setOpen(true)
    }
  }, [])

  const markSeen = useCallback(() => {
    try {
      localStorage.setItem(AIMANI_FIRST_TIME_STORAGE_KEY, '1')
    } catch {
      /* ignore */
    }
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
      <FirstTimeModal open={open} onDismiss={dismiss} />
    </FirstTimeCtx.Provider>
  )
}
