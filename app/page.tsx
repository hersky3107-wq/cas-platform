"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookHeart,
  Coins,
  Footprints,
  Gavel,
  Handshake,
  Globe,
  Info,
  Lock,
  Sparkles,
  Sword,
  Table2,
  Clapperboard,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { authenticatedFetch } from "@/lib/api/authenticated-fetch";
import { supabase } from "@/lib/db/supabase";
import {
  activeModules,
  betaModules,
  type ModuleConfig,
} from "@/lib/modules/config";

const iconMap: Record<string, LucideIcon> = {
  Globe,
  Table2,
  Sparkles,
  BookHeart,
  Footprints,
  Sword,
  Handshake,
  Gavel,
  Clapperboard,
  Zap, // fallback for any missing icon mapping
};

function LobbyCard({
  module,
  onComingSoon,
}: {
  module: ModuleConfig;
  onComingSoon: (item: ModuleConfig) => void;
}) {
  const Icon = iconMap[module.icon] ?? Zap;
  const imageScale =
    module.id === "custom"
      ? 1.0
      : module.id === "suit"
        ? 1.5
        : module.id === "persona"
          ? 1.25
          : module.id === "compare"
            ? 1.1
            : 1.3;
  const iconClass = `relative flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-2xl shadow-[0_6px_20px_rgba(0,0,0,0.35)] lg:h-[96px] lg:w-[96px] ${module.imageSrc ? "bg-transparent" : `bg-gradient-to-br ${module.accent}`}`;
  const content = (
    <div className="flex flex-col items-center">
      <div
        className={`${iconClass} ${module.status === "coming-soon" ? "opacity-50" : "opacity-100"}`}        
      >
        {module.imageSrc ? (
          <Image
            src={module.imageSrc}
            alt={`${module.name} icon`}
            fill
            sizes="96px"
            unoptimized
            style={{
              transformOrigin: "center",
              ...(module.id === "compare"
                ? ({ objectFit: "contain", transform: "scale(1.2)" } as const)
                : ({ objectFit: "contain", transform: `scale(${imageScale})` } as const)),
            }}
            className="object-contain object-center"
          />
        ) : (
          <Icon className="h-8 w-8 text-white lg:h-10 lg:w-10" />
        )}
      </div>
      <span className="mt-1.5 text-center text-[11px] leading-[1.15] text-white">
        {module.id === "verdict" ? "PANEL" : module.name}
      </span>
    </div>
  );

  if (module.status === "active" && module.href) {
    return (
      <Link href={module.href} className="flex items-center justify-center">
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className="flex cursor-pointer items-center justify-center"
      onClick={() => onComingSoon(module)}
    >
      {content}
    </button>
  );
}

export default function Home() {
  const [modalItem, setModalItem] = useState<ModuleConfig | null>(null);
  const [email, setEmail] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function loadCredits() {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      const user = data.user;
      if (!user) {
        setLoggedIn(false);
        setCreditBalance(null);
        return;
      }
      setLoggedIn(true);
      const res = await authenticatedFetch("/api/credits/balance", {
        method: "POST",
        json: {},
      });
      const j = (await res.json().catch(() => null)) as { balance?: number };
      if (!cancelled && typeof j?.balance === "number") {
        setCreditBalance(j.balance);
      }
    }

    void loadCredits();
    return () => {
      cancelled = true;
    };
  }, []);

  const mvpModules = useMemo(() => {
    // Explicit order: COMPARE first, CUSTOM last (for MVP).
    const compare = activeModules.find((m) => m.id === "compare")!;
    const persona = activeModules.find((m) => m.id === "persona")!;
    const verdict = activeModules.find((m) => m.id === "verdict")!;
    const arena = activeModules.find((m) => m.id === "arena")!;
    const suit = activeModules.find((m) => m.id === "suit")!;
    const custom = activeModules.find((m) => m.id === "custom")!;

    return [compare, persona, verdict, arena, suit, custom];
  }, []);

  return (
    <main className="min-h-screen bg-[#0a0f1e] text-white">
      <div className="fixed right-3 top-3 z-30 flex items-center gap-2">
        <Link
          href="/modes/credits"
          className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-[#131c35] px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:border-cyan-400/50 hover:bg-[#1a2648]"
        >
          <Coins className="h-3.5 w-3.5" aria-hidden />
          <span>Credits</span>
          {loggedIn && creditBalance !== null ? (
            <span className="tabular-nums text-white">{creditBalance}</span>
          ) : null}
        </Link>
        <div className="whitespace-nowrap rounded-full bg-[#131c35] px-2 py-1 text-xs text-white">
          First time here?
        </div>
        <button
          type="button"
          onClick={() => router.push("/about")}
          aria-label="About"
          className="animate-pulse flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
        >
          <Info className="h-5 w-5" />
        </button>
      </div>

      <section className="mx-auto flex min-h-screen w-full flex-col items-center justify-center px-8 py-16 lg:px-16">
        <div className="w-full max-w-6xl">
          <div className="mb-12">
            <p className="mb-4 text-center text-[11px] font-medium uppercase tracking-[0.24em] text-white/55">
              BETA
            </p>
            <div className="grid justify-items-center grid-cols-4 gap-6 sm:grid-cols-5 md:grid-cols-6 lg:gap-8">
              {mvpModules.map((module) => (
                <LobbyCard
                  key={module.id}
                  module={module}
                  onComingSoon={setModalItem}
                />
              ))}
              {[
                {
                  id: "deep",
                  src: "/icons/deep.png",
                  label: "DEEP",
                },
                {
                  id: "oracle",
                  src: "/icons/oracle.png",
                  label: "ORACLE",
                },
                {
                  id: "mindgame",
                  src: "/icons/mindgame.png",
                  label: "MINDGAME",
                },
                {
                  id: "council",
                  src: "/icons/council.png",
                  label: "COUNCIL",
                },
              ].map((m) => {
                const tile = (
                  <div className="flex flex-col items-center">
                    <div className="relative flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-2xl bg-white/5 shadow-[0_6px_20px_rgba(0,0,0,0.35)] lg:h-[96px] lg:w-[96px]">
                      <Image
                        src={m.src}
                        alt={m.label}
                        fill
                        sizes="96px"
                        className="absolute inset-0 h-full w-full object-contain object-center"
                        style={
                          m.id === "oracle"
                            ? { filter: "brightness(0.75)" }
                            : m.id === "council"
                              ? { filter: "brightness(1.3)" }
                              : undefined
                        }
                      />
                    </div>
                    <span className="mt-1.5 text-center text-[11px] leading-[1.15] text-white">
                      {m.label}
                    </span>
                  </div>
                );

                if (m.id === "deep") {
                  return (
                    <Link
                      key={m.id}
                      href="/modes/deep"
                      className="flex items-center justify-center"
                    >
                      {tile}
                    </Link>
                  );
                }

                if (m.id === "oracle") {
                  return (
                    <Link
                      key={m.id}
                      href="/modes/oracle"
                      className="flex items-center justify-center"
                    >
                      {tile}
                    </Link>
                  );
                }

                if (m.id === "mindgame") {
                  return (
                    <Link
                      key={m.id}
                      href="/modes/mindgame"
                      className="flex items-center justify-center"
                    >
                      {tile}
                    </Link>
                  );
                }

                return (
                  <div key={m.id} className="flex items-center justify-center">
                    {tile}
                  </div>
                );
              })}
              <Link href="/modes/stage" className="flex items-center justify-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`relative flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-2xl shadow-[0_6px_20px_rgba(0,0,0,0.35)] lg:h-[96px] lg:w-[96px] bg-gradient-to-br from-indigo-400 to-sky-600`}
                  >
                    <Image
                      src="/icons/stage.png"
                      alt="STAGE"
                      fill
                      sizes="96px"
                      className="absolute inset-0 h-full w-full object-contain object-center"
                    />
                  </div>
                  <span className="mt-1.5 text-center text-[11px] leading-[1.15] text-white">
                    STAGE
                  </span>
                </div>
              </Link>
            </div>
          </div>

          <div>
            <p className="mb-4 text-center text-[11px] font-medium uppercase tracking-[0.24em] text-white/55">
              Version 1.0
            </p>
            <div className="grid justify-items-center grid-cols-4 gap-6 sm:grid-cols-5 md:grid-cols-6 lg:gap-8">
              {betaModules.map((module) => (
                <LobbyCard
                  key={module.id}
                  module={module}
                  onComingSoon={setModalItem}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {modalItem ? (
        <div className="fixed inset-0 z-40 bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[20px] bg-[#131c35] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium tracking-[0.24em] text-cyan-300/85">
                  Coming in Beta
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">{modalItem.name}</h2>
                <p className="mt-1 text-sm text-slate-300">In Development</p>
              </div>
              <button
                type="button"
                onClick={() => setModalItem(null)}
                className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-4 text-sm text-slate-300">
              This mode is currently in development. See you in Beta!
            </p>

            <div className="mt-5 space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full rounded-2xl border border-white/12 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/55 focus:outline-none"
              />
              <button
                type="button"
                className="w-full rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
              >
                Notify Me
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
