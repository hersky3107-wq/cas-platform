"use client";

import Link from "next/link";
import ShareButtons from "@/components/ShareButtons";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { AiProviderName, RouterResult } from "@/lib/ai/router";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

type DeepOutputMode = "brief" | "standard" | "report";

const MODE_COST: Record<DeepOutputMode, number> = {
  brief: 3,
  standard: 10,
  report: 30,
};

const PROVIDER_ORDER: AiProviderName[] = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "deepseek",
  "mistral",
];

const AI_LABEL: Record<AiProviderName, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
  xai: "Grok",
  deepseek: "DeepSeek",
  mistral: "Mistral",
};

const GEMINI_LETTER_COLORS = [
  "#4285F4",
  "#EA4335",
  "#FBBC05",
  "#34A853",
  "#4285F4",
  "#EA4335",
] as const;

const AI_BORDER: Record<AiProviderName, string> = {
  openai: "#10A37F",
  anthropic: "#D97757",
  google: "#4285F4",
  xai: "#ffffff",
  deepseek: "#4D6BFE",
  mistral: "#FF7000",
};

type DeepPart = {
  index: number;
  topic: string;
  assigned_provider: AiProviderName;
  priority: "CORE" | "SUPPORT";
  depth?: string;
  angle?: string;
};

function AiNameBadge({ provider }: { provider: AiProviderName }) {
  const base =
    "inline-flex rounded-lg px-2.5 py-0.5 text-xs font-bold sm:text-sm";

  if (provider === "openai") {
    return (
      <span className={`${base} bg-[#0a2540] text-white`}>
        {AI_LABEL.openai}
      </span>
    );
  }
  if (provider === "anthropic") {
    return (
      <span className={`${base} bg-[#F5E6D3] text-[#3d2914]`}>
        {AI_LABEL.anthropic}
      </span>
    );
  }
  if (provider === "google") {
    const word = AI_LABEL.google;
    return (
      <span className={`${base} bg-[#0d1117]`} aria-label={word}>
        {word.split("").map((ch, i) => (
          <span
            key={`${i}-${ch}`}
            style={{ color: GEMINI_LETTER_COLORS[i] ?? "#fff" }}
          >
            {ch}
          </span>
        ))}
      </span>
    );
  }
  if (provider === "xai") {
    return (
      <span
        className={`${base} border border-white bg-black text-white`}
      >
        {AI_LABEL.xai}
      </span>
    );
  }
  if (provider === "deepseek") {
    return (
      <span className={`${base} bg-[#1a1464] text-white`}>{AI_LABEL.deepseek}</span>
    );
  }
  return (
    <span className={`${base} bg-[#FF7000] text-white`}>{AI_LABEL.mistral}</span>
  );
}

function PriorityBadge({ p }: { p: "CORE" | "SUPPORT" }) {
  if (p === "CORE") {
    return (
      <span className="rounded-md bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-950">
        CORE
      </span>
    );
  }
  return (
    <span className="rounded-md bg-slate-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-100">
      SUPPORT
    </span>
  );
}

const EMPTY_MANUAL_ANGLES = (): Record<AiProviderName, string> =>
  Object.fromEntries(PROVIDER_ORDER.map((p) => [p, ""])) as Record<
    AiProviderName,
    string
  >;

