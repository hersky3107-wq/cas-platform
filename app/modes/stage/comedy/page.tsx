"use client";

import Link from "next/link";
import ShareButtons from "@/components/ShareButtons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { AiProviderName } from "@/lib/ai/router";
import { authenticatedFetch } from "@/lib/api/authenticated-fetch";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

const AI_ORDER: AiProviderName[] = [
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

type ComedyMessage = {
  id: string;
  turnIndex: number;
  orderIndex: number;
  provider: AiProviderName;
  content: string;
  responseTimeMs: number;
};

type TalkTurn = {
  turnIndex: 1 | 2 | 3 | 4;
  selectedProviders: AiProviderName[];
  spokeProviders: AiProviderName[];
  messages: ComedyMessage[];
  completed: boolean;
};

function wordsForTypewriter(s: string): string[] {
  if (!s) return [];
  return s.match(/\S+/g) ?? [];
}

function AiNameBadge({ provider }: { provider: AiProviderName }) {
  const base = "inline-flex rounded-lg px-2.5 py-0.5 text-sm font-bold";

  if (provider === "openai") {
    return <span className={`${base} bg-[#0a2540] text-white`}>ChatGPT</span>;
  }
  if (provider === "anthropic") {
    return <span className={`${base} bg-[#F5E6D3] text-[#3d2914]`}>Claude</span>;
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

function AiChatBubble({ msg }: { msg: ComedyMessage }) {
  const [displayed, setDisplayed] = useState("");
  const [typingDone, setTypingDone] = useState(false);

  useEffect(() => {
    const full = msg.content ?? "";
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
  }, [msg.id, msg.content]);

  return (
    <div className="flex w-full max-w-[75%] flex-col items-start gap-1">
      <AiNameBadge provider={msg.provider} />
      <div className="w-full rounded-2xl bg-white/[0.09] px-3.5 py-2.5 text-sm leading-relaxed text-slate-100">
        <p className="min-h-[1.25rem] whitespace-pre-wrap">
          {displayed}
          {!typingDone ? (
            <span
              className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-slate-400 align-text-bottom"
              aria-hidden
            />
          ) : null}
        </p>
        {typingDone ? (
          <div className="mt-2 text-right text-[10px] tabular-nums text-slate-500">
            {msg.responseTimeMs} ms
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function StageComedyPage() {
  const [mode, setMode] = useState<"select" | "talk">("select");
  const [phase, setPhase] = useState<"idle" | "running" | "between" | "voting" | "result">("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turnIndex, setTurnIndex] = useState<1 | 2 | 3 | 4>(1);
  const [thinking, setThinking] = useState<AiProviderName | null>(null);
  const [turns, setTurns] = useState<TalkTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<AiProviderName | null>(null);
  const [voteSubmitting, setVoteSubmitting] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [continueSubmitting, setContinueSubmitting] = useState(false);
  const [topic, setTopic] = useState("");
  const [speakCounts, setSpeakCounts] = useState<Record<AiProviderName, number>>({
    openai: 0,
    anthropic: 0,
    google: 0,
    xai: 0,
    deepseek: 0,
    mistral: 0,
  });
  const [lastTurnSpoke, setLastTurnSpoke] = useState<AiProviderName[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, phase, thinking]);

  const totalTurns = 4 as const;

  useEffect(() => {
    void (async () => {
      const res = await authenticatedFetch("/api/credits/balance", {
        method: "POST",
        json: {},
      });
      const j = (await res.json().catch(() => null)) as { balance?: number };
      if (typeof j?.balance === "number") setCredits(j.balance);
    })();
  }, []);

  const readNdjsonTurn = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await authenticatedFetch("/api/stage/comedy", {
        method: "POST",
        json: body,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string; balance?: number };
        if (typeof j?.balance === "number") setCredits(j.balance);
        throw new Error(j?.error ?? "Request failed");
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

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
          let msg: any;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.type === "meta") {
            if (typeof msg.sessionId === "string") setSessionId(msg.sessionId);
            if (typeof msg.creditsRemaining === "number") setCredits(msg.creditsRemaining);
          }
          if (msg.type === "turn_start" && typeof msg.turnIndex === "number") {
            const ti = msg.turnIndex === 2 ? 2 : msg.turnIndex === 3 ? 3 : msg.turnIndex === 4 ? 4 : 1;
            setTurnIndex(ti);
            const selectedProviders = Array.isArray(msg.selectedProviders) ? (msg.selectedProviders as AiProviderName[]) : [];
            setTurns((prev) => [
              ...prev,
              {
                turnIndex: ti,
                selectedProviders,
                spokeProviders: [],
                messages: [],
                completed: false,
              },
            ]);
          }
          if (msg.type === "thinking" && typeof msg.provider === "string") {
            if ((AI_ORDER as string[]).includes(msg.provider)) {
              setThinking(msg.provider as AiProviderName);
            }
          }
          if (msg.type === "message" && msg.message) {
            const m = msg.message as ComedyMessage;
            if (m && typeof m.id === "string") {
              setThinking(null);
              setTurns((prev) =>
                prev.map((t) => {
                  if (t.turnIndex !== m.turnIndex) return t;
                  const nextMessages = [...t.messages, m];
                  return { ...t, messages: nextMessages };
                })
              );
            }
          }
          if (msg.type === "turn_done") {
            setThinking(null);
            const doneTurn = typeof msg.turnIndex === "number" ? msg.turnIndex : null;
            const spoke = Array.isArray(msg.spoke) ? (msg.spoke as AiProviderName[]) : [];
            if (doneTurn != null) {
              setTurns((prev) =>
                prev.map((t) =>
                  t.turnIndex === doneTurn
                    ? { ...t, spokeProviders: spoke, completed: true }
                    : t
                )
              );
              setLastTurnSpoke(spoke);
              setSpeakCounts((prev) => {
                const next = { ...prev };
                for (const p of spoke) {
                  next[p] = (next[p] ?? 0) + 1;
                }
                return next;
              });
            }
            if (doneTurn >= 4) setPhase("voting");
            else setPhase("between");
          }
          if (msg.type === "show_done") {
            setThinking(null);
            setPhase("voting");
          }
          if (msg.type === "error" && typeof msg.error === "string") {
            throw new Error(msg.error);
          }
        }
      }
    },
    []
  );

  const startShow = useCallback(async () => {
    const t = topic.trim();
    if (!t) {
      setError("Topic is required.");
      return;
    }
    setError(null);
    setPicked(null);
    setSessionId(null);
    setTurnIndex(1);
    setThinking(null);
    setTurns([]);
    setSpeakCounts({
      openai: 0,
      anthropic: 0,
      google: 0,
      xai: 0,
      deepseek: 0,
      mistral: 0,
    });
    setLastTurnSpoke([]);
    setPhase("running");

    try {
      await readNdjsonTurn({ action: "start", topic: t, speakCounts: {}, lastTurnSpoke: [] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setPhase("idle");
    }
  }, [readNdjsonTurn, topic]);

  const continueTurn = useCallback(async () => {
    if (!sessionId || continueSubmitting) return;
    if (turnIndex >= 4) {
      setPhase("voting");
      return;
    }
    setContinueSubmitting(true);
    setError(null);
    setPhase("running");
    try {
      const nextTurn = (turnIndex + 1) as 2 | 3 | 4;
      const historyFlat = turns.flatMap((t) => t.messages);
      await readNdjsonTurn({
        action: "turn",
        sessionId,
        turnIndex: nextTurn,
        history: historyFlat,
        topic: topic.trim(),
        speakCounts,
        lastTurnSpoke,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setPhase("between");
    } finally {
      setContinueSubmitting(false);
    }
  }, [sessionId, continueSubmitting, turnIndex, readNdjsonTurn, turns, topic, speakCounts, lastTurnSpoke]);

  const exitToVote = useCallback(() => {
    setThinking(null);
    setPhase("voting");
  }, []);

  const vote = useCallback(async () => {
    if (!sessionId || !picked || voteSubmitting) return;
    setVoteSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/stage/comedy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "vote",
          sessionId,
          votedAiProvider: picked,
        }),
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; winner?: AiProviderName; error?: string };
      if (!res.ok || !j?.ok) {
        setError(j?.error ?? "Vote failed");
        return;
      }
      setPhase("result");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setVoteSubmitting(false);
    }
  }, [picked, sessionId, voteSubmitting]);
  const winner = useMemo(() => picked ?? null, [picked]);

  const selectScreen = (
    <div className={BG}>
      <header className="fixed left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#0a0f1e]/95 px-3 py-2.5 backdrop-blur-md sm:px-4">
        <Link
          href="/modes/stage"
          className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-2 text-sm text-white/90 transition hover:bg-white/14"
        >
          <ChevronLeft className="h-4 w-4" />
          STAGE
        </Link>
        <span className="rounded-full bg-[#131c35] px-3 py-1.5 text-xs text-slate-200">
          😂 COMEDY
        </span>
      </header>

      <main className="mx-auto max-w-4xl px-3 pb-14 pt-16 sm:px-4">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/8 text-2xl">
            <span aria-hidden>😂</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">STAGE — COMEDY</h1>
          <p className="mt-2 text-sm text-slate-400">Pick a format.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("talk")}
            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-left transition hover:border-white/20 hover:bg-white/[0.06]"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/8 text-2xl">
                <span aria-hidden>🎭</span>
              </div>
              <div className="min-w-0">
                <p className="text-base font-bold text-white">TALK</p>
                <p className="mt-1 text-sm text-slate-400">6 AIs. One topic. Pure chaos.</p>
              </div>
            </div>
            <div className="mt-4 h-px w-full bg-white/10" />
            <p className="mt-3 text-xs text-slate-500">Enter</p>
          </button>

          <Link
            href="/modes/stage/comedy/standup"
            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-left transition hover:border-white/20 hover:bg-white/[0.06]"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/8 text-2xl">
                <span aria-hidden>🎤</span>
              </div>
              <div className="min-w-0">
                <p className="text-base font-bold text-white">STAND-UP</p>
                <p className="mt-1 text-sm text-slate-400">6 AIs try to be funny. You judge.</p>
              </div>
            </div>
            <div className="mt-4 h-px w-full bg-white/10" />
            <p className="mt-3 text-xs text-slate-500">Enter</p>
          </Link>
        </div>
      </main>
    </div>
  );

  const talkScreen = (
    <div className={BG}>
      <header className="fixed left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#0a0f1e]/95 px-3 py-2.5 backdrop-blur-md sm:px-4">
        <Link
          href="/modes/stage"
          className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-2 text-sm text-white/90 transition hover:bg-white/14"
        >
          <ChevronLeft className="h-4 w-4" />
          STAGE
        </Link>
        <span className="rounded-full bg-[#131c35] px-3 py-1.5 text-xs text-slate-200">
          😂 COMEDY
        </span>
      </header>

      <main className="mx-auto max-w-3xl px-3 pb-40 pt-16 sm:px-4">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/8 text-2xl">
            <span aria-hidden>😂</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">STAGE — COMEDY</h1>
          <p className="mt-2 text-sm text-slate-400">6 AIs. Up to 4 turns. One winner.</p>
        </div>

        <div className="mb-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Turn</p>
            <p className="text-sm font-semibold text-white">
              {turnIndex} / {totalTurns}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-500">Credits</p>
            <p className="text-sm text-slate-200">
              {credits !== null ? (
                <span className="tabular-nums">{credits}</span>
              ) : (
                <span className="text-slate-500">—</span>
              )}
            </p>
          </div>
        </div>

        <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
          {phase === "running" ? (
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-500">Now</p>
              <p className="text-sm text-slate-200">
                {thinking ? (
                  <>
                    <span className="font-semibold text-white">{AI_LABEL[thinking]}</span> is thinking…
                  </>
                ) : (
                  "Next speaker…"
                )}
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
                <p className="text-sm text-slate-200">
                  {phase === "idle"
                    ? "Ready"
                    : phase === "between"
                      ? "Intermission"
                      : phase === "voting"
                        ? "Voting"
                        : phase === "result"
                          ? "Result"
                          : "Running"}
                </p>
              </div>
              {phase === "between" ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={continueSubmitting || turnIndex >= 4}
                    onClick={() => void continueTurn()}
                    className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
                  >
                    Continue (+1 credit)
                  </button>
                  <button
                    type="button"
                    disabled={continueSubmitting}
                    onClick={() => exitToVote()}
                    className="rounded-xl border border-white/15 bg-white/8 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Exit &amp; Vote
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {phase === "idle" ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
            <p className="text-sm text-slate-300">A topic is required to start.</p>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Throw a topic (e.g. Monday morning, late pizza delivery, first blind date...)"
              className="mt-4 w-full rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void startShow()}
              disabled={!topic.trim()}
              className="mt-4 w-full rounded-2xl bg-cyan-500 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              Start
            </button>
          </div>
        ) : null}

        {phase !== "idle" ? (
          <div className="flex flex-col gap-3">
            {turns.map((t) => (
              <div key={t.turnIndex} className="space-y-3">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
                  Turn {t.turnIndex} · Speakers:{" "}
                  {t.selectedProviders.map((p) => AI_LABEL[p]).join(", ") || "—"}
                </div>
                {t.messages.map((m) => (
                  <AiChatBubble key={m.id} msg={m} />
                ))}
              </div>
            ))}
            {phase === "running" && thinking ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
                Waiting for <span className="font-semibold text-white">{AI_LABEL[thinking]}</span>…
              </div>
            ) : null}
            {phase === "between" ? (
              <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-sm font-semibold text-white">Turn complete.</p>
                <p className="mt-1 text-sm text-slate-400">
                  Continue costs 1 credit. Or exit and vote now.
                </p>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        ) : null}

        {phase === "voting" ? (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <h2 className="text-lg font-semibold text-white">Who was funniest?</h2>
            <p className="mt-2 text-sm text-slate-400">Pick one. We’ll save your vote.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {AI_ORDER.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPicked(p)}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                    picked === p ? "border-cyan-300 bg-cyan-500/15 text-white" : "border-white/12 bg-white/6 text-slate-200"
                  }`}
                >
                  {AI_LABEL[p]}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!picked || voteSubmitting}
              onClick={() => void vote()}
              className="mt-4 w-full rounded-2xl bg-rose-500 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {voteSubmitting ? "Saving…" : "Vote"}
            </button>
          </div>
        ) : null}

        {phase === "result" ? (
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <h2 className="text-lg font-semibold text-white">Results</h2>
            {winner ? (
              <p className="mt-2 text-sm text-slate-300">
                1st Place: <span className="font-semibold text-white">{AI_LABEL[winner]}</span>
              </p>
            ) : null}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {AI_ORDER.map((p) => (
                <div
                  key={p}
                  className={`rounded-xl border px-3 py-2 ${
                    winner === p ? "border-amber-400 bg-amber-500/10" : "border-white/10 bg-white/[0.03]"
                  }`}
                >
                  <span className="text-sm font-semibold text-slate-200">{AI_LABEL[p]}</span>
                </div>
              ))}
            </div>

            <ShareButtons modeName="STAGE Comedy" className="mt-5" />
            <button
              type="button"
              onClick={() => {
                setPhase("idle");
                setSessionId(null);
                setTurnIndex(1);
                setThinking(null);
                setPicked(null);
                setError(null);
                setContinueSubmitting(false);
                setTurns([]);
                setSpeakCounts({
                  openai: 0,
                  anthropic: 0,
                  google: 0,
                  xai: 0,
                  deepseek: 0,
                  mistral: 0,
                });
                setLastTurnSpoke([]);
              }}
              className="mt-3 w-full rounded-2xl bg-cyan-500 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              Play Again
            </button>
          </div>
        ) : null}
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-[#0a0f1e]/98 backdrop-blur-md">
        <div className="mx-auto max-w-3xl px-3 py-3 sm:px-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {phase === "between" ? "Intermission" : phase === "voting" ? "Voting" : "Controls"}
              </p>
              <p className="truncate text-sm text-slate-300">
                Continue (+1 credit) or Exit &amp; Vote
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {phase !== "voting" && phase !== "result" ? (
                <button
                  type="button"
                  disabled={continueSubmitting || phase !== "between" || turnIndex >= 4}
                  onClick={() => void continueTurn()}
                  className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
                >
                  Continue (+1 credit)
                </button>
              ) : null}
              <button
                type="button"
                disabled={continueSubmitting || (phase !== "between" && phase !== "running")}
                onClick={() => exitToVote()}
                className="rounded-xl border border-white/15 bg-white/8 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Exit &amp; Vote
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return mode === "select" ? selectScreen : talkScreen;
}

