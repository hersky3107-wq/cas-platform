"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronLeft, Swords } from "lucide-react";
import { supabase } from "@/lib/db/supabase";
import { arenaFinalBundleCreditCost } from "@/lib/ai/arena-bundle";
import {
  ARENA_DISPLAY,
  ARENA_ORDER,
  type ArenaAI,
  type ArenaResponse,
  type ArenaRound,
} from "@/lib/ai/arena-engine";
import {
  type ArenaCampContext,
  computeBubbleAlign,
  determineSides,
  stripArenaMarkdown,
  stripInternalTargetingBlock,
} from "@/lib/ai/arena-parser";

function visibleArenaText(s: string): string {
  return stripArenaMarkdown(stripInternalTargetingBlock(s));
}

const BG = "min-h-screen bg-[#0a0f1e] text-white";

/** Brand colors for camp UI, progress dots, thinking labels. */
const ARENA_COLOR: Record<ArenaAI, string> = {
  gpt: "#10A37F",
  claude: "#D97757",
  gemini: "#4285F4",
  grok: "#000000",
  deepseek: "#4D6BFE",
  mistral: "#FF7000",
};

function AiNameBadge({ ai, label }: { ai: ArenaAI; label: string }) {
  if (ai === "gemini") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-lg border border-white/20 bg-[#171717] px-2.5 py-0.5 text-xs font-bold leading-tight shadow-sm">
        <span
          className="bg-clip-text font-bold text-transparent"
          style={{
            display: "inline-block",
            backgroundImage: "linear-gradient(90deg, #4285F4, #EA4335, #FBBC05, #34A853)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
          }}
        >
          {label}
        </span>
      </span>
    );
  }
  const bg = ARENA_COLOR[ai] ?? "#475569";
  return (
    <span
      className="inline-flex shrink-0 rounded-lg border border-black/35 px-2.5 py-0.5 text-xs font-bold text-white shadow-sm"
      style={{
        backgroundColor: bg,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
      }}
    >
      {label}
    </span>
  );
}

const CHAMPION_GOLD = "#F59E0B";
const DISAGREE_RED = "#EF4444";
const AGREE_GREEN = "#10B981";

type Phase = "input" | "round1" | "sides_reveal" | "battle" | "result";

function positionBadgeStyle(position: string): { label: string; color: string } {
  const visible = visibleArenaText(position);
  const p = visible.toUpperCase();
  if (p.includes("DISAGREE")) return { label: visible, color: DISAGREE_RED };
  if (p.includes("AGREE")) return { label: visible, color: AGREE_GREEN };
  return { label: visible || "INDEPENDENT", color: "#94A3B8" };
}

