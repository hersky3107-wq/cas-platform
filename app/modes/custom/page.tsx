"use client";

import Link from "next/link";
import HelpModal from "@/components/HelpModal";
import ShareButtons from "@/components/ShareButtons";
import { customHelpContent } from "@/lib/help-modal/custom-content";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Settings2,
} from "lucide-react";
import { supabase } from "@/lib/db/supabase";
import { creditsForCustom } from "@/lib/credits";
import type {
  AiProviderName,
  CompareConversationMessage,
  RouterResult,
} from "@/lib/ai/router";

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

const AI_ACCENT: Record<AiProviderName, string> = {
  openai: "#10A37F",
  anthropic: "#D97757",
  google: "#4285F4",
  xai: "#ffffff",
  deepseek: "#4D6BFE",
  mistral: "#FF7000",
};

/** Strip common markdown so responses render as plain text. */
function stripMarkdownFormatting(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n")
  t = t.replace(/^#{1,6}\s+/gm, "")
  t = t.replace(/\*\*([^*]*)\*\*/g, "$1")
  t = t.replace(/__(.+?)__/g, "$1")
  t = t.replace(/\*(.+?)\*/g, "$1")
  t = t.replace(/_(.+?)_/g, "$1")
  t = t.replace(/^\s*[-*+]\s+/gm, "")
  t = t.replace(/^\s*\d+\.\s+/gm, "")
  t = t.replace(/\*\*/g, "")
  t = t.replace(/\*/g, "")
  t = t.replace(/^-\s*/gm, "")
  t = t.replace(/\n{3,}/g, "\n\n")
  return t.trim()
}

type CompletedResponse = {
  provider: AiProviderName;
  text: string | null;
  ms: number;
  error?: string;
};

type Turn = {
  id: string;
  userText: string;
  /** Set when the first AI result of this turn arrives; used to stagger card visibility. */
  streamAnchorMs?: number;
  responses: CompletedResponse[];
};

/** Persisted multi-turn context sent to the API (last 10 exchanges). */
type Message = {
  role: "user";
  content: string;
  aiResponses?: Partial<Record<AiProviderName, string>>;
};

const CARD_STAGGER_MS = 300;
const BEST_ANSWER_DELAY_MS = 2000;
const BEST_ANSWER_ANIM_MS = 320;
const MAX_CUSTOM_SYSTEM = 500;

const LENGTH_STEPS = [300, 700, 1500] as const;
type LengthStepIndex = 0 | 1 | 2;

const LENGTH_HINT: Record<LengthStepIndex, string> = {
  0: "faster · fewer credits",
  1: "balanced",
  2: "detailed · more credits",
};

/** Slider 0–100 → temperature 0.1–1.0 (50 → 0.5). */
function sliderToTemperature(slider: number): number {
  const s = Math.min(100, Math.max(0, slider));
  return 0.1 + (s / 100) * 0.9;
}

function lengthStepFromSlider(slider: number): LengthStepIndex {
  if (slider <= 33) return 0;
  if (slider <= 66) return 1;
  return 2;
}

function sliderFromLengthStep(step: LengthStepIndex): number {
  return step === 0 ? 0 : step === 1 ? 50 : 100;
}

const defaultSelected = (): Record<AiProviderName, boolean> => ({
  openai: true,
  anthropic: true,
  google: true,
  xai: false,
  deepseek: false,
  mistral: false,
});

/** Word tokens for typewriter (25ms per word; final text uses full string for spacing/newlines). */
function wordsForTypewriter(s: string): string[] {
  if (!s) return [];
  return s.match(/\S+/g) ?? [];
}

function AiNameBadge({ provider }: { provider: AiProviderName }) {
  const base =
    "inline-flex rounded-lg px-2.5 py-0.5 text-sm font-bold";

  if (provider === "openai") {
    return (
      <span className={`${base} bg-[#0a2540] text-white`}>ChatGPT</span>
    );
  }
  if (provider === "anthropic") {
    return (
      <span className={`${base} bg-[#F5E6D3] text-[#3d2914]`}>Claude</span>
    );
  }
  if (provider === "google") {
    const word = "Gemini";
    return (
      <span
        className={`${base} bg-[#0d1117]`}
        aria-label={word}
      >
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
      <span
        className={`${base} border border-white bg-black text-white`}
      >
        Grok
      </span>
    );
  }
  if (provider === "deepseek") {
    return (
      <span className={`${base} bg-[#1a1464] text-white`}>DeepSeek</span>
    );
  }
  return (
    <span className={`${base} bg-[#FF7000] text-white`}>Mistral</span>
  );
}

function AiSelectorButton({
  id,
  label,
  selected,
  onToggle,
}: {
  id: AiProviderName;
  label: string;
  selected: boolean;
  onToggle: (id: AiProviderName) => void;
}) {
  const base =
    "inline-flex h-9 w-24 min-w-[96px] max-w-[96px] shrink-0 items-center justify-center rounded-xl text-xs font-semibold box-border overflow-hidden transition-[transform,box-shadow,border-color,background-color,color] duration-150";

  const unselected =
    "scale-100 border border-slate-600 bg-[#2a2a2a] text-slate-500 shadow-none hover:border-slate-500 hover:text-slate-400";

  const brandSelected =
    id === "google"
      ? "bg-[#4285F4]"
      : id === "xai"
        ? "bg-black"
        : id === "openai"
          ? "bg-[#10A37F]"
          : id === "anthropic"
            ? "bg-[#D97757]"
            : id === "deepseek"
              ? "bg-[#4D6BFE]"
              : "bg-[#FF7000]";

  const selectedCls = [
    "scale-105 border-2 border-white text-white shadow-[0_4px_14px_rgba(0,0,0,0.35)]",
    brandSelected,
  ].join(" ");

  return (
    <button
      type="button"
      title={label}
      onClick={() => onToggle(id)}
      className={[base, selected ? selectedCls : unselected].join(" ")}
    >
      <span className="min-w-0 max-w-full truncate px-1 text-center">{label}</span>
    </button>
  );
}

function AiChatBubble({
  provider,
  text,
  ms,
  error,
}: {
  provider: AiProviderName;
  text: string | null;
  ms: number;
  error?: string;
}) {
  const [displayed, setDisplayed] = useState("");
  const [typingDone, setTypingDone] = useState(false);

  useEffect(() => {
    if (error) {
      setDisplayed(error);
      setTypingDone(true);
      return;
    }

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
  }, [text, error]);

  return (
    <div className="flex w-full max-w-[75%] flex-col items-start gap-1">
      <AiNameBadge provider={provider} />
      <div className="w-full rounded-2xl bg-white/[0.09] px-3.5 py-2.5 text-sm leading-relaxed text-slate-100">
        <p className="min-h-[1.25rem] whitespace-pre-wrap">
          {error ? <span className="text-rose-300/95">{displayed}</span> : displayed}
          {!error && !typingDone ? (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-slate-400 align-text-bottom" aria-hidden />
          ) : null}
        </p>
        {typingDone ? (
          <div className="mt-2 text-right text-[10px] tabular-nums text-slate-500">
            {ms} ms
          </div>
        ) : null}
      </div>
    </div>
  );
}

function staggerShouldBeVisible(
  anchorMs: number | undefined,
  staggerIndex: number
): boolean {
  if (anchorMs == null) return false;
  return Date.now() >= anchorMs + staggerIndex * CARD_STAGGER_MS;
}

function StaggeredAiChatBubble({
  anchorMs,
  staggerIndex,
  ...bubbleProps
}: {
  anchorMs: number | undefined;
  staggerIndex: number;
} & ComponentProps<typeof AiChatBubble>) {
  const [show, setShow] = useState(() =>
    staggerShouldBeVisible(anchorMs, staggerIndex)
  );

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

  return <AiChatBubble {...bubbleProps} />;
}

export default function CustomModePage() {
  const router = useRouter();
  const [credits, setCredits] = useState<number | null>(null);
  const [selected, setSelected] = useState<Record<AiProviderName, boolean>>(
    defaultSelected
  );
  const [input, setInput] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tempSlider, setTempSlider] = useState(50);
  const [lengthSlider, setLengthSlider] = useState(50);
  const [customSystem, setCustomSystem] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [endSubmitting, setEndSubmitting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const bestAnswerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bestAnswerPanel, setBestAnswerPanel] = useState<{
    sessionId: string;
    providers: AiProviderName[];
  } | null>(null);
  const [bestAnswerVisual, setBestAnswerVisual] = useState(false);

  const selectedList = useMemo(
    () => AI_ORDER.filter((p) => selected[p]),
    [selected]
  );

  const nextCost = useMemo(() => {
    try {
      return creditsForCustom(selectedList.length);
    } catch {
      return null;
    }
  }, [selectedList.length]);

  const temperature = useMemo(
    () => sliderToTemperature(tempSlider),
    [tempSlider]
  );

  const lengthStep = useMemo(
    () => lengthStepFromSlider(lengthSlider),
    [lengthSlider]
  );

  const maxTokens = LENGTH_STEPS[lengthStep];

  const providersInSession = useMemo(() => {
    const s = new Set<AiProviderName>();
    for (const t of turns) {
      for (const r of t.responses) {
        s.add(r.provider);
      }
    }
    return Array.from(s);
  }, [turns]);

  useEffect(() => {
    (async () => {
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
  }, [turns, sending]);

  useEffect(() => {
    return () => {
      if (bestAnswerTimerRef.current != null) {
        clearTimeout(bestAnswerTimerRef.current);
      }
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

  const closeBestAnswerPanel = useCallback(() => {
    setBestAnswerVisual(false);
    window.setTimeout(() => {
      setBestAnswerPanel(null);
    }, BEST_ANSWER_ANIM_MS);
  }, []);

  const submitBestAnswerPick = useCallback(
    async (provider: AiProviderName) => {
      if (!bestAnswerPanel?.sessionId) return;
      setError(null);
      try {
        const res = await fetch("/api/compare/user-selection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: bestAnswerPanel.sessionId,
            selectedProvider: provider,
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string };
          setError(j?.error ?? "Could not save selection");
          return;
        }
        closeBestAnswerPanel();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    },
    [bestAnswerPanel, router, closeBestAnswerPanel]
  );

  const toggleAi = useCallback((id: AiProviderName) => {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (selectedList.length < 1) {
      setError("Select at least one AI.");
      return;
    }

    setError(null);
    setSending(true);
    const turnId = crypto.randomUUID();
    const roundProviders = [...selectedList] as AiProviderName[];

    if (bestAnswerTimerRef.current != null) {
      clearTimeout(bestAnswerTimerRef.current);
      bestAnswerTimerRef.current = null;
    }
    setBestAnswerPanel(null);
    setBestAnswerVisual(false);
    setTurns((prev) => [
      ...prev,
      { id: turnId, userText: text, responses: [] },
    ]);
    setInput("");

    const conversationHistory: CompareConversationMessage[] = messages
      .slice(-10)
      .map((m) => ({
        role: "user" as const,
        content: m.content,
        aiResponses: m.aiResponses,
      }));

    const responsesThisTurn: Partial<Record<AiProviderName, string>> = {};

    try {
      let resolvedSessionId: string | null = sessionId;

      const systemPrompt = advancedOpen ? customSystem.trim() : "";

      const res = await fetch("/api/ai-custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          sessionId,
          providers: selectedList,
          temperature,
          systemPrompt,
          maxTokens,
          conversationHistory,
        }),
      });

      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
          balance?: number;
        };
        setError(j?.error ?? "Request failed");
        if (typeof j?.balance === "number") setCredits(j.balance);
        setTurns((prev) => prev.filter((t) => t.id !== turnId));
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("No response body");
        setTurns((prev) => prev.filter((t) => t.id !== turnId));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      const applyResult = (r: RouterResult) => {
        const plain =
          r.text != null && !r.error ? stripMarkdownFormatting(r.text) : r.text;
        const stored =
          plain ?? (r.error ? `[error] ${r.error}` : "");
        responsesThisTurn[r.provider] = stored;
        setTurns((prev) =>
          prev.map((t) => {
            if (t.id !== turnId) return t;
            const firstOfTurn = t.responses.length === 0;
            return {
              ...t,
              ...(firstOfTurn ? { streamAnchorMs: Date.now() } : {}),
              responses: [
                ...t.responses,
                {
                  provider: r.provider,
                  text: plain,
                  ms: r.responseTimeMs,
                  error: r.error,
                },
              ],
            };
          })
        );
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg: { type: string; result?: RouterResult; sessionId?: string; creditsRemaining?: number; error?: string };
          try {
            msg = JSON.parse(line) as typeof msg;
          } catch {
            continue;
          }
          if (msg.type === "meta" && msg.sessionId) {
            resolvedSessionId = msg.sessionId;
            setSessionId(msg.sessionId);
            if (typeof msg.creditsRemaining === "number")
              setCredits(msg.creditsRemaining);
          }
          if (msg.type === "result" && msg.result) {
            applyResult(msg.result);
          }
          if (msg.type === "error" && msg.error) {
            setError(msg.error);
          }
        }
      }

      if (resolvedSessionId && roundProviders.length > 0) {
        bestAnswerTimerRef.current = setTimeout(() => {
          setBestAnswerPanel({
            sessionId: resolvedSessionId!,
            providers: roundProviders,
          });
          bestAnswerTimerRef.current = null;
        }, BEST_ANSWER_DELAY_MS);
      }

      setMessages((prev) => [
        ...prev.slice(-9),
        { role: "user", content: text, aiResponses: { ...responsesThisTurn } },
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      setTurns((prev) => prev.filter((t) => t.id !== turnId));
    } finally {
      setSending(false);
    }
  }, [
    input,
    sending,
    selectedList,
    sessionId,
    messages,
    router,
    temperature,
    advancedOpen,
    customSystem,
    maxTokens,
  ]);

  const pickWinner = useCallback(
    async (winner: AiProviderName) => {
      if (!sessionId) return;
      setEndSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/compare/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            winner,
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string };
          setError(j?.error ?? "Could not save selection");
          return;
        }
        if (bestAnswerTimerRef.current != null) {
          clearTimeout(bestAnswerTimerRef.current);
          bestAnswerTimerRef.current = null;
        }
        setBestAnswerPanel(null);
        setBestAnswerVisual(false);
        setEndOpen(false);
        setSessionId(null);
        setMessages([]);
        setTurns([]);
      } finally {
        setEndSubmitting(false);
      }
    },
    [sessionId, router]
  );

  return (
    <div className={BG}>
      <HelpModal content={customHelpContent} />
      <header className="fixed left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#0a0f1e]/95 px-3 py-2.5 backdrop-blur-md sm:px-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-2 text-sm text-white/90 transition hover:bg-white/14"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
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
            onClick={() => setEndOpen(true)}
            className="rounded-full border border-rose-400/40 bg-rose-500/15 px-3 py-1.5 text-xs font-medium text-rose-100 transition hover:bg-rose-500/25"
          >
            End Session
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-3 pb-80 pt-16 sm:px-4">
        <h1 className="mb-3 text-center text-xl font-bold leading-snug text-white sm:text-2xl">
          Your rules. Your AIs.
        </h1>
        <p className="mx-auto mb-8 max-w-xl text-center text-xs text-slate-400 sm:text-sm">
          Pick your AIs, set the rules, and ask your way.
        </p>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="flex flex-col gap-5">
          {turns.map((turn) => (
            <div key={turn.id} className="flex flex-col gap-3">
              <div className="flex justify-end">
                <div className="max-w-[75%] rounded-2xl bg-[#3d4451] px-3.5 py-2.5 text-sm leading-relaxed text-white">
                  {turn.userText}
                </div>
              </div>
              <div className="flex flex-col items-start gap-3">
                {turn.responses.map((r, idx) => (
                  <StaggeredAiChatBubble
                    key={`${turn.id}-${r.provider}-${idx}`}
                    anchorMs={turn.streamAnchorMs}
                    staggerIndex={idx}
                    provider={r.provider}
                    text={r.text}
                    ms={r.ms}
                    error={r.error}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div ref={bottomRef} />
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-[#0a0f1e]/98 backdrop-blur-md">
        <div className="relative mx-auto max-w-3xl overflow-visible">
          {bestAnswerPanel ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-full z-40 px-3 pb-2 sm:px-4">
              <div
                className={[
                  "pointer-events-auto mx-auto mt-6 max-w-3xl border-t border-white/20 pt-6 transition-transform duration-300 ease-out",
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
                      onClick={() => closeBestAnswerPanel()}
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
                        <span className="min-w-0 truncate text-center">
                          {AI_LABEL[p]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <div className="px-3 py-3 sm:px-4">
            <div className="mx-auto flex w-full max-w-3xl flex-col">
              <div className="mb-2 space-y-1 text-center">
                <p className="text-[11px] leading-snug text-slate-500">
                  Select AIs to compare (tap to toggle)
                </p>
                <p className="text-[11px] tabular-nums text-slate-500/90">
                  {selectedList.length} selected · {nextCost ?? "—"} credits
                </p>
              </div>
              <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
                {AI_ORDER.map((id) => (
                  <AiSelectorButton
                    key={id}
                    id={id}
                    label={AI_LABEL[id]}
                    selected={selected[id]}
                    onToggle={toggleAi}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                className="mb-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-[#1a2235] px-4 text-sm font-medium text-slate-300 transition hover:bg-[#252e45] hover:text-white"
              >
                <Settings2 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                Advanced
                {advancedOpen ? (
                  <ChevronUp className="ml-0.5 h-4 w-4 shrink-0 opacity-85" aria-hidden />
                ) : (
                  <ChevronDown className="ml-0.5 h-4 w-4 shrink-0 opacity-85" aria-hidden />
                )}
              </button>
              {advancedOpen ? (
                <div className="mb-3 space-y-3 rounded-xl border border-white/10 bg-[#131c35]/70 px-3 py-3">
                <div>
                  <div className="mb-2 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <span>Precise</span>
                    <span>Creative</span>
                  </div>
                  <div className="relative px-0.5 pt-0.5">
                    <div
                      className="pointer-events-none absolute left-1/2 top-[calc(50%+2px)] z-10 h-4 w-px -translate-x-1/2 bg-white/30"
                      aria-hidden
                    />
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={tempSlider}
                      onChange={(e) =>
                        setTempSlider(Number(e.target.value))
                      }
                      className="relative z-20 h-2 w-full cursor-pointer appearance-none rounded-full bg-white/12 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400 [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-cyan-400"
                    />
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Response Length
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {LENGTH_HINT[lengthStep]}
                    </span>
                  </div>
                  <div className="mb-1 flex justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <span>Short</span>
                    <span>Long</span>
                  </div>
                  <div className="relative px-0.5 pt-0.5">
                    <div
                      className="pointer-events-none absolute left-1/3 top-[calc(50%+2px)] z-10 h-4 w-px -translate-x-1/2 bg-white/20"
                      aria-hidden
                    />
                    <div
                      className="pointer-events-none absolute left-2/3 top-[calc(50%+2px)] z-10 h-4 w-px -translate-x-1/2 bg-white/20"
                      aria-hidden
                    />
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={50}
                      value={lengthSlider}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setLengthSlider(
                          sliderFromLengthStep(lengthStepFromSlider(v))
                        );
                      }}
                      className="relative z-20 h-2 w-full cursor-pointer appearance-none rounded-full bg-white/12 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400 [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-cyan-400"
                    />
                  </div>
                  <p className="mt-1.5 text-center text-[10px] tabular-nums text-slate-600">
                    {maxTokens} tokens max
                  </p>
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] text-slate-500">
                    Custom Instructions (optional)
                  </span>
                  <textarea
                    value={customSystem}
                    onChange={(e) =>
                      setCustomSystem(
                        e.target.value.slice(0, MAX_CUSTOM_SYSTEM)
                      )
                    }
                    placeholder="Give AIs a role or rules — e.g. 'You are a skeptical scientist' or 'Answer only with facts'"
                    rows={3}
                    maxLength={MAX_CUSTOM_SYSTEM}
                    className="min-h-[5rem] w-full resize-y rounded-xl border border-white/12 bg-[#1a1f2e] px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/45 focus:outline-none"
                  />
                  <span className="mt-1 block text-right text-[10px] tabular-nums text-slate-600">
                    {customSystem.length}/{MAX_CUSTOM_SYSTEM}
                  </span>
                </label>
                </div>
              ) : null}
              <div className="flex w-full flex-row items-stretch gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Ask all selected AIs…"
                  className="min-h-[48px] min-w-0 flex-1 rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={
                    sending ||
                    !input.trim() ||
                    selectedList.length < 1 ||
                    (credits !== null && nextCost !== null && credits < nextCost)
                  }
                  className="inline-flex min-h-[48px] shrink-0 items-center justify-center rounded-xl bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-md shadow-cyan-900/30 transition enabled:hover:bg-cyan-400 enabled:hover:shadow-lg enabled:hover:shadow-cyan-600/25 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                >
                  Send
                </button>
              </div>
              <p className="mt-2 text-center text-[10px] text-slate-500">
                {nextCost !== null
                  ? `This message uses ${nextCost} credits · ${selectedList.length} AI${
                      selectedList.length > 1 ? "s" : ""
                    }`
                  : "Select 1–6 AIs"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {endOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#131c35] p-6 shadow-2xl"
            role="dialog"
            aria-modal
            aria-labelledby="compare-end-title"
          >
            <h2
              id="compare-end-title"
              className="text-lg font-semibold text-white"
            >
              Which AI gave the best answer overall?
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Your choice is saved to help improve the platform.
            </p>
            {providersInSession.length === 0 ? (
              <p className="mt-4 text-sm text-amber-200/90">
                Run at least one comparison in this session first.
              </p>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {providersInSession.map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={endSubmitting || !sessionId}
                    onClick={() => void pickWinner(p)}
                    className={[
                      "rounded-xl px-4 py-2 text-sm font-semibold text-white transition enabled:hover:opacity-90 disabled:opacity-40",
                      p === "xai" ? "border border-white bg-black" : "",
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
                    {AI_LABEL[p]}
                  </button>
                ))}
              </div>
            )}
            <ShareButtons modeName="CUSTOM" className="mt-6" />
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEndOpen(false)}
                className="rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-white/8"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
