"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Gavel } from "lucide-react";
import { supabase } from "@/lib/db/supabase";
import { SUIT_COUNSEL_AI_SELECTOR_CARDS } from "@/lib/ai/suit-prompts";
import type { SuitClientConfig } from "@/lib/ai/suit-types";
import type { AiProviderName } from "@/lib/ai/router";

const STORAGE_KEY = "cas-suit-live";

export type SuitStoredSession = {
  sessionId: string;
} & SuitClientConfig;

type WizardStep =
  | "topic"
  | "format"
  | "participation"
  | "criminal_side"
  | "counsel_role"
  | "counsel_ai"
  | "review";

export default function SuitSetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>("topic");
  const [topic, setTopic] = useState("");
  const [format, setFormat] = useState<"criminal" | "civil" | null>(null);
  const [participation, setParticipation] = useState<"spectator" | "witness" | "counsel" | null>(null);
  const [criminalSide, setCriminalSide] = useState<"prosecution" | "defense" | null>(null);
  const [counselRole, setCounselRole] = useState<
    "prosecutor" | "defense" | "counsel_a" | "counsel_b" | null
  >(null);
  const [counselAiProvider, setCounselAiProvider] = useState<AiProviderName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const flow = useMemo(() => {
    const needsCriminalSide =
      format === "criminal" && participation !== null && participation !== "counsel";
    const needsCounselRole = participation === "counsel";
    return { needsCriminalSide, needsCounselRole };
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
      if (flow.needsCriminalSide) {
        setStep("criminal_side");
        return;
      }
      if (flow.needsCounselRole) {
        setStep("counsel_role");
        return;
      }
      setStep("review");
      return;
    }
    if (step === "criminal_side") {
      if (!criminalSide) {
        setError("Choose which side you support for the gallery vote.");
        return;
      }
      if (flow.needsCounselRole) {
        setStep("counsel_role");
        return;
      }
      setStep("review");
      return;
    }
    if (step === "counsel_role") {
      if (!counselRole) {
        setError("Choose your role in the courtroom.");
        return;
      }
      setStep("counsel_ai");
      return;
    }
    if (step === "counsel_ai") {
      if (!counselAiProvider) {
        setError("당신의 AI 변호인을 선택하세요. / Pick your AI counsel.");
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
    if (step === "criminal_side") {
      setStep("participation");
      return;
    }
    if (step === "counsel_role") {
      if (flow.needsCriminalSide) {
        setStep("criminal_side");
        return;
      }
      setStep("participation");
      return;
    }
    if (step === "review") {
      if (flow.needsCounselRole) {
        setStep("counsel_ai");
        return;
      }
      if (flow.needsCriminalSide) {
        setStep("criminal_side");
        return;
      }
      setStep("participation");
    }
    if (step === "counsel_ai") {
      setStep("counsel_role");
    }
  };

  const startSession = async () => {
    setError(null);
    if (!format || !participation) return;
    if (flow.needsCriminalSide && !criminalSide) {
      setError("Side selection required.");
      return;
    }
    if (flow.needsCounselRole && !counselRole) {
      setError("Counsel role required.");
      return;
    }
    if (flow.needsCounselRole && !counselAiProvider) {
      setError("AI counsel selection required.");
      return;
    }
    setStarting(true);
    try {
      const body: Record<string, unknown> = {
        action: "start",
        topic: topic.trim(),
        format,
        participationMode: participation,
      };
      if (flow.needsCriminalSide && criminalSide) {
        body.userPreferredSide = criminalSide;
      }
      if (flow.needsCounselRole && counselRole) {
        body.counselUserRole = counselRole;
      }
      if (flow.needsCounselRole && counselAiProvider) {
        body.counselAiProvider = counselAiProvider;
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
          <span className="w-[88px]" />
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-8 px-4 py-10">
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

        {step === "criminal_side" ? (
          <section className="space-y-4">
            <p className="text-center text-[11px] font-medium uppercase tracking-[0.28em] text-amber-300/75">
              Step 4 — Gallery
            </p>
            <h1 className="text-center text-2xl font-semibold">Which side do you support entering the courtroom?</h1>
            <p className="text-center text-xs text-white/50">Affects your final vote UI only — not AI roles.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                className={cardCls(criminalSide === "prosecution")}
                onClick={() => setCriminalSide("prosecution")}
              >
                <span className="text-lg text-red-400">Prosecution</span>
                <p className="mt-2 text-sm text-white/60">You enter with the state&apos;s table.</p>
              </button>
              <button
                type="button"
                className={cardCls(criminalSide === "defense")}
                onClick={() => setCriminalSide("defense")}
              >
                <span className="text-lg text-blue-400">Defense</span>
                <p className="mt-2 text-sm text-white/60">You enter with the defense table.</p>
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

        {step === "counsel_ai" ? (
          <section className="space-y-5">
            <p className="text-center text-[11px] font-medium uppercase tracking-[0.28em] text-amber-300/75">
              변호인 지정 · AI Counsel
            </p>
            <h1 className="text-center text-2xl font-semibold">
              선택한 변호 모델
            </h1>
            <p className="text-center text-xs text-white/55">
              판사(Claude Opus 4.7)와 상대변호는 선택할 수 없습니다. 상대는 나머지 다섯 모델 중 무작위 배정됩니다.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {SUIT_COUNSEL_AI_SELECTOR_CARDS.map((card) => (
                <button
                  key={card.provider}
                  type="button"
                  onClick={() => setCounselAiProvider(card.provider)}
                  className={cardCls(counselAiProvider === card.provider)}
                >
                  <span className="text-[15px] font-semibold text-white">
                    {card.nameEn} — {card.epithetKo}
                  </span>
                  <span className="mt-2 block text-[13px] text-amber-200/90">&ldquo;{card.taglineKo}&rdquo;</span>
                  <p className="mt-2 text-left text-xs leading-relaxed text-white/58">{card.blurbKo}</p>
                </button>
              ))}
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
              {criminalSide ? (
                <div className="flex justify-between gap-4 border-b border-white/10 pb-2">
                  <dt className="text-white/50">Gallery side</dt>
                  <dd className="capitalize text-white/90">{criminalSide}</dd>
                </div>
              ) : null}
              {counselRole ? (
                <div className="flex justify-between gap-4 border-b border-white/10 pb-2">
                  <dt className="text-white/50">Counsel role</dt>
                  <dd className="text-white/90">{counselRole.replace("_", " ")}</dd>
                </div>
              ) : null}
              {counselAiProvider ? (
                <div className="flex flex-col gap-1 border-b border-white/10 pb-2">
                  <div className="flex justify-between gap-4">
                    <dt className="text-white/50 shrink-0">Your AI counsel</dt>
                    <dd className="text-right text-sm text-white/90">
                      {(() => {
                        const c = SUIT_COUNSEL_AI_SELECTOR_CARDS.find((x) => x.provider === counselAiProvider);
                        return c ? `${c.nameEn} — ${c.epithetKo}` : counselAiProvider;
                      })()}
                    </dd>
                  </div>
                  <dd className="text-right text-xs text-white/50">
                    {SUIT_COUNSEL_AI_SELECTOR_CARDS.find((x) => x.provider === counselAiProvider)?.blurbKo}
                  </dd>
                </div>
              ) : null}
            </dl>
            <button
              type="button"
              disabled={starting}
              onClick={() => void startSession()}
              className="w-full rounded-2xl bg-gradient-to-r from-amber-500 to-amber-700 py-3.5 text-sm font-semibold text-[#0a0f1e] shadow-lg disabled:opacity-50"
            >
              {starting ? "Seating the jury…" : "Enter the courtroom"}
            </button>
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
