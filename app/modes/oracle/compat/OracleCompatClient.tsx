"use client";

/**
 * 궁합 (compatibility) client — kind='compat' on the SAME runner as readings.
 *
 * Two entry modes, mirroring the reading side:
 *   단일 체계 궁합  scope='single', one system, N=3/5 seers
 *   통합 12체계 궁합 scope='combined', all twelve, N=3/5/7 seers
 *
 * Person A is the saved profile. Person B is typed here and travels ONLY as
 * sessionInputs.partner — session-scoped, never written to any profile. That
 * promise is stated on screen, because it is someone else's data.
 *
 * Direction words are relationship motion (다가서기 / 지금처럼 / 거리두기);
 * the wire enum stays advance/hold/release so tally code never forks.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  CircleAlert,
  Heart,
  LoaderCircle,
  RotateCcw,
  Scale,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import BrandBadge from "../runner/BrandBadge";
import TarotDrawInput from "../inputs/TarotDrawInput";
import RunesDrawInput from "../inputs/RunesDrawInput";
import IchingCastInput from "../inputs/IchingCastInput";
import RunesDrawChart from "../charts/RunesDrawChart";
import IchingHexagramChart from "../charts/IchingHexagramChart";
import { OracleSessionEndFlow } from "../OracleSessionEndFlow";
import {
  useOracleRunnerSession,
  type OracleRunnerConsensus,
  type OracleRunnerReading,
  type OracleRunnerVerdict,
} from "../runner/useOracleRunnerSession";
import { ORACLE_SEER_PERSONAS, seerPersona } from "@/lib/oracle/ai/seer-roster";
import { ORACLE_COMPAT_SESSION_CREDIT_PRICES } from "@/lib/oracle/runner/conventions";
import type { SystemId } from "@/lib/oracle/axes/types";
import type { OracleBirthProfileV1 } from "@/lib/oracle/types";
import type { RuneSpreadSize, TarotSpreadSize } from "@/lib/oracle/engines/draw/conventions";
import type { LineValue } from "@/lib/oracle/engines/draw";
import { projectOracleArchiveResponses } from "@/lib/oracle/session-archive";
import { compatOracleType } from "@/lib/oracle/system-display";
import type { ReadingRosterOption } from "@/lib/oracle/reading-rosters";
import { SINGLE_SYSTEM_BY_ID } from "@/lib/oracle/single-system-ui";
import {
  fieldMissing,
  missingRequiredFields,
  requiredProfileFields,
  type ProfileField,
  type ProfileSnapshot,
} from "@/lib/oracle/system-requirements";

const BG = "min-h-screen bg-[#0a0f1e] text-white";
const STORAGE_KEY = "oracle.compat.active-session";

const COMPAT_COMBINED_COUNTS = [3, 5, 7] as const;
const COMPAT_SINGLE_COUNTS = [3, 5] as const;

type JsonObject = Record<string, unknown>;
type CompatScope = "combined" | "single";

const DIRECTIONS = ["advance", "hold", "release"] as const;
type Direction = (typeof DIRECTIONS)[number];

/** Relationship motion, not campaign motion — same wire enum underneath. */
const DIRECTION_META: Record<Direction, { label: string; long: string; chip: string; bar: string }> = {
  advance: {
    label: "다가서기",
    long: "더 가까이 — 다가서라",
    chip: "border-rose-300/40 bg-rose-400/10 text-rose-100",
    bar: "bg-rose-400/80",
  },
  hold: {
    label: "지금처럼",
    long: "지금의 흐름을 지켜라",
    chip: "border-violet-300/40 bg-violet-400/10 text-violet-100",
    bar: "bg-violet-400/80",
  },
  release: {
    label: "거리두기",
    long: "한 걸음 물러서라",
    chip: "border-amber-300/40 bg-amber-400/10 text-amber-100",
    bar: "bg-amber-400/80",
  },
};

const FOCUS_LABELS: Record<string, string> = {
  work: "일",
  money: "재물",
  love: "애정",
  social: "관계",
  energy: "기력",
};
const FOCUS_KEYS = ["work", "money", "love", "social", "energy"] as const;

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-rose-200/70">
      {children}
    </p>
  );
}

function systemShortName(system: string): string {
  return SINGLE_SYSTEM_BY_ID[system as SystemId]?.shortName ?? system;
}

/* ------------------------------------------------------------------ */
/* Ballot / consensus JSON parsing (same tolerant shape as integrated) */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function ballotDirection(ballot: JsonObject | null): Direction | null {
  const raw = ballot?.direction ?? ballot?.phase;
  return typeof raw === "string" && (DIRECTIONS as readonly string[]).includes(raw)
    ? (raw as Direction)
    : null;
}

function ballotFocus(ballot: JsonObject | null): string | null {
  const raw = ballot?.focus;
  return typeof raw === "string" && raw in FOCUS_LABELS ? raw : null;
}

type BallotTallyView = {
  counts: Record<Direction, number>;
  leader: Direction | null;
  leaderCount: number;
  participantCount: number;
  abstained: string[];
  unanimous: boolean;
  focusCounts: Record<string, number>;
  domainMeans: Record<string, number | null>;
  minoritySlugs: string[];
};

function parseBallotTally(raw: unknown): BallotTallyView | null {
  const record = asRecord(raw);
  const counts = asRecord(record?.counts);
  if (!record || !counts) return null;
  const leaderRaw = record.leader;
  return {
    counts: {
      advance: typeof counts.advance === "number" ? counts.advance : 0,
      hold: typeof counts.hold === "number" ? counts.hold : 0,
      release: typeof counts.release === "number" ? counts.release : 0,
    },
    leader:
      typeof leaderRaw === "string" && (DIRECTIONS as readonly string[]).includes(leaderRaw)
        ? (leaderRaw as Direction)
        : null,
    leaderCount: typeof record.leaderCount === "number" ? record.leaderCount : 0,
    participantCount: typeof record.participantCount === "number" ? record.participantCount : 0,
    abstained: Array.isArray(record.abstained)
      ? record.abstained.filter((value): value is string => typeof value === "string")
      : [],
    unanimous: record.unanimous === true,
    focusCounts: asRecord(record.focusCounts)
      ? (record.focusCounts as Record<string, number>)
      : {},
    domainMeans: asRecord(record.domainMeans)
      ? (record.domainMeans as Record<string, number | null>)
      : {},
    minoritySlugs: Array.isArray(record.minoritySlugs)
      ? record.minoritySlugs.filter((value): value is string => typeof value === "string")
      : [],
  };
}

