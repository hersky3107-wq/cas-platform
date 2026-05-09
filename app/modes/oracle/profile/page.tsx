"use client";

import Link from "next/link";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { ApproxBirthBand, Gender, OracleBirthProfileV1 } from "@/lib/oracle/types";
import {
  SURVEY_QUESTIONS,
  type SurveyAnswersExpected,
} from "@/lib/oracle/survey-data";
import { approxBandToMidpointHHMM } from "@/lib/oracle/sijin";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

const MONTH_NAMES = [
  "Month",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(year: number, monthIndex1based: number): number {
  if (monthIndex1based === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(monthIndex1based)) return 30;
  return 31;
}

function composeIsoDate(
  monthIdx: number,
  day: number,
  year: number,
): string | null {
  if (
    monthIdx < 1 ||
    monthIdx > 12 ||
    year < 1 ||
    day < 1 ||
    day > daysInMonth(year, monthIdx)
  ) {
    return null;
  }
  const mm = String(monthIdx).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const yyyy = String(year).padStart(4, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function splitIsoToParts(iso: string): {
  monthIdx: number;
  day: number;
  year: number;
} | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]);
  const day = Number(m[3]);
  if (!composeIsoDate(monthIdx, day, year)) return null;
  return { monthIdx, day, year };
}

function answersComplete(
  answers: Partial<SurveyAnswersExpected>,
): answers is SurveyAnswersExpected {
  return SURVEY_QUESTIONS.every(
    (q) => typeof answers[q.id] === "number",
  );
}

/** Legacy stored approximate bands (handled without re-running survey). */
type ApproxPersist = ApproxBirthBand;

