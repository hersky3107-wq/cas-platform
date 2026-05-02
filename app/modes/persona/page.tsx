"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { ChevronLeft, Minus, Plus } from "lucide-react";
import { supabase } from "@/lib/db/supabase";
import { creditsPerMessage } from "@/lib/credits";
import type { AiProviderName, RouterResult } from "@/lib/ai/router";

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

const MAX_ROLE_CHARS = 200;
const MAX_ROWS = 6;
const MIN_ROWS_SEND = 2;

/** Sentinel value for the role dropdown "Custom" option (not shown in API payloads). */
const ROLE_CUSTOM_SENTINEL = "__ROLE_CUSTOM__";

const PRESET_ROLES = [
  "Lawyer",
  "Economist",
  "Scientist",
  "Historian",
  "Devil's Advocate",
  "Optimist",
  "Pessimist",
  "Skeptic",
  "Creative Thinker",
  "Artist",
  "Critic",
  "Philosopher",
  "Rule Breaker",
  "Justice Seeker",
  "Child",
  "Alien Observer",
  "Cold Analyst",
] as const;

type PersonaRow = {
  id: string;
  provider: AiProviderName | "";
  roleChoice: string;
  customRole: string;
};

function createBlankRow(): PersonaRow {
  return {
    id: crypto.randomUUID(),
    provider: "",
    roleChoice: "Lawyer",
    customRole: "",
  };
}

function resolveRowRole(row: PersonaRow): string {
  if (row.roleChoice === ROLE_CUSTOM_SENTINEL) {
    return row.customRole.replace(/\s+/g, " ").trim().slice(0, MAX_ROLE_CHARS);
  }
  return row.roleChoice.replace(/\s+/g, " ").trim().slice(0, MAX_ROLE_CHARS);
}

function rowIsReady(row: PersonaRow): row is PersonaRow & {
  provider: AiProviderName;
} {
  if (row.provider === "") return false;
  return resolveRowRole(row).trim().length > 0;
}

/** Strip common markdown so responses render as plain text. */
function stripMarkdownFormatting(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n");
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/\*\*([^*]*)\*\*/g, "$1");
  t = t.replace(/__(.+?)__/g, "$1");
  t = t.replace(/\*(.+?)\*/g, "$1");
  t = t.replace(/_(.+?)_/g, "$1");
  t = t.replace(/^\s*[-*+]\s+/gm, "");
  t = t.replace(/^\s*\d+\.\s+/gm, "");
  t = t.replace(/\*\*/g, "");
  t = t.replace(/\*/g, "");
  t = t.replace(/^-\s*/gm, "");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
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
  streamAnchorMs?: number;
  responses: CompletedResponse[];
};

const CARD_STAGGER_MS = 300;
const BEST_ANSWER_DELAY_MS = 2000;
const BEST_ANSWER_ANIM_MS = 320;

