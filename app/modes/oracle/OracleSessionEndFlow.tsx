"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CompareSessionEndPanel } from "@/app/modes/compare/CompareSessionEndPanel";
import { authenticatedFetch } from "@/lib/api/authenticated-fetch";
import { PUBLIC_SHARE_BASE } from "@/lib/compare/session-types";
import type { OracleSessionResponse } from "@/lib/oracle/session-types";

const BEST_ANSWER_DELAY_MS = 2000;

/**
 * Vote-button accents. Keyed by the label that lands in
 * `oracle_sessions.responses[].ai_name`, which is a legacy display name on the
 * old routes and a roster BRAND on the runner. Both sets are listed because a
 * missing entry silently renders a grey button.
 *
 * Colours only — this component must never import the model registry, which
 * carries server-only model ids.
 */
const AI_ACCENT: Record<string, string> = {
  // Legacy display names (Astro / Tarot / Daily)
  ChatGPT: "#10A37F",
  Claude: "#D97757",
  Gemini: "#4285F4",
  Grok: "#718096",
  // Roster brands (runner sessions)
  "Z.ai": "#5B5BD6",
  "Moonshot AI": "#06B6D4",
  xAI: "#0B0B0B",
  NVIDIA: "#76B900",
  DeepSeek: "#4D6BFE",
  Google: "#4285F4",
  OpenAI: "#10A37F",
  Anthropic: "#D97757",
  Cohere: "#39594D",
  Meta: "#0064E0",
  MiniMax: "#F2545B",
  Mistral: "#FF7000",
  NAVER: "#03C75A",
};

type SaveOracleSessionResult =
  | { ok: true; id: string; share_id: string }
  | { ok: false; error: string };

type OracleSessionEndFlowProps = {
  oracleType: string;
  question: string;
  allDone: boolean;
  getResponses: () => OracleSessionResponse[];
  /** AI display names eligible for “best answer” vote */
  voteLabels: string[];
  /**
   * Identity of the run being archived — the runner session id for engine
   * sessions. The mount ref alone cannot prevent a duplicate archive row,
   * because a resumed session mounts this component again with the same
   * finished run. Keyed on this, the archive is written exactly once and later
   * mounts reuse the stored share id.
   */
  saveKey?: string | null;
};

type ArchivedSession = { id: string; share_id: string };

function archiveStorageKey(saveKey: string): string {
  return `oracle.archive.${saveKey}`;
}

