"use client";

/**
 * INTEGRATED 12-system reading — combined scope, the lobby's hero tier.
 *
 * Twelve dedicated brands each read their own system, N seers (3/5/7/9) each
 * cast ONE ballot, the tally is counted in CODE (runner/ballot.ts), and the
 * synthesis is ALSO produced — both layers are shown, nothing is hidden.
 *
 * Result order is a product decision:
 *   ① final verdicts with the divergence visible (conclusion stays on top)
 *   ② consensus map — tally bars, opposition sentences, polarized badge
 *      (consensus/lean/split headline labels were abolished; see
 *      PhaseConsensus in lib/oracle/axes/types.ts for the numbers behind it)
 *   ③ all twelve system readings, expanded
 *   ④ talisman entry point (deficiency vector)
 *
 * Brand names are shown; model names never reach this bundle.
 */
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  CircleAlert,
  LoaderCircle,
  Lock,
  RotateCcw,
  Scale,
  Sparkles,
} from "lucide-react";
import BrandBadge from "../runner/BrandBadge";
import TarotDrawInput from "../inputs/TarotDrawInput";
import RunesCountInput from "../inputs/RunesCountInput";
import PrismColorInput, { type PrismPicks } from "../inputs/PrismColorInput";
import MbtiEstimator from "../inputs/MbtiEstimator";
import {
  useOracleRunnerSession,
  type OracleRunnerConsensus,
  type OracleRunnerReading,
  type OracleRunnerVerdict,
} from "../runner/useOracleRunnerSession";
import { ORACLE_SEER_PERSONAS, seerPersona } from "@/lib/oracle/ai/seer-roster";
import { ORACLE_SESSION_CREDIT_PRICES } from "@/lib/oracle/runner/conventions";
import { SYSTEM_IDS, type SystemId } from "@/lib/oracle/axes/types";
import type { OracleBirthProfileV1 } from "@/lib/oracle/types";
import type { TarotSpreadSize } from "@/lib/oracle/engines/draw/conventions";
import { SINGLE_SYSTEM_BY_ID } from "@/lib/oracle/single-system-ui";
import {
  missingRequiredFields,
  type ProfileField,
  type ProfileSnapshot,
} from "@/lib/oracle/system-requirements";

const BG = "min-h-screen bg-[#0a0f1e] text-white";
const STORAGE_KEY = "oracle.integrated.active-session";
const COMBINED_COUNTS = [3, 5, 7, 9] as const;
type CombinedCount = (typeof COMBINED_COUNTS)[number];

type JsonObject = Record<string, unknown>;

/** Panel formats — length stays in the same band, the format changes. */
const COUNT_FORMAT: Record<CombinedCount, string> = {
  3: "세 판정자가 각자 긴 판정문을 씁니다",
  5: "다섯 판정자의 중간 판정 + 찬반 집계",
  7: "일곱 판정자의 한 줄 판정 + 표 수",
  9: "아홉 판정자의 한 줄 판정 + 표 수 + 소수 의견",
};

const DIRECTIONS = ["advance", "hold", "release"] as const;
type Direction = (typeof DIRECTIONS)[number];

const DIRECTION_META: Record<Direction, { label: string; chip: string; bar: string }> = {
  advance: {
    label: "전진",
    chip: "border-cyan-300/40 bg-cyan-400/10 text-cyan-100",
    bar: "bg-cyan-400/80",
  },
  hold: {
    label: "유지",
    chip: "border-violet-300/40 bg-violet-400/10 text-violet-100",
    bar: "bg-violet-400/80",
  },
  release: {
    label: "정리",
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

const ELEMENT_LABELS: Record<string, string> = {
  wood: "목(木)",
  fire: "화(火)",
  earth: "토(土)",
  metal: "금(金)",
  water: "수(水)",
};

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/65">
      {children}
    </p>
  );
}

function systemShortName(system: string): string {
  return SINGLE_SYSTEM_BY_ID[system as SystemId]?.shortName ?? system;
}

/* ------------------------------------------------------------------ */
/* Ballot / consensus JSON parsing (tolerant — the API shape is JSON)  */
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
/* Profile plumbing (mirrors the single-system page; do not share it — */
/* single mode must stay untouched)                                    */
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

/** Union of every system's required fields — combined reads all twelve. */
function missingForCombined(snapshot: ProfileSnapshot): ProfileField[] {
  const missing = new Set<ProfileField>();
  for (const system of SYSTEM_IDS) {
    for (const field of missingRequiredFields(system, snapshot)) missing.add(field);
  }
  return [...missing];
}

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
  const label = DIRECTION_META[tally.leader].label;
  if (tally.unanimous) return `만장일치 · ${label}`;
  return `${label} ${tally.leaderCount} / ${tally.participantCount}`;
}

