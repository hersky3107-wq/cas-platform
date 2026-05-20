"use client";

import Link from "next/link";
import ShareButtons from "@/components/ShareButtons";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Gavel } from "lucide-react";
import { supabase } from "@/lib/db/supabase";
import { suitCounselSelectorMeta } from "@/lib/ai/suit-prompts";
import type { SuitClientConfig, SuitLegalRole, SuitMessage } from "@/lib/ai/suit-types";

const STORAGE_KEY = "cas-suit-live";

type Packed = { sessionId: string } & SuitClientConfig;

const BG = "min-h-screen bg-[#0a0f1e] text-white";

const PROVIDER_ACCENT: Record<string, string> = {
  openai: "#10A37F",
  anthropic: "#D97757",
  google: "#4285F4",
  xai: "#6B7280",
  deepseek: "#4D6BFE",
  mistral: "#FF7000",
  user: "#94A3B8",
  opus_judge: "#F59E0B",
};

function roleBadgeStyles(role: SuitLegalRole): { label: string; bg: string; text: string } {
  switch (role) {
    case "prosecutor":
      return { label: "PROSECUTOR", bg: "#DC2626", text: "#fff" };
    case "defense":
      return { label: "DEFENSE", bg: "#2563EB", text: "#fff" };
    case "counsel_a":
      return { label: "COUNSEL A", bg: "#d97706", text: "#fff" };
    case "counsel_b":
      return { label: "COUNSEL B", bg: "#0d9488", text: "#fff" };
    case "judge":
      return { label: "JUDGE", bg: "#92400e", text: "#fde68a" };
    case "user":
      return { label: "YOU", bg: "#475569", text: "#fff" };
  }
}

function phaseRibbon(phase: string): string {
  if (phase === "opening") return "OPENING — BENCH";
  if (phase === "counsel_opening") return "OPENING — BENCH";
  if (phase === "witness_stand") return "WITNESS STAND";
  if (phase.startsWith("counsel_exchange_")) {
    const n = phase.replace("counsel_exchange_", "");
    return `EXCHANGE ${n}`;
  }
  if (phase === "witness_exam") return "WITNESS EXAMINATION";
  const m = /^round_(\d+)$/.exec(phase);
  if (m) {
    const r = m[1];
    if (r === "1") return "ROUND 1 — OPENING STATEMENTS";
    if (r === "2") return "ROUND 2 — EVIDENCE & ARGUMENT";
    if (r === "3") return "ROUND 3 — REBUTTAL";
    return `ROUND ${r}`;
  }
  if (phase === "verdict") return "VERDICT";
  return phase.replace(/_/g, " ").toUpperCase();
}

function extractFinding(verdict: string): string | null {
  const m = /FINDING:\s*([\s\S]*?)(?=DISSENT\s*NOTE:|$)/i.exec(verdict);
  return m?.[1]?.trim() ?? null;
}

function localizeVerdictLabelsKo(verdict: string): string {
  return verdict
    .replace(/^\s*RULING\s*:/gim, "판결:")
    .replace(/^\s*FINDING\s*:/gim, "판결 이유:")
    .replace(/^\s*DISSENT\s*NOTE\s*:/gim, "주목할 반론:");
}

function parseWinnerSideBucketFromVerdict(verdict: string, format: "criminal" | "civil"): "side_a" | "side_b" | null {
  const rulingLine = verdict.split("\n").find((l) => /판결\s*:|ruling\s*:/i.test(l)) ?? verdict;
  const s = rulingLine.replace(/\s+/g, " ").trim();
  if (format === "criminal") {
    if (/검찰\s*승소/.test(s)) return "side_a";
    if (/변호인\s*승소/.test(s)) return "side_b";
    return null;
  }
  if (/A측\s*승소/i.test(s)) return "side_a";
  if (/B측\s*승소/i.test(s)) return "side_b";
  return null;
}

