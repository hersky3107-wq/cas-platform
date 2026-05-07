"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { AiProviderName } from "@/lib/ai/router";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

const GENRES = [
  { id: "Horror", icon: "👻", name: "Horror", desc: "Sleep with the lights on." },
  { id: "Romance", icon: "💕", name: "Romance", desc: "Hearts, mistakes, and longing." },
  { id: "Absurd", icon: "🌀", name: "Absurd", desc: "Logic left the building." },
  { id: "Sci-Fi", icon: "🚀", name: "Sci-Fi", desc: "The future is weirder than you think." },
  { id: "Fairy Tale", icon: "🧚", name: "Fairy Tale", desc: "Old stories, new twists." },
  { id: "Sad Story", icon: "💧", name: "Sad Story", desc: "Beautiful and devastating." },
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
  const [picked, setPicked] = useState<AiProviderName | null>(null);
  const [showVoting, setShowVoting] = useState(false);
  const [readyCount, setReadyCount] = useState(0);
  const [readyMap, setReadyMap] = useState<Partial<Record<AiProviderName, boolean>>>({});
  const [completedOrder, setCompletedOrder] = useState<AiProviderName[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const voteRef = useRef<HTMLDivElement>(null);

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

  const generateStories = useCallback(async () => {
    if (!genre || generating) return;
    setError(null);
    setGenerating(true);
    setStep("generating");
    setPicked(null);
    setStories({});
    setShowVoting(false);
    setReadyCount(0);
    setReadyMap({});
    setCompletedOrder([]);

    try {
      const res = await fetch("/api/stage/tale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          genre,
          keyword: twistOpen ? keyword : "",
          language: language.trim() || "English",
        }),
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
          if (msg.type === "result" && msg.result) {
            const r = msg.result as TaleStory & { provider: AiProviderName };
            if ((AI_ORDER as string[]).includes(r.provider)) {
              setStories((prev) => ({ ...prev, [r.provider]: r }));
              setCompletedOrder((prev) => (prev.includes(r.provider) ? prev : [...prev, r.provider]));
            }
          }
          if (msg.type === "progress") {
            const p = msg.provider as AiProviderName;
            if ((AI_ORDER as string[]).includes(p)) {
              setReadyMap((prev) => ({ ...prev, [p]: true }));
            }
            if (typeof msg.ready === "number") setReadyCount(msg.ready);
          }
          if (msg.type === "error" && typeof msg.error === "string") {
            setError(msg.error);
          }
          if (msg.type === "done") {
            // handled by allDone effect below
          }
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setStep("twist");
    } finally {
      setGenerating(false);
    }
  }, [genre, generating, keyword, language, twistOpen]);

  useEffect(() => {
    if (step === "generating" && allDone && !generating) setStep("review");
  }, [allDone, generating, step]);

  const pickWinner = useCallback(
    async (provider: AiProviderName) => {
      if (!sessionId || !genre) return;
      const row = stories[provider];
      setPicked(provider);
      setError(null);
      try {
        const res = await fetch("/api/stage/tale", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "select",
            sessionId,
            genre,
            keyword: twistOpen ? keyword : "",
            winnerProvider: provider,
            winnerModel: row?.model ?? "",
          }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string };
          setError(j?.error ?? "Could not save selection");
          return;
        }
        setStep("saved");
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    },
    [genre, keyword, sessionId, stories, twistOpen]
  );

  return (
    <div className={BG}>
      <header className="fixed left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#0a0f1e]/95 px-3 py-2.5 backdrop-blur-md sm:px-4">
        <button
          type="button"
          onClick={() => {
            // Explicit navigation: avoid router.back() (may fail with no history).
            if (step === "genre") {
              router.push("/modes/stage");
              return;
            }
            if (step === "twist") {
              setStep("genre"); // in-page view change
              return;
            }
            router.push("/modes/stage/tale");
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
                    setTwistOpen(false);
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

            <button
              type="button"
              onClick={() => setTwistOpen((v) => !v)}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/6 px-3 py-2 text-sm text-white/90 hover:bg-white/8"
            >
              ＋ Add your own twist (optional)
            </button>

            {twistOpen ? (
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="e.g. a rainy night, a missing letter, an old photograph..."
                className="mt-3 w-full rounded-2xl border border-white/12 bg-white/6 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
              />
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
                disabled={generating}
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

            {step === "review" && showVoting ? (
              <div ref={voteRef} className="space-y-4 pt-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
                  <h2 className="text-lg font-semibold text-white">Which story was the best?</h2>
                  <p className="mt-2 text-sm text-slate-400">Pick one AI. We’ll save it to Archive.</p>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {AI_ORDER.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => void pickWinner(p)}
                        className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                          picked === p
                            ? "border-cyan-300 bg-cyan-500/15 text-white"
                            : "border-white/12 bg-white/6 text-slate-200"
                        }`}
                      >
                        {AI_LABEL[p]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div ref={bottomRef} />
          </div>
        ) : null}

        {step === "saved" && picked ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
            <p className="text-lg font-semibold text-white">Saved to Archive ✓</p>
            <p className="mt-2 text-sm text-slate-300">
              Winner: <span className="font-semibold text-white">{AI_LABEL[picked]}</span>
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => {
                  setStep("genre");
                  setGenre(null);
                  setKeyword("");
                  setTwistOpen(false);
                  setSessionId(null);
                  setStories({});
                  setPicked(null);
                  setError(null);
                }}
                className="rounded-xl bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
              >
                Try Another Genre
              </button>
              <Link
                href="/modes/stage/archive"
                className="rounded-xl border border-white/12 bg-white/6 px-5 py-2 text-sm font-semibold text-white hover:bg-white/8"
              >
                View Archive
              </Link>
            </div>
          </div>
        ) : null}
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

