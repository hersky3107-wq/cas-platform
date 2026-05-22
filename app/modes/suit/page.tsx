"use client";

import Link from "next/link";
import HelpModal from "@/components/HelpModal";
import { suitHelpContent } from "@/lib/help-modal/suit-content";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Gavel } from "lucide-react";
import { supabase } from "@/lib/db/supabase";
import { SUIT_COUNSEL_AI_SELECTOR_CARDS } from "@/lib/ai/suit-prompts";
import type { SuitClientConfig } from "@/lib/ai/suit-types";
import type { AiProviderName } from "@/lib/ai/router";
import { creditsForSuit } from "@/lib/credits";

const STORAGE_KEY = "cas-suit-live";
const SUIT_SESSION_COST = creditsForSuit();

export type SuitStoredSession = {
  sessionId: string;
} & SuitClientConfig;

type WizardStep =
  | "topic"
  | "format"
  | "participation"
  | "ai_select_prosecution"
  | "ai_select_defense"
  | "counsel_opponent"
  | "counsel_role"
  | "review";

export default function SuitSetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("topic");
  const [topic, setTopic] = useState("");
  const [format, setFormat] = useState<"criminal" | "civil" | null>(null);
  const [participation, setParticipation] = useState<"spectator" | "witness" | "counsel" | null>(null);
  const [counselRole, setCounselRole] = useState<
    "prosecutor" | "defense" | "counsel_a" | "counsel_b" | null
  >(null);
  const [sideA, setSideA] = useState<AiProviderName | null>(null);
  const [sideB, setSideB] = useState<AiProviderName | null>(null);
  const [counselOpponent, setCounselOpponent] = useState<AiProviderName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);

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

  const flow = useMemo(() => {
    const needsCounselRole = participation === "counsel";
    return { needsCounselRole };
  }, [format, participation]);

  const goNext = () => {
    setError(null);
    if (step === "topic") {
      if (topic.trim().length < 4) {
        setError("Please state the case in a bit more detail (4+ characters).");
        return;
      }
      setStep("format");
      return;
    }
    if (step === "format") {
      if (!format) {
        setError("Choose Criminal or Civil.");
        return;
      }
      setStep("participation");
      return;
    }
    if (step === "participation") {
      if (!participation) {
        setError("Choose how you will participate.");
        return;
      }
      if (flow.needsCounselRole) {
        setStep("counsel_role");
        return;
      }
      setStep("ai_select_prosecution");
      return;
    }
    if (step === "counsel_role") {
      if (!counselRole) {
        setError("Choose your role in the courtroom.");
        return;
      }
      setStep("counsel_opponent");
      return;
    }
    if (step === "counsel_opponent") {
      if (!counselOpponent) {
        setError("Pick your opposing counsel.");
        return;
      }
      setStep("review");
      return;
    }
    if (step === "ai_select_prosecution") {
      if (!sideA) {
        setError(format === "criminal" ? "Pick your Prosecution AI." : "Pick your Counsel A AI.");
        return;
      }
      setStep("ai_select_defense");
      return;
    }
    if (step === "ai_select_defense") {
      if (!sideB) {
        setError(format === "criminal" ? "Pick your Defense AI." : "Pick your Counsel B AI.");
        return;
      }
      setStep("review");
    }
  };

  const goBack = () => {
    setError(null);
    if (step === "format") {
      setStep("topic");
      return;
    }
    if (step === "participation") {
      setStep("format");
      return;
    }
    if (step === "counsel_role") {
      setStep("participation");
      return;
    }
    if (step === "counsel_opponent") {
      setStep("counsel_role");
      return;
    }
    if (step === "ai_select_prosecution") {
      if (flow.needsCounselRole) {
        setStep("counsel_role");
        return;
      }
      setStep("participation");
      return;
    }
    if (step === "ai_select_defense") {
      setStep("ai_select_prosecution");
      return;
    }
    if (step === "review") {
      if (flow.needsCounselRole) {
        setStep("counsel_opponent");
      } else {
        setStep("ai_select_defense");
      }
    }
  };

  const startSession = async () => {
    setError(null);
    if (!format || !participation) return;
    if (flow.needsCounselRole && !counselRole) {
      setError("Counsel role required.");
      return;
    }
    if (participation === "counsel") {
      if (!counselOpponent) {
        setError("Pick your opposing counsel.");
        return;
      }
    } else {
      if (!sideA || !sideB || sideA === sideB) {
        setError("Pick one AI for each side.");
        return;
      }
    }
    setStarting(true);
    try {
      const body: Record<string, unknown> = {
        action: "start",
        topic: topic.trim(),
        format,
        participationMode: participation,
      };
      if (flow.needsCounselRole && counselRole) {
        body.counselUserRole = counselRole;
      }
      if (participation === "counsel") {
        body.opponentProvider = counselOpponent;
      } else {
        body.sideA = sideA;
        body.sideB = sideB;
      }
      const res = await fetch("/api/suit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const rawText = await res.text().catch(() => "");
      // Debug: see whether /api/suit start succeeded and what it returned.
      console.log("[suit:start] status", res.status, "ok", res.ok);
      console.log("[suit:start] body", rawText);
      const j = (rawText ? JSON.parse(rawText) : null) as {
        error?: string;
        sessionId?: string;
        config?: SuitClientConfig;
      };
      if (!res.ok || !j?.sessionId || !j.config) {
        setError(j?.error ?? "Could not open session.");
        return;
      }
      const packed: SuitStoredSession = {
        sessionId: j.sessionId,
        ...j.config,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(packed));
      router.push("/modes/suit/session");
    } finally {
      setStarting(false);
    }
  };

  const cardCls = (active: boolean) =>
    `flex w-full flex-col rounded-2xl border px-5 py-4 text-left transition ${
      active
        ? "border-amber-400/55 bg-[#131c35] shadow-[0_0_28px_rgba(245,158,11,0.12)]"
        : "border-white/12 bg-[#131c35]/80 hover:border-white/20"
    }`;

  return (
    <main className="min-h-screen bg-[#0a0f1e] pb-24 text-white">
      <HelpModal content={suitHelpContent} />
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0a0f1e]/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-xl border border-white/12 px-3 py-2 text-sm text-white/80 hover:bg-white/5"
          >
            <ChevronLeft className="h-4 w-4" />
            Lobby
          </Link>
          <div className="flex flex-1 items-center justify-center gap-2">
            <Gavel className="h-5 w-5 text-amber-400" />
            <span className="text-sm font-semibold tracking-[0.2em] text-white/90">SUIT</span>
          </div>
          {credits !== null ? (
            <span className="rounded-full bg-[#131c35] px-3 py-1.5 text-xs text-slate-200">
              {credits} credits
            </span>
          ) : (
            <span className="rounded-full bg-[#131c35] px-3 py-1.5 text-xs text-slate-400">
              Credits —
            </span>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-8 px-4 py-10">
        <p className="text-center text-sm text-amber-200/85">
          <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-1 text-xs font-medium tracking-wide text-amber-100">
            {SUIT_SESSION_COST} credits per session
          </span>
        </p>
        <p className="-mt-4 text-center text-xs text-white/45">
          This session uses {SUIT_SESSION_COST} credits when the trial begins.
        </p>

        {error ? (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {step === "topic" ? (
          <section className="space-y-4">
            <p className="text-center text-[11px] font-medium uppercase tracking-[0.28em] text-amber-300/75">
              Step 1 — The docket
            </p>
            <h1 className="text-center text-2xl font-semibold">State the case.</h1>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={5}
              placeholder="Describe the dispute, charges, or civil question the court must resolve."
              className="w-full rounded-2xl border border-white/12 bg-[#131c35] px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-amber-400/50"
            />
          </section>
        ) : null}

        {step === "format" ? (
          <section className="space-y-4">
            <p className="text-center text-[11px] font-medium uppercase tracking-[0.28em] text-amber-300/75">
              Step 2 — Format
            </p>
            <h1 className="text-center text-2xl font-semibold">Choose the trial format.</h1>
            <div className="grid gap-4 sm:grid-cols-2">
              <button type="button" className={cardCls(format === "criminal")} onClick={() => setFormat("criminal")}>
                <span className="text-xl">⚔️ CRIMINAL</span>
                <span className="mt-2 text-sm text-white/70">Prosecutor vs Defense</span>
                <p className="mt-3 text-xs leading-relaxed text-white/55">
                  One side attacks. One side defends. The verdict is guilty or not guilty.
                </p>
              </button>
              <button type="button" className={cardCls(format === "civil")} onClick={() => setFormat("civil")}>
                <span className="text-xl">⚖️ CIVIL</span>
                <span className="mt-2 text-sm text-white/70">Counsel A vs Counsel B</span>
                <p className="mt-3 text-xs leading-relaxed text-white/55">
                  Both sides represent a client. The verdict decides who prevails.
                </p>
              </button>
            </div>
          </section>
        ) : null}

        {step === "participation" ? (
          <section className="space-y-4">
            <p className="text-center text-[11px] font-medium uppercase tracking-[0.28em] text-amber-300/75">
              Step 3 — Participation
            </p>
            <h1 className="text-center text-2xl font-semibold">How will you enter the courtroom?</h1>
            <div className="grid gap-4">
              <button
                type="button"
                className={cardCls(participation === "spectator")}
                onClick={() => setParticipation("spectator")}
              >
                <span className="text-lg">👁️ SPECTATOR</span>
                <p className="mt-2 text-sm text-white/65">Watch the trial. Vote at the end.</p>
              </button>
              <button
                type="button"
                className={cardCls(participation === "witness")}
                onClick={() => setParticipation("witness")}
              >
                <span className="text-lg">🎙️ WITNESS</span>
                <p className="mt-2 text-sm text-white/65">Take the stand mid-trial. Your testimony changes everything.</p>
              </button>
              <button
                type="button"
                className={cardCls(participation === "counsel")}
                onClick={() => setParticipation("counsel")}
              >
                <span className="text-lg">⚔️ COUNSEL</span>
                <p className="mt-2 text-sm text-white/65">
                  You argue the case — pick an AI bench counsel; a different model opposes you. Opus 4.7 judges.
                </p>
              </button>
            </div>
          </section>
        ) : null}

        {step === "counsel_role" ? (
          <section className="space-y-4">
            <p className="text-center text-[11px] font-medium uppercase tracking-[0.28em] text-amber-300/75">
              Step 5 — Your role
            </p>
            <h1 className="text-center text-2xl font-semibold">Where do you sit?</h1>
            <div className="grid gap-4 sm:grid-cols-2">
              {format === "criminal" ? (
                <>
                  <button
                    type="button"
                    className={cardCls(counselRole === "prosecutor")}
                    onClick={() => setCounselRole("prosecutor")}
                  >
                    <span className="text-lg">You are the Prosecutor</span>
                  </button>
                  <button
                    type="button"
                    className={cardCls(counselRole === "defense")}
                    onClick={() => setCounselRole("defense")}
                  >
                    <span className="text-lg">You are the Defense</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={cardCls(counselRole === "counsel_a")}
                    onClick={() => setCounselRole("counsel_a")}
                  >
                    <span className="text-lg">You represent Side A</span>
                  </button>
                  <button
                    type="button"
                    className={cardCls(counselRole === "counsel_b")}
                    onClick={() => setCounselRole("counsel_b")}
                  >
                    <span className="text-lg">You represent Side B</span>
                  </button>
                </>
              )}
            </div>
          </section>
        ) : null}

        {step === "ai_select_prosecution" ? (
          <section className="space-y-5">
            <p className="text-center text-[11px] font-medium uppercase tracking-[0.28em] text-amber-300/75">
              Step 1 — AI selection
            </p>
            <h1 className="text-center text-2xl font-semibold">
              {format === "criminal" ? "Pick your Prosecution AI" : "Pick your Counsel A AI"}
            </h1>
            <p className="text-center text-xs text-white/55">
              Choose exactly 1 AI for Side A. Judge is fixed (Claude Opus 4.7).
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {SUIT_COUNSEL_AI_SELECTOR_CARDS.map((card) => {
                const active = sideA === card.provider;
                const dim = sideA !== null && !active;
                return (
                  <button
                    key={card.provider}
                    type="button"
                    onClick={() => {
                      setSideA(card.provider);
                      if (sideB === card.provider) setSideB(null);
                    }}
                    className={`${cardCls(active)} ${dim ? "opacity-60" : ""}`}
                  >
                    <span className="text-[15px] font-semibold text-white">
                      {card.nameEn} — {card.epithetKo}
                    </span>
                    <span className="mt-2 block text-[13px] text-amber-200/90">&ldquo;{card.taglineKo}&rdquo;</span>
                    <p className="mt-2 text-left text-xs leading-relaxed text-white/58">{card.blurbKo}</p>
                    {active ? (
                      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-emerald-200/90">
                        Selected
                      </p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {step === "ai_select_defense" ? (
          <section className="space-y-5">
            <p className="text-center text-[11px] font-medium uppercase tracking-[0.28em] text-amber-300/75">
              Step 2 — AI selection
            </p>
            <h1 className="text-center text-2xl font-semibold">
              {format === "criminal" ? "Pick your Defense AI" : "Pick your Counsel B AI"}
            </h1>
            <p className="text-center text-xs text-white/55">Choose 1 AI from the remaining 5.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {SUIT_COUNSEL_AI_SELECTOR_CARDS.map((card) => {
                const disabled = sideA === card.provider;
                const active = sideB === card.provider;
                const dim = (sideB !== null && !active) || disabled;
                return (
                  <button
                    key={card.provider}
                    type="button"
                    disabled={disabled}
                    onClick={() => setSideB(card.provider)}
                    className={`${cardCls(active)} ${dim ? "opacity-60" : ""}`}
                  >
                    <span className="text-[15px] font-semibold text-white">
                      {card.nameEn} — {card.epithetKo}
                    </span>
                    <span className="mt-2 block text-[13px] text-amber-200/90">&ldquo;{card.taglineKo}&rdquo;</span>
                    <p className="mt-2 text-left text-xs leading-relaxed text-white/58">{card.blurbKo}</p>
                    {disabled ? (
                      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-white/45">
                        Already selected for Side A
                      </p>
                    ) : active ? (
                      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-emerald-200/90">
                        Selected
                      </p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {step === "counsel_opponent" ? (
          <section className="space-y-5">
            <p className="text-center text-[11px] font-medium uppercase tracking-[0.28em] text-amber-300/75">
              Opposing counsel
            </p>
            <h1 className="text-center text-2xl font-semibold">Pick your opposing counsel</h1>
            <p className="text-center text-xs text-white/55">
              Choose exactly 1 AI to oppose you. Judge is fixed (Claude Opus 4.7).
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {SUIT_COUNSEL_AI_SELECTOR_CARDS.map((card) => {
                const active = counselOpponent === card.provider;
                const dim = counselOpponent !== null && !active;
                return (
                  <button
                    key={card.provider}
                    type="button"
                    onClick={() => setCounselOpponent(card.provider)}
                    className={`${cardCls(active)} ${dim ? "opacity-60" : ""}`}
                  >
                    <span className="text-[15px] font-semibold text-white">
                      {card.nameEn} — {card.epithetKo}
                    </span>
                    <span className="mt-2 block text-[13px] text-amber-200/90">&ldquo;{card.taglineKo}&rdquo;</span>
                    <p className="mt-2 text-left text-xs leading-relaxed text-white/58">{card.blurbKo}</p>
                    {active ? (
                      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-emerald-200/90">
                        Selected
                      </p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {step === "review" ? (
          <section className="space-y-6 rounded-2xl border border-white/12 bg-[#131c35] p-6">
            <h2 className="text-center text-lg font-semibold">Call the court</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4 border-b border-white/10 pb-2">
                <dt className="text-white/50">Topic</dt>
                <dd className="max-w-[60%] text-right text-white/90">{topic.trim().slice(0, 280)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-white/10 pb-2">
                <dt className="text-white/50">Format</dt>
                <dd className="text-amber-200">{format?.toUpperCase()}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-white/10 pb-2">
                <dt className="text-white/50">Mode</dt>
                <dd className="capitalize text-white/90">{participation}</dd>
              </div>
              {counselRole ? (
                <div className="flex justify-between gap-4 border-b border-white/10 pb-2">
                  <dt className="text-white/50">Counsel role</dt>
                  <dd className="text-white/90">{counselRole.replace("_", " ")}</dd>
                </div>
              ) : null}
              {sideA && sideB ? (
                <div className="flex flex-col gap-1 border-b border-white/10 pb-2">
                  <div className="flex justify-between gap-4">
                    <dt className="text-white/50 shrink-0">
                      {format === "criminal" ? "Prosecution / Defense" : "Counsel A / Counsel B"}
                    </dt>
                    <dd className="text-right text-sm text-white/90">
                      {(() => {
                        const a = SUIT_COUNSEL_AI_SELECTOR_CARDS.find((x) => x.provider === sideA);
                        const b = SUIT_COUNSEL_AI_SELECTOR_CARDS.find((x) => x.provider === sideB);
                        const aLabel = a ? `${a.nameEn} — ${a.epithetKo}` : sideA;
                        const bLabel = b ? `${b.nameEn} — ${b.epithetKo}` : sideB;
                        return `${aLabel} / ${bLabel}`;
                      })()}
                    </dd>
                  </div>
                </div>
              ) : null}
              {participation === "counsel" && counselOpponent ? (
                <div className="flex justify-between gap-4 border-b border-white/10 pb-2">
                  <dt className="text-white/50">Opposing counsel</dt>
                  <dd className="text-right text-sm text-white/90">
                    {(() => {
                      const c = SUIT_COUNSEL_AI_SELECTOR_CARDS.find((x) => x.provider === counselOpponent);
                      return c ? `${c.nameEn} — ${c.epithetKo}` : counselOpponent;
                    })()}
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className="text-center text-xs text-amber-200/75">
              This session uses {SUIT_SESSION_COST} credits.
            </p>
            <button
              type="button"
              disabled={
                starting ||
                (credits !== null && credits < SUIT_SESSION_COST)
              }
              onClick={() => void startSession()}
              className="w-full rounded-2xl bg-gradient-to-r from-amber-500 to-amber-700 py-3.5 text-sm font-semibold text-[#0a0f1e] shadow-lg disabled:opacity-50"
            >
              {starting ? "Seating the jury…" : `Enter the courtroom (${SUIT_SESSION_COST} credits)`}
            </button>
            {credits !== null && credits < SUIT_SESSION_COST ? (
              <p className="text-center text-xs text-amber-200/85">
                You need at least {SUIT_SESSION_COST} credits to begin this trial.
              </p>
            ) : null}
          </section>
        ) : null}

        {step !== "review" ? (
          <div className="flex gap-3">
            {(step !== "topic") ? (
              <button
                type="button"
                onClick={goBack}
                className="flex-1 rounded-2xl border border-white/15 py-3 text-sm font-medium text-white/85 hover:bg-white/5"
              >
                Back
              </button>
            ) : null}
            <button
              type="button"
              onClick={goNext}
              className="flex-1 rounded-2xl border border-amber-400/40 bg-amber-500/15 py-3 text-sm font-semibold text-amber-100 hover:bg-amber-500/25"
            >
              Continue
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={goBack}
            className="w-full rounded-2xl border border-white/15 py-3 text-sm font-medium text-white/85 hover:bg-white/5"
          >
            Edit selections
          </button>
        )}
      </div>
    </main>
  );
}
