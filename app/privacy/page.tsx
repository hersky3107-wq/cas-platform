import Link from 'next/link'

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-10 text-white">
      <div className="mx-auto max-w-2xl space-y-8">
        <Link href="/" className="text-sm text-cyan-300/90 hover:text-cyan-200">
          ← Back to home
        </Link>
        <p className="text-sm text-slate-400">Last updated: May 2026</p>
        <h1 className="text-3xl font-semibold">Privacy Policy</h1>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">1. Information We Collect</h2>
          <p className="text-sm leading-relaxed">
            Account information: email address, display name. Usage data: modules used, prompts submitted,
            AI responses received. Payment data: transaction records via our payment partners including
            PayPal and Lemon Squeezy (we do not store card details). Technical data: IP address, browser
            type, device information.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">2. How We Use Your Information</h2>
          <p className="text-sm leading-relaxed">
            To provide and improve the Service. To process payments and manage credits. To send
            service-related emails. To analyze usage patterns and improve AI module performance. To maintain
            platform security and prevent abuse.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">3. Data Storage</h2>
          <p className="text-sm leading-relaxed">
            Your data is stored securely via Supabase (PostgreSQL). We implement industry-standard security
            measures to protect your information.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">4. Third-Party Services</h2>
          <p className="text-sm leading-relaxed">
            AIMANI uses the following third-party services: Supabase (database and authentication), PayPal
            and Lemon Squeezy (payment processing), OpenAI, Anthropic, Google, xAI,
            DeepSeek, Mistral (AI response generation
            — your prompts are transmitted to these providers to generate responses), Vercel (hosting), Resend
            (email). Each provider operates under their own privacy policy.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">5. Data Sharing</h2>
          <p className="text-sm leading-relaxed">
            We do not sell your personal data. We do not share your data with third parties except as
            required to operate the Service or comply with legal obligations.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">6. Your Rights</h2>
          <p className="text-sm leading-relaxed">
            You have the right to access your personal data, request deletion of your account and data, and
            opt out of non-essential communications. Contact: hersky3107@gmail.com
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">7. Cookies</h2>
          <p className="text-sm leading-relaxed">
            AIMANI uses essential cookies for authentication and session management. No advertising cookies
            are used.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">8. Children&apos;s Privacy</h2>
          <p className="text-sm leading-relaxed">
            AIMANI is not intended for children under 14. We do not knowingly collect data from children
            under 14 without parental consent.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">9. Changes</h2>
          <p className="text-sm leading-relaxed">
            We may update this Privacy Policy at any time. We will notify users of significant changes via
            email or in-service notice.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">10. Contact</h2>
          <p className="text-sm leading-relaxed">hersky3107@gmail.com</p>
        </section>
      </div>
    </main>
  )
}
