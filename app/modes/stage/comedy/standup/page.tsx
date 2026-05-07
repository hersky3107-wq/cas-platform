"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { AiProviderName } from "@/lib/ai/router";

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

export default function StandupPage() {
  const [phase, setPhase] = useState<Phase>("input");
  const [topic, setTopic] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [order, setOrder] = useState<AiProviderName[] | null>(null);
  const [assignedFormats, setAssignedFormats] = useState<Record<AiProviderName, string> | null>(null);
  const [index, setIndex] = useState<number>(-1);
  const [provider, setProvider] = useState<AiProviderName | null>(null);
  const [text, setText] = useState<string>("");
  const [ms, setMs] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"Voting" | "Intermission" | null>(null);
  const [bits, setBits] = useState<Array<{ provider: AiProviderName; text: string; ms: number }>>([]);
  const [revealedCount, setRevealedCount] = useState(0);
  const [scores, setScores] = useState<Record<AiProviderName, number>>(() => ({
    openai: 0,
    anthropic: 0,
    google: 0,
    xai: 0,
    deepseek: 0,
    mistral: 0,
  }));
  const [winnerRound, setWinnerRound] = useState<{ provider: AiProviderName | null } | null>(null);
  const [votePick, setVotePick] = useState<AiProviderName | null>(null);
  const [voteSubmitting, setVoteSubmitting] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [phase, provider, text, loading]);

  const start = useCallback(async () => {
    const t = topic.trim();
    if (!t || loading) return;
    setError(null);
    setStatus(null);
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
      setAssignedFormats(j.assignedFormats ?? null);
      setIndex(j.index);
      setProvider(j.provider);
      const cleaned = sanitizeAiText(j.text ?? "");
      setText(cleaned);
      setMs(typeof j.ms === "number" ? j.ms : 0);
      setBits([{ provider: j.provider, text: cleaned, ms: typeof j.ms === "number" ? j.ms : 0 }]);
      // First AI auto-reveals; reveal button starts from 2nd AI.
      setRevealedCount(1);
      setWinnerRound(null);
      setVotePick(null);
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
  }, [loading, topic]);

  const runRemaining = useCallback(async () => {
    if (!sessionId || !order || !assignedFormats || loading) return;
    setError(null);
    setLoading(true);
    try {
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
            assignedFormats,
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
        setBits((prev) => [
          ...prev,
          { provider: j.provider, text: cleaned, ms: typeof j.ms === "number" ? j.ms : 0 },
        ]);
      }
      setStatus(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [index, loading, order, sessionId, topic, assignedFormats]);

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

  const showVoting =
    phase === "perform" && order && index >= 5 && !loading && revealedCount >= 6;

  const submitFinalVote = useCallback(async () => {
    if (!sessionId || !votePick || voteSubmitting) return;
    setVoteSubmitting(true);
    setError(null);
    // Immediately show results screen (never blank), then fill counts when ready.
    setWinnerRound({ provider: votePick });
    setPhase("result");
    try {
      const res = await fetch("/api/stage/comedy/standup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "vote", sessionId, provider: votePick }),
      });
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok || !j?.ok) throw new Error(j?.error ?? "Vote failed");
      if (typeof j?.winner === "string") {
        setWinnerRound({ provider: j.winner as AiProviderName });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setVoteSubmitting(false);
    }
  }, [sessionId, votePick, voteSubmitting]);

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
          <p className="mt-2 text-sm text-slate-400">6 AIs try. You judge.</p>
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
              Start
            </button>
          </div>
        ) : null}

        {phase === "perform" && provider ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Progress</p>
              <p className="text-sm text-slate-200">
                Turn {Math.min(6, bits.length)} / 6 —{" "}
                <span className="font-semibold text-white">{AI_LABEL[provider]}</span>
                {status ? ` · ${status}` : ""}
                {loading ? " · loading…" : ""}
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {bits.slice(0, revealedCount).map((b, i) => (
                <AiChatBubble key={`${b.provider}-${i}`} provider={b.provider} text={b.text} ms={b.ms} />
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
                        {AI_LABEL[bits[revealedCount]!.provider]}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-slate-500">Play</span>
                </button>
              ) : null}
            </div>
            {showVoting ? (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <h2 className="text-lg font-semibold text-white">Who was funniest?</h2>
                <p className="mt-2 text-sm text-slate-400">Pick one comedian.</p>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {AI_ORDER.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setVotePick(p)}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                        votePick === p
                          ? "border-cyan-300 bg-cyan-500/15 text-white"
                          : "border-white/12 bg-white/6 text-slate-200"
                      }`}
                    >
                      {AI_LABEL[p]}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={!votePick || voteSubmitting}
                  onClick={() => void submitFinalVote()}
                  className="mt-4 w-full rounded-2xl bg-rose-500 py-3 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {voteSubmitting ? "Saving…" : "Vote"}
                </button>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        ) : null}

        {phase === "result" ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <h2 className="text-lg font-semibold text-white">Results</h2>
            {winnerRound?.provider ? (
              <p className="mt-2 text-sm text-slate-300">
                1st Place:{" "}
                <span className="font-semibold text-white">{AI_LABEL[winnerRound.provider]}</span>
              </p>
            ) : null}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {AI_ORDER.map((p) => (
                <div
                  key={p}
                  className={`rounded-xl border px-3 py-2 ${
                    winnerRound?.provider === p
                      ? "border-amber-400 bg-amber-500/10"
                      : "border-white/10 bg-white/[0.03]"
                  }`}
                >
                  <span className="text-sm font-semibold text-slate-200">{AI_LABEL[p]}</span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setPhase("input");
                setSessionId(null);
                setOrder(null);
                setAssignedFormats(null);
                setIndex(-1);
                setProvider(null);
                setText("");
                setMs(0);
                setError(null);
                setBits([]);
                setRevealedCount(0);
                setStatus(null);
                setWinnerRound(null);
                setVotePick(null);
                setVoteSubmitting(false);
              }}
              className="mt-5 w-full rounded-2xl bg-cyan-500 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              Play Again
            </button>
          </div>
        ) : null}
      </main>
    </div>
  );
}

