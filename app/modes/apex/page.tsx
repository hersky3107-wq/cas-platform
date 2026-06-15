"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { resolveSynodLocale, type SynodLocale } from "@/lib/synod/ui-labels";
import { getApexUiPack } from "@/lib/apex/ui-labels";
import type { AiProviderName } from "@/lib/ai/router";
import {
  AI_COLORS,
  BRAND,
  APEX_PROVIDERS,
  APEX_MODEL_META,
  isApexNew,
  APEX_ANNOUNCEMENT,
} from "@/lib/apex/config";
import HelpModal from "@/components/HelpModal";
import { apexHelpContent } from "@/lib/help-modal/apex-content";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

/** Premium flat price shown on the CTA. Source of truth is the API (APEX_CREDITS). */
const APEX_CREDITS = 35;

// ── Phase ───────────────────────────────────────────────────────────────────
// idle      → user hasn't started yet
// starting  → 'start' API call in flight (credits deducted, session created)
// running   → sequential debater loop; cards arrive one by one
// synthesizing → all debaters settled; synthesis call in flight
// done      → synthesis received (or partial if < 2 succeeded)
// error     → hard abort (credits, auth, network exhausted)
type Phase = "idle" | "starting" | "running" | "synthesizing" | "done" | "error";

type DebaterStatus = "waiting" | "running" | "done" | "failed";

type ApexTurn = {
  ai: string;
  model: string;
  content: string;
  ms: number | null;
};

// All fields optional so the same type covers every action's response shape.
type ApexApiResult = {
  ok?: boolean;
  error?: string;
  balance?: number;
  sessionId?: string;
  shareId?: string;
  creditsRemaining?: number;
  turns?: ApexTurn[];
  turn?: ApexTurn | null;
  synthesis?: string | null;
  partial?: boolean;
};

/** Format 'YYYY-MM' → 'YYYY.M' for the premium model subtitle. */
function formatSince(since: string): string {
  const [year, month] = since.split("-");
  if (!year || !month) return since;
  return `${year}.${Number(month)}`;
}

