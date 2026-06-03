"use client";

import Link from "next/link";
import HelpModal from "@/components/HelpModal";
import ShareButtons from "@/components/ShareButtons";
import { arenaHelpContent } from "@/lib/help-modal/arena-content";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronLeft, Swords } from "lucide-react";
import { ModuleCreditsLink } from "@/components/credits/ModuleCreditsLink";
import { supabase } from "@/lib/db/supabase";
import { arenaExtendedBundleCreditCost, arenaFinalBundleCreditCost } from "@/lib/ai/arena-bundle";
import {
  ARENA_DISPLAY,
  ARENA_ORDER,
  type ArenaAI,
  type ArenaMemoryEntry,
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
import { buildArenaTurnRoundRows } from "@/lib/arena/build-turn-rounds";
import { ArenaTurnEndShare } from "./ArenaTurnEndShare";

function visibleArenaText(s: string): string {
  return stripArenaMarkdown(stripInternalTargetingBlock(s));
}

type FightMode = "logic" | "street";

function memoryRoleForResponse(r: ArenaResponse): ArenaMemoryEntry["role"] {
  if (r.joinedFight) return "co-fighter";
  if (r.champion) return "champion";
  return "challenger";
}

function buildArenaMemoryEntries(roundNum: number, responses: ArenaResponse[]): ArenaMemoryEntry[] {
  return responses.map((r) => {
    const parts = [
      r.angle ? `ANGLE: ${visibleArenaText(r.angle)}` : "",
      visibleArenaText(r.content),
      r.supportComment ? `SUPPORT_COMMENT: ${visibleArenaText(r.supportComment)}` : "",
    ].filter(Boolean);
    return {
      round: roundNum,
      fighter: ARENA_DISPLAY[r.ai],
      role: memoryRoleForResponse(r),
      content: parts.join("\n") || visibleArenaText(r.content),
    };
  });
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

type AiProgressRow = {
  ai: ArenaAI;
  status: "pending" | "thinking" | "done";
  startedAt?: number;
  durationMs?: number;
};

function computeBattleSeedAis(
  roundNumber: number,
  sides: { left: ArenaAI | null; right: ArenaAI | null; leftSupport: ArenaAI[]; rightSupport: ArenaAI[] },
  round1: ArenaRound | undefined
): ArenaAI[] {
  const L = sides.left;
  const R = sides.right;
  if (!L || !R) return [];
  const leftLineup = round1?.sides?.left?.length ? round1.sides.left : [L];
  const rightLineup = round1?.sides?.right?.length ? round1.sides.right : [R];
  const leftSup = leftLineup.filter((a) => a !== L);
  const rightSup = rightLineup.filter((a) => a !== R);
  if (roundNumber === 2) {
    return [L, R, ...leftSup, ...rightSup];
  }
  if (roundNumber === 3) {
    return [L, R];
  }
  if (roundNumber >= 4 && roundNumber <= 9) {
    return [L, R];
  }
  return [L, R];
}

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

function ArenaAiStreamProgress({
  rows,
  streamTick,
}: {
  rows: AiProgressRow[];
  /** Bumped while any row is thinking so elapsed time updates. */
  streamTick: number;
}) {
  void streamTick;
  const now = Date.now();
  return (
    <ul className="space-y-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left">
      {rows.map((row) => {
        const name = ARENA_DISPLAY[row.ai];
        if (row.status === "done") {
          const sec = (row.durationMs ?? 0) / 1000;
          return (
            <li key={row.ai} className="text-[12px] leading-snug text-slate-200">
              <span className="text-emerald-400" aria-hidden>
                ✅
              </span>{" "}
              <span className="font-medium" style={{ color: ARENA_COLOR[row.ai] }}>
                {name}
              </span>
              <span className="text-slate-400"> — responded ({sec.toFixed(1)}s)</span>
            </li>
          );
        }
        if (row.status === "thinking") {
          const elapsed = row.startedAt != null ? Math.max(0, Math.floor((now - row.startedAt) / 1000)) : 0;
          return (
            <li key={row.ai} className="text-[12px] leading-snug text-slate-200">
              <span className="text-amber-400" aria-hidden>
                ⏳
              </span>{" "}
              <span className="font-medium" style={{ color: ARENA_COLOR[row.ai] }}>
                {name}
              </span>
              <span className="text-slate-400"> — thinking… ({elapsed}s elapsed)</span>
            </li>
          );
        }
        return (
          <li key={row.ai} className="text-[12px] leading-snug text-slate-500">
            <span className="text-slate-600" aria-hidden>
              ○
            </span>{" "}
            <span className="font-medium text-slate-500">{name}</span>
            <span className="text-slate-600"> — waiting…</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function ArenaPage() {
  const router = useRouter();
  const [credits, setCredits] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("input");
  const [mobileWarningDismissed, setMobileWarningDismissed] = useState(false);
  const [topic, setTopic] = useState("");
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
  const [aiProgressRows, setAiProgressRows] = useState<AiProgressRow[]>([]);
  const [streamTick, setStreamTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ArenaAI | null>(null);
  const [voteDone, setVoteDone] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const roundsRef = useRef<ArenaRound[]>([]);
  /** Avoid concurrent battle requests while one NDJSON round is streaming. */
  const battleInflightRef = useRef(false);
  const arenaFinalBundleTokenRef = useRef<string | null>(null);
  const arenaExtendedBundleTokenRef = useRef<string | null>(null);
  const arenaMemoryRef = useRef<ArenaMemoryEntry[]>([]);

  const [fightMode, setFightMode] = useState<FightMode>("logic");
  /** 0 = rounds 1–3 bracket, 1 = purchased/played 4–6, 2 = purchased/played 7–9 */
  const [continueStage, setContinueStage] = useState(0);
  const [arenaMemory, setArenaMemory] = useState<ArenaMemoryEntry[]>([]);

  useEffect(() => {
    arenaMemoryRef.current = arenaMemory;
  }, [arenaMemory]);

  useEffect(() => {
    if (!isLoading || !aiProgressRows.some((r) => r.status === "thinking")) return undefined;
    const id = setInterval(() => setStreamTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isLoading, aiProgressRows]);

  /** Lobby always sends all six AIs; selection UI is display-only. */
  const selectedList = useMemo(() => [...ARENA_ORDER], []);

  const finalBundleCost = useMemo(() => {
    try {
      return arenaFinalBundleCreditCost();
    } catch {
      return null;
    }
  }, []);

  const extendedBundleCost = useMemo(() => {
    try {
      return arenaExtendedBundleCreditCost();
    } catch {
      return null;
    }
  }, []);

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
  }, [phase, round1Live, battleLive, rounds, isLoading, round1Complete, awaitingNextBattleRound, aiProgressRows]);

  const markResponseProgress = useCallback((r: ArenaResponse) => {
    setAiProgressRows((prev) => {
      const idx = prev.findIndex((x) => x.ai === r.ai);
      if (idx < 0) {
        return [...prev, { ai: r.ai, status: "done" as const, durationMs: r.responseTimeMs }];
      }
      return prev.map((row, i) =>
        i === idx
          ? { ...row, status: "done" as const, durationMs: r.responseTimeMs, startedAt: undefined }
          : row
      );
    });
  }, []);

  const handleArenaThinking = useCallback(({ ai, roundNumber }: { ai: ArenaAI; roundNumber: number }) => {
    const now = Date.now();
    setAiProgressRows((prev) => {
      const idx = prev.findIndex((row) => row.ai === ai);
      if (idx >= 0) {
        return prev.map((row, i) => (i === idx ? { ...row, status: "thinking" as const, startedAt: now } : row));
      }
      const L = sides.left;
      const R = sides.right;
      if (roundNumber >= 4 && roundNumber <= 9 && L != null && R != null && ai !== L && ai !== R) {
        const rIdx = prev.findIndex((row) => row.ai === R);
        if (rIdx >= 0) {
          const copy = [...prev];
          copy.splice(rIdx, 0, { ai, status: "thinking" as const, startedAt: now });
          return copy;
        }
      }
      return [...prev, { ai, status: "thinking" as const, startedAt: now }];
    });
  }, [sides.left, sides.right]);

  const readNdjsonArena = useCallback(
    async (
      body: Record<string, unknown>,
      onMeta: (m: { sessionId?: string; creditsRemaining?: number }) => void,
      onResponse: (r: ArenaResponse, roundNumber: number) => void,
      onRound: (r: ArenaRound) => void,
      onThinking?: (payload: { ai: ArenaAI; roundNumber: number }) => void
    ): Promise<boolean> => {
      const res = await fetch("/api/ai-arena", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
    setAiProgressRows([]);
    setStreamTick(0);
    setDisplayBattleRound(1);
    arenaFinalBundleTokenRef.current = null;
    arenaExtendedBundleTokenRef.current = null;
    setContinueStage(0);
    setArenaMemory([]);
    arenaMemoryRef.current = [];
  }, []);

  const logArenaMemoryToServer = useCallback(async () => {
    const sid = sessionId;
    const mem = arenaMemoryRef.current;
    if (!sid || mem.length === 0) return;
    try {
      await fetch("/api/ai-arena", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "arena_log_memory",
          sessionId: sid,
          arenaMemory: mem,
        }),
      });
    } catch {
      /* best-effort */
    }
  }, [sessionId]);

  const goToResultPhase = useCallback(() => {
    void logArenaMemoryToServer();
    setPhase("result");
  }, [logArenaMemoryToServer]);

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
        fightMode,
        arenaMemory: arenaMemoryRef.current,
      };
      if (roundNumber >= 7 && arenaFinalBundleTokenRef.current && arenaExtendedBundleTokenRef.current) {
        return {
          ...base,
          arenaFinalBundleToken: arenaFinalBundleTokenRef.current,
          arenaExtendedBundleToken: arenaExtendedBundleTokenRef.current,
        };
      }
      if (roundNumber >= 4 && arenaFinalBundleTokenRef.current) {
        return {
          ...base,
          arenaFinalBundleToken: arenaFinalBundleTokenRef.current,
        };
      }
      return base;
    },
    [sessionId, sides, topic, fightMode]
  );

  const purchaseArenaFinalBundleIfNeeded = useCallback(async (): Promise<boolean> => {
    if (arenaFinalBundleTokenRef.current) {
      setContinueStage((s) => (s < 1 ? 1 : s));
      return true;
    }
    if (!sessionId) return false;
    const res = await fetch("/api/ai-arena", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "arena_buy_final_bundle",
        sessionId,
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
    setContinueStage(1);
    return Boolean(arenaFinalBundleTokenRef.current);
  }, [router, sessionId]);

  const purchaseArenaExtendedBundleIfNeeded = useCallback(async (): Promise<boolean> => {
    if (arenaExtendedBundleTokenRef.current) {
      setContinueStage((s) => (s < 2 ? 2 : s));
      return true;
    }
    if (!sessionId) return false;
    const res = await fetch("/api/ai-arena", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "arena_buy_extended_bundle",
        sessionId,
      }),
    });
    const j = (await res.json().catch(() => null)) as {
      arenaExtendedBundleToken?: string;
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
    if (typeof j?.arenaExtendedBundleToken === "string") {
      arenaExtendedBundleTokenRef.current = j.arenaExtendedBundleToken;
    }
    setContinueStage(2);
    return Boolean(arenaExtendedBundleTokenRef.current);
  }, [sessionId]);

  const startArena = useCallback(async () => {
    const t = topic.trim();
    if (!t || isLoading) return;
    setError(null);
    setIsLoading(true);
    resetArenaUi();
    setPhase("round1");
    try {
      flushSync(() => {
        setAiProgressRows(selectedList.map((ai) => ({ ai, status: "pending" as const })));
      });
      await readNdjsonArena(
        { action: "start", topic: t, selectedAIs: selectedList, fightMode, arenaMemory: [] },
        (meta) => {
          if (meta.sessionId) setSessionId(meta.sessionId);
          if (typeof meta.creditsRemaining === "number") setCredits(meta.creditsRemaining);
        },
        (response) => {
          markResponseProgress(response);
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
          const mem = buildArenaMemoryEntries(1, round.responses);
          arenaMemoryRef.current = mem;
          setArenaMemory(mem);
        },
        handleArenaThinking
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [topic, selectedList, isLoading, readNdjsonArena, resetArenaUi, fightMode, markResponseProgress, handleArenaThinking]);

  const battleUiRoundComplete = useCallback(
    (roundComplete: ArenaRound) => {
      const rn = Number(roundComplete.roundNumber);
      setDisplayBattleRound(rn);
      setRounds((prev) => {
        const n = [...prev.filter((x) => x.roundNumber !== roundComplete.roundNumber), roundComplete];
        roundsRef.current = n;
        return n;
      });
      setBattleLive([]);
      const add = buildArenaMemoryEntries(rn, roundComplete.responses);
      setArenaMemory((prev) => {
        const next = [...prev, ...add];
        arenaMemoryRef.current = next;
        return next;
      });
      if (rn === 2) setAwaitingNextBattleRound(true);
      else setAwaitingNextBattleRound(false);
    },
    []
  );

  const runBattleRound = useCallback(
    async (roundNumber: number) => {
      if (!sessionId || !sides.left || !sides.right || !topic.trim()) {
        return false;
      }
      if (roundNumber > 9) {
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
        const r1 = rounds.find((r) => r.roundNumber === 1);
        flushSync(() => {
          setAiProgressRows(
            computeBattleSeedAis(roundNumber, sides, r1).map((ai) => ({ ai, status: "pending" as const }))
          );
        });
        const okStream = await readNdjsonArena(
          mergeBattleBodyForRound(roundNumber),
          (meta) => {
            if (typeof meta.creditsRemaining === "number") setCredits(meta.creditsRemaining);
          },
          (response) => {
            markResponseProgress(response);
            setBattleLive((prev) => [...prev, response]);
          },
          battleUiRoundComplete,
          handleArenaThinking
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
    [battleUiRoundComplete, mergeBattleBodyForRound, readNdjsonArena, sessionId, sides, topic, rounds, markResponseProgress, handleArenaThinking]
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
      const r1 = rounds.find((r) => r.roundNumber === 1);
      for (const rn of sequence) {
        setBattleLive([]);
        setDisplayBattleRound(rn);
        flushSync(() => {
          setAiProgressRows(
            computeBattleSeedAis(rn, sides, r1).map((ai) => ({ ai, status: "pending" as const }))
          );
        });
        const okStream = await readNdjsonArena(
          mergeBattleBodyForRound(rn),
          (meta) => {
            if (typeof meta.creditsRemaining === "number") setCredits(meta.creditsRemaining);
          },
          (response) => {
            markResponseProgress(response);
            setBattleLive((prev) => [...prev, response]);
          },
          battleUiRoundComplete,
          handleArenaThinking
        );
        if (!okStream) break;
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      battleInflightRef.current = false;
      setIsLoading(false);
      setBattleLive([]);
    }
  }, [
    battleUiRoundComplete,
    mergeBattleBodyForRound,
    purchaseArenaFinalBundleIfNeeded,
    readNdjsonArena,
    sessionId,
    sides,
    topic,
    rounds,
    markResponseProgress,
    handleArenaThinking,
  ]);

  /**
   * Rounds 7–9: purchase extended bundle once (credit deduction), then sequential API rounds
   * 7 → 8 → 9. After round 9, stay on battle view until user opens voting ("Vote ▶ Who won?").
   */
  const runFinalRounds789 = useCallback(async () => {
    const t = topic.trim();
    if (!sessionId || !sides.left || !sides.right || !t) return;
    if (battleInflightRef.current) return;
    setError(null);
    battleInflightRef.current = true;
    setIsLoading(true);
    setPhase("battle");
    setAwaitingNextBattleRound(false);
    try {
      const purchased = await purchaseArenaExtendedBundleIfNeeded();
      if (!purchased) return;

      const sequence = [7, 8, 9];
      const r1 = rounds.find((r) => r.roundNumber === 1);
      for (const rn of sequence) {
        setBattleLive([]);
        setDisplayBattleRound(rn);
        flushSync(() => {
          setAiProgressRows(
            computeBattleSeedAis(rn, sides, r1).map((ai) => ({ ai, status: "pending" as const }))
          );
        });
        const okStream = await readNdjsonArena(
          mergeBattleBodyForRound(rn),
          (meta) => {
            if (typeof meta.creditsRemaining === "number") setCredits(meta.creditsRemaining);
          },
          (response) => {
            markResponseProgress(response);
            setBattleLive((prev) => [...prev, response]);
          },
          battleUiRoundComplete,
          handleArenaThinking
        );
        if (!okStream) break;
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      battleInflightRef.current = false;
      setIsLoading(false);
      setBattleLive([]);
    }
  }, [
    battleUiRoundComplete,
    mergeBattleBodyForRound,
    purchaseArenaExtendedBundleIfNeeded,
    readNdjsonArena,
    sessionId,
    sides,
    topic,
    rounds,
    markResponseProgress,
    handleArenaThinking,
  ]);

  const submitVote = useCallback(async () => {
    // Arena winner vote: no credit charge (see /api/ai-arena `action: "vote"`).
    if (!sessionId || !picked) return;
    const res = await fetch("/api/ai-arena", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "vote",
        sessionId,
        chosenAi: picked,
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

  const showPostRoundNineViewFinal =
    phase === "battle" && maxRound === 9 && !awaitingNextBattleRound && !isLoading;

  const turn1ShareRows = useMemo(
    () => buildArenaTurnRoundRows(rounds, 1, ARENA_DISPLAY, visibleArenaText),
    [rounds]
  );
  const turn2ShareRows = useMemo(
    () => buildArenaTurnRoundRows(rounds, 2, ARENA_DISPLAY, visibleArenaText),
    [rounds]
  );
  const turn3ShareRows = useMemo(
    () => buildArenaTurnRoundRows(rounds, 3, ARENA_DISPLAY, visibleArenaText),
    [rounds]
  );

  return (
    <div className={BG}>
      <HelpModal content={arenaHelpContent} />
      <header className="fixed left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#0a0f1e]/95 px-3 py-2.5 backdrop-blur-md sm:px-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-2 text-sm text-white/90 transition hover:bg-white/14"
        >
          <ChevronLeft className="h-4 w-4" />
          Lobby
        </Link>
        <ModuleCreditsLink />
      </header>

      <main className="mx-auto max-w-3xl px-3 pb-40 pt-16 sm:px-4">
        {phase === "input" && !mobileWarningDismissed ? (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 md:hidden">
            <p className="leading-relaxed">
              ⚠️ Arena works best on PC or Wi-Fi. Mobile data often causes disconnections during long battles.
            </p>
            <button
              type="button"
              onClick={() => setMobileWarningDismissed(true)}
              className="shrink-0 rounded-lg px-2 py-1 text-xs text-amber-200/80 hover:bg-white/10 hover:text-amber-100"
              aria-label="Dismiss warning"
            >
              ✕
            </button>
          </div>
        ) : null}
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
            <p className="text-center text-xs font-medium uppercase tracking-wide text-slate-500">
              Fight style
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setFightMode("logic")}
                className={`rounded-2xl border px-4 py-4 text-left transition ${
                  fightMode === "logic"
                    ? "border-sky-400/60 bg-sky-500/15 shadow-[0_0_24px_rgba(56,189,248,0.12)]"
                    : "border-white/10 bg-white/[0.04] hover:border-white/20"
                }`}
              >
                <div className="text-2xl" aria-hidden>
                  ⚖️
                </div>
                <div className="mt-2 text-sm font-bold text-sky-100">LOGIC BATTLE</div>
                <div className="mt-1 text-xs text-sky-200/80">Evidence · Logic · Counter-argument</div>
              </button>
              <button
                type="button"
                onClick={() => setFightMode("street")}
                className={`rounded-2xl border px-4 py-4 text-left transition ${
                  fightMode === "street"
                    ? "border-orange-500/60 bg-orange-600/15 shadow-[0_0_24px_rgba(251,146,60,0.12)]"
                    : "border-white/10 bg-white/[0.04] hover:border-white/20"
                }`}
              >
                <div className="text-2xl" aria-hidden>
                  🔥
                </div>
                <div className="mt-2 text-sm font-bold text-orange-100">STREET FIGHT</div>
                <div className="mt-1 text-xs text-orange-200/85">Emotion · Mockery · Personal attacks allowed</div>
              </button>
            </div>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Enter a topic or question for the panel to debate…"
              disabled={isLoading}
              className="min-h-[120px] w-full resize-y rounded-xl border border-white/12 bg-white/6 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-rose-400/40 focus:outline-none"
            />
            <p className="text-xs leading-relaxed text-slate-500">
              Term 1 (Rounds 1–3): 6 credits · Continue ▶ Term 2 (Rounds 4–6): +6 credits · Continue ▶ Term 3
              (Rounds 7–9): +6 credits · Full game total: 18 credits
            </p>
            <div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ARENA_ORDER.map((ai) => (
                  <div
                    key={ai}
                    className="flex cursor-default items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-2.5 text-sm pointer-events-none opacity-70"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: ARENA_COLOR[ai] }}
                    />
                    <span className="font-medium text-white">{ARENA_DISPLAY[ai]}</span>
                  </div>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void startArena()}
              disabled={isLoading || !topic.trim()}
              className="w-full rounded-2xl bg-rose-500 py-3 text-sm font-semibold text-white transition enabled:hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              START ARENA
            </button>
          </div>
        ) : null}

        {phase === "round1" ? (
          <div>
            <h2 className="mb-4 text-center text-lg font-bold text-white">ROUND 1 / 9 — Opening Statements</h2>
            {isLoading && aiProgressRows.length > 0 ? (
              <div className="mb-4">
                <ArenaAiStreamProgress rows={aiProgressRows} streamTick={streamTick} />
              </div>
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
              {isLoading && round1Live.length === 0 && aiProgressRows.length === 0 ? (
                <p className="text-center text-sm text-slate-400">Connecting…</p>
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
              ROUND {displayBattleRound} / 9 — Battle
            </h2>
            {isLoading && aiProgressRows.length > 0 ? (
              <div className="mb-4">
                <ArenaAiStreamProgress rows={aiProgressRows} streamTick={streamTick} />
              </div>
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
              {isLoading && aiProgressRows.length === 0 ? (
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
                  End here, judge, or Continue ▶ for rounds 4–6 (single credit package).
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => goToResultPhase()}
                    className="rounded-xl border border-white/15 bg-white/8 px-4 py-2 text-sm text-white"
                  >
                    STOP
                  </button>
                  <button
                    type="button"
                    onClick={() => goToResultPhase()}
                    className="rounded-xl bg-amber-500/90 px-4 py-2 text-sm font-semibold text-slate-950"
                  >
                    Who was right? Vote
                  </button>
                  <div className="flex w-full min-w-[min(100%,16rem)] flex-col items-center gap-1.5 sm:w-auto">
                    <button
                      type="button"
                      disabled={
                        isLoading ||
                        (finalBundleCost != null && credits !== null && credits < finalBundleCost)
                      }
                      onClick={() => void runFinalRounds456()}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      Continue ▶ (rounds 4–6, uses credits)
                    </button>
                    <p className="max-w-xs text-center text-[11px] font-normal leading-snug text-slate-300 opacity-50">
                      Most debates heat up in round 4–6. Worth continuing.
                    </p>
                  </div>
                </div>
                <ArenaTurnEndShare
                  key={`${sessionId ?? "arena"}-turn-1`}
                  active={showPostRoundThreeActions}
                  topic={topic}
                  turnNumber={1}
                  rounds={turn1ShareRows}
                />
              </div>
            ) : null}

            {showPostRoundSixEndActions ? (
              <div className="mt-8 flex flex-col items-center gap-3">
                <p className="max-w-md text-center text-sm text-slate-400">
                  Final stretch: Continue ▶ for rounds 7–9 (same credit package cost as 4–6), or end and
                  vote.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => goToResultPhase()}
                    className="rounded-xl border border-white/15 bg-white/8 px-4 py-2 text-sm text-white"
                  >
                    STOP
                  </button>
                  <button
                    type="button"
                    onClick={() => goToResultPhase()}
                    className="rounded-xl bg-amber-500/90 px-4 py-2 text-sm font-semibold text-slate-950"
                  >
                    Who was right? Vote
                  </button>
                  <button
                    type="button"
                    disabled={
                      isLoading ||
                      (extendedBundleCost != null &&
                        credits !== null &&
                        credits < extendedBundleCost)
                    }
                    onClick={() => void runFinalRounds789()}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Continue ▶ (rounds 7–9, uses credits)
                  </button>
                </div>
                <ArenaTurnEndShare
                  key={`${sessionId ?? "arena"}-turn-2`}
                  active={showPostRoundSixEndActions}
                  topic={topic}
                  turnNumber={2}
                  rounds={turn2ShareRows}
                />
              </div>
            ) : null}

            {showPostRoundNineViewFinal ? (
              <div className="mt-8 flex flex-col items-center gap-2">
                <p className="text-center text-sm text-slate-400">
                  Round 9 is complete. Pick who was most convincing.
                </p>
                <button
                  type="button"
                  onClick={() => goToResultPhase()}
                  className="rounded-xl bg-cyan-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500"
                >
                  Vote ▶ Who won?
                </button>
                <ArenaTurnEndShare
                  key={`${sessionId ?? "arena"}-turn-3`}
                  active={showPostRoundNineViewFinal}
                  topic={topic}
                  turnNumber={3}
                  rounds={turn3ShareRows}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {phase === "result" ? (
          <div className="mx-auto max-w-lg space-y-6 text-center">
            {maxRound < 9 ? (
              <>
                <h2 className="text-xl font-bold text-white">ARENA ENDED</h2>
                <p className="text-sm text-slate-400">
                  {rounds.length} round(s) played
                  {continueStage > 0 ? ` · extension ${continueStage}/2` : null}
                </p>
              </>
            ) : (
              <h2 className="text-xl font-bold text-white">Who won?</h2>
            )}
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
            {voteDone ? <ShareButtons modeName="ARENA" className="mt-4 text-left" /> : null}
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
