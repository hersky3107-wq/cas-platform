"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronLeft } from "lucide-react";
import type { FacilitatorSummary } from "@/lib/synod/build-memory";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

/** Stop deliberating early once a round reaches this consensus score. */
const CONSENSUS_THRESHOLD = 85;
/** Hard cap on deliberation rounds (opening round 0 excluded). */
const MAX_ROUNDS = 5;

type SynodProvider = "openai" | "anthropic" | "google" | "xai" | "deepseek" | "mistral";

/** Debater order: chatgpt, claude, gemini, grok, deepseek, mistral — as the
 * provider keys /api/synod expects. */
const DEBATERS: SynodProvider[] = ["openai", "anthropic", "google", "xai", "deepseek", "mistral"];

const BRAND: Record<SynodProvider, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
  xai: "Grok",
  deepseek: "DeepSeek",
  mistral: "Mistral",
};

/** Brand colors (mirrors Arena's palette; xai light gray for dark bg). */
const AI_COLORS: Record<SynodProvider, string> = {
  openai: "#10A37F",
  anthropic: "#D97757",
  google: "#4285F4",
  xai: "#E5E7EB",
  deepseek: "#4D6BFE",
  mistral: "#FF7000",
};

/** Semantic chip styling per action tag. */
const TAG_STYLES: Record<string, string> = {
  AGREE: "border-emerald-400/50 bg-emerald-500/20 text-emerald-300",
  CHALLENGE: "border-rose-400/50 bg-rose-500/20 text-rose-300",
  SUPPLEMENT: "border-sky-400/50 bg-sky-500/20 text-sky-300",
  REFRAME: "border-violet-400/50 bg-violet-500/20 text-violet-300",
};

type Turn = {
  roundNumber: number;
  ai: SynodProvider;
  actionTag: string | null;
  claim: string | null;
  content: string;
  isRedTeam: boolean;
  ms?: number | null;
};

type VerdictResult = {
  verdict: string;
  minorityReport: { ai: string; dissent: string; reason: string }[];
  finalScore: number;
};

type Phase = "idle" | "opening" | "deliberating" | "verdict" | "done" | "error";

type SynodMode = "easy" | "expert";

type AiProgressRow = {
  ai: SynodProvider;
  status: "pending" | "thinking" | "done";
  startedAt?: number;
  durationMs?: number;
};

/** Generic /api/synod response; populated fields depend on the action. */
type SynodApiResult = {
  ok?: boolean;
  error?: string;
  balance?: number;
  sessionId?: string;
  creditsRemaining?: number;
  turn?: {
    roundNumber: number;
    aiName: string;
    actionTag: string | null;
    claim: string | null;
    content: string;
    isRedTeam: boolean;
    ms: number;
  };
  summary?: FacilitatorSummary;
  challengeMissing?: boolean;
  result?: VerdictResult;
  session?: {
    id: string;
    question: string;
    status: string;
    totalRounds: number;
    consensusScore: number | null;
  };
  turns?: {
    roundNumber: number;
    ai: string;
    actionTag: string | null;
    claim: string | null;
    content: string;
    isRedTeam: boolean;
    ms: number | null;
  }[];
  rounds?: { roundNumber: number; summary: FacilitatorSummary; challengeMissing: boolean }[];
};

function isSynodProvider(s: string): s is SynodProvider {
  return (DEBATERS as string[]).includes(s);
}

/** Sticky 0-100 consensus gauge; shows finalScore once the session is done. */
function ConsensusGauge({
  score,
  finalScore,
  done,
}: {
  score: number | null;
  finalScore: number | null;
  done: boolean;
}) {
  const shown = done && finalScore != null ? finalScore : score;
  const pct = Math.max(0, Math.min(100, shown ?? 0));
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-6 border-b border-white/10 bg-[#0a0f1e]/95 px-4 pb-4 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            {done ? "Final score" : "Consensus"}
          </p>
          <p className="text-3xl font-bold tracking-tight text-white">
            {shown ?? "—"}
            <span className="text-sm font-medium text-slate-500">/100</span>
          </p>
        </div>
      </div>
      <div className="relative mt-2 h-2.5 w-full rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-300 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-white/60"
          style={{ left: `${CONSENSUS_THRESHOLD}%` }}
          aria-hidden
        />
      </div>
      <div className="relative mt-0.5 h-3">
        <span
          className="absolute -translate-x-1/2 text-[9px] uppercase tracking-wide text-slate-500"
          style={{ left: `${CONSENSUS_THRESHOLD}%` }}
        >
          threshold
        </span>
      </div>
    </div>
  );
}

