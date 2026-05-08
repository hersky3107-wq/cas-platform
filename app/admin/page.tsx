"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/db/supabase";

const OWNER_EMAIL = "hersky3107@gmail.com";

type GenreTab = "All" | "Horror" | "Romance" | "Absurd" | "Sci-Fi" | "Fairy Tale" | "Sad Story";
const GENRE_TABS: (GenreTab | "Custom")[] = ["All", "Horror", "Romance", "Absurd", "Sci-Fi", "Fairy Tale", "Sad Story", "Custom"];
const STANDARD_GENRES = ["Horror", "Romance", "Absurd", "Sci-Fi", "Fairy Tale", "Sad Story"] as const;

type AdminStory = {
  session_id: string;
  genre: string;
  ai_name: string;
  language: string;
  story_preview: string;
  vote_count: number;
  created_at: string;
  pinned: boolean;
};

export default function AdminPage() {
  const [authState, setAuthState] = useState<"checking" | "denied" | "allowed">("checking");
  const [tab, setTab] = useState<(GenreTab | "Custom")>("All");
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [stories, setStories] = useState<AdminStory[]>([]);

  useEffect(() => {
    void (async () => {
      const { data, error: userErr } = await supabase.auth.getUser();
      const email = data.user?.email ?? "";
      if (userErr || !email || email.toLowerCase() !== OWNER_EMAIL.toLowerCase()) setAuthState("denied");
      else setAuthState("allowed");
    })();
  }, []);

  useEffect(() => {
    if (authState !== "allowed") return;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/archive`, { method: "GET" });
        const j = (await res.json().catch(() => null)) as { stories?: AdminStory[]; error?: string };
        if (!res.ok) throw new Error(j?.error ?? "Request failed");
        setStories(Array.isArray(j?.stories) ? j.stories : []);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, [authState]);

  const filtered = useMemo(() => {
    if (tab === "All") return stories;
    if (tab === "Custom") {
      return stories.filter((s) => {
        const g = String(s.genre ?? "").trim();
        return !STANDARD_GENRES.includes(g as (typeof STANDARD_GENRES)[number]);
      });
    }
    return stories.filter((s) => String(s.genre ?? "").trim() === tab);
  }, [stories, tab]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const dv = (b.vote_count ?? 0) - (a.vote_count ?? 0);
      if (dv !== 0) return dv;
      return String(b.created_at).localeCompare(String(a.created_at));
    });
    return arr;
  }, [filtered]);

  const setBusy = (sessionId: string, v: boolean) => setActionBusy((p) => ({ ...p, [sessionId]: v }));

  async function togglePin(story: AdminStory) {
    if (actionBusy[story.session_id]) return;
    setBusy(story.session_id, true);
    setError(null);
    try {
      const res = await fetch("/api/admin/archive", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: story.session_id, pinned: !story.pinned }),
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; pinned?: boolean; error?: string };
      if (!res.ok) throw new Error(j?.error ?? "Could not toggle pin");
      setStories((prev) =>
        prev.map((s) => (s.session_id === story.session_id ? { ...s, pinned: Boolean(j?.pinned) } : s))
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(story.session_id, false);
    }
  }

  async function deleteStory(story: AdminStory) {
    if (actionBusy[story.session_id]) return;
    const ok = window.confirm("Delete this archived story permanently?");
    if (!ok) return;
    setBusy(story.session_id, true);
    setError(null);
    try {
      const res = await fetch("/api/admin/archive", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: story.session_id }),
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(j?.error ?? "Could not delete story");
      setStories((prev) => prev.filter((s) => s.session_id !== story.session_id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(story.session_id, false);
    }
  }

  if (authState === "checking") {
    return (
      <main className="min-h-screen bg-[#0a0f1e] px-4 py-10 text-white">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center text-sm text-slate-300">
            Loading…
          </div>
        </div>
      </main>
    );
  }

  if (authState === "denied") {
    return (
      <div style={{ background: "#0a0f1e", color: "white", padding: "20px", minHeight: "100vh" }}>
        Access Denied
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-10 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">ARCHIVE ADMIN</h1>
        </div>

        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {GENRE_TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                tab === t ? "border-cyan-300 bg-cyan-500/15 text-white" : "border-white/12 bg-white/5 text-slate-200"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
          <div className="grid grid-cols-12 gap-2 border-b border-white/10 px-4 py-3 text-xs font-semibold text-slate-300">
            <div className="col-span-2">Genre</div>
            <div className="col-span-2">AI</div>
            <div className="col-span-4">Story</div>
            <div className="col-span-1 text-right">Votes</div>
            <div className="col-span-3 text-right">Actions</div>
          </div>

          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-slate-300">Loading…</div>
          ) : sorted.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-300">No archived stories.</div>
          ) : (
            <div className="divide-y divide-white/8">
              {sorted.map((s) => (
                <div key={s.session_id} className="grid grid-cols-12 items-center gap-2 px-4 py-3 text-sm">
                  <div className="col-span-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/5 px-2 py-1 text-xs text-slate-200">
                      {s.genre}
                    </span>
                  </div>
                  <div className="col-span-2 font-semibold text-white">{s.ai_name}</div>
                  <div className="col-span-4 truncate text-slate-100">{String(s.story_preview ?? "").slice(0, 60)}</div>
                  <div className="col-span-1 text-right tabular-nums text-slate-200">{s.vote_count ?? 0}</div>
                  <div className="col-span-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void togglePin(s)}
                      disabled={actionBusy[s.session_id]}
                      className="rounded-xl border border-white/12 bg-white/6 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/8 disabled:opacity-50"
                      title={s.pinned ? "Unpin" : "Pin"}
                    >
                      📌 {s.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteStory(s)}
                      disabled={actionBusy[s.session_id]}
                      className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-500/15 disabled:opacity-50"
                      title="Delete"
                    >
                      🗑️ Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

