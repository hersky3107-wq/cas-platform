"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookHeart,
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
import { useFirstTimeHereOptional } from "@/app/components/FirstTimeHere";
import { ModuleCreditsLink } from "@/components/credits/ModuleCreditsLink";
import { supabase } from "@/lib/db/supabase";
import { activeModules, type ModuleConfig } from "@/lib/modules/config";
import { isModuleHidden } from "@/lib/modules/visibility";

const LOBBY_SUBTITLES: Record<string, Record<string, string>> = {
  en: {
    compare: "6 answers. One question.",
    persona: "6 roles. 6 perspectives.",
    panel: "Score, vote, rank, predict.",
    arena: "9-round AI battle.",
    custom: "Your rules. Your depth.",
    deep: "6 AIs · Deep analysis · Full report.",
    synod: "AI minds deliberate to reach the best consensus.",
    apex: "The newest, strongest AI — together",
    oracle: "Fortune. Tarot. Astrology.",
    mindgame: "Deceive. Survive. Win.",
    stage: "AI banter, comedy & diverse stories.",
  },
  ko: {
    compare: "6개의 답. 하나의 질문.",
    persona: "6가지 역할. 6가지 시각.",
    panel: "점수·투표·순위·예측.",
    arena: "9라운드 AI 배틀.",
    custom: "당신의 규칙. 당신의 깊이.",
    deep: "AI들의 심층 분석 · 완전한 보고서.",
    synod: "AI들이 토론해 최선의 합의에 도달한다.",
    apex: "세계 최신·최강 AI를 한자리에",
    oracle: "운세. 타로. 점성술.",
    mindgame: "속여라. 살아남아라. 이겨라.",
    stage: "만담 · 코미디 · 다양한 이야기.",
  },
  ja: {
    compare: "6つの答え。1つの質問。",
    persona: "6つの役割。6つの視点。",
    panel: "評価・投票・ランク・予測。",
    arena: "9ラウンドのAI対決。",
    custom: "あなたのルール。あなたの深さ。",
    deep: "AIたちの深層分析・完全なレポート。",
    synod: "AIたちが熟議し、最善の合意へ。",
    apex: "世界最新・最強のAIを一度に",
    oracle: "運勢。タロット。占星術。",
    mindgame: "騙せ。生き残れ。勝て。",
    stage: "AIの漫才・コメディ・多彩な物語。",
  },
  "zh-TW": {
    compare: "六個答案。一個問題。",
    persona: "六個角色。六個視角。",
    panel: "評分、投票、排名、預測。",
    arena: "9回合AI對決。",
    custom: "你的規則。你的深度。",
    deep: "AI深度分析・完整報告。",
    synod: "AI們深入商議，達成最佳共識。",
    apex: "集結全球最新最強 AI",
    oracle: "運勢。塔羅。星座。",
    mindgame: "欺騙。生存。獲勝。",
    stage: "AI相聲・喜劇・多元故事。",
  },
  fr: {
    compare: "6 réponses. 1 question.",
    persona: "6 rôles. 6 perspectives.",
    panel: "Score, vote, rang, prédit.",
    arena: "Bataille IA en 9 rounds.",
    custom: "Vos règles. Votre profondeur.",
    deep: "AI · Analyse approfondie · Rapport complet.",
    synod: "Les IA délibèrent pour le meilleur consensus.",
    apex: "Les IA les plus récentes et puissantes, réunies",
    oracle: "Fortune. Tarot. Astrologie.",
    mindgame: "Trompe. Survie. Victoire.",
    stage: "AI · Comédie · Joutes verbales · Histoires.",
  },
  ar: {
    compare: "٦ إجابات. سؤال واحد.",
    persona: "٦ أدوار. ٦ وجهات نظر.",
    panel: "تقييم، تصويت، ترتيب، تنبؤ.",
    arena: "معركة ذكاء اصطناعي ٩ جولات.",
    custom: "قواعدك. عمقك.",
    deep: "تحليل معمّق للذكاء الاصطناعي · تقرير كامل.",
    synod: "عقول الذكاء الاصطناعي تتداول للوصول إلى أفضل توافق.",
    apex: "أحدث وأقوى نماذج الذكاء الاصطناعي معاً",
    mindgame: "اخدع. انجُ. انتصر.",
    stage: "AI · كوميديا · قصص · عروض متنوعة.",
  },
  es: {
    compare: "6 respuestas. Una pregunta.",
    persona: "6 roles. 6 perspectivas.",
    panel: "Puntúa, vota, clasifica, predice.",
    arena: "Batalla de IA en 9 rondas.",
    custom: "Tus reglas. Tu profundidad.",
    deep: "Análisis profundo de IA · Informe completo.",
    oracle: "Fortuna. Tarot. Astrología.",
    mindgame: "Engaña. Sobrevive. Gana.",
    stage: "IA · Comedia · Historias diversas.",
  },
}

