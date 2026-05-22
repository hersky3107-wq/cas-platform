"use client";

import Link from "next/link";
import HelpModal from "@/components/HelpModal";
import { archiveHelpContent } from "@/lib/help-modal/archive-content";
import { ChevronLeft, ThumbsUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AiProviderName } from "@/lib/ai/router";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

const GENRE_TABS = ["Best", "Horror", "Romance", "Absurd", "Sci-Fi", "Fairy Tale", "Sad Story", "Custom", "All"] as const;
type GenreTab = (typeof GENRE_TABS)[number];
const STANDARD_GENRES = ["Horror", "Romance", "Absurd", "Sci-Fi", "Fairy Tale", "Sad Story"] as const;

const GENRE_META: Record<
  Exclude<GenreTab, "All" | "Best">,
  { icon: string; color: string; bg: string }
> = {
  Horror: { icon: "👻", color: "text-rose-200", bg: "bg-rose-500/15 border-rose-500/25" },
  Romance: { icon: "💕", color: "text-pink-200", bg: "bg-pink-500/15 border-pink-500/25" },
  Absurd: { icon: "🌀", color: "text-purple-200", bg: "bg-purple-500/15 border-purple-500/25" },
  "Sci-Fi": { icon: "🚀", color: "text-sky-200", bg: "bg-sky-500/15 border-sky-500/25" },
  "Fairy Tale": { icon: "🧚", color: "text-lime-200", bg: "bg-lime-500/15 border-lime-500/25" },
  "Sad Story": { icon: "💧", color: "text-slate-200", bg: "bg-slate-500/15 border-slate-500/25" },
  Custom: { icon: "✏️", color: "text-slate-200", bg: "bg-white/6 border-white/12" },
};

const AI_LABEL: Record<AiProviderName, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
  xai: "Grok",
  deepseek: "DeepSeek",
  mistral: "Mistral",
};

const GEMINI_LETTER_COLORS = ["#4285F4", "#EA4335", "#FBBC05", "#34A853", "#4285F4", "#EA4335"] as const;

