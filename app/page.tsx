"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  BookHeart,
  Coins,
  Footprints,
  Gavel,
  Handshake,
  Globe,
  Sparkles,
  Sword,
  Table2,
  Clapperboard,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { authenticatedFetch } from "@/lib/api/authenticated-fetch";
import { useFirstTimeHereOptional } from "@/app/components/FirstTimeHere";
import { supabase } from "@/lib/db/supabase";
import { activeModules, type ModuleConfig } from "@/lib/modules/config";

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

function displayNameForUser(user: User): string {
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const nickname = typeof meta?.nickname === "string" ? meta.nickname.trim() : "";
  const fullName = typeof meta?.full_name === "string" ? meta.full_name.trim() : "";
  const name = typeof meta?.name === "string" ? meta.name.trim() : "";
  if (nickname) return nickname;
  if (fullName) return fullName;
  if (name) return name;
  if (user.email) return user.email;
  return "Signed in";
}

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
        ? 1.2
        : module.id === "persona"
          ? 1.25
          : module.id === "compare"
            ? 1.1
            : 1.3;
  const iconBg =
    module.id === "suit"
      ? `bg-gradient-to-br ${module.accent}`
      : module.imageSrc
        ? "bg-transparent"
        : `bg-gradient-to-br ${module.accent}`;
  const iconClass = `relative flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-2xl shadow-[0_6px_20px_rgba(0,0,0,0.35)] lg:h-[96px] lg:w-[96px] ${iconBg}`;
  const isSuitIcon = module.id === "suit";
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
                : isSuitIcon
                  ? ({ objectFit: "cover", transform: "scale(1.6)" } as const)
                  : ({ objectFit: "contain", transform: `scale(${imageScale})` } as const)),
            }}
            className={
              isSuitIcon ? "object-cover object-center" : "object-contain object-center"
            }
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
  const [userLabel, setUserLabel] = useState<string | null>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const firstTimeHere = useFirstTimeHereOptional();

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;

      const user = data.user;
      if (!user) {
        setUserLabel(null);
        setCreditBalance(null);
        setAuthReady(true);
        return;
      }

      setUserLabel(displayNameForUser(user));

      const res = await authenticatedFetch("/api/credits/balance", {
        method: "POST",
        json: {},
      });
      const j = (await res.json().catch(() => null)) as { balance?: number };
      if (!cancelled) {
        if (typeof j?.balance === "number") {
          setCreditBalance(j.balance);
        }
        setAuthReady(true);
      }
    }

    void loadSession();
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
      <header className="fixed right-3 top-3 z-30 flex max-w-[min(100vw-1.5rem,28rem)] items-center justify-end gap-2">
        {authReady ? (
          userLabel ? (
            <>
              <span
                className="max-w-[7rem] truncate rounded-full border border-white/10 bg-[#131c35] px-3 py-1.5 text-xs text-white/90 sm:max-w-[9rem]"
                title={userLabel}
              >
                {userLabel}
              </span>
              <Link
                href="/modes/credits"
                className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-[#131c35] px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:border-cyan-400/50 hover:bg-[#1a2648]"
              >
                <Coins className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="tabular-nums text-white">
                  {creditBalance !== null ? creditBalance : "—"}
                </span>
              </Link>
            </>
          ) : (
            <Link
              href="/auth"
              className="rounded-full border border-white/12 bg-[#131c35] px-3 py-1.5 text-xs font-semibold text-white transition hover:border-white/25 hover:bg-[#1a2648]"
            >
              Sign in
            </Link>
          )
        ) : null}
        <button
          type="button"
          onClick={() => firstTimeHere?.open()}
          className="whitespace-nowrap rounded-full border border-white/15 bg-[#131c35] px-3 py-1 text-xs font-medium text-white/90 transition hover:border-cyan-400/40 hover:text-white"
        >
          First Time Here
        </button>
      </header>

      <section className="mx-auto flex min-h-screen w-full flex-col items-center justify-center px-8 py-16 lg:px-16">
        <div className="w-full max-w-6xl">
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
                      style={m.id === "oracle" ? { filter: "brightness(0.75)" } : undefined}
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

              return (
                <Link
                  key={m.id}
                  href="/modes/mindgame"
                  className="flex items-center justify-center"
                >
                  {tile}
                </Link>
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
      </section>

      <footer className="pb-8 text-center text-[10px] text-white/30">
        <p>
          Support & Refunds:{" "}
          <a
            href="mailto:support@aimani.ai"
            className="text-white/40 transition-colors hover:text-white/55"
          >
            support@aimani.ai
          </a>
        </p>
      </footer>

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