type PhaseMapView = {
  tally: Record<Direction, number>;
  unanimityCount: number;
  participantCount: number;
  leader: Direction | null;
  polarized: boolean;
  oppositions: Array<{ a: string; b: string; gap: number }>;
  unreadable: string[];
};

function parsePhaseMap(systemAgreement: unknown): PhaseMapView | null {
  const phase = asRecord(asRecord(systemAgreement)?.phase);
  const tally = asRecord(phase?.tally);
  if (!phase || !tally) return null;
  const leaderRaw = phase.leader;
  return {
    tally: {
      advance: typeof tally.advance === "number" ? tally.advance : 0,
      hold: typeof tally.hold === "number" ? tally.hold : 0,
      release: typeof tally.release === "number" ? tally.release : 0,
    },
    unanimityCount: typeof phase.unanimityCount === "number" ? phase.unanimityCount : 0,
    participantCount: typeof phase.participantCount === "number" ? phase.participantCount : 0,
    leader:
      typeof leaderRaw === "string" && (DIRECTIONS as readonly string[]).includes(leaderRaw)
        ? (leaderRaw as Direction)
        : null,
    polarized: phase.polarized === true,
    oppositions: Array.isArray(phase.oppositions)
      ? phase.oppositions.flatMap((entry) => {
          const row = asRecord(entry);
          return row && typeof row.a === "string" && typeof row.b === "string" && typeof row.gap === "number"
            ? [{ a: row.a, b: row.b, gap: row.gap }]
            : [];
        })
      : [],
    unreadable: Array.isArray(phase.unreadable)
      ? phase.unreadable.filter((value): value is string => typeof value === "string")
      : [],
  };
}

/* ------------------------------------------------------------------ */
/* Profile plumbing                                                    */
/* ------------------------------------------------------------------ */

type ProfilePayload = {
  profile?: OracleBirthProfileV1 | null;
  complete?: boolean;
  subjectProfileId?: string | null;
  placeholderBirthDate?: boolean;
  mbtiEstimated?: boolean;
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
    derived?: { mbti_estimated?: unknown } | null;
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
    mbtiEstimated: payload?.mbtiEstimated === true || runner?.derived?.mbti_estimated === true,
    subjectProfileId: payload?.subjectProfileId ?? runner?.id ?? null,
    placeholderBirthDate: payload?.placeholderBirthDate === true,
  };
}

/**
 * Subject fields a 궁합 needs. MBTI is dropped everywhere: compat PRISM is
 * birth-anchored by design and asks for no colours and no MBTI.
 */
function missingForCompat(scope: CompatScope, system: SystemId, snapshot: ProfileSnapshot): ProfileField[] {
  if (scope === "single") {
    return missingRequiredFields(system, snapshot).filter((field) => field !== "mbti");
  }
  const missing = new Set<ProfileField>();
  // Combined compat reads all twelve; tzolkin needs birth_date and reads
  // voteless. Union of requirements minus mbti.
  for (const sys of Object.keys(SINGLE_SYSTEM_BY_ID) as SystemId[]) {
    for (const field of requiredProfileFields(sys)) {
      if (field !== "mbti" && fieldMissing(field, snapshot)) missing.add(field);
    }
  }
  return [...missing];
}

const FIELD_LABEL: Record<ProfileField, string> = {
  birth_date: "생년월일",
  sex: "성별",
  birth_place: "출생 도시",
  name: "이름",
  name_latin: "로마자 이름",
  mbti: "MBTI",
};

function looksLikeStubText(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  return trimmed.startsWith("[stub:") || trimmed === "stub synthesis conclusion";
}

/* ------------------------------------------------------------------ */
/* ① Final verdicts                                                    */
/* ------------------------------------------------------------------ */

function DirectionChip({ direction }: { direction: Direction | null }) {
  if (!direction) {
    return (
      <span className="inline-flex rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-white/50">
        기권
      </span>
    );
  }
  const meta = DIRECTION_META[direction];
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.chip}`}>
      {meta.label}
    </span>
  );
}

function VoteStrip({ counts, total }: { counts: Record<Direction, number>; total: number }) {
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/8">
        {DIRECTIONS.map((direction) =>
          counts[direction] > 0 ? (
            <div
              key={direction}
              className={DIRECTION_META[direction].bar}
              style={{ width: `${(counts[direction] / Math.max(total, 1)) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
        {DIRECTIONS.map((direction) => (
          <span key={direction} className="inline-flex items-center gap-1.5 tabular-nums">
            <span className={`h-2 w-2 rounded-full ${DIRECTION_META[direction].bar}`} />
            {DIRECTION_META[direction].label} {counts[direction]}표
          </span>
        ))}
      </div>
    </div>
  );
}

function verdictHeadline(tally: BallotTallyView): string {
  if (tally.participantCount === 0) return "판정 없음";
  if (tally.leader === null) return "팽팽함 — 다수 없음";
  const label = DIRECTION_META[tally.leader].long;
  if (tally.unanimous) return `만장일치 · ${DIRECTION_META[tally.leader].label}`;
  return `${label} — ${tally.leaderCount}/${tally.participantCount}표`;
}

function unanimityNote(tally: BallotTallyView): string | null {
  if (!tally.unanimous || tally.participantCount === 0) return null;
  if (tally.participantCount <= 3) {
    return "판정단 3명이 모두 같은 방향을 골랐습니다. 세 명 규모에서는 드문 일이 아니니, 아래 판정문들이 서로 다른 이유로 같은 결론에 닿았는지를 보세요.";
  }
  return `판정단 ${tally.participantCount}명 전원이 같은 방향입니다. 판정문 사이의 근거 차이가 진짜 정보입니다.`;
}

