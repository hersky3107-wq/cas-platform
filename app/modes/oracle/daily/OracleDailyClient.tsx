"use client";

/**
 * 오늘의 운세 — the existing Daily Fortune route, re-pointed at the 12-system
 * engine. One AI (Z.ai), one short weave, automatic tarot/rune draw. First
 * civil-day read is 2 credits through the charge path; re-reads of the same
 * day are served from oracle_daily_cache at 0. Calculation (일진, 宿, 일명성,
 * 톤·나왈, card, rune) renders from oracle_computations as soon as create
 * returns; the weave arrives after the one AI call.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, LoaderCircle } from "lucide-react";
import { civilDateIn } from "@/lib/oracle/runner/conventions";
import { ORACLE_DAILY_READER_BRAND } from "@/lib/oracle/runner/daily";
import { dailyFactsFromNativeCharts, dailyNativeChartsFromResults } from "@/lib/oracle/runner/daily-facts";
import TarotSpreadChart from "../charts/TarotSpreadChart";
import RunesDrawChart from "../charts/RunesDrawChart";
import BrandBadge from "../runner/BrandBadge";
import AiJudgementNote from "../charts/AiJudgementNote";
import { inferredFromReadingSummaries } from "@/lib/oracle/tier2";
import {
  useOracleRunnerSession,
  type OracleRunnerComputation,
} from "../runner/useOracleRunnerSession";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

const DIRECTION_KO: Record<string, string> = {
  advance: "나아가라",
  hold: "지키라",
  release: "놓아라",
};

type ProfilePayload = {
  complete?: boolean;
  profile?: unknown | null;
  subjectProfileId?: string | null;
  runnerProfile?: {
    id?: string;
    tz?: string | null;
  } | null;
};

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cardsFrom(computations: OracleRunnerComputation[]) {
  const row = computations.find((entry) => entry.system === "tarot");
  const draw = rec(row?.calculation)?.draw;
  const cards = rec(draw)?.cards;
  return Array.isArray(cards) ? cards : [];
}

function runesFrom(computations: OracleRunnerComputation[]) {
  const row = computations.find((entry) => entry.system === "runes");
  const draw = rec(row?.calculation)?.draw;
  const runes = rec(draw)?.runes;
  return Array.isArray(runes) ? runes : [];
}

export default function OracleDailyClient() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [subjectProfileId, setSubjectProfileId] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState("Asia/Seoul");
  const startedRef = useRef(false);

  const asOfDate = useMemo(() => civilDateIn(new Date(), timeZone), [timeZone]);
  const session = useOracleRunnerSession({ storageKey: `oracle:daily:${asOfDate}` });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/oracle/profile").catch(() => null);
      if (cancelled) return;
      if (!res?.ok) {
        setReady(true);
        return;
      }
      const payload = (await res.json().catch(() => null)) as ProfilePayload | null;
      const hasProfile = payload?.profile != null && typeof payload.profile === "object";
      if (!hasProfile || !payload?.complete) {
        router.replace("/modes/oracle/profile");
        return;
      }
      const tz = payload.runnerProfile?.tz;
      if (typeof tz === "string" && tz.trim()) setTimeZone(tz.trim());
      setSubjectProfileId(payload.subjectProfileId ?? payload.runnerProfile?.id ?? null);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const { start, starting, sessionId } = session

  useEffect(() => {
    if (!ready || !subjectProfileId || startedRef.current || starting || sessionId) return
    startedRef.current = true
    void start({
      kind: "daily",
      scope: "combined",
      subjectProfileId,
      systems: ["saju", "astro", "ninestar", "sukuyou", "tzolkin", "tarot", "runes"],
      readerCount: 1,
      question: null,
      locale: "ko",
    })
  }, [ready, start, starting, sessionId, subjectProfileId])

  const reading = session.view?.readings.find((row) => row.brand === ORACLE_DAILY_READER_BRAND) ??
    session.view?.readings[0] ??
    null;
  const summary = rec(reading?.summary);
  const oneLine = typeof summary?.one_line === "string" ? summary.one_line : null;
  const direction = typeof summary?.direction === "string" ? summary.direction : null;
  const cards = cardsFrom(session.computations);
  const runes = runesFrom(session.computations);
  const inferences = inferredFromReadingSummaries(
    (session.view?.readings ?? []).map((row) => ({ brand: row.brand, summary: rec(row.summary) })),
  );
  const facts = useMemo(
    () =>
      dailyFactsFromNativeCharts(
        dailyNativeChartsFromResults(
          session.computations.map((row) => ({ system: row.system, result: row.calculation })),
        ),
      ),
    [session.computations],
  );
  const working = Boolean(session.sessionId) && !session.terminal;
  const failed = session.view?.status === "failed";

  if (!ready) {
    return <main className={BG} />;
  }

  return (
    <main className={BG}>
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 pb-28 pt-6 sm:px-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href="/modes/oracle"
            className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.22em] text-cyan-200/85 hover:text-cyan-100"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            Oracle
          </Link>
          <p className="text-[11px] tabular-nums text-white/40">첫 판독 2 · 재열람 0</p>
        </div>

        <header className="text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-200/70">
            Daily Fortune
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">오늘의 운세</h1>
          <p className="mt-2 text-sm text-slate-400">{asOfDate}</p>
        </header>

        {session.error ? (
          <p className="mt-6 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {session.error}
          </p>
        ) : null}

        {facts.length > 0 ? (
          <section className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {facts.map((fact) => (
              <div
                key={fact.label}
                className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5 text-center"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/65">
                  {fact.label}
                </p>
                <p className="mt-1 text-sm text-white">{fact.value}</p>
              </div>
            ))}
            <div className="col-span-2 sm:col-span-4">
              <AiJudgementNote inferences={inferences} pending="숙·나왈·톤·메이저의 의미" />
            </div>
          </section>
        ) : null}

        <section className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
            <p className="mb-3 text-center text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/65">
              오늘의 카드
            </p>
            <TarotSpreadChart cards={cards} size="hero" showJudgement={false} />
          </div>
          <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
            <p className="mb-3 text-center text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/65">
              오늘의 룬
            </p>
            <RunesDrawChart runes={runes} />
          </div>
        </section>

        <section className="mt-8 rounded-[24px] border border-amber-200/20 bg-gradient-to-br from-amber-500/8 via-[#11172b] to-violet-500/8 p-5 sm:p-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <BrandBadge brand={ORACLE_DAILY_READER_BRAND} size="sm" />
            {direction && DIRECTION_KO[direction] ? (
              <span className="text-[11px] text-amber-100/80">{DIRECTION_KO[direction]}</span>
            ) : null}
            {working ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-white/45">
                <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
                읽는 중
              </span>
            ) : null}
          </div>
          {oneLine ? <p className="mb-3 text-sm font-semibold text-white">{oneLine}</p> : null}
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-100">
            {reading?.narrative ??
              (failed
                ? "오늘의 운세를 읽지 못했습니다. 잠시 후 다시 열어 주세요."
                : working || session.starting
                  ? ""
                  : "")}
          </div>
        </section>
      </div>
    </main>
  );
}