function languageDisplayName(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const key = s.toLowerCase();

  const map: Record<string, string> = {
    korean: "한국어",
    "한국어": "한국어",
    hangul: "한국어",
    english: "English",
    japanese: "日本語",
    "日本語": "日本語",
    chinese: "中文",
    "中文": "中文",
    mandarin: "中文",
    spanish: "Español",
    french: "Français",
    german: "Deutsch",
    italian: "Italiano",
    portuguese: "Português",
    russian: "Русский",
    vietnamese: "Tiếng Việt",
    thai: "ไทย",
    indonesian: "Bahasa Indonesia",
  };

  return map[key] ?? s;
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

type ArchiveStory = {
  session_id: string;
  ai_provider: AiProviderName;
  ai_model: string;
  genre: string;
  language: string;
  story_text: string;
  vote_count: number;
  selected_at: string;
  user_has_voted: boolean;
};

export default function StageArchivePage() {
  const [phase, setPhase] = useState<"checking" | "blocked" | "ready">("checking");
  const [credits, setCredits] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<GenreTab>("Best");
  const [loadingList, setLoadingList] = useState(false);
  const [stories, setStories] = useState<ArchiveStory[]>([]);
  const [expanded, setExpanded] = useState<Partial<Record<string, boolean>>>({});
  const [voteBusy, setVoteBusy] = useState<Partial<Record<string, boolean>>>({});

  const fetchStories = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const res = await fetch(`/api/stage/archive`, { method: "GET" });
      const j = (await res.json().catch(() => null)) as { stories?: ArchiveStory[]; error?: string };
      if (!res.ok) throw new Error(j?.error ?? "Request failed");
      setStories(Array.isArray(j?.stories) ? j.stories : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setError(null);
      try {
        const res = await fetch("/api/stage/archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "enter" }),
        });
        const j = (await res.json().catch(() => null)) as { creditsRemaining?: number; error?: string; balance?: number };
        if (!res.ok) {
          setCredits(typeof j?.balance === "number" ? j.balance : null);
          setPhase("blocked");
          setError(j?.error ?? "Not enough credits");
          return;
        }
        if (typeof j?.creditsRemaining === "number") setCredits(j.creditsRemaining);
        setPhase("ready");
        await fetchStories();
      } catch (e: unknown) {
        setPhase("blocked");
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    })();
  }, [fetchStories]);

  const filtered = useMemo(() => {
    if (tab === "All") return stories;
    if (tab === "Best") return stories.filter((s) => (s.vote_count ?? 0) >= 5).sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0));
    if (tab === "Custom") {
      return stories.filter((s) => {
        const g = String(s.genre ?? "").trim();
        return !STANDARD_GENRES.includes(g as (typeof STANDARD_GENRES)[number]);
      });
    }
    return stories.filter((s) => String(s.genre ?? "").trim() === tab);
  }, [stories, tab]);

  const voteFor = useCallback(async (s: ArchiveStory) => {
    const key = `${s.session_id}::${s.ai_provider}`;
    if (s.user_has_voted || voteBusy[key]) return;
    setVoteBusy((p) => ({ ...p, [key]: true }));
    setError(null);
    try {
      const res = await fetch("/api/stage/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "vote", session_id: s.session_id, ai_provider: s.ai_provider }),
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(j?.error ?? "Could not save vote");
      setStories((prev) =>
        prev.map((row) =>
          row.session_id === s.session_id && row.ai_provider === s.ai_provider
            ? { ...row, user_has_voted: true, vote_count: (row.vote_count ?? 0) + 1 }
            : row
        )
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setVoteBusy((p) => ({ ...p, [key]: false }));
    }
  }, [voteBusy]);

  return (
    <div className={BG}>
      <HelpModal content={archiveHelpContent} />
      <header className="fixed left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#0a0f1e]/95 px-3 py-2.5 backdrop-blur-md sm:px-4">
        <Link
          href="/modes/stage"
          className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-2 text-sm text-white/90 transition hover:bg-white/14"
        >
          <ChevronLeft className="h-4 w-4" />
          STAGE
        </Link>
        <span className="rounded-full bg-[#131c35] px-3 py-1.5 text-xs text-slate-200">
          📚 ARCHIVE
        </span>
      </header>

      <main className="mx-auto max-w-5xl px-3 pb-24 pt-16 sm:px-4">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/8 text-2xl">
            <span aria-hidden>📚</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">ARCHIVE</h1>
          <p className="mt-2 text-sm text-slate-400">The best stories, chosen by readers.</p>
          <p className="mt-2 text-xs text-slate-500">Entry cost: 1 credit · Remaining: {credits ?? "—"}</p>
        </div>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {phase === "checking" ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center text-sm text-slate-300">
            Loading…
          </div>
        ) : null}

        {phase === "blocked" ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
            <p className="text-lg font-semibold text-white">Not enough credits</p>
            <p className="mt-2 text-sm text-slate-400">You need 1 credit to enter Archive.</p>
          </div>
        ) : null}

        {phase === "ready" ? (
          <>
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              {GENRE_TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTab(t);
                    void fetchStories();
                  }}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                    tab === t ? "border-cyan-300 bg-cyan-500/15 text-white" : "border-white/12 bg-white/5 text-slate-200"
                  }`}
                >
                  {t === "Best"
                    ? `⭐ Best`
                    : t === "All"
                      ? "📚 All"
                      : `${GENRE_META[t].icon} ${t}`}
                </button>
              ))}
            </div>

            {loadingList ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center text-sm text-slate-300">
                Loading stories…
              </div>
            ) : null}

            {!loadingList && filtered.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
                {tab === "Best" ? (
                  <>
                    <p className="text-lg font-semibold text-white">No Best Picks yet.</p>
                    <p className="mt-2 text-sm text-slate-400">Stories with 5+ likes will appear here.</p>
                    <button
                      type="button"
                      onClick={() => setTab("All")}
                      className="mt-4 text-sm font-semibold text-cyan-300 hover:text-cyan-200"
                    >
                      Browse All →
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-lg font-semibold text-white">No stories yet.</p>
                    <p className="mt-2 text-sm text-slate-400">Be the first — go to TALE and create one.</p>
                    <Link
                      href="/modes/stage/tale"
                      className="mt-4 inline-flex rounded-xl bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
                    >
                      Go to TALE
                    </Link>
                  </>
                )}
              </div>
            ) : null}

            <div className="space-y-3">
              {filtered.map((s) => {
                const key = `${s.session_id}::${s.ai_provider}`;
                const isExpanded = expanded[key] === true;
                const genre = String(s.genre ?? "").trim();
                const isStandard = STANDARD_GENRES.includes(genre as (typeof STANDARD_GENRES)[number]);
                const meta =
                  isStandard && genre !== "Best"
                    ? GENRE_META[genre as Exclude<GenreTab, "All" | "Best">]
                    : GENRE_META.Custom;
                const preview = s.story_text;
                return (
                  <div key={key} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                    {tab === "Best" ? (
                      <span className="mb-3 inline-flex items-center gap-1 rounded-full border border-yellow-300/30 bg-yellow-500/10 px-2 py-1 text-xs font-semibold text-yellow-100">
                        ⭐ Best Pick
                      </span>
                    ) : null}
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${meta.bg} ${meta.color}`}>
                        <span aria-hidden>{meta.icon}</span>
                        {isStandard ? String(s.genre) : `Custom`}
                      </span>
                      <AiNameBadge provider={s.ai_provider} />
                      <span className="ml-auto text-xs text-slate-400">{languageDisplayName(s.language)}</span>
                    </div>

                    {!isExpanded ? (
                      <p
                        className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100"
                        style={{
                          display: "-webkit-box",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: 3,
                          overflow: "hidden",
                        }}
                      >
                        {preview}
                      </p>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{s.story_text}</p>
                    )}

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setExpanded((p) => ({ ...p, [key]: !isExpanded }))}
                        className="rounded-xl border border-white/12 bg-white/6 px-4 py-2 text-sm font-semibold text-white hover:bg-white/8"
                      >
                        {isExpanded ? "Collapse" : "Read"}
                      </button>

                      {isExpanded ? (
                        <button
                          type="button"
                          onClick={() => void voteFor(s)}
                          disabled={s.user_has_voted || voteBusy[key]}
                          className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                            s.user_has_voted
                              ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-100"
                              : "border-white/12 bg-white/6 text-white hover:bg-white/8"
                          } disabled:opacity-50`}
                        >
                          <ThumbsUp className="h-4 w-4" />
                          This was great
                          <span className="ml-1 text-xs tabular-nums text-slate-300">({s.vote_count ?? 0})</span>
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                          <ThumbsUp className="h-3.5 w-3.5" /> {s.vote_count ?? 0}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

