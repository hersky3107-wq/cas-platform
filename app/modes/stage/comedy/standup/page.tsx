"use client";

import Link from "next/link";
import { CompareSessionEndPanel } from "@/app/modes/compare/CompareSessionEndPanel";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { AiProviderName } from "@/lib/ai/router";
import { authenticatedFetch } from "@/lib/api/authenticated-fetch";
import { PUBLIC_SHARE_BASE } from "@/lib/compare/session-types";
import type { ComedySessionResponse } from "@/lib/comedy/session-types";
import { creditsForComedyStandup } from "@/lib/credits";

const STANDUP_COST = creditsForComedyStandup();

const BG = "min-h-screen bg-[#0a0f1e] text-white";

const AI_ORDER: AiProviderName[] = ["openai", "anthropic", "google", "xai", "deepseek", "mistral"];
const AI_LABEL: Record<AiProviderName, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
  xai: "Grok",
  deepseek: "DeepSeek",
  mistral: "Mistral",
};

const GEMINI_LETTER_COLORS = ["#4285F4", "#EA4335", "#FBBC05", "#34A853", "#4285F4", "#EA4335"] as const;

const AI_ACCENT: Record<AiProviderName, string> = {
  openai: "#10A37F",
  anthropic: "#D97757",
  google: "#4285F4",
  xai: "#718096",
  deepseek: "#4D6BFE",
  mistral: "#FF7000",
};

const BEST_ANSWER_DELAY_MS = 2000;

type SaveComedySessionResult =
  | { ok: true; id: string; share_id: string }
  | { ok: false; error: string };

function wordsForTypewriter(s: string): string[] {
  if (!s) return [];
  return s.match(/\S+/g) ?? [];
}

function sanitizeAiText(raw: string): string {
  const original = String(raw ?? "").replace(/\r\n/g, "\n");
  const hadReplacement = /[\uFFFD�]/.test(original);
  let t = original.replace(/[\uFFFD�]/g, "").trim();

  // If we detected broken glyphs, show only up to last complete sentence.
  if (hadReplacement) {
    const lastPunct = Math.max(
      t.lastIndexOf("."),
      t.lastIndexOf("!"),
      t.lastIndexOf("?"),
      t.lastIndexOf("。"),
      t.lastIndexOf("！"),
      t.lastIndexOf("？")
    );
    if (lastPunct >= 0) t = t.slice(0, lastPunct + 1).trim();
  }

  return t;
}

function AiNameBadge({ provider }: { provider: AiProviderName }) {
  const base = "inline-flex rounded-lg px-2.5 py-0.5 text-sm font-bold";
  if (provider === "openai") return <span className={`${base} bg-[#0a2540] text-white`}>ChatGPT</span>;
  if (provider === "anthropic") return <span className={`${base} bg-[#F5E6D3] text-[#3d2914]`}>Claude</span>;
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
  if (provider === "xai")
    return <span className={`${base} border border-white bg-black text-white`}>Grok</span>;
  if (provider === "deepseek")
    return <span className={`${base} bg-[#1a1464] text-white`}>DeepSeek</span>;
  return <span className={`${base} bg-[#FF7000] text-white`}>Mistral</span>;
}

function AiChatBubble({
  provider,
  text,
  ms,
}: {
  provider: AiProviderName;
  text: string;
  ms: number;
}) {
  const [displayed, setDisplayed] = useState("");
  const [typingDone, setTypingDone] = useState(false);

  useEffect(() => {
    const full = text ?? "";
    const words = wordsForTypewriter(full);
    setDisplayed("");
    setTypingDone(false);
    if (words.length === 0) {
      setDisplayed(full);
      setTypingDone(true);
      return;
    }
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      if (i >= words.length) {
        setDisplayed(full);
        setTypingDone(true);
        window.clearInterval(id);
        return;
      }
      setDisplayed(words.slice(0, i).join(" "));
    }, 25);
    return () => window.clearInterval(id);
  }, [provider, text]);

  return (
    <div className="flex w-full max-w-[75%] flex-col items-start gap-1">
      <AiNameBadge provider={provider} />
      <div className="w-full rounded-2xl bg-white/[0.09] px-3.5 py-2.5 text-sm leading-relaxed text-slate-100">
        <p className="min-h-[1.25rem] whitespace-pre-wrap">
          {displayed}
          {!typingDone ? (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-slate-400 align-text-bottom" />
          ) : null}
        </p>
        {typingDone ? (
          <div className="mt-2 text-right text-[10px] tabular-nums text-slate-500">{ms} ms</div>
        ) : null}
      </div>
    </div>
  );
}