function ArenaBubble({
  r,
  align,
  repColor,
}: {
  r: ArenaResponse;
  align: "left" | "right";
  repColor: string;
}) {
  const badge = positionBadgeStyle(r.position);
  const name = ARENA_DISPLAY[r.ai];
  return (
    <div className={`flex w-full max-w-[min(100%,520px)] ${align === "right" ? "ml-auto" : ""}`}>
      <div
        className={`w-full rounded-2xl border px-3.5 py-3 ${
          align === "right" ? "border-white/12 bg-white/[0.07]" : "border-white/12 bg-white/[0.07]"
        }`}
        style={{
          borderLeftColor: align === "left" ? repColor : undefined,
          borderRightColor: align === "right" ? repColor : undefined,
          borderLeftWidth: align === "left" ? 3 : undefined,
          borderRightWidth: align === "right" ? 3 : undefined,
        }}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <AiNameBadge ai={r.ai} label={name} />
          {r.joinedFight ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/50 bg-cyan-500/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-200">
              {name} joins the fight
            </span>
          ) : null}
          {r.champion ? (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ color: CHAMPION_GOLD, border: `1px solid ${CHAMPION_GOLD}` }}
            >
              CHAMPION <span aria-hidden>⚔️</span>
            </span>
          ) : null}
          {r.support ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">
              <span>SUPPORT →</span>
              {(ARENA_ORDER as readonly string[]).includes(String(r.support)) ? (
                <AiNameBadge
                  ai={r.support as ArenaAI}
                  label={ARENA_DISPLAY[r.support as ArenaAI] ?? String(r.support)}
                />
              ) : (
                <span className="rounded-md bg-slate-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {r.support}
                </span>
              )}
            </span>
          ) : null}
        </div>
        {!r.synthetic && r.angle ? (
          <p className="mb-2 text-sm font-semibold text-white/95">
            &ldquo;{visibleArenaText(r.angle)}&rdquo;
          </p>
        ) : null}
        {!r.synthetic ? (
          <p
            className="mb-2 inline-block rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            style={{ color: badge.color, backgroundColor: `${badge.color}18` }}
          >
            {badge.label}
          </p>
        ) : null}
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
          {visibleArenaText(r.content)}
        </p>
        {r.supportComment ? (
          <p className="mt-2 border-t border-white/10 pt-2 text-xs italic text-slate-400">
            {visibleArenaText(r.supportComment)}
          </p>
        ) : null}
        {!r.synthetic ? (
          <p className="mt-2 text-right text-[10px] text-slate-500">{r.responseTimeMs} ms</p>
        ) : null}
      </div>
    </div>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-slate-400">
        <span>Progress</span>
        <span className="tabular-nums">
          {current}/{total} AIs responded
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-rose-500/90 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function ArenaPage() {
  const router = useRouter();
  const [credits, setCredits] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("input");
  const [topic, setTopic] = useState("");
  const [selected, setSelected] = useState<Set<ArenaAI>>(
    () => new Set<ArenaAI>(["grok", "gpt", "gemini", "deepseek", "mistral", "claude"])
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [rounds, setRounds] = useState<ArenaRound[]>([]);
  /** API battle round number (2 = first battle after openings). */
  const [displayBattleRound, setDisplayBattleRound] = useState(1);
  const [sides, setSides] = useState<{
    left: ArenaAI | null;
    right: ArenaAI | null;
    leftSupport: ArenaAI[];
    rightSupport: ArenaAI[];
  }>({ left: null, right: null, leftSupport: [], rightSupport: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [round1Live, setRound1Live] = useState<ArenaResponse[]>([]);
  const [round1Complete, setRound1Complete] = useState(false);
  const [battleLive, setBattleLive] = useState<ArenaResponse[]>([]);
  const [awaitingNextBattleRound, setAwaitingNextBattleRound] = useState(false);
  const [thinkingAi, setThinkingAi] = useState<ArenaAI | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ArenaAI | null>(null);
  const [voteDone, setVoteDone] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const roundsRef = useRef<ArenaRound[]>([]);
  /** Avoid concurrent battle requests while one NDJSON round is streaming. */
  const battleInflightRef = useRef(false);
  const arenaFinalBundleTokenRef = useRef<string | null>(null);

  const selectedList = useMemo(() => ARENA_ORDER.filter((a) => selected.has(a)), [selected]);

  const finalBundleCost = useMemo(() => {
    try {
      return arenaFinalBundleCreditCost();
    } catch {
      return null;
    }
  }, []);

  /** Round 2: champs + static supporters; round 3: 1v1; rounds 4–6: left → co → right. */
  const battleResponsesPerRound = useMemo(() => {
    if (displayBattleRound === 2) {
      return 2 + sides.leftSupport.length + sides.rightSupport.length;
    }
    if (displayBattleRound >= 4) {
      return 3;
    }
    return 2;
  }, [displayBattleRound, sides.leftSupport.length, sides.rightSupport.length]);

  const round1CampCtx = useMemo((): ArenaCampContext => {
    const d = determineSides(round1Live);
    return {
      left: d.left,
      right: d.right,
      leftChamp: d.championLeft,
      rightChamp: d.championRight,
    };
  }, [round1Live]);

  const battleCampCtx = useMemo((): ArenaCampContext => {
    const left: ArenaAI[] = sides.left ? [sides.left, ...sides.leftSupport] : [...sides.leftSupport];
    const right: ArenaAI[] = sides.right ? [sides.right, ...sides.rightSupport] : [...sides.rightSupport];
    return {
      left,
      right,
      leftChamp: sides.left,
      rightChamp: sides.right,
    };
  }, [sides]);

  useEffect(() => {
    roundsRef.current = rounds;
  }, [rounds]);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [phase, round1Live, battleLive, rounds, isLoading, round1Complete, awaitingNextBattleRound]);

  const toggleAi = (ai: ArenaAI) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ai)) {
        if (next.size <= 3) return prev;
        next.delete(ai);
      } else {
        if (next.size >= 6) return prev;
        next.add(ai);
      }
      return next;
    });
  };

  const readNdjsonArena = useCallback(
    async (
      body: Record<string, unknown>,
      onMeta: (m: { sessionId?: string; creditsRemaining?: number }) => void,
      onResponse: (r: ArenaResponse, roundNumber: number) => void,
      onRound: (r: ArenaRound) => void,
      onThinking?: (payload: { ai: ArenaAI; roundNumber: number }) => void
    ): Promise<boolean> => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        router.replace("/auth");
        return false;
      }
      const res = await fetch("/api/ai-arena", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, supabaseAccessToken: token }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string; balance?: number };
        setError(j?.error ?? "Request failed");
        if (typeof j?.balance === "number") setCredits(j.balance);
        return false;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setError("No response body");
        return false;
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
            type: string;
            sessionId?: string;
            creditsRemaining?: number;
            response?: ArenaResponse;
            roundNumber?: number;
            round?: ArenaRound;
            error?: string;
            ai?: string;
          };
          try {
            msg = JSON.parse(line) as typeof msg;
          } catch {
            continue;
          }
          if (msg.type === "meta") onMeta(msg);
          if (msg.type === "arena_thinking" && msg.ai && typeof msg.roundNumber === "number") {
            if ((ARENA_ORDER as string[]).includes(msg.ai)) {
              onThinking?.({ ai: msg.ai as ArenaAI, roundNumber: msg.roundNumber });
              await new Promise<void>((resolve) => {
                requestAnimationFrame(() => resolve());
              });
            }
          }
          if (
            msg.type === "arena_response" &&
            msg.response &&
            typeof msg.roundNumber === "number"
          ) {
            const rn = msg.roundNumber;
            flushSync(() => {
              setThinkingAi(null);
              onResponse(msg.response!, rn);
            });
            await new Promise<void>((resolve) => {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => resolve());
              });
            });
          }
          if (msg.type === "arena_round") {
            const completed = msg.round;
            if (completed) {
              flushSync(() => {
                setThinkingAi(null);
                onRound(completed);
              });
              await new Promise<void>((resolve) => {
                requestAnimationFrame(() => resolve());
              });
            }
          }
          if (msg.type === "error" && msg.error) setError(msg.error);
        }
      }
      return true;
    },
    [router]
  );

  const resetArenaUi = useCallback(() => {
    setRound1Live([]);
    setRound1Complete(false);
    setRounds([]);
    roundsRef.current = [];
    setBattleLive([]);
    setSessionId(null);
    setSides({ left: null, right: null, leftSupport: [], rightSupport: [] });
    setAwaitingNextBattleRound(false);
    setThinkingAi(null);
    setDisplayBattleRound(1);
    arenaFinalBundleTokenRef.current = null;
  }, []);

  const mergeBattleBodyForRound = useCallback(
    (roundNumber: number) => {
      const t = topic.trim();
      const base = {
        action: "battle" as const,
        sessionId: sessionId as string,
        topic: t,
        rounds: roundsRef.current,
        roundNumber,
        championLeft: sides.left as ArenaAI,
        championRight: sides.right as ArenaAI,
        leftSupportCount: sides.leftSupport.length,
        rightSupportCount: sides.rightSupport.length,
      };
      if (roundNumber >= 4 && arenaFinalBundleTokenRef.current) {
        return {
          ...base,
          arenaFinalBundleToken: arenaFinalBundleTokenRef.current,
        };
      }
      return base;
    },
    [sessionId, sides, topic]
  );

  const purchaseArenaFinalBundleIfNeeded = useCallback(async (): Promise<boolean> => {
    if (arenaFinalBundleTokenRef.current) return true;
    if (!sessionId) return false;
    const { data } = await supabase.auth.getSession();
    const tok = data.session?.access_token;
    if (!tok) {
      router.replace("/auth");
      return false;
    }
    const res = await fetch("/api/ai-arena", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "arena_buy_final_bundle",
        sessionId,
        supabaseAccessToken: tok,
      }),
    });
    const j = (await res.json().catch(() => null)) as {
      arenaFinalBundleToken?: string;
      creditsRemaining?: number;
      error?: string;
      balance?: number;
      required?: number;
    };
    if (!res.ok) {
      setError(j?.error ?? "Purchase failed");
      if (typeof j?.balance === "number") setCredits(j.balance);
      return false;
    }
    if (typeof j?.creditsRemaining === "number") setCredits(j.creditsRemaining);
    if (typeof j?.arenaFinalBundleToken === "string") {
      arenaFinalBundleTokenRef.current = j.arenaFinalBundleToken;
    }
    return Boolean(arenaFinalBundleTokenRef.current);
  }, [router, sessionId]);

  const startArena = useCallback(async () => {
    const t = topic.trim();
    if (selectedList.length < 3 || selectedList.length > 6 || !t || isLoading) return;
    setError(null);
    setIsLoading(true);
    resetArenaUi();
    setPhase("round1");
    try {
      await readNdjsonArena(
        { action: "start", topic: t, selectedAIs: selectedList },
        (meta) => {
          if (meta.sessionId) setSessionId(meta.sessionId);
          if (typeof meta.creditsRemaining === "number") setCredits(meta.creditsRemaining);
        },
        (response) => {
          setRound1Live((prev) => [...prev, response]);
        },
        (round) => {
          roundsRef.current = [round];
          setRounds([round]);
          const cl = round.champion.left;
          const cr = round.champion.right;
          const ls = round.sides.left.filter((a) => a !== cl);
          const rs = round.sides.right.filter((a) => a !== cr);
          setSides({
            left: cl,
            right: cr,
            leftSupport: ls,
            rightSupport: rs,
          });
          setRound1Complete(true);
        },
        ({ ai }) => setThinkingAi(ai)
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [topic, selectedList, isLoading, readNdjsonArena, resetArenaUi]);

  const battleUiRoundComplete = useCallback((roundComplete: ArenaRound) => {
    const rn = Number(roundComplete.roundNumber);
    setDisplayBattleRound(rn);
    setRounds((prev) => {
      const n = [...prev.filter((x) => x.roundNumber !== roundComplete.roundNumber), roundComplete];
      roundsRef.current = n;
      return n;
    });
    setBattleLive([]);
    if (rn === 2) setAwaitingNextBattleRound(true);
    else setAwaitingNextBattleRound(false);
  }, []);

  const runBattleRound = useCallback(
    async (roundNumber: number) => {
      if (!sessionId || !sides.left || !sides.right || !topic.trim()) {
        return false;
      }
      if (roundNumber > 6) {
        return false;
      }
      if (battleInflightRef.current) {
        return false;
      }
      battleInflightRef.current = true;
      setError(null);
      setIsLoading(true);
      setBattleLive([]);
      setAwaitingNextBattleRound(false);
      setDisplayBattleRound(roundNumber);
      setPhase("battle");
      try {
        const okStream = await readNdjsonArena(
          mergeBattleBodyForRound(roundNumber),
          (meta) => {
            if (typeof meta.creditsRemaining === "number") setCredits(meta.creditsRemaining);
          },
          (response) => {
            setBattleLive((prev) => [...prev, response]);
          },
          battleUiRoundComplete,
          ({ ai }) => setThinkingAi(ai)
        );
        return okStream;
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error");
        return false;
      } finally {
        battleInflightRef.current = false;
        setIsLoading(false);
      }
    },
    [battleUiRoundComplete, mergeBattleBodyForRound, readNdjsonArena, sessionId, sides, topic]
  );

  const runFinalRounds456 = useCallback(async () => {
    const t = topic.trim();
    if (!sessionId || !sides.left || !sides.right || !t) return;
    if (battleInflightRef.current) return;
    setError(null);
    battleInflightRef.current = true;
    setIsLoading(true);
    setPhase("battle");
    setAwaitingNextBattleRound(false);
    try {
      const purchased = await purchaseArenaFinalBundleIfNeeded();
      if (!purchased) return;

      const sequence = [4, 5, 6];
      for (const rn of sequence) {
        setBattleLive([]);
        setDisplayBattleRound(rn);
        const okStream = await readNdjsonArena(
          mergeBattleBodyForRound(rn),
          (meta) => {
            if (typeof meta.creditsRemaining === "number") setCredits(meta.creditsRemaining);
          },
          (response) => {
            setBattleLive((prev) => [...prev, response]);
          },
          battleUiRoundComplete,
          ({ ai }) => setThinkingAi(ai)
        );
        if (!okStream) break;
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      battleInflightRef.current = false;
      setIsLoading(false);
      setThinkingAi(null);
      setBattleLive([]);
    }
  }, [
    battleUiRoundComplete,
    mergeBattleBodyForRound,
    purchaseArenaFinalBundleIfNeeded,
    readNdjsonArena,
    sessionId,
    sides.left,
    sides.right,
    topic,
  ]);

  const submitVote = useCallback(async () => {
    if (!sessionId || !picked) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const res = await fetch("/api/ai-arena", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "vote",
        sessionId,
        chosenAi: picked,
        supabaseAccessToken: token,
      }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string };
      setError(j?.error ?? "Vote failed");
      return;
    }
    setVoteDone(true);
  }, [sessionId, picked]);

  const leftColor = sides.left ? ARENA_COLOR[sides.left] : "#64748B";
  const rightColor = sides.right ? ARENA_COLOR[sides.right] : "#64748B";
  const battleRounds = rounds.filter((r) => r.roundNumber >= 2);
  const maxRound = rounds.length ? Math.max(...rounds.map((r) => Number(r.roundNumber))) : 1;
  const showPostRoundThreeActions =
    phase === "battle" && maxRound === 3 && !awaitingNextBattleRound && !isLoading;

  const showPostRoundSixEndActions =
    phase === "battle" && maxRound === 6 && !awaitingNextBattleRound && !isLoading;

  return (
    <div className={BG}>
      <header className="fixed left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#0a0f1e]/95 px-3 py-2.5 backdrop-blur-md sm:px-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-2 text-sm text-white/90 transition hover:bg-white/14"
        >
          <ChevronLeft className="h-4 w-4" />
          Lobby
        </Link>
        {credits !== null ? (
          <span className="rounded-full bg-[#131c35] px-3 py-1.5 text-xs text-slate-200">{credits} credits</span>
        ) : null}
      </header>

      <main className="mx-auto max-w-3xl px-3 pb-40 pt-16 sm:px-4">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Swords className="h-10 w-10 text-rose-400" aria-hidden />
          <h1 className="text-2xl font-bold tracking-tight text-white">ARENA</h1>
          <p className="text-sm text-slate-400">Same stage. No referee.</p>
        </div>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {phase === "input" ? (
          <div className="space-y-6">
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Enter a topic or question for the panel to debate…"
              disabled={isLoading}
              className="min-h-[120px] w-full resize-y rounded-xl border border-white/12 bg-white/6 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-rose-400/40 focus:outline-none"
            />
            <p className="text-xs leading-relaxed text-slate-500">
              Opening bracket is rounds 1–3 per topic. Continuing runs rounds 4–6 once and spends one
              credit package for that triple round.
            </p>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Select 3–6 AIs ({selectedList.length} selected)
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ARENA_ORDER.map((ai) => {
                  const on = selected.has(ai);
                  return (
                    <label
                      key={ai}
                      className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition ${
                        on ? "border-white/25 bg-white/10" : "border-white/10 bg-white/[0.04] opacity-70"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleAi(ai)}
                        className="sr-only"
                      />
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: ARENA_COLOR[ai] }}
                      />
                      <span className="font-medium text-white">{ARENA_DISPLAY[ai]}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void startArena()}
              disabled={isLoading || !topic.trim() || selectedList.length < 3}
              className="w-full rounded-2xl bg-rose-500 py-3 text-sm font-semibold text-white transition enabled:hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              START ARENA
            </button>
          </div>
        ) : null}

        {phase === "round1" ? (
          <div>
            <h2 className="mb-4 text-center text-lg font-bold text-white">ROUND 1 — Opening Statements</h2>
            <div className="mb-4">
              <ProgressBar current={round1Live.length} total={selectedList.length} />
            </div>
            {thinkingAi && isLoading ? (
              <p className="mb-3 text-center text-sm text-slate-300">
                <span className="font-semibold" style={{ color: ARENA_COLOR[thinkingAi] }}>
                  {ARENA_DISPLAY[thinkingAi]}
                </span>{" "}
                is thinking…
              </p>
            ) : null}
            <div className="flex flex-col gap-3 pr-1">
              {round1Live.map((r) => {
                const a1 = computeBubbleAlign(r, round1CampCtx);
                const r1Rep =
                  a1 === "right"
                    ? round1CampCtx.rightChamp
                      ? ARENA_COLOR[round1CampCtx.rightChamp]
                      : "#64748B"
                    : round1CampCtx.leftChamp
                      ? ARENA_COLOR[round1CampCtx.leftChamp]
                      : "#64748B";
                return (
                  <ArenaBubble
                    key={`${r.ai}-${r.responseTimeMs}`}
                    r={r}
                    align={a1}
                    repColor={r1Rep}
                  />
                );
              })}
              {isLoading && round1Live.length === 0 ? (
                <p className="text-center text-sm text-slate-400">Connecting…</p>
              ) : null}
              {isLoading && !thinkingAi ? (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-rose-400" />
                  Waiting for next speaker…
                </div>
              ) : null}
            </div>
            {round1Complete && !isLoading ? (
              <div className="mt-8 flex flex-col items-center gap-2">
                <p className="text-center text-sm text-slate-400">Read the openings, then continue.</p>
                <button
                  type="button"
                  onClick={() => setPhase("sides_reveal")}
                  className="rounded-2xl bg-cyan-500 px-8 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
                >
                  Next: Camp lineup
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {phase === "sides_reveal" ? (
          <div className="fixed inset-0 z-30 flex flex-col items-center justify-center bg-[#0a0f1e]/96 px-4 backdrop-blur-md">
            <p className="mb-2 text-center text-2xl font-bold text-white">Sides are set ⚔️</p>
            <p className="mb-4 max-w-md text-center text-sm text-slate-400">
              Champions lead each camp. Supporters back them in later battle rounds.
            </p>
            <div className="mt-4 grid w-full max-w-lg grid-cols-2 gap-4 text-center">
              <div
                className="rounded-2xl border p-4"
                style={{ borderColor: leftColor, backgroundColor: `${leftColor}14` }}
              >
                <p className="text-xs uppercase text-slate-400">Left</p>
                <p className="mt-1 text-lg font-bold" style={{ color: leftColor }}>
                  {sides.left ? ARENA_DISPLAY[sides.left] : "—"}
                </p>
                <p className="mt-2 text-[11px] text-slate-400">Support</p>
                <p className="text-xs text-slate-300">
                  {sides.leftSupport.map((a) => ARENA_DISPLAY[a]).join(", ") || "—"}
                </p>
              </div>
              <div
                className="rounded-2xl border p-4"
                style={{ borderColor: rightColor, backgroundColor: `${rightColor}14` }}
              >
                <p className="text-xs uppercase text-slate-400">Right</p>
                <p className="mt-1 text-lg font-bold" style={{ color: rightColor }}>
                  {sides.right ? ARENA_DISPLAY[sides.right] : "—"}
                </p>
                <p className="mt-2 text-[11px] text-slate-400">Support</p>
                <p className="text-xs text-slate-300">
                  {sides.rightSupport.map((a) => ARENA_DISPLAY[a]).join(", ") || "—"}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={isLoading || !sides.left || !sides.right}
              onClick={() => void runBattleRound(2)}
              className="mt-10 rounded-2xl bg-cyan-500 px-8 py-3 text-sm font-semibold text-slate-950 transition enabled:hover:bg-cyan-400 disabled:opacity-40"
            >
              Begin Round 2
            </button>
          </div>
        ) : null}

        {phase === "battle" ? (
          <div>
            <h2 className="mb-2 text-center text-lg font-bold text-white">
              ROUND {displayBattleRound} — Battle
            </h2>
            <div className="mb-4">
              <ProgressBar current={battleLive.length} total={battleResponsesPerRound} />
            </div>
            {thinkingAi && isLoading ? (
              <p className="mb-3 text-center text-sm text-slate-300">
                <span className="font-semibold" style={{ color: ARENA_COLOR[thinkingAi] }}>
                  {ARENA_DISPLAY[thinkingAi]}
                </span>{" "}
                is thinking…
              </p>
            ) : null}
            <div className="flex flex-col gap-4 pr-1">
              {battleRounds.flatMap((br) =>
                br.responses.map((r) => {
                  const align = computeBubbleAlign(r, battleCampCtx);
                  const repColor = align === "right" ? rightColor : leftColor;
                  return (
                    <ArenaBubble
                      key={`${br.roundNumber}-${r.ai}-${r.responseTimeMs}`}
                      r={r}
                      align={align}
                      repColor={repColor}
                    />
                  );
                })
              )}
              {battleLive.map((r) => {
                const align = computeBubbleAlign(r, battleCampCtx);
                const repColor = align === "right" ? rightColor : leftColor;
                return (
                  <ArenaBubble
                    key={`live-${r.ai}-${r.responseTimeMs}`}
                    r={r}
                    align={align}
                    repColor={repColor}
                  />
                );
              })}
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
                  <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
                  Battle in progress…
                </div>
              ) : null}
            </div>

            {awaitingNextBattleRound && maxRound === 2 && !isLoading ? (
              <div className="mt-8 flex flex-col items-center gap-2">
                <p className="text-center text-sm text-slate-400">When you are ready, start Round 3.</p>
                <button
                  type="button"
                  onClick={() => void runBattleRound(3)}
                  className="rounded-xl bg-cyan-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500"
                >
                  Round 3
                </button>
              </div>
            ) : null}

            {showPostRoundThreeActions ? (
              <div className="mt-8 flex flex-col items-center gap-3">
                <p className="text-center text-sm text-slate-400">
                  End here, judge the debate, or run rounds 4–6 (single credit package).
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setPhase("result")}
                    className="rounded-xl border border-white/15 bg-white/8 px-4 py-2 text-sm text-white"
                  >
                    STOP
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhase("result")}
                    className="rounded-xl bg-amber-500/90 px-4 py-2 text-sm font-semibold text-slate-950"
                  >
                    Who was right? Vote
                  </button>
                  <button
                    type="button"
                    disabled={
                      isLoading ||
                      (finalBundleCost != null && credits !== null && credits < finalBundleCost)
                    }
                    onClick={() => void runFinalRounds456()}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Continue to Final Rounds (uses credits)
                  </button>
                </div>
              </div>
            ) : null}

            {showPostRoundSixEndActions ? (
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setPhase("result")}
                  className="rounded-xl border border-white/15 bg-white/8 px-4 py-2 text-sm text-white"
                >
                  STOP
                </button>
                <button
                  type="button"
                  onClick={() => setPhase("result")}
                  className="rounded-xl bg-amber-500/90 px-4 py-2 text-sm font-semibold text-slate-950"
                >
                  Who was right? Vote
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {phase === "result" ? (
          <div className="mx-auto max-w-lg space-y-6 text-center">
            <h2 className="text-xl font-bold text-white">ARENA ENDED</h2>
            <p className="text-sm text-slate-400">{rounds.length} round(s) played</p>
            <p className="text-sm text-slate-300">Which argument was most convincing?</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ARENA_ORDER.filter((a) => selectedList.includes(a)).map((ai) => (
                <button
                  key={ai}
                  type="button"
                  onClick={() => setPicked(ai)}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
                    picked === ai ? "border-amber-400 bg-amber-500/20" : "border-white/12 bg-white/6"
                  }`}
                  style={{ color: picked === ai ? CHAMPION_GOLD : ARENA_COLOR[ai] }}
                >
                  {ARENA_DISPLAY[ai]}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!picked || voteDone}
              onClick={() => void submitVote()}
              className="w-full rounded-2xl bg-rose-500 py-3 text-sm font-semibold text-white disabled:opacity-40"
            >
              {voteDone ? "Saved" : "Save result"}
            </button>
            <Link href="/" className="inline-block text-sm text-cyan-400 underline">
              Back to lobby
            </Link>
          </div>
        ) : null}

        <div ref={bottomRef} />
      </main>
    </div>
  );
}
