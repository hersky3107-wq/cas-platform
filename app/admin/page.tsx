"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/db/supabase";

const OWNER_EMAIL = "hersky3107@gmail.com";

type GenreTab = "All" | "Horror" | "Romance" | "Absurd" | "Sci-Fi" | "Fairy Tale" | "Sad Story";
const GENRE_TABS: (GenreTab | "Custom")[] = ["All", "Horror", "Romance", "Absurd", "Sci-Fi", "Fairy Tale", "Sad Story", "Custom"];
const STANDARD_GENRES = ["Horror", "Romance", "Absurd", "Sci-Fi", "Fairy Tale", "Sad Story"] as const;

const API_BALANCE_LINKS = [
  { name: "ChatGPT (OpenAI)", href: "https://platform.openai.com/settings/organization/billing/overview" },
  { name: "Claude (Anthropic)", href: "https://console.anthropic.com/settings/billing" },
  { name: "Gemini (Google)", href: "https://console.cloud.google.com/billing" },
  { name: "Grok (xAI)", href: "https://console.x.ai/" },
  { name: "DeepSeek", href: "https://platform.deepseek.com/usage" },
  { name: "Mistral", href: "https://console.mistral.ai/billing/" },
] as const;

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

/**
 * One round's result from the grading sweep. Mirrors `RoundGradingResult` in
 * `lib/prediction/grading-core.ts` — the operator sees exactly what the engine
 * decided, including the rounds it REFUSED to grade and why.
 */
type GradingRoundResult = {
  outcome: "graded" | "unresolvable" | "rejected" | "error";
  roundId: string;
  instrument: string | null;
  direction?: "up" | "down";
  resolutionPrice?: number;
  resolutionSessionDate?: string;
  childrenGraded?: number;
  reason?: string;
  detail?: string;
  error?: string;
};

type GradingReport = {
  scanned: number;
  graded: number;
  unresolvable: number;
  rejected: number;
  failed: number;
  childrenGraded: number;
  seriesCalls: number;
  truncated: boolean;
  rounds: GradingRoundResult[];
};

type AdminStats = {
  overview: {
    totalUsers: number;
    newUsersToday: number;
    totalSessions: number;
    sessionsToday: number;
  };
  moduleUsage: { mode: string; count: number }[];
  maxModuleCount: number;
  credits: {
    totalCreditsIssued: number;
    paypalPurchaseCount: number;
    revenueEstimateUsd: number;
  };
  recentSignups: {
    id: string;
    email: string;
    created_at: string;
    credits: number;
  }[];
};

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-white">{value}</p>
    </div>
  );
}

function formatSignupDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function AdminPage() {
  const [authState, setAuthState] = useState<"checking" | "denied" | "allowed">("checking");
  const [tab, setTab] = useState<(GenreTab | "Custom")>("All");
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [stories, setStories] = useState<AdminStory[]>([]);

  const [dashLoading, setDashLoading] = useState(false);
  const [dashError, setDashError] = useState<string | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [announcementText, setAnnouncementText] = useState("");
  const [announcementVersion, setAnnouncementVersion] = useState("v1");
  const [announcementDraft, setAnnouncementDraft] = useState("");
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [announcementMsg, setAnnouncementMsg] = useState<string | null>(null);

  const [gradingBusy, setGradingBusy] = useState(false);
  const [gradingError, setGradingError] = useState<string | null>(null);
  const [gradingReport, setGradingReport] = useState<GradingReport | null>(null);

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
      setDashLoading(true);
      setDashError(null);
      try {
        const [statsRes, annRes] = await Promise.all([
          fetch("/api/admin/stats", { method: "GET", credentials: "include" }),
          fetch("/api/admin/announcement", { method: "GET", credentials: "include" }),
        ]);
        const statsJson = (await statsRes.json().catch(() => null)) as AdminStats & { error?: string };
        if (!statsRes.ok) throw new Error(statsJson?.error ?? "Stats request failed");
        setStats(statsJson as AdminStats);

        const annJson = (await annRes.json().catch(() => null)) as {
          text?: string;
          version?: string;
          error?: string;
        };
        if (annRes.ok && annJson?.text) {
          setAnnouncementText(annJson.text);
          setAnnouncementDraft(annJson.text);
          if (annJson.version) setAnnouncementVersion(annJson.version);
        }
      } catch (e: unknown) {
        setDashError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setDashLoading(false);
      }
    })();
  }, [authState]);

  useEffect(() => {
    if (authState !== "allowed") return;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/archive`, { method: "GET", credentials: "include" });
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

  async function saveAnnouncement() {
    const text = announcementDraft.trim();
    if (!text) return;
    setAnnouncementSaving(true);
    setAnnouncementMsg(null);
    try {
      const res = await fetch("/api/admin/announcement", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const j = (await res.json().catch(() => null)) as {
        ok?: boolean;
        text?: string;
        version?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(j?.error ?? "Save failed");
      if (j.text) {
        setAnnouncementText(j.text);
        setAnnouncementDraft(j.text);
      }
      if (j.version) setAnnouncementVersion(j.version);
      setAnnouncementMsg(`Saved (${j.version ?? announcementVersion}). Users will see the new banner.`);
    } catch (e: unknown) {
      setAnnouncementMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setAnnouncementSaving(false);
    }
  }

  /**
   * Grades every due, ungraded prediction round in one pass. Sends NO body and
   * NO query string, because there is nothing to choose: the endpoint rejects
   * anything that looks like a selector (see the route's doc comment). There is
   * deliberately no "re-grade" button anywhere on this page — a graded round is
   * final.
   */
  async function gradeDueRounds() {
    if (gradingBusy) return;
    setGradingBusy(true);
    setGradingError(null);
    try {
      const res = await fetch("/api/admin/prediction/reconcile", { method: "POST", credentials: "include" });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; report?: GradingReport; error?: string; detail?: string };
      if (!res.ok) throw new Error(j?.detail ?? j?.error ?? "Grading sweep failed");
      setGradingReport(j?.report ?? null);
    } catch (e: unknown) {
      setGradingError(e instanceof Error ? e.message : "Grading sweep failed");
    } finally {
      setGradingBusy(false);
    }
  }

  async function togglePin(story: AdminStory) {
    if (actionBusy[story.session_id]) return;
    setBusy(story.session_id, true);
    setError(null);
    try {
      const res = await fetch("/api/admin/archive", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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
        credentials: "include",
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

  const maxMod = stats?.maxModuleCount ?? 1;

  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-10 text-white">
      <div className="mx-auto max-w-6xl space-y-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">ADMIN DASHBOARD</h1>
            <p className="mt-1 text-sm text-slate-400">Overview, credits, signups, and site announcement.</p>
          </div>
          <a
            href="/admin/platform-health"
            className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/15"
          >
            Platform health →
          </a>
        </div>

        {dashError ? (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {dashError}
          </div>
        ) : null}

        {dashLoading ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center text-sm text-slate-300">
            Loading dashboard…
          </div>
        ) : stats ? (
          <>
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Overview</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="Total users" value={stats.overview.totalUsers} />
                <StatCard label="New users today" value={stats.overview.newUsersToday} />
                <StatCard label="Total sessions" value={stats.overview.totalSessions} />
                <StatCard label="Sessions today" value={stats.overview.sessionsToday} />
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Module usage (last 7 days)
              </h2>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
                {stats.moduleUsage.length === 0 ? (
                  <p className="text-sm text-slate-400">No sessions in the last 7 days.</p>
                ) : (
                  <ul className="space-y-3">
                    {stats.moduleUsage.map((row) => (
                      <li key={row.mode}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="font-medium text-white">{row.mode}</span>
                          <span className="tabular-nums text-slate-300">{row.count}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-cyan-500/70"
                            style={{ width: `${Math.max(4, (row.count / maxMod) * 100)}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Credits</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatCard label="Total credits (users sum)" value={stats.credits.totalCreditsIssued} />
                <StatCard label="PayPal purchases" value={stats.credits.paypalPurchaseCount} />
                <StatCard
                  label="Revenue estimate (USD)"
                  value={`$${stats.credits.revenueEstimateUsd.toFixed(2)}`}
                />
              </div>
            </section>

            <section>
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">
                API BALANCE
              </h2>
              <p className="mb-3 text-sm text-slate-500">
                Click to check each provider&apos;s dashboard directly.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {API_BALANCE_LINKS.map((item) => (
                  <a
                    key={item.name}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 transition hover:border-cyan-400/35 hover:bg-white/[0.07]"
                  >
                    <span className="font-semibold text-white">{item.name}</span>
                    <span className="mt-2 text-sm text-cyan-300">Check Balance →</span>
                  </a>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Recent signups
              </h2>
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                <div className="grid grid-cols-12 gap-2 border-b border-white/10 px-4 py-3 text-xs font-semibold text-slate-300">
                  <div className="col-span-5">Email</div>
                  <div className="col-span-4">Created</div>
                  <div className="col-span-3 text-right">Credits</div>
                </div>
                {stats.recentSignups.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-slate-400">No users yet.</div>
                ) : (
                  <div className="divide-y divide-white/8">
                    {stats.recentSignups.map((u) => (
                      <div key={u.id} className="grid grid-cols-12 gap-2 px-4 py-3 text-sm">
                        <div className="col-span-5 truncate text-slate-100">{u.email}</div>
                        <div className="col-span-4 text-slate-400">{formatSignupDate(u.created_at)}</div>
                        <div className="col-span-3 text-right tabular-nums text-slate-200">{u.credits}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Payment alerts
              </h2>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm text-slate-300">
                <p>
                  New PayPal purchases send an email to{" "}
                  <span className="text-cyan-300">{OWNER_EMAIL}</span> via Resend when{" "}
                  <code className="text-xs text-slate-400">RESEND_API_KEY</code> is set (subject: &quot;AIMANI:
                  New Payment Received&quot;).
                </p>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Announcement banner
              </h2>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
                <p className="mb-2 text-xs text-slate-500">
                  Live version: <span className="text-cyan-300">{announcementVersion}</span>
                </p>
                {announcementText ? (
                  <p className="mb-4 rounded-xl border border-white/10 bg-[#0b1020] px-3 py-2 text-sm text-slate-200">
                    {announcementText}
                  </p>
                ) : null}
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Banner text
                </label>
                <textarea
                  value={announcementDraft}
                  onChange={(e) => setAnnouncementDraft(e.target.value)}
                  rows={3}
                  className="mt-2 w-full resize-y rounded-xl border border-white/12 bg-white/6 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/40 focus:outline-none"
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void saveAnnouncement()}
                    disabled={announcementSaving || !announcementDraft.trim()}
                    className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                  >
                    {announcementSaving ? "Saving…" : "Save"}
                  </button>
                  {announcementMsg ? (
                    <span className="text-xs text-slate-400">{announcementMsg}</span>
                  ) : null}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Saving bumps the version so users who dismissed an older banner will see the new text.
                </p>
              </div>
            </section>
          </>
        ) : null}

        <section className="border-t border-white/10 pt-10">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Prediction league — grading
          </h2>
          <p className="mb-3 text-sm text-slate-500">
            Grades every due, ungraded round in one pass. There is nothing to choose: no batch size, no round
            picker, and a round that is already graded is never re-graded. Rounds are also graded automatically
            when someone opens them — this button is for rounds nobody has read yet.
          </p>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void gradeDueRounds()}
                disabled={gradingBusy}
                className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {gradingBusy ? "Grading due rounds…" : "Grade all due rounds"}
              </button>
              {gradingReport ? (
                <span className="text-xs text-slate-400">
                  {gradingReport.scanned} scanned · {gradingReport.graded} graded ({gradingReport.childrenGraded}{" "}
                  predictions) · {gradingReport.unresolvable} unresolvable · {gradingReport.rejected} rejected ·{" "}
                  {gradingReport.failed} failed · {gradingReport.seriesCalls} price call(s)
                  {gradingReport.truncated ? " · more remain, run again" : ""}
                </span>
              ) : null}
            </div>

            {gradingError ? (
              <p className="mt-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                {gradingError}
              </p>
            ) : null}

            {gradingReport ? (
              gradingReport.rounds.length === 0 ? (
                <p className="mt-3 text-xs text-slate-400">No due, ungraded rounds — nothing to grade.</p>
              ) : (
                <ul className="mt-3 space-y-1.5 text-xs">
                  {gradingReport.rounds.map((r) => (
                    <li key={r.roundId} className="flex flex-wrap items-baseline gap-x-2 text-slate-300">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          r.outcome === "graded"
                            ? "bg-emerald-500/15 text-emerald-200"
                            : r.outcome === "unresolvable"
                              ? "bg-amber-500/15 text-amber-200"
                              : r.outcome === "rejected"
                                ? "bg-white/10 text-slate-300"
                                : "bg-rose-500/15 text-rose-200"
                        }`}
                      >
                        {r.outcome}
                      </span>
                      <span className="font-semibold text-white">{r.instrument ?? "—"}</span>
                      <span className="font-mono text-[10px] text-slate-500">{r.roundId}</span>
                      <span className="text-slate-400">
                        {r.outcome === "graded"
                          ? `${r.direction} · ${r.resolutionSessionDate} close ${r.resolutionPrice} · ${r.childrenGraded} graded`
                          : r.outcome === "error"
                            ? r.error
                            : `${r.reason}${r.detail ? ` — ${r.detail}` : ""}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        </section>

        <section className="border-t border-white/10 pt-10">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-bold tracking-tight">ARCHIVE ADMIN</h2>
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
        </section>
      </div>
    </main>
  );
}