function isApexProvider(ai: string): ai is AiProviderName {
  return ai in BRAND;
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function ApexPage() {
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [votedAi, setVotedAi] = useState<string | null>(null);
  const [turns, setTurns] = useState<ApexTurn[]>([]);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-provider status for the progressive reveal UI.
  const [debaterStatus, setDebaterStatus] = useState<Partial<Record<string, DebaterStatus>>>({});
  // Shared elapsed-seconds counter shown on every still-running slot (all 6 run
  // in parallel, so a single global timer is cleaner than per-provider timers).
  const [elapsedSec, setElapsedSec] = useState(0);

  const runningRef = useRef(false);

  // Hydration-safe locale: server + first client render use 'en'; resolved
  // after mount and whenever question changes (script detection → navigator fallback).
  const [locale, setLocale] = useState<SynodLocale>("en");
  useEffect(() => {
    const uiLocale = typeof navigator !== "undefined" ? navigator.language : null;
    setLocale(resolveSynodLocale(question, uiLocale));
  }, [question]);

  const t = getApexUiPack(locale);
  const isRtl = locale === "ar";

  // Tick a shared elapsed-seconds counter while debaters are running in parallel.
  // Resets to 0 on entry and stops once we leave the running phase.
  useEffect(() => {
    if (phase !== "running") {
      setElapsedSec(0);
      return;
    }
    setElapsedSec(0);
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // ── Shared POST helper (global errors, retry) ────────────────────────────
  // Used for: start, synthesize (session-level failures abort the whole run).
  const postWithRetry = useCallback(
    async (reqBody: Record<string, unknown>): Promise<ApexApiResult | "abort" | null> => {
      const MAX_ATTEMPTS = 4;
      let lastErr = "";
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const res = await fetch("/api/apex", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reqBody),
          });
          if (res.status === 402) {
            const j = (await res.json().catch(() => null)) as { error?: string } | null;
            setError(j?.error ?? t.insufficientCredits);
            return "abort";
          }
          if (!res.ok) {
            lastErr = t.requestFailed(res.status);
            if (attempt < MAX_ATTEMPTS) {
              await new Promise((r) => setTimeout(r, attempt * 1000));
              continue;
            }
            setError(lastErr);
            return null;
          }
          const data = (await res.json().catch(() => null)) as ApexApiResult | null;
          if (!data || data.ok !== true) {
            lastErr = data?.error ?? t.malformedResponse;
            if (attempt < MAX_ATTEMPTS) {
              await new Promise((r) => setTimeout(r, attempt * 1000));
              continue;
            }
            setError(lastErr);
            return null;
          }
          return data;
        } catch (e: unknown) {
          lastErr = e instanceof Error ? e.message : t.networkError;
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, attempt * 1000));
            continue;
          }
          setError(lastErr);
          return null;
        }
      }
      setError(lastErr || t.requestFailedGeneric);
      return null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  );

  // ── Per-debater fetch (silent — failures mark that provider failed, no abort) ─
  const fetchDebater = useCallback(
    async (sId: string, provider: AiProviderName): Promise<ApexTurn | null> => {
      try {
        const res = await fetch("/api/apex", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "debater",
            sessionId: sId,
            provider,
            ui_locale: locale,
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json().catch(() => null)) as ApexApiResult | null;
        if (!data?.ok) return null;
        return data.turn ?? null;
      } catch {
        return null;
      }
    },
    [locale]
  );

  // ── Main parallel-progressive run ──────────────────────────────────────────
  const runApex = useCallback(async () => {
    const q = question.trim();
    if (!q || runningRef.current) return;
    runningRef.current = true;

    // Reset all state.
    setError(null);
    setTurns([]);
    setSynthesis(null);
    setPartial(false);
    setSessionId(null);
    setShareId(null);
    setVotedAi(null);
    setDebaterStatus({});
    setPhase("starting");

    try {
      // ── 1. Start: auth + deduct credits + create session (no AI calls) ───
      const startRes = await postWithRetry({
        action: "start",
        question: q,
        ui_locale: locale,
      });
      if (startRes === "abort" || startRes === null) {
        setPhase("error");
        return;
      }
      const sId = startRes.sessionId!;
      setSessionId(sId);
      setShareId(startRes.shareId ?? null);

      // ── 2. All 6 debaters go straight to 'running' (they all fire at once) ─
      const initStatus: Record<string, DebaterStatus> = {};
      for (const p of APEX_PROVIDERS) initStatus[p] = "running";
      setDebaterStatus(initStatus);
      setPhase("running");

      // ── 3. Fire ALL 6 in PARALLEL; each updates its own slot on resolve ──
      let successCount = 0;
      const inFlight = APEX_PROVIDERS.map((provider) =>
        fetchDebater(sId, provider).then((turn) => {
          if (turn) {
            successCount++;
            // Append the card the moment this model returns (fastest first).
            setTurns((prev) => [...prev, turn]);
            setDebaterStatus((prev) => ({ ...prev, [provider]: "done" }));
          } else {
            setDebaterStatus((prev) => ({ ...prev, [provider]: "failed" }));
          }
        })
      );

      // Wait for all to settle (each already handled its own state above).
      await Promise.allSettled(inFlight);

      // ── 4. Synthesize (needs >= 2 successes) ──────────────────────────────
      if (successCount < 2) {
        setPartial(true);
        setPhase("done");
        return;
      }

      setPhase("synthesizing");
      const synthRes = await postWithRetry({
        action: "synthesize",
        sessionId: sId,
        ui_locale: locale,
      });
      if (synthRes && synthRes !== "abort") {
        setSynthesis(synthRes.synthesis ?? null);
        if (synthRes.partial) setPartial(true);
      }

      setPhase("done");
    } finally {
      runningRef.current = false;
    }
  }, [question, locale, postWithRetry, fetchDebater]);

  void votedAi;
  void setVotedAi;
  void shareId;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <main className={BG} dir={isRtl ? "rtl" : "ltr"}>
      <HelpModal content={apexHelpContent} />
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-8 sm:px-6 sm:py-10">

        {/* Header */}
        <header className="mb-6 flex items-start gap-3">
          <Link
            href="/"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.08] ring-1 ring-white/15 transition-colors hover:bg-white/[0.12]"
            aria-label={t.back}
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-3">
            <Image
              src="/icons/apex.png"
              alt="APEX"
              width={40}
              height={40}
              className="h-10 w-10 rounded-xl ring-1 ring-amber-300/30"
              priority
            />
            <div>
              <h1 className="bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-400 bg-clip-text text-2xl font-bold tracking-tight text-transparent">
                APEX
              </h1>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-300">
                {t.headerTagline}
              </p>
            </div>
          </div>
        </header>

        {/* ── IDLE ── */}
        {phase === "idle" ? (
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="w-full max-w-xl space-y-5">
              <p className="text-center text-base font-medium leading-relaxed text-amber-100/90">
                {t.idleHero}
              </p>

              <ModelPreview animated={false} newBadge={t.newBadge} />

              {APEX_ANNOUNCEMENT.active ? (
                <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-100">
                  {APEX_ANNOUNCEMENT.message}
                  {APEX_ANNOUNCEMENT.date ? (
                    <span className="ml-1 text-amber-300/70">({APEX_ANNOUNCEMENT.date})</span>
                  ) : null}
                </div>
              ) : null}

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  {t.examplesLabel}
                </p>
                <div className="flex flex-wrap gap-2">
                  {t.examples.map((q, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setQuestion(q)}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition hover:border-amber-400/40 hover:bg-amber-500/10 hover:text-amber-200"
                    >
                      {q.length > 48 ? `${q.slice(0, 48)}\u2026` : q}
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={t.placeholder}
                rows={4}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-relaxed text-white placeholder:text-slate-500 focus:border-amber-400/50 focus:outline-none"
              />

              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={runApex}
                  disabled={!question.trim()}
                  className="rounded-2xl border border-amber-300/50 bg-gradient-to-r from-amber-400/90 to-yellow-500/90 px-7 py-3 text-sm font-bold text-slate-950 shadow-[0_0_24px_rgba(251,191,36,0.35)] transition hover:from-amber-300 hover:to-yellow-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t.runLabel}{APEX_CREDITS}{t.creditsSuffix}
                </button>
              </div>
            </div>
          </div>

        ) : (
          /* ── NON-IDLE PHASES ── */
          <>
            {/* Global error banner */}
            {error ? (
              <div className="mb-4 rounded-2xl border border-rose-400/50 bg-rose-500/20 px-4 py-3 text-sm leading-relaxed text-rose-200">
                {error}
              </div>
            ) : null}

            {/* Question echo */}
            {question ? (
              <p className="mb-6 whitespace-pre-wrap rounded-2xl border border-amber-400/20 bg-white/[0.04] px-4 py-3 text-sm leading-relaxed text-slate-200">
                {question}
              </p>
            ) : null}

            {/* ── STARTING: credits+session in flight ── */}
            {phase === "starting" ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-5 py-10">
                <ModelPreview animated newBadge={t.newBadge} />
                <p className="animate-pulse text-sm font-medium tracking-wide text-amber-100/80">
                  {t.loading}
                </p>
              </div>
            ) : null}

            {/* ── RUNNING / SYNTHESIZING / DONE / ERROR ── */}
            {(phase === "running" || phase === "synthesizing" || phase === "done" || phase === "error") ? (
              <>
                {/* Partial note */}
                {partial ? (
                  <div className="mb-4 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-2.5 text-xs leading-relaxed text-amber-200">
                    {t.partialNote}
                  </div>
                ) : null}

                {/* Progressive reveal: one slot per provider in canonical order.
                    All 6 run in parallel — each pops into a full card as it lands. */}
                <div className="space-y-3">
                  {APEX_PROVIDERS.map((provider) => {
                    const status = debaterStatus[provider] ?? "waiting";
                    const completedTurn = turns.find((t) => t.ai === provider);

                    if (completedTurn) {
                      return (
                        <ApexAnswerCard key={provider} turn={completedTurn} ms={t.ms} />
                      );
                    }
                    if (status === "failed") {
                      return (
                        <ModelFailedRow key={provider} provider={provider} />
                      );
                    }
                    // waiting or running — show shared elapsed timer on running slots
                    return (
                      <ModelProgressRow
                        key={provider}
                        provider={provider}
                        status={status}
                        elapsedSec={status === "running" ? elapsedSec : 0}
                        newBadge={t.newBadge}
                      />
                    );
                  })}
                </div>

                {/* Synthesizing spinner (after all debaters have settled) */}
                {phase === "synthesizing" ? (
                  <div className="mt-8 flex items-center justify-center gap-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400/60 animate-bounce [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400/60 animate-bounce [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400/60 animate-bounce" />
                    <p className="text-sm font-medium tracking-wide text-amber-100/80">
                      {t.synthesizing}
                    </p>
                  </div>
                ) : null}

                {/* Synthesis card */}
                {synthesis ? (
                  <section className="mt-8 rounded-2xl ring-2 ring-amber-400/55 bg-gradient-to-b from-amber-500/[0.10] to-white/[0.04] px-5 py-5 shadow-[0_0_30px_rgba(251,191,36,0.12)]">
                    <h2 className="mb-3 bg-gradient-to-r from-amber-200 to-yellow-300 bg-clip-text text-sm font-bold uppercase tracking-widest text-transparent">
                      {t.synthesisHeading}
                    </h2>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                      {synthesis}
                    </p>
                  </section>
                ) : null}

                {phase === "done" && sessionId && synthesis ? (
                  // TODO: <ApexSessionEndPanel ... /> — built next as a separate step.
                  null
                ) : null}
              </>
            ) : null}
          </>
        )}

      </div>
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Idle/loading preview of all 6 model pills. */
function ModelPreview({ animated, newBadge }: { animated: boolean; newBadge: string }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {APEX_PROVIDERS.map((provider) => {
        const meta = APEX_MODEL_META[provider];
        const color = AI_COLORS[provider];
        const fresh = isApexNew(meta.since);
        return (
          <div
            key={provider}
            className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs ${
              animated ? "animate-pulse" : ""
            }`}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            <span className="font-semibold text-slate-200">{BRAND[provider]}</span>
            <span className="text-slate-500">{meta.label}</span>
            {fresh ? (
              <span className="rounded-md border border-amber-300/50 bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-200">
                {newBadge}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** In-progress row for a provider that is waiting or currently running. */
function ModelProgressRow({
  provider,
  status,
  elapsedSec,
  newBadge,
}: {
  provider: AiProviderName;
  status: DebaterStatus;
  elapsedSec: number;
  newBadge: string;
}) {
  const meta = APEX_MODEL_META[provider];
  const color = AI_COLORS[provider];
  const fresh = isApexNew(meta.since);
  const isRunning = status === "running";

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl px-4 py-3 ring-1 transition-all duration-500 ${
        isRunning
          ? "ring-amber-400/40 bg-amber-500/[0.06] shadow-[0_0_18px_rgba(251,191,36,0.07)]"
          : "ring-white/[0.05] bg-white/[0.02] opacity-35"
      }`}
    >
      <span
        className={`h-2 w-2 flex-shrink-0 rounded-full transition-all ${isRunning ? "animate-pulse" : ""}`}
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="flex-1 text-sm font-semibold text-slate-200">{BRAND[provider]}</span>
      <span className="text-[11px] text-slate-500">{meta.label}</span>
      {fresh ? (
        <span className="rounded-md border border-amber-300/40 bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-200/80">
          {newBadge}
        </span>
      ) : null}
      {isRunning ? (
        <span className="min-w-[2.5rem] text-right font-mono text-[11px] tabular-nums text-amber-300/90">
          {elapsedSec}s
        </span>
      ) : null}
    </div>
  );
}

/** Failed row: subtle, doesn't call attention to itself. */
function ModelFailedRow({ provider }: { provider: AiProviderName }) {
  const meta = APEX_MODEL_META[provider];
  const color = AI_COLORS[provider];
  return (
    <div className="flex items-center gap-3 rounded-2xl px-4 py-3 ring-1 ring-white/[0.04] bg-white/[0.02] opacity-30">
      <span
        className="h-2 w-2 flex-shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="flex-1 text-sm font-semibold text-slate-400">{BRAND[provider]}</span>
      <span className="text-[11px] text-slate-600">{meta.label}</span>
      <span className="text-[10px] text-rose-400/50">\u2014</span>
    </div>
  );
}

/** One flagship answer card — left color accent, brand + model subtitle, content, timing. */
function ApexAnswerCard({ turn, ms }: { turn: ApexTurn; ms: string }) {
  const ai = turn.ai;
  const known = isApexProvider(ai);
  const color = known ? AI_COLORS[ai] : "#94a3b8";
  const brand = known ? BRAND[ai] : ai;
  const meta = known ? APEX_MODEL_META[ai] : null;

  return (
    <div
      className="rounded-2xl ring-1 ring-white/[0.08] bg-white/[0.04] px-4 py-3.5"
      style={{ borderLeftColor: color, borderLeftWidth: 3, borderLeftStyle: "solid" }}
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-white">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden
          />
          {brand}
        </span>
        <span className="text-[11px] text-slate-500">
          {meta ? `${meta.label} · ${formatSince(meta.since)}` : turn.model}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{turn.content}</p>
      {typeof turn.ms === "number" ? (
        <p className="mt-2 text-right text-[10px] text-slate-500">
          {turn.ms} {ms}
        </p>
      ) : null}
    </div>
  );
}
