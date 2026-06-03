"use client";

import Link from "next/link";
import HelpModal from "@/components/HelpModal";
import { CompareSessionEndPanel } from "@/app/modes/compare/CompareSessionEndPanel";
import { taleHelpContent } from "@/lib/help-modal/tale-content";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { authenticatedFetch } from "@/lib/api/authenticated-fetch";
import { PUBLIC_SHARE_BASE } from "@/lib/compare/session-types";
import type { TaleSessionResponse } from "@/lib/tale/session-types";
import type { AiProviderName } from "@/lib/ai/router";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

const GENRES = [
  { id: "Horror", icon: "👻", name: "Horror", desc: "Sleep with the lights on." },
  { id: "Romance", icon: "💕", name: "Romance", desc: "Hearts, mistakes, and longing." },
  { id: "Absurd", icon: "🌀", name: "Absurd", desc: "Logic left the building." },
  { id: "Sci-Fi", icon: "🚀", name: "Sci-Fi", desc: "The future is weirder than you think." },
  { id: "Fairy Tale", icon: "🧚", name: "Fairy Tale", desc: "Old stories, new twists." },
  { id: "Sad Story", icon: "💧", name: "Sad Story", desc: "Beautiful and devastating." },
  { id: "Custom", icon: "✏️", name: "Custom", desc: "Your genre. Your rules." },
] as const;

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

type SaveTaleSessionResult =
  | { ok: true; id: string; share_id: string }
  | { ok: false; error: string };

function buildTaleQuestion(
  genre: string,
  keyword: string,
  language: string
): string {
  const twist = keyword.trim();
  const lang = language.trim() || "English";
  return twist ? `${genre} · ${twist} (${lang})` : `${genre} (${lang})`;
}

function buildTaleResponses(
  stories: Partial<Record<AiProviderName, TaleStory>>
): TaleSessionResponse[] {
  const rows: TaleSessionResponse[] = [];
  for (const p of AI_ORDER) {
    const row = stories[p];
    if (!row?.story && !row?.error) continue;
    rows.push({
      ai_name: AI_LABEL[p],
      content: row.error ? null : row.story?.trim() ? row.story : null,
    });
  }
  return rows;
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
  if (provider === "xai") return <span className={`${base} border border-white bg-black text-white`}>Grok</span>;
  if (provider === "deepseek") return <span className={`${base} bg-[#1a1464] text-white`}>DeepSeek</span>;
  return <span className={`${base} bg-[#FF7000] text-white`}>Mistral</span>;
}

type TaleStory = {
  provider: AiProviderName;
  model: string;
  story: string | null;
  responseTimeMs: number;
  totalTokens: number | null;
  error?: string;
};

type Step = "genre" | "twist" | "generating" | "review" | "saved";

