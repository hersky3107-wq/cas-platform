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

type Mode = "choose" | "known" | "estimate";

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
        <p className="text-[11px] uppercase tracking-[0.2em] text-white/55">MBTI</p>
        <p className="mt-1 text-sm text-slate-300">
          유형을 알고 있으면 고르고, 모르면 짧은 문항으로 추정합니다. 외부 검사는 필요 없습니다.
        </p>
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
          알고 있어요
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
          모르겠어요
        </button>
      </div>

      {mode === "known" ? (
        <div className="space-y-3">
          <select
            value={known}
            onChange={(event) => setKnown(event.target.value)}
            className="w-full rounded-2xl border border-white/14 bg-black/35 px-4 py-2.5 text-white focus:border-cyan-300/50 focus:outline-none"
          >
            <option value="">유형 선택</option>
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
            이 유형으로 사용
          </button>
        </div>
      ) : null}

      {mode === "estimate" ? (
        <div className="space-y-5">
          {MBTI_ESTIMATOR_QUESTIONS.map((question) => (
            <div key={question.id} className="space-y-1.5">
              <p className="text-[13px] text-slate-100">{question.prompt}</p>
              <div className="grid gap-1.5">
                {question.choices.map((choice) => (
                  <label
                    key={choice.pole + choice.label}
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
                    {choice.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {estimated ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onResolved(estimated, true)}
              className="w-full rounded-xl bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-40"
            >
              추정 결과 {estimated} 사용
            </button>
          ) : (
            <p className="text-[12px] text-white/40">여덟 문항을 모두 답하면 유형이 정해집니다.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
