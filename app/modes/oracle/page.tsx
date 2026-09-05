"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Sparkles } from "lucide-react";
import HelpModal from "@/components/HelpModal";
import { oracleHelpContent } from "@/lib/help-modal/oracle-content";
import SystemGlyph from "./glyphs/SystemGlyph";
import { SINGLE_SYSTEMS, type SingleSystemId } from "@/lib/oracle/single-system-ui";
import { readingPath, requiredProfileFields } from "@/lib/oracle/system-requirements";
import { ORACLE_SESSION_CREDIT_PRICES } from "@/lib/oracle/runner/conventions";
import { ORACLE_SINGLE_READER_COUNTS } from "@/lib/oracle/ai/family-roster";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

const FAMILY_GROUPS: ReadonlyArray<{
  id: string;
  label: string;
  systems: readonly SingleSystemId[];
}> = [
  {
    id: "birth",
    label: "생년월일로 보는 것",
    systems: ["saju", "ziwei", "ninestar", "sukuyou", "astro", "numerology", "tzolkin"],
  },
  { id: "draw", label: "뽑아서 보는 것", systems: ["tarot", "runes", "iching"] },
  { id: "self", label: "이름·성향으로 보는 것", systems: ["name", "prism"] },
];

const singlePrices = ORACLE_SESSION_CREDIT_PRICES.single;
const priceRange = ORACLE_SINGLE_READER_COUNTS.map((n) => singlePrices[n] ?? 0).filter(
  (n) => n > 0,
);
const priceLabel = `${Math.min(...priceRange)}크레딧부터`;

const combinedPrices = Object.values(ORACLE_SESSION_CREDIT_PRICES.combined).filter(
  (price): price is number => typeof price === "number" && price > 0,
);
const combinedPriceLabel = `${Math.min(...combinedPrices)}크레딧부터`;

function systemNeedsBirth(system: SingleSystemId): boolean {
  return requiredProfileFields(system).some((field) =>
    ["birth_date", "sex", "birth_place"].includes(field),
  );
}

function SystemCard({ system }: { system: (typeof SINGLE_SYSTEMS)[number] }) {
  const needsBirth = systemNeedsBirth(system.id);
  return (
    <Link
      href={readingPath(system.id)}
      className="group flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-4 text-center transition hover:border-cyan-300/40 hover:bg-white/[0.06]"
    >
      <SystemGlyph
        system={system.id}
        className="h-10 w-10 text-cyan-100/85 transition group-hover:text-cyan-50"
      />
      <span className="mt-3 text-sm font-semibold text-white">{system.shortName}</span>
      <span className="mt-1.5 w-full text-[11px] leading-snug text-slate-300">
        {system.explanation[0]}
      </span>
      <span className="mt-1 text-[11px] leading-snug text-slate-400">
        {needsBirth ? "생년월일 필요" : "생년월일 불필요"}
      </span>
      <span className="mt-2 text-[11px] font-medium tabular-nums text-cyan-200/80">
        {priceLabel}
      </span>
    </Link>
  );
}

function DisabledTierCard({
  title,
  subtitle,
  className = "",
}: {
  title: string;
  subtitle: string;
  className?: string;
}) {
  return (
    <div
      className={`relative flex flex-col justify-between overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.02] p-6 ${className}`}
      aria-disabled="true"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-white/85">{title}</p>
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-medium text-white/55">
          <Lock className="h-3 w-3" aria-hidden /> 준비 중
        </span>
      </div>
    </div>
  );
}

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
      <HelpModal content={oracleHelpContent} />
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 pb-28 pt-8 sm:px-6 sm:pt-10">
        <Link
          href="/"
          className="mb-6 text-[11px] uppercase tracking-[0.22em] text-cyan-200/85 hover:text-cyan-100"
        >
          ← Lobby home
        </Link>

        <header className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Oracle</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-300">
            열두 가지 체계, 한 번의 계산, 서로 다른 해석.
          </p>
        </header>

        {/* TIER 1 — integrated 12-system verdict */}
        <section className="mt-10">
          <Link
            href="/modes/oracle/integrated"
            className="group relative block overflow-hidden rounded-[30px] border border-violet-300/25 bg-gradient-to-br from-violet-500/15 via-[#11172b] to-cyan-500/10 p-6 shadow-[0_18px_60px_rgba(0,0,0,0.3)] transition hover:border-violet-200/50 sm:p-8"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-xl">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-violet-200/70">
                  통합 12체계 판독
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  당신의 운세를 두고 AI들이 갈렸습니다
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-slate-300">
                  같은 열두 계산을 서로 다른 AI가 각자 읽고, 판정단이 한 표씩 던지고, 종합
                  AI가 일치점과 이견을 정리합니다. 어디서 갈렸는지가 진짜 정보입니다.
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-300/40 bg-violet-400/15 px-3 py-1.5 text-xs font-semibold text-violet-100 transition group-hover:bg-violet-400/25">
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> {combinedPriceLabel}
              </span>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              {SINGLE_SYSTEMS.map((system) => (
                <span
                  key={system.id}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300"
                >
                  {system.shortName}
                </span>
              ))}
            </div>
          </Link>
        </section>

        {/* TIER 2 — compat / daily / talisman */}
        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <DisabledTierCard title="궁합" subtitle="두 사람의 흐름을 겹쳐 읽습니다." />
          <DisabledTierCard title="오늘의 운세" subtitle="오늘 날짜 기준의 축소 판독." />
          <DisabledTierCard title="부적" subtitle="지금 필요한 기운을 상징으로." />
        </section>

        {/* TIER 3 — 12 live systems */}
        <section className="mt-10">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/65">
                12체계 단일 판독
              </p>
              <h2 className="mt-1 text-xl font-semibold text-white">한 가지 체계로 깊게</h2>
            </div>
            <Link
              href="/modes/oracle/profile"
              className="shrink-0 rounded-full border border-cyan-300/35 px-3 py-1.5 text-xs text-cyan-100 hover:border-cyan-200/70"
            >
              프로필 수정
            </Link>
          </div>

          <div className="mt-6 space-y-8">
            {FAMILY_GROUPS.map((family) => (
              <div key={family.id}>
                <p className="text-[11px] font-medium tracking-[0.08em] text-white/40">
                  {family.label}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {family.systems.map((id) => {
                    const system = SINGLE_SYSTEMS.find((entry) => entry.id === id);
                    return system ? <SystemCard key={id} system={system} /> : null;
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
