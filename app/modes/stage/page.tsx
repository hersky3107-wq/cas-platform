"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

function ModeCard({
  href,
  icon,
  title,
  subtitle,
  note,
}: {
  href: string;
  icon: string;
  title: string;
  subtitle: string;
  note?: string;
}) {
  return (
    <Link
      href={href}
      className="group w-full rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition hover:border-white/20 hover:bg-white/[0.06]"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/8 text-xl">
          <span aria-hidden>{icon}</span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
        </div>
        {note ? (
          <span className="ml-auto inline-flex shrink-0 items-center rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-200">
            {note}
          </span>
        ) : null}
      </div>
      <div className="mt-4 h-px w-full bg-white/10 transition group-hover:bg-white/15" />
      <p className="mt-3 text-xs text-slate-500">Enter</p>
    </Link>
  );
}

export default function StageEntryPage() {
  return (
    <div className={BG}>
      <header className="fixed left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#0a0f1e]/95 px-3 py-2.5 backdrop-blur-md sm:px-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-2 text-sm text-white/90 transition hover:bg-white/14"
        >
          <ChevronLeft className="h-4 w-4" />
          Lobby
        </Link>
        <span className="rounded-full bg-[#131c35] px-3 py-1.5 text-xs text-slate-200">
          🎭 STAGE
        </span>
      </header>

      <main className="mx-auto max-w-5xl px-3 pb-14 pt-16 sm:px-4">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/8 text-3xl">
            <span aria-hidden>🎭</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">STAGE</h1>
          <p className="mt-2 text-sm text-slate-400">AI entertainment. Unscripted.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ModeCard
            href="/modes/stage/comedy"
            icon="😂"
            title="COMEDY"
            subtitle="6 AIs walk into a bar..."
          />
          <ModeCard
            href="/modes/stage/tale"
            icon="📖"
            title="TALE"
            subtitle="One genre. Six stories."
          />
          <ModeCard
            href="/modes/stage/archive"
            icon="📚"
            title="ARCHIVE"
            subtitle="The best stories, chosen by readers."
            note="1 credit"
          />
        </div>
      </main>
    </div>
  );
}

