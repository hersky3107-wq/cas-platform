"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { ORACLE_SESSION_CREDIT_PRICES } from "@/lib/oracle/runner/conventions";
import {
  SINGLE_SYSTEM_BY_ID,
  SINGLE_SYSTEMS,
  type SingleSystemId,
} from "@/lib/oracle/single-system-ui";
import CalculationPanel, { type PublicComputation } from "./CalculationPanel";

type JsonObject = Record<string, unknown>;
type ReaderCount = 3 | 5 | 7;
type SessionStatus = "queued" | "computing" | "layer1" | "layer2" | "done" | "partial" | "failed";

type PublicReading = {
  system: string;
  brand: string;
  narrative: string | null;
  summary: JsonObject | null;
  status: string | null;
  latencyMs: number | null;
};

type PublicConsensus = {
  agreements: string[];
  divergences: string[];
  conclusion: string | null;
  confidenceNote: string | null;
  unanimous: boolean | null;
};

type SessionView = {
  sessionId: string;
  status: SessionStatus;
  nextAction: string | null;
  counts: { done: number; pending: number; failed: number; total: number };
  systems: string[];
  readerRoster: string[];
  locale: string | null;
  working: boolean;
  computations: PublicComputation[];
  readings: PublicReading[];
  consensus: PublicConsensus | null;
};

type RunnerProfile = {
  id: string;
  birth_date: string;
  birth_time: string | null;
  birth_time_source: "exact" | "estimated" | "unknown";
  sex: "M" | "F" | null;
  tz: string | null;
};

const STORAGE_KEY = "oracle.single.active-session";
const TERMINAL = new Set<SessionStatus>(["done", "partial", "failed"]);
const READER_COUNTS = Object.keys(ORACLE_SESSION_CREDIT_PRICES.single)
  .map(Number)
  .filter((value): value is ReaderCount => value === 3 || value === 5 || value === 7);

const TIMEZONES = [
  ["Asia/Seoul", "한국 · 서울 (UTC+9)"],
  ["Asia/Tokyo", "일본 · 도쿄 (UTC+9)"],
  ["Asia/Shanghai", "중국 · 상하이 (UTC+8)"],
  ["Asia/Hong_Kong", "홍콩 (UTC+8)"],
  ["Asia/Singapore", "싱가포르 (UTC+8)"],
  ["Asia/Bangkok", "태국 · 방콕 (UTC+7)"],
  ["Asia/Kolkata", "인도 · 콜카타 (UTC+5:30)"],
  ["Europe/London", "영국 · 런던"],
  ["Europe/Paris", "유럽 · 파리"],
  ["America/New_York", "미국 · 뉴욕"],
  ["America/Chicago", "미국 · 시카고"],
  ["America/Denver", "미국 · 덴버"],
  ["America/Los_Angeles", "미국 · 로스앤젤레스"],
  ["Australia/Sydney", "호주 · 시드니"],
] as const;

const BRAND_STYLE: Record<string, string> = {
  "Z.ai": "border-violet-300/30 bg-violet-400/10 text-violet-100",
  "Moonshot AI": "border-cyan-300/30 bg-cyan-400/10 text-cyan-100",
  xAI: "border-white/25 bg-white/8 text-white",
  NVIDIA: "border-lime-300/30 bg-lime-400/10 text-lime-100",
  DeepSeek: "border-blue-300/30 bg-blue-400/10 text-blue-100",
  Google: "border-sky-300/30 bg-sky-400/10 text-sky-100",
  OpenAI: "border-emerald-300/30 bg-emerald-400/10 text-emerald-100",
  Anthropic: "border-orange-300/30 bg-orange-400/10 text-orange-100",
};