function wordsForTypewriter(s: string): string[] {
  if (!s) return [];
  return s.match(/\S+/g) ?? [];
}

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
    return (
      <span className={`${base} bg-[#1a1464] text-white`}>DeepSeek</span>
    );
  }
  return <span className={`${base} bg-[#FF7000] text-white`}>Mistral</span>;
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
          {error ? (
            <span className="text-rose-300/95">{displayed}</span>
          ) : (
            displayed
          )}
          {!error && !typingDone ? (
            <span
              className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-slate-400 align-text-bottom"
              aria-hidden
            />
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

export default function PersonaModePage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [rows, setRows] = useState<PersonaRow[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [endSubmitting, setEndSubmitting] = useState(false);
  const chatMainRef = useRef<HTMLElement>(null);
  const footerStackRef = useRef<HTMLDivElement>(null);
  /** Clears docked footer + safe-area height from scrollable chat. */
  const [bottomStackPx, setBottomStackPx] = useState(320);
  const bestAnswerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bestAnswerPanel, setBestAnswerPanel] = useState<{
    sessionId: string;
    providers: AiProviderName[];
  } | null>(null);
  const [bestAnswerVisual, setBestAnswerVisual] = useState(false);
  const [rolesSectionExpanded, setRolesSectionExpanded] = useState(true);
  const rolesAutoCollapsedOnce = useRef(false);

  const readyAssignments = useMemo(() => {
    const out: { provider: AiProviderName; role: string }[] = [];
    for (const r of rows) {
      if (rowIsReady(r)) out.push({ provider: r.provider, role: resolveRowRole(r) });
    }
    return out;
  }, [rows]);

  const duplicatesAmongReady = useMemo(() => {
    const p = readyAssignments.map((a) => a.provider);
    return new Set(p).size !== p.length;
  }, [readyAssignments]);

  const canSendAssignments = useMemo(() => {
    const n = readyAssignments.length;
    if (n < MIN_ROWS_SEND || n > MAX_ROWS) return false;
    return !duplicatesAmongReady;
  }, [readyAssignments, duplicatesAmongReady]);

  const assignmentsPayload = readyAssignments;

  const collapsedAssignmentsSummary = useMemo(() => {
    if (readyAssignments.length === 0) return "";
    const head = readyAssignments
      .slice(0, 3)
      .map((a) => `${AI_LABEL[a.provider]} (${a.role})`)
      .join(" · ");
    return readyAssignments.length > 3 ? `${head} · ...` : head;
  }, [readyAssignments]);

  const providerList = useMemo(
    () => assignmentsPayload.map((a) => a.provider),
    [assignmentsPayload]
  );

  const nextCost = useMemo(() => {
    try {
      const n = readyAssignments.length;
      if (n < MIN_ROWS_SEND) return null;
      return creditsPerMessage(n);
    } catch {
      return null;
    }
  }, [readyAssignments.length]);

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
    if (turns.length === 0) {
      rolesAutoCollapsedOnce.current = false;
      setRolesSectionExpanded(true);
      return;
    }
    if (!rolesAutoCollapsedOnce.current) {
      rolesAutoCollapsedOnce.current = true;
      setRolesSectionExpanded(false);
    }
  }, [turns.length]);

  useEffect(() => {
    let rafOuter = 0;
    let rafInner = 0;
    rafOuter = requestAnimationFrame(() => {
      rafInner = requestAnimationFrame(() => {
        const root = chatMainRef.current;
        if (!root) return;
        root.scrollTo({ top: root.scrollHeight, behavior: "smooth" });
      });
    });
    return () => {
      cancelAnimationFrame(rafOuter);
      cancelAnimationFrame(rafInner);
    };
  }, [turns, sending]);

  useLayoutEffect(() => {
    const el = footerStackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      setBottomStackPx((prev) => (prev === h ? prev : h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          router.replace("/auth");
          return;
        }
        const res = await fetch("/api/compare/user-selection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: bestAnswerPanel.sessionId,
            selectedProvider: provider,
            supabaseAccessToken: token,
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

  const addRow = useCallback(() => {
    setRows((prev) => {
      if (prev.length >= MAX_ROWS) return prev;
      return [...prev, createBlankRow()];
    });
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!canSendAssignments) {
      setError(
        "Add at least 2 AIs — pick a provider and role for each (Custom needs text). Models must differ."
      );
      return;
    }

    const assignments = assignmentsPayload;

    setError(null);
    setSending(true);
    const turnId = crypto.randomUUID();
    const roundProviders = providerList.slice() as AiProviderName[];

    if (bestAnswerTimerRef.current != null) {
      clearTimeout(bestAnswerTimerRef.current);
      bestAnswerTimerRef.current = null;
    }
    setBestAnswerPanel(null);
    setBestAnswerVisual(false);
    setTurns((prev) => [...prev, { id: turnId, userText: text, responses: [] }]);
    setInput("");

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        router.replace("/auth");
        return;
      }

      let resolvedSessionId: string | null = sessionId;

      const res = await fetch("/api/ai-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          assignments,
          sessionId,
          supabaseAccessToken: token,
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
          let msg: {
            type: string;
            result?: RouterResult;
            sessionId?: string;
            creditsRemaining?: number;
            error?: string;
          };
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
    canSendAssignments,
    assignmentsPayload,
    providerList,
    sessionId,
    router,
  ]);

  const pickWinner = useCallback(
    async (winner: AiProviderName) => {
      if (!sessionId) return;
      setEndSubmitting(true);
      setError(null);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          router.replace("/auth");
          return;
        }
        const res = await fetch("/api/compare/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            winner,
            supabaseAccessToken: token,
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
        setTurns([]);
        setRows([]);
      } finally {
        setEndSubmitting(false);
      }
    },
    [sessionId, router]
  );

  const canAddRow = rows.length < MAX_ROWS;
  const selectBase =
    "rounded-lg border border-white/15 bg-[#131c35] px-2 py-1.5 text-xs font-medium text-white focus:border-violet-400/50 focus:outline-none";

  /** Full role editor visible before first chat turn, or when user expands. */
  const rolesEditorOpen = turns.length === 0 || rolesSectionExpanded;

  if (!authReady) {
    return (
      <div className={`${BG} flex min-h-screen items-center justify-center`}>
        <p className="text-sm text-white/60">Loading…</p>
      </div>
    );
  }

  return (
    <div className={`flex min-h-[100dvh] flex-col ${BG}`}>
      <header className="fixed left-0 right-0 top-0 z-20 flex shrink-0 items-center justify-between border-b border-white/8 bg-[#0a0f1e]/95 px-3 py-2.5 backdrop-blur-md sm:px-4">
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

      <div className="flex min-h-0 flex-1 flex-col pt-14">
        <main
          ref={chatMainRef}
          style={{
            scrollPaddingBottom: bottomStackPx + 16,
            paddingBottom: bottomStackPx + 24,
          }}
          className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto overscroll-y-contain px-3 pt-2 sm:px-4"
        >
        <h1 className="mb-3 text-center text-xl font-bold leading-snug text-white sm:text-2xl">
          Different roles. Different voices.
        </h1>
        <p className="mx-auto mb-8 max-w-2xl text-center text-xs text-slate-400 sm:text-sm">
          Give each AI a role — same question, completely different answers.
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
      </main>
      </div>

      <div
        ref={footerStackRef}
        className="fixed inset-x-0 bottom-0 z-30 flex flex-col border-t border-white/10 bg-[#0a0f1e]/98 shadow-[0_-10px_40px_rgba(0,0,0,0.45)] backdrop-blur-md pb-[env(safe-area-inset-bottom,0px)]"
      >
          {bestAnswerPanel ? (
            <div
              className={[
                "overflow-hidden border-b border-white/10 bg-[#1a2235]/95 transition-[max-height] duration-300 ease-out",
                bestAnswerVisual
                  ? "max-h-[min(240px,calc(100dvh-14rem))]"
                  : "max-h-0",
              ].join(" ")}
              aria-live="polite"
            >
              <div className="mx-auto w-full max-w-3xl px-3 pb-3 pt-2.5 sm:px-4">
                <div className="mb-2 flex items-start justify-between gap-3">
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
                <div className="max-h-[11rem] overflow-y-auto overscroll-contain pb-1">
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

          <div className="border-b border-white/[0.06] bg-[#0f1528]/95">
            <button
              type="button"
              aria-expanded={rolesEditorOpen}
              aria-label={
                turns.length === 0
                  ? "Configure roles (available before first message)"
                  : rolesEditorOpen
                    ? "Collapse role configuration"
                    : "Expand role configuration"
              }
              onClick={() => {
                if (turns.length === 0) return;
                setRolesSectionExpanded((v) => !v);
              }}
              disabled={turns.length === 0}
              title={
                turns.length === 0
                  ? "Configure roles before your first message"
                  : rolesEditorOpen
                    ? "Hide role configuration"
                    : "Configure roles"
              }
              className={[
                "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm font-semibold text-slate-200 transition hover:bg-white/6 sm:px-4",
                turns.length === 0 ? "cursor-default opacity-95" : "cursor-pointer",
              ].join(" ")}
            >
              <span>
                {rolesEditorOpen
                  ? "⚙ Configure Roles ▲"
                  : "⚙ Configure Roles ▼"}
              </span>
            </button>

            {!rolesEditorOpen && turns.length >= 1 ? (
              <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 border-t border-white/[0.04] px-3 py-2 text-center text-xs leading-snug text-slate-400">
                {collapsedAssignmentsSummary ? (
                  <span className="break-words text-slate-400">
                    {collapsedAssignmentsSummary}
                    {" · "}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setRolesSectionExpanded(true)}
                  className="font-medium text-cyan-300/95 underline decoration-cyan-400/50 underline-offset-2 transition hover:text-cyan-200"
                >
                  Edit ✏️
                </button>
              </div>
            ) : null}

            <div
              className={[
                "overflow-hidden transition-[max-height] duration-300 ease-out",
                rolesEditorOpen
                  ? "max-h-[min(42vh,22rem)] border-t border-white/[0.04]"
                  : "max-h-0 border-t border-transparent",
              ].join(" ")}
            >
              <div className="max-h-[min(42vh,22rem)] overflow-y-auto overscroll-y-contain px-3 py-2.5 sm:px-4 sm:py-3">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
                  {rows.map((row) => {
                const providersTaken = new Set(
                  rows
                    .filter((x) => x.id !== row.id && x.provider !== "")
                    .map((x) => x.provider as AiProviderName)
                );
                const showCustom = row.roleChoice === ROLE_CUSTOM_SENTINEL;
                return (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-end gap-2 rounded-xl border border-white/10 bg-[#131c35]/80 px-2.5 py-2.5 sm:items-center"
                  >
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <div className="flex min-w-[7rem] flex-col gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          AI
                        </span>
                        <label className="sr-only" htmlFor={`provider-${row.id}`}>
                          Select AI model
                        </label>
                        <select
                          id={`provider-${row.id}`}
                          value={row.provider}
                          onChange={(e) => {
                            const v = e.target.value as AiProviderName | "";
                            setRows((prev) =>
                              prev.map((x) =>
                                x.id === row.id ? { ...x, provider: v } : x
                              )
                            );
                          }}
                          className={`${selectBase} w-full min-w-[10rem]`}
                        >
                          <option value="">Select AI…</option>
                          {AI_ORDER.map((p) => (
                            <option
                              key={p}
                              value={p}
                              disabled={providersTaken.has(p)}
                              className="bg-[#131c35]"
                            >
                              {AI_LABEL[p]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:min-w-[12rem]">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          Role
                        </span>
                        <label className="sr-only" htmlFor={`role-${row.id}`}>
                          Role preset or custom
                        </label>
                        <select
                          id={`role-${row.id}`}
                          value={
                            row.roleChoice === ROLE_CUSTOM_SENTINEL
                              ? ROLE_CUSTOM_SENTINEL
                              : PRESET_ROLES.includes(
                                    row.roleChoice as (typeof PRESET_ROLES)[number]
                                  )
                                ? row.roleChoice
                                : PRESET_ROLES[0]
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            setRows((prev) =>
                              prev.map((x) =>
                                x.id === row.id ? { ...x, roleChoice: v } : x
                              )
                            );
                          }}
                          className={`${selectBase} w-full min-w-[10rem]`}
                        >
                          {PRESET_ROLES.map((pr) => (
                            <option key={pr} value={pr} className="bg-[#131c35]">
                              {pr}
                            </option>
                          ))}
                          <option value={ROLE_CUSTOM_SENTINEL} className="bg-[#131c35]">
                            ✏️ Custom…
                          </option>
                        </select>
                      </div>
                      {showCustom ? (
                        <div className="min-w-[8rem] flex-1 pb-px sm:self-end">
                          <label className="sr-only" htmlFor={`custom-${row.id}`}>
                            Custom role
                          </label>
                          <input
                            id={`custom-${row.id}`}
                            type="text"
                            value={row.customRole}
                            onChange={(e) =>
                              setRows((prev) =>
                                prev.map((x) =>
                                  x.id === row.id
                                    ? {
                                        ...x,
                                        customRole: e.target.value.slice(0, MAX_ROLE_CHARS),
                                      }
                                    : x
                                )
                              )
                            }
                            placeholder='e.g. "Space pirate"'
                            className="w-full rounded-lg border border-white/12 bg-[#1a2235] px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-violet-400/45 focus:outline-none"
                            autoComplete="off"
                          />
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      title="Remove this row"
                      onClick={() => removeRow(row.id)}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-[#1a2235] text-slate-300 transition hover:bg-rose-500/20 hover:text-rose-100"
                    >
                      <Minus className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                );
              })}
              <p className="text-center text-[10px] leading-snug text-slate-500">
                Or type any role — professional, fictional, or anything in between.
              </p>
              <button
                type="button"
                disabled={!canAddRow}
                onClick={() => addRow()}
                className={[
                  "mx-auto inline-flex items-center justify-center gap-2 rounded-2xl font-semibold text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-35",
                  rows.length === 0
                    ? "w-full border-2 border-cyan-400/40 bg-gradient-to-r from-[#156d7a]/90 to-[#0f4f6b]/95 py-4 text-base shadow-cyan-900/35 hover:border-cyan-300/55 hover:from-[#178092]/95 enabled:hover:to-[#115877]/95 sm:max-w-md"
                    : "border border-cyan-500/35 bg-[#153d52]/90 px-6 py-2.5 text-sm hover:bg-[#194d66]/95",
                ].join(" ")}
              >
                <Plus className={rows.length === 0 ? "h-6 w-6" : "h-5 w-5"} aria-hidden />
                Add AI
              </button>
                  <p className="text-center text-[11px] tabular-nums text-slate-500/90">
                    {readyAssignments.length} ready ·{" "}
                    {nextCost != null ? `${nextCost} credits / message` : "—"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 border-t border-white/8 px-3 py-3 sm:px-4">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-1">
              <div className="flex gap-2">
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
                  placeholder="Ask all configured AIs…"
                  className="min-h-[48px] min-w-0 flex-1 rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={
                    sending ||
                    !canSendAssignments ||
                    !input.trim() ||
                    (credits !== null && nextCost !== null && credits < nextCost)
                  }
                  className="inline-flex min-h-[48px] shrink-0 items-center justify-center rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition enabled:hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Send
                </button>
              </div>
              {!canSendAssignments ? (
                <p className="text-center text-[10px] text-amber-200/90">
                  {duplicatesAmongReady
                    ? "Each AI model can appear only once — adjust duplicate selections."
                    : readyAssignments.length < MIN_ROWS_SEND
                      ? "Select at least 2 AIs and assign each a role to get started."
                      : readyAssignments.length > MAX_ROWS
                        ? `At most ${MAX_ROWS} AIs per message.`
                        : ""}
                </p>
              ) : (
                <p className="text-center text-[10px] text-slate-500">
                  {nextCost !== null
                    ? `This message uses ${nextCost} credits · ${readyAssignments.length} AI${
                        readyAssignments.length > 1 ? "s" : ""
                      }`
                    : "Up to six AIs"}
                </p>
              )}
            </div>
          </div>
      </div>

      {endOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#131c35] p-6 shadow-2xl"
            role="dialog"
            aria-modal
            aria-labelledby="persona-end-title"
          >
            <h2 id="persona-end-title" className="text-lg font-semibold text-white">
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