type Phase = "input" | "perform" | "result";

type StandupSlot = { provider: AiProviderName; standupTurn: 1 | 2 };

type StandupBit = {
  provider: AiProviderName;
  text: string;
  ms: number;
  standupTurn: 1 | 2;
};

function buildStandupResponses(bits: StandupBit[]): ComedySessionResponse[] {
  return bits.map((b) => ({
    ai_name: `${AI_LABEL[b.provider]} (Round ${b.standupTurn})`,
    content: b.text?.trim() ? b.text : null,
  }));
}

export default function StandupPage() {
  const [phase, setPhase] = useState<Phase>("input");
  const [topic, setTopic] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [order, setOrder] = useState<StandupSlot[] | null>(null);
  const [index, setIndex] = useState<number>(-1);
  const [provider, setProvider] = useState<AiProviderName | null>(null);
  const [text, setText] = useState<string>("");
  const [ms, setMs] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"Voting" | "Intermission" | null>(null);
  const [bits, setBits] = useState<StandupBit[]>([]);
  const [revealedCount, setRevealedCount] = useState(0);
  const [scores, setScores] = useState<Record<AiProviderName, number>>(() => ({
    openai: 0,
    anthropic: 0,
    google: 0,
    xai: 0,
    deepseek: 0,
    mistral: 0,
  }));
  const [comedySessionId, setComedySessionId] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [sessionEndPanel, setSessionEndPanel] = useState<{ votedAi: string | null } | null>(
    null
  );
  const [sessionEndVisual, setSessionEndVisual] = useState(false);
  const [sessionEndSaveFailed, setSessionEndSaveFailed] = useState(false);
  const [bestAnswerPanel, setBestAnswerPanel] = useState<{ providers: AiProviderName[] } | null>(
    null
  );
  const [bestAnswerVisual, setBestAnswerVisual] = useState(false);
  const standupVoteScheduledRef = useRef(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const bestAnswerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [phase, provider, text, loading]);

  useEffect(() => {
    return () => {
      if (bestAnswerTimerRef.current != null) clearTimeout(bestAnswerTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!bestAnswerPanel) {
      setBestAnswerVisual(false);
      return;
    }
    setBestAnswerVisual(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setBestAnswerVisual(true));
    });
    return () => cancelAnimationFrame(id);
  }, [bestAnswerPanel]);

  useEffect(() => {
    if (!sessionEndPanel) {
      setSessionEndVisual(false);
      return;
    }
    setSessionEndVisual(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setSessionEndVisual(true));
    });
    return () => cancelAnimationFrame(id);
  }, [sessionEndPanel]);

  const markSessionSaveFailed = useCallback((reason: string) => {
    console.log("[comedy/standup] save-session error:", reason);
    setSessionEndSaveFailed(true);
  }, []);

  const saveStandupSession = useCallback(
    async (question: string, responses: ComedySessionResponse[]): Promise<SaveComedySessionResult> => {
      if (responses.length < 1) return { ok: false, error: "empty responses" };
      try {
        const res = await authenticatedFetch("/api/comedy/save-session", {
          method: "POST",
          json: { comedy_type: "standup", question, responses },
        });
        const j = (await res.json().catch(() => null)) as {
          id?: string;
          share_id?: string;
          error?: string;
        };
        if (!res.ok || !j.id || !j.share_id) {
          const err = j?.error ?? `HTTP ${res.status}`;
          return { ok: false, error: err };
        }
        setComedySessionId(j.id);
        setShareId(j.share_id);
        setSessionEndSaveFailed(false);
        return { ok: true, id: j.id, share_id: j.share_id };
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : "network error" };
      }
    },
    []
  );

  const dismissSessionPanels = useCallback(() => {
    if (bestAnswerTimerRef.current != null) {
      clearTimeout(bestAnswerTimerRef.current);
      bestAnswerTimerRef.current = null;
    }
    setSessionEndPanel(null);
    setSessionEndVisual(false);
    setSessionEndSaveFailed(false);
    setBestAnswerPanel(null);
    setBestAnswerVisual(false);
  }, []);

  const showSessionEndAfterVote = useCallback((votedAi: string | null) => {
    if (bestAnswerTimerRef.current != null) {
      clearTimeout(bestAnswerTimerRef.current);
      bestAnswerTimerRef.current = null;
    }
    setBestAnswerPanel(null);
    setBestAnswerVisual(false);
    setSessionEndSaveFailed(false);
    setSessionEndPanel({ votedAi });
  }, []);

  const submitBestAnswerPick = useCallback(
    async (provider: AiProviderName) => {
      setError(null);
      const votedLabel = AI_LABEL[provider];
      showSessionEndAfterVote(votedLabel);
      try {
        let sessionIdForVote = comedySessionId;
        if (!sessionIdForVote) {
          const saved = await saveStandupSession(topic.trim(), buildStandupResponses(bits));
          if (!saved.ok) markSessionSaveFailed(saved.error);
          else sessionIdForVote = saved.id;
        }
        if (sessionIdForVote) {
          const res = await authenticatedFetch("/api/comedy/save-session", {
            method: "PATCH",
            json: { session_id: sessionIdForVote, voted_ai: votedLabel },
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => null)) as { error?: string };
            setError(j?.error ?? "Could not save vote");
          }
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    },
    [
      comedySessionId,
      showSessionEndAfterVote,
      topic,
      bits,
      saveStandupSession,
      markSessionSaveFailed,
    ]
  );

  const skipBestAnswer = useCallback(() => {
    showSessionEndAfterVote(null);
    if (!comedySessionId) {
      void saveStandupSession(topic.trim(), buildStandupResponses(bits)).then((saved) => {
        if (!saved.ok) markSessionSaveFailed(saved.error);
      });
    }
  }, [showSessionEndAfterVote, comedySessionId, topic, bits, saveStandupSession, markSessionSaveFailed]);

  const resolveShareUrlForShare = useCallback(async (): Promise<string | null> => {
    if (shareId) return `${PUBLIC_SHARE_BASE}/${shareId}`;
    const saved = await saveStandupSession(topic.trim(), buildStandupResponses(bits));
    if (!saved.ok) return null;
    return `${PUBLIC_SHARE_BASE}/${saved.share_id}`;
  }, [shareId, topic, bits, saveStandupSession]);

  const showSessionEndPreparing =
    Boolean(sessionEndPanel) && !(comedySessionId && shareId) && !sessionEndSaveFailed;
  const showSessionEndPanel =
    Boolean(sessionEndPanel) &&
    (Boolean(comedySessionId && shareId) || sessionEndSaveFailed);

  const start = useCallback(async () => {
    const t = topic.trim();
    if (!t || loading) return;
    setError(null);
    setStatus(null);
    dismissSessionPanels();
    setComedySessionId(null);
    setShareId(null);
    standupVoteScheduledRef.current = false;
    setLoading(true);
    try {
      const res = await fetch("/api/stage/comedy/standup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", topic: t }),
      });
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok || !j?.ok) throw new Error(j?.error ?? "Request failed");
      setSessionId(j.sessionId);
      setOrder(j.order);
      setIndex(j.index);
      setProvider(j.provider);
      const cleaned = sanitizeAiText(j.text ?? "");
      setText(cleaned);
      setMs(typeof j.ms === "number" ? j.ms : 0);
      setBits([
        {
          provider: j.provider,
          text: cleaned,
          ms: typeof j.ms === "number" ? j.ms : 0,
          standupTurn: j.standupTurn === 2 ? 2 : 1,
        },
      ]);
      // First AI auto-reveals; reveal button starts from 2nd AI.
      setRevealedCount(1);
      setScores({
        openai: 0,
        anthropic: 0,
        google: 0,
        xai: 0,
        deepseek: 0,
        mistral: 0,
      });
      setPhase("perform");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [loading, topic, dismissSessionPanels]);

  const runRemaining = useCallback(async () => {
    if (!sessionId || !order || loading) return;
    setError(null);
    setLoading(true);
    try {
      let priorSets = bits.map((b) => ({
        provider: b.provider,
        content: b.text,
        standupTurn: b.standupTurn,
      }));
      for (let i = index; i < order.length - 1; i++) {
        setStatus("Intermission");
        const r = await fetch("/api/stage/comedy/standup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "next",
            sessionId,
            topic: topic.trim(),
            order,
            priorSets,
            index: i,
          }),
        });
        const j = (await r.json().catch(() => null)) as any;
        if (!r.ok || !j?.ok) throw new Error(j?.error ?? "Next failed");
        setIndex(j.index);
        setProvider(j.provider);
        const cleaned = sanitizeAiText(j.text ?? "");
        setText(cleaned);
        setMs(typeof j.ms === "number" ? j.ms : 0);
        const entry: StandupBit = {
          provider: j.provider as AiProviderName,
          text: cleaned,
          ms: typeof j.ms === "number" ? j.ms : 0,
          standupTurn: j.standupTurn === 2 ? 2 : 1,
        };
        setBits((prev) => [...prev, entry]);
        priorSets = [
          ...priorSets,
          { provider: entry.provider, content: entry.text, standupTurn: entry.standupTurn },
        ];
      }
      setStatus(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [index, loading, order, sessionId, topic]);

  useEffect(() => {
    if (phase !== "perform") return;
    if (!sessionId || !order) return;
    if (index < 0) return;
    if (index >= order.length - 1) return; // already done
    void runRemaining();
  }, [phase, sessionId, order, index, runRemaining]);

  const winner = useMemo(() => {
    let best: { provider: AiProviderName | null; score: number } = { provider: null, score: -1 };
    for (const p of AI_ORDER) {
      const s = scores[p] ?? 0;
      if (s > best.score) best = { provider: p, score: s };
    }
    return best;
  }, [scores]);

  const actCount = order?.length ?? 0;
  const showVoting =
    phase === "perform" &&
    order &&
    actCount > 0 &&
    index >= actCount - 1 &&
    !loading &&
    revealedCount >= actCount &&
    !sessionEndPanel;

  useEffect(() => {
    if (!showVoting || standupVoteScheduledRef.current) return;
    if (bits.length < 1) return;
    const q = topic.trim();
    if (!q) return;
    standupVoteScheduledRef.current = true;
    void (async () => {
      const saved = await saveStandupSession(q, buildStandupResponses(bits));
      if (!saved.ok) markSessionSaveFailed(saved.error);
      if (bestAnswerTimerRef.current != null) clearTimeout(bestAnswerTimerRef.current);
      bestAnswerTimerRef.current = setTimeout(() => {
        setBestAnswerPanel({ providers: AI_ORDER });
        bestAnswerTimerRef.current = null;
      }, BEST_ANSWER_DELAY_MS);
    })();
  }, [showVoting, bits, topic, saveStandupSession, markSessionSaveFailed]);

  return (
    <div className={BG}>
      <header className="fixed left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#0a0f1e]/95 px-3 py-2.5 backdrop-blur-md sm:px-4">
        <Link
          href="/modes/stage/comedy"
          className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-2 text-sm text-white/90 transition hover:bg-white/14"
        >
          <ChevronLeft className="h-4 w-4" />
          COMEDY
        </Link>
        <span className="rounded-full bg-[#131c35] px-3 py-1.5 text-xs text-slate-200">🎤 STAND-UP</span>
      </header>

      <main className="mx-auto max-w-3xl px-3 pb-40 pt-16 sm:px-4">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/8 text-2xl">
            <span aria-hidden>🎤</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">STAGE — STAND-UP</h1>
          <p className="mt-2 text-sm text-slate-400">2 rounds. All comedians twice (Gemini once). You judge.</p>
          <p className="mt-2">
            <span className="rounded-full border border-cyan-400/25 bg-cyan-950/30 px-3 py-1 text-xs font-medium text-cyan-100">
              {STANDUP_COST} credits
            </span>
          </p>
        </div>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {phase === "input" ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Throw a topic (e.g. Monday morning, late pizza delivery, first blind date...)"
              className="w-full rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void start()}
              disabled={!topic.trim() || loading}
              className="mt-4 w-full rounded-2xl bg-cyan-500 py-3 text-sm font-semibold text-slate-950 transition enabled:hover:bg-cyan-400 disabled:opacity-40"
            >
              Start ({STANDUP_COST} credits)
            </button>
          </div>
        ) : null}

        {phase === "perform" && provider ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Progress</p>
              <p className="text-sm text-slate-200">
                Act {Math.min(actCount || bits.length, bits.length)} / {actCount || bits.length}
                {order?.[index]?.standupTurn
                  ? ` · Round ${order[index]!.standupTurn}`
                  : bits[bits.length - 1]?.standupTurn
                    ? ` · Round ${bits[bits.length - 1]!.standupTurn}`
                    : ""}{" "}
                — <span className="font-semibold text-white">{AI_LABEL[provider]}</span>
                {status ? ` · ${status}` : ""}
                {loading ? " · loading…" : ""}
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {bits.slice(0, revealedCount).map((b, i) => (
                <div key={`${b.provider}-${b.standupTurn}-${i}`} className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">
                    Round {b.standupTurn} · {AI_LABEL[b.provider]}
                  </p>
                  <AiChatBubble provider={b.provider} text={b.text} ms={b.ms} />
                </div>
              ))}

              {revealedCount >= 1 && revealedCount < bits.length ? (
                <button
                  type="button"
                  onClick={() => setRevealedCount((c) => Math.min(bits.length, c + 1))}
                  className="flex w-full items-center justify-between rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3 text-left transition hover:bg-white/[0.08]"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/8 text-xl">
                      ▶
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">Reveal next</p>
                      <p className="text-xs text-slate-400">
                        Round {bits[revealedCount]!.standupTurn} · {AI_LABEL[bits[revealedCount]!.provider]}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-slate-500">Play</span>
                </button>
              ) : null}
            </div>
            <div ref={bottomRef} />
          </div>
        ) : null}
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-[#0a0f1e]/98 backdrop-blur-md">
        <div className="relative mx-auto max-w-3xl overflow-visible">
          {bestAnswerPanel && !sessionEndPanel ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-full z-40 px-3 pb-2 sm:px-4">
              <div
                className={[
                  "pointer-events-auto mx-auto max-w-3xl border-t border-white/20 pt-6 transition-transform duration-300 ease-out",
                  bestAnswerVisual ? "translate-y-0" : "translate-y-full",
                ].join(" ")}
              >
                <div className="rounded-t-2xl bg-[#1a2235] px-4 py-3 shadow-[0_-12px_40px_rgba(0,0,0,0.5)]">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-white sm:text-base">
                      Which AI answered best?
                    </p>
                    <button
                      type="button"
                      onClick={skipBestAnswer}
                      className="shrink-0 text-sm text-slate-400 underline-offset-4 transition hover:text-white hover:underline"
                    >
                      Skip
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {bestAnswerPanel.providers.map((p) => (
                      <button
                        key={p}
                        type="button"
                        title={AI_LABEL[p]}
                        onClick={() => void submitBestAnswerPick(p)}
                        className={[
                          "inline-flex h-9 w-24 min-w-[96px] max-w-[96px] shrink-0 items-center justify-center overflow-hidden rounded-xl px-1 text-sm font-semibold text-white transition hover:opacity-90 box-border",
                          p === "xai" ? "border-2 border-white bg-black" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        style={{
                          backgroundColor:
                            p === "google"
                              ? "#4285F4"
                              : p === "xai"
                                ? "#000000"
                                : AI_ACCENT[p],
                        }}
                      >
                        <span className="min-w-0 truncate text-center">{AI_LABEL[p]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {sessionEndPanel ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-full z-40 px-3 pb-2 sm:px-4">
              <div className="pointer-events-auto mx-auto max-w-3xl">
                {showSessionEndPreparing ? (
                  <div
                    className={[
                      "mt-4 rounded-2xl border border-white/10 bg-[#121a2e] p-4 shadow-[0_-8px_32px_rgba(0,0,0,0.45)] transition-all duration-300 ease-out",
                      sessionEndVisual
                        ? "translate-y-0 opacity-100"
                        : "translate-y-2 opacity-0",
                    ].join(" ")}
                  >
                    {sessionEndPanel.votedAi ? (
                      <p className="text-sm text-slate-200">
                        🏆 {sessionEndPanel.votedAi} answered best
                      </p>
                    ) : null}
                    <p className="mt-3 text-sm text-slate-400">Preparing share options…</p>
                  </div>
                ) : null}
                {showSessionEndPanel ? (
                  <CompareSessionEndPanel
                    votedAi={sessionEndPanel.votedAi}
                    compareSessionId={comedySessionId ?? ""}
                    shareId={shareId ?? ""}
                    visible={sessionEndVisual}
                    saveFailed={sessionEndSaveFailed}
                    onResolveShareUrl={resolveShareUrlForShare}
                    onDone={dismissSessionPanels}
                    goPublicPath="/api/comedy/go-public"
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

