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
  AI_PROVIDER_LABEL,
  VERDICT_VOTE_AI_ORDER,
  parseVerdictVoteResponse,
  stripMarkdownFormattingForVote,
  type VerdictVote,
} from "@/lib/verdict-vote";

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

const YES_COLOR = "#22C55E";
const NO_COLOR = "#EF4444";
const TIE_COLOR = "#F59E0B";

type Phase = "input" | "vote" | "streaming" | "done";

type UserPick = "yes" | "no" | "skip";

type VoteRow = {
  provider: AiProviderName;
  ms: number;
  error?: string;
  verdict: VerdictVote;
  reason: string;
};

type FinalPayload = {
  userVote: UserPick;
  aiYes: string[];
  aiNo: string[];
  yesNamesWithUser: string[];
  noNamesWithUser: string[];
  outcome: "yes" | "no" | "tie";
  yesTotal: number;
  noTotal: number;
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

function VoteJudgeCard({
  provider,
  ms,
  error,
  verdict,
  reason,
}: {
  provider: AiProviderName;
  ms: number;
  error?: string;
  verdict: VerdictVote;
  reason: string;
}) {
  const emoji = verdict === "yes" ? "👍" : verdict === "no" ? "👎" : "❔";
  const color = verdict === "yes" ? YES_COLOR : verdict === "no" ? NO_COLOR : "#94a3b8";
  return (
    <div className="flex w-full max-w-[85%] flex-col items-start gap-2">
      <AiNameBadge provider={provider} />
      <div className="w-full rounded-2xl bg-white/[0.09] px-3.5 py-3 text-slate-100">
        {error ? (
          <p className="text-sm text-rose-300/95">{error}</p>
        ) : (
          <>
            <p
              className="font-bold leading-none"
              style={{ fontSize: "3rem", color }}
              aria-hidden
            >
              {emoji}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
              {reason || "—"}
            </p>
          </>
        )}
        <div className="mt-2 text-right text-[10px] tabular-nums text-slate-500">{ms} ms</div>
      </div>
    </div>
  );
}

function StaggeredVoteCard({
  anchorMs,
  staggerIndex,
  ...props
}: {
  anchorMs: number | undefined;
  staggerIndex: number;
} & ComponentProps<typeof VoteJudgeCard>) {
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
  return <VoteJudgeCard {...props} />;
}

export default function VerdictVotePage() {
  const router = useRouter();
  const [credits, setCredits] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responses, setResponses] = useState<VoteRow[]>([]);
  const [streamAnchorMs, setStreamAnchorMs] = useState<number | undefined>(undefined);
  const [finalPayload, setFinalPayload] = useState<FinalPayload | null>(null);
  const [finalPanelOpen, setFinalPanelOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const finalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstResultRef = useRef(true);

  const fixedCost = useMemo(() => {
    try {
      return creditsPerMessage(VERDICT_VOTE_AI_ORDER.length);
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
  }, [responses, sending, phase, finalPanelOpen]);

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
    setQuestion("");
    setPhase("input");
    setResponses([]);
    setStreamAnchorMs(undefined);
    setFinalPayload(null);
    setFinalPanelOpen(false);
    firstResultRef.current = true;
  }, []);

  const goToVoteStep = useCallback(() => {
    const q = question.trim();
    if (!q) return;
    setError(null);
    setPhase("vote");
  }, [question]);

  const runWithUserVote = useCallback(
    async (pick: UserPick) => {
      const q = question.trim();
      if (!q || sending) return;

      setError(null);
      setSending(true);
      setPhase("streaming");
      setResponses([]);
      setStreamAnchorMs(undefined);
      setFinalPayload(null);
      setFinalPanelOpen(false);
      firstResultRef.current = true;
      if (finalTimerRef.current != null) {
        clearTimeout(finalTimerRef.current);
        finalTimerRef.current = null;
      }

      try {
        const res = await fetch("/api/ai-verdict-vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: q,
            userVote: pick,
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
          setPhase("vote");
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setError("No response body");
          setPhase("vote");
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        const applyResult = (r: RouterResult) => {
          const plain =
            r.text != null && !r.error ? stripMarkdownFormattingForVote(r.text) : r.text;
          const { verdict, reason } = parseVerdictVoteResponse(plain);
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
              reason: reason || "",
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
              userVote?: UserPick;
              aiYes?: string[];
              aiNo?: string[];
              yesNamesWithUser?: string[];
              noNamesWithUser?: string[];
              outcome?: "yes" | "no" | "tie";
              yesTotal?: number;
              noTotal?: number;
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
            if (msg.type === "verdict_vote_final") {
              setFinalPayload({
                userVote: (msg.userVote as UserPick) ?? "skip",
                aiYes: msg.aiYes ?? [],
                aiNo: msg.aiNo ?? [],
                yesNamesWithUser: msg.yesNamesWithUser ?? [],
                noNamesWithUser: msg.noNamesWithUser ?? [],
                outcome: msg.outcome ?? "tie",
                yesTotal: msg.yesTotal ?? 0,
                noTotal: msg.noTotal ?? 0,
              });
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
        setPhase("done");
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error");
        setPhase("vote");
      } finally {
        setSending(false);
      }
    },
    [question, sending, sessionId, router]
  );

  const showResultsBlock = phase === "streaming" || phase === "done";
  const showVoteBlock = phase === "vote" || showResultsBlock;

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
            New vote
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-3 pb-72 pt-16 sm:px-4">
        <h1 className="mb-3 text-center text-xl font-bold leading-snug text-white sm:text-2xl">
          Yes or No. Let 6 AIs decide.
        </h1>
        <p className="mx-auto mb-8 max-w-2xl text-center text-xs text-slate-400 sm:text-sm">
          Cast your vote first — then see what the AIs think.
        </p>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {showVoteBlock ? (
          <div className="mb-6 flex flex-col gap-4">
            <div className="flex justify-end">
              <div className="max-w-[90%] rounded-2xl bg-[#3d4451] px-3.5 py-2.5 text-sm leading-relaxed text-white">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Question</p>
                <p className="whitespace-pre-wrap">{question.trim()}</p>
              </div>
            </div>

            {phase === "vote" && !sending ? (
              <div className="flex flex-col gap-3">
                <p className="text-center text-xs text-slate-400">
                  Vote before you see what the AIs think
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => void runWithUserVote("yes")}
                    className="rounded-2xl border-2 border-[#22C55E]/50 bg-[#22C55E]/15 px-4 py-6 text-lg font-semibold text-[#22C55E] transition hover:bg-[#22C55E]/25"
                  >
                    👍 Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => void runWithUserVote("no")}
                    className="rounded-2xl border-2 border-[#EF4444]/50 bg-[#EF4444]/15 px-4 py-6 text-lg font-semibold text-[#EF4444] transition hover:bg-[#EF4444]/25"
                  >
                    👎 No
                  </button>
                  <button
                    type="button"
                    onClick={() => void runWithUserVote("skip")}
                    className="rounded-2xl border-2 border-white/20 bg-white/6 px-4 py-6 text-lg font-semibold text-slate-300 transition hover:bg-white/10"
                  >
                    — Skip
                  </button>
                </div>
              </div>
            ) : null}

            {sending && phase === "streaming" ? (
              <p className="text-center text-sm text-slate-400">Calling 6 AIs…</p>
            ) : null}

            {responses.length > 0 ? (
              <div className="flex flex-col items-start gap-4">
                {responses.map((r, idx) => (
                  <StaggeredVoteCard
                    key={`${r.provider}-${idx}`}
                    anchorMs={streamAnchorMs}
                    staggerIndex={idx}
                    provider={r.provider}
                    ms={r.ms}
                    error={r.error}
                    verdict={r.verdict}
                    reason={r.reason}
                  />
                ))}
              </div>
            ) : null}

            {finalPanelOpen && finalPayload != null ? (
              <div className="mt-8 w-full rounded-2xl border border-white/10 bg-[#1a2235] px-4 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Final Panel
                </p>
                <p className="mb-2 text-sm text-slate-300">
                  <span style={{ color: YES_COLOR }}>👍 {finalPayload.yesTotal} votes</span>
                  {" — "}
                  {finalPayload.yesNamesWithUser.length > 0
                    ? finalPayload.yesNamesWithUser.join(", ")
                    : "—"}
                </p>
                <p className="mb-4 text-sm text-slate-300">
                  <span style={{ color: NO_COLOR }}>👎 {finalPayload.noTotal} votes</span>
                  {" — "}
                  {finalPayload.noNamesWithUser.length > 0
                    ? finalPayload.noNamesWithUser.join(", ")
                    : "—"}
                </p>
                {finalPayload.outcome === "tie" ? (
                  <div className="text-center">
                    <p className="text-5xl font-bold leading-none" style={{ color: TIE_COLOR }}>
                      ⚖️
                    </p>
                    <p className="mt-2 text-lg font-semibold" style={{ color: TIE_COLOR }}>
                      Divided
                    </p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p
                      className="text-5xl font-bold leading-none"
                      style={{
                        color: finalPayload.outcome === "yes" ? YES_COLOR : NO_COLOR,
                      }}
                    >
                      {finalPayload.outcome === "yes" ? "👍" : "👎"}
                    </p>
                  </div>
                )}
              </div>
            ) : null}
            {finalPanelOpen && finalPayload != null ? (
              <ShareButtons modeName="PANEL Vote" className="mt-4" />
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
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={`Ask anything that has a Yes or No answer.
e.g., Is remote work better than office work? 
OR Should I quit my job and start a business?`}
                disabled={sending}
                className="min-h-[100px] w-full resize-y rounded-xl border border-white/12 bg-white/6 px-3 py-2.5 pb-12 pr-24 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => goToVoteStep()}
                disabled={
                  sending ||
                  !question.trim() ||
                  phase !== "input" ||
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
