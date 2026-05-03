"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { ChevronLeft } from "lucide-react";
import { supabase } from "@/lib/db/supabase";
import { creditsPerMessage } from "@/lib/credits";
import type { AiProviderName, RouterResult } from "@/lib/ai/router";
import {
  VERDICT_PREDICT_AI_ORDER,
  parseVerdictPredictResponse,
  probabilityLabel,
  stripMarkdownFormattingForPredict,
} from "@/lib/verdict-predict";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

const GEMINI_LETTER_COLORS = [
  "#4285F4",
  "#EA4335",
  "#FBBC05",
  "#34A853",
  "#4285F4",
  "#EA4335",
] as const;

const PROVIDER_SCORE_COLOR: Record<AiProviderName, string> = {
  openai: "#10A37F",
  anthropic: "#D97757",
  google: "#4285F4",
  xai: "#718096",
  deepseek: "#4D6BFE",
  mistral: "#FF7000",
};

const FINAL_BLUE = "#3B82F6";
const CARD_STAGGER_MS = 300;
const FINAL_PANEL_DELAY_MS = 2000;

type PredictRow = {
  provider: AiProviderName;
  ms: number;
  error?: string;
  probability: number | null;
  reasoning: string;
};

type JudgeFinal = {
  provider: AiProviderName;
  probability: number | null;
  reasoning: string;
  ms: number;
  error?: string;
};

function AiNameBadge({ provider }: { provider: AiProviderName }) {
  const base = "inline-flex shrink-0 rounded-lg px-2.5 py-0.5 text-sm font-bold";
  if (provider === "openai") {
    return <span className={`${base} bg-[#0a2540] text-white`}>ChatGPT</span>;
  }
  if (provider === "anthropic") {
    return (
      <span className={`${base} bg-[#F5E6D3] text-[#3d2914]`}>Claude</span>
    );
  }
  if (provider === "google") {
    const word = "Gemini";
    return (
      <span className={`${base} bg-[#0d1117]`} aria-label={word}>
        {word.split("").map((ch, i) => (
          <span key={`${i}-${ch}`} style={{ color: GEMINI_LETTER_COLORS[i] ?? "#fff" }}>
            {ch}
          </span>
        ))}
      </span>
    );
  }
  if (provider === "xai") {
    return (
      <span className={`${base} border border-white bg-black text-white`}>Grok</span>
    );
  }
  if (provider === "deepseek") {
    return <span className={`${base} bg-[#1a1464] text-white`}>DeepSeek</span>;
  }
  return <span className={`${base} bg-[#FF7000] text-white`}>Mistral</span>;
}

function staggerShouldBeVisible(anchorMs: number | undefined, staggerIndex: number): boolean {
  if (anchorMs == null) return false;
  return Date.now() >= anchorMs + staggerIndex * CARD_STAGGER_MS;
}

function PredictJudgeCard({
  provider,
  ms,
  error,
  probability,
  reasoning,
}: {
  provider: AiProviderName;
  ms: number;
  error?: string;
  probability: number | null;
  reasoning: string;
}) {
  const color = PROVIDER_SCORE_COLOR[provider];
  const pctLabel =
    probability != null ? probabilityLabel(Math.round(probability)) : "—";
  return (
    <div className="flex w-full max-w-[85%] flex-col items-start gap-2">
      <AiNameBadge provider={provider} />
      <div className="w-full rounded-2xl bg-white/[0.09] px-3.5 py-3 text-slate-100">
        {error ? (
          <p className="text-sm text-rose-300/95">{error}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              <p
                className="font-bold tabular-nums leading-none"
                style={{ fontSize: "3rem", color }}
              >
                {probability != null ? `${Math.round(probability)}%` : "—"}
              </p>
              <span className="text-xs font-medium text-slate-400">{pctLabel}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
              {reasoning || "—"}
            </p>
          </>
        )}
        <div className="mt-2 text-right text-[10px] tabular-nums text-slate-500">{ms} ms</div>
      </div>
    </div>
  );
}

