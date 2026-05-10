import Link from "next/link";
import { ChevronLeft } from "lucide-react";

const BG =
  "min-h-screen bg-gray-950 text-zinc-100 selection:bg-violet-500/25";

export default function MindgameLobbyPage() {
  return (
    <main className={BG}>
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-10 sm:px-6 lg:max-w-5xl lg:py-14">
        <header className="mb-12 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Link
              href="/"
              className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </Link>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-zinc-500">
                Modes
              </p>
              <h1 className="mt-1 text-3xl font-black tracking-tight text-white sm:text-4xl">
                MINDGAME
              </h1>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
                Deception. Deduction. Betrayal.
              </p>
            </div>
          </div>
        </header>

        <section className="grid flex-1 grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          <Link
            href="/modes/mindgame/wolf"
            className="group relative flex min-h-[280px] flex-col rounded-2xl border border-amber-500/35 bg-gradient-to-br from-amber-950/40 to-gray-950/80 p-6 shadow-[0_20px_50px_rgba(0,0,0,0.45)] ring-1 ring-white/5 transition hover:border-amber-400/55 hover:shadow-[0_24px_60px_rgba(251,191,36,0.12)] md:min-h-[320px] md:p-8"
          >
            <span className="text-4xl" aria-hidden>
              🐺
            </span>
            <h2 className="mt-4 text-2xl font-black tracking-tight text-white">
              WOLF
            </h2>
            <p className="mt-3 flex-1 text-sm leading-relaxed text-zinc-400 group-hover:text-zinc-300">
              One AI is secretly the Wolf. Find the liar through debate,
              accusation, and cold logic.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {["Deduction", "Social", "6 Players"].map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-black/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200/90 ring-1 ring-amber-500/25"
                >
                  {tag}
                </span>
              ))}
            </div>
            <span className="mt-6 text-xs font-semibold uppercase tracking-wider text-amber-400/90 transition group-hover:text-amber-300">
              Enter →
            </span>
          </Link>

          <div className="relative flex min-h-[280px] flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 opacity-70 md:min-h-[320px] md:p-8">
            <span className="absolute right-4 top-4 rounded-full bg-zinc-800 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 ring-1 ring-white/10">
              Coming Soon
            </span>
            <span className="text-4xl" aria-hidden>
              ⚡
            </span>
            <h2 className="mt-4 text-2xl font-black tracking-tight text-zinc-500">
              DILEMMA
            </h2>
            <p className="mt-3 flex-1 text-sm leading-relaxed text-zinc-600">
              Six AIs face impossible moral choices. Watch them argue. Then
              decide for yourself.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {["Philosophy", "Ethics", "Debate"].map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-black/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 ring-1 ring-white/5"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
