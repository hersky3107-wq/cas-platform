import Link from "next/link";

const MODULES = [
  {
    emoji: "🗣️",
    name: "Compare",
    desc: "Same question. Six answers. See where they agree and where they clash.",
  },
  {
    emoji: "🎭",
    name: "Persona",
    desc: "Assign each AI a role. Six experts. One question.",
  },
  {
    emoji: "⚖️",
    name: "Panel",
    desc: "AIs score, vote, rank, predict, and fact-check.",
  },
  {
    emoji: "⚔️",
    name: "Arena",
    desc: "9-round AI battle. Logic Battle or Street Fight. No referee.",
  },
  {
    emoji: "🔧",
    name: "Custom",
    desc: "Quick questions or deep system prompts. You control the depth.",
  },
  {
    emoji: "🔬",
    name: "DEEP",
    desc: "Six parallel analyses + one synthesized report.",
  },
  {
    emoji: "🔮",
    name: "Oracle",
    desc: "Six AIs read your fortune. Tarot, astrology, daily reading.",
  },
  {
    emoji: "🧠",
    name: "Mindgame",
    desc: "AIs deceive each other. Zombie infection. Wolf game.",
  },
  {
    emoji: "🎬",
    name: "Stage",
    desc: "AI comedy shows, stand-up sets, and storytelling.",
  },
] as const;

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0a0f1e] text-white">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(34,211,238,0.12),transparent)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-32 top-1/3 h-96 w-96 rounded-full bg-violet-600/10 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -left-24 bottom-1/4 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl"
        aria-hidden
      />

      {/* Hero */}
      <section className="relative mx-auto max-w-4xl px-6 pb-20 pt-24 text-center sm:px-8 sm:pt-32">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300/80">
          AIMANI
        </p>
        <h1 className="mt-6 text-4xl font-black leading-[1.1] tracking-tight sm:text-5xl md:text-6xl">
          One question.{" "}
          <span className="bg-gradient-to-r from-cyan-300 via-sky-200 to-violet-300 bg-clip-text text-transparent">
            Six AI minds.
          </span>{" "}
          Zero consensus.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
          Ask anything. Watch ChatGPT, Claude, Gemini, Grok, DeepSeek, and Mistral respond,
          disagree, and fight it out — live.
        </p>
        <Link
          href="/auth"
          className="mt-10 inline-flex rounded-full bg-gradient-to-r from-cyan-400 to-teal-500 px-8 py-4 text-sm font-bold text-slate-950 shadow-[0_0_40px_rgba(34,211,238,0.35)] transition hover:brightness-110 active:scale-[0.98]"
        >
          Try AIMANI Free — No card required
        </Link>
      </section>

      {/* Modules */}
      <section className="relative mx-auto max-w-6xl px-6 py-16 sm:px-8">
        <h2 className="text-center text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Nine ways to experience collective AI intelligence
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-slate-500">
          New modules drop on the 1st, 10th, and 20th of every month.
        </p>
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((mod) => (
            <article
              key={mod.name}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-cyan-400/25 hover:bg-white/[0.06]"
            >
              <span className="text-2xl" aria-hidden>
                {mod.emoji}
              </span>
              <h3 className="mt-3 text-lg font-semibold text-white">{mod.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{mod.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Philosophy */}
      <section className="relative mx-auto max-w-3xl px-6 py-20 text-center sm:px-8">
        <p className="text-lg leading-relaxed text-slate-200 sm:text-xl">
          Most AI tools give you a result. AIMANI gives you the full picture — the process, the
          friction, the disagreement, and the collective intelligence behind every answer.
        </p>
        <p className="mt-8 text-xl font-semibold text-cyan-200/90 sm:text-2xl">
          One question. Six minds. The answer lives somewhere in the middle.
        </p>
      </section>

      {/* CTA */}
      <section className="relative mx-auto max-w-2xl px-6 pb-24 text-center sm:px-8">
        <p className="text-lg font-medium text-emerald-200/95">🎁 30 free credits. No card required.</p>
        <Link
          href="/auth"
          className="mt-8 inline-flex rounded-full border border-cyan-400/50 bg-cyan-500/15 px-10 py-4 text-sm font-bold uppercase tracking-wider text-cyan-100 transition hover:bg-cyan-500/25"
        >
          Start for Free
        </Link>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-white/8 px-6 py-10 text-center sm:px-8">
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-slate-500">
          <Link href="/terms" className="transition hover:text-slate-300">
            Terms of Service
          </Link>
          <span className="text-white/20" aria-hidden>
            ·
          </span>
          <Link href="/privacy" className="transition hover:text-slate-300">
            Privacy Policy
          </Link>
          <span className="text-white/20" aria-hidden>
            ·
          </span>
          <Link href="/refund" className="transition hover:text-slate-300">
            Refund Policy
          </Link>
          <span className="text-white/20" aria-hidden>
            ·
          </span>
          <a
            href="mailto:support@aimani.ai"
            className="transition hover:text-slate-300"
          >
            support@aimani.ai
          </a>
        </nav>
        <p className="mx-auto mt-6 max-w-lg text-[10px] leading-relaxed text-slate-600">
          AIMANI is an independent platform connecting multiple AI providers. Not affiliated
          with OpenAI, Anthropic, Google, xAI, Mistral AI, or DeepSeek.
        </p>
      </footer>
    </main>
  );
}
