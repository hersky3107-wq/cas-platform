'use client'

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

function TermsPolicyContent() {
  return (
    <div className="space-y-6 text-slate-200">
      <p className="text-sm text-slate-400">Last updated: May 2026</p>
      <h2 className="text-2xl font-semibold text-white">Terms of Service</h2>
      <PolicySection title="1. Acceptance of Terms">
        <p>
          By accessing or using AIMANI, you agree to be bound by these Terms of Service. If you do not agree,
          do not use the Service.
        </p>
      </PolicySection>
      <PolicySection title="2. Eligibility">
        <p>
          You must be at least 14 years old to use the Service. Users under 18 require parental or guardian
          consent for paid transactions.
        </p>
      </PolicySection>
      <PolicySection title="3. Credits System">
        <p>
          Credits are the in-service currency used to access AIMANI modules. Subscription credits reset monthly
          with no rollover. Pay-as-you-go credits are valid for 3 months from the date of purchase and roll over
          within that period. Credits cannot be transferred to other users or exchanged for cash. Credit
          consumption varies depending on the selected AI model, module, prompt length, and response length.
          Estimated credit usage will be displayed before execution when possible. Subscription credits are
          consumed first, followed by pay-as-you-go credits.
        </p>
      </PolicySection>
      <PolicySection title="4. Payments">
        <p>
          All payments are processed via our payment partners, including PayPal and Lemon Squeezy. Prices are
          displayed in USD. AIMANI reserves the right to change pricing at any time with reasonable notice.
        </p>
      </PolicySection>
      <PolicySection title="5. Refunds">
        <p>Please refer to our Refund Policy for full details.</p>
      </PolicySection>
      <PolicySection title="6. AI Disclaimer">
        <p>
          AIMANI provides AI-generated content for informational and entertainment purposes only. AI responses
          do not constitute legal, medical, financial, tax, or psychological professional advice. We do not
          guarantee the accuracy, completeness, or reliability of any AI response. AIMANI is not liable for
          decisions made based on AI-generated content.
        </p>
      </PolicySection>
      <PolicySection title="7. Service Availability">
        <p>
          AIMANI uses third-party AI providers. Your prompts and AI responses are transmitted to third-party
          AI providers (OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral) to generate responses. We are not
          responsible for interruptions, errors, or discontinuation of specific AI models due to provider-side
          issues. No refunds will be issued for such interruptions.
        </p>
      </PolicySection>
      <PolicySection title="8. Prohibited Use">
        <p>
          You agree not to: use the Service for illegal purposes, attempt to manipulate or reverse-engineer the
          platform, create multiple accounts to abuse free credits, use the Service to generate harmful or
          illegal content.
        </p>
      </PolicySection>
      <PolicySection title="9. Account Suspension">
        <p>
          AIMANI reserves the right to suspend or terminate accounts found in violation of these Terms,
          including forfeiture of unused credits.
        </p>
      </PolicySection>
      <PolicySection title="10. Changes to Terms">
        <p>
          We may update these Terms at any time. Continued use of the Service constitutes acceptance of the
          updated Terms.
        </p>
      </PolicySection>
      <PolicySection title="11. Contact">
        <p>hersky3107@gmail.com</p>
      </PolicySection>
    </div>
  )
}

function PrivacyPolicyContent() {
  return (
    <div className="space-y-6 text-slate-200">
      <p className="text-sm text-slate-400">Last updated: May 2026</p>
      <h2 className="text-2xl font-semibold text-white">Privacy Policy</h2>
      <PolicySection title="1. Information We Collect">
        <p>
          Account information: email address, display name. Usage data: modules used, prompts submitted, AI
          responses received. Payment data: transaction records via PayPal (we do not store card details).
          Technical data: IP address, browser type, device information.
        </p>
      </PolicySection>
      <PolicySection title="2. How We Use Your Information">
        <p>
          To provide and improve the Service. To process payments and manage credits. To send service-related
          emails. To analyze usage patterns and improve AI module performance. To maintain platform security
          and prevent abuse.
        </p>
      </PolicySection>
      <PolicySection title="3. Data Storage">
        <p>
          Your data is stored securely via Supabase (PostgreSQL). We implement industry-standard security
          measures to protect your information.
        </p>
      </PolicySection>
      <PolicySection title="4. Third-Party Services">
        <p>
          AIMANI uses the following third-party services: Supabase (database and authentication), PayPal
          (payment processing), Lemon Squeezy (payment processing), OpenAI, Anthropic, Google, xAI, DeepSeek,
          Mistral (AI response generation — your prompts are transmitted to these providers to generate
          responses), Vercel (hosting), Resend (email). Each provider operates under their own privacy policy.
        </p>
      </PolicySection>
      <PolicySection title="5. Data Sharing">
        <p>
          We do not sell your personal data. We do not share your data with third parties except as required to
          operate the Service or comply with legal obligations.
        </p>
      </PolicySection>
      <PolicySection title="6. Your Rights">
        <p>
          You have the right to access your personal data, request deletion of your account and data, and opt
          out of non-essential communications. Contact: hersky3107@gmail.com
        </p>
      </PolicySection>
      <PolicySection title="7. Cookies">
        <p>
          AIMANI uses essential cookies for authentication and session management. No advertising cookies are
          used.
        </p>
      </PolicySection>
      <PolicySection title="8. Children&apos;s Privacy">
        <p>
          AIMANI is not intended for children under 14. We do not knowingly collect data from children under 14
          without parental consent.
        </p>
      </PolicySection>
      <PolicySection title="9. Changes">
        <p>
          We may update this Privacy Policy at any time. We will notify users of significant changes via email
          or in-service notice.
        </p>
      </PolicySection>
      <PolicySection title="10. Contact">
        <p>hersky3107@gmail.com</p>
      </PolicySection>
    </div>
  )
}

