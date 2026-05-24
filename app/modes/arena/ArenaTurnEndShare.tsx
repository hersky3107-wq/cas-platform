"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ShareButtons from "@/components/ShareButtons";
import { authenticatedFetch } from "@/lib/api/authenticated-fetch";
import { PUBLIC_SHARE_BASE } from "@/lib/compare/session-types";
import type { ArenaShareRoundRow } from "@/lib/arena/session-types";

type ArenaTurnEndShareProps = {
  active: boolean;
  topic: string;
  turnNumber: 1 | 2 | 3;
  rounds: ArenaShareRoundRow[];
};

export function ArenaTurnEndShare({ active, topic, turnNumber, rounds }: ArenaTurnEndShareProps) {
  const [arenaSessionId, setArenaSessionId] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [goPublicDone, setGoPublicDone] = useState(false);
  const [goPublicLoading, setGoPublicLoading] = useState(false);
  const [goPublicError, setGoPublicError] = useState<string | null>(null);
  const savedTurnRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    setShareOpen(false);
    setGoPublicDone(false);
    setGoPublicError(null);
  }, [active, turnNumber]);

  const saveArenaSession = useCallback(async () => {
    const t = topic.trim();
    if (!t || rounds.length < 1) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      const res = await authenticatedFetch("/api/arena/save-session", {
        method: "POST",
        json: { topic: t, turn_number: turnNumber, rounds },
      });
      const j = (await res.json().catch(() => null)) as {
        id?: string;
        share_id?: string;
        error?: string;
      };
      if (!res.ok || !j.id || !j.share_id) {
        setSaveFailed(true);
        console.log("[arena] save-session error:", j?.error ?? res.status);
        return;
      }
      setArenaSessionId(j.id);
      setShareId(j.share_id);
      savedTurnRef.current = turnNumber;
    } catch (e: unknown) {
      setSaveFailed(true);
      console.log("[arena] save-session error:", e instanceof Error ? e.message : e);
    } finally {
      setSaving(false);
    }
  }, [topic, turnNumber, rounds]);

  useEffect(() => {
    if (!active) return;
    if (rounds.length < 1) return;
    if (savedTurnRef.current === turnNumber && arenaSessionId && shareId) return;
    void saveArenaSession();
  }, [active, turnNumber, rounds, arenaSessionId, shareId, saveArenaSession]);

  const handleGoPublic = useCallback(async () => {
    if (!arenaSessionId) return;
    setGoPublicError(null);
    setGoPublicLoading(true);
    try {
      const res = await authenticatedFetch("/api/arena/go-public", {
        method: "POST",
        json: { session_id: arenaSessionId },
      });
      const j = (await res.json().catch(() => null)) as { share_id?: string; error?: string } | null;
      if (!res.ok) {
        setGoPublicError(typeof j?.error === "string" ? j.error : "Could not publish session");
        return;
      }
      setGoPublicDone(true);
      if (typeof j?.share_id === "string") setShareId(j.share_id);
    } catch (e: unknown) {
      setGoPublicError(e instanceof Error ? e.message : "Could not publish session");
    } finally {
      setGoPublicLoading(false);
    }
  }, [arenaSessionId]);

  if (!active) return null;

  const shareUrl = shareId ? `${PUBLIC_SHARE_BASE}/${shareId}` : undefined;

  return (
    <div className="flex w-full flex-col items-center gap-3 border-t border-white/10 pt-4">
      <button
        type="button"
        onClick={() => setShareOpen((o) => !o)}
        disabled={saving || (!shareId && !saveFailed)}
        className="rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:opacity-40"
      >
        {shareOpen ? "Hide share" : "Share"}
      </button>

      {saving ? (
        <p className="text-center text-xs text-slate-500">Saving session…</p>
      ) : saveFailed ? (
        <p className="text-center text-xs text-amber-300/90">Could not save session for sharing</p>
      ) : null}

      {shareOpen && shareUrl ? (
        <div className="w-full max-w-md text-left">
          <ShareButtons modeName="ARENA" className="mt-0" url={shareUrl} />
        </div>
      ) : null}

      <div className="w-full max-w-md rounded-xl border border-white/12 bg-[#1a2438]/90 p-3 text-left">
        {saveFailed ? (
          <p className="text-sm text-slate-400">Could not save session</p>
        ) : goPublicDone ? (
          <div className="text-sm">
            <p className="font-medium text-slate-200">✅ Indexed!</p>
            {shareId ? (
              <p className="mt-1 text-slate-400">aimani.ai/share/{shareId}</p>
            ) : null}
          </div>
        ) : (
          <>
            <p className="text-sm font-bold text-white">
              <span className="mr-1.5" aria-hidden>
                🔍
              </span>
              Put this on Google
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Let search engines find this battle · No personal info shared
            </p>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => void handleGoPublic()}
                disabled={goPublicLoading || !arenaSessionId}
                className="inline-flex items-center justify-center rounded-full bg-cyan-500 px-4 py-1.5 text-sm font-semibold text-slate-950 shadow-[0_0_20px_rgba(34,211,238,0.25)] transition hover:bg-cyan-400 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {goPublicLoading ? "Publishing…" : "Go Public"}
              </button>
            </div>
          </>
        )}
      </div>

      {goPublicError ? (
        <p className="text-center text-xs text-amber-300/90">{goPublicError}</p>
      ) : null}
    </div>
  );
}
