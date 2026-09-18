"use client";

import { useMemo, useState } from "react";
import { MBTI_TYPES } from "@/lib/oracle/engines/prism/tables";
import {
  MBTI_ESTIMATOR_QUESTIONS,
  answersComplete,
  estimateMbti,
  type MbtiEstimatorAnswers,
  type MbtiPole,
} from "@/lib/oracle/mbti-estimator";
import { getOracleProfileCopy, type OracleProfileMbtiId } from "@/lib/oracle/i18n";

type Mode = "choose" | "known" | "estimate";

const copy = getOracleProfileCopy("ko").mbti;

export default function MbtiEstimator({
  onResolved,
  busy,
}: {
  onResolved: (type: string, estimated: boolean) => void;
  busy?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("choose");
  const [known, setKnown] = useState("");
  const [answers, setAnswers] = useState<Partial<MbtiEstimatorAnswers>>({});

  const estimated = useMemo(() => {
    if (!answersComplete(answers)) return null;
    return estimateMbti(answers);
  }, [answers]);

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-white/55">{copy.label}</p>
        <p className="mt-1 text-sm text-slate-300">{copy.help}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMode("known")}
          className={`rounded-xl border px-3 py-2 text-sm ${
            mode === "known"
              ? "border-cyan-300/55 bg-cyan-400/10 text-white"
              : "border-white/10 text-slate-300 hover:border-white/25"
          }`}
        >
          {copy.known}
        </button>
        <button
          type="button"
          onClick={() => setMode("estimate")}
          className={`rounded-xl border px-3 py-2 text-sm ${
            mode === "estimate"
              ? "border-cyan-300/55 bg-cyan-400/10 text-white"
              : "border-white/10 text-slate-300 hover:border-white/25"
          }`}
        >
          {copy.unknown}
        </button>
      </div>

      {mode === "known" ? (
        <div className="space-y-3">
          <select
            value={known}
            onChange={(event) => setKnown(event.target.value)}
            className="w-full rounded-2xl border border-white/14 bg-black/35 px-4 py-2.5 text-white focus:border-cyan-300/50 focus:outline-none"
          >
            <option value="">{copy.pickType}</option>
            {MBTI_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!known || busy}
            onClick={() => onResolved(known, false)}
            className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-40"
          >
            {copy.useType}
          </button>
        </div>
      ) : null}

      {mode === "estimate" ? (
        <div className="space-y-5">
          {MBTI_ESTIMATOR_QUESTIONS.map((question) => {
            const questionCopy = copy.questions[question.id as OracleProfileMbtiId];
            const prompt = questionCopy?.prompt ?? question.prompt;
            const labels = questionCopy?.choices ?? [
              question.choices[0].label,
              question.choices[1].label,
            ];
            return (
              <div key={question.id} className="space-y-1.5">
                <p className="text-[13px] text-slate-100">{prompt}</p>
                <div className="grid gap-1.5">
                  {question.choices.map((choice, index) => (
                    <label
                      key={choice.pole + labels[index]}
                      className="flex cursor-pointer items-start gap-2 rounded-xl border border-white/[0.08] px-3 py-1.5 text-[12px] text-slate-200 hover:bg-white/[0.06]"
                    >
                      <input
                        type="radio"
                        name={question.id}
                        checked={answers[question.id] === choice.pole}
                        onChange={() =>
                          setAnswers((prev) => ({ ...prev, [question.id]: choice.pole as MbtiPole }))
                        }
                      />
                      {labels[index]}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          {estimated ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onResolved(estimated, true)}
              className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-40"
            >
              {copy.useEstimate(estimated)}
            </button>
          ) : (
            <p className="text-[12px] text-white/40">{copy.completeHint}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
