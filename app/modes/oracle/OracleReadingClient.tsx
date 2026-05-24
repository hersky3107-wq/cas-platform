"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OracleSessionEndFlow } from "./OracleSessionEndFlow";
import type { OracleSessionResponse } from "@/lib/oracle/session-types";
import { ChevronLeft } from "lucide-react";
import type { AiProviderName, RouterResult } from "@/lib/ai/router";
import type { OracleBirthProfileV1 } from "@/lib/oracle/types";
import { ORACLE_SESSION_COST } from "@/lib/oracle/oracle-constants";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

type ReaderSlot = AiProviderName;

const READER_ORDER_FATE: ReaderSlot[] = ["anthropic", "google", "xai", "deepseek"];
const READER_ORDER_ASTRO: ReaderSlot[] = ["anthropic", "google", "mistral", "deepseek"];

const AI_LABEL: Record<ReaderSlot, string> = {
  anthropic: "Claude",
  openai: "ChatGPT",
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

const AI_BORDER: Record<ReaderSlot, string> = {
  anthropic: "#D97757",
  openai: "#10A37F",
  google: "#4285F4",
  xai: "#ffffff",
  deepseek: "#4D6BFE",
  mistral: "#FF7000",
};

function ReaderBadge({ slot }: { slot: ReaderSlot }) {
  const base =
    "inline-flex rounded-lg px-2.5 py-0.5 text-xs font-bold sm:text-sm";
  if (slot === "openai") {
    return (
      <span className={`${base} bg-[#0a2540] text-white`}>
        {AI_LABEL.openai}
      </span>
    );
  }
  if (slot === "anthropic") {
    return (
      <span className={`${base} bg-[#F5E6D3] text-[#3d2914]`}>
        {AI_LABEL.anthropic}
      </span>
    );
  }
  if (slot === "google") {
    const word = AI_LABEL.google;
    return (
      <span className={`${base} bg-[#0d1117]`} aria-label={word}>
        {word.split("").map((ch, i) => (
          <span
            key={`${i}-${ch}`}
            style={{ color: GEMINI_LETTER_COLORS[i] ?? "#fff" }}
          >
            {ch}
          </span>
        ))}
      </span>
    );
  }
  if (slot === "xai") {
    return (
      <span
        className={`${base} border border-white bg-black text-white`}
      >
        {AI_LABEL.xai}
      </span>
    );
  }
  if (slot === "deepseek") {
    return (
      <span className={`${base} bg-[#1a1464] text-white`}>{AI_LABEL.deepseek}</span>
    );
  }
  return (
    <span className={`${base} bg-[#FF7000] text-white`}>{AI_LABEL.mistral}</span>
  );
}

type NdMeta = {
  type: "meta";
  sessionId: string;
  creditsRemaining: number;
  cost: number;
  mode?: string;
  western_chart?: { sunSign: string; moonSign: string; risingSign: string };
};

type NdReader = {
  type: "reader_result";
  slot: ReaderSlot;
  model: string;
  text: string | null;
  error: string | null;
  response_time_ms: number;
};

type NdSynth = {
  type: "synthesis";
  text: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  response_time_ms: number;
};

type NdError = { type: "error"; error: string };
type NdDone = { type: "done" };
type NdLine = NdMeta | NdReader | NdSynth | NdError | NdDone | { type: string };

export default function OracleReadingClient(props: {
  apiPath: string;
  oracleType: "saju" | "horoscope" | "tarot";
  title: string;
  blurb: string;
  /** When true, parent already verified a complete birth profile (e.g. Fate page). */
  skipProfileGate?: boolean;
  /** Sent with each reading request so the API has birth data alongside the question. */
  oracleBirthProfile?: OracleBirthProfileV1 | null;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readersOut, setReadersOut] = useState<Map<ReaderSlot, RouterResult>>(
    new Map(),
  );
  const [westernMeta, setWesternMeta] = useState<
    NdMeta["western_chart"] | null
  >(null);
  const [synthText, setSynthText] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "streaming" | "done" | "error">(
    "idle",
  );
  const [readingKey, setReadingKey] = useState(0);

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
    if (props.skipProfileGate) return;
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/oracle/profile").catch(() => null);
      if (!res?.ok || cancelled) return;
      const j = (await res.json().catch(() => null)) as {
        profile?: unknown | null;
        complete?: boolean;
      };
      const hasProfile = j?.profile != null && typeof j.profile === "object";
      if ((!hasProfile || !j?.complete) && !cancelled)
        router.replace("/modes/oracle/profile");
    })();
    return () => {
      cancelled = true;
    };
  }, [router, props.skipProfileGate]);

  const run = useCallback(async () => {
    setReadingKey((k) => k + 1);
    setSending(true);
    setError(null);
    setReadersOut(new Map());
    setSynthText(null);
    setSessionId(null);
    setWesternMeta(null);
    setPhase("streaming");

    try {
      const res = await fetch(props.apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          ...(props.oracleBirthProfile
            ? { oracle_birth_profile: props.oracleBirthProfile }
            : {}),
        }),
      });

      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
          balance?: number;
        };
        setError(j?.error ?? "Request failed");
        if (typeof j?.balance === "number") setCredits(j.balance);
        setPhase("error");
        setSending(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("No response body");
        setPhase("error");
        setSending(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          let msg: NdLine;
          try {
            msg = JSON.parse(line) as NdLine;
          } catch {
            continue;
          }
          if (!msg?.type) continue;

          if (msg.type === "meta") {
            const m = msg as NdMeta;
            setSessionId(m.sessionId);
            setCredits(m.creditsRemaining);
            if (m.western_chart) setWesternMeta(m.western_chart);
          }
          if (msg.type === "reader_result") {
            const r = msg as NdReader;
            const rr: RouterResult = {
              provider: r.slot,
              model: r.model,
              text: r.text,
              responseTimeMs: r.response_time_ms,
              promptTokens: null,
              completionTokens: null,
              totalTokens: null,
              error: r.error ?? undefined,
            };
            setReadersOut((prev) => new Map(prev).set(r.slot, rr));
          }
          if (msg.type === "synthesis") {
            const s = msg as NdSynth;
            setSynthText(s.text);
          }
          if (msg.type === "error") {
            setError((msg as NdError).error);
            setPhase("error");
          }
          if (msg.type === "done") {
            setPhase("done");
          }
        }
      }

      setSending(false);
    } catch {
      setError("Network error");
      setPhase("error");
      setSending(false);
    }
  }, [props.apiPath, props.oracleBirthProfile, question]);

  const readerOrder =
    props.apiPath === "/api/oracle/fate" ? READER_ORDER_FATE : READER_ORDER_ASTRO;

  const allReadersDone =
    phase === "done" &&
    !sending &&
    readerOrder.every((slot) => readersOut.has(slot));

  const getResponses = useCallback((): OracleSessionResponse[] => {
    return readerOrder.map((slot) => {
      const r = readersOut.get(slot);
      const content = r?.text ?? (r?.error ? r.error : null);
      return { ai_name: AI_LABEL[slot], content };
    });
  }, [readerOrder, readersOut]);

  const voteLabels = useMemo(
    () => readerOrder.map((slot) => AI_LABEL[slot]),
    [readerOrder],
  );

  return (
    <main className={BG}>
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-5 pb-28 pt-8 sm:px-8 lg:pb-24">
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <Link
            href="/modes/oracle"
            className="inline-flex items-center gap-1 text-sm text-cyan-200/90 hover:text-cyan-100"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden /> Oracle lobby
          </Link>
          {typeof credits === "number" ? (
            <span className="rounded-full bg-[#131c35] px-3 py-1 text-xs font-medium text-slate-200">
              Credits: {credits}
            </span>
          ) : null}
          {sessionId ? (
            <span className="text-[11px] text-white/35">session {sessionId}</span>
          ) : null}
        </div>

        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {props.title}
        </h1>
        <p className="mt-2 max-w-xl text-sm text-slate-300">{props.blurb}</p>

        <div className="mt-8 space-y-2">
          <label className="text-xs uppercase tracking-[0.2em] text-white/55">
            Your question{" "}
            <span className="font-normal lowercase tracking-normal text-white/35">
              (optional)
            </span>
          </label>
          <textarea
            rows={4}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Leave empty for an open-ended portrait—or ask anything that matters to you now."
            className="w-full resize-y rounded-2xl border border-white/15 bg-black/35 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/55 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => run()}
            disabled={
              sending || (typeof credits === "number" && credits < ORACLE_SESSION_COST)
            }
            className="mt-3 w-full rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-900/35 hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
          >
            {sending
              ? "Gathering readings…"
              : `Consult the circle (${ORACLE_SESSION_COST} credits)`}
          </button>
          {typeof credits === "number" && credits < ORACLE_SESSION_COST ? (
            <p className="text-xs text-amber-200/85">
              You need at least {ORACLE_SESSION_COST} credits for one Oracle session.
            </p>
          ) : null}
        </div>

        {westernMeta ? (
          <div className="mt-8 flex flex-wrap gap-2">
            {(["sunSign", "moonSign", "risingSign"] as const).map((k) => {
              const labels = {
                sunSign: "Sun",
                moonSign: "Moon",
                risingSign: "Rising",
              };
              const v = westernMeta[k];
              return (
                <span
                  key={k}
                  className="rounded-full border border-cyan-300/35 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-100"
                >
                  {labels[k]} — {v}
                </span>
              );
            })}
          </div>
        ) : null}

        {error ? (
          <p className="mt-6 rounded-2xl border border-rose-500/40 bg-rose-950/35 px-4 py-3 text-sm text-rose-100">
            {error}
          </p>
        ) : null}

        <section className="mt-12 space-y-6">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.26em] text-white/55">
            Five readers speak
          </h2>
          <div className="grid gap-4">
            {readerOrder.map((slot) => {
              const r = readersOut.get(slot);
              return (
                <article
                  key={slot}
                  className="rounded-[18px] border border-solid bg-[#0e1528]/90 p-4 sm:p-5"
                  style={{
                    borderColor: `${AI_BORDER[slot]}55`,
                  }}
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <ReaderBadge slot={slot} />
                    {sending && phase !== "idle" && !r?.text && !r?.error ? (
                      <span className="animate-pulse text-[11px] text-white/40">
                        thinking…
                      </span>
                    ) : r?.text || r?.error ? null : (
                      <span className="text-[11px] text-white/30">waiting</span>
                    )}
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                    {r?.error ? (
                      <span className="text-rose-200/95">{r.error}</span>
                    ) : r?.text ? (
                      r.text
                    ) : (
                      ""
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {props.apiPath === "/api/oracle/fate" &&
          (synthText || (sending && readersOut.size >= 4)) ? (
            <article
              className="rounded-[18px] border border-solid bg-[#0e1528]/90 p-4 sm:p-5"
              style={{ borderColor: `${AI_BORDER.openai}55` }}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <ReaderBadge slot="openai" />
                <span className="text-sm font-semibold text-white/80">Synthesis</span>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                {synthText || (phase === "streaming" ? "Composing weave…" : "")}
              </div>
            </article>
          ) : null}

          {props.apiPath === "/api/oracle/astro" &&
          (synthText || (sending && readersOut.size >= 4)) ? (
            <article
              className="rounded-[18px] border border-solid bg-[#0e1528]/90 p-4 sm:p-5"
              style={{ borderColor: `${AI_BORDER.openai}55` }}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <ReaderBadge slot="openai" />
                <span className="text-sm font-semibold text-white/80">Synthesis</span>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                {synthText || (phase === "streaming" ? "Composing weave…" : "")}
              </div>
            </article>
          ) : null}

          {allReadersDone ? (
            <OracleSessionEndFlow
              key={readingKey}
              oracleType={props.oracleType}
              question={question.trim() || props.title}
              allDone={allReadersDone}
              getResponses={getResponses}
              voteLabels={voteLabels}
            />
          ) : null}
        </section>

        <footer className="fixed bottom-4 left-0 right-0 flex justify-center px-4 pb-safe">
          <span className="pointer-events-none text-center text-[10px] text-white/30">
            Tip: Use Chrome&apos;s built-in translation for your language
          </span>
        </footer>
      </div>
    </main>
  );
}
