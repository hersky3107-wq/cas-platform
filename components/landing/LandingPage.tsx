import Link from "next/link";
import { LandingContent, Locale, LANGUAGE_OPTIONS } from "@/lib/landing/content";

interface Props {
  content: LandingContent;
  locale: Locale;
}

export default function LandingPage({ content, locale }: Props) {
  const { hero, modules, useCases, pitch, philosophy, finalCta, footer } = content;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0a0f1e] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(34,211,238,0.12),transparent)]" aria-hidden />
      <div className="pointer-events-none absolute -right-32 top-1/3 h-96 w-96 rounded-full bg-violet-600/10 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -left-24 bottom-1/4 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" aria-hidden />

      {/* Language Switcher — fixed top-right */}
      <div className="fixed top-3 right-3 z-50 sm:top-4 sm:right-4">
        <div className="flex items-center gap-0.5 rounded-full border border-white/[0.12] bg-black/60 px-1.5 py-1 backdrop-blur-md">
          {LANGUAGE_OPTIONS.map((lang, i) => (
            <span key={lang.code} className="flex items-center">
              <Link
                href={lang.href}
                aria-current={locale === lang.code ? "page" : undefined}
                className={[
                  "rounded-full px-2.5 py-1 text-[11px] font-medium transition-all duration-150 sm:px-3 sm:text-xs",
                  locale === lang.code
                    ? "bg-cyan-500/20 text-cyan-300"
                    : "text-slate-400 hover:text-slate-100",
                ].join(" ")}
              >
                {lang.label}
              </Link>
              {i < LANGUAGE_OPTIONS.length - 1 && (
                <span className="select-none text-[9px] text-white/15" aria-hidden>·</span>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Hero */}
      <section className="relative mx-auto max-w-4xl px-6 pb-20 pt-24 text-center sm:px-8 sm:pt-32">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300/80">{hero.brand}</p>
        <h1 className="mt-6 text-4xl font-black leading-[1.1] tracking-tight sm:text-5xl md:text-6xl">
          {hero.headlinePre}{" "}
          <span className="bg-gradient-to-r from-cyan-300 via-sky-200 to-violet-300 bg-clip-text text-transparent">
            {hero.headlineAccent}
          </span>{" "}
          {hero.headlinePost}
        </h1>
        <p className="mt-4 text-xl font-bold text-white sm:text-2xl">{hero.subheadline}</p>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">{hero.body}</p>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg">{hero.practical}</p>
        <Link
          href="/auth"
          className="mt-10 inline-flex rounded-full bg-gradient-to-r from-cyan-400 to-teal-500 px-8 py-4 text-sm font-bold text-slate-950 shadow-[0_0_40px_rgba(34,211,238,0.35)] transition hover:brightness-110 active:scale-[0.98]"
        >
          {hero.cta}
        </Link>
      </section>

      {/* Modules */}
      <section className="relative mx-auto max-w-6xl px-6 py-16 sm:px-8">
        <h2 className="text-center text-2xl font-bold tracking-tight text-white sm:text-3xl">{modules.sectionTitle}</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-slate-500">{modules.sectionSub}</p>
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.items.map((mod) => (
            <article key={mod.name} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-cyan-400/25 hover:bg-white/[0.06]">
              <span className="text-2xl" aria-hidden>{mod.emoji}</span>
              <h3 className="mt-3 text-lg font-semibold text-white">{mod.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{mod.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Use Cases */}
      <section className="relative mx-auto max-w-4xl px-6 py-16 sm:px-8">
        <h2 className="text-center text-2xl font-bold tracking-tight text-white sm:text-3xl">{useCases.sectionTitle}</h2>
        <ul className="mx-auto mt-12 max-w-2xl space-y-6">
          {useCases.items.map((item) => (
            <li key={item.title} className="flex gap-4 text-left">
              <span className="mt-0.5 shrink-0 text-xl" aria-hidden>{item.emoji}</span>
              <div>
                <p className="font-semibold text-white">{item.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-400 sm:text-base">{item.desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Pitch */}
      <section className="relative mx-auto max-w-3xl px-6 py-16 text-center sm:px-8">
        <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{pitch.title}</h2>
        <ul className="mx-auto mt-10 max-w-2xl space-y-6 text-base leading-relaxed text-slate-300 sm:text-lg">
          {pitch.bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      </section>

      {/* Philosophy */}
      <section className="relative mx-auto max-w-3xl px-6 py-20 text-center sm:px-8">
        <p className="text-lg leading-relaxed text-slate-200 sm:text-xl">{philosophy.main}</p>
        <p className="mt-8 text-lg font-semibold text-slate-100 sm:text-xl">{philosophy.emphasis}</p>
        <p className="mt-8 text-xl font-semibold text-cyan-200/90 sm:text-2xl">{philosophy.closing}</p>
      </section>

      {/* Final CTA */}
      <section className="relative mx-auto max-w-2xl px-6 pb-24 text-center sm:px-8">
        <p className="text-lg font-medium text-emerald-200/95">{finalCta.offer}</p>
        <Link
          href="/auth"
          className="mt-8 inline-flex rounded-full border border-cyan-400/50 bg-cyan-500/15 px-10 py-4 text-sm font-bold uppercase tracking-wider text-cyan-100 transition hover:bg-cyan-500/25"
        >
          {finalCta.button}
        </Link>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-white/[0.08] px-6 py-10 text-center sm:px-8">
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-slate-500">
          <Link href="/terms" className="transition hover:text-slate-300">{footer.terms}</Link>
          <span className="text-white/20" aria-hidden>·</span>
          <Link href="/privacy" className="transition hover:text-slate-300">{footer.privacy}</Link>
          <span className="text-white/20" aria-hidden>·</span>
          <Link href="/refund" className="transition hover:text-slate-300">{footer.refund}</Link>
          <span className="text-white/20" aria-hidden>·</span>
          <a href="mailto:support@aimani.ai" className="transition hover:text-slate-300">support@aimani.ai</a>
        </nav>
        <p className="mx-auto mt-6 max-w-lg text-[10px] leading-relaxed text-slate-600">{footer.disclaimer}</p>
      </footer>
    </main>
  );
}