export default function StageTalePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("genre");
  const [genre, setGenre] = useState<(typeof GENRES)[number]["id"] | null>(null);
  const [twistOpen, setTwistOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [language, setLanguage] = useState("");
  const [credits, setCredits] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stories, setStories] = useState<Partial<Record<AiProviderName, TaleStory>>>({});
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taleSessionId, setTaleSessionId] = useState<string | null>(null);
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
  const [showVoting, setShowVoting] = useState(false);
  const [readyCount, setReadyCount] = useState(0);
  const [readyMap, setReadyMap] = useState<Partial<Record<AiProviderName, boolean>>>({});
  const [completedOrder, setCompletedOrder] = useState<AiProviderName[]>([]);
  const taleSaveScheduledRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const voteRef = useRef<HTMLDivElement>(null);
  const bestAnswerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const allDone = useMemo(() => {
    return AI_ORDER.every((p) => stories[p]?.story || stories[p]?.error);
  }, [stories]);

  const taleQuestion = useMemo(() => {
    if (!genre) return "";
    return buildTaleQuestion(genre, genre === "Custom" ? keyword : twistOpen ? keyword : "", language);
  }, [genre, keyword, language, twistOpen]);

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
    console.log("[tale] save-session error:", reason);
    setSessionEndSaveFailed(true);
  }, []);

  const saveTaleSession = useCallback(
    async (question: string, responses: TaleSessionResponse[]): Promise<SaveTaleSessionResult> => {
      if (responses.length < 1) return { ok: false, error: "empty responses" };
      try {
        const res = await authenticatedFetch("/api/tale/save-session", {
          method: "POST",
          json: { question, responses },
        });
        const j = (await res.json().catch(() => null)) as {
          id?: string;
          share_id?: string;
          error?: string;
        };
        if (!res.ok || !j.id || !j.share_id) {
          return { ok: false, error: j?.error ?? `HTTP ${res.status}` };
        }
        setTaleSessionId(j.id);
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
      if (!sessionId) return;
      setError(null);
      const votedLabel = AI_LABEL[provider];
      showSessionEndAfterVote(votedLabel);
      try {
        let sessionIdForVote = taleSessionId;
        if (!sessionIdForVote) {
          const saved = await saveTaleSession(taleQuestion, buildTaleResponses(stories));
          if (!saved.ok) markSessionSaveFailed(saved.error);
          else sessionIdForVote = saved.id;
        }
        if (sessionIdForVote) {
          const res = await authenticatedFetch("/api/tale/save-session", {
            method: "PATCH",
            json: { session_id: sessionIdForVote, voted_ai: votedLabel },
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => null)) as { error?: string };
            setError(j?.error ?? "Could not save vote");
          }
        }
        await fetch("/api/stage/tale/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, selectedProvider: provider }),
        });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    },
    [
      sessionId,
      taleSessionId,
      showSessionEndAfterVote,
      taleQuestion,
      stories,
      saveTaleSession,
      markSessionSaveFailed,
    ]
  );

  const skipBestAnswer = useCallback(() => {
    showSessionEndAfterVote(null);
    if (!taleSessionId) {
      void saveTaleSession(taleQuestion, buildTaleResponses(stories)).then((saved) => {
        if (!saved.ok) markSessionSaveFailed(saved.error);
      });
    }
  }, [showSessionEndAfterVote, taleSessionId, taleQuestion, stories, saveTaleSession, markSessionSaveFailed]);

  const resolveShareUrlForShare = useCallback(async (): Promise<string | null> => {
    if (shareId) return `${PUBLIC_SHARE_BASE}/${shareId}`;
    const saved = await saveTaleSession(taleQuestion, buildTaleResponses(stories));
    if (!saved.ok) return null;
    return `${PUBLIC_SHARE_BASE}/${saved.share_id}`;
  }, [shareId, taleQuestion, stories, saveTaleSession]);

  const showSessionEndPreparing =
    Boolean(sessionEndPanel) && !(taleSessionId && shareId) && !sessionEndSaveFailed;
  const showSessionEndPanel =
    Boolean(sessionEndPanel) &&
    (Boolean(taleSessionId && shareId) || sessionEndSaveFailed);

  useEffect(() => {
    if (!allDone || step !== "review" || !showVoting) return;
    if (taleSaveScheduledRef.current) return;
    if (!taleQuestion.trim()) return;
    taleSaveScheduledRef.current = true;
    void (async () => {
      const saved = await saveTaleSession(taleQuestion, buildTaleResponses(stories));
      if (!saved.ok) markSessionSaveFailed(saved.error);
      if (bestAnswerTimerRef.current != null) clearTimeout(bestAnswerTimerRef.current);
      bestAnswerTimerRef.current = setTimeout(() => {
        setBestAnswerPanel({ providers: AI_ORDER });
        bestAnswerTimerRef.current = null;
      }, BEST_ANSWER_DELAY_MS);
    })();
  }, [allDone, step, showVoting, taleQuestion, stories, saveTaleSession, markSessionSaveFailed]);

  const generateStories = useCallback(async () => {
    if (!genre || generating) return;
    if (genre === "Custom" && !keyword.trim()) {
      setError("Describe your genre to continue.");
      return;
    }
    setError(null);
    dismissSessionPanels();
    setTaleSessionId(null);
    setShareId(null);
    taleSaveScheduledRef.current = false;
    setGenerating(true);
    setStep("generating");
    setStories({});
    setShowVoting(false);
    setReadyCount(0);
    setReadyMap({});
    setCompletedOrder([]);

    try {
      const res = await authenticatedFetch("/api/stage/tale", {
        method: "POST",
        json: {
          genre,
          keyword: genre === "Custom" ? keyword : twistOpen ? keyword : "",
          language: language.trim() || "English",
        },
      });

      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string; balance?: number };
        if (typeof j?.balance === "number") setCredits(j.balance);
        setError(j?.error ?? "Request failed");
        setStep("twist");
        setGenerating(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      const seen = new Set<AiProviderName>();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const ev of events) {
          const lines = ev.split("\n");
          for (const line of lines) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const payload = t.startsWith("data: ") ? t.slice(6) : t.slice(5);
            if (!payload.trim()) continue;

            let msg: any;
            try {
              msg = JSON.parse(payload);
            } catch {
              continue;
            }

            if (msg?.done === true) {
              if (typeof msg.sessionId === "string") setSessionId(msg.sessionId);
              setStep("review");
              setShowVoting(true);
              continue;
            }

            if (typeof msg?.error === "string" && !msg.provider) {
              setError(msg.error);
              continue;
            }

            const p = msg?.provider as AiProviderName;
            if (!(AI_ORDER as readonly string[]).includes(p)) continue;

            const storyRow: TaleStory = {
              provider: p,
              model: typeof msg?.model === "string" ? msg.model : "",
              story: typeof msg?.story === "string" ? msg.story : null,
              responseTimeMs: typeof msg?.responseTimeMs === "number" ? msg.responseTimeMs : 0,
              totalTokens:
                typeof msg?.token_input === "number" && typeof msg?.token_output === "number"
                  ? msg.token_input + msg.token_output
                  : null,
              error: typeof msg?.error === "string" ? msg.error : undefined,
            };

            setStories((prev) => ({ ...prev, [p]: storyRow }));
            setCompletedOrder((prev) => (prev.includes(p) ? prev : [...prev, p]));
            if (!seen.has(p)) {
              seen.add(p);
              setReadyMap((prev) => ({ ...prev, [p]: true }));
              setReadyCount(seen.size);
            }
          }
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStep("twist");
    } finally {
      setGenerating(false);
    }
  }, [genre, generating, keyword, language, twistOpen, dismissSessionPanels]);

  useEffect(() => {
    if (step === "generating" && allDone && !generating) setStep("review");
  }, [allDone, generating, step]);

  return (
    <div className={BG}>
      <HelpModal content={taleHelpContent} />
      <header className="fixed left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#0a0f1e]/95 px-3 py-2.5 backdrop-blur-md sm:px-4">
        <button
          type="button"
          onClick={() => {
            if (step === "twist") {
              setStep("genre");
              return;
            }
            router.push("/modes/stage");
          }}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-2 text-sm text-white/90 transition hover:bg-white/14"
        >
          <ChevronLeft className="h-4 w-4" />
          STAGE
        </button>
        <span className="rounded-full bg-[#131c35] px-3 py-1.5 text-xs text-slate-200">
          📖 TALE
        </span>
      </header>

      <main className="mx-auto max-w-4xl px-3 pb-16 pt-16 sm:px-4">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/8 text-2xl">
            <span aria-hidden>📖</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">TALE</h1>
          <p className="mt-2 text-sm text-slate-400">One genre. Six stories.</p>
        </div>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {step === "genre" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {GENRES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    setGenre(g.id);
                    setTwistOpen(g.id === "Custom");
                    setKeyword("");
                    setStep("twist");
                  }}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-white/20 hover:bg-white/[0.06]"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/8 text-xl">
                      <span aria-hidden>{g.icon}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{g.name}</p>
                      <p className="mt-1 text-sm text-slate-400">{g.desc}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === "twist" && genre ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
            <div className="flex flex-col gap-1">
              <p className="text-xs uppercase tracking-wide text-slate-500">Genre</p>
              <p className="text-lg font-semibold text-white">
                {GENRES.find((g) => g.id === genre)?.icon} {genre}
              </p>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">🌐 Story Language</p>
              <input
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="English"
                className="mt-2 w-full rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
              />
              <p className="mt-2 text-xs text-slate-500">
                Type any language — Korean, Japanese, Spanish, French...
              </p>
            </div>

            {genre !== "Custom" ? (
              <button
                type="button"
                onClick={() => setTwistOpen((v) => !v)}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/6 px-3 py-2 text-sm text-white/90 hover:bg-white/8"
              >
                ＋ Add your own twist (optional)
              </button>
            ) : null}

            {twistOpen ? (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {genre === "Custom" ? "Describe your genre" : "Optional keyword"}
                </p>
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  required={genre === "Custom"}
                  placeholder={
                    genre === "Custom"
                      ? "e.g. Cyberpunk noir, Medieval comedy, Space romance, Zombie slice-of-life..."
                      : "e.g. a rainy night, a missing letter, an old photograph..."
                  }
                  className="mt-2 w-full rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
                />
                {genre === "Custom" ? (
                  <p className="mt-2 text-xs text-slate-500">⚠️ Custom genres may produce unexpected results.</p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setStep("genre")}
                className="rounded-xl border border-white/12 bg-white/6 px-4 py-2 text-sm font-semibold text-white hover:bg-white/8"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void generateStories()}
                disabled={generating || (genre === "Custom" && !keyword.trim())}
                className="rounded-xl bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 transition disabled:opacity-40"
              >
                Generate Stories (5 credits)
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Credits: {credits !== null ? credits : "—"}
            </p>
          </div>
        ) : null}

        {step === "generating" || step === "review" ? (
          <div className="space-y-3">
            {completedOrder.map((p) => {
              const row = stories[p];
              if (!row?.story && !row?.error) return null;
              return (
                <div key={p} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <AiNameBadge provider={p} />
                    {row?.responseTimeMs ? (
                      <span className="text-xs tabular-nums text-slate-500">{row.responseTimeMs} ms</span>
                    ) : null}
                  </div>
                  {row?.error ? (
                    <p className="text-sm text-rose-200">{row.error}</p>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{row.story}</p>
                  )}
                </div>
              );
            })}

            {step === "review" && !showVoting ? (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowVoting(true);
                    requestAnimationFrame(() => {
                      voteRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    });
                  }}
                  className="w-full rounded-2xl bg-cyan-500 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
                >
                  I've read them all — Pick the best →
                </button>
              </div>
            ) : null}

            {step === "review" && showVoting && bestAnswerPanel && !sessionEndPanel ? (
              <div ref={voteRef} className="space-y-4 pt-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
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
                  <p className="mb-4 text-sm text-slate-400">
                    Pick one AI. Your choice is saved to Archive when you vote.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
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
            ) : null}

            {sessionEndPanel ? (
              <div className="pt-4">
                {showSessionEndPreparing ? (
                  <div className="rounded-2xl border border-white/10 bg-[#121a2e] p-4">
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
                    compareSessionId={taleSessionId ?? ""}
                    shareId={shareId ?? ""}
                    visible={sessionEndVisual}
                    saveFailed={sessionEndSaveFailed}
                    onResolveShareUrl={resolveShareUrlForShare}
                    onDone={dismissSessionPanels}
                    goPublicPath="/api/tale/go-public"
                  />
                ) : null}
              </div>
            ) : null}

            <div ref={bottomRef} />
          </div>
        ) : null}

        {sessionEndPanel ? (
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => {
                dismissSessionPanels();
                setStep("genre");
                setGenre(null);
                setKeyword("");
                setTwistOpen(false);
                setSessionId(null);
                setStories({});
                setError(null);
                taleSaveScheduledRef.current = false;
                setTaleSessionId(null);
                setShareId(null);
              }}
              className="rounded-xl bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              Try Another Genre
            </button>
            <button
              type="button"
              onClick={() => router.push("/modes/stage/archive")}
              className="rounded-xl border border-white/12 bg-white/6 px-5 py-2 text-sm font-semibold text-white hover:bg-white/8"
            >
              View Archive
            </button>
          </div>
        ) : null}

        <p className="mt-8 px-3 py-2 text-center text-xs leading-relaxed text-slate-600 md:hidden">
          📱 On mobile, keep your screen on and stay in this tab — switching apps may interrupt loading. A smoother mobile experience is on the way.
        </p>
      </main>

      {step === "generating" ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#0a0f1e]/95 backdrop-blur-md">
          <div className="mx-auto max-w-4xl px-3 py-3 sm:px-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm text-slate-300">Generating stories…</p>
              <p className="text-sm font-semibold text-white">{readyCount} / 6 stories ready</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {AI_ORDER.map((p) => {
                const done = readyMap[p] === true;
                return (
                  <div key={p} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                    <div className="flex items-center justify-between">
                      <AiNameBadge provider={p} />
                      {done ? (
                        <span className="text-[11px] text-emerald-300">Ready</span>
                      ) : (
                        <span className="text-[11px] text-slate-400">
                          <span className="inline-flex gap-1">
                            <span className="animate-pulse">•</span>
                            <span className="animate-pulse [animation-delay:150ms]">•</span>
                            <span className="animate-pulse [animation-delay:300ms]">•</span>
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

