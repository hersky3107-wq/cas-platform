"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Swords } from "lucide-react";
import { supabase } from "@/lib/db/supabase";
import { creditsPerMessage } from "@/lib/credits";
import {
  ARENA_DISPLAY,
  ARENA_ORDER,
  type ArenaAI,
  type ArenaResponse,
  type ArenaRound,
} from "@/lib/ai/arena-engine";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

const ARENA_COLOR: Record<ArenaAI, string> = {
  gpt: "#10A37F",
  claude: "#D97757",
  gemini: "#4285F4",
  grok: "#718096",
  deepseek: "#4D6BFE",
  mistral: "#FF7000",
};

const CHAMPION_GOLD = "#F59E0B";
const DISAGREE_RED = "#EF4444";
const AGREE_GREEN = "#10B981";

type Phase = "input" | "round1" | "sides_reveal" | "battle" | "result";

function positionBadgeStyle(position: string): { label: string; color: string } {
  const p = position.toUpperCase();
  if (p.includes("DISAGREE")) return { label: position, color: DISAGREE_RED };
  if (p.includes("AGREE")) return { label: position, color: AGREE_GREEN };
  return { label: position || "INDEPENDENT", color: "#94A3B8" };
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
  const color = ARENA_COLOR[r.ai];
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
          <span
            className="inline-flex rounded-lg px-2 py-0.5 text-xs font-bold text-white"
            style={{ backgroundColor: color }}
          >
            {name}
          </span>
          {r.champion ? (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ color: CHAMPION_GOLD, border: `1px solid ${CHAMPION_GOLD}` }}
            >
              CHAMPION <span aria-hidden>⚔️</span>
            </span>
          ) : null}
          {r.support ? (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">
              SUPPORT → {ARENA_DISPLAY[r.support as ArenaAI] ?? r.support}
            </span>
          ) : null}
        </div>
        {r.angle ? (
          <p className="mb-2 text-sm font-semibold text-white/95">&ldquo;{r.angle}&rdquo;</p>
        ) : null}
        <p
          className="mb-2 inline-block rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
          style={{ color: badge.color, backgroundColor: `${badge.color}18` }}
        >
          {badge.label}
        </p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{r.content}</p>
        {r.supportComment ? (
          <p className="mt-2 border-t border-white/10 pt-2 text-xs italic text-slate-400">
            {r.supportComment}
          </p>
        ) : null}
        <p className="mt-2 text-right text-[10px] text-slate-500">{r.responseTimeMs} ms</p>
      </div>
    </div>
  );
}