function readArchived(saveKey: string): ArchivedSession | null {
  try {
    const raw = window.localStorage.getItem(archiveStorageKey(saveKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ArchivedSession>;
    if (typeof parsed.id !== "string" || typeof parsed.share_id !== "string") return null;
    return { id: parsed.id, share_id: parsed.share_id };
  } catch {
    return null;
  }
}

export function OracleSessionEndFlow({
  oracleType,
  question,
  allDone,
  getResponses,
  voteLabels,
  saveKey = null,
}: OracleSessionEndFlowProps) {
  const [oracleSessionId, setOracleSessionId] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [sessionEndSaveFailed, setSessionEndSaveFailed] = useState(false);
  const [bestAnswerPanel, setBestAnswerPanel] = useState(false);
  const [bestAnswerVisual, setBestAnswerVisual] = useState(false);
  const [sessionEndPanel, setSessionEndPanel] = useState<{ votedAi: string | null } | null>(
    null,
  );
  const [sessionEndVisual, setSessionEndVisual] = useState(false);
  const saveScheduledRef = useRef(false);
  const archivedRef = useRef<ArchivedSession | null>(null);
  const bestAnswerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sessionQuestion = question.trim() || "Oracle reading";

  useEffect(() => {
    if (!saveKey) return;
    const stored = readArchived(saveKey);
    if (!stored) return;
    archivedRef.current = stored;
    // Deferred so this effect only reads the external store.
    queueMicrotask(() => {
      setOracleSessionId(stored.id);
      setShareId(stored.share_id);
    });
  }, [saveKey]);

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
    console.log("[oracle] save-session error:", reason);
    setSessionEndSaveFailed(true);
  }, []);

  const saveOracleSession = useCallback(
    async (
      q: string,
      responses: OracleSessionResponse[],
    ): Promise<SaveOracleSessionResult> => {
      const archived = archivedRef.current;
      if (archived) return { ok: true, id: archived.id, share_id: archived.share_id };
      if (responses.length < 1) return { ok: false, error: "empty responses" };
      try {
        const res = await authenticatedFetch("/api/oracle/save-session", {
          method: "POST",
          json: { oracle_type: oracleType, question: q, responses },
        });
        const j = (await res.json().catch(() => null)) as {
          id?: string;
          share_id?: string;
          error?: string;
        };
        if (!res.ok || !j.id || !j.share_id) {
          return { ok: false, error: j?.error ?? `HTTP ${res.status}` };
        }
        archivedRef.current = { id: j.id, share_id: j.share_id };
        if (saveKey) {
          try {
            window.localStorage.setItem(
              archiveStorageKey(saveKey),
              JSON.stringify(archivedRef.current),
            );
          } catch {
            // A full or blocked store only costs us the duplicate guard on a
            // later remount; the archive row itself is already written.
          }
        }
        setOracleSessionId(j.id);
        setShareId(j.share_id);
        setSessionEndSaveFailed(false);
        return { ok: true, id: j.id, share_id: j.share_id };
      } catch (e: unknown) {
        return { ok: false, error: e instanceof Error ? e.message : "network error" };
      }
    },
    [oracleType, saveKey],
  );

  const dismissSessionPanels = useCallback(() => {
    if (bestAnswerTimerRef.current != null) {
      clearTimeout(bestAnswerTimerRef.current);
      bestAnswerTimerRef.current = null;
    }
    setSessionEndPanel(null);
    setSessionEndVisual(false);
    setSessionEndSaveFailed(false);
    setBestAnswerPanel(false);
    setBestAnswerVisual(false);
  }, []);

  const showSessionEndAfterVote = useCallback((votedAi: string | null) => {
    if (bestAnswerTimerRef.current != null) {
      clearTimeout(bestAnswerTimerRef.current);
      bestAnswerTimerRef.current = null;
    }
    setBestAnswerPanel(false);
    setBestAnswerVisual(false);
    setSessionEndSaveFailed(false);
    setSessionEndPanel({ votedAi });
  }, []);

  const submitBestAnswerPick = useCallback(
    async (votedLabel: string) => {
      showSessionEndAfterVote(votedLabel);
      try {
        let sessionIdForVote = oracleSessionId;
        if (!sessionIdForVote) {
          const saved = await saveOracleSession(sessionQuestion, getResponses());
          if (!saved.ok) {
            markSessionSaveFailed(saved.error);
            return;
          }
          sessionIdForVote = saved.id;
        }
        if (sessionIdForVote) {
          const res = await authenticatedFetch("/api/oracle/save-session", {
            method: "PATCH",
            json: { session_id: sessionIdForVote, voted_ai: votedLabel },
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => null)) as { error?: string };
            console.log("[oracle] vote error:", j?.error ?? res.status);
          }
        }
      } catch (e: unknown) {
        console.log("[oracle] vote error:", e instanceof Error ? e.message : e);
      }
    },
    [
      oracleSessionId,
      showSessionEndAfterVote,
      sessionQuestion,
      getResponses,
      saveOracleSession,
      markSessionSaveFailed,
    ],
  );

  const skipBestAnswer = useCallback(() => {
    showSessionEndAfterVote(null);
    if (!oracleSessionId) {
      void saveOracleSession(sessionQuestion, getResponses()).then((saved) => {
        if (!saved.ok) markSessionSaveFailed(saved.error);
      });
    }
  }, [
    showSessionEndAfterVote,
    oracleSessionId,
    sessionQuestion,
    getResponses,
    saveOracleSession,
    markSessionSaveFailed,
  ]);

  const resolveShareUrlForShare = useCallback(async (): Promise<string | null> => {
    if (shareId) return `${PUBLIC_SHARE_BASE}/${shareId}`;
    const saved = await saveOracleSession(sessionQuestion, getResponses());
    if (!saved.ok) return null;
    return `${PUBLIC_SHARE_BASE}/${saved.share_id}`;
  }, [shareId, sessionQuestion, getResponses, saveOracleSession]);

  useEffect(() => {
    if (!allDone) return;
    if (saveScheduledRef.current) return;
    const responses = getResponses();
    if (!archivedRef.current && responses.length < 1) return;
    saveScheduledRef.current = true;
    void (async () => {
      const saved = await saveOracleSession(sessionQuestion, responses);
      if (!saved.ok) markSessionSaveFailed(saved.error);
      if (bestAnswerTimerRef.current != null) clearTimeout(bestAnswerTimerRef.current);
      bestAnswerTimerRef.current = setTimeout(() => {
        setBestAnswerPanel(true);
        bestAnswerTimerRef.current = null;
      }, BEST_ANSWER_DELAY_MS);
    })();
  }, [allDone, sessionQuestion, getResponses, saveOracleSession, markSessionSaveFailed]);

  const showSessionEndPreparing =
    Boolean(sessionEndPanel) && !(oracleSessionId && shareId) && !sessionEndSaveFailed;
  const showSessionEndPanel =
    Boolean(sessionEndPanel) &&
    (Boolean(oracleSessionId && shareId) || sessionEndSaveFailed);

  if (!allDone && !bestAnswerPanel && !sessionEndPanel) return null;

  return (
    <div className="mt-8 space-y-4">
      {bestAnswerPanel && !sessionEndPanel ? (
        <div
          className={[
            "rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center transition-all duration-300 ease-out",
            bestAnswerVisual ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
          ].join(" ")}
        >
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
          <p className="mb-4 text-sm text-slate-400">Pick one reader for this session.</p>
          <div className="flex flex-wrap justify-center gap-2">
            {voteLabels.map((label) => (
              <button
                key={label}
                type="button"
                title={label}
                onClick={() => void submitBestAnswerPick(label)}
                className="inline-flex h-9 w-24 min-w-[96px] max-w-[96px] shrink-0 items-center justify-center overflow-hidden rounded-xl px-1 text-sm font-semibold text-white transition hover:opacity-90 box-border"
                style={{
                  backgroundColor: AI_ACCENT[label] ?? "#64748b",
                }}
              >
                <span className="min-w-0 truncate text-center">{label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {sessionEndPanel ? (
        <>
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
              compareSessionId={oracleSessionId ?? ""}
              shareId={shareId ?? ""}
              visible={sessionEndVisual}
              saveFailed={sessionEndSaveFailed}
              onResolveShareUrl={resolveShareUrlForShare}
              onDone={dismissSessionPanels}
              hideGoPublic
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