function SeerVerdictCard({
  verdict,
  readerCount,
  minority,
  stub,
}: {
  verdict: OracleRunnerVerdict;
  readerCount: CombinedCount;
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
      {!failed && verdict.dissent && readerCount !== 9 ? (
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
  readerCount: CombinedCount;
  consensus: OracleRunnerConsensus | null;
  synthesizerBrand: string;
  terminal: boolean;
  stub: boolean;
}) {
  const finalTally = parseBallotTally(consensus?.ballotTally);
  // While seers are still voting the strip counts the landed ballots live;
  // the moment the finalize step writes the code tally, that becomes truth.
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
      {/* Conclusion stays at the top. */}
      <article className="rounded-[26px] border border-violet-300/25 bg-gradient-to-br from-violet-500/15 via-[#11172b] to-cyan-500/10 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.3)] sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>최종 판정</SectionLabel>
          {stub ? (
            <span className="rounded-full border border-amber-300/40 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
              연습 모드
            </span>
          ) : (
            <BrandBadge brand={synthesizerBrand} size="sm" />
          )}
        </div>
        <h2 className="mt-2 text-2xl font-semibold text-white">
          {finalTally ? verdictHeadline(finalTally) : terminal ? "판정 집계 실패" : "판정단이 투표하는 중"}
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
        <p className="mt-5 whitespace-pre-wrap text-[15px] leading-7 text-slate-100">
          {stub
            ? "연습 모드입니다. 이 종합은 실제 해석이 아니며 크레딧은 차감되지 않았습니다."
            : (consensus?.conclusion ??
              (terminal ? "종합 결론이 도착하지 않았습니다." : "모든 표가 모이면 결론이 여기에 놓입니다."))}
        </p>
        {!stub && consensus?.confidenceNote ? (
          <p className="mt-4 border-t border-white/8 pt-3 text-xs leading-relaxed text-white/45">
            {consensus.confidenceNote}
          </p>
        ) : null}
      </article>

      {/* The ballots — the divergence is the material, never hidden. */}
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

      {/* N=9: the minority gets its own highlight. */}
      {readerCount === 9 && minorityWithDissent.length > 0 ? (
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

      {/* The synthesis also ran — show its full material. */}
      {!stub && consensus && (consensus.agreements.length > 0 || consensus.divergences.length > 0) ? (
        <article className="rounded-[22px] border border-white/10 bg-[#10182b] p-5">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>종합 해석</SectionLabel>
            <BrandBadge brand={synthesizerBrand} size="sm" />
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
}: {
  consensus: OracleRunnerConsensus;
}) {
  const phase = parsePhaseMap(consensus.systemAgreement);
  const tally = parseBallotTally(consensus.ballotTally);
  if (!phase && !tally) return null;

  const phaseTotal = phase
    ? DIRECTIONS.reduce((sum, direction) => sum + phase.tally[direction], 0)
    : 0;

  return (
    <section>
      <SectionLabel>합의 지도</SectionLabel>
      <h2 className="mt-1 text-lg font-semibold text-white">열두 체계가 어디서 모이고 갈렸는가</h2>
      <div className="mt-4 space-y-4">
        {phase ? (
          <article className="rounded-[22px] border border-white/10 bg-[#10182b] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-200">체계 국면 집계 (가중치 반영)</h3>
              {phase.polarized ? (
                <span className="rounded-full border border-rose-300/40 bg-rose-400/10 px-2.5 py-1 text-[11px] font-semibold text-rose-100">
                  양극 — 전진·정리로 갈림
                </span>
              ) : null}
            </div>
            <div className="mt-4 space-y-2">
              {DIRECTIONS.map((direction) => {
                const share = phaseTotal > 0 ? (phase.tally[direction] / phaseTotal) * 100 : 0;
                return (
                  <div key={direction} className="flex items-center gap-3">
                    <span className="w-8 shrink-0 text-xs text-slate-300">
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
              {phase.unreadable.length
                ? ` 결번: ${phase.unreadable.map(systemShortName).join(", ")}.`
                : ""}
            </p>
            {phase.oppositions.length ? (
              <ul className="mt-3 space-y-1.5 border-t border-white/8 pt-3 text-[13px] leading-relaxed text-slate-300">
                {phase.oppositions.slice(0, 4).map((opposition) => (
                  <li key={`${opposition.a}-${opposition.b}`}>
                    <span className="font-semibold text-white">{systemShortName(opposition.a)}</span>
                    와{" "}
                    <span className="font-semibold text-white">{systemShortName(opposition.b)}</span>
                    가 정반대 방향을 봅니다{" "}
                    <span className="tabular-nums text-white/40">(격차 {Math.round(opposition.gap)})</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ) : null}

        {tally && tally.participantCount > 0 ? (
          <article className="rounded-[22px] border border-white/10 bg-[#10182b] p-5">
            <h3 className="text-sm font-semibold text-slate-200">판정단 영역 점수 (평균)</h3>
            <div className="mt-4 space-y-2">
              {FOCUS_KEYS.map((key) => {
                const mean = tally.domainMeans[key];
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-8 shrink-0 text-xs text-slate-300">{FOCUS_LABELS[key]}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/8">
                      {typeof mean === "number" ? (
                        <div
                          className="h-full bg-cyan-400/70"
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
/* ③ Twelve readings, expanded                                         */
/* ------------------------------------------------------------------ */

function ReadingsSection({
  readings,
  terminal,
  stub,
}: {
  readings: OracleRunnerReading[];
  terminal: boolean;
  stub: boolean;
}) {
  const bySystem = new Map(readings.map((reading) => [reading.system, reading]));
  const done = readings.filter((reading) => reading.status === "done").length;

  return (
    <section>
      <div className="flex items-end justify-between gap-3">
        <div>
          <SectionLabel>열두 체계의 읽기</SectionLabel>
          <h2 className="mt-1 text-lg font-semibold text-white">같은 사람, 열두 개의 계산</h2>
        </div>
        {!terminal ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-cyan-100/65">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {done}/{SYSTEM_IDS.length}
          </span>
        ) : null}
      </div>
      <div className="mt-4 grid gap-4">
        {SYSTEM_IDS.map((system) => {
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
                    이 체계는 이번 판독에서 읽히지 않았습니다. 빈자리는 빈자리로 둡니다.
                  </p>
                ) : null}
              </article>
            );
          }
          return (
            <article key={system} className="rounded-[22px] border border-white/10 bg-[#10182b] p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{name}</span>
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
/* ④ Talisman entry point                                              */
/* ------------------------------------------------------------------ */

function TalismanEntrySection({ consensus }: { consensus: OracleRunnerConsensus }) {
  const deficiency = asRecord(consensus.deficiencyVector);
  let topElement: string | null = null;
  let topGap = 0;
  if (deficiency) {
    for (const [element, value] of Object.entries(deficiency)) {
      if (typeof value === "number" && value > topGap && element in ELEMENT_LABELS) {
        topElement = element;
        topGap = value;
      }
    }
  }

  return (
    <section>
      <SectionLabel>부적</SectionLabel>
      <article className="mt-2 rounded-[22px] border border-white/10 bg-gradient-to-br from-amber-500/10 via-[#11172b] to-[#10182b] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-md">
            <h2 className="text-lg font-semibold text-white">
              {topElement
                ? `이번 판독에서 가장 부족한 기운은 ${ELEMENT_LABELS[topElement]}입니다`
                : "이번 판독에서는 크게 부족한 기운이 없습니다"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              {topElement
                ? "부적은 이 결핍을 겨냥해 만들어집니다. 열두 체계의 오행 합산에서 나온 값으로, 해석이 아니라 계산입니다."
                : "오행 합산이 기준선 위에 있습니다. 부족을 채우는 부적보다는 흐름을 지키는 쪽입니다."}
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-medium text-white/55">
            <Lock className="h-3 w-3" aria-hidden /> 준비 중
          </span>
        </div>
      </article>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Page component                                                      */
/* ------------------------------------------------------------------ */

export default function OracleIntegratedClient({
  readerBrands,
  synthesizerBrand,
}: {
  readerBrands: Array<{ system: SystemId; brand: string }>;
  synthesizerBrand: string;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [snapshot, setSnapshot] = useState<ProfileSnapshot>({});
  const [subjectProfileId, setSubjectProfileId] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [readerCount, setReaderCount] = useState<CombinedCount>(3);
  const [tarotSpread, setTarotSpread] = useState<TarotSpreadSize>(3);
  const [tarotPositions, setTarotPositions] = useState<number[]>([]);
  const [runeCount, setRuneCount] = useState(3);
  const [prismPicks, setPrismPicks] = useState<PrismPicks>({
    impulse: null,
    need: null,
    identity: null,
  });
  const [mbtiBusy, setMbtiBusy] = useState(false);

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
      const missing = missingForCombined(snap);
      const mbtiOnly = missing.length === 1 && missing[0] === "mbti";

      // Combined reads all twelve systems, so the profile must carry every
      // field. MBTI alone can be estimated in place, like the PRISM page.
      if (missing.length > 0 && !mbtiOnly) {
        const params = new URLSearchParams();
        params.set("return", "/modes/oracle/integrated");
        params.set("missing", missing.join(","));
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
  const sessionReaderCount = (readerRoster.length as CombinedCount) || readerCount;
  const finished = session.terminal && consensus !== null;
  const stub =
    session.aiMode === "stub" ||
    view?.aiMode === "stub" ||
    view?.readings.some((reading) => reading.brand === "stub" || looksLikeStubText(reading.narrative)) === true ||
    looksLikeStubText(consensus?.conclusion);

  const price = ORACLE_SESSION_CREDIT_PRICES.combined[readerCount] ?? 0;
  const insufficient = credits !== null && credits < price;

  const tarotReady = tarotPositions.length === tarotSpread;
  const prismReady =
    Boolean(snapshot.mbti) &&
    prismPicks.impulse != null &&
    prismPicks.need != null &&
    prismPicks.identity != null;
  const inputsReady = tarotReady && prismReady;

  const seatedPersonas = useMemo(
    () => ORACLE_SEER_PERSONAS.slice(0, readerCount),
    [readerCount],
  );

  const saveMbti = async (type: string, estimated: boolean) => {
    setMbtiBusy(true);
    session.setError(null);
    try {
      const response = await fetch("/api/oracle/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mbti: type, mbti_estimated: estimated }),
      });
      const payload = (await response.json().catch(() => null)) as ProfilePayload | null;
      if (!response.ok) {
        session.setError("MBTI를 저장하지 못했습니다.");
        return;
      }
      const snap = snapshotFromPayload(payload);
      setSnapshot((prev) => ({
        ...prev,
        ...snap,
        subjectProfileId: snap.subjectProfileId ?? prev.subjectProfileId,
        mbti: type,
        mbtiEstimated: estimated,
      }));
      if (snap.subjectProfileId) setSubjectProfileId(snap.subjectProfileId);
    } finally {
      setMbtiBusy(false);
    }
  };

  const startReading = async () => {
    if (!subjectProfileId || !inputsReady) return;
    const outcome = await session.start({
      subjectProfileId,
      scope: "combined",
      systems: [],
      readerCount,
      question,
      sessionInputs: {
        tarot: { spread: tarotSpread, pickedPositions: tarotPositions },
        runes: { count: runeCount },
        prism: {
          impulse: prismPicks.impulse,
          need: prismPicks.need,
          identity: prismPicks.identity,
        },
      },
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
                <h1 className="mt-2 text-2xl font-semibold text-white">통합 12체계 판독</h1>
                <p className="mt-1 text-sm text-slate-400">
                  {finished
                    ? "열두 읽기와 판정단의 표, 갈린 지점까지 전부 그대로 보여 드립니다."
                    : "계산은 끝났습니다. 열두 체계를 읽고, 판정단이 표를 던지고, 종합이 마지막에 씁니다."}
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

            {session.assumptions?.coordinatesDefaulted ? (
              <p
                role="status"
                className="rounded-2xl border border-amber-400/35 bg-amber-950/40 px-4 py-3 text-sm leading-relaxed text-amber-50"
              >
                출생 도시를 좌표로 바꾸지 못해 점성술 차트에 서울 좌표가 임시로 쓰였습니다. 도시를
                수정한 뒤 다시 읽으면 그 위치 기준으로 계산합니다.
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

            {/* ① Final verdicts — conclusion on top, divergence visible. */}
            <FinalVerdictsSection
              verdicts={verdicts}
              readerRoster={readerRoster}
              readerCount={sessionReaderCount}
              consensus={consensus}
              synthesizerBrand={synthesizerBrand}
              terminal={session.terminal}
              stub={stub}
            />

            {/* ② Consensus map. */}
            {consensus ? <ConsensusMapSection consensus={consensus} /> : null}

            {/* ③ All twelve readings, expanded. */}
            <ReadingsSection
              readings={view?.readings ?? []}
              terminal={session.terminal}
              stub={stub}
            />

            {/* ④ Talisman entry point. */}
            {finished && !stub && consensus ? <TalismanEntrySection consensus={consensus} /> : null}
          </section>
        ) : (
          <section>
            <SectionLabel>통합 12체계 판독</SectionLabel>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              당신의 운세를 두고 AI들이 갈렸습니다
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-300">
              같은 계산 하나를 열두 체계 전담 AI가 각자 읽고, 판정단이 한 표씩 던지고, 종합이
              일치점과 이견을 정리합니다. 표 집계는 AI가 아니라 코드가 합니다. 어디서 갈렸는지가
              진짜 정보입니다.
            </p>

            {snapshot.birth_date ? (
              <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 text-slate-200">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">저장된 정보</p>
                    <p className="tabular-nums">{snapshot.birth_date}</p>
                    {snapshot.birth_place ? (
                      <p className="text-slate-400">{snapshot.birth_place}</p>
                    ) : null}
                    {snapshot.name_local ? <p className="text-slate-300">{snapshot.name_local}</p> : null}
                    {snapshot.mbti ? (
                      <p className="text-slate-300">
                        MBTI {snapshot.mbti}
                        {snapshot.mbtiEstimated ? " · 추정" : ""}
                      </p>
                    ) : null}
                  </div>
                  <Link
                    href="/modes/oracle/profile?return=/modes/oracle/integrated"
                    className="shrink-0 rounded-full border border-cyan-300/35 px-3 py-1.5 text-xs text-cyan-100 hover:border-cyan-200/70"
                  >
                    수정
                  </Link>
                </div>
                <p className="mt-3 border-t border-white/8 pt-3 text-[11px] leading-relaxed text-white/40">
                  생년월일·시간·도시·이름은 계산에만 쓰이며 AI에게 전달되지 않습니다. 해석자와
                  판정단은 계산 결과만 받습니다.
                </p>
              </div>
            ) : null}

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

            <div className="mt-8">
              <RunesCountInput count={runeCount} onChange={setRuneCount} />
            </div>

            <div className="mt-8 space-y-6">
              {snapshot.mbti ? null : (
                <MbtiEstimator
                  busy={mbtiBusy}
                  onResolved={(type, estimated) => void saveMbti(type, estimated)}
                />
              )}
              <PrismColorInput value={prismPicks} onChange={setPrismPicks} />
            </div>

            <div className="mt-8 space-y-3">
              <div className="flex items-end justify-between gap-3">
                <label className="text-[11px] uppercase tracking-[0.2em] text-white/55">판정단 수</label>
                <span className="text-[11px] text-white/40">체계 전담 12곳 + 판정단 + 종합 1곳</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {COMBINED_COUNTS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setReaderCount(count)}
                    className={`rounded-xl border px-2 py-3 text-center transition ${
                      count === readerCount
                        ? "border-violet-300/55 bg-violet-400/15 text-white"
                        : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25"
                    }`}
                  >
                    <span className="block text-lg font-semibold">{count}명</span>
                    <span className="mt-0.5 block text-[11px] text-white/50">
                      {ORACLE_SESSION_CREDIT_PRICES.combined[count]} 크레딧
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] leading-relaxed text-slate-400">{COUNT_FORMAT[readerCount]}</p>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-[11px] leading-relaxed text-slate-300">
                  판정단은 말투가 아니라 <span className="font-semibold text-white">판단 규칙</span>이
                  다릅니다. 각자 열두 읽기 전체와 교차 집계를 받아 한 표씩 던지고, 집계는 코드가
                  합니다.
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
                  종합은 읽기에 참여하지 않은 <span className="font-semibold text-white">다른 AI</span>가
                  씁니다.
                </p>
                <div className="mt-2">
                  <BrandBadge brand={synthesizerBrand} size="sm" />
                </div>
              </div>
            </div>

            <div className="mt-8 space-y-2">
              <label
                className="text-[11px] uppercase tracking-[0.2em] text-white/55"
                htmlFor="integrated-question"
              >
                질문 <span className="normal-case tracking-normal text-white/35">(선택)</span>
              </label>
              <textarea
                id="integrated-question"
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
                {session.starting ? "계산하는 중…" : `통합 판독 시작 · ${price} 크레딧`}
              </button>
              {!inputsReady ? (
                <p className="text-xs text-white/45">
                  타로 {tarotPositions.length}/{tarotSpread}장
                  {!prismReady ? " · PRISM 색상 3개와 MBTI가 필요합니다" : ""}
                </p>
              ) : null}
              {insufficient ? (
                <p className="text-xs text-amber-200/85">이 판독에는 {price} 크레딧이 필요합니다.</p>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