function BrandBadge({ brand }: { brand: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${BRAND_STYLE[brand] ?? "border-white/15 bg-white/5 text-slate-200"}`}>
      {brand}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/65">{children}</p>;
}

function SystemPicker({ onSelect }: { onSelect: (id: SingleSystemId) => void }) {
  return (
    <section>
      <SectionLabel>1 · 체계 선택</SectionLabel>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">한 가지 점술을 깊게 읽습니다</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">
        계산법은 하나, 해석자는 여러 명입니다. 같은 원표를 각기 다른 관점으로 읽고,
        마지막에 일치와 이견을 함께 정리합니다.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {SINGLE_SYSTEMS.map((system) => (
          <button
            key={system.id}
            type="button"
            onClick={() => onSelect(system.id)}
            className="group min-h-[250px] rounded-[24px] border border-white/10 bg-[#10182b] p-5 text-left shadow-[0_12px_35px_rgba(0,0,0,0.22)] transition hover:-translate-y-0.5 hover:border-cyan-300/35 hover:bg-[#121e35] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            <div className="flex items-start justify-between gap-4">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-400/8 text-xl text-cyan-100">
                {system.symbol}
              </span>
              <ChevronRight className="h-5 w-5 text-white/25 transition group-hover:translate-x-0.5 group-hover:text-cyan-200" />
            </div>
            <h2 className="mt-5 text-lg font-semibold text-white">{system.name}</h2>
            <div className="mt-3 space-y-1 text-[13px] leading-relaxed text-slate-300">
              {system.explanation.map((line) => <p key={line}>{line}</p>)}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function InputForm({
  system,
  balance,
  initialProfile,
  onBack,
  onSubmit,
  submitting,
  error,
}: {
  system: SingleSystemId;
  balance: number | null;
  initialProfile: RunnerProfile | null;
  onBack: () => void;
  onSubmit: (input: {
    birthDate: string;
    birthTime: string;
    birthTimeUnknown: boolean;
    timezone: string;
    sex: "M" | "F";
    question: string;
    readerCount: ReaderCount;
  }) => void;
  submitting: boolean;
  error: string | null;
}) {
  const info = SINGLE_SYSTEM_BY_ID[system];
  const guessedZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul", []);
  const [birthDate, setBirthDate] = useState(initialProfile?.birth_date ?? "");
  const [birthTime, setBirthTime] = useState(initialProfile?.birth_time?.slice(0, 5) ?? "12:00");
  const [birthTimeUnknown, setBirthTimeUnknown] = useState(initialProfile?.birth_time_source === "unknown");
  const [timezone, setTimezone] = useState(initialProfile?.tz ?? (TIMEZONES.some(([zone]) => zone === guessedZone) ? guessedZone : "Asia/Seoul"));
  const [sex, setSex] = useState<"M" | "F">(initialProfile?.sex === "F" ? "F" : "M");
  const [question, setQuestion] = useState("");
  const [readerCount, setReaderCount] = useState<ReaderCount>(3);
  const cost = ORACLE_SESSION_CREDIT_PRICES.single[readerCount]!;
  const insufficient = balance !== null && balance < cost;

  return (
    <section className="mx-auto w-full max-w-2xl">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-cyan-200/80 hover:text-cyan-100">
        <ArrowLeft className="h-4 w-4" /> 체계 다시 선택
      </button>
      <SectionLabel>2 · 입력</SectionLabel>
      <div className="mt-2 flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-400/8 text-xl text-cyan-100">{info.symbol}</span>
        <div>
          <h1 className="text-2xl font-semibold text-white">{info.name}</h1>
          <p className="text-sm text-slate-400">계산에 필요한 최소 정보만 받습니다.</p>
        </div>
      </div>

      <form
        className="mt-7 space-y-6 rounded-[26px] border border-white/10 bg-[#10182b] p-5 sm:p-7"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ birthDate, birthTime, birthTimeUnknown, timezone, sex, question, readerCount });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm text-slate-200">
            <span>생년월일</span>
            <input required type="date" max={new Date().toISOString().slice(0, 10)} value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="w-full rounded-xl border border-white/12 bg-black/25 px-3.5 py-3 text-white outline-none focus:border-cyan-300/55" />
          </label>
          <div className="space-y-2">
            <span className="text-sm text-slate-200">출생 시간</span>
            <div className="flex gap-2">
              <input disabled={birthTimeUnknown} required={!birthTimeUnknown} type="time" value={birthTime} onChange={(e) => setBirthTime(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-white/12 bg-black/25 px-3.5 py-3 text-white outline-none focus:border-cyan-300/55 disabled:opacity-35" />
              <button type="button" onClick={() => setBirthTimeUnknown((value) => !value)} aria-pressed={birthTimeUnknown} className={`rounded-xl border px-4 text-sm font-semibold ${birthTimeUnknown ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-50" : "border-white/12 bg-white/5 text-slate-300"}`}>
                모름
              </button>
            </div>
            <p className="text-xs leading-relaxed text-amber-100/75">
              시간을 모르면 시주·상승궁·궁 배치처럼 시간 의존 계산이 빠집니다.
              해당 체계는 중단되지 않지만 축소된 정보와 낮은 비중으로 참여합니다.
            </p>
          </div>
        </div>

        <label className="block space-y-2 text-sm text-slate-200">
          <span>출생지 시간대</span>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full rounded-xl border border-white/12 bg-[#0a1020] px-3.5 py-3 text-white outline-none focus:border-cyan-300/55">
            {TIMEZONES.map(([zone, label]) => <option key={zone} value={zone}>{label}</option>)}
          </select>
        </label>

        <fieldset>
          <legend className="text-sm text-slate-200">성별</legend>
          <p className="mt-1 text-xs text-white/40">대운·대한의 진행 방향 계산에만 사용하며 AI에게 전달하지 않습니다.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {([["M", "남성"], ["F", "여성"]] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setSex(value)} className={`rounded-xl border px-4 py-3 text-sm ${sex === value ? "border-cyan-300/50 bg-cyan-400/12 text-cyan-50" : "border-white/10 bg-white/[0.03] text-slate-300"}`}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block space-y-2 text-sm text-slate-200">
          <span>질문 <span className="text-white/35">(선택)</span></span>
          <textarea maxLength={2000} rows={4} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="지금 가장 궁금한 일을 적어 주세요. 비워 두면 전반적인 흐름을 읽습니다." className="w-full resize-y rounded-xl border border-white/12 bg-black/25 px-3.5 py-3 text-white placeholder:text-slate-600 outline-none focus:border-cyan-300/55" />
        </label>

        <fieldset>
          <div className="flex items-end justify-between">
            <legend className="text-sm text-slate-200">해석자 수</legend>
            {balance !== null ? <span className="text-xs text-white/45">보유 {balance} 크레딧</span> : null}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {READER_COUNTS.map((count) => (
              <button key={count} type="button" onClick={() => setReaderCount(count)} className={`rounded-xl border px-2 py-3 text-center ${readerCount === count ? "border-violet-300/55 bg-violet-400/15 text-white" : "border-white/10 bg-white/[0.03] text-slate-300"}`}>
                <span className="block text-lg font-semibold">{count}명</span>
                <span className="mt-0.5 block text-[11px] text-white/50">{ORACLE_SESSION_CREDIT_PRICES.single[count]} 크레딧</span>
              </button>
            ))}
          </div>
        </fieldset>

        {error ? <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}
        {insufficient ? <p className="text-sm text-amber-100">선택한 해석자 수에는 {cost} 크레딧이 필요합니다.</p> : null}

        <button disabled={submitting || insufficient} type="submit" className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-violet-500 px-5 py-4 text-sm font-semibold text-white shadow-lg shadow-violet-950/35 transition hover:brightness-110 disabled:pointer-events-none disabled:opacity-40">
          {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {submitting ? "원표를 계산하는 중…" : `${info.shortName} 읽기 시작 · ${cost} 크레딧`}
        </button>
      </form>
    </section>
  );
}

function ReaderCard({ reading, index }: { reading: PublicReading; index: number }) {
  return (
    <article className="rounded-[22px] border border-white/10 bg-[#10182b] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-white/30">{String(index + 1).padStart(2, "0")}</span>
          <BrandBadge brand={reading.brand} />
        </div>
        {reading.latencyMs ? <span className="text-[10px] text-white/30">{(reading.latencyMs / 1000).toFixed(1)}초</span> : null}
      </div>
      <div className="mt-4 whitespace-pre-wrap text-[14px] leading-7 text-slate-100">
        {reading.narrative ?? (reading.status === "failed" ? "이 해석자는 이번 응답을 마치지 못했습니다." : "해석을 준비하고 있습니다.")}
      </div>
    </article>
  );
}

function SynthesisCard({ consensus }: { consensus: PublicConsensus }) {
  return (
    <article className="rounded-[26px] border border-violet-300/25 bg-gradient-to-br from-violet-500/15 via-[#11172b] to-cyan-500/10 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.3)] sm:p-7">
      <SectionLabel>종합 해석</SectionLabel>
      <h2 className="mt-2 text-xl font-semibold text-white">결론</h2>
      <p className="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-slate-100">
        {consensus.conclusion ?? "완성된 해석들을 종합하고 있습니다."}
      </p>

      <div className="mt-7 grid gap-5 sm:grid-cols-2">
        <section>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-100"><Check className="h-4 w-4" /> 함께 본 점</h3>
          {consensus.agreements.length ? (
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-200">
              {consensus.agreements.map((item) => <li key={item} className="rounded-xl bg-emerald-400/[0.06] px-3 py-2">{item}</li>)}
            </ul>
          ) : <p className="mt-3 text-sm text-white/40">뚜렷한 공통점이 정리되지 않았습니다.</p>}
        </section>
        <section>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-100"><CircleAlert className="h-4 w-4" /> 다르게 본 점</h3>
          <p className="mt-2 text-xs leading-relaxed text-amber-100/65">이견은 오류가 아니라 이 읽기의 핵심입니다. 같은 계산을 어디에 더 무게 두었는지 보여 줍니다.</p>
          {consensus.divergences.length ? (
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-200">
              {consensus.divergences.map((item) => <li key={item} className="rounded-xl bg-amber-400/[0.06] px-3 py-2">{item}</li>)}
            </ul>
          ) : <p className="mt-3 text-sm text-white/40">이번에는 큰 이견이 없었습니다.</p>}
        </section>
      </div>
      {consensus.confidenceNote ? <p className="mt-6 border-t border-white/8 pt-4 text-xs leading-relaxed text-white/45">{consensus.confidenceNote}</p> : null}
    </article>
  );
}

function SessionScreen({
  view,
  initialComputations,
  selected,
  error,
  onReset,
}: {
  view: SessionView | null;
  initialComputations: PublicComputation[];
  selected: SingleSystemId;
  error: string | null;
  onReset: () => void;
}) {
  const info = SINGLE_SYSTEM_BY_ID[selected];
  const computations = view?.computations.length ? view.computations : initialComputations;
  const computation = computations.find((item) => item.system === selected) ?? computations[0];
  const readings = (view?.readings.filter((reading) => reading.system === selected) ?? [])
    .sort((a, b) => {
      const aIndex = view?.readerRoster.indexOf(a.brand) ?? -1;
      const bIndex = view?.readerRoster.indexOf(b.brand) ?? -1;
      return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
    });
  const terminal = view ? TERMINAL.has(view.status) : false;
  const finished = terminal && view?.consensus;
  const expected = Math.max(readings.length, view?.readerRoster.length ?? 0);

  return (
    <section className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionLabel>{finished ? "결과" : "3 · 진행"}</SectionLabel>
          <h1 className="mt-2 text-2xl font-semibold text-white">{info.name}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {finished ? "같은 원표를 읽은 해석들을 한 자리에 모았습니다." : "계산은 끝났습니다. 해석자들의 글을 차례로 받고 있습니다."}
          </p>
        </div>
        <button type="button" onClick={onReset} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-white/25">
          <RotateCcw className="h-3.5 w-3.5" /> 새 읽기
        </button>
      </div>

      {error ? <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</p> : null}

      {finished ? <SynthesisCard consensus={view!.consensus!} /> : null}

      {!finished && computation ? <CalculationPanel computation={computation} systemName={info.name} /> : null}

      <section>
        <div className="flex items-end justify-between gap-3">
          <div>
            <SectionLabel>해석자들의 읽기</SectionLabel>
            <h2 className="mt-1 text-lg font-semibold text-white">같은 계산, 서로 다른 관점</h2>
          </div>
          {!terminal ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-cyan-100/65">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              {readings.length}/{expected || "…"}
            </span>
          ) : null}
        </div>
        <div className="mt-4 grid gap-4">
          {readings.map((reading, index) => <ReaderCard key={`${reading.brand}-${reading.system}`} reading={reading} index={index} />)}
          {!readings.length && !terminal ? (
            <div className="rounded-[22px] border border-dashed border-white/12 bg-white/[0.02] px-5 py-8 text-center text-sm text-white/40">
              첫 번째 해석자가 원표를 읽고 있습니다. 보통 15–30초가 걸립니다.
            </div>
          ) : null}
        </div>
      </section>

      {!finished && readings.length > 0 ? (
        <article className="rounded-[22px] border border-dashed border-violet-300/20 bg-violet-400/[0.04] p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-violet-100">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {terminal ? "종합 결과를 확인하고 있습니다" : "마지막에 종합합니다"}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">모든 해석이 도착하면 결론, 일치점, 이견 순서로 정리합니다.</p>
        </article>
      ) : null}

      {finished && computation ? <CalculationPanel computation={computation} systemName={info.name} /> : null}
    </section>
  );
}

export default function SingleSystemClient() {
  const [selected, setSelected] = useState<SingleSystemId | null>(null);
  const [profile, setProfile] = useState<RunnerProfile | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [view, setView] = useState<SessionView | null>(null);
  const [initialComputations, setInitialComputations] = useState<PublicComputation[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const advancing = useRef(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    // Defer the external-store hydration update so the effect itself only
    // performs I/O/subscription work (and avoids a cascading render).
    if (saved) queueMicrotask(() => setSessionId(saved));

    void fetch("/api/oracle/profile")
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { runnerProfile?: RunnerProfile | null } | null) => setProfile(payload?.runnerProfile ?? null))
      .catch(() => undefined);
    void fetch("/api/credits/balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { balance?: number } | null) => {
        if (typeof payload?.balance === "number") setBalance(payload.balance);
      })
      .catch(() => undefined);
  }, []);

  const advance = useCallback(async (id: string) => {
    if (advancing.current) return;
    advancing.current = true;
    try {
      await fetch(`/api/oracle/session/${encodeURIComponent(id)}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } finally {
      advancing.current = false;
    }
  }, []);

  const poll = useCallback(async (id: string) => {
    const response = await fetch(`/api/oracle/session/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!response.ok) {
      if (response.status === 404) {
        window.localStorage.removeItem(STORAGE_KEY);
        setSessionId(null);
      }
      throw new Error("세션을 불러오지 못했습니다.");
    }
    const payload = await response.json() as { ok: true } & SessionView;
    setView(payload);
    const system = payload.systems[0];
    if (system && system !== "prism" && system in SINGLE_SYSTEM_BY_ID) {
      setSelected(system as SingleSystemId);
    }
    if (!TERMINAL.has(payload.status) && !payload.working) void advance(id);
  }, [advance]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        await poll(sessionId);
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "세션을 불러오지 못했습니다.");
      } finally {
        if (!cancelled) timer = setTimeout(tick, 2_000);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [poll, sessionId]);

  const start = useCallback(async (input: {
    birthDate: string;
    birthTime: string;
    birthTimeUnknown: boolean;
    timezone: string;
    sex: "M" | "F";
    question: string;
    readerCount: ReaderCount;
  }) => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const profileResponse = await fetch("/api/oracle/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_mode: "single-system",
          birth_date: input.birthDate,
          birth_time: input.birthTime,
          birth_time_unknown: input.birthTimeUnknown,
          timezone: input.timezone,
          sex: input.sex,
        }),
      });
      const profilePayload = await profileResponse.json().catch(() => null) as {
        subjectProfileId?: string;
        runnerProfile?: RunnerProfile;
        error?: string;
      } | null;
      if (!profileResponse.ok || !profilePayload?.subjectProfileId) {
        throw new Error(profilePayload?.error ?? "프로필을 저장하지 못했습니다.");
      }
      if (profilePayload.runnerProfile) setProfile(profilePayload.runnerProfile);

      const sessionResponse = await fetch("/api/oracle/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "personal",
          scope: "single",
          subjectProfileId: profilePayload.subjectProfileId,
          systems: [selected],
          question: input.question.trim() || null,
          sessionInputs: null,
          readerCount: input.readerCount,
          locale: "ko",
        }),
      });
      const sessionPayload = await sessionResponse.json().catch(() => null) as {
        sessionId?: string;
        computations?: PublicComputation[];
        balance?: number;
        error?: string;
      } | null;
      if (!sessionResponse.ok || !sessionPayload?.sessionId) {
        if (typeof sessionPayload?.balance === "number") setBalance(sessionPayload.balance);
        throw new Error(sessionPayload?.error ?? "읽기 세션을 시작하지 못했습니다.");
      }

      setInitialComputations(sessionPayload.computations ?? []);
      setView(null);
      setSessionId(sessionPayload.sessionId);
      window.localStorage.setItem(STORAGE_KEY, sessionPayload.sessionId);
      void advance(sessionPayload.sessionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "읽기를 시작하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }, [advance, selected]);

  const reset = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setSessionId(null);
    setView(null);
    setInitialComputations([]);
    setSelected(null);
    setError(null);
  };

  return (
    <main className="min-h-screen bg-[#0a0f1e] text-white">
      <div className="mx-auto min-h-screen w-full max-w-4xl px-4 pb-24 pt-6 sm:px-7 sm:pt-9">
        <header className="mb-9 flex items-center justify-between gap-4">
          <Link href="/modes/oracle" className="inline-flex items-center gap-1 text-sm text-cyan-200/80 hover:text-cyan-100">
            <ArrowLeft className="h-4 w-4" /> 오라클
          </Link>
          <div className="flex items-center gap-2">
            {sessionId ? <span className="hidden text-[10px] text-white/25 sm:inline">세션 {sessionId.slice(0, 8)}</span> : null}
            {balance !== null ? <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300">{balance} 크레딧</span> : null}
          </div>
        </header>

        {sessionId && selected ? (
          <SessionScreen view={view} initialComputations={initialComputations} selected={selected} error={error} onReset={reset} />
        ) : selected ? (
          <InputForm system={selected} balance={balance} initialProfile={profile} onBack={() => { setSelected(null); setError(null); }} onSubmit={start} submitting={submitting} error={error} />
        ) : (
          <SystemPicker onSelect={(system) => { setSelected(system); setError(null); }} />
        )}
      </div>
    </main>
  );
}
