"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Sparkles } from "lucide-react";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

export default function OracleLandingPage() {
  const router = useRouter();
  const [showLobby, setShowLobby] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/oracle/profile").catch(() => null);
      if (cancelled) return;

      if (res?.ok) {
        const j = (await res.json().catch(() => null)) as {
          profile?: unknown | null;
          complete?: boolean;
        };
        const hasProfile = j?.profile != null && typeof j.profile === "object";
        if (!hasProfile || !j?.complete) {
          router.replace("/modes/oracle/profile");
          return;
        }
      }

      if (!cancelled) setShowLobby(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!showLobby) {
    return <main className={BG} />;
  }

  return (
    <main className={BG}>
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 pb-32 pt-10 sm:px-8">
        <Link
          href="/"
          className="mb-8 text-[11px] uppercase tracking-[0.22em] text-cyan-200/85 hover:text-cyan-100"
        >
          ← Lobby home
        </Link>

        <div className="mb-10 flex justify-center">
          <div className="relative flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-3xl shadow-[0_10px_40px_rgba(0,0,0,0.45)] bg-white/[0.04] ring-1 ring-white/15">
            <Image
              src="/icons/oracle.png"
              alt=""
              fill
              className="object-contain p-2"
              sizes="96px"
              style={{ filter: "brightness(0.85)" }}
            />
          </div>
        </div>

        <h1 className="text-center text-4xl font-semibold tracking-tight sm:text-5xl">
          Oracle
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-center text-sm text-slate-300">
          Saju pillars, tropical Sun / Moon / Rising, tarot spreads, and your daily
          fortune — all in one place.
        </p>

        <p className="mx-auto mt-4 max-w-md text-center text-[11px] text-white/38">
          Tip: Use Chrome&apos;s built-in translation for your language
        </p>

        <nav className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/modes/oracle/fate"
            className="group flex min-h-[220px] flex-col justify-between rounded-[26px] border border-[#f5d4a088] bg-[#261a08]/95 p-6 shadow-xl transition hover:border-amber-200/60 hover:bg-[#2f220f]/95"
          >
            <div>
              <span className="mb-4 block text-[32px] leading-none text-[#c9a84c]" aria-hidden>
                ☯
              </span>
              <span className="text-lg font-semibold tracking-tight text-amber-50">
                Fate
              </span>
              <span className="mt-2 block text-sm text-slate-200/95">
                Eastern timing and hour pillar, five readers in parallel, one warm
                synthesis.
              </span>
            </div>
            <span className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-amber-200/95 group-hover:text-amber-100">
              Continue <ChevronRight className="h-4 w-4" aria-hidden />
            </span>
          </Link>

          <Link
            href="/modes/oracle/astro"
            className="group flex min-h-[220px] flex-col justify-between rounded-[26px] border border-cyan-400/30 bg-[#0c1826]/98 p-6 shadow-xl transition hover:border-cyan-200/55 hover:bg-[#0f1f34]/98"
          >
            <div>
              <Sparkles className="mb-4 block h-7 w-7 text-cyan-200" aria-hidden />
              <span className="text-lg font-semibold tracking-tight text-cyan-50">
                Astro
              </span>
              <span className="mt-2 block text-sm text-slate-200/95">
                Geocoded birthplace, tropical Sun · Moon · Ascendant chart block for
                the models.
              </span>
            </div>
            <span className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-cyan-200/95 group-hover:text-cyan-100">
              Continue{" "}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </span>
          </Link>

          <Link
            href="/modes/oracle/tarot"
            className="group flex min-h-[220px] flex-col justify-between rounded-[26px] border border-fuchsia-400/25 bg-[#1a1430]/90 p-6 shadow-xl transition hover:border-fuchsia-200/55 hover:bg-[#21173d]/90"
          >
            <div>
              <span className="mb-4 block h-8 w-8 overflow-hidden rounded-lg bg-fuchsia-500/15">
                <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">
                  <defs>
                    <linearGradient id="tarotCardIconBg" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#b16cff" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#c9a84c" stopOpacity="0.18" />
                    </linearGradient>
                  </defs>
                  <rect
                    x="6"
                    y="4.5"
                    width="20"
                    height="23"
                    rx="4"
                    fill="url(#tarotCardIconBg)"
                    stroke="#c9a84c"
                    strokeOpacity="0.7"
                  />
                  <path
                    d="M16 10.2 L17.6 14.1 L21.8 14.4 L18.6 17 L19.6 21 L16 18.9 L12.4 21 L13.4 17 L10.2 14.4 L14.4 14.1 Z"
                    fill="#c9a84c"
                    fillOpacity="0.95"
                  />
                </svg>
              </span>
              <span className="text-lg font-semibold tracking-tight text-fuchsia-50">
                Tarot
              </span>
              <span className="mt-2 block text-sm text-slate-200/95">
                Choose a spread, draw your cards, then receive three readings plus a synthesis.
              </span>
            </div>
            <span className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-fuchsia-200/95 group-hover:text-fuchsia-100">
              Continue{" "}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </span>
          </Link>

          <Link
            href="/modes/oracle/daily"
            className="group flex min-h-[220px] flex-col justify-between rounded-[26px] border border-amber-300/20 bg-[#141024]/90 p-6 shadow-xl transition hover:border-amber-200/55 hover:bg-[#1a1530]/90"
          >
            <div>
              <span className="mb-4 block h-7 w-7 rounded-lg bg-amber-500/15 text-center text-amber-100 leading-[28px]">
                ☀️
              </span>
              <span className="text-lg font-semibold tracking-tight text-amber-50">
                Daily Fortune
              </span>
              <span className="mt-2 block text-sm text-slate-200/95">
                Today&apos;s energy through Saju, astrology, and tarot — refreshed every day
              </span>
            </div>
            <span className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-amber-200/95 group-hover:text-amber-100">
              Continue{" "}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </span>
          </Link>
        </nav>

        <Link
          href="/modes/oracle/profile"
          className="mx-auto mt-12 flex max-w-md flex-col items-center gap-2 rounded-2xl border-2 border-cyan-400/45 bg-[#131c35] px-8 py-5 text-center shadow-[0_8px_28px_rgba(0,0,0,0.35)] transition hover:border-cyan-300/70 hover:bg-[#171f3d]"
        >
          <span className="flex items-center gap-2 text-base font-semibold uppercase tracking-[0.12em] text-cyan-100 sm:text-lg">
            <span aria-hidden>✏️</span>
            EDIT BIRTH PROFILE
          </span>
          <span className="text-sm font-normal leading-snug tracking-normal text-slate-300">
            Set your birth date, time and city — required for all readings
          </span>
        </Link>
      </div>
    </main>
  );
}
