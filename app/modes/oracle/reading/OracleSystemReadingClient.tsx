"use client";

/**
 * Shared single-system reading page. Driven by system id — Fate is saju.
 *
 * Roster resolution, poll loop, credits, archive projection, and session-end
 * flow are identical across the twelve systems. What changes: required
 * profile fields, per-reading inputs (tarot / runes / PRISM), and the chart.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, CircleAlert, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";
import { OracleSessionEndFlow } from "../OracleSessionEndFlow";
import OracleSystemChart from "../charts/OracleSystemChart";
import BrandBadge from "../runner/BrandBadge";
import TarotDrawInput from "../inputs/TarotDrawInput";
import RunesCountInput from "../inputs/RunesCountInput";
import PrismColorInput, { type PrismPicks } from "../inputs/PrismColorInput";
import {
  useOracleRunnerSession,
  type OracleRunnerAssumptions,
  type OracleRunnerConsensus,
  type OracleRunnerReading,
} from "../runner/useOracleRunnerSession";
import { projectOracleArchiveResponses } from "@/lib/oracle/session-archive";
import type { OracleBirthProfileV1 } from "@/lib/oracle/types";
import type { SystemId } from "@/lib/oracle/axes/types";
import type { TarotSpreadSize } from "@/lib/oracle/engines/draw/conventions";
import type { ReadingRosterOption } from "@/lib/oracle/reading-rosters";
import { SINGLE_SYSTEM_BY_ID } from "@/lib/oracle/single-system-ui";
import {
  isDrawBasedSystem,
  missingRequiredFields,
  profilePathForSystem,
  type ProfileSnapshot,
} from "@/lib/oracle/system-requirements";

const BG = "min-h-screen bg-[#0a0f1e] text-white";
const EMPTY_READINGS: OracleRunnerReading[] = [];

function seatIndex(order: readonly string[], brand: string): number {
  const index = order.indexOf(brand);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

export type { ReadingRosterOption };

type ProfilePayload = {
  profile?: OracleBirthProfileV1 | null;
  complete?: boolean;
  subjectProfileId?: string | null;
  placeholderBirthDate?: boolean;
  runnerProfile?: {
    id?: string;
    birth_date?: string | null;
    sex?: string | null;
    birth_place?: string | null;
    lat?: number | null;
    lng?: number | null;
    name_local?: string | null;
    name_hanja?: string | null;
    name_latin?: string | null;
    mbti?: string | null;
  } | null;
};

function snapshotFromPayload(payload: ProfilePayload | null): ProfileSnapshot {
  const sketch = payload?.profile ?? null;
  const runner = payload?.runnerProfile ?? null;
  return {
    birth_date: runner?.birth_date ?? sketch?.dob ?? null,
    sex: runner?.sex ?? null,
    gender: sketch?.gender ?? null,
    birth_place: runner?.birth_place ?? sketch?.birth_city ?? null,
    birth_city: sketch?.birth_city ?? runner?.birth_place ?? null,
    lat: runner?.lat ?? null,
    lng: runner?.lng ?? null,
    name_local: runner?.name_local ?? null,
    name_hanja: runner?.name_hanja ?? null,
    name_latin: runner?.name_latin ?? null,
    mbti: runner?.mbti ?? null,
    subjectProfileId: payload?.subjectProfileId ?? runner?.id ?? null,
    placeholderBirthDate: payload?.placeholderBirthDate === true,
  };
}

function birthTimeNote(profile: OracleBirthProfileV1): string {
  if (profile.birth_time_known) return `${profile.birth_time_24h ?? "--:--"} (정확)`;
  if (profile.time_from_survey) {
    const sijin = profile.resolved_sijin_kr ? ` · ${profile.resolved_sijin_kr}` : "";
    return `${profile.birth_time_24h ?? "--:--"} (15문항 추정${sijin})`;
  }
  if (profile.time_approx_band) return `${profile.birth_time_24h ?? "--:--"} (대략 시간대)`;
  return "미상";
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/65">
      {children}
    </p>
  );
}

function RosterPreview({
  roster,
  systemName,
}: {
  roster: ReadingRosterOption;
  systemName: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-[11px] leading-relaxed text-slate-300">
        <span className="font-semibold text-white">{roster.readers.length}개 AI 브랜드</span>가 같은{" "}
        {systemName} 계산을 각자 독립적으로 읽습니다. 서로의 답은 보지 않습니다.
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
            이견은 오류가 아닙니다. 같은 계산을 놓고 어디에 더 무게를 두었는지 보여 줍니다.
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

function AssumptionsBanner({
  systemId,
  assumptions,
}: {
  systemId: SystemId;
  assumptions: OracleRunnerAssumptions | null;
}) {
  if (!assumptions) return null;
  if (systemId === "astro" && assumptions.coordinatesDefaulted) {
    return (
      <p
        role="status"
        className="rounded-2xl border border-amber-400/35 bg-amber-950/40 px-4 py-3 text-sm leading-relaxed text-amber-50"
      >
        출생 도시를 좌표로 바꾸지 못해 차트에 서울 좌표가 임시로 쓰였습니다. 도시를 수정한 뒤 다시
        읽으면 그 위치 기준으로 계산합니다. 임의 지정된 값은 해석에 표시됩니다.
      </p>
    );
  }
  return null;
}

export default function OracleSystemReadingClient({
  systemId,
  rosters,
  storageKey,
}: {
  systemId: SystemId;
  rosters: ReadingRosterOption[];
  storageKey: string;
}) {
  const router = useRouter();
  const copy = SINGLE_SYSTEM_BY_ID[systemId];
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<OracleBirthProfileV1 | null>(null);
  const [snapshot, setSnapshot] = useState<ProfileSnapshot>({});
  const [subjectProfileId, setSubjectProfileId] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [readerCount, setReaderCount] = useState(rosters[0]?.readerCount ?? 3);
  const [tarotSpread, setTarotSpread] = useState<TarotSpreadSize>(3);
  const [tarotPositions, setTarotPositions] = useState<number[]>([]);
  const [runeCount, setRuneCount] = useState(3);
  const [prismPicks, setPrismPicks] = useState<PrismPicks>({
    impulse: null,
    need: null,
    identity: null,
  });

  const session = useOracleRunnerSession({ storageKey });

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
      const snap = snapshotFromPayload(payload);
      const missing = missingRequiredFields(systemId, snap);

      if (isDrawBasedSystem(systemId) && !snap.subjectProfileId) {
        const stubRes = await fetch("/api/oracle/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ensureStub: true }),
        }).catch(() => null);
        const stubJson = (await stubRes?.json().catch(() => null)) as ProfilePayload | null;
        const stubId = stubJson?.subjectProfileId ?? null;
        if (!stubId) {
          router.replace(profilePathForSystem(systemId, missing));
          return;
        }
        setSubjectProfileId(stubId);
        setSnapshot({ ...snap, subjectProfileId: stubId, placeholderBirthDate: true });
        setReady(true);
        return;
      }

      if (missing.length > 0) {
        router.replace(profilePathForSystem(systemId, missing));
        return;
      }

      setProfile(payload?.profile ?? null);
      setSnapshot(snap);
      setSubjectProfileId(snap.subjectProfileId ?? null);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, systemId]);

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
    session.computations.find((entry) => entry.system === systemId) ??
    session.computations[0] ??
    null;

  const readingRows = view?.readings ?? EMPTY_READINGS;
  const readerOrder = view?.readerRoster ?? roster.readers;
  const readings = useMemo(
    () =>
      readingRows
        .filter((reading) => reading.system === systemId)
        .sort((a, b) => seatIndex(readerOrder, a.brand) - seatIndex(readerOrder, b.brand)),
    [readingRows, readerOrder, systemId],
  );

  const expectedReaders = readerOrder.length;
  const finished = session.terminal && consensus !== null;

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

  const tarotReady = systemId !== "tarot" || tarotPositions.length === tarotSpread;
  const prismReady =
    systemId !== "prism" ||
    (prismPicks.impulse != null && prismPicks.need != null && prismPicks.identity != null);
  const inputsReady = tarotReady && prismReady;

  const startReading = async () => {
    if (!subjectProfileId || !inputsReady) return;
    const sessionInputs: Record<string, unknown> = {};
    if (systemId === "tarot") {
      sessionInputs.tarot = { spread: tarotSpread, pickedPositions: tarotPositions };
    }
    if (systemId === "runes") {
      sessionInputs.runes = { count: runeCount };
    }
    if (systemId === "prism") {
      sessionInputs.prism = {
        impulse: prismPicks.impulse,
        need: prismPicks.need,
        identity: prismPicks.identity,
      };
    }
    const outcome = await session.start({
      subjectProfileId,
      systems: [systemId],
      readerCount,
      question,
      sessionInputs: Object.keys(sessionInputs).length ? sessionInputs : null,
    });
    if (!outcome.ok && typeof outcome.balance === "number") setCredits(outcome.balance);
  };

  const toggleTarot = (pos: number) => {
    setTarotPositions((prev) => {
      if (prev.includes(pos)) return prev.filter((p) => p !== pos);
      if (prev.length >= tarotSpread) return prev;
      return [...prev, pos];
    });
  };

  if (!ready) return <main className={BG} aria-busy="true" />;

  const insufficient = credits !== null && credits < roster.credits;
  const showBirthSketch = !isDrawBasedSystem(systemId) && (profile || snapshot.birth_date);

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
                <h1 className="mt-2 text-2xl font-semibold text-white">
                  {systemId === "saju" ? "Fate · " : ""}
                  {copy.name}
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  {finished
                    ? "같은 계산을 읽은 해석들을 한자리에 모았습니다."
                    : "계산은 끝났습니다. 해석자들의 글을 차례로 받고 있습니다."}
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

            <AssumptionsBanner systemId={systemId} assumptions={session.assumptions} />

            {consensus ? <SynthesisCard consensus={consensus} synthesizer={synthesizer} /> : null}

            <OracleSystemChart
              system={systemId}
              calculation={computation?.calculation ?? null}
              engineVersion={computation?.engineVersion ?? null}
              unreadable={computation?.unreadable}
            />

            <section>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <SectionLabel>해석자들의 읽기</SectionLabel>
                  <h2 className="mt-1 text-lg font-semibold text-white">같은 계산, 서로 다른 관점</h2>
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
                    첫 번째 해석자가 읽고 있습니다. 보통 15–30초가 걸립니다.
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
                oracleType={systemId}
                question={question.trim() || `${copy.name} 읽기`}
                allDone
                getResponses={getResponses}
                voteLabels={readerOrder}
                saveKey={session.sessionId}
              />
            ) : null}
          </section>
        ) : (
          <section>
            <SectionLabel>{copy.shortName}</SectionLabel>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              {systemId === "saju" ? "Fate" : copy.name}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-300">
              {copy.explanation[0]} {copy.explanation[1]}
            </p>

            {showBirthSketch ? (
              <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 text-slate-200">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">저장된 정보</p>
                    {snapshot.birth_date && !snapshot.placeholderBirthDate ? (
                      <p className="tabular-nums">{snapshot.birth_date}</p>
                    ) : null}
                    {profile ? (
                      <p className="tabular-nums text-slate-300">{birthTimeNote(profile)}</p>
                    ) : null}
                    {systemId === "astro" && snapshot.birth_place ? (
                      <p className="text-slate-400">{snapshot.birth_place}</p>
                    ) : null}
                    {systemId === "name" && snapshot.name_local ? (
                      <p className="text-slate-300">{snapshot.name_local}</p>
                    ) : null}
                    {systemId === "prism" && snapshot.mbti ? (
                      <p className="text-slate-300">MBTI {snapshot.mbti}</p>
                    ) : null}
                    {systemId === "numerology" && snapshot.name_latin ? (
                      <p className="text-slate-300">{snapshot.name_latin}</p>
                    ) : null}
                  </div>
                  <Link
                    href={profilePathForSystem(systemId, [])}
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

            {systemId === "tarot" ? (
              <div className="mt-8">
                <TarotDrawInput
                  spread={tarotSpread}
                  pickedPositions={tarotPositions}
                  onSpread={(next) => {
                    setTarotSpread(next);
                    setTarotPositions([]);
                  }}
                  onToggle={toggleTarot}
                />
              </div>
            ) : null}

            {systemId === "runes" ? (
              <div className="mt-8">
                <RunesCountInput count={runeCount} onChange={setRuneCount} />
              </div>
            ) : null}

            {systemId === "prism" ? (
              <div className="mt-8">
                <PrismColorInput value={prismPicks} onChange={setPrismPicks} />
              </div>
            ) : null}

            <div className="mt-8 space-y-3">
              <div className="flex items-end justify-between gap-3">
                <label className="text-[11px] uppercase tracking-[0.2em] text-white/55">해석자 수</label>
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
              <RosterPreview roster={roster} systemName={copy.shortName} />
            </div>

            <div className="mt-8 space-y-2">
              <label
                className="text-[11px] uppercase tracking-[0.2em] text-white/55"
                htmlFor={`${systemId}-question`}
              >
                질문 <span className="normal-case tracking-normal text-white/35">(선택)</span>
              </label>
              <textarea
                id={`${systemId}-question`}
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
                disabled={session.starting || insufficient || !subjectProfileId || !inputsReady}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-violet-500 px-5 py-4 text-sm font-semibold text-white shadow-lg shadow-violet-950/35 transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
              >
                {session.starting ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="h-4 w-4" aria-hidden />
                )}
                {session.starting ? "계산하는 중…" : `${copy.shortName} 읽기 시작 · ${roster.credits} 크레딧`}
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