export default function ArenaPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("input");
  const [topic, setTopic] = useState("");
  const [selected, setSelected] = useState<Set<ArenaAI>>(
    () => new Set<ArenaAI>(["grok", "gpt", "gemini", "deepseek", "mistral", "claude"])
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [rounds, setRounds] = useState<ArenaRound[]>([]);
  const [currentRound, setCurrentRound] = useState(1);
  const [sides, setSides] = useState<{
    left: ArenaAI | null;
    right: ArenaAI | null;
    leftSupport: ArenaAI[];
    rightSupport: ArenaAI[];
  }>({ left: null, right: null, leftSupport: [], rightSupport: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [round1Live, setRound1Live] = useState<ArenaResponse[]>([]);
  const [battleLive, setBattleLive] = useState<ArenaResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ArenaAI | null>(null);
  const [voteDone, setVoteDone] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const roundsRef = useRef<ArenaRound[]>([]);

  const selectedList = useMemo(() => ARENA_ORDER.filter((a) => selected.has(a)), [selected]);

  const fixedCostRound1 = useMemo(() => {
    try {
      return creditsPerMessage(selectedList.length);
    } catch {
      return null;
    }
  }, [selectedList.length]);

  const battleCost = useMemo(() => {
    try {
      const n = 3 + sides.leftSupport.length + sides.rightSupport.length;
      return creditsPerMessage(n);
    } catch {
      return null;
    }
  }, [sides.leftSupport.length, sides.rightSupport.length]);

  useEffect(() => {
    roundsRef.current = rounds;
  }, [rounds]);

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
  }, [phase, round1Live, battleLive, rounds, isLoading]);

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
      onRound: (r: ArenaRound) => void
    ) => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        router.replace("/auth");
        return;
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
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setError("No response body");
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
            type: string;
            sessionId?: string;
            creditsRemaining?: number;
            response?: ArenaResponse;
            roundNumber?: number;
            round?: ArenaRound;
            error?: string;
          };
          try {
            msg = JSON.parse(line) as typeof msg;
          } catch {
            continue;
          }
          if (msg.type === "meta") onMeta(msg);
          if (msg.type === "arena_response" && msg.response && typeof msg.roundNumber === "number") {
            onResponse(msg.response, msg.roundNumber);
          }
          if (msg.type === "arena_round" && msg.round) onRound(msg.round);
          if (msg.type === "error" && msg.error) setError(msg.error);
        }
      }
    },
    [router]
  );

  const startArena = useCallback(async () => {
    const t = topic.trim();
    if (selectedList.length < 3 || selectedList.length > 6 || !t || isLoading) return;
    setError(null);
    setIsLoading(true);
    setRound1Live([]);
    setRounds([]);
    roundsRef.current = [];
    setBattleLive([]);
    setSessionId(null);
    setCurrentRound(1);
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
          setPhase("sides_reveal");
        }
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [topic, selectedList, isLoading, readNdjsonArena]);

  const runBattleRound = useCallback(
    async (roundNumber: number) => {
      const t = topic.trim();
      if (!sessionId || !sides.left || !sides.right || !t || isLoading) return;
      setError(null);
      setIsLoading(true);
      setBattleLive([]);
      setPhase("battle");
      const roundsPayload = roundsRef.current;
      try {
        await readNdjsonArena(
          {
            action: "battle",
            sessionId,
            topic: t,
            rounds: roundsPayload,
            roundNumber,
            championLeft: sides.left,
            championRight: sides.right,
            leftSupportCount: sides.leftSupport.length,
            rightSupportCount: sides.rightSupport.length,
          },
          (meta) => {
            if (typeof meta.creditsRemaining === "number") setCredits(meta.creditsRemaining);
          },
          (response) => {
            setBattleLive((prev) => [...prev, response]);
          },
          (round) => {
            setRounds((prev) => {
              const n = [...prev.filter((x) => x.roundNumber !== round.roundNumber), round];
              roundsRef.current = n;
              return n;
            });
            setCurrentRound(round.roundNumber);
            setBattleLive([]);
          }
        );
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, sides, topic, isLoading, readNdjsonArena]
  );

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

  if (!authReady) {
    return (
      <div className={`${BG} flex min-h-screen items-center justify-center`}>
        <p className="text-sm text-white/60">Loading…</p>
      </div>
    );
  }

  const leftColor = sides.left ? ARENA_COLOR[sides.left] : "#64748B";
  const rightColor = sides.right ? ARENA_COLOR[sides.right] : "#64748B";
  const battleRounds = rounds.filter((r) => r.roundNumber >= 2);
  const maxRound = rounds.length ? Math.max(...rounds.map((r) => r.roundNumber)) : 1;

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
              placeholder="주제 또는 질문을 입력하세요…"
              disabled={isLoading}
              className="min-h-[120px] w-full resize-y rounded-xl border border-white/12 bg-white/6 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-rose-400/40 focus:outline-none"
            />
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
              disabled={
                isLoading ||
                !topic.trim() ||
                selectedList.length < 3 ||
                (credits !== null && fixedCostRound1 !== null && credits < fixedCostRound1)
              }
              className="w-full rounded-2xl bg-rose-500 py-3 text-sm font-semibold text-white transition enabled:hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              START ARENA
            </button>
            <p className="text-center text-[11px] text-slate-500">
              Round 1 · {fixedCostRound1 ?? "—"} credits
            </p>
          </div>
        ) : null}

        {phase === "round1" ? (
          <div>
            <h2 className="mb-4 text-center text-lg font-bold text-white">ROUND 1 — Opening Statements</h2>
            <div className="flex flex-col gap-3">
              {round1Live.map((r) => (
                <ArenaBubble key={`${r.ai}-${r.responseTimeMs}`} r={r} align="left" repColor={ARENA_COLOR[r.ai]} />
              ))}
              {isLoading && round1Live.length === 0 ? (
                <p className="text-center text-sm text-slate-400">Connecting…</p>
              ) : null}
              {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-rose-400" />
                  Next AI is thinking…
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {phase === "sides_reveal" ? (
          <div className="fixed inset-0 z-30 flex flex-col items-center justify-center bg-[#0a0f1e]/96 px-4 backdrop-blur-md">
            <p className="mb-2 text-2xl font-bold text-white">진영이 나뉘었습니다 ⚔️</p>
            <div className="mt-6 grid w-full max-w-lg grid-cols-2 gap-4 text-center">
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
              disabled={
                isLoading ||
                !sides.left ||
                !sides.right ||
                (credits !== null && battleCost !== null && credits < battleCost)
              }
              onClick={() => void runBattleRound(2)}
              className="mt-10 rounded-2xl bg-cyan-500 px-8 py-3 text-sm font-semibold text-slate-950 transition enabled:hover:bg-cyan-400 disabled:opacity-40"
            >
              ROUND 2 시작
            </button>
            <p className="mt-2 text-[11px] text-slate-500">Battle · {battleCost ?? "—"} credits</p>
          </div>
        ) : null}

        {phase === "battle" ? (
          <div>
            <h2 className="mb-4 text-center text-lg font-bold text-white">
              ROUND {Math.max(2, currentRound)} — Battle
            </h2>
            <div className="flex flex-col gap-4">
              {battleRounds.flatMap((br) =>
                br.responses.map((r) => (
                  <ArenaBubble
                    key={`${br.roundNumber}-${r.ai}-${r.responseTimeMs}`}
                    r={r}
                    align={r.side === "right" ? "right" : "left"}
                    repColor={r.side === "right" ? rightColor : leftColor}
                  />
                ))
              )}
              {battleLive.map((r) => (
                <ArenaBubble
                  key={`live-${r.ai}-${r.responseTimeMs}`}
                  r={r}
                  align={r.side === "right" ? "right" : "left"}
                  repColor={r.side === "right" ? rightColor : leftColor}
                />
              ))}
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
                  <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
                  Battle in progress…
                </div>
              ) : null}
            </div>

            {!isLoading && maxRound === 2 ? (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  disabled={credits !== null && battleCost !== null && credits < battleCost}
                  onClick={() => void runBattleRound(3)}
                  className="rounded-xl bg-cyan-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  ROUND 3 계속
                </button>
              </div>
            ) : null}

            {maxRound >= 3 && !isLoading ? (
              <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
                <button
                  type="button"
                  onClick={() => setPhase("result")}
                  className="rounded-xl border border-white/15 bg-white/8 px-4 py-2 text-sm text-white"
                >
                  ⏹ STOP
                </button>
                <button
                  type="button"
                  onClick={() => setPhase("result")}
                  className="rounded-xl bg-amber-500/90 px-4 py-2 text-sm font-semibold text-slate-950"
                >
                  누가 맞나요? 선택하기
                </button>
                <button
                  type="button"
                  disabled={credits !== null && battleCost !== null && credits < battleCost * 3}
                  onClick={async () => {
                    for (let i = 0; i < 3; i++) {
                      const m = Math.max(1, ...roundsRef.current.map((x) => x.roundNumber));
                      await runBattleRound(m + 1);
                    }
                  }}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  ▶ +3라운드 계속
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {phase === "result" ? (
          <div className="mx-auto max-w-lg space-y-6 text-center">
            <h2 className="text-xl font-bold text-white">ARENA ENDED</h2>
            <p className="text-sm text-slate-400">총 {rounds.length} 라운드</p>
            <p className="text-sm text-slate-300">어떤 주장이 가장 설득력 있었나요?</p>
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
              {voteDone ? "저장됨" : "결과 저장"}
            </button>
            <Link href="/" className="inline-block text-sm text-cyan-400 underline">
              로비로 돌아가기
            </Link>
          </div>
        ) : null}

        <div ref={bottomRef} />
      </main>
    </div>
  );
}