function getLobbyLocale(): string {
  if (typeof navigator === "undefined") return "en";
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith("ko")) return "ko";
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("zh-tw") || lang.startsWith("zh-hk") || lang.includes("hant")) return "zh-TW";
  if (lang.startsWith("fr")) return "fr";
  if (lang.startsWith("ar")) return "ar";
  if (lang.startsWith("es")) return "es";
  return "en";
}

function useLobbyLocale(userProfile: any): string {
  if (userProfile?.ui_locale) return userProfile.ui_locale;
  return getLobbyLocale();
}

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
  subtitle,
}: {
  module: ModuleConfig;
  onComingSoon: (item: ModuleConfig) => void;
  subtitle?: string;
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
                  ? ({ objectFit: "cover", transform: "scale(1.9)" } as const)
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
      {subtitle ? (
        <p className="mt-0.5 text-[10px] text-slate-500 text-center leading-tight px-1">
          {subtitle}
        </p>
      ) : null}
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
  const router = useRouter();
  const [modalItem, setModalItem] = useState<ModuleConfig | null>(null);
  const [email, setEmail] = useState("");
  const [userLabel, setUserLabel] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const firstTimeHere = useFirstTimeHereOptional();

  useEffect(() => {
    if (!userMenuOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [userMenuOpen]);

  async function handleSignOut() {
    setUserMenuOpen(false);
    await supabase.auth.signOut();
    router.push("/auth");
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;

      const user = data.user;
      if (!user) {
        setUserLabel(null);
        setAuthReady(true);
        return;
      }

      setUserLabel(displayNameForUser(user));

      const { data: profileData } = await supabase
        .from("users")
        .select("show_onboarding, ui_locale")
        .eq("id", user.id)
        .maybeSingle();

      if (!cancelled) {
        setProfile(profileData as Record<string, unknown> | null);
        setAuthReady(true);
        if (profileData?.show_onboarding === true) {
          firstTimeHere?.open();
        }
      }
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [firstTimeHere]);

  const lobbyLocale = useLobbyLocale(profile)

  const mvpModules = useMemo(() => {
    // Explicit order: COMPARE first, CUSTOM last (for MVP).
    const compare = activeModules.find((m) => m.id === "compare")!;
    const persona = activeModules.find((m) => m.id === "persona")!;
    const verdict = activeModules.find((m) => m.id === "verdict")!;
    const arena = activeModules.find((m) => m.id === "arena")!;
    const custom = activeModules.find((m) => m.id === "custom")!;

    return [compare, persona, verdict, arena, custom];
  }, []);

  return (
    <main className="min-h-screen bg-[#0a0f1e] text-white">
      <header className="fixed right-3 top-3 z-30 flex max-w-[min(100vw-1.5rem,28rem)] items-center justify-end gap-2">
        {authReady ? (
          userLabel ? (
            <>
              <div ref={userMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((open) => !open)}
                  className="max-w-[7rem] truncate rounded-full border border-white/10 bg-[#131c35] px-3 py-1.5 text-xs text-white/90 sm:max-w-[9rem]"
                  title={userLabel}
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                >
                  {userLabel}
                </button>
                {userMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-40 mt-1 min-w-[8rem] rounded-xl border border-white/10 bg-[#131c35] py-1 shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleSignOut()}
                      className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-white/5"
                    >
                      Sign out
                    </button>
                  </div>
                ) : null}
              </div>
              <ModuleCreditsLink />
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
        <span className="relative inline-flex">
          <span className="absolute inset-0 rounded-lg bg-cyan-400/40 animate-ping pointer-events-none" />
          <button
            type="button"
            onClick={() => firstTimeHere?.open()}
            className="relative rounded-lg bg-cyan-500/20 border border-cyan-400/60 px-3 py-1.5 text-xs font-semibold text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.3)] transition hover:bg-cyan-500/30 hover:text-cyan-200"
          >
            📋 AIMANI Guide
          </button>
        </span>
      </header>

      <section className="mx-auto flex min-h-screen w-full flex-col items-center justify-center px-8 py-16 lg:px-16">
        <div className="w-full max-w-6xl">
          <div className="grid justify-items-center grid-cols-4 gap-6 sm:grid-cols-5 md:grid-cols-6 lg:gap-8">
            {mvpModules.map((module) => (
              <LobbyCard
                key={module.id}
                module={module}
                onComingSoon={setModalItem}
                subtitle={LOBBY_SUBTITLES[lobbyLocale]?.[module.id === "verdict" ? "panel" : module.id] ?? ""}
              />
            ))}
            {[
              {
                id: "deep",
                src: "/icons/deep.png",
                label: "DEEP",
              },
              {
                // Brand name — never translated. Global module (no visibility gating).
                id: "synod",
                src: "/icons/synod.png",
                label: "SYNOD",
              },
              {
                // Brand name — never translated. Premium module (no visibility gating).
                id: "apex",
                src: "/icons/apex.png",
                label: "APEX",
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
                      style={
                        m.id === "oracle"
                          ? { filter: "brightness(0.75)" }
                          : m.id === "apex"
                            ? { transform: "scale(1.12)" }
                            : undefined
                      }
                    />
                  </div>
                  <span className="mt-1.5 text-center text-[11px] leading-[1.15] text-white">
                    {m.label}
                  </span>
                  <p className="mt-0.5 text-[10px] text-slate-500 text-center leading-tight px-1">
                    {LOBBY_SUBTITLES[lobbyLocale]?.[m.id] ?? ""}
                  </p>
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

              if (m.id === "synod") {
                return (
                  <Link
                    key={m.id}
                    href="/modes/synod"
                    className="flex items-center justify-center"
                  >
                    {tile}
                  </Link>
                );
              }

              if (m.id === "apex") {
                return (
                  <Link
                    key={m.id}
                    href="/modes/apex"
                    className="flex items-center justify-center"
                  >
                    {tile}
                  </Link>
                );
              }

              if (m.id === "oracle") {
                if (isModuleHidden("oracle", lobbyLocale)) return null;
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
                <p className="mt-0.5 text-[10px] text-slate-500 text-center leading-tight px-1">
                  {LOBBY_SUBTITLES[lobbyLocale]?.["stage"] ?? ""}
                </p>
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

      <div className="flex justify-center pb-8">
        <a
          href="https://theresanaiforthat.com/ai/aimani-ai-tools/?ref=featured&v=11090500"
          target="_blank"
          rel="nofollow"
        >
          <img
            width={300}
            src="https://media.theresanaiforthat.com/featured-on-taaft.png?width=600"
            alt=""
            className="opacity-30 transition-opacity hover:opacity-70"
          />
        </a>
      </div>

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
