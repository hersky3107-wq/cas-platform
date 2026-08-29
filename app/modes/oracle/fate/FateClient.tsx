"use client";

/**
 * Fate — 사주명리 on the 12-system engine.
 *
 * The screen keeps its chrome (birth-sketch gate, help modal, reader cards,
 * session-end flow) and drives from the shared runner loop. What changed is
 * what it calls: one engine chart plus N branded readers and a different
 * synthesizer, instead of a hardcoded five-model fan-out.
 *
 * Birth data is never collected here. /modes/oracle/profile is the only birth
 * form; this screen reads the saved sketch and links back to it. The models
 * receive the sanitized ai_payload (axis codes + labels) only — birth date,
 * time, city and name never enter a prompt.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Check, CircleAlert, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { OracleSessionEndFlow } from "../OracleSessionEndFlow";
import SajuPillarsChart from "../charts/SajuPillarsChart";
import BrandBadge from "../runner/BrandBadge";
import {
  useOracleRunnerSession,
  type OracleRunnerConsensus,
  type OracleRunnerReading,
} from "../runner/useOracleRunnerSession";
import { projectOracleArchiveResponses } from "@/lib/oracle/session-archive";
import type { OracleBirthProfileV1 } from "@/lib/oracle/types";

const BG = "min-h-screen bg-[#0a0f1e] text-white";
const STORAGE_KEY = "oracle.fate.active-session";
const SYSTEM_ID = "saju";

/** Stable empty array so the readings memo does not re-run on every poll. */
const EMPTY_READINGS: OracleRunnerReading[] = [];

function seatIndex(order: readonly string[], brand: string): number {
  const index = order.indexOf(brand);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

export type FateRosterOption = {
  readerCount: number;
  readers: string[];
  synthesizer: string;
  credits: number;
};

type ProfilePayload = {
  profile?: OracleBirthProfileV1 | null;
  complete?: boolean;
  subjectProfileId?: string | null;
};

function birthTimeNote(profile: OracleBirthProfileV1): string {
  if (profile.birth_time_known) return `${profile.birth_time_24h ?? "--:--"} (정확)`;
  if (profile.time_from_survey) {
    const sijin = profile.resolved_sijin_kr ? ` · ${profile.resolved_sijin_kr}` : "";
    return `${profile.birth_time_24h ?? "--:--"} (15문항 추정${sijin})`;
  }
  if (profile.time_approx_band) return `${profile.birth_time_24h ?? "--:--"} (대략 시간대)`;
  return "미상";
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/65">
      {children}
    </p>
  );
}

/** What N actually buys, stated before the run — not after. */
function RosterPreview({ roster }: { roster: FateRosterOption }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-[11px] leading-relaxed text-slate-300">
        <span className="font-semibold text-white">{roster.readers.length}개 AI 브랜드</span>가 같은
        사주 원국을 각자 독립적으로 읽습니다. 서로의 답은 보지 않습니다.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {roster.readers.map((brand) => (
          <BrandBadge key={brand} brand={brand} size="sm" />
        ))}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-slate-300">
        종합은 이들 중 어느 곳도 아닌 <span className="font-semibold text-white">다른 AI</span>가
        씁니다.
      </p>
      <div className="mt-3">
        <BrandBadge brand={roster.synthesizer} size="sm" />
      </div>
    </div>
  );
}

function ReaderCard({ reading, index }: { reading: OracleRunnerReading; index: number }) {
  return (
    <article className="rounded-[22px] border border-white/10 bg-[#10182b] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-white/30">
            {String(index + 1).padStart(2, "0")}
          </span>
          <BrandBadge brand={reading.brand} />
        </div>
        {reading.latencyMs ? (
          <span className="text-[10px] text-white/30">{(reading.latencyMs / 1000).toFixed(1)}초</span>
        ) : null}
      </div>
      <div className="mt-4 whitespace-pre-wrap text-[14px] leading-7 text-slate-100">
        {reading.narrative ??
          (reading.status === "done"
            ? "이 해석자는 본문을 남기지 않았습니다."
            : reading.status
              ? "이 해석자는 이번 응답을 마치지 못했습니다."
              : "해석을 준비하고 있습니다.")}
      </div>
    </article>
  );
}