function GeminiNameStripe({ label }: { label: string }) {
  const short = label.length > 42 ? `${label.slice(0, 40)}…` : label;
  return (
    <span className="inline-flex min-w-0 shrink-0 items-center rounded-lg border border-white/20 bg-[#171717] px-2 py-0.5 text-[11px] font-bold">
      <span
        className="min-w-0 truncate bg-clip-text font-semibold text-transparent"
        style={{
          backgroundImage: "linear-gradient(90deg, #4285F4, #EA4335, #FBBC05, #34A853)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
        }}
      >
        {short}
      </span>
    </span>
  );
}

function TranscriptBubble({ m }: { m: SuitMessage }) {
  const isJudge = m.provider === "opus_judge";
  const rb = roleBadgeStyles(m.role);
  const accent = PROVIDER_ACCENT[m.provider] ?? "#64748b";
  const isGemini = m.provider === "google";

  if (isJudge && m.phase === "verdict") {
    return null;
  }

  const inner = (
    <div
      className={`w-full max-w-[min(100%,620px)] rounded-2xl border px-4 py-3 ${
        isJudge
          ? "border-amber-400/55 bg-black/35 text-center shadow-[0_0_32px_rgba(245,158,11,0.08)]"
          : "border-white/12 bg-[#131c35]/95"
      }`}
      style={
        isJudge
          ? undefined
          : {
              borderLeftWidth: 3,
              borderLeftColor: accent,
            }
      }
    >
      <div
        className={`mb-2 flex flex-wrap items-center justify-center gap-2 ${isJudge ? "" : "justify-between"}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          {isGemini ? (
            <GeminiNameStripe label={m.displayName} />
          ) : (
            <span className="text-xs font-semibold text-white/90">{m.displayName}</span>
          )}
          <span
            className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ backgroundColor: rb.bg, color: rb.text }}
          >
            {rb.label}
          </span>
        </div>
        {!isJudge ? (
          <span className="text-[10px] uppercase tracking-wider text-white/40">{phaseRibbon(m.phase)}</span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-amber-200/70">{phaseRibbon(m.phase)}</span>
        )}
      </div>
      <p className="whitespace-pre-wrap text-left text-sm leading-relaxed text-white/85">{m.content}</p>
    </div>
  );

  return <div className={`flex w-full ${isJudge ? "justify-center px-2" : "justify-start px-2"}`}>{inner}</div>;
}

function VerdictCard({ text, animate }: { text: string; animate: boolean }) {
  return (
    <div
      className={`mx-auto mt-10 w-full max-w-[min(100%,680px)] transition-all duration-700 ease-out ${
        animate ? "translate-y-0 scale-100 opacity-100" : "translate-y-4 scale-[0.98] opacity-0"
      }`}
    >
      <div
        className="rounded-2xl border-2 border-amber-700/55 bg-[#f5ecd7] px-6 py-5 text-[#1c1917] shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
        style={{
          backgroundImage:
            "linear-gradient(165deg, rgba(255,255,255,0.12) 0%, transparent 40%), radial-gradient(circle at 20% 0%, rgba(245,158,11,0.14), transparent 55%)",
        }}
      >
        <div className="mb-3 flex items-center justify-center gap-2 text-amber-900">
          <Gavel className="h-5 w-5" />
          <span className="text-xs font-bold uppercase tracking-[0.35em]">Verdict of the Court</span>
        </div>
        <p className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-stone-900">
          {localizeVerdictLabelsKo(text)}
        </p>
      </div>
    </div>
  );
}

export default function SuitSessionPage() {
  const router = useRouter();
  const [pack, setPack] = useState<Packed | null>(null);
  const [messages, setMessages] = useState<SuitMessage[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [awaitingNext, setAwaitingNext] = useState(false);
  const [awaitWitness, setAwaitWitness] = useState(false);
  const [witnessText, setWitnessText] = useState("");
  const [verdictText, setVerdictText] = useState<string | null>(null);
  const [verdictReveal, setVerdictReveal] = useState(false);
  const [voteDone, setVoteDone] = useState(false);
  const [voteThanks, setVoteThanks] = useState(false);
  const [completedRound, setCompletedRound] = useState(0);
  const [openingDone, setOpeningDone] = useState(false);
  const [verdictRequesting, setVerdictRequesting] = useState(false);

  /** Counsel */
  const [counselExchange, setCounselExchange] = useState(0);
  const [counselDraft, setCounselDraft] = useState("");
  const [counselBusy, setCounselBusy] = useState(false);
  const [humanPrevails, setHumanPrevails] = useState<boolean | null>(null);
  const [counselRevealDone, setCounselRevealDone] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const spectatorStreamStarted = useRef<string | null>(null);
  const counselStreamStarted = useRef<string | null>(null);
  const lastSpectatorChunkAt = useRef<number>(0);

  const awaitingLabel = useMemo(() => {
    if (!pack) return "Awaiting next statement…";
    const round = Math.min(3, Math.max(1, completedRound + 1));
    const meta = (p: string) => suitCounselSelectorMeta(p as any);
    const a = pack.assignments.find((x) => x.sideBucket === "side_a" && x.role !== "judge" && x.provider !== "user");
    const b = pack.assignments.find((x) => x.sideBucket === "side_b" && x.role !== "judge" && x.provider !== "user");
    const nextProvider = (round % 2 === 1 ? a?.provider : b?.provider) ?? a?.provider ?? b?.provider ?? "ai";
    const m = meta(String(nextProvider));
    const name = m ? `${m.nameEn} (${m.epithetKo})` : String(nextProvider);
    return `Round ${round} · Waiting for ${name}...`;
  }, [pack, completedRound]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, awaitWitness, loading, verdictText, counselExchange]);

  useEffect(() => {
    if (completedRound >= 3 && !verdictText) {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }
  }, [completedRound, verdictText]);

  useEffect(() => {
    if (!loading || awaitWitness || verdictText) {
      setAwaitingNext(false);
      return;
    }
    const id = window.setInterval(() => {
      const t = lastSpectatorChunkAt.current;
      if (!t) return;
      setAwaitingNext(Date.now() - t > 260);
    }, 150);
    return () => window.clearInterval(id);
  }, [loading, awaitWitness, verdictText]);

  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      sessionStorage.removeItem(STORAGE_KEY);
      router.replace("/modes/suit");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Packed;
      if (!parsed?.sessionId || !parsed.topic || !parsed.format || !parsed.participationMode) {
        sessionStorage.removeItem(STORAGE_KEY);
        router.replace("/modes/suit");
        return;
      }
      setPack(parsed);
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
      router.replace("/modes/suit");
    }
  }, [router]);

  useEffect(() => {
    if (!pack) return;
    setCounselRevealDone(pack.participationMode !== "counsel");
  }, [pack?.sessionId, pack?.participationMode]);

  useEffect(() => {
    if (!verdictText) {
      setVerdictReveal(false);
      return;
    }
    const t = requestAnimationFrame(() => {
      setVerdictReveal(true);
    });
    return () => cancelAnimationFrame(t);
  }, [verdictText]);

  const topicTitle = pack?.topic?.slice(0, 120) ?? "";
  const formatBadge = pack?.format?.toUpperCase() ?? "";

  const ribbonLabel = useMemo(() => {
    if (verdictText) return "VERDICT DELIVERED";
    const last = messages.filter((x) => x.phase !== "verdict").pop();
    if (!last) return "IN SESSION";
    return phaseRibbon(last.phase);
  }, [messages, verdictText]);

  const counselRoleHumanLabel = useMemo(() => {
    if (!pack || pack.participationMode !== "counsel" || !pack.userCounselRole) return "";
    if (pack.format === "criminal") {
      return pack.userCounselRole === "prosecutor" ? "Prosecutor" : "Defense Counsel";
    }
    return pack.userCounselRole === "counsel_a" ? "Counsel A" : "Counsel B";
  }, [pack]);

  const yourCounselLine = useMemo(() => {
    if (!pack || pack.participationMode !== "counsel") return null;
    const role =
      pack.format === "criminal"
        ? pack.userCounselRole === "prosecutor"
          ? "검사"
          : "변호인"
        : pack.userCounselRole === "counsel_a"
          ? "Counsel A"
          : "Counsel B";
    return `본인 (직접 참여) · ${role}`;
  }, [pack]);

  const opposingCounselLine = useMemo(() => {
    const opp = pack?.opponentProvider;
    if (!opp) return null;
    const m = suitCounselSelectorMeta(opp);
    return m ? `${m.nameEn} — ${m.epithetKo}` : opp;
  }, [pack]);

  const readSpectatorWitnessStream = useCallback(
    async (body: Record<string, unknown>) => {
      setLoading(true);
      setAwaitingNext(false);
      lastSpectatorChunkAt.current = Date.now();
      setStreamError(null);
      const res = await fetch("/api/suit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string };
        setStreamError(j?.error ?? "Stream failed.");
        setLoading(false);
        return false;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setStreamError("No stream.");
        setLoading(false);
        return false;
      }
      const decoder = new TextDecoder();
      let buf = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let msg: {
              type: string;
              message?: SuitMessage;
              messages?: SuitMessage[];
              error?: string;
              verdictText?: string;
            };
            try {
              msg = JSON.parse(line) as typeof msg;
            } catch {
              continue;
            }
            if (msg.type === "error" && msg.error) {
              setStreamError(msg.error);
            }
            if (msg.type === "suit_message" && msg.message) {
              lastSpectatorChunkAt.current = Date.now();
              setMessages((prev) => [...prev, msg.message!]);
              await new Promise<void>((resolve) => {
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => resolve());
                });
              });
            }
            if (msg.type === "partial" && Array.isArray(msg.messages)) {
              lastSpectatorChunkAt.current = Date.now();
              setMessages((prev) => {
                if (prev.length === 0) return msg.messages as SuitMessage[];
                const next = msg.messages as SuitMessage[];
                if (next.length <= prev.length) return prev;
                return [...prev, ...next.slice(prev.length)];
              });
              await new Promise<void>((resolve) => {
                requestAnimationFrame(() => resolve());
              });
            }
            if (msg.type === "need_witness") {
              lastSpectatorChunkAt.current = Date.now();
              setAwaitWitness(true);
            }
            if (msg.type === "complete" && typeof msg.verdictText === "string") {
              lastSpectatorChunkAt.current = Date.now();
              setVerdictText(msg.verdictText);
            }
          }
        }
      } finally {
        setLoading(false);
        setAwaitingNext(false);
      }
      return true;
    },
    [router]
  );

  const runStep = useCallback(
    async (step: "opening" | "round" | "witness_exam" | "verdict", roundNumber?: number, wt?: string) => {
      if (!pack) return false;
      return await readSpectatorWitnessStream({
        action: "suit_step",
        step,
        roundNumber,
        witnessTestimony: wt,
        sessionId: pack.sessionId,
        topic: pack.topic,
        format: pack.format,
        participationMode: pack.participationMode,
        assignments: pack.assignments,
        messages,
      });
    },
    [pack, messages, readSpectatorWitnessStream]
  );

  const resetSpectatorState = useCallback(() => {
    setMessages([]);
    setVerdictText(null);
    setAwaitWitness(false);
    setVoteDone(false);
    setCompletedRound(0);
    setOpeningDone(false);
  }, []);

  useEffect(() => {
    if (!pack) return;
    if (pack.participationMode === "counsel") return;
    if (spectatorStreamStarted.current === pack.sessionId) return;
    spectatorStreamStarted.current = pack.sessionId;
    resetSpectatorState();
    void runStep("opening").then((ok) => {
      if (ok) setOpeningDone(true);
    });
  }, [pack, resetSpectatorState, runStep]);

  const submitWitness = async () => {
    if (!pack) return;
    const t = witnessText.trim().slice(0, 200);
    if (!t) {
      setStreamError("Enter your testimony.");
      return;
    }
    setAwaitWitness(false);
    setWitnessText("");
    await runStep("witness_exam", undefined, t);
  };

  const counselStart = useCallback(async () => {
    if (!pack || pack.participationMode !== "counsel") return;
    setMessages([]);
    setVerdictText(null);
    setCounselExchange(0);
    setHumanPrevails(null);
    setVoteDone(false);
    setCounselBusy(true);
    try {
      const res = await fetch("/api/suit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "counsel_opening",
          sessionId: pack.sessionId,
          topic: pack.topic,
        }),
      });
      const j = (await res.json().catch(() => null)) as { messages?: SuitMessage[]; error?: string };
      if (!res.ok || !j?.messages) {
        setStreamError(j?.error ?? "Opening failed.");
        return;
      }
      setMessages(j.messages);
      setCounselExchange(1);
    } finally {
      setCounselBusy(false);
    }
  }, [pack]);

  useEffect(() => {
    if (!pack || pack.participationMode !== "counsel") return;
    if (!counselRevealDone) return;
    if (counselStreamStarted.current === pack.sessionId) return;
    counselStreamStarted.current = pack.sessionId;
    void counselStart();
  }, [pack, counselRevealDone, counselStart]);

  const submitCounselTurn = async () => {
    if (!pack) return;
    const ex = counselExchange as 1 | 2 | 3 | 4;
    const text = counselDraft.trim();
    if (!text || counselBusy || ![1, 2, 3, 4].includes(ex)) return;
    setCounselBusy(true);
    setStreamError(null);
    setCounselDraft("");
    try {
      const res = await fetch("/api/suit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "counsel_turn",
          sessionId: pack.sessionId,
          topic: pack.topic,
          format: pack.format,
          assignments: pack.assignments,
          messages,
          exchangeNum: ex,
          userText: text,
        }),
      });
      const j = (await res.json().catch(() => null)) as {
        messages?: SuitMessage[];
        error?: string;
        ai?: string | null;
      };
      if (!res.ok || !j?.messages) {
        setStreamError(j?.error ?? "Counsel exchange failed.");
        return;
      }
      setMessages(j.messages);
      if (ex >= 4) {
        await runCounselVerdict(j.messages);
      } else {
        setCounselExchange((n) => n + 1);
      }
    } finally {
      setCounselBusy(false);
    }
  };

  async function runCounselVerdict(msgs: SuitMessage[]) {
    if (!pack) return;
    setCounselBusy(true);
    try {
      const res = await fetch("/api/suit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "counsel_verdict",
          sessionId: pack.sessionId,
          topic: pack.topic,
          format: pack.format,
          assignments: pack.assignments,
          messages: msgs,
        }),
      });
      const j = (await res.json().catch(() => null)) as {
        messages?: SuitMessage[];
        verdictText?: string;
        humanPrevails?: boolean;
        error?: string;
      };
      if (!res.ok || !j?.messages || !j.verdictText) {
        setStreamError(j?.error ?? "Verdict failed.");
        return;
      }
      setMessages(j.messages);
      setVerdictText(j.verdictText);
      setHumanPrevails(typeof j.humanPrevails === "boolean" ? j.humanPrevails : null);
      setCounselExchange(5);
    } finally {
      setCounselBusy(false);
    }
  }

  const castVote = async (agree: boolean) => {
    if (!pack) return;
    // SUIT USER VOTE — zero credits (user-contributed pick only; never call deductCreditsBalance here)
    await fetch("/api/suit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "vote",
        sessionId: pack.sessionId,
        agreeJudge: agree,
      }),
    });
    setVoteDone(true);
    setVoteThanks(true);
    window.setTimeout(() => {
      sessionStorage.removeItem(STORAGE_KEY);
      router.replace("/modes/suit");
    }, 2000);
  };

  const verdictBlock = verdictText ?? messages.find((x) => x.phase === "verdict")?.content ?? null;
  const counselWon = useMemo(() => {
    if (!pack || pack.participationMode !== "counsel" || !verdictBlock) return null;
    const userAssign = pack.assignments.find((x) => x.provider === "user");
    if (!userAssign) return null;
    const winner = parseWinnerSideBucketFromVerdict(localizeVerdictLabelsKo(verdictBlock), pack.format);
    if (!winner) return null;
    return winner === userAssign.sideBucket;
  }, [pack, verdictBlock]);

  if (!pack) {
    return (
      <main className={`${BG} flex items-center justify-center`}>
        <p className="text-sm text-white/60">Recovering session…</p>
      </main>
    );
  }

  return (
    <main className={`${BG} pb-32`}>
      {pack.participationMode === "counsel" && !counselRevealDone ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[24px] border border-amber-500/35 bg-[#131c35] p-8 shadow-[0_0_48px_rgba(245,158,11,0.12)]">
            <p className="text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-200/90">
              배정 공개 · Counsel reveal
            </p>
            <h2 className="mt-5 text-center text-xl font-semibold text-white">Your table / 상대석</h2>
            <div className="mt-8 space-y-5 rounded-2xl border border-white/10 bg-black/35 px-5 py-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/85">당신의 AI 변호 · Your counsel</p>
                <p className="mt-2 text-lg font-semibold text-white">{yourCounselLine ?? "—"}</p>
                <p className="mt-1 text-xs text-white/50">
                  {pack.userCounselProvider
                    ? suitCounselSelectorMeta(pack.userCounselProvider)?.blurbKo ?? ""
                    : ""}
                </p>
              </div>
              <div className="border-t border-white/10 pt-5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-rose-300/85">상대 변호 · Opposing counsel</p>
                <p className="mt-2 text-lg font-semibold text-white">{opposingCounselLine ?? "—"}</p>
                <p className="mt-1 text-xs text-white/50">
                  {pack.opponentProvider ? suitCounselSelectorMeta(pack.opponentProvider)?.blurbKo ?? "" : ""}
                </p>
              </div>
            </div>
            <p className="mt-6 text-center text-[11px] text-white/40">
              판사: Claude Opus 4.7 (고정) · Judge fixed — not selectable
            </p>
            <button
              type="button"
              onClick={() => setCounselRevealDone(true)}
              className="mt-6 w-full rounded-2xl bg-gradient-to-r from-amber-500 to-amber-700 py-3.5 text-sm font-semibold text-[#0a0f1e]"
            >
              재판 시작 · Enter the courtroom
            </button>
          </div>
        </div>
      ) : null}

      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0a0f1e]/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/modes/suit"
              onClick={() => sessionStorage.removeItem(STORAGE_KEY)}
              className="flex items-center gap-2 rounded-xl border border-white/12 px-3 py-2 text-sm text-white/80 hover:bg-white/5"
            >
              <ChevronLeft className="h-4 w-4" />
              New case
            </Link>
          </div>
          <div className="flex-1 space-y-1 text-center sm:text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200/85">{topicTitle}</p>
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
              <span className="rounded-full border border-white/15 bg-[#131c35] px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/80">
                {formatBadge}
              </span>
              <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-100">
                {ribbonLabel}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        {streamError ? (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {streamError}
          </div>
        ) : null}

        {loading ? (
          <p className="text-center text-sm text-white/50">The court is in session…</p>
        ) : null}

        {pack && pack.participationMode !== "counsel" && openingDone && !verdictText && !loading ? (
          <div className="mx-auto flex w-full max-w-md flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-center">
            {pack.participationMode === "witness" && completedRound >= 2 && awaitWitness ? (
              <p className="text-sm text-white/70">The witness is called. Enter testimony to continue.</p>
            ) : completedRound < 3 ? (
              <>
                <p className="text-xs uppercase tracking-[0.2em] text-white/45">
                  Round {completedRound}/3 completed
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    const next = completedRound + 1;
                    const ok = await runStep("round", next);
                    if (ok) {
                      setCompletedRound(next);
                      if (pack.participationMode === "witness" && next === 2) {
                        setAwaitWitness(true);
                      }
                    }
                  }}
                  className="rounded-xl bg-amber-600 py-3 text-sm font-semibold text-[#0a0f1e] hover:bg-amber-500"
                >
                  Next round →
                </button>
              </>
            ) : (
              <p className="text-sm text-white/70">All rounds completed. Request the court&apos;s final verdict below.</p>
            )}
          </div>
        ) : null}

        <div className="space-y-6">
          {messages
            .filter((m) => !(m.phase === "verdict" && m.provider === "opus_judge"))
            .map((m) => (
              <TranscriptBubble key={m.id} m={m} />
            ))}

          {loading && !awaitWitness && !verdictText && awaitingNext ? (
            <div className="mx-auto flex w-full max-w-[min(100%,520px)] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/60">
              <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-white/25 border-t-white/70" />
              <span>{awaitingLabel}</span>
            </div>
          ) : null}

          {awaitWitness ? (
            <div className="mx-auto mt-8 w-full max-w-lg rounded-2xl border border-amber-400/35 bg-black/40 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <p className="text-center text-[11px] font-bold uppercase tracking-[0.3em] text-amber-200/90">
                Witness stand
              </p>
              <h2 className="mt-2 text-center text-lg font-semibold">You have been called to testify</h2>
              <p className="mt-2 text-center text-xs text-white/55">State your account. (maximum 200 characters)</p>
              <textarea
                value={witnessText}
                maxLength={200}
                rows={4}
                onChange={(e) => setWitnessText(e.target.value)}
                placeholder="Formal testimony..."
                className="mt-4 w-full rounded-xl border border-white/15 bg-[#0c1224] px-4 py-3 font-serif text-sm text-white outline-none placeholder:text-white/35"
              />
              <div className="mt-2 text-right text-[10px] text-white/40">{witnessText.length}/200</div>
              <button
                type="button"
                onClick={() => void submitWitness()}
                className="mt-4 w-full rounded-xl bg-amber-600 py-3 text-sm font-semibold text-[#0a0f1e] hover:bg-amber-500"
              >
                Submit testimony
              </button>
            </div>
          ) : null}

          {verdictBlock ? (
            <>
              <VerdictCard text={verdictBlock} animate={verdictReveal} />
              {(pack.participationMode === "spectator" || pack.participationMode === "witness") ? (
                <div
                  className={`mx-auto mt-8 flex w-full max-w-md flex-col gap-3 transition-opacity duration-500 ${
                    voteDone ? "opacity-50" : "opacity-100"
                  }`}
                >
                  <p className="text-center text-xs uppercase tracking-[0.2em] text-white/45">Gallery poll</p>
                  <p className="text-center text-sm text-white/70">Do you agree with the ruling?</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={voteDone}
                      onClick={() => void castVote(true)}
                      className="rounded-xl border border-emerald-500/40 bg-emerald-600/25 py-3 text-xs font-semibold uppercase tracking-wide text-emerald-100 hover:bg-emerald-600/40 disabled:cursor-not-allowed"
                    >
                      I agree with the ruling
                    </button>
                    <button
                      type="button"
                      disabled={voteDone}
                      onClick={() => void castVote(false)}
                      className="rounded-xl border border-rose-500/40 bg-rose-600/25 py-3 text-xs font-semibold uppercase tracking-wide text-rose-100 hover:bg-rose-600/40 disabled:cursor-not-allowed"
                    >
                      I disagree
                    </button>
                  </div>
                  {voteThanks ? (
                    <div className="space-y-2 pt-1">
                      <p className="text-center text-[11px] text-white/60">Thank you for your verdict.</p>
                      <button
                        type="button"
                        onClick={() => {
                          sessionStorage.removeItem(STORAGE_KEY);
                          router.replace("/modes/suit");
                        }}
                        className="w-full rounded-xl bg-amber-600 py-3 text-sm font-semibold text-[#0a0f1e] hover:bg-amber-500"
                      >
                        새 사건 시작하기 →
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {pack.participationMode === "counsel" ? (
                <div className="mx-auto mt-8 w-full max-w-lg rounded-2xl border border-white/15 bg-[#131c35] p-6 text-center shadow-lg">
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-200/85">Bench assessment</p>
                  <p className="mt-4 text-2xl font-bold text-white">
                    {counselWon === true ? "You won" : counselWon === false ? "You lost" : "Verdict rendered"}
                  </p>
                  {extractFinding(verdictBlock) ? (
                    <blockquote className="mt-5 border-l-2 border-amber-400/60 pl-4 text-left text-sm italic text-white/75">
                      {extractFinding(verdictBlock)}
                    </blockquote>
                  ) : null}
                </div>
              ) : null}
              {verdictBlock ? (
                <ShareButtons modeName="SUIT" className="mx-auto mt-8 max-w-lg" />
              ) : null}
            </>
          ) : null}
        </div>

        <div ref={bottomRef} />
      </div>

      {pack.participationMode !== "counsel" && openingDone && completedRound >= 3 && !verdictText ? (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#0a0f1e]/98 p-4 backdrop-blur">
          <div className="mx-auto max-w-3xl">
            <button
              type="button"
              disabled={verdictRequesting}
              onClick={async () => {
                if (verdictRequesting) return;
                setVerdictRequesting(true);
                try {
                  await runStep("verdict");
                } finally {
                  setVerdictRequesting(false);
                }
              }}
              className="w-full rounded-2xl bg-amber-600 py-3.5 text-sm font-semibold text-[#0a0f1e] hover:bg-amber-500 disabled:opacity-60"
            >
              {verdictRequesting ? "판결문 작성 중..." : "재판부에 최종 판결을 요청합니다 →"}
            </button>
          </div>
        </div>
      ) : null}

      {pack.participationMode === "counsel" && counselRevealDone &&
      counselExchange >= 1 &&
      counselExchange <= 4 &&
      !verdictText ? (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#0a0f1e]/98 p-4 backdrop-blur">
          <div className="mx-auto max-w-3xl space-y-2">
            {yourCounselLine ? (
              <p className="text-[10px] text-white/45">
                내 AI 변호: <span className="text-emerald-200/90">{yourCounselLine}</span> · 상대:{" "}
                <span className="text-rose-200/85">{opposingCounselLine}</span>
              </p>
            ) : null}
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200/90">
              Your argument as {counselRoleHumanLabel || "counsel"}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <textarea
                value={counselDraft}
                onChange={(e) => setCounselDraft(e.target.value)}
                rows={3}
                disabled={counselBusy}
                placeholder="Address the bench with specificity…"
                className="flex-1 rounded-xl border border-white/12 bg-[#131c35] px-4 py-3 text-sm text-white outline-none placeholder:text-white/35"
              />
              <button
                type="button"
                disabled={counselBusy || counselDraft.trim().length < 2}
                onClick={() => void submitCounselTurn()}
                className="rounded-xl bg-amber-600 px-6 py-3 text-sm font-semibold text-[#0a0f1e] hover:bg-amber-500 disabled:opacity-40"
              >
                {counselBusy ? "Submitting…" : "Deliver"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
