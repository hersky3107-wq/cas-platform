"use client";

import Link from "next/link";
import ShareButtons from "@/components/ShareButtons";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { ChevronLeft, SlidersHorizontal } from "lucide-react";
import { supabase } from "@/lib/db/supabase";
import { creditsForPanelScore } from "@/lib/credits";
import type { AiProviderName, RouterResult } from "@/lib/ai/router";
import {
  VERDICT_SCORE_AI_ORDER,
  parseVerdictScoreResponse,
} from "@/lib/verdict-score";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

const GEMINI_LETTER_COLORS = [
  "#4285F4",
  "#EA4335",
  "#FBBC05",
  "#34A853",
  "#4285F4",
  "#EA4335",
] as const;

const CARD_STAGGER_MS = 300;
const OLYMPIC_PANEL_DELAY_MS = 2000;

const PROVIDER_SCORE_COLOR: Record<AiProviderName, string> = {
  openai: "#10A37F",
  anthropic: "#D97757",
  google: "#4285F4",
  xai: "#718096",
  deepseek: "#4D6BFE",
  mistral: "#FF7000",
};

function stripMarkdownFormatting(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n");
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/\*\*([^*]*)\*\*/g, "$1");
  t = t.replace(/__(.+?)__/g, "$1");
  t = t.replace(/\*(.+?)\*/g, "$1");
  t = t.replace(/_(.+?)_/g, "$1");
  t = t.replace(/^\s*[-*+]\s+/gm, "");
  t = t.replace(/^\s*\d+\.\s+/gm, "");
  t = t.replace(/\*\*/g, "");
  t = t.replace(/\*/g, "");
  t = t.replace(/^-\s*/gm, "");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

type ScoreRow = {
  provider: AiProviderName;
  text: string | null;
  ms: number;
  error?: string;
  score: number | null;
  review: string;
  isHighest?: boolean;
  isLowest?: boolean;
};