function RefundPolicyContent() {
  return (
    <div className="space-y-6 text-slate-200">
      <p className="text-sm text-slate-400">Last updated: May 2026</p>
      <h2 className="text-2xl font-semibold text-white">Refund Policy</h2>
      <PolicySection title="1. General Policy">
        <p>
          All purchases of credits are final and non-refundable once credits have been used, except where required
          by applicable law or in cases of payment error, duplicate charge, or failure to deliver purchased
          credits.
        </p>
      </PolicySection>
      <PolicySection title="2. Exception — New Users">
        <p>
          If you are a new user and have not used any credits, you may request a full refund within 24 hours of
          your first purchase by contacting hersky3107@gmail.com. For users in the EU or UK, digital content
          withdrawal rights may apply. By completing a purchase and using credits, you acknowledge that digital
          content delivery has begun and you waive your right of withdrawal to the extent permitted by
          applicable law.
        </p>
      </PolicySection>
      <PolicySection title="3. Non-Refundable Cases">
        <p>
          The following are not eligible for refunds except where required by applicable law: partially used
          credit packages, subscription credits (monthly reset, no rollover), credits lost due to account
          suspension for Terms of Service violations, service interruptions caused by third-party AI provider
          issues.
        </p>
      </PolicySection>
      <PolicySection title="4. Payment Errors">
        <p>
          If you were charged incorrectly, experienced a duplicate charge, or purchased credits were not
          delivered to your account, contact us immediately at hersky3107@gmail.com. We will investigate and
          resolve within 3 business days. These cases are eligible for refund regardless of the general policy
          above.
        </p>
      </PolicySection>
      <PolicySection title="5. Subscription Cancellation">
        <p>
          Cancelling a subscription stops future billing. Credits remaining at cancellation are available until
          the end of the current billing period and will not be refunded.
        </p>
      </PolicySection>
      <PolicySection title="6. Process">
        <p>
          To request a refund, email hersky3107@gmail.com with: your account email, date of purchase, amount
          charged, and reason for request. We aim to respond within 24 hours.
        </p>
      </PolicySection>
      <PolicySection title="7. Changes">
        <p>AIMANI reserves the right to update this Refund Policy at any time.</p>
      </PolicySection>
    </div>
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
}: {
  open: boolean
  onDismiss: () => void
}) {
  const [slide, setSlide] = useState<SlideId>(0)
  const onPolicySlide = !isOnboardingSlide(slide)
  const onboardingIndex = isOnboardingSlide(slide) ? slide : LAST_ONBOARDING_SLIDE
  const lastSlide = onboardingIndex === LAST_ONBOARDING_SLIDE

  const backToSetup = useCallback(() => {
    setSlide(LAST_ONBOARDING_SLIDE)
  }, [])

  useEffect(() => {
    if (open) setSlide(0)
  }, [open])

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

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-time-heading"
    >
      <div className="relative flex max-h-[min(90vh,800px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-[#0f1629] shadow-2xl ring-1 ring-white/10">
        {!onPolicySlide ? (
          <div className="flex items-center justify-end gap-2 border-b border-white/10 px-4 py-3">
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/10 hover:text-white"
            >
              Skip
            </button>
          </div>
        ) : null}

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
                <button
                  type="button"
                  onClick={() => setSlide('terms')}
                  className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
                >
                  Terms of Service
                </button>{' '}
                /{' '}
                <button
                  type="button"
                  onClick={() => setSlide('privacy')}
                  className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
                >
                  Privacy Policy
                </button>{' '}
                /{' '}
                <button
                  type="button"
                  onClick={() => setSlide('refund')}
                  className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
                >
                  Refund Policy
                </button>
              </p>
            </div>
          ) : null}

          {slide === 'terms' ? (
            <div className="space-y-4 text-slate-200">
              <button
                type="button"
                onClick={backToSetup}
                className="text-sm font-medium text-cyan-300 hover:text-cyan-200"
              >
                ← Back to setup
              </button>
              <TermsPolicyContent />
            </div>
          ) : null}

          {slide === 'privacy' ? (
            <div className="space-y-4 text-slate-200">
              <button
                type="button"
                onClick={backToSetup}
                className="text-sm font-medium text-cyan-300 hover:text-cyan-200"
              >
                ← Back to setup
              </button>
              <PrivacyPolicyContent />
            </div>
          ) : null}

          {slide === 'refund' ? (
            <div className="space-y-4 text-slate-200">
              <button
                type="button"
                onClick={backToSetup}
                className="text-sm font-medium text-cyan-300 hover:text-cyan-200"
              >
                ← Back to setup
              </button>
              <RefundPolicyContent />
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
        ) : null}
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
