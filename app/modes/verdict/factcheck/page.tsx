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
import { ChevronLeft } from "lucide-react";
import { supabase } from "@/lib/db/supabase";
import { creditsPerMessage } from "@/lib/credits";
import type { AiProviderName, RouterResult } from "@/lib/ai/router";
import {
  VERDICT_FACTCHECK_AI_ORDER,
  FACT_VERDICT_DISPLAY,
  FACT_VERDICT_ORDER,
  parseVerdictFactcheckResponse,
  stripMarkdownFormattingForFactcheck,
  type FactVerdict,
} from "@/lib/verdict-factcheck";

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
const FINAL_PANEL_DELAY_MS = 2000;

type FactRow = {
  provider: AiProviderName;
  ms: number;
  error?: string;
  verdict: FactVerdict;
  evidence: string;
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

function FactJudgeCard({
  provider,
  ms,
  error,
  verdict,
  evidence,
}: {
  provider: AiProviderName;
  ms: number;
  error?: string;
  verdict: FactVerdict;
  evidence: string;
}) {
  const meta = FACT_VERDICT_DISPLAY[verdict];
  return (
    <div className="flex w-full max-w-[85%] flex-col items-start gap-2">
      <AiNameBadge provider={provider} />
      <div className="w-full rounded-2xl bg-white/[0.09] px-3.5 py-3 text-slate-100">
        {error ? (
          <p className="text-sm text-rose-300/95">{error}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-3xl leading-none" aria-hidden>
                {meta.icon}
              </span>
              <p
                className="font-extrabold uppercase tracking-wide leading-none"
                style={{ fontSize: "1.75rem", color: meta.color }}
              >
                {meta.label}
              </p>
            </div>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Evidence
            </p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
              {evidence || "—"}
            </p>
          </>
        )}
        <div className="mt-2 text-right text-[10px] tabular-nums text-slate-500">{ms} ms</div>
      </div>
    </div>
  );
}

function StaggeredFactCard({
  anchorMs,
  staggerIndex,
  ...props
}: {
  anchorMs: number | undefined;
  staggerIndex: number;
} & ComponentProps<typeof FactJudgeCard>) {
  const [show, setShow] = useState(() => staggerShouldBeVisible(anchorMs, staggerIndex));

  useEffect(() => {
    if (anchorMs == null) {
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
  return <FactJudgeCard {...props} />;
}

function formatBreakdown(counts: Record<FactVerdict, number>): string {
  return FACT_VERDICT_ORDER.map((k) => `${FACT_VERDICT_DISPLAY[k].label}: ${counts[k]}`).join("  ");
}

export default function VerdictFactcheckPage() {
  const router = useRouter();
  const [credits, setCredits] = useState<number | null>(null);
  const [claim, setClaim] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responses, setResponses] = useState<FactRow[]>([]);
  const [streamAnchorMs, setStreamAnchorMs] = useState<number | undefined>(undefined);
  const [finalPanelOpen, setFinalPanelOpen] = useState(false);
  const [finalCounts, setFinalCounts] = useState<Record<FactVerdict, number> | null>(null);
  const [finalWinner, setFinalWinner] = useState<FactVerdict | null>(null);
  const [finalDivided, setFinalDivided] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const finalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstResultRef = useRef(true);

  const fixedCost = useMemo(() => {
    try {
      return creditsPerMessage(VERDICT_FACTCHECK_AI_ORDER.length);
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
    setClaim("");
    setResponses([]);
    setStreamAnchorMs(undefined);
    setFinalPanelOpen(false);
    setFinalCounts(null);
    setFinalWinner(null);
    setFinalDivided(false);
    firstResultRef.current = true;
  }, []);

  const send = useCallback(async () => {
    const body = claim.trim();
    if (!body || sending) return;

    setError(null);
    setSending(true);
    setResponses([]);
    setStreamAnchorMs(undefined);
    setFinalPanelOpen(false);
    setFinalCounts(null);
    setFinalWinner(null);
    setFinalDivided(false);
    firstResultRef.current = true;
    if (finalTimerRef.current != null) {
      clearTimeout(finalTimerRef.current);
      finalTimerRef.current = null;
    }

    try {
      const res = await fetch("/api/ai-verdict-factcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim: body,
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
          r.text != null && !r.error ? stripMarkdownFormattingForFactcheck(r.text) : r.text;
        let verdict: FactVerdict = "uncertain";
        let evidence = "";
        if (plain != null && !r.error) {
          const parsed = parseVerdictFactcheckResponse(plain);
          verdict = parsed.verdict ?? "uncertain";
          evidence = parsed.evidence || "";
        }
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
            verdict,
            evidence,
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
            counts?: Record<FactVerdict, number>;
            winner?: FactVerdict | null;
            divided?: boolean;
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
          if (msg.type === "verdict_factcheck_final" && msg.counts) {
            setFinalCounts(msg.counts);
            setFinalDivided(Boolean(msg.divided));
            setFinalWinner(msg.divided ? null : (msg.winner ?? null));
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
  }, [claim, sending, sessionId, router]);

  const winnerMeta =
    finalWinner != null && !finalDivided ? FACT_VERDICT_DISPLAY[finalWinner] : null;

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
            New check
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-3 pb-72 pt-16 sm:px-4">
        <h1 className="mb-3 text-center text-xl font-bold leading-snug text-white sm:text-2xl">
          True or False? Let 6 AIs investigate.
        </h1>
        <p className="mx-auto mb-8 max-w-2xl text-center text-xs text-slate-400 sm:text-sm">
          Every AI fact-checks independently. The verdict is decided by majority.
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
                  Claim to fact-check
                </p>
                <p className="whitespace-pre-wrap">{claim.trim()}</p>
              </div>
            </div>
            <div className="flex flex-col items-start gap-4">
              {responses.map((r, idx) => (
                <StaggeredFactCard
                  key={`${r.provider}-${idx}`}
                  anchorMs={streamAnchorMs}
                  staggerIndex={idx}
                  provider={r.provider}
                  ms={r.ms}
                  error={r.error}
                  verdict={r.verdict}
                  evidence={r.evidence}
                />
              ))}
            </div>
            {finalPanelOpen && finalCounts != null ? (
              <div className="mt-8 w-full rounded-2xl border border-white/10 bg-[#1a2235] px-4 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Final Panel
                </p>
                {finalDivided ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-4xl leading-none" aria-hidden>
                      ⚖️
                    </span>
                    <p
                      className="font-extrabold uppercase tracking-wide"
                      style={{ fontSize: "2rem", color: "#6B7280" }}
                    >
                      DIVIDED
                    </p>
                  </div>
                ) : winnerMeta ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-5xl leading-none" aria-hidden>
                      {winnerMeta.icon}
                    </span>
                    <p
                      className="font-extrabold uppercase tracking-wide leading-none"
                      style={{ fontSize: "2.25rem", color: winnerMeta.color }}
                    >
                      {winnerMeta.label}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No majority could be determined.</p>
                )}
                <p className="mt-4 whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
                  {formatBreakdown(finalCounts)}
                </p>
                <p className="mt-4 text-xs text-slate-400">Based on 6 AI fact-checkers</p>
              </div>
            ) : null}
            {finalPanelOpen && finalCounts != null ? (
              <ShareButtons modeName="PANEL Fact Check" className="mt-4" />
            ) : null}
          </div>
        ) : null}

        <div ref={bottomRef} />
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-[#0a0f1e]/98 backdrop-blur-md">
        <div className="relative mx-auto max-w-3xl overflow-visible">
          <div className="px-3 py-3 sm:px-4">
            <div className="mb-3">
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Claim to fact-check
              </label>
              <div className="relative">
                <textarea
                  value={claim}
                  onChange={(e) => setClaim(e.target.value)}
                  placeholder={`Paste any claim, headline, or statement to fact-check.
e.g. 'Finland has the highest coffee consumption per capita in the world'
OR 'The Great Wall of China is visible from space'
OR 'Drinking coffee causes cancer according to WHO'`}
                  disabled={sending}
                  className="min-h-[100px] w-full resize-y rounded-xl border border-white/12 bg-white/6 px-3 py-2.5 pb-12 pr-24 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={
                    sending ||
                    !claim.trim() ||
                    (credits !== null && fixedCost !== null && credits < fixedCost)
                  }
                  className="absolute bottom-2 right-2 z-10 shrink-0 rounded-2xl bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 transition enabled:hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Send
                </button>
              </div>
            </div>

            <p className="mb-2 text-left text-[0.7rem] text-slate-500">
              ⚠️ Based on AI training data — may not reflect the latest news or events.
            </p>
            <p className="text-left text-[11px] tabular-nums text-slate-500">
              All 6 AIs · {fixedCost ?? "—"} credits
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