function SynthesisCard({
  consensus,
  synthesizer,
}: {
  consensus: OracleRunnerConsensus;
  synthesizer: string;
}) {
  return (
    <article className="rounded-[26px] border border-violet-300/25 bg-gradient-to-br from-violet-500/15 via-[#11172b] to-cyan-500/10 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.3)] sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>종합 해석</SectionLabel>
        <BrandBadge brand={synthesizer} size="sm" />
      </div>
      <h2 className="mt-2 text-xl font-semibold text-white">결론</h2>
      <p className="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-slate-100">
        {consensus.conclusion ?? "완성된 해석들을 종합하고 있습니다."}
      </p>

      <div className="mt-7 grid gap-5 sm:grid-cols-2">
        <section>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-100">
            <Check className="h-4 w-4" aria-hidden /> 함께 본 점
          </h3>
          {consensus.agreements.length ? (
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-200">
              {consensus.agreements.map((item) => (
                <li key={item} className="rounded-xl bg-emerald-400/[0.06] px-3 py-2">
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-white/40">뚜렷한 공통점이 정리되지 않았습니다.</p>
          )}
        </section>
        <section>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-100">
            <CircleAlert className="h-4 w-4" aria-hidden /> 다르게 본 점
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-amber-100/65">
            이견은 오류가 아닙니다. 같은 원국을 놓고 어디에 더 무게를 두었는지 보여 줍니다.
          </p>
          {consensus.divergences.length ? (
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-200">
              {consensus.divergences.map((item) => (
                <li key={item} className="rounded-xl bg-amber-400/[0.06] px-3 py-2">
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-white/40">이번에는 큰 이견이 없었습니다.</p>
          )}
        </section>
      </div>
      {consensus.confidenceNote ? (
        <p className="mt-6 border-t border-white/8 pt-4 text-xs leading-relaxed text-white/45">
          {consensus.confidenceNote}
        </p>
      ) : null}
    </article>
  );
}

export default function FateClient({ rosters }: { rosters: FateRosterOption[] }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<OracleBirthProfileV1 | null>(null);
  const [subjectProfileId, setSubjectProfileId] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [readerCount, setReaderCount] = useState(rosters[0]?.readerCount ?? 3);

  const session = useOracleRunnerSession({ storageKey: STORAGE_KEY });

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
      if (cancelled) return;
      const sketch = payload?.profile ?? null;
      // The birth sketch is the only gate. A complete sketch always projects a
      // runner profile, so a missing id means the sketch itself needs saving.
      if (!sketch || !payload?.complete || !payload.subjectProfileId) {
        router.replace("/modes/oracle/profile");
        return;
      }
      setProfile(sketch);
      setSubjectProfileId(payload.subjectProfileId);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/credits/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => null);
      if (!res?.ok || cancelled) return;
      const payload = (await res.json().catch(() => null)) as { balance?: number } | null;
      if (typeof payload?.balance === "number" && !cancelled) setCredits(payload.balance);
    })();
    return () => {
      cancelled = true;
    };
  }, [session.sessionId]);

  const roster = rosters.find((option) => option.readerCount === readerCount) ?? rosters[0]!;
  const synthesizer = roster.synthesizer;

  const view = session.view;
  const consensus = view?.consensus ?? null;
  const computation =
    session.computations.find((entry) => entry.system === SYSTEM_ID) ??
    session.computations[0] ??
    null;

  const readingRows = view?.readings ?? EMPTY_READINGS;
  /** Seat order, so a reader keeps its position as the others land. */
  const readerOrder = view?.readerRoster ?? roster.readers;
  const readings = useMemo(
    () =>
      readingRows
        .filter((reading) => reading.system === SYSTEM_ID)
        .sort((a, b) => seatIndex(readerOrder, a.brand) - seatIndex(readerOrder, b.brand)),
    [readingRows, readerOrder],
  );

  const expectedReaders = readerOrder.length;
  const finished = session.terminal && consensus !== null;

  /**
   * Archive payload for the share link and the best-answer vote. Built through
   * the whitelist projection so a reading row's server-only model id can never
   * ride along.
   */
  const getResponses = useCallback(
    () =>
      projectOracleArchiveResponses({
        readings: readings.map((reading) => ({
          brand: reading.brand,
          narrative: reading.narrative,
        })),
        synthesis: consensus ? { brand: synthesizer, conclusion: consensus.conclusion } : null,
      }),
    [readings, consensus, synthesizer],
  );

  const startReading = async () => {
    if (!subjectProfileId) return;
    const outcome = await session.start({
      subjectProfileId,
      systems: [SYSTEM_ID],
      readerCount,
      question,
    });
    if (!outcome.ok && typeof outcome.balance === "number") setCredits(outcome.balance);
  };

  if (!ready) return <main className={BG} aria-busy="true" />;

  const insufficient = credits !== null && credits < roster.credits;

  return (
    <main className={BG}>
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 pb-28 pt-6 sm:px-8 sm:pt-9">
        <header className="mb-8 flex flex-wrap items-center gap-3">
          <Link
            href="/modes/oracle"
            className="inline-flex items-center gap-1 text-sm text-cyan-200/90 hover:text-cyan-100"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden /> 오라클
          </Link>
          {credits !== null ? (
            <span className="rounded-full bg-[#131c35] px-3 py-1 text-xs font-medium text-slate-200">
              {credits} 크레딧
            </span>
          ) : null}
          {session.sessionId ? (
            <span className="text-[10px] text-white/25">세션 {session.sessionId.slice(0, 8)}</span>
          ) : null}
        </header>

        {session.error ? (
          <p
            role="alert"
            className="mb-6 rounded-2xl border border-rose-500/40 bg-rose-950/35 px-4 py-3 text-sm text-rose-100"
          >
            {session.error}
          </p>
        ) : null}

        {session.sessionId ? (
          <section className="space-y-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <SectionLabel>{finished ? "결과" : "진행"}</SectionLabel>
                <h1 className="mt-2 text-2xl font-semibold text-white">Fate · 사주명리</h1>
                <p className="mt-1 text-sm text-slate-400">
                  {finished
                    ? "같은 원국을 읽은 해석들을 한자리에 모았습니다."
                    : "원국 계산은 끝났습니다. 해석자들의 글을 차례로 받고 있습니다."}
                </p>
              </div>
              <button
                type="button"
                onClick={session.reset}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-white/25"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> 새 읽기
              </button>
            </div>

            {consensus ? (
              <SynthesisCard consensus={consensus} synthesizer={synthesizer} />
            ) : null}

            <SajuPillarsChart
              calculation={computation?.calculation ?? null}
              engineVersion={computation?.engineVersion ?? null}
            />

            <section>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <SectionLabel>해석자들의 읽기</SectionLabel>
                  <h2 className="mt-1 text-lg font-semibold text-white">
                    같은 원국, 서로 다른 관점
                  </h2>
                </div>
                {!session.terminal ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-cyan-100/65">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    {readings.length}/{expectedReaders}
                  </span>
                ) : null}
              </div>
              <div className="mt-4 grid gap-4">
                {readings.map((reading, index) => (
                  <ReaderCard key={reading.brand} reading={reading} index={index} />
                ))}
                {!readings.length && !session.terminal ? (
                  <div className="rounded-[22px] border border-dashed border-white/12 bg-white/[0.02] px-5 py-8 text-center text-sm text-white/40">
                    첫 번째 해석자가 원국을 읽고 있습니다. 보통 15–30초가 걸립니다.
                  </div>
                ) : null}
              </div>
            </section>

            {!finished && readings.length > 0 ? (
              <article className="rounded-[22px] border border-dashed border-violet-300/20 bg-violet-400/[0.04] p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-violet-100">
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                  {synthesizer}가 마지막에 종합합니다
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  모든 해석이 도착하면 결론, 일치점, 이견 순서로 정리해 맨 위에 놓습니다.
                </p>
              </article>
            ) : null}

            {session.terminal ? (
              <OracleSessionEndFlow
                oracleType={SYSTEM_ID}
                question={question.trim() || "사주명리 읽기"}
                allDone
                getResponses={getResponses}
                voteLabels={readerOrder}
                saveKey={session.sessionId}
              />
            ) : null}
          </section>
        ) : (
          <section>
            <SectionLabel>사주명리</SectionLabel>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Fate</h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-300">
              저장된 출생 정보로 사주 원국을 계산한 뒤, 여러 AI 브랜드가 같은 원국을 각자 읽고
              마지막에 다른 AI가 종합합니다.
            </p>

            {profile ? (
              <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 text-slate-200">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                      저장된 출생 정보
                    </p>
                    <p className="tabular-nums">{profile.dob}</p>
                    <p className="tabular-nums text-slate-300">{birthTimeNote(profile)}</p>
                    <p className="text-slate-400">{profile.birth_city}</p>
                  </div>
                  <Link
                    href="/modes/oracle/profile"
                    className="shrink-0 rounded-full border border-cyan-300/35 px-3 py-1.5 text-xs text-cyan-100 hover:border-cyan-200/70"
                  >
                    수정
                  </Link>
                </div>
                <p className="mt-3 border-t border-white/8 pt-3 text-[11px] leading-relaxed text-white/40">
                  생년월일·시간·도시·이름은 계산에만 쓰이며 AI에게 전달되지 않습니다. 해석자는
                  계산 결과의 축 코드만 받습니다.
                </p>
              </div>
            ) : null}

            <div className="mt-8 space-y-3">
              <div className="flex items-end justify-between gap-3">
                <label className="text-[11px] uppercase tracking-[0.2em] text-white/55">
                  해석자 수
                </label>
                <span className="text-[11px] text-white/40">
                  AI 브랜드 {roster.readers.length}곳 + 종합 1곳
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {rosters.map((option) => (
                  <button
                    key={option.readerCount}
                    type="button"
                    onClick={() => setReaderCount(option.readerCount)}
                    className={`rounded-xl border px-2 py-3 text-center transition ${
                      option.readerCount === readerCount
                        ? "border-violet-300/55 bg-violet-400/15 text-white"
                        : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25"
                    }`}
                  >
                    <span className="block text-lg font-semibold">{option.readerCount}명</span>
                    <span className="mt-0.5 block text-[11px] text-white/50">
                      {option.credits} 크레딧
                    </span>
                  </button>
                ))}
              </div>
              <RosterPreview roster={roster} />
            </div>

            <div className="mt-8 space-y-2">
              <label
                className="text-[11px] uppercase tracking-[0.2em] text-white/55"
                htmlFor="fate-question"
              >
                질문 <span className="normal-case tracking-normal text-white/35">(선택)</span>
              </label>
              <textarea
                id="fate-question"
                rows={4}
                maxLength={2000}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="지금 가장 궁금한 일을 적어 주세요. 비워 두면 전반적인 흐름을 읽습니다."
                className="w-full resize-y rounded-2xl border border-white/15 bg-black/35 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/55 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void startReading()}
                disabled={session.starting || insufficient || !subjectProfileId}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-violet-500 px-5 py-4 text-sm font-semibold text-white shadow-lg shadow-violet-950/35 transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
              >
                {session.starting ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="h-4 w-4" aria-hidden />
                )}
                {session.starting
                  ? "원국을 계산하는 중…"
                  : `사주 읽기 시작 · ${roster.credits} 크레딧`}
              </button>
              {insufficient ? (
                <p className="text-xs text-amber-200/85">
                  이 읽기에는 {roster.credits} 크레딧이 필요합니다.
                </p>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
