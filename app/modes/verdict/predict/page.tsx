"use client";

import Link from "next/link";
import HelpModal from "@/components/HelpModal";
import ShareButtons from "@/components/ShareButtons";
import { verdictPredictHelpContent } from "@/lib/help-modal/verdict-predict-content";
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
import { ModuleCreditsLink } from "@/components/credits/ModuleCreditsLink";
import DisclaimerText from "@/components/ui/DisclaimerText";
import { supabase } from "@/lib/db/supabase";
import { creditsForPanelPredict } from "@/lib/credits";
import type { AiProviderName, RouterResult } from "@/lib/ai/router";
import { authenticatedFetch } from "@/lib/api/authenticated-fetch";
import { PUBLIC_SHARE_BASE, type PanelSessionResponse } from "@/lib/panel/session-types";
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

function aiNameForProvider(provider: AiProviderName): string {
  if (provider === "openai") return "ChatGPT";
  if (provider === "anthropic") return "Claude";
  if (provider === "google") return "Gemini";
  if (provider === "xai") return "Grok";
  if (provider === "deepseek") return "DeepSeek";
  return "Mistral";
}

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
  const [panelSessionId, setPanelSessionId] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [savingSession, setSavingSession] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [goPublicLoading, setGoPublicLoading] = useState(false);
  const [goPublicDone, setGoPublicDone] = useState(false);
  const [goPublicError, setGoPublicError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const finalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstResultRef = useRef(true);

  const fixedCost = useMemo(() => {
    try {
      return creditsForPanelPredict();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/credits/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await res.json().catch(() => null)) as { balance?: number };
      if (typeof j?.balance === "number") setCredits(j.balance);
    })();
  }, []);

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
      const res = await fetch("/api/ai-verdict-predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          predictionTopic: body,
          sessionId,
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

  const avgRounded = average != null ? Math.round(average) : null;
  const barWidth = avgRounded != null ? Math.min(100, Math.max(0, avgRounded)) : 0;

  const savePanelSession = useCallback(async () => {
    if (panelSessionId || shareId) return;
    const q = topic.trim();
    if (!q) return;
    if (responses.length < 1) return;
    setSavingSession(true);
    setSaveFailed(false);
    try {
      const payloadResponses: PanelSessionResponse[] = responses.map((r) => ({
        ai_name: aiNameForProvider(r.provider),
        content: r.error
          ? null
          : `${typeof r.probability === "number" ? `${r.probability}%` : "—"}\n\n${r.reasoning || ""}`.trim() ||
            null,
      }));

      const res = await authenticatedFetch("/api/panel/save-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          panel_type: "predict",
          question: q,
          responses: payloadResponses,
        }),
      });
      const j = (await res.json().catch(() => null)) as
        | { id?: string; share_id?: string; error?: string }
        | null;
      if (!res.ok) {
        setSaveFailed(true);
        console.log("[panel/predict] save-session error:", j?.error ?? res.status);
        return;
      }
      if (typeof j?.id === "string") setPanelSessionId(j.id);
      if (typeof j?.share_id === "string") setShareId(j.share_id);
    } catch (e: unknown) {
      console.log("[panel/predict] save-session error:", e instanceof Error ? e.message : e);
      setSaveFailed(true);
    } finally {
      setSavingSession(false);
    }
  }, [panelSessionId, shareId, topic, responses]);

  useEffect(() => {
    if (!finalPanelOpen || average == null) return;
    if (panelSessionId || shareId || savingSession) return;
    void savePanelSession();
  }, [finalPanelOpen, average, panelSessionId, shareId, savingSession, savePanelSession]);

  const handleGoPublic = useCallback(async () => {
    if (!panelSessionId) return;
    setGoPublicError(null);
    setGoPublicLoading(true);
    try {
      const res = await authenticatedFetch("/api/panel/go-public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: panelSessionId }),
      });
      const j = (await res.json().catch(() => null)) as { share_id?: string; error?: string } | null;
      if (!res.ok) {
        setGoPublicError(typeof j?.error === "string" ? j.error : "Could not publish session");
        return;
      }
      setGoPublicDone(true);
      if (typeof j?.share_id === "string") setShareId(j.share_id);
    } catch (e: unknown) {
      setGoPublicError(e instanceof Error ? e.message : "Could not publish session");
    } finally {
      setGoPublicLoading(false);
    }
  }, [panelSessionId]);

  return (
    <div className={BG}>
      <HelpModal content={verdictPredictHelpContent} />
      <header className="fixed left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#0a0f1e]/95 px-3 py-2.5 backdrop-blur-md sm:px-4">
        <Link
          href="/modes/verdict"
          className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-2 text-sm text-white/90 transition hover:bg-white/14"
        >
          <ChevronLeft className="h-4 w-4" />
          Panel
        </Link>
        <ModuleCreditsLink />
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
            {finalPanelOpen && average != null ? (
              <>
                {shareId ? (
                  <ShareButtons
                    modeName="PANEL Predict"
                    className="mt-4"
                    url={`${PUBLIC_SHARE_BASE}/${shareId}`}
                  />
                ) : (
                  <p className="mt-4 text-xs text-slate-500">
                    {saveFailed ? "Could not save session for sharing." : "Saving session…"}
                  </p>
                )}

                <div className="mt-4 rounded-xl border border-white/12 bg-[#1a2438]/90 p-3">
                  {saveFailed ? (
                    <p className="text-sm text-slate-400">Could not save session</p>
                  ) : goPublicDone ? (
                    <div className="text-sm">
                      <p className="font-medium text-slate-200">✅ Indexed!</p>
                      <p className="mt-1 text-slate-400">aimani.ai/share/{shareId}</p>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-bold text-white">
                        <span className="mr-1.5" aria-hidden>
                          🔍
                        </span>
                        Put this on Google
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">
                        Let search engines find this session · No personal info shared
                      </p>
                      <div className="mt-4">
                        <button
                          type="button"
                          onClick={() => void handleGoPublic()}
                          disabled={goPublicLoading || !panelSessionId}
                          className="inline-flex items-center justify-center rounded-full bg-cyan-500 px-4 py-1.5 text-sm font-semibold text-slate-950 shadow-[0_0_20px_rgba(34,211,238,0.25)] transition hover:bg-cyan-400 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {goPublicLoading ? "Publishing…" : "Go Public"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
                {goPublicError ? (
                  <p className="mt-2 text-xs text-amber-300/90">{goPublicError}</p>
                ) : null}
              </>
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
            <DisclaimerText />
          </div>
        </div>
      </div>
    </div>
  );
}
