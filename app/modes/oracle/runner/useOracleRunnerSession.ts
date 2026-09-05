"use client";

/**
 * The Oracle runner session loop: create, poll, advance, resume.
 *
 * One implementation, shared by every screen that runs on the 12-system
 * engine. The runner is chunked — each advance call runs one chunk of AI work
 * in `after()` and returns immediately — so the client's job is to poll and to
 * kick the next chunk whenever no worker holds the lease. That is also what
 * makes a reload survivable: the session id is the only state worth keeping.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type OracleRunnerStatus =
  | "queued"
  | "computing"
  | "layer1"
  | "layer2"
  | "done"
  | "partial"
  | "failed";

export const ORACLE_RUNNER_TERMINAL: ReadonlySet<OracleRunnerStatus> = new Set([
  "done",
  "partial",
  "failed",
]);

type JsonObject = Record<string, unknown>;

export type OracleRunnerComputation = {
  system: string;
  engineVersion: string | null;
  axes: JsonObject | null;
  calculation: JsonObject | null;
  unreadable: boolean;
};

export type OracleRunnerReading = {
  system: string;
  brand: string;
  narrative: string | null;
  summary: JsonObject | null;
  status: string | null;
  latencyMs: number | null;
};

export type OracleRunnerConsensus = {
  agreements: string[];
  divergences: string[];
  conclusion: string | null;
  confidenceNote: string | null;
  unanimous: boolean | null;
};

export type OracleRunnerAssumptions = {
  sexDefaulted: boolean
  timezoneDefaulted: boolean
  coordinatesDefaulted: boolean
  birthTimeUnknown: boolean
  birthTimeEstimated: boolean
}

export type OracleRunnerView = {
  sessionId: string;
  status: OracleRunnerStatus;
  nextAction: string | null;
  counts: { done: number; pending: number; failed: number; total: number };
  systems: string[];
  /** Reader BRANDS in seat order for a single-system session. */
  readerRoster: string[];
  locale: string | null;
  working: boolean;
  computations: OracleRunnerComputation[];
  readings: OracleRunnerReading[];
  consensus: OracleRunnerConsensus | null;
  assumptions: OracleRunnerAssumptions | null;
  aiMode: "stub" | "live";
};

export type StartOracleSessionRequest = {
  subjectProfileId: string;
  systems: string[];
  readerCount: number;
  question?: string | null;
  kind?: "personal" | "compat" | "daily" | "talisman";
  scope?: "single" | "combined";
  sessionInputs?: JsonObject | null;
  locale?: string;
};

const POLL_INTERVAL_MS = 2_000;

export function useOracleRunnerSession({ storageKey }: { storageKey: string }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [view, setView] = useState<OracleRunnerView | null>(null);
  const [initialComputations, setInitialComputations] = useState<OracleRunnerComputation[]>([])
  const [assumptions, setAssumptions] = useState<OracleRunnerAssumptions | null>(null);
  const [aiMode, setAiMode] = useState<"stub" | "live" | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const advancing = useRef(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    // Deferred so this effect only reads the external store.
    if (saved) queueMicrotask(() => setSessionId(saved));
  }, [storageKey]);

  const advance = useCallback(async (id: string) => {
    if (advancing.current) return;
    advancing.current = true;
    try {
      await fetch(`/api/oracle/session/${encodeURIComponent(id)}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } finally {
      advancing.current = false;
    }
  }, []);

  const poll = useCallback(
    async (id: string) => {
      const response = await fetch(`/api/oracle/session/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        if (response.status === 404) {
          window.localStorage.removeItem(storageKey);
          setSessionId(null);
        }
        throw new Error("세션을 불러오지 못했습니다.");
      }
      const payload = (await response.json()) as { ok: true } & OracleRunnerView;
      setView(payload);
      if (!ORACLE_RUNNER_TERMINAL.has(payload.status) && !payload.working) void advance(id);
    },
    [advance, storageKey],
  );

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        await poll(sessionId);
        setError(null);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "세션을 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [poll, sessionId]);

  const start = useCallback(
    async (request: StartOracleSessionRequest): Promise<{ ok: boolean; balance?: number }> => {
      setStarting(true);
      setError(null);
      try {
        const response = await fetch("/api/oracle/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: request.kind ?? "personal",
            scope: request.scope ?? "single",
            subjectProfileId: request.subjectProfileId,
            systems: request.systems,
            question: request.question?.trim() ? request.question.trim() : null,
            sessionInputs: request.sessionInputs ?? null,
            readerCount: request.readerCount,
            locale: request.locale ?? "ko",
          }),
        });
        const payload = (await response.json().catch(() => null)) as {
          sessionId?: string;
          computations?: OracleRunnerComputation[];
          assumptions?: OracleRunnerAssumptions | null;
          aiMode?: "stub" | "live";
          balance?: number;
          error?: string;
        } | null;

        if (!response.ok || !payload?.sessionId) {
          setError(payload?.error ?? "읽기 세션을 시작하지 못했습니다.");
          return { ok: false, balance: payload?.balance };
        }

        setInitialComputations(payload.computations ?? []);
        setAssumptions(payload.assumptions ?? null);
        setAiMode(payload.aiMode === "stub" ? "stub" : "live");
        setView(null);
        setSessionId(payload.sessionId);
        window.localStorage.setItem(storageKey, payload.sessionId);
        void advance(payload.sessionId);
        return { ok: true };
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "읽기를 시작하지 못했습니다.");
        return { ok: false };
      } finally {
        setStarting(false);
      }
    },
    [advance, storageKey],
  );

  const reset = useCallback(() => {
    window.localStorage.removeItem(storageKey);
    setSessionId(null);
    setView(null);
    setInitialComputations([]);
    setAssumptions(null);
    setAiMode(null);
    setError(null);
  }, [storageKey]);

  // The create response carries the chart before the first poll returns, so
  // the calculation is on screen immediately rather than one tick later.
  const computations = view?.computations.length ? view.computations : initialComputations;
  const terminal = view ? ORACLE_RUNNER_TERMINAL.has(view.status) : false;
  const resolvedAssumptions = view?.assumptions ?? assumptions;
  const resolvedAiMode = view?.aiMode ?? aiMode;

  return {
    sessionId,
    view,
    computations,
    assumptions: resolvedAssumptions,
    aiMode: resolvedAiMode,
    terminal,
    starting,
    error,
    setError,
    start,
    reset,
  };
}
