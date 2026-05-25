import Link from 'next/link'

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-10 text-white">
      <div className="mx-auto max-w-2xl space-y-8">
        <Link href="/" className="text-sm text-cyan-300/90 hover:text-cyan-200">
          ← Back to home
        </Link>
        <p className="text-sm text-slate-400">Last updated: May 2026</p>
        <h1 className="text-3xl font-semibold">Terms of Service</h1>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">1. Acceptance of Terms</h2>
          <p className="text-sm leading-relaxed">
            By accessing or using AIMANI, you agree to be bound by these Terms of Service. If you do not
            agree, do not use the Service.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">2. Eligibility</h2>
          <p className="text-sm leading-relaxed">
            You must be at least 14 years old to use the Service. Users under 18 require parental or
            guardian consent for paid transactions.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">3. Credits System</h2>
          <p className="text-sm leading-relaxed">
            Credits are the in-service currency used to access AIMANI modules. Subscription credits reset
            monthly with no rollover. Pay-as-you-go credits are valid for 3 months from the date of
            purchase and roll over within that period. Credits cannot be transferred to other users or
            exchanged for cash. Credit consumption varies depending on the selected AI model, module,
            prompt length, and response length. Estimated credit usage will be displayed before execution
            when possible. Subscription credits are consumed first, followed by pay-as-you-go credits.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">4. Payments</h2>
          <p className="text-sm leading-relaxed">
            All payments are processed via our payment partners, including PayPal and Lemon Squeezy. Prices
            are displayed in USD. AIMANI reserves the right
            to change pricing at any time with reasonable notice.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">5. Refunds</h2>
          <p className="text-sm leading-relaxed">
            Please refer to our Refund Policy for full details.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">6. AI Disclaimer</h2>
          <p className="text-sm leading-relaxed">
            AIMANI provides AI-generated content for informational and entertainment purposes only. AI
            responses do not constitute legal, medical, financial, tax, or psychological professional advice.
            We do not guarantee the accuracy, completeness, or reliability of any AI response. AIMANI is not
            liable for decisions made based on AI-generated content.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">7. Service Availability</h2>
          <p className="text-sm leading-relaxed">
            AIMANI uses third-party AI providers. Your prompts and AI responses are transmitted to
            third-party AI providers (OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral) to generate
            responses. We are not responsible for interruptions, errors, or discontinuation of specific AI
            models due to provider-side issues. No refunds will be issued for such interruptions.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">8. Prohibited Use</h2>
          <p className="text-sm leading-relaxed">
            You agree not to: use the Service for illegal purposes, attempt to manipulate or
            reverse-engineer the platform, create multiple accounts to abuse free credits, use the Service
            to generate harmful or illegal content.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">9. Account Suspension</h2>
          <p className="text-sm leading-relaxed">
            AIMANI reserves the right to suspend or terminate accounts found in violation of these Terms,
            including forfeiture of unused credits.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">10. Changes to Terms</h2>
          <p className="text-sm leading-relaxed">
            We may update these Terms at any time. Continued use of the Service constitutes acceptance of
            the updated Terms.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">11. Contact</h2>
          <p className="text-sm leading-relaxed">hersky3107@gmail.com</p>
        </section>
      </div>
    </main>
  )
}
