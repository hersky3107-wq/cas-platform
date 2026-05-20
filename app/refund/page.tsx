import Link from 'next/link'

export default function RefundPage() {
  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-10 text-white">
      <div className="mx-auto max-w-2xl space-y-8">
        <Link href="/" className="text-sm text-cyan-300/90 hover:text-cyan-200">
          ← Back to home
        </Link>
        <p className="text-sm text-slate-400">Last updated: May 2026</p>
        <h1 className="text-3xl font-semibold">Refund Policy</h1>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">1. General Policy</h2>
          <p className="text-sm leading-relaxed">
            All purchases of credits are final and non-refundable once credits have been used, except where
            required by applicable law or in cases of payment error, duplicate charge, or failure to deliver
            purchased credits.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">2. Exception — New Users</h2>
          <p className="text-sm leading-relaxed">
            If you are a new user and have not used any credits, you may request a full refund within 24
            hours of your first purchase by contacting hersky3107@gmail.com. For users in the EU or UK,
            digital content withdrawal rights may apply. By completing a purchase and using credits, you
            acknowledge that digital content delivery has begun and you waive your right of withdrawal to
            the extent permitted by applicable law.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">3. Non-Refundable Cases</h2>
          <p className="text-sm leading-relaxed">
            The following are not eligible for refunds except where required by applicable law: partially
            used credit packages, subscription credits (monthly reset, no rollover), credits lost due to
            account suspension for Terms of Service violations, service interruptions caused by third-party
            AI provider issues.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">4. Payment Errors</h2>
          <p className="text-sm leading-relaxed">
            If you were charged incorrectly, experienced a duplicate charge, or purchased credits were not
            delivered to your account, contact us immediately at hersky3107@gmail.com. We will investigate
            and resolve within 3 business days. These cases are eligible for refund regardless of the
            general policy above.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">5. Subscription Cancellation</h2>
          <p className="text-sm leading-relaxed">
            Cancelling a subscription stops future billing. Credits remaining at cancellation are available
            until the end of the current billing period and will not be refunded.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">6. Process</h2>
          <p className="text-sm leading-relaxed">
            To request a refund, email hersky3107@gmail.com with: your account email, date of purchase,
            amount charged, and reason for request. We aim to respond within 24 hours.
          </p>
        </section>

        <section className="space-y-2 text-slate-300">
          <h2 className="text-lg font-semibold text-white">7. Changes</h2>
          <p className="text-sm leading-relaxed">
            AIMANI reserves the right to update this Refund Policy at any time.
          </p>
        </section>
      </div>
    </main>
  )
}