function SeerVerdictCard({
  verdict,
  readerCount,
  minority,
  stub,
}: {
  verdict: OracleRunnerVerdict;
  readerCount: number;
  minority: boolean;
  stub: boolean;
}) {
  const persona = seerPersona(verdict.readerSlug);
  const direction = ballotDirection(verdict.ballot);
  const focus = ballotFocus(verdict.ballot);
  const compact = readerCount >= 7;
  const failed = verdict.status !== "done";

  return (
    <article
      className={`rounded-[22px] border p-4 ${
        minority ? "border-amber-300/35 bg-amber-400/[0.05]" : "border-white/10 bg-[#10182b]"
      } ${compact ? "sm:p-4" : "sm:p-5"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-white">{persona?.nameKo ?? verdict.readerSlug}</span>
        <span className="text-[11px] text-white/40">{persona?.ruleKo}</span>
        <span className="ml-auto flex items-center gap-2">
          <DirectionChip direction={direction} />
          {focus ? (
            <span className="rounded-full border border-white/12 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-300">
              초점 {FOCUS_LABELS[focus]}
            </span>
          ) : null}
          {stub ? (
            <span className="rounded-full border border-amber-300/40 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
              연습 모드
            </span>
          ) : (
            <BrandBadge brand={verdict.brand} size="sm" />
          )}
        </span>
      </div>
      <p
        className={`mt-3 whitespace-pre-wrap text-slate-100 ${
          compact ? "text-[13px] leading-6" : readerCount === 5 ? "text-sm leading-6" : "text-[15px] leading-7"
        }`}
      >
        {failed
          ? "이 판정자는 표를 내지 못했습니다. 집계에서 기권으로 처리됩니다."
          : (verdict.verdictLine ?? "판정문이 도착하지 않았습니다.")}
      </p>
      {!failed && verdict.dissent ? (
        <p className="mt-3 rounded-xl border border-amber-300/25 bg-amber-400/[0.06] px-3 py-2 text-[12px] leading-relaxed text-amber-100/90">
          소수 의견 — {verdict.dissent}
        </p>
      ) : null}
    </article>
  );
}

function FinalVerdictsSection({
  verdicts,
  readerRoster,
  readerCount,
  consensus,
  synthesizerBrand,
  terminal,
  stub,
}: {
  verdicts: OracleRunnerVerdict[];
  readerRoster: string[];
  readerCount: number;
  consensus: OracleRunnerConsensus | null;
  synthesizerBrand: string | null;
  terminal: boolean;
  stub: boolean;
}) {
  const finalTally = parseBallotTally(consensus?.ballotTally);
  const liveCounts: Record<Direction, number> = { advance: 0, hold: 0, release: 0 };
  for (const verdict of verdicts) {
    const direction = verdict.status === "done" ? ballotDirection(verdict.ballot) : null;
    if (direction) liveCounts[direction] += 1;
  }
  const counts = finalTally?.counts ?? liveCounts;
  const total = DIRECTIONS.reduce((sum, direction) => sum + counts[direction], 0);
  const minoritySet = new Set(finalTally?.minoritySlugs ?? []);

  const ordered = [...verdicts].sort(
    (a, b) => readerRoster.indexOf(a.readerSlug) - readerRoster.indexOf(b.readerSlug),
  );
  const minorityWithDissent = ordered.filter(
    (verdict) => minoritySet.has(verdict.readerSlug) && verdict.dissent,
  );

  return (
    <section className="space-y-4">
      <article className="rounded-[26px] border border-rose-300/25 bg-gradient-to-br from-rose-500/15 via-[#11172b] to-violet-500/10 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.3)] sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>두 사람에 대한 최종 판정</SectionLabel>
          {stub ? (
            <span className="rounded-full border border-amber-300/40 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
              연습 모드
            </span>
          ) : synthesizerBrand ? (
            <BrandBadge brand={synthesizerBrand} size="sm" />
          ) : null}
        </div>
        <h2 className="mt-2 text-2xl font-semibold text-white">
          {finalTally ? verdictHeadline(finalTally) : terminal ? "판정 집계 실패" : "판정단이 관계를 두고 투표하는 중"}
        </h2>
        <div className="mt-4">
          <VoteStrip counts={counts} total={total} />
        </div>
        {finalTally?.abstained.length ? (
          <p className="mt-2 text-[11px] text-white/40">
            기권 {finalTally.abstained.length} —{" "}
            {finalTally.abstained.map((slug) => seerPersona(slug)?.nameKo ?? slug).join(", ")}
          </p>
        ) : null}
        {finalTally ? (
          (() => {
            const note = unanimityNote(finalTally);
            return note ? (
              <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] leading-relaxed text-slate-300">
                {note}
              </p>
            ) : null;
          })()
        ) : null}
        <p className="mt-5 whitespace-pre-wrap text-[15px] leading-7 text-slate-100">
          {stub
            ? "연습 모드입니다. 이 종합은 실제 해석이 아니며 크레딧은 차감되지 않았습니다."
            : (consensus?.conclusion ??
              (terminal ? "종합 결론이 도착하지 않았습니다." : "모든 표가 모이면 두 사람에 대한 결론이 여기에 놓입니다."))}
        </p>
        {!stub && consensus?.confidenceNote ? (
          <p className="mt-4 border-t border-white/8 pt-3 text-xs leading-relaxed text-white/45">
            {consensus.confidenceNote}
          </p>
        ) : null}
      </article>

      <div className="grid gap-3">
        {ordered.map((verdict) => (
          <SeerVerdictCard
            key={verdict.readerSlug}
            verdict={verdict}
            readerCount={readerCount}
            minority={minoritySet.has(verdict.readerSlug)}
            stub={stub}
          />
        ))}
        {!terminal && ordered.length < readerCount ? (
          <div className="rounded-[22px] border border-dashed border-white/12 bg-white/[0.02] px-5 py-6 text-center text-sm text-white/40">
            판정단 {ordered.length}/{readerCount} — 남은 판정자가 표를 쓰고 있습니다.
          </div>
        ) : null}
      </div>

      {minorityWithDissent.length > 0 ? (
        <article className="rounded-[22px] border border-amber-300/30 bg-amber-400/[0.05] p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-100">
            <Scale className="h-4 w-4" aria-hidden /> 소수 의견
          </h3>
          <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-amber-50/90">
            {minorityWithDissent.map((verdict) => (
              <li key={verdict.readerSlug}>
                <span className="font-semibold">
                  {seerPersona(verdict.readerSlug)?.nameKo ?? verdict.readerSlug}
                </span>{" "}
                — {verdict.dissent}
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      {!stub && consensus && (consensus.agreements.length > 0 || consensus.divergences.length > 0) ? (
        <article className="rounded-[22px] border border-white/10 bg-[#10182b] p-5">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>종합 해석</SectionLabel>
            {synthesizerBrand ? <BrandBadge brand={synthesizerBrand} size="sm" /> : null}
          </div>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
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
        </article>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* ② Consensus map                                                     */
/* ------------------------------------------------------------------ */

function ConsensusMapSection({
  consensus,
  readSystems,
  systemCount,
}: {
  consensus: OracleRunnerConsensus;
  readSystems: ReadonlySet<string>;
  systemCount: number;
}) {
  const phase = parsePhaseMap(consensus.systemAgreement);
  const tally = parseBallotTally(consensus.ballotTally);
  if (!phase && !tally) return null;

  const phaseTotal = phase
    ? DIRECTIONS.reduce((sum, direction) => sum + phase.tally[direction], 0)
    : 0;

  const phaseAbstained = phase ? phase.unreadable.filter((system) => readSystems.has(system)) : [];
  const phaseMissing = phase ? phase.unreadable.filter((system) => !readSystems.has(system)) : [];

  return (
    <section>
      <SectionLabel>합의 지도</SectionLabel>
      <h2 className="mt-1 text-lg font-semibold text-white">
        {systemCount > 1 ? "체계들이 이 관계를 어느 쪽으로 보는가" : "이 체계가 관계를 어느 쪽으로 보는가"}
      </h2>
      <div className="mt-4 space-y-4">
        {phase ? (
          <article className="rounded-[22px] border border-white/10 bg-[#10182b] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-200">체계 방향 집계 (가중치 반영)</h3>
              {phase.polarized ? (
                <span className="rounded-full border border-rose-300/40 bg-rose-400/10 px-2.5 py-1 text-[11px] font-semibold text-rose-100">
                  양극 — 다가서기·거리두기로 갈림
                </span>
              ) : null}
            </div>
            <div className="mt-4 space-y-2">
              {DIRECTIONS.map((direction) => {
                const share = phaseTotal > 0 ? (phase.tally[direction] / phaseTotal) * 100 : 0;
                return (
                  <div key={direction} className="flex items-center gap-3">
                    <span className="w-14 shrink-0 text-xs text-slate-300">
                      {DIRECTION_META[direction].label}
                    </span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/8">
                      <div
                        className={`h-full ${DIRECTION_META[direction].bar}`}
                        style={{ width: `${share}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-white/50">
                      {share.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-400">
              표를 낸 {phase.participantCount}개 체계 중 {phase.unanimityCount}개가
              {phase.leader ? ` ${DIRECTION_META[phase.leader].label} 쪽입니다.` : " 서로 다른 쪽을 봅니다."}
              {phaseAbstained.length
                ? ` ${phaseAbstained.map(systemShortName).join(", ")}는 방향 투표에는 불참합니다 — 읽기는 아래에 있습니다.`
                : ""}
              {phaseMissing.length ? ` 결번: ${phaseMissing.map(systemShortName).join(", ")}.` : ""}
            </p>
            {phase.oppositions.length ? (
              <ul className="mt-3 space-y-1.5 border-t border-white/8 pt-3 text-[13px] leading-relaxed text-slate-300">
                {phase.oppositions.slice(0, 4).map((opposition) => (
                  <li key={`${opposition.a}-${opposition.b}`}>
                    <span className="font-semibold text-white">{systemShortName(opposition.a)}</span>
                    와{" "}
                    <span className="font-semibold text-white">{systemShortName(opposition.b)}</span>
                    가 이 관계를 정반대로 봅니다{" "}
                    <span className="tabular-nums text-white/40">(격차 {Math.round(opposition.gap)})</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ) : null}

        {tally && tally.participantCount > 0 ? (
          <article className="rounded-[22px] border border-white/10 bg-[#10182b] p-5">
            <h3 className="text-sm font-semibold text-slate-200">
              판정단 영역 점수 (이 관계가 본인 삶에 미치는 영향, 평균)
            </h3>
            <div className="mt-4 space-y-2">
              {FOCUS_KEYS.map((key) => {
                const mean = tally.domainMeans[key];
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-8 shrink-0 text-xs text-slate-300">{FOCUS_LABELS[key]}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/8">
                      {typeof mean === "number" ? (
                        <div
                          className="h-full bg-rose-400/70"
                          style={{ width: `${Math.max(0, Math.min(100, mean))}%` }}
                        />
                      ) : null}
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-white/50">
                      {typeof mean === "number" ? mean.toFixed(0) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-400">
              판정단이 고른 초점:{" "}
              {FOCUS_KEYS.filter((key) => (tally.focusCounts[key] ?? 0) > 0)
                .map((key) => `${FOCUS_LABELS[key]} ${tally.focusCounts[key]}표`)
                .join(" · ") || "—"}
            </p>
          </article>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* ③ Readings                                                          */
/* ------------------------------------------------------------------ */

function drawItems(calculation: JsonObject | null, key: "runes" | "cards"): JsonObject[] {
  const draw = asRecord(calculation?.draw);
  if (!draw || !Array.isArray(draw[key])) return [];
  return (draw[key] as unknown[]).flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function ReadingsSection({
  systems,
  readings,
  computations,
  terminal,
  stub,
}: {
  systems: readonly string[];
  readings: OracleRunnerReading[];
  computations: Array<{ system: string; calculation: JsonObject | null }>;
  terminal: boolean;
  stub: boolean;
}) {
  const bySystem = new Map(readings.map((reading) => [reading.system, reading]));
  const calcBySystem = new Map(computations.map((entry) => [entry.system, entry.calculation]));
  const done = readings.filter((reading) => reading.status === "done").length;

  return (
    <section>
      <div className="flex items-end justify-between gap-3">
        <div>
          <SectionLabel>체계별 궁합 읽기</SectionLabel>
          <h2 className="mt-1 text-lg font-semibold text-white">
            {systems.length > 1 ? "같은 두 사람, 서로 다른 계산" : "이 체계가 본 두 사람"}
          </h2>
        </div>
        {!terminal ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-rose-100/65">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {done}/{systems.length}
          </span>
        ) : null}
      </div>
      <div className="mt-4 grid gap-4">
        {systems.map((system) => {
          const reading = bySystem.get(system) ?? null;
          const name = systemShortName(system);
          if (!reading) {
            return (
              <article
                key={system}
                className="rounded-[22px] border border-dashed border-white/12 bg-white/[0.02] p-5"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white/70">{name}</span>
                  <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] text-white/45">
                    {terminal ? "결번" : "대기 중"}
                  </span>
                </div>
                {terminal ? (
                  <p className="mt-3 text-[13px] leading-6 text-white/40">
                    이 체계는 이번 궁합에서 읽히지 않았습니다. 빈자리는 빈자리로 둡니다.
                  </p>
                ) : null}
              </article>
            );
          }
          const calculation = calcBySystem.get(system) ?? null;
          const runeItems = system === "runes" ? drawItems(calculation, "runes") : [];
          return (
            <article key={system} className="rounded-[22px] border border-white/10 bg-[#10182b] p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{name}</span>
                  {system === "tzolkin" ? (
                    <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] text-white/50">
                      전승에 궁합 규칙 없음 — 두 초상만 나란히
                    </span>
                  ) : null}
                  {stub ? (
                    <span className="rounded-full border border-amber-300/40 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
                      연습 모드
                    </span>
                  ) : (
                    <BrandBadge brand={reading.brand} size="sm" />
                  )}
                </div>
                {reading.latencyMs ? (
                  <span className="text-[10px] text-white/30">
                    {(reading.latencyMs / 1000).toFixed(1)}초
                  </span>
                ) : null}
              </div>
              {runeItems.length ? (
                <div className="mt-4">
                  <RunesDrawChart runes={runeItems} />
                </div>
              ) : null}
              {system === "iching" && calculation ? (
                <div className="mt-4">
                  <IchingHexagramChart calculation={calculation} />
                </div>
              ) : null}
              <div className="mt-3 whitespace-pre-wrap text-[14px] leading-7 text-slate-100">
                {stub
                  ? "연습 모드의 자리 표시 문장입니다. 실제 해석이 아닙니다."
                  : (reading.narrative ??
                    (reading.status === "done"
                      ? "이 해석자는 본문을 남기지 않았습니다."
                      : "이 해석자는 이번 응답을 마치지 못했습니다."))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Person B form — session-scoped by design                            */
/* ------------------------------------------------------------------ */

type PartnerForm = {
  birthDate: string;
  birthTime: string;
  timeUnknown: boolean;
  sex: "M" | "F" | null;
  name: string;
};

function PartnerCard({
  partner,
  onChange,
  nameRequired,
}: {
  partner: PartnerForm;
  onChange: (next: PartnerForm) => void;
  nameRequired: boolean;
}) {
  return (
    <div className="rounded-2xl border border-rose-300/20 bg-rose-400/[0.04] p-4">
      <div className="flex items-center gap-2">
        <Heart className="h-4 w-4 text-rose-200/80" aria-hidden />
        <p className="text-sm font-semibold text-white">상대방 (Person B)</p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-[11px] uppercase tracking-[0.18em] text-white/55" htmlFor="compat-b-date">
            생년월일 <span className="text-rose-200/85">*</span>
          </label>
          <input
            id="compat-b-date"
            type="date"
            value={partner.birthDate}
            onChange={(event) => onChange({ ...partner, birthDate: event.target.value })}
            className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm text-white focus:border-rose-300/55 focus:outline-none [color-scheme:dark]"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-[0.18em] text-white/55" htmlFor="compat-b-time">
            출생 시각 <span className="normal-case tracking-normal text-white/35">(선택)</span>
          </label>
          <input
            id="compat-b-time"
            type="time"
            value={partner.timeUnknown ? "" : partner.birthTime}
            disabled={partner.timeUnknown}
            onChange={(event) => onChange({ ...partner, birthTime: event.target.value })}
            className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm text-white focus:border-rose-300/55 focus:outline-none disabled:opacity-40 [color-scheme:dark]"
          />
          <label className="mt-1.5 flex items-center gap-2 text-[12px] text-slate-300">
            <input
              type="checkbox"
              checked={partner.timeUnknown}
              onChange={(event) =>
                onChange({ ...partner, timeUnknown: event.target.checked, birthTime: "" })
              }
              className="h-3.5 w-3.5 accent-rose-400"
            />
            시각을 모릅니다 — 시각이 필요한 계산(시주·대한·하우스)은 정직하게 뺍니다
          </label>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/55">
            성별 <span className="normal-case tracking-normal text-white/35">(대운·대한 방향에만 사용)</span>
          </p>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {(
              [
                { value: "M", label: "남" },
                { value: "F", label: "여" },
                { value: null, label: "밝히지 않음" },
              ] as const
            ).map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => onChange({ ...partner, sex: option.value })}
                className={`rounded-xl border px-2 py-2 text-xs transition ${
                  partner.sex === option.value
                    ? "border-rose-300/55 bg-rose-400/15 text-white"
                    : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-[0.18em] text-white/55" htmlFor="compat-b-name">
            이름{" "}
            {nameRequired ? (
              <span className="text-rose-200/85">* 성명 궁합에 필요</span>
            ) : (
              <span className="normal-case tracking-normal text-white/35">(선택 — 성명 궁합에만 사용)</span>
            )}
          </label>
          <input
            id="compat-b-name"
            type="text"
            maxLength={40}
            value={partner.name}
            onChange={(event) => onChange({ ...partner, name: event.target.value })}
            placeholder="예: 김민준"
            className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-rose-300/55 focus:outline-none"
          />
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 border-t border-white/8 pt-3 text-[11px] leading-relaxed text-rose-100/80">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        상대방의 정보는 타인의 것이므로 이 판독 한 번에만 쓰입니다. 회원님의 프로필이나 어떤
        프로필에도 저장되지 않고, 계산에만 사용되며 AI에게는 생년월일·시각·이름이 전달되지
        않습니다.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page component                                                      */
/* ------------------------------------------------------------------ */

export default function OracleCompatClient({
  compatSingleSystems,
  singleRosters,
  readerBrands,
  integratedSynthesizerBrand,
}: {
  compatSingleSystems: SystemId[];
  singleRosters: Record<string, ReadingRosterOption[]>;
  readerBrands: Array<{ system: SystemId; brand: string }>;
  integratedSynthesizerBrand: string;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [snapshot, setSnapshot] = useState<ProfileSnapshot>({});
  const [subjectProfileId, setSubjectProfileId] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [scope, setScope] = useState<CompatScope>("combined");
  const [singleSystem, setSingleSystem] = useState<SystemId>("saju");
  const [readerCount, setReaderCount] = useState<number>(3);
  const [question, setQuestion] = useState("");
  const [partner, setPartner] = useState<PartnerForm>({
    birthDate: "",
    birthTime: "",
    timeUnknown: false,
    sex: null,
    name: "",
  });
  const [tarotSpread, setTarotSpread] = useState<TarotSpreadSize>(3);
  const [tarotPositions, setTarotPositions] = useState<number[]>([]);
  const [runeSpread, setRuneSpread] = useState<RuneSpreadSize>(3);
  const [runePositions, setRunePositions] = useState<number[]>([]);
  const [ichingLines, setIchingLines] = useState<LineValue[]>([]);

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
      const snap = snapshotFromPayload(payload);

      // 궁합 needs Person A's birth date at minimum — without it there is no
      // pair to read. Everything subtler degrades honestly per system.
      if (!snap.birth_date || snap.placeholderBirthDate) {
        const params = new URLSearchParams();
        params.set("return", "/modes/oracle/compat");
        params.set("missing", "birth_date");
        router.replace(`/modes/oracle/profile?${params.toString()}`);
        return;
      }

      setSnapshot(snap);
      setSubjectProfileId(snap.subjectProfileId ?? null);
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

  const view = session.view;
  const consensus = view?.consensus ?? null;
  const verdicts = view?.verdicts ?? [];
  const readerRoster = view?.readerRoster ?? [];
  const sessionSystems = view?.systems ?? [];
  const sessionScope: CompatScope = sessionSystems.length === 1 ? "single" : "combined";
  const sessionReaderCount = readerRoster.length || readerCount;
  const finished = session.terminal && consensus !== null;
  const stub =
    session.aiMode === "stub" ||
    view?.aiMode === "stub" ||
    view?.readings.some((reading) => reading.brand === "stub" || looksLikeStubText(reading.narrative)) === true ||
    looksLikeStubText(consensus?.conclusion);

  const counts: readonly number[] = scope === "single" ? COMPAT_SINGLE_COUNTS : COMPAT_COMBINED_COUNTS;
  const priceTable = ORACLE_COMPAT_SESSION_CREDIT_PRICES[scope === "single" ? "single" : "combined"];
  const price = priceTable[readerCount] ?? 0;
  const insufficient = credits !== null && credits < price;

  // Scope toggle keeps the picked panel size legal (7 exists only in 통합).
  const selectScope = (next: CompatScope) => {
    setScope(next);
    const allowed: readonly number[] = next === "single" ? COMPAT_SINGLE_COUNTS : COMPAT_COMBINED_COUNTS;
    if (!allowed.includes(readerCount)) setReaderCount(allowed[0]!);
  };

  const missingFields = useMemo(
    () => (ready ? missingForCompat(scope, singleSystem, snapshot) : []),
    [ready, scope, singleSystem, snapshot],
  );

  const showTarot = scope === "combined" || singleSystem === "tarot";
  const showRunes = scope === "combined" || singleSystem === "runes";
  const showIching = scope === "combined" || singleSystem === "iching";
  const tarotReady = !showTarot || tarotPositions.length === tarotSpread;
  const runesReady = !showRunes || runePositions.length === runeSpread;
  const ichingReady = !showIching || ichingLines.length === 6;
  const inputsReady = tarotReady && runesReady && ichingReady;

  const partnerNameRequired = scope === "single" && singleSystem === "name";
  const partnerReady =
    /^\d{4}-\d{2}-\d{2}$/.test(partner.birthDate) &&
    (!partnerNameRequired || partner.name.trim().length >= 2);

  const canStart =
    Boolean(subjectProfileId) &&
    inputsReady &&
    partnerReady &&
    missingFields.length === 0 &&
    !insufficient;

  const seatedPersonas = useMemo(
    () => ORACLE_SEER_PERSONAS.slice(0, readerCount),
    [readerCount],
  );

  const singleRosterForCount: ReadingRosterOption | null =
    scope === "single"
      ? (singleRosters[singleSystem]?.find((option) => option.readerCount === readerCount) ?? null)
      : null;

  // Result-side synthesizer brand: derive from the SESSION (survives reload).
  const resultSynthesizer: string | null =
    sessionScope === "single"
      ? (singleRosters[sessionSystems[0] ?? ""]?.find(
          (option) => option.readerCount === sessionReaderCount,
        )?.synthesizer ?? null)
      : integratedSynthesizerBrand;

  const startReading = async () => {
    if (!subjectProfileId || !canStart) return;
    const sessionInputs: JsonObject = {
      partner: {
        birthDate: partner.birthDate,
        birthTime: partner.timeUnknown || !partner.birthTime ? null : partner.birthTime,
        sex: partner.sex,
        name: partner.name.trim() || null,
      },
    };
    if (showTarot) sessionInputs.tarot = { spread: tarotSpread, pickedPositions: tarotPositions };
    if (showRunes) sessionInputs.runes = { spread: runeSpread, pickedPositions: runePositions };
    if (showIching) sessionInputs.iching = { lines: ichingLines };

    const outcome = await session.start({
      subjectProfileId,
      kind: "compat",
      scope,
      systems: scope === "single" ? [singleSystem] : [],
      readerCount,
      question,
      sessionInputs,
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

  const toggleRune = (pos: number) => {
    setRunePositions((prev) => {
      if (prev.includes(pos)) return prev.filter((p) => p !== pos);
      if (prev.length >= runeSpread) return prev;
      return [...prev, pos];
    });
  };

  const doneReadings = useMemo(
    () => (view?.readings ?? []).filter((reading) => reading.status === "done"),
    [view],
  );

  const getResponses = useCallback(
    () =>
      projectOracleArchiveResponses({
        readings: doneReadings.map((reading) => ({
          brand: reading.brand,
          narrative: reading.narrative,
        })),
        synthesis:
          consensus && resultSynthesizer
            ? { brand: resultSynthesizer, conclusion: consensus.conclusion }
            : null,
      }),
    [doneReadings, consensus, resultSynthesizer],
  );

  const voteLabels = useMemo(
    () => [...new Set(doneReadings.map((reading) => reading.brand))],
    [doneReadings],
  );

  const assumptions = session.assumptions;

  if (!ready) return <main className={BG} aria-busy="true" />;

  return (
    <main className={BG}>
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 pb-28 pt-6 sm:px-8 sm:pt-9">
        <header className="mb-8 flex flex-wrap items-center gap-3">
          <Link
            href="/modes/oracle"
            className="inline-flex items-center gap-1 text-sm text-rose-200/90 hover:text-rose-100"
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
                  {sessionScope === "single"
                    ? `${systemShortName(sessionSystems[0] ?? "")} 궁합`
                    : "통합 12체계 궁합"}
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  {finished
                    ? "체계별 읽기와 판정단의 표, 갈린 지점까지 전부 그대로 보여 드립니다."
                    : "계산은 끝났습니다. 각 체계가 두 사람을 읽고, 판정단이 표를 던지고, 종합이 마지막에 씁니다."}
                </p>
              </div>
              <button
                type="button"
                onClick={session.reset}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-white/25"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> 새 궁합
              </button>
            </div>

            {assumptions?.partnerBirthTimeUnknown || assumptions?.partnerSexDefaulted ? (
              <p
                role="status"
                className="rounded-2xl border border-amber-400/35 bg-amber-950/40 px-4 py-3 text-sm leading-relaxed text-amber-50"
              >
                {assumptions.partnerBirthTimeUnknown
                  ? "상대방의 출생 시각이 없어 시각이 필요한 계산(시주 · 대한 · 하우스)은 상대 쪽에서 뺐습니다. "
                  : ""}
                {assumptions.partnerSexDefaulted
                  ? "상대방의 성별이 없어 대운·대한 방향은 기본값으로 계산되었습니다."
                  : ""}
              </p>
            ) : null}

            {assumptions?.coordinatesDefaulted ? (
              <p
                role="status"
                className="rounded-2xl border border-amber-400/35 bg-amber-950/40 px-4 py-3 text-sm leading-relaxed text-amber-50"
              >
                출생 도시를 좌표로 바꾸지 못해 점성술 차트에 서울 좌표가 임시로 쓰였습니다.
              </p>
            ) : null}

            {stub ? (
              <p
                role="status"
                className="rounded-2xl border border-amber-400/45 bg-amber-950/50 px-4 py-3 text-sm leading-relaxed text-amber-50"
              >
                연습 모드입니다. 아래 글은 실제 해석이 아니며 크레딧은 차감되지 않습니다.
              </p>
            ) : null}

            <FinalVerdictsSection
              verdicts={verdicts}
              readerRoster={readerRoster}
              readerCount={sessionReaderCount}
              consensus={consensus}
              synthesizerBrand={resultSynthesizer}
              terminal={session.terminal}
              stub={stub}
            />

            {consensus ? (
              <ConsensusMapSection
                consensus={consensus}
                readSystems={
                  new Set(
                    (view?.readings ?? [])
                      .filter((reading) => reading.status === "done" && reading.narrative)
                      .map((reading) => reading.system),
                  )
                }
                systemCount={sessionSystems.length}
              />
            ) : null}

            <ReadingsSection
              systems={sessionSystems}
              readings={view?.readings ?? []}
              computations={session.computations}
              terminal={session.terminal}
              stub={stub}
            />

            {session.terminal && !stub ? (
              <OracleSessionEndFlow
                oracleType={
                  sessionScope === "single" ? compatOracleType(sessionSystems[0]) : compatOracleType()
                }
                question={question.trim() || "궁합 읽기"}
                allDone
                getResponses={getResponses}
                voteLabels={voteLabels}
                saveKey={session.sessionId}
              />
            ) : null}
          </section>
        ) : (
          <section>
            <SectionLabel>궁합</SectionLabel>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              두 사람의 흐름을 겹쳐 읽습니다
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-300">
              각 체계가 자기 전통의 방식으로 두 사람의 관계를 읽습니다 — 시나스트리, 일주 합충,
              三九의 비법. 판정단은 관계 자체를 두고 표를 던지고, 집계는 코드가 합니다. 궁합
              점수를 지어내지 않습니다.
            </p>

            {/* Entry mode: 통합 vs 단일 */}
            <div className="mt-7 grid grid-cols-2 gap-2">
              {(
                [
                  { value: "combined", title: "통합 12체계 궁합", subtitle: "열두 체계가 한 관계를 읽음" },
                  { value: "single", title: "단일 체계 궁합", subtitle: "한 체계로 깊게" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => selectScope(option.value)}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    scope === option.value
                      ? "border-rose-300/55 bg-rose-400/10 text-white"
                      : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25"
                  }`}
                >
                  <span className="block text-sm font-semibold">{option.title}</span>
                  <span className="mt-0.5 block text-[11px] text-white/45">{option.subtitle}</span>
                </button>
              ))}
            </div>

            {scope === "single" ? (
              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-white/55">체계 선택</p>
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {compatSingleSystems.map((system) => (
                    <button
                      key={system}
                      type="button"
                      onClick={() => setSingleSystem(system)}
                      className={`rounded-xl border px-2 py-2 text-center text-xs transition ${
                        singleSystem === system
                          ? "border-rose-300/55 bg-rose-400/15 text-white"
                          : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25"
                      }`}
                    >
                      {systemShortName(system)}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                  마야 촐킨은 전승에 두 사람 궁합 규칙이 없어 단일 궁합에서는 제외됩니다 (통합에는
                  포함되며, 두 초상을 나란히 읽되 점수를 내지 않습니다).
                </p>
              </div>
            ) : null}

            {/* Person A — the saved profile */}
            {snapshot.birth_date ? (
              <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 text-slate-200">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                      본인 (Person A) — 저장된 프로필
                    </p>
                    <p className="tabular-nums">{snapshot.birth_date}</p>
                    {snapshot.birth_place ? (
                      <p className="text-slate-400">{snapshot.birth_place}</p>
                    ) : null}
                    {snapshot.name_local ? <p className="text-slate-300">{snapshot.name_local}</p> : null}
                  </div>
                  <Link
                    href="/modes/oracle/profile?return=/modes/oracle/compat"
                    className="shrink-0 rounded-full border border-rose-300/35 px-3 py-1.5 text-xs text-rose-100 hover:border-rose-200/70"
                  >
                    수정
                  </Link>
                </div>
                <p className="mt-3 border-t border-white/8 pt-3 text-[11px] leading-relaxed text-white/40">
                  두 사람 모두의 생년월일·시각·도시·이름은 계산에만 쓰이며 AI에게 전달되지
                  않습니다. 해석자와 판정단은 계산 결과만 받습니다.
                </p>
              </div>
            ) : null}

            {/* Person B — session-scoped */}
            <div className="mt-4">
              <PartnerCard partner={partner} onChange={setPartner} nameRequired={partnerNameRequired} />
            </div>

            {missingFields.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-amber-400/35 bg-amber-950/40 px-4 py-3 text-sm leading-relaxed text-amber-50">
                이 {scope === "single" ? "체계" : "통합 궁합"}에는 본인 프로필의{" "}
                {missingFields.map((field) => FIELD_LABEL[field]).join(", ")}이(가) 필요합니다.{" "}
                <Link
                  href={`/modes/oracle/profile?return=/modes/oracle/compat&missing=${missingFields.join(",")}`}
                  className="font-semibold underline underline-offset-2"
                >
                  프로필 보완하기
                </Link>
              </div>
            ) : null}

            {showTarot ? (
              <div className="mt-8">
                <p className="mb-3 text-sm font-semibold text-white">
                  타로 — 관계를 위한 한 번의 드로우
                </p>
                <TarotDrawInput
                  compat
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

            {showRunes ? (
              <div className="mt-8">
                <p className="mb-3 text-sm font-semibold text-white">
                  룬 — 관계를 위한 한 번의 캐스팅
                </p>
                <RunesDrawInput
                  compat
                  spread={runeSpread}
                  pickedPositions={runePositions}
                  onSpread={(next) => {
                    setRuneSpread(next);
                    setRunePositions([]);
                  }}
                  onToggle={toggleRune}
                />
              </div>
            ) : null}

            {showIching ? (
              <div className="mt-8">
                <p className="mb-3 text-sm font-semibold text-white">
                  주역 — 세효는 본인, 응효는 상대
                </p>
                <IchingCastInput
                  lines={ichingLines}
                  onThrow={(value) =>
                    setIchingLines((prev) => (prev.length >= 6 ? prev : [...prev, value]))
                  }
                  onReset={() => setIchingLines([])}
                />
              </div>
            ) : null}

            <div className="mt-8 space-y-3">
              <div className="flex items-end justify-between gap-3">
                <label className="text-[11px] uppercase tracking-[0.2em] text-white/55">판정단 수</label>
                <span className="text-[11px] text-white/40">
                  {scope === "combined" ? "체계 전담 12곳 + 판정단 + 종합 1곳" : "해석자 + 판정단 + 종합"}
                </span>
              </div>
              <div className={`grid gap-2 ${counts.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                {counts.map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setReaderCount(count)}
                    className={`rounded-xl border px-2 py-3 text-center transition ${
                      count === readerCount
                        ? "border-rose-300/55 bg-rose-400/15 text-white"
                        : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25"
                    }`}
                  >
                    <span className="block text-lg font-semibold">{count}명</span>
                    <span className="mt-0.5 block text-[11px] text-white/50">
                      {priceTable[count]} 크레딧
                    </span>
                  </button>
                ))}
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-[11px] leading-relaxed text-slate-300">
                  판정단은 <span className="font-semibold text-white">관계 자체</span>를 두고 표를
                  던집니다 — 다가서기 · 지금처럼 · 거리두기. 집계는 코드가 합니다.
                </p>
                <ul className="mt-3 space-y-1.5">
                  {seatedPersonas.map((persona) => (
                    <li key={persona.slug} className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="font-semibold text-white">{persona.nameKo}</span>
                      <span className="text-slate-400">{persona.ruleKo}</span>
                      <span className="ml-auto">
                        <BrandBadge brand={persona.brand} size="sm" />
                      </span>
                    </li>
                  ))}
                </ul>
                {scope === "combined" ? (
                  <>
                    <p className="mt-4 border-t border-white/8 pt-3 text-[11px] leading-relaxed text-slate-300">
                      열두 체계는 각 전담 AI가 읽습니다.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {readerBrands.map((entry) => (
                        <span
                          key={entry.system}
                          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-300"
                        >
                          {systemShortName(entry.system)}
                          <span className="text-white/85">{entry.brand}</span>
                        </span>
                      ))}
                    </div>
                    <p className="mt-3 text-[11px] leading-relaxed text-slate-300">
                      종합은 읽기에 참여하지 않은{" "}
                      <span className="font-semibold text-white">다른 AI</span>가 씁니다.
                    </p>
                    <div className="mt-2">
                      <BrandBadge brand={integratedSynthesizerBrand} size="sm" />
                    </div>
                  </>
                ) : singleRosterForCount ? (
                  <>
                    <p className="mt-4 border-t border-white/8 pt-3 text-[11px] leading-relaxed text-slate-300">
                      {systemShortName(singleSystem)} 궁합은{" "}
                      <span className="font-semibold text-white">
                        {singleRosterForCount.readers.length}개 AI
                      </span>
                      가 각자 독립적으로 읽습니다.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {singleRosterForCount.readers.map((brand) => (
                        <BrandBadge key={brand} brand={brand} size="sm" />
                      ))}
                    </div>
                    <p className="mt-3 text-[11px] leading-relaxed text-slate-300">
                      종합은 이들 중 어느 곳도 아닌{" "}
                      <span className="font-semibold text-white">다른 AI</span>가 씁니다.
                    </p>
                    <div className="mt-2">
                      <BrandBadge brand={singleRosterForCount.synthesizer} size="sm" />
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            <div className="mt-8 space-y-2">
              <label
                className="text-[11px] uppercase tracking-[0.2em] text-white/55"
                htmlFor="compat-question"
              >
                관계에 대한 질문 <span className="normal-case tracking-normal text-white/35">(선택)</span>
              </label>
              <textarea
                id="compat-question"
                rows={4}
                maxLength={2000}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="이 관계에서 가장 궁금한 것을 적어 주세요. 비워 두면 관계의 전반적인 흐름을 읽습니다."
                className="w-full resize-y rounded-2xl border border-white/15 bg-black/35 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-rose-300/55 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void startReading()}
                disabled={session.starting || !canStart}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 to-violet-500 px-5 py-4 text-sm font-semibold text-white shadow-lg shadow-rose-950/35 transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
              >
                {session.starting ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="h-4 w-4" aria-hidden />
                )}
                {session.starting
                  ? "계산하는 중…"
                  : `${scope === "single" ? `${systemShortName(singleSystem)} 궁합` : "통합 궁합"} 시작 · ${price} 크레딧`}
              </button>
              {!partnerReady ? (
                <p className="text-xs text-white/45">
                  상대방의 생년월일이 필요합니다
                  {partnerNameRequired && partner.name.trim().length < 2
                    ? " · 성명 궁합에는 상대방 이름도 필요합니다"
                    : ""}
                  .
                </p>
              ) : null}
              {!inputsReady ? (
                <p className="text-xs text-white/45">
                  {showTarot ? `타로 ${tarotPositions.length}/${tarotSpread}장` : ""}
                  {showRunes ? ` · 룬 ${runePositions.length}/${runeSpread}돌` : ""}
                  {showIching ? ` · 주역 ${ichingLines.length}/6효` : ""}
                </p>
              ) : null}
              {insufficient ? (
                <p className="text-xs text-amber-200/85">이 궁합에는 {price} 크레딧이 필요합니다.</p>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