function SynodAiProgress({ rows, streamTick }: { rows: AiProgressRow[]; streamTick: number }) {
  void streamTick;
  const now = Date.now();
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((row) => {
        const name = BRAND[row.ai];
        const color = AI_COLORS[row.ai];
        if (row.status === "done") {
          const sec = (row.durationMs ?? 0) / 1000;
          return (
            <span
              key={row.ai}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs"
            >
              <span aria-hidden>✅</span>
              <span className="font-medium" style={{ color }}>
                {name}
              </span>
              <span className="text-slate-500">{sec.toFixed(1)}s</span>
            </span>
          );
        }
        if (row.status === "thinking") {
          const elapsed =
            row.startedAt != null ? Math.max(0, Math.floor((now - row.startedAt) / 1000)) : 0;
          return (
            <span
              key={row.ai}
              className="inline-flex animate-pulse items-center gap-1.5 rounded-full border border-cyan-400/50 bg-cyan-500/20 px-3 py-1 text-xs"
            >
              <span aria-hidden>⏳</span>
              <span className="font-medium" style={{ color }}>
                {name}
              </span>
              <span className="text-slate-300">{elapsed}s</span>
            </span>
          );
        }
        return (
          <span
            key={row.ai}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 text-xs text-slate-500"
          >
            <span aria-hidden>○</span>
            <span className="font-medium">{name}</span>
          </span>
        );
      })}
    </div>
  );
}

function TurnCard({ turn }: { turn: Turn }) {
  const color = AI_COLORS[turn.ai];
  const tagClass = turn.actionTag ? TAG_STYLES[turn.actionTag] : undefined;
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5 ${
        turn.isRedTeam ? "ring-1 ring-amber-400/60" : ""
      }`}
      style={{ borderLeftColor: color, borderLeftWidth: 4 }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-white">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden
          />
          {BRAND[turn.ai]}
        </span>
        {tagClass ? (
          <span
            className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tagClass}`}
          >
            {turn.actionTag}
          </span>
        ) : null}
        {turn.isRedTeam ? (
          <span className="rounded-md border border-amber-400/50 bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
            RED TEAM
          </span>
        ) : null}
      </div>
      {turn.claim ? (
        <p className="mb-2 text-sm font-medium text-cyan-200">&ldquo;{turn.claim}&rdquo;</p>
      ) : null}
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{turn.content}</p>
      {typeof turn.ms === "number" ? (
        <p className="mt-2 text-right text-[10px] text-slate-500">{turn.ms} ms</p>
      ) : null}
    </div>
  );
}