function StaggeredPredictCard({
  anchorMs,
  staggerIndex,
  ...props
}: {
  anchorMs: number | undefined;
  staggerIndex: number;
} & ComponentProps<typeof PredictJudgeCard>) {
  const [show, setShow] = useState(() => staggerShouldBeVisible(anchorMs, staggerIndex));

  useEffect(() => {
    if (anchorMs == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- stagger matches Score/Rank
      setShow(false);
      return;
    }
    const targetTime = anchorMs + staggerIndex * CARD_STAGGER_MS;
    const delay = Math.max(0, targetTime - Date.now());
    if (delay === 0) {
      setShow(true);
      return;
    }
    const id = window.setTimeout(() => setShow(true), delay);
    return () => window.clearTimeout(id);
  }, [anchorMs, staggerIndex]);

  if (!show) return null;
  return <PredictJudgeCard {...props} />;
}

export default function VerdictPredictPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [topic, setTopic] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responses, setResponses] = useState<PredictRow[]>([]);
  const [streamAnchorMs, setStreamAnchorMs] = useState<number | undefined>(undefined);
  const [average, setAverage] = useState<number | null>(null);
  const [averageLabel, setAverageLabel] = useState("");
  const [finalPanelOpen, setFinalPanelOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const finalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstResultRef = useRef(true);

  const fixedCost = useMemo(() => {
    try {
      return creditsPerMessage(VERDICT_PREDICT_AI_ORDER.length);
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (!data.session) {
        router.replace("/auth");
        return;
      }
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) router.replace("/auth");
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (!authReady) return;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const t = data.session?.access_token;
      if (!t) return;
      const res = await fetch("/api/credits/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supabaseAccessToken: t }),
      });
      const j = (await res.json().catch(() => null)) as { balance?: number };
      if (typeof j?.balance === "number") setCredits(j.balance);
    })();
  }, [authReady]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [responses, sending, finalPanelOpen]);

  useEffect(() => {
    return () => {
      if (finalTimerRef.current != null) clearTimeout(finalTimerRef.current);
    };
  }, []);

  const resetRound = useCallback(() => {
    if (finalTimerRef.current != null) {
      clearTimeout(finalTimerRef.current);
      finalTimerRef.current = null;
    }
    setSessionId(null);
    setTopic("");
    setResponses([]);
    setStreamAnchorMs(undefined);
    setAverage(null);
    setAverageLabel("");
    setFinalPanelOpen(false);
    firstResultRef.current = true;
  }, []);

  const send = useCallback(async () => {
    const body = topic.trim();
    if (!body || sending) return;

    setError(null);
    setSending(true);
    setResponses([]);
    setStreamAnchorMs(undefined);
    setAverage(null);
    setAverageLabel("");
    setFinalPanelOpen(false);
    firstResultRef.current = true;
    if (finalTimerRef.current != null) {
      clearTimeout(finalTimerRef.current);
      finalTimerRef.current = null;
    }

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        router.replace("/auth");
        return;
      }

      const res = await fetch("/api/ai-verdict-predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          predictionTopic: body,
          sessionId,
          supabaseAccessToken: token,
        }),
      });

      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
          balance?: number;
        };
        setError(j?.error ?? "Request failed");
        if (typeof j?.balance === "number") setCredits(j.balance);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("No response body");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      const applyResult = (r: RouterResult) => {
        const plain =
          r.text != null && !r.error ? stripMarkdownFormattingForPredict(r.text) : r.text;
        const { probability, reasoning } = parseVerdictPredictResponse(plain);
        if (firstResultRef.current) {
          firstResultRef.current = false;
          setStreamAnchorMs(Date.now());
        }
        setResponses((prev) => [
          ...prev,
          {
            provider: r.provider,
            ms: r.responseTimeMs,
            error: r.error,
            probability,
            reasoning: reasoning || "",
          },
        ]);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg: {
            type: string;
            result?: RouterResult;
            sessionId?: string;
            creditsRemaining?: number;
            error?: string;
            average?: number | null;
            averageLabel?: string;
            judges?: JudgeFinal[];
          };
          try {
            msg = JSON.parse(line) as typeof msg;
          } catch {
            continue;
          }
          if (msg.type === "meta" && msg.sessionId) {
            setSessionId(msg.sessionId);
            if (typeof msg.creditsRemaining === "number") setCredits(msg.creditsRemaining);
          }
          if (msg.type === "result" && msg.result) {
            applyResult(msg.result);
          }
          if (msg.type === "verdict_predict_final") {
            if (typeof msg.average === "number") {
              setAverage(msg.average);
              setAverageLabel(
                msg.averageLabel ||
                  probabilityLabel(Math.round(msg.average))
              );
            } else {
              setAverage(null);
              setAverageLabel("");
            }
            finalTimerRef.current = setTimeout(() => {
              setFinalPanelOpen(true);
              finalTimerRef.current = null;
            }, FINAL_PANEL_DELAY_MS);
          }
          if (msg.type === "error" && msg.error) {
            setError(msg.error);
          }
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSending(false);
    }
  }, [topic, sending, sessionId, router]);

  if (!authReady) {
    return (
      <div className={`${BG} flex min-h-screen items-center justify-center`}>
        <p className="text-sm text-white/60">Loading…</p>
      </div>
    );
  }

  const avgRounded = average != null ? Math.round(average) : null;
  const barWidth = avgRounded != null ? Math.min(100, Math.max(0, avgRounded)) : 0;

  return (
    <div className={BG}>
      <header className="fixed left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#0a0f1e]/95 px-3 py-2.5 backdrop-blur-md sm:px-4">
        <Link
          href="/modes/verdict"
          className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-2 text-sm text-white/90 transition hover:bg-white/14"
        >
          <ChevronLeft className="h-4 w-4" />
          Panel
        </Link>
        <div className="flex items-center gap-2">
          {credits !== null ? (
            <span className="rounded-full bg-[#131c35] px-3 py-1.5 text-xs text-slate-200">
              {credits} credits
            </span>
          ) : (
            <span className="rounded-full bg-[#131c35] px-3 py-1.5 text-xs text-slate-400">
              Credits unavailable
            </span>
          )}
          <button
            type="button"
            onClick={() => resetRound()}
            className="rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:bg-white/14"
          >
            New prediction
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-3 pb-72 pt-16 sm:px-4">
        <h1 className="mb-3 text-center text-xl font-bold leading-snug text-white sm:text-2xl">
          What are the odds? Let 6 AIs predict.
        </h1>
        <p className="mx-auto mb-8 max-w-2xl text-center text-xs text-slate-400 sm:text-sm">
          Every AI estimates independently. The results are averaged into one final prediction.
        </p>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {responses.length > 0 ? (
          <div className="mb-6 flex flex-col gap-3">
            <div className="flex justify-end">
              <div className="max-w-[90%] rounded-2xl bg-[#3d4451] px-3.5 py-2.5 text-sm leading-relaxed text-white">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Topic</p>
                <p className="whitespace-pre-wrap">{topic.trim()}</p>
              </div>
            </div>
            <div className="flex flex-col items-start gap-4">
              {responses.map((r, idx) => (
                <StaggeredPredictCard
                  key={`${r.provider}-${idx}`}
                  anchorMs={streamAnchorMs}
                  staggerIndex={idx}
                  provider={r.provider}
                  ms={r.ms}
                  error={r.error}
                  probability={r.probability}
                  reasoning={r.reasoning}
                />
              ))}
            </div>
            {finalPanelOpen && average != null ? (
              <div className="mt-8 w-full rounded-2xl border border-white/10 bg-[#1a2235] px-4 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Final Prediction
                </p>
                <div className="flex flex-wrap items-baseline gap-2">
                  <p
                    className="font-bold tabular-nums leading-none"
                    style={{ fontSize: "4rem", color: FINAL_BLUE }}
                  >
                    {avgRounded}%
                  </p>
                  <span className="text-sm font-medium text-slate-400">{averageLabel}</span>
                </div>
                <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${barWidth}%`,
                      backgroundColor: FINAL_BLUE,
                    }}
                  />
                </div>
                <p className="mt-4 text-xs text-slate-400">Based on 6 AI forecasters</p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div ref={bottomRef} />
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-[#0a0f1e]/98 backdrop-blur-md">
        <div className="relative mx-auto max-w-3xl overflow-visible">
          <div className="px-3 py-3 sm:px-4">
            <div className="relative mb-2">
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={`Ask anything predictable — e.g. 
'Will this business idea succeed within 3 years?' 
OR 'What's the chance AI replaces most jobs by 2030?'
OR 'How likely is it that I get this job if I apply?'`}
                disabled={sending}
                className="min-h-[100px] w-full resize-y rounded-xl border border-white/12 bg-white/6 px-3 py-2.5 pb-12 pr-24 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={
                  sending ||
                  !topic.trim() ||
                  (credits !== null && fixedCost !== null && credits < fixedCost)
                }
                className="absolute bottom-2 right-2 z-10 shrink-0 rounded-2xl bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 transition enabled:hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            </div>
            <p className="text-left text-[11px] tabular-nums text-slate-500">
              All 6 AIs · {fixedCost ?? "—"} credits
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
