"use client";

import Link from "next/link";
import HelpModal from "@/components/HelpModal";
import { verdictHelpContent } from "@/lib/help-modal/verdict-content";
import { ChevronLeft, Star, ThumbsDown, ThumbsUp, Trophy } from "lucide-react";

const submodes = [
  {
    id: "score",
    name: "SCORE",
    accent: "from-amber-300 to-yellow-600",
    content: (
      <>
        <Star className="h-12 w-12 text-white" />
        <span className="mt-1 text-[10px] font-medium text-white/85">?/100</span>
      </>
    ),
  },
  {
    id: "vote",
    name: "VOTE",
    accent: "from-emerald-400 to-green-700",
    content: (
      <div className="flex items-center gap-1">
        <ThumbsUp className="h-9 w-9 text-white" />
        <ThumbsDown className="h-9 w-9 text-white" />
      </div>
    ),
  },
  {
    id: "rank",
    name: "RANK",
    accent: "from-violet-400 to-purple-700",
    content: <Trophy className="h-12 w-12 text-white" />,
  },
  {
    id: "predict",
    name: "PREDICT",
    accent: "from-[#EF4444] to-[#EF4444]",
    content: (
      <div className="flex flex-col items-center pt-1.5">
        <span className="text-5xl leading-none" aria-hidden>
          📊
        </span>
        <span className="mt-1 text-base font-semibold leading-none text-white/90">%</span>
      </div>
    ),
  },
  {
    id: "factcheck",
    name: "FACT CHECK",
    accent: "from-[#06B6D4] to-[#06B6D4]",
    content: (
      <>
        <span className="text-5xl leading-none" aria-hidden>
          🔍
        </span>
        <span className="mt-1 text-xs font-medium text-white/85">T/F</span>
      </>
    ),
  },
] as const;

export default function VerdictPage() {
  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-12 text-white">
      <HelpModal content={verdictHelpContent} />
      <div className="mx-auto w-full max-w-3xl">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-2 text-sm text-white/90 transition hover:bg-white/14"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Link>

        <h1 className="mt-6 text-center text-xl font-bold text-white">Panel</h1>

        <div className="flex min-h-[calc(100vh-120px)] items-center justify-center">
          <div className="grid grid-cols-2 justify-items-center gap-10">
            {submodes.map((submode, idx) => (
              <Link
                key={submode.id}
                href={`/modes/verdict/${submode.id}`}
                className={`flex flex-col items-center ${
                  idx === submodes.length - 1 && submodes.length % 2 === 1 ? "col-span-2" : ""
                }`}
              >
                <div
                  className={`flex h-[96px] w-[96px] items-center justify-center rounded-2xl bg-gradient-to-br ${submode.accent} shadow-[0_10px_24px_rgba(0,0,0,0.35)]`}
                >
                  <div className="flex flex-col items-center">{submode.content}</div>
                </div>
                <span className="mt-2 text-xs font-semibold tracking-[0.18em] text-white">
                  {submode.name}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