function SummaryCard({ summary }: { summary: FacilitatorSummary }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3.5">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-md border border-cyan-400/50 bg-cyan-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-cyan-300">
          Facilitator
        </span>
        <span className="text-xs text-slate-400">
          consensus {summary.roundConsensusScore}/100
        </span>
      </div>
      <div className="space-y-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-300/80">
            Consensus
          </p>
          {summary.consensusPoints.length ? (
            <ul className="mt-1 space-y-1">
              {summary.consensusPoints.map((cp, i) => (
                <li key={i} className="text-sm leading-relaxed text-slate-300">
                  • {cp.point}
                  {cp.agreedBy.length ? (
                    <span className="text-xs text-slate-500"> — {cp.agreedBy.join(", ")}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-slate-500">None yet.</p>
          )}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-300/80">
            Open Issues
          </p>
          {summary.openIssues.length ? (
            <ul className="mt-1 space-y-1">
              {summary.openIssues.map((oi, i) => (
                <li key={i} className="text-sm leading-relaxed text-slate-300">
                  • {oi.issue}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-slate-500">None.</p>
          )}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-300/80">
            Next
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">{summary.nextDirective}</p>
        </div>
      </div>
    </div>
  );
}

export default function SynodPage() {
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<SynodMode>("easy");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turnsByRound, setTurnsByRound] = useState<Record<number, Turn[]>>({});
  const [summaries, setSummaries] = useState<FacilitatorSummary[]>([]);
  const [result, setResult] = useState<VerdictResult | null>(null);
  const [aiProgressRows, setAiProgressRows] = useState<AiProgressRow[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [consensusScore, setConsensusScore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamTick, setStreamTick] = useState(0);
  /** Prevents a concurrent second loop (mount-resume vs Start click). */
  const runningRef = useRef(false);

  const isLoading = phase === "opening" || phase === "deliberating" || phase === "verdict";

  useEffect(() => {
    if (!isLoading || !aiProgressRows.some((r) => r.status === "thinking")) return undefined;
    const id = setInterval(() => setStreamTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isLoading, aiProgressRows]);

  // Copied from Arena's runArenaRoundSequential retry wrapper: initial + 3 retries
  // with 1s/2s/3s backoff; 402 aborts immediately; retries on network error or
  // non-ok status. (Success check adapted to SYNOD's `ok` flag — SYNOD responses
  // have no `response` field.)
  const postWithRetry = useCallback(
    async (reqBody: Record<string, unknown>): Promise<SynodApiResult | "abort" | null> => {
      const MAX_ATTEMPTS = 4; // initial + 3 retries
      let lastErr = "";
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const res = await fetch("/api/synod", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reqBody),
          });
          if (res.status === 402) {
            const j = (await res.json().catch(() => null)) as { error?: string; balance?: number };
            setError(j?.error ?? "Insufficient credits");
            return "abort";
          }
          if (!res.ok) {
            lastErr = `Request failed (${res.status})`;
            if (attempt < MAX_ATTEMPTS) {
              await new Promise((r) => setTimeout(r, attempt * 1000));
              continue;
            }
            setError(lastErr);
            return null;
          }
          const data = (await res.json().catch(() => null)) as SynodApiResult | null;
          if (!data || data.ok !== true) {
            lastErr = data?.error ?? "Malformed response";
            if (attempt < MAX_ATTEMPTS) {
              await new Promise((r) => setTimeout(r, attempt * 1000));
              continue;
            }
            setError(lastErr);
            return null;
          }
          return data;
        } catch (e: unknown) {
          lastErr = e instanceof Error ? e.message : "Network error";
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, attempt * 1000));
            continue;
          }
          setError(lastErr);
          return null;
        }
      }
      setError(lastErr || "Request failed");
      return null;
    },
    []
  );

  /** flushSync + double-rAF immediate append (Arena pattern). */
  const appendTurn = useCallback(async (turn: Turn) => {
    flushSync(() => {
      setTurnsByRound((prev) => {
        const list = prev[turn.roundNumber] ? [...prev[turn.roundNumber]!] : [];
        list.push(turn);
        return { ...prev, [turn.roundNumber]: list };
      });
    });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }, []);

  const markThinking = useCallback((ai: SynodProvider) => {
    const now = Date.now();
    setAiProgressRows((prev) => {
      const idx = prev.findIndex((row) => row.ai === ai);
      if (idx >= 0) {
        return prev.map((row, i) =>
          i === idx ? { ...row, status: "thinking" as const, startedAt: now } : row
        );
      }
      return [...prev, { ai, status: "thinking" as const, startedAt: now }];
    });
  }, []);

  const markDone = useCallback((ai: SynodProvider, durationMs?: number) => {
    setAiProgressRows((prev) => {
      const idx = prev.findIndex((row) => row.ai === ai);
      if (idx < 0) return [...prev, { ai, status: "done" as const, durationMs }];
      return prev.map((row, i) =>
        i === idx ? { ...row, status: "done" as const, durationMs, startedAt: undefined } : row
      );
    });
  }, []);

  /**
   * The main sequential loop. `initial` carries hydrated DB progress (resume) or
   * empty structures (fresh start). Every step checks the local working copies
   * first and is SKIPPED when its data already exists — never re-run a step that
   * is already in the DB (prevents double credit charges and duplicate turns).
   */
  const runSynod = useCallback(
    async (initial: {
      sessionId: string | null;
      question: string;
      mode: SynodMode;
      turnsByRound: Record<number, Turn[]>;
      summaries: FacilitatorSummary[];
      challengeFlags: Record<number, boolean>;
      result: VerdictResult | null;
    }) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setError(null);

      let sid = initial.sessionId;
      const q = initial.question;
      const local: Record<number, Turn[]> = {};
      for (const [k, v] of Object.entries(initial.turnsByRound)) local[Number(k)] = [...v];
      const sums = [...initial.summaries].sort((a, b) => a.roundNumber - b.roundNumber);
      const flags = { ...initial.challengeFlags };
      const uiLocale =
        typeof navigator !== "undefined" && navigator.language ? navigator.language : "en";

      try {
        // ---- PHASE opening (round 0): each debater's independent opinion. ----
        const round0 = local[0] ?? (local[0] = []);
        if (round0.length < DEBATERS.length) {
          setPhase("opening");
          const spoken = new Set(round0.map((t) => t.ai));
          setAiProgressRows(
            DEBATERS.map((ai) => ({ ai, status: spoken.has(ai) ? "done" : "pending" }))
          );
          for (const provider of DEBATERS) {
            if (spoken.has(provider)) continue; // already in DB — never re-run
            markThinking(provider);
            const res = await postWithRetry({
              action: "opening",
              sessionId: sid ?? undefined,
              question: q,
              provider,
              // true only for the very first call of a brand-new session
              isFirst: sid === null,
              ui_locale: uiLocale,
              ...(sid === null ? { mode: initial.mode } : {}),
            });
            if (res === "abort" || res === null) {
              setPhase("error");
              return;
            }
            if (res.sessionId && !sid) {
              sid = res.sessionId;
              setSessionId(sid);
              // Persist in the URL so leaving + returning can resume this session.
              window.history.replaceState(null, "", `?session=${encodeURIComponent(sid)}`);
            }
            const t: Turn = {
              roundNumber: 0,
              ai: provider,
              actionTag: null,
              claim: res.turn?.claim ?? null,
              content: res.turn?.content ?? "",
              isRedTeam: false,
              ms: res.turn?.ms,
            };
            round0.push(t);
            await appendTurn(t);
            markDone(provider, res.turn?.ms);
          }
        }

        if (!sid) {
          setError("No session id");
          setPhase("error");
          return;
        }

        // ---- PHASE deliberating: rounds 1..MAX_ROUNDS, each = 6 turns + facilitate. ----
        setPhase("deliberating");
        for (let rn = 1; rn <= MAX_ROUNDS; rn++) {
          // Early stop (also covers resumed sessions that already hit the threshold).
          if (sums.some((s) => s.roundConsensusScore >= CONSENSUS_THRESHOLD)) break;

          // Red-team rotation: one debater per round, by (roundNumber-1) % 6. When the
          // previous round's facilitate flagged challengeMissing, this round is forced
          // as a red-team round — the rotation already guarantees a red-team speaker.
          const redTeamProvider = DEBATERS[(rn - 1) % DEBATERS.length]!;
          void (flags[rn - 1] === true); // challengeMissing — satisfied by rotation above

          const roundTurns = local[rn] ?? (local[rn] = []);
          const spoken = new Set(roundTurns.map((t) => t.ai));

          if (spoken.size < DEBATERS.length) {
            setAiProgressRows(
              DEBATERS.map((ai) => ({ ai, status: spoken.has(ai) ? "done" : "pending" }))
            );
            for (const provider of DEBATERS) {
              if (spoken.has(provider)) continue; // already in DB — never re-run
              markThinking(provider);
              const res = await postWithRetry({
                action: "turn",
                sessionId: sid,
                question: q,
                provider,
                roundNumber: rn,
                isRedTeam: provider === redTeamProvider,
              });
              if (res === "abort" || res === null) {
                setPhase("error");
                return;
              }
              const t: Turn = {
                roundNumber: rn,
                ai: provider,
                actionTag: res.turn?.actionTag ?? null,
                claim: res.turn?.claim ?? null,
                content: res.turn?.content ?? "",
                isRedTeam: res.turn?.isRedTeam === true,
                ms: res.turn?.ms,
              };
              roundTurns.push(t);
              await appendTurn(t);
              markDone(provider, res.turn?.ms);
            }
          }

          // Facilitate — skipped when this round's summary already exists in DB.
          let roundSummary = sums.find((s) => s.roundNumber === rn);
          if (!roundSummary) {
            const res = await postWithRetry({
              action: "facilitate",
              sessionId: sid,
              question: q,
              roundNumber: rn,
            });
            if (res === "abort" || res === null) {
              setPhase("error");
              return;
            }
            if (res.summary) {
              roundSummary = { ...res.summary, roundNumber: rn };
              sums.push(roundSummary);
              flags[rn] = res.challengeMissing === true;
              setSummaries([...sums]);
            }
          }
          if (roundSummary) setConsensusScore(roundSummary.roundConsensusScore);
          if (roundSummary && roundSummary.roundConsensusScore >= CONSENSUS_THRESHOLD) break;
        }

        // ---- PHASE verdict — skipped when the result already exists in DB. ----
        if (!initial.result) {
          setPhase("verdict");
          setAiProgressRows([]);
          const res = await postWithRetry({ action: "verdict", sessionId: sid, question: q });
          if (res === "abort" || res === null) {
            setPhase("error");
            return;
          }
          if (res.result) setResult(res.result);
        }
        setPhase("done");
      } finally {
        runningRef.current = false;
      }
    },
    [postWithRetry, appendTurn, markThinking, markDone]
  );

  /** Resume: hydrate everything saved for this session, then continue the loop. */
  const resumeSession = useCallback(
    async (sid: string) => {
      const res = await postWithRetry({ action: "load", sessionId: sid });
      if (res === "abort" || res === null) {
        setPhase("error");
        return;
      }
      const q = res.session?.question ?? "";
      const byRound: Record<number, Turn[]> = {};
      for (const t of res.turns ?? []) {
        if (!isSynodProvider(t.ai)) continue;
        const list = byRound[t.roundNumber] ?? (byRound[t.roundNumber] = []);
        list.push({
          roundNumber: t.roundNumber,
          ai: t.ai,
          actionTag: t.actionTag,
          claim: t.claim,
          content: t.content,
          isRedTeam: t.isRedTeam,
          ms: t.ms,
        });
      }
      const loadedSummaries = (res.rounds ?? []).map((r) => r.summary);
      const challengeFlags: Record<number, boolean> = {};
      for (const r of res.rounds ?? []) challengeFlags[r.roundNumber] = r.challengeMissing;
      const loadedResult = res.result ?? null;

      setSessionId(sid);
      setQuestion(q);
      setTurnsByRound(byRound);
      setSummaries(loadedSummaries);
      setResult(loadedResult);
      const latest = loadedSummaries[loadedSummaries.length - 1];
      if (latest) setConsensusScore(latest.roundConsensusScore);

      if (res.session?.status === "done" && loadedResult) {
        setPhase("done");
        return;
      }

      // Continue from the first missing step.
      await runSynod({
        sessionId: sid,
        question: q,
        mode: "easy",
        turnsByRound: byRound,
        summaries: loadedSummaries,
        challengeFlags,
        result: loadedResult,
      });
    },
    [postWithRetry, runSynod]
  );

  // On mount: pick up ?session=... and resume. (window.location instead of
  // useSearchParams to avoid the Suspense-boundary requirement.)
  useEffect(() => {
    const sid = new URLSearchParams(window.location.search).get("session");
    if (!sid) return;
    void resumeSession(sid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSynod = useCallback(() => {
    const q = question.trim();
    if (!q || runningRef.current) return;
    setTurnsByRound({});
    setSummaries([]);
    setResult(null);
    setConsensusScore(null);
    setSessionId(null);
    void runSynod({
      sessionId: null,
      question: q,
      mode,
      turnsByRound: {},
      summaries: [],
      challengeFlags: {},
      result: null,
    });
  }, [question, mode, runSynod]);

  const roundNumbers = Object.keys(turnsByRound)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <main className={BG}>
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-6 flex items-start gap-3">
          <Link
            href="/"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.08] ring-1 ring-white/15 transition-colors hover:bg-white/[0.12]"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">SYNOD</h1>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">
              Six AIs deliberate in series toward the best consensus answer.
            </p>
          </div>
        </header>

        {phase === "idle" ? (
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="w-full max-w-xl space-y-4">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question worth deliberating…"
                rows={4}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-relaxed text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setMode("easy")}
                  className={`rounded-2xl border px-3 py-2.5 text-left transition ${
                    mode === "easy"
                      ? "border-cyan-400/50 bg-cyan-500/20"
                      : "border-white/10 bg-white/[0.04] hover:border-white/20"
                  }`}
                >
                  <span
                    className={`block text-sm font-semibold ${
                      mode === "easy" ? "text-cyan-300" : "text-slate-300"
                    }`}
                  >
                    Easy
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                    Simple & quick · anyone can follow
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("expert")}
                  className={`rounded-2xl border px-3 py-2.5 text-left transition ${
                    mode === "expert"
                      ? "border-cyan-400/50 bg-cyan-500/20"
                      : "border-white/10 bg-white/[0.04] hover:border-white/20"
                  }`}
                >
                  <span
                    className={`block text-sm font-semibold ${
                      mode === "expert" ? "text-cyan-300" : "text-slate-300"
                    }`}
                  >
                    Expert
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                    Deeper & more technical
                  </span>
                </button>
              </div>
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={startSynod}
                  disabled={!question.trim()}
                  className="rounded-2xl border border-cyan-400/50 bg-cyan-500/20 px-6 py-3 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Convene the Synod
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <ConsensusGauge
              score={consensusScore}
              finalScore={result?.finalScore ?? null}
              done={phase === "done"}
            />

            {error ? (
              <div className="mb-4 rounded-2xl border border-rose-400/50 bg-rose-500/20 px-4 py-3 text-sm leading-relaxed text-rose-200">
                {error}
                {phase === "error" ? (
                  <span className="text-rose-300/90"> Progress saved — reload to resume.</span>
                ) : null}
              </div>
            ) : null}

            <p className="mb-6 whitespace-pre-wrap rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-relaxed text-slate-300">
              {question}
            </p>

            {isLoading && aiProgressRows.length > 0 ? (
              <div className="mb-6">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  {phase === "opening"
                    ? "Opening statements"
                    : phase === "verdict"
                      ? "Verdict chair deliberating…"
                      : "Deliberating"}
                </p>
                <SynodAiProgress rows={aiProgressRows} streamTick={streamTick} />
              </div>
            ) : null}
            {phase === "verdict" ? (
              <p className="mb-6 text-sm leading-relaxed text-slate-400">
                Claude Opus 4.8 is writing the verdict…
              </p>
            ) : null}

            <div className="space-y-8">
              {roundNumbers.map((rn) => {
                const summary = summaries.find((s) => s.roundNumber === rn);
                return (
                  <section key={rn}>
                    <div className="mb-3 flex items-center gap-2">
                      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">
                        {rn === 0 ? "Opening" : `Round ${rn}`}
                      </h2>
                      {summary ? (
                        <span className="rounded-md border border-cyan-400/50 bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                          {summary.roundConsensusScore}/100
                        </span>
                      ) : null}
                    </div>
                    <div className="space-y-3">
                      {(turnsByRound[rn] ?? []).map((t, i) => (
                        <TurnCard key={`${rn}-${t.ai}-${i}`} turn={t} />
                      ))}
                      {summary ? <SummaryCard summary={summary} /> : null}
                    </div>
                  </section>
                );
              })}

              {result ? (
                <section className="rounded-2xl border border-cyan-400/50 bg-white/[0.06] px-4 py-4 sm:px-5">
                  <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-cyan-300">
                    Final Synthesis — Claude Opus 4.8
                  </h2>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                    {result.verdict}
                  </p>
                  {result.minorityReport.length ? (
                    <div className="mt-4 rounded-2xl border border-amber-400/50 bg-amber-500/10 px-4 py-3">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
                        Minority Report
                      </p>
                      <ul className="space-y-2">
                        {result.minorityReport.map((m, i) => (
                          <li key={i} className="text-sm leading-relaxed text-slate-300">
                            <span className="font-semibold text-amber-200">{m.ai}</span>:{" "}
                            {m.dissent}
                            {m.reason ? (
                              <span className="text-slate-400"> — {m.reason}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