export default function OracleProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const yearNow = new Date().getFullYear();
  const yearOptions = useMemo(() => {
    const out: number[] = [];
    for (let y = yearNow; y >= 1920; y--) out.push(y);
    return out;
  }, [yearNow]);

  const [dobMonth, setDobMonth] = useState(0);
  const [dobDay, setDobDay] = useState(0);
  const [dobYear, setDobYear] = useState(0);
  const [dobError, setDobError] = useState<string | null>(null);

  const [birthCity, setBirthCity] = useState("");
  const [gender, setGender] = useState<Gender>("prefer_not_to_say");

  const [timeKnowledge, setTimeKnowledge] = useState<"exact" | "unknown">(
    "exact",
  );
  const [birth_time_24h, setBirthTime24h] = useState("12:30");

  /** Legacy hydrate: approximate band-only save — no questionnaire. */
  const [approxBandPersist, setApproxBandPersist] = useState<ApproxPersist | null>(
    null,
  );

  const [surveyAnswers, setSurveyAnswers] = useState<
    Partial<SurveyAnswersExpected>
  >({});
  const [inferredTime, setInferredTime] = useState<string | null>(null);
  const [inferredSijin, setInferredSijin] = useState<string | null>(null);
  const [inferBusy, setInferBusy] = useState(false);
  const surveyAutoInferRef = useRef(false);

  const surveyReady = useMemo(
    () => answersComplete(surveyAnswers),
    [surveyAnswers],
  );

  const maxDay =
    dobMonth >= 1 && dobYear >= 1900
      ? daysInMonth(dobYear, dobMonth)
      : 31;
  useEffect(() => {
    if (dobDay > maxDay && maxDay >= 1) setDobDay(maxDay);
  }, [maxDay, dobDay]);

  useEffect(() => {
    if (
      timeKnowledge !== "unknown" ||
      approxBandPersist !== null ||
      !surveyReady ||
      surveyAutoInferRef.current
    )
      return;
    surveyAutoInferRef.current = true;
    let cancelled = false;

    (async () => {
      setInferBusy(true);
      setErr(null);
      try {
        const res = await fetch("/api/oracle/infer-time", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: surveyAnswers }),
        });
        const j = (await res.json().catch(() => null)) as {
          midpoint_24h?: string;
          sijin_kr?: string;
        };
        if (!res.ok) {
          if (!cancelled) {
            setErr(
              typeof (j as { error?: string }).error === "string"
                ? (j as { error?: string }).error!
                : "Could not infer birth time.",
            );
            surveyAutoInferRef.current = false;
          }
          return;
        }
        if (!cancelled) {
          const hh = typeof j.midpoint_24h === "string" ? j.midpoint_24h : null;
          const sj =
            typeof j.sijin_kr === "string" ? j.sijin_kr.trim() || null : null;
          setInferredTime(hh ?? null);
          setInferredSijin(sj ?? null);
          if (hh) setBirthTime24h(hh);
          setMessage("Birth time estimated — saved automatically ✓");
        }
      } catch {
        if (!cancelled) {
          setErr("Infer request failed.");
          surveyAutoInferRef.current = false;
        }
      } finally {
        if (!cancelled) setInferBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [timeKnowledge, approxBandPersist, surveyAnswers, surveyReady]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/oracle/profile").catch(() => null);
      if (!res?.ok) {
        if (!cancelled) setLoading(false);
        return;
      }
      const j = (await res.json().catch(() => null)) as {
        profile?: OracleBirthProfileV1 | null;
      };
      if (cancelled) return;
      const p = j.profile;
      if (p?.version === 1) {
        if (p.dob) {
          const parts = splitIsoToParts(p.dob);
          if (parts) {
            setDobMonth(parts.monthIdx);
            setDobDay(parts.day);
            setDobYear(parts.year);
          }
        }
        setBirthCity(p.birth_city ?? "");
        setGender(p.gender ?? "prefer_not_to_say");
        if (p.birth_time_known) {
          setTimeKnowledge("exact");
          setApproxBandPersist(null);
          if (p.birth_time_24h) setBirthTime24h(p.birth_time_24h);
        } else if (p.time_approx_band && !p.time_from_survey) {
          setTimeKnowledge("unknown");
          setApproxBandPersist(p.time_approx_band);
          setBirthTime24h(approxBandToMidpointHHMM(p.time_approx_band));
          surveyAutoInferRef.current = true;
        } else if (p.time_from_survey && p.birth_time_24h) {
          setTimeKnowledge("unknown");
          setApproxBandPersist(null);
          if (p.survey_selections)
            setSurveyAnswers(
              p.survey_selections as Partial<SurveyAnswersExpected>,
            );
          setInferredTime(p.birth_time_24h);
          setBirthTime24h(p.birth_time_24h);
          const sk = p.resolved_sijin_kr ?? null;
          setInferredSijin(sk);
          surveyAutoInferRef.current = true;
          setMessage("Birth time estimated — saved automatically ✓");
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    const isoDob =
      dobMonth >= 1 && dobDay >= 1 && dobYear >= 1
        ? composeIsoDate(dobMonth, dobDay, dobYear)
        : null;

    if (!isoDob) {
      setDobError("Please enter a valid date of birth");
      return;
    }
    setDobError(null);

    console.log("[oracle profile] saving dob (YYYY-MM-DD):", isoDob);

    setSaving(true);
    setMessage(null);

    const body: Record<string, unknown> = {
      dob: isoDob,
      birth_city: birthCity.trim(),
      gender,
      birth_time_known: timeKnowledge === "exact",
    };

    if (timeKnowledge === "exact") {
      body.birth_time_24h = birth_time_24h.trim();
    } else if (approxBandPersist) {
      body.time_approx_band = approxBandPersist;
    } else if (inferredTime) {
      body.birth_time_24h = inferredTime.trim();
      body.time_from_survey = true;
      if (inferredSijin) body.resolved_sijin_kr = inferredSijin;
      body.survey_selections = surveyAnswers;
    }

    try {
      const res = await fetch("/api/oracle/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        hint?: string;
      };
      if (!res.ok) {
        const parts = [
          typeof j?.error === "string" ? j.error : null,
          typeof j?.hint === "string" ? j.hint : null,
        ].filter(Boolean);
        setErr(parts.join(" "));
        setSaving(false);
        return;
      }
      setSaving(false);
      router.push("/modes/oracle");
    } catch {
      setErr("Save failed.");
      setSaving(false);
    }
  }

  const unknownBlocked =
    timeKnowledge === "unknown" &&
    (approxBandPersist
      ? false
      : inferBusy || !surveyReady || !inferredTime);

  return (
    <main className={BG} lang="en">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 pb-32 pt-8 sm:px-8">
        <Link
          href="/modes/oracle"
          className="inline-flex items-center gap-1 text-sm text-cyan-200/90 hover:text-cyan-100"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden /> Oracle lobby
        </Link>

        <h1 className="mt-8 text-3xl font-semibold tracking-tight sm:text-4xl">
          Birth sketch
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          Local date · birthplace · exact time or 15‑question estimate (Q1
          anchors your rhythm of day).
        </p>
        <p className="mt-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] text-slate-300/92">
          Tip: Use Chrome&apos;s built-in translation for your language if you prefer.
        </p>

        {loading ? (
          <p className="mt-12 text-center text-sm text-white/55">Loading…</p>
        ) : (
          <form className="mt-10 space-y-8 text-sm" onSubmit={submit}>
            <fieldset className="space-y-3" lang="en">
              <label className="text-[11px] uppercase tracking-[0.2em] text-white/52">
                Date of birth (local)
              </label>
              <p className="text-[11px] text-white/42">
                MM / DD / YYYY
              </p>
              <div className="grid grid-cols-3 gap-3">
                <select
                  value={dobMonth}
                  aria-label="Birth month"
                  onChange={(e) => {
                    setDobMonth(Number(e.target.value));
                    setDobError(null);
                  }}
                  className="rounded-2xl border border-white/[0.14] bg-black/35 px-3 py-2.5 text-white focus:border-cyan-300/50 focus:outline-none"
                >
                  {MONTH_NAMES.map((label, ix) => (
                    <option key={label} value={ix}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={dobDay}
                  aria-label="Birth day"
                  onChange={(e) => {
                    setDobDay(Number(e.target.value));
                    setDobError(null);
                  }}
                  className="rounded-2xl border border-white/[0.14] bg-black/35 px-3 py-2.5 text-white focus:border-cyan-300/50 focus:outline-none"
                >
                  <option value={0}>Day</option>
                  {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <select
                  value={dobYear}
                  aria-label="Birth year"
                  onChange={(e) => {
                    setDobYear(Number(e.target.value));
                    setDobError(null);
                  }}
                  className="rounded-2xl border border-white/[0.14] bg-black/35 px-3 py-2.5 text-white focus:border-cyan-300/50 focus:outline-none"
                >
                  <option value={0}>Year</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              {dobError ? (
                <p className="text-sm text-rose-300">{dobError}</p>
              ) : null}
            </fieldset>

            <fieldset className="space-y-2">
              <label className="text-[11px] uppercase tracking-[0.2em] text-white/52">
                City / region at birth (text)
              </label>
              <input
                required
                placeholder="e.g. Seoul, South Korea / Tokyo, Japan / Paris, France"
                type="text"
                value={birthCity}
                onChange={(e) => setBirthCity(e.target.value)}
                className="w-full rounded-2xl border border-white/[0.14] bg-black/35 px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
              />
              <p className="text-[11px] text-white/42">Include country name for best results</p>
            </fieldset>

            <fieldset className="space-y-2">
              <label className="text-[11px] uppercase tracking-[0.2em] text-white/52">
                Gender presentation
              </label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as Gender)}
                className="w-full rounded-2xl border border-white/[0.14] bg-black/35 px-4 py-2.5 text-white focus:border-cyan-300/50 focus:outline-none"
              >
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="prefer_not_to_say">
                  Prefer not to say
                </option>
              </select>
            </fieldset>

            <fieldset className="space-y-4 rounded-3xl border border-white/[0.1] bg-white/[0.03] p-5">
              <legend className="px-2 text-[12px] font-semibold uppercase tracking-[0.15em] text-white/72">
                Local birth time
              </legend>

              <label className="flex cursor-pointer items-center gap-3 text-[14px] text-slate-200">
                <input
                  type="radio"
                  name="timeKnowledge"
                  checked={timeKnowledge === "exact"}
                  className="accent-cyan-400"
                  onChange={() => {
                    setTimeKnowledge("exact");
                    setApproxBandPersist(null);
                    setMessage(null);
                    setErr(null);
                  }}
                />
                I know the exact time
              </label>

              {timeKnowledge === "exact" ? (
                <input
                  required
                  type="time"
                  step={60}
                  lang="en"
                  value={birth_time_24h}
                  onChange={(e) => setBirthTime24h(e.target.value)}
                  className="w-full rounded-2xl border border-white/[0.14] bg-black/35 px-4 py-2.5 font-mono text-white focus:border-cyan-300/50 focus:outline-none"
                />
              ) : null}

              <label className="flex cursor-pointer items-center gap-3 text-[14px] text-slate-200">
                <input
                  type="radio"
                  name="timeKnowledge"
                  checked={timeKnowledge === "unknown"}
                  className="accent-cyan-400"
                  onChange={() => {
                    setTimeKnowledge("unknown");
                    setApproxBandPersist(null);
                    setSurveyAnswers({});
                    surveyAutoInferRef.current = false;
                    setInferredTime(null);
                    setInferredSijin(null);
                    setMessage(null);
                    setErr(null);
                  }}
                />
                I don&apos;t know my exact time
              </label>

              {timeKnowledge === "unknown" ? (
                <div className="space-y-4 pt-2">
                  {approxBandPersist ? (
                    <p className="rounded-xl border border-amber-300/35 bg-amber-950/20 px-3 py-2 text-[13px] text-amber-100">
                      Approximate clock window on file (
                      <span className="font-mono">
                        midpoint {birth_time_24h}
                      </span>
                      ). Answer the questionnaire instead to refine with the new
                      flow, or Save to keep this window.
                    </p>
                  ) : (
                    <>
                      <p className="text-[12px] leading-relaxed text-slate-400">
                        Answer every question —
                        Q1 maps your energetic time-of-day. When all fifteen are
                        filled, birth time estimates automatically — no extra
                        button.
                      </p>
                      {inferBusy && !inferredTime ? (
                        <p className="text-[12px] text-slate-400">
                          Estimating birth time from your answers…
                        </p>
                      ) : null}
                      {message && inferredTime ? (
                        <p className="rounded-xl border border-emerald-400/35 bg-emerald-950/20 px-3 py-2 text-[13px] text-emerald-100">
                          {message}
                        </p>
                      ) : null}
                      {!inferredTime && !inferBusy ? (
                        <p className="text-[12px] text-slate-500">
                          Complete all fifteen to auto-estimate.
                        </p>
                      ) : null}
                      {SURVEY_QUESTIONS.map((row) => (
                        <div key={row.id} className="space-y-1.5">
                          <div className="text-[13px] text-slate-100">
                            {row.text}
                          </div>
                          <div className="grid gap-1.5">
                            {row.choices.map((c, ix) => (
                              <label
                                key={c}
                                className="flex cursor-pointer items-start gap-2 rounded-xl border border-white/[0.08] px-3 py-1.5 text-[12px] text-slate-200 hover:bg-white/[0.06]"
                              >
                                <input
                                  type="radio"
                                  name={row.id}
                                  checked={
                                    surveyAnswers[
                                      row.id as keyof SurveyAnswersExpected
                                    ] === ix
                                  }
                                  onChange={() => {
                                    surveyAutoInferRef.current = false;
                                    setInferredTime(null);
                                    setInferredSijin(null);
                                    setMessage(null);
                                    setSurveyAnswers((prev) => ({
                                      ...prev,
                                      [row.id]: ix,
                                    }));
                                  }}
                                />
                                {c}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ) : null}
            </fieldset>

            {err ? (
              <p className="rounded-2xl border border-rose-500/38 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
                {err}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={saving || unknownBlocked}
              className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/35 hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-42"
            >
              {saving ? "Saving…" : "Save birth sketch"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