type OlympicPayload = {
  finalAverage: number | null;
  highestProvider: AiProviderName | null;
  lowestProvider: AiProviderName | null;
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

function ScoreJudgeCard({
  provider,
  score,
  review,
  ms,
  error,
  isHighest,
  isLowest,
  showOlympicStyle,
}: {
  provider: AiProviderName;
  score: number | null;
  review: string;
  ms: number;
  error?: string;
  isHighest?: boolean;
  isLowest?: boolean;
  showOlympicStyle: boolean;
}) {
  const dimmed = showOlympicStyle && (isHighest || isLowest);
  return (
    <div
      className={`flex w-full max-w-[85%] flex-col items-start gap-2 transition-opacity duration-300 ${
        dimmed ? "opacity-50" : "opacity-100"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <AiNameBadge provider={provider} />
        {showOlympicStyle && isHighest ? (
          <span className="rounded-full bg-[#F59E0B] px-2 py-0.5 text-[10px] font-semibold text-black">
            ⭐ Top Score
          </span>
        ) : null}
        {showOlympicStyle && isLowest ? (
          <span className="rounded-full bg-[#EF4444] px-2 py-0.5 text-[10px] font-semibold text-white">
            📉 Excluded
          </span>
        ) : null}
      </div>
      <div className="w-full rounded-2xl bg-white/[0.09] px-3.5 py-3 text-slate-100">
        {error ? (
          <p className="text-sm text-rose-300/95">{error}</p>
        ) : (
          <>
            <p
              className="font-bold tabular-nums leading-none text-white"
              style={{
                fontSize: "3rem",
                color: score != null ? PROVIDER_SCORE_COLOR[provider] : undefined,
              }}
            >
              {score != null ? score : "—"}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
              {review || "—"}
            </p>
          </>
        )}
        <div className="mt-2 text-right text-[10px] tabular-nums text-slate-500">{ms} ms</div>
      </div>
    </div>
  );
}

function StaggeredScoreCard({
  anchorMs,
  staggerIndex,
  ...props
}: {
  anchorMs: number | undefined;
  staggerIndex: number;
} & ComponentProps<typeof ScoreJudgeCard>) {
  const [show, setShow] = useState(() => staggerShouldBeVisible(anchorMs, staggerIndex));

  useEffect(() => {
    if (anchorMs == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- stagger visibility matches Compare mode
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
  return <ScoreJudgeCard {...props} />;
}

export default function VerdictScorePage() {
  const router = useRouter();
  const [credits, setCredits] = useState<number | null>(null);
  const [criteria, setCriteria] = useState("");
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [content, setContent] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responses, setResponses] = useState<ScoreRow[]>([]);
  const [streamAnchorMs, setStreamAnchorMs] = useState<number | undefined>(undefined);
  const [olympic, setOlympic] = useState<OlympicPayload | null>(null);
  const [showOlympicStyle, setShowOlympicStyle] = useState(false);
  const [olympicPanelOpen, setOlympicPanelOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const olympicTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstResultRef = useRef(true);

  const fixedCost = useMemo(() => {
    try {
      return creditsForPanelScore();
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
  }, [responses, sending, olympicPanelOpen]);

  useEffect(() => {
    return () => {
      if (olympicTimerRef.current != null) clearTimeout(olympicTimerRef.current);
    };
  }, []);

  const resetRound = useCallback(() => {
    if (olympicTimerRef.current != null) {
      clearTimeout(olympicTimerRef.current);
      olympicTimerRef.current = null;
    }
    setSessionId(null);
    setResponses([]);
    setStreamAnchorMs(undefined);
    setOlympic(null);
    setShowOlympicStyle(false);
    setOlympicPanelOpen(false);
    setCriteria("");
    setContent("");
    firstResultRef.current = true;
  }, []);

  const send = useCallback(async () => {
    const body = content.trim();
    if (!body || sending) return;

    setError(null);
    setSending(true);
    setOlympic(null);
    setShowOlympicStyle(false);
    setOlympicPanelOpen(false);
    setResponses([]);
    setStreamAnchorMs(undefined);
    firstResultRef.current = true;
    if (olympicTimerRef.current != null) {
      clearTimeout(olympicTimerRef.current);
      olympicTimerRef.current = null;
    }

    try {
      const res = await fetch("/api/ai-verdict-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentToScore: body,
          scoringCriteria: criteria,
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
          r.text != null && !r.error ? stripMarkdownFormatting(r.text) : r.text;
        const { score, review } = parseVerdictScoreResponse(plain);
        if (firstResultRef.current) {
          firstResultRef.current = false;
          setStreamAnchorMs(Date.now());
        }
        setResponses((prev) => [
          ...prev,
          {
            provider: r.provider,
            text: plain,
            ms: r.responseTimeMs,
            error: r.error,
            score,
            review: review || "",
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
            finalAverage?: number | null;
            highestProvider?: AiProviderName | null;
            lowestProvider?: AiProviderName | null;
            judges?: {
              provider: AiProviderName;
              score: number | null;
              review: string;
              isHighest: boolean;
              isLowest: boolean;
            }[];
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
          if (msg.type === "verdict_olympic" && msg.judges) {
            setOlympic({
              finalAverage: msg.finalAverage ?? null,
              highestProvider: msg.highestProvider ?? null,
              lowestProvider: msg.lowestProvider ?? null,
            });
            setResponses((prev) =>
              prev.map((row) => {
                const j = msg.judges!.find((x) => x.provider === row.provider);
                if (!j) return row;
                return {
                  ...row,
                  score: j.score ?? row.score,
                  review: j.review || row.review,
                  isHighest: j.isHighest,
                  isLowest: j.isLowest,
                };
              })
            );
            setShowOlympicStyle(true);
            olympicTimerRef.current = setTimeout(() => {
              setOlympicPanelOpen(true);
              olympicTimerRef.current = null;
            }, OLYMPIC_PANEL_DELAY_MS);
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
  }, [content, criteria, sending, sessionId, router]);

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
            New score
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-3 pb-72 pt-16 sm:px-4">
        <h1 className="mb-3 text-center text-xl font-bold leading-snug text-white sm:text-2xl">
          Rate anything. Let 6 AIs judge.
        </h1>
        <p className="mx-auto mb-8 max-w-2xl text-center text-xs text-slate-400 sm:text-sm">
          Every AI scores independently. The outliers get cut. The truth remains.
        </p>
        <p className="mx-auto -mt-6 mb-8 max-w-2xl text-center text-[10px] opacity-50 text-slate-400 sm:text-xs">
          📎 Image & document scoring — coming in Score v2
        </p>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {responses.length > 0 ? (
          <div className="mb-6 flex flex-col gap-3">
            <div className="flex justify-end">
              <div className="max-w-[90%] space-y-2 rounded-2xl bg-[#3d4451] px-3.5 py-2.5 text-sm leading-relaxed text-white">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  Scoring criteria
                </p>
                <p>{criteria.trim() || "(none — overall evaluation)"}</p>
                <p className="mt-2 text-[11px] uppercase tracking-wide text-slate-400">
                  What we scored
                </p>
                <p className="max-h-40 overflow-y-auto whitespace-pre-wrap">{content}</p>
              </div>
            </div>
            <div className="flex flex-col items-start gap-4">
              {responses.map((r, idx) => (
                <StaggeredScoreCard
                  key={`${r.provider}-${idx}`}
                  anchorMs={streamAnchorMs}
                  staggerIndex={idx}
                  provider={r.provider}
                  score={r.score}
                  review={r.review}
                  ms={r.ms}
                  error={r.error}
                  isHighest={r.isHighest}
                  isLowest={r.isLowest}
                  showOlympicStyle={showOlympicStyle}
                />
              ))}
            </div>
            {olympicPanelOpen &&
            olympic != null &&
            typeof olympic.finalAverage === "number" ? (
              <div className="mt-8 w-full rounded-2xl border border-white/10 bg-[#1a2235] px-4 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Final Score
                </p>
                <p
                  className="font-bold tabular-nums text-[#F59E0B]"
                  style={{ fontSize: "4rem", lineHeight: 1 }}
                >
                  {olympic.finalAverage.toFixed(1)}
                </p>
                <p className="mt-2 text-sm text-slate-400">
                  Based on 4 of 6 AI judges (outliers removed)
                </p>
              </div>
            ) : null}
            {olympicPanelOpen &&
            olympic != null &&
            typeof olympic.finalAverage === "number" ? (
              <ShareButtons modeName="PANEL Score" className="mt-6" />
            ) : null}
          </div>
        ) : null}

        <div ref={bottomRef} />
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-[#0a0f1e]/98 backdrop-blur-md">
        <div className="relative mx-auto max-w-3xl overflow-visible">
          <div className="px-3 py-3 sm:px-4">
            <div className="mb-3">
              <div className="group relative">
                <button
                  type="button"
                  onClick={() => setCriteriaOpen((o) => !o)}
                  disabled={sending}
                  aria-expanded={criteriaOpen}
                  className="inline-flex w-full items-center gap-2 rounded-xl border border-white/12 bg-white/6 px-3 py-2.5 text-left text-xs font-medium text-slate-300 transition hover:bg-white/10 disabled:opacity-40"
                >
                  <SlidersHorizontal className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <span>Scoring criteria (optional)</span>
                </button>
                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-0 right-0 z-50 mb-2 rounded-lg border border-white/10 bg-[#1a2235] px-3 py-2 text-left text-[0.7rem] leading-snug text-slate-400 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
                >
                  The highest and lowest AI scores are removed — the final score is the average of
                  the remaining 4.
                </div>
              </div>
              {criteriaOpen ? (
                <input
                  type="text"
                  value={criteria}
                  onChange={(e) => setCriteria(e.target.value)}
                  placeholder="e.g. Persuasiveness / Feasibility / Creativity — leave blank for overall evaluation"
                  disabled={sending}
                  className="mt-2 w-full rounded-xl border border-white/12 bg-white/6 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
                />
              ) : null}
            </div>
            <div className="relative mb-2">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={`Paste your text — a paragraph, an essay, a pitch, a plan,
an idea, a thought. Up to one A4 page works best.`}
                disabled={sending}
                className="min-h-[120px] w-full resize-y rounded-xl border border-white/12 bg-white/6 px-3 py-2.5 pb-12 pr-24 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={
                  sending ||
                  !content.trim() ||
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