export default function DeepModePage() {
  const [input, setInput] = useState("");
  const [outputMode, setOutputMode] = useState<DeepOutputMode>("standard");
  const [analysisMode, setAnalysisMode] = useState<"auto" | "manual">("auto");
  const [manualAngles, setManualAngles] = useState(EMPTY_MANUAL_ANGLES);
  const [sending, setSending] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "orchestrating" | "running" | "done" | "error"
  >("idle");
  const [plan, setPlan] = useState<DeepPart[] | null>(null);
  const [partsOut, setPartsOut] = useState<
    Map<
      number,
      {
        part: DeepPart;
        result: RouterResult;
      }
    >
  >(new Map());
  const [winner, setWinner] = useState<string | null>(null);
  const [synthesis, setSynthesis] = useState("");
  const [credits, setCredits] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Visible in React state; ref avoids double-invoke / timer cleared by overlapping effects. */
  const [deepUxToastVisible, setDeepUxToastVisible] = useState(false);
  const deepUxToastOnceRef = useRef(false);

  useEffect(() => {
    if (!plan?.length || deepUxToastOnceRef.current) return;
    deepUxToastOnceRef.current = true;
    setDeepUxToastVisible(true);
    const t = window.setTimeout(() => setDeepUxToastVisible(false), 4000);
    return () => clearTimeout(t);
  }, [plan]);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/credits/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await res.json().catch(() => null)) as { balance?: number };
      if (typeof j?.balance === "number") setCredits(j.balance);
    })();
  }, []);

  const runAnalyze = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || sending) return;

    setSending(true);
    setError(null);
    setWinner(null);
    setSynthesis("");
    setPlan(null);
    setPartsOut(new Map());
    setPhase("orchestrating");

    const manualAssignments =
      analysisMode === "manual" &&
      (outputMode === "standard" || outputMode === "report")
        ? PROVIDER_ORDER.map((provider) => ({
            provider,
            angle: manualAngles[provider].trim(),
          }))
        : null;

    try {
      const res = await fetch("/api/deep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          outputMode,
          manualAssignments,
        }),
      });

      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
          balance?: number;
        };
        setError(j?.error ?? "Request failed");
        if (typeof j?.balance === "number") setCredits(j.balance);
        setPhase("error");
        setSending(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("No response body");
        setPhase("error");
        setSending(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg: {
            type?: string;
            creditsRemaining?: number;
            parts?: DeepPart[];
            index?: number;
            topic?: string;
            priority?: "CORE" | "SUPPORT";
            assigned_provider?: AiProviderName;
            angle?: string;
            result?: RouterResult;
            winner_ai_name?: string;
            synthesis?: string;
            error?: string;
          };
          try {
            msg = JSON.parse(line) as typeof msg;
          } catch {
            continue;
          }

          if (msg.type === "meta") {
            if (typeof msg.creditsRemaining === "number") {
              setCredits(msg.creditsRemaining);
            }
          }

          if (msg.type === "plan" && Array.isArray(msg.parts)) {
            setPlan(msg.parts);
            setPhase("running");
          }

          if (msg.type === "part_result" && msg.result != null && msg.index != null) {
            const partSlice: DeepPart = {
              index: msg.index,
              topic: String(msg.topic ?? ""),
              assigned_provider: msg.assigned_provider!,
              priority: msg.priority === "CORE" ? "CORE" : "SUPPORT",
              angle: msg.angle,
            };
            setPartsOut((prev) => {
              const next = new Map(prev);
              next.set(msg.index!, { part: partSlice, result: msg.result! });
              return next;
            });
          }

          if (msg.type === "done" && msg.winner_ai_name) {
            setWinner(msg.winner_ai_name);
            setPhase("done");
            setSynthesis(msg.synthesis ?? "");
          }

          if (msg.type === "error" && msg.error) {
            setError(msg.error);
            setPhase("error");
          }
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setPhase("error");
    } finally {
      setSending(false);
    }
  }, [input, sending, outputMode, analysisMode, manualAngles]);

  const modeCost = MODE_COST[outputMode];
  const showManualToggle =
    outputMode === "standard" || outputMode === "report";

  const sortedPlan = plan
    ? [...plan].sort((a, b) => a.index - b.index)
    : [];

  return (
    <main className={BG}>
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-10 sm:px-6 lg:max-w-4xl lg:py-14">
        <header className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Link
              href="/"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.08] ring-1 ring-white/15 transition-colors hover:bg-white/[0.12]"
              aria-label="Back"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-white lg:text-[2rem]">
                DEEP
              </h1>
              <p className="mt-2 text-xs leading-relaxed text-white/52">
                {modeCost} credits
              </p>
              {typeof credits === "number" ? (
                <p className="mt-2 text-xs text-white/52">
                  Your balance:{" "}
                  <span className="tabular-nums text-white/72">{credits}</span>
                </p>
              ) : null}
            </div>
          </div>
          <div className="relative h-[76px] w-[76px] shrink-0 overflow-hidden rounded-2xl shadow-[0_8px_24px_rgba(0,0,0,0.45)] sm:h-[92px] sm:w-[92px]">
            <img
              src="/icons/deep.png"
              alt=""
              className="h-full w-full object-cover object-center"
            />
          </div>
        </header>

        <section className="rounded-3xl bg-white/[0.05] p-6 ring-1 ring-white/10 lg:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/55">
            Output length
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                {
                  id: "brief" as const,
                  title: "BRIEF",
                  desc: "Quick summary",
                  credits: MODE_COST.brief,
                },
                {
                  id: "standard" as const,
                  title: "STANDARD",
                  desc: "Deep analysis",
                  credits: MODE_COST.standard,
                },
                {
                  id: "report" as const,
                  title: "REPORT",
                  desc: "Full report",
                  credits: MODE_COST.report,
                },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={sending}
                onClick={() => {
                  setOutputMode(m.id);
                  if (m.id === "brief") setAnalysisMode("auto");
                }}
                className={`flex min-w-[7.5rem] flex-1 flex-col items-start rounded-2xl border px-3 py-2.5 text-left transition disabled:opacity-45 sm:min-w-[8rem] ${
                  outputMode === m.id
                    ? "border-cyan-500/60 bg-cyan-500/15 ring-1 ring-cyan-500/30"
                    : "border-white/[0.12] bg-black/25 hover:border-white/20"
                }`}
              >
                <span className="text-xs font-bold tracking-wide text-white">
                  {m.title}
                </span>
                <span className="mt-0.5 text-[11px] text-white/55">
                  {m.desc} · {m.credits} credits
                </span>
              </button>
            ))}
            <button
              type="button"
              disabled
              className="relative flex min-w-[7.5rem] flex-1 flex-col items-start rounded-2xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-left opacity-50 sm:min-w-[8rem]"
            >
              <span className="absolute right-2 top-2 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/70">
                Coming soon
              </span>
              <span className="text-xs font-bold tracking-wide text-white/60">
                THESIS
              </span>
              <span className="mt-0.5 text-[11px] text-white/40">
                Academic depth
              </span>
            </button>
          </div>

          {showManualToggle ? (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/55">
                Assignment
              </p>
              <div className="mt-2 inline-flex rounded-full bg-black/40 p-0.5 ring-1 ring-white/10">
                {(["auto", "manual"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={sending}
                    onClick={() => setAnalysisMode(mode)}
                    className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition disabled:opacity-45 ${
                      analysisMode === mode
                        ? "bg-cyan-500/90 text-neutral-950"
                        : "text-white/60 hover:text-white/85"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {showManualToggle && analysisMode === "manual" ? (
            <div className="mt-4 space-y-3 rounded-2xl border border-white/[0.1] bg-black/30 p-4">
              <p className="text-[11px] leading-relaxed text-white/52">
                Assign a focus for each model (first two become CORE).
              </p>
              {PROVIDER_ORDER.map((provider) => (
                <label key={provider} className="block">
                  <span className="mb-1.5 flex items-center gap-2">
                    <AiNameBadge provider={provider} />
                  </span>
                  <input
                    type="text"
                    value={manualAngles[provider]}
                    onChange={(e) =>
                      setManualAngles((prev) => ({
                        ...prev,
                        [provider]: e.target.value,
                      }))
                    }
                    disabled={sending}
                    placeholder={`What should ${AI_LABEL[provider]} focus on?`}
                    className="w-full rounded-xl border border-white/[0.12] bg-black/35 px-3 py-2 text-sm text-white outline-none placeholder:text-white/36 focus:border-cyan-500/65 focus:ring-2 focus:ring-cyan-500/20 disabled:opacity-55"
                  />
                </label>
              ))}
            </div>
          ) : null}

          <label className="mt-6 block text-xs font-semibold uppercase tracking-[0.2em] text-white/55">
            Question / topic
          </label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
            placeholder={`e.g. "Is democracy the best system humanity has?" or "What makes the Eiffel Tower iconic?" — The more debatable, complex, or specialized the topic, the sharper the six-lens analysis`}
            className="mt-4 min-h-[140px] w-full resize-y rounded-2xl border border-white/[0.12] bg-black/35 px-4 py-3 text-sm leading-relaxed text-white outline-none ring-2 ring-transparent placeholder:text-white/36 focus:border-cyan-500/65 focus:ring-cyan-500/25 disabled:opacity-55"
          />
          <p className="mt-2 text-[12px] leading-relaxed text-white/52">
            One question. Six perspectives. CORE delivers the critical analysis.
            SUPPORT provides context and counterarguments.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runAnalyze}
              disabled={sending || !input.trim()}
              className="inline-flex h-11 min-w-[120px] items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-cyan-600 px-6 text-sm font-semibold text-neutral-950 shadow-[0_4px_20px_rgba(34,211,238,0.35)] disabled:opacity-45"
            >
              {sending ? "Analyzing…" : "Analyze"}
            </button>
            {phase === "orchestrating" ? (
              <span className="text-xs text-teal-200/90">
                Orchestrator drafting the six-part plan…
              </span>
            ) : null}
            {phase === "running" && plan ? (
              <span className="text-xs text-cyan-200/85">
                Models answering in parallel (
                <span className="tabular-nums">{partsOut.size}</span>/6 settled)
              </span>
            ) : null}
          </div>
          {error ? (
            <p className="mt-4 text-sm text-rose-300/95">{error}</p>
          ) : null}
        </section>

        {winner && phase === "done" ? (
          <p className="mt-6 text-center text-sm text-emerald-200/90">
            Highlighted CORE pick (heuristic):{" "}
            <span className="font-semibold text-white">{winner}</span> (
            {AI_LABEL[winner as AiProviderName] ?? winner})
          </p>
        ) : null}

        {sortedPlan.length > 0 ? (
          <section className="mt-12 space-y-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/52">
              Results
            </h2>
            {sortedPlan.map((p) => {
              const got = partsOut.get(p.index);
              const border = AI_BORDER[p.assigned_provider];
              const isCore = p.priority === "CORE";
              const body = !got ? (
                <div className="animate-pulse text-sm text-slate-400">
                  Awaiting{" "}
                  <span className="text-white/70">
                    {AI_LABEL[p.assigned_provider]}
                  </span>
                  …
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                    {got.result.error
                      ? got.result.error
                      : got.result.text ?? "(empty response)"}
                  </p>
                  <p className="mt-3 text-[10px] tabular-nums text-slate-500">
                    {got.result.responseTimeMs} ms
                  </p>
                </>
              );

              const angleText =
                (got?.part.angle ?? p.angle ?? "").trim() || ""

              const header = (
                <div className="flex flex-wrap items-start gap-3 gap-y-2">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <AiNameBadge provider={p.assigned_provider} />
                    {angleText ? (
                      <p className="max-w-xl text-[12px] italic leading-snug text-white/68">
                        Angle: {angleText}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityBadge p={p.priority} />
                    <span className="text-[11px] text-white/50">
                      Part {p.index}
                    </span>
                  </div>
                </div>
              );

              if (isCore) {
                return (
                  <article
                    key={p.index}
                    className="rounded-3xl bg-white/[0.06] p-6 shadow-[0_12px_40px_rgba(0,0,0,0.35)] lg:p-8"
                    style={{
                      borderWidth: 2,
                      borderColor: `${border}`,
                      borderStyle: "solid",
                    }}
                  >
                    {header}
                    <p className="mt-4 text-[13px] font-medium text-white lg:text-[15px]">
                      {p.topic}
                    </p>
                    <div className="mt-6">{body}</div>
                  </article>
                );
              }

              return (
                <details
                  key={p.index}
                  className="group rounded-2xl bg-white/[0.04] ring-1 ring-white/[0.08]"
                  style={{
                    borderLeftWidth: 3,
                    borderLeftStyle: "solid",
                    borderLeftColor: `${border}`,
                  }}
                >
                  <summary className="cursor-pointer list-none px-4 py-3 sm:px-5 sm:py-4 [&::-webkit-details-marker]:hidden">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>{header}</div>
                      <span className="text-[10px] text-white/50 group-open:hidden shrink-0">
                        💡 Tap to expand
                      </span>
                    </div>
                    <p className="mt-2 text-[13px] text-white/82">{p.topic}</p>
                  </summary>
                  <div className="border-t border-white/[0.08] px-4 py-4 sm:px-5">
                    {body}
                  </div>
                </details>
              );
            })}
            {synthesis.trim() ? (
              <article
                className="rounded-3xl bg-black/45 p-6 shadow-[0_12px_40px_rgba(0,0,0,0.45)] ring-2 ring-amber-400/55 lg:p-8"
              >
                <div className="flex flex-wrap items-center gap-3 gap-y-2 border-b border-amber-400/25 pb-4">
                  <p className="text-base font-bold uppercase tracking-[0.28em] text-amber-100 sm:text-lg">
                    SYNTHESIS
                  </p>
                  <AiNameBadge provider="openai" />
                </div>
                <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                  {synthesis}
                </p>
              </article>
            ) : null}
            {phase === "done" ? (
              <ShareButtons modeName="DEEP" className="mt-8" />
            ) : null}
          </section>
        ) : null}

        {!sortedPlan.length && phase === "running" ? (
          <div className="mt-14 text-center text-sm text-white/56">
            Receiving orchestration plan…
          </div>
        ) : null}

        {deepUxToastVisible ? (
          <div
            className="pointer-events-none fixed bottom-8 left-1/2 z-50 max-w-[min(90vw,24rem)] -translate-x-1/2 rounded-2xl border border-white/[0.12] bg-neutral-950/95 px-4 py-3 text-center text-[13px] leading-snug text-slate-100 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
            role="status"
          >
            CORE = critical analysis · Tap SUPPORT cards to expand 👆
          </div>
        ) : null}
      </div>
    </main>
  );
}
