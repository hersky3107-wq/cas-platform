"use client";

import Link from "next/link";
import {
  type FormEvent,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import type { ApproxBirthBand, Gender, OracleBirthProfileV1 } from "@/lib/oracle/types";
import {
  SURVEY_QUESTIONS,
  type SurveyAnswersExpected,
} from "@/lib/oracle/survey-data";
import { approxBandToMidpointHHMM } from "@/lib/oracle/sijin";
import MbtiEstimator from "../inputs/MbtiEstimator";
import {
  isReadingSystemId,
  parseMissingParam,
  profileFieldsToShow,
  readingPath,
  type ProfileField,
} from "@/lib/oracle/system-requirements";
import type { SystemId } from "@/lib/oracle/axes/types";
import { SINGLE_SYSTEM_BY_ID } from "@/lib/oracle/single-system-ui";
import {
  inferNameScript,
  isNameScript,
  splitNameFields,
  type NameScript,
} from "@/lib/oracle/name-script";
import {
  ORACLE_PROFILE_SURVEY_IDS,
  getOracleProfileCopy,
  type OracleProfileSurveyId,
} from "@/lib/oracle/i18n";

const BG = "min-h-screen bg-[#0a0f1e] text-white";
const copy = getOracleProfileCopy("ko");

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
  return SURVEY_QUESTIONS.every((q) => typeof answers[q.id] === "number");
}

function nameMethodFor(script: NameScript): string {
  switch (script) {
    case "hangul":
      return copy.nameMethodHangul;
    case "hanja":
      return copy.nameMethodHanja;
    case "ja":
      return copy.nameMethodJa;
    case "latin":
      return copy.nameMethodLatin;
  }
}

type ApproxPersist = ApproxBirthBand;

function OracleProfileForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const systemParam = searchParams.get("system");
  const system: SystemId | null = systemParam && isReadingSystemId(systemParam) ? systemParam : null;
  const missing = parseMissingParam(searchParams.get("missing"));
  const returnTo = searchParams.get("return");
  const fields = profileFieldsToShow(system, missing);
  const fullForm = fields === "full";
  const show = (field: ProfileField) => fullForm || (Array.isArray(fields) && fields.includes(field));
  const extrasOnly =
    !fullForm &&
    Array.isArray(fields) &&
    fields.length > 0 &&
    !fields.includes("birth_date") &&
    !fields.includes("birth_place") &&
    !fields.includes("sex");
  const showName = show("name") || show("name_latin");
  const nameRequired = show("name");

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
    fullForm ? "exact" : "unknown",
  );
  const [birth_time_24h, setBirthTime24h] = useState("12:30");

  const [approxBandPersist, setApproxBandPersist] = useState<ApproxPersist | null>(null);

  const [surveyAnswers, setSurveyAnswers] = useState<Partial<SurveyAnswersExpected>>({});
  const [inferredTime, setInferredTime] = useState<string | null>(null);
  const [inferredSijin, setInferredSijin] = useState<string | null>(null);
  const [inferBusy, setInferBusy] = useState(false);
  const surveyAutoInferRef = useRef(false);

  const [nameSurname, setNameSurname] = useState("");
  const [nameGiven, setNameGiven] = useState("");
  const [nameScript, setNameScript] = useState<NameScript>(
    show("name_latin") && !show("name") ? "latin" : "hangul",
  );
  const [mbti, setMbti] = useState("");
  const [mbtiEstimated, setMbtiEstimated] = useState(false);

  const surveyReady = useMemo(() => answersComplete(surveyAnswers), [surveyAnswers]);

  const maxDay = dobMonth >= 1 && dobYear >= 1900 ? daysInMonth(dobYear, dobMonth) : 31;

  useEffect(() => {
    if (
      timeKnowledge !== "unknown" ||
      approxBandPersist !== null ||
      !surveyReady ||
      surveyAutoInferRef.current ||
      !fullForm
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
                : copy.inferFailed,
            );
            surveyAutoInferRef.current = false;
          }
          return;
        }
        if (!cancelled) {
          const hh = typeof j.midpoint_24h === "string" ? j.midpoint_24h : null;
          const sj = typeof j.sijin_kr === "string" ? j.sijin_kr.trim() || null : null;
          setInferredTime(hh ?? null);
          setInferredSijin(sj ?? null);
          if (hh) setBirthTime24h(hh);
          setMessage(copy.inferDone);
        }
      } catch {
        if (!cancelled) {
          setErr(copy.inferRequestFailed);
          surveyAutoInferRef.current = false;
        }
      } finally {
        if (!cancelled) setInferBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [timeKnowledge, approxBandPersist, surveyAnswers, surveyReady, fullForm]);

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
        runnerProfile?: {
          birth_date?: string | null;
          name_local?: string | null;
          name_hanja?: string | null;
          name_latin?: string | null;
          mbti?: string | null;
          derived?: Record<string, unknown> | null;
        } | null;
        placeholderBirthDate?: boolean;
        mbtiEstimated?: boolean;
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
            setSurveyAnswers(p.survey_selections as Partial<SurveyAnswersExpected>);
          setInferredTime(p.birth_time_24h);
          setBirthTime24h(p.birth_time_24h);
          const sk = p.resolved_sijin_kr ?? null;
          setInferredSijin(sk);
          surveyAutoInferRef.current = true;
          setMessage(copy.inferDone);
        }
      } else if (j.runnerProfile?.birth_date && !j.placeholderBirthDate) {
        const parts = splitIsoToParts(j.runnerProfile.birth_date);
        if (parts) {
          setDobMonth(parts.monthIdx);
          setDobDay(parts.day);
          setDobYear(parts.year);
        }
      }
      const runner = j.runnerProfile;
      const script = inferNameScript({
        name_local: runner?.name_local ?? null,
        name_hanja: runner?.name_hanja ?? null,
        name_latin: runner?.name_latin ?? null,
        derived: runner?.derived ?? null,
      });
      const names = splitNameFields(
        script,
        runner?.name_local ?? null,
        runner?.name_hanja ?? null,
        runner?.name_latin ?? null,
      );
      setNameScript(script);
      setNameSurname(names.surname);
      setNameGiven(names.given);
      setMbti(j.runnerProfile?.mbti ?? "");
      setMbtiEstimated(j.mbtiEstimated === true);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function afterSave() {
    if (returnTo && returnTo.startsWith("/")) {
      router.push(returnTo);
      return;
    }
    if (system) {
      router.push(readingPath(system));
      return;
    }
    router.push("/modes/oracle");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    const isoDob =
      dobMonth >= 1 && dobDay >= 1 && dobYear >= 1
        ? composeIsoDate(dobMonth, dobDay, dobYear)
        : null;

    if ((show("birth_date") || !extrasOnly) && !isoDob) {
      setDobError(copy.dobInvalid);
      return;
    }
    setDobError(null);

    if (show("birth_place") && !birthCity.trim()) {
      setErr(copy.cityRequired);
      return;
    }
    if (nameRequired && (!nameSurname.trim() || !nameGiven.trim())) {
      setErr(copy.nameNeedBoth);
      return;
    }
    if (show("mbti") && !mbti) {
      setErr(copy.mbtiRequired);
      return;
    }

    setSaving(true);
    setMessage(null);

    const extras: Record<string, unknown> = {};
    if (showName && nameSurname.trim() && nameGiven.trim()) {
      extras.name_surname = nameSurname.trim();
      extras.name_given = nameGiven.trim();
      extras.name_script = nameScript;
    }
    if (show("mbti") && mbti) {
      extras.mbti = mbti;
      extras.mbti_estimated = mbtiEstimated;
    }

    const body: Record<string, unknown> = { ...extras };

    if (!extrasOnly && isoDob) {
      body.dob = isoDob;
      body.birth_city = birthCity.trim();
      body.gender = gender;
      body.birth_time_known = timeKnowledge === "exact";
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
      // ok must be asserted, not assumed: a 200 with ok!==true used to slip
      // through here and navigate onward while the name was never saved (FIX 7).
      if (!res.ok || j?.ok !== true) {
        const parts = [
          typeof j?.error === "string" ? j.error : null,
          typeof j?.hint === "string" ? j.hint : null,
        ].filter(Boolean);
        setErr(parts.length ? parts.join(" ") : copy.saveGenericError);
        setSaving(false);
        return;
      }
      setSaving(false);
      afterSave();
    } catch {
      setErr(copy.saveFailed);
      setSaving(false);
    }
  }

  const unknownBlocked =
    fullForm &&
    timeKnowledge === "unknown" &&
    (approxBandPersist ? false : inferBusy || !surveyReady || !inferredTime);

  const backHref = returnTo && returnTo.startsWith("/") ? returnTo : "/modes/oracle";
  const reasons = missing.map((field) => copy.fieldReason[field]);
  const title = system ? copy.titleForSystem(SINGLE_SYSTEM_BY_ID[system].shortName) : copy.titleFull;
  const latinOrder = nameScript === "latin";

  return (
    <main className={BG} lang="ko">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 pb-32 pt-8 sm:px-8">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-cyan-200/90 hover:text-cyan-100"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />{" "}
          {system ? copy.backToReading : copy.backToLobby}
        </Link>

        <h1 className="mt-8 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {reasons.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {reasons.map((reason) => (
              <li
                key={reason}
                className="rounded-2xl border border-amber-300/30 bg-amber-950/30 px-3 py-2 text-sm text-amber-50"
              >
                {reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-slate-300">{fullForm ? copy.introFull : copy.introPartial}</p>
        )}

        {loading ? (
          <p className="mt-12 text-center text-sm text-white/55">{copy.loading}</p>
        ) : (
          <form className="mt-10 space-y-8 text-sm" onSubmit={submit}>
            {show("birth_date") ? (
              <fieldset className="space-y-3" lang="ko">
                <label className="text-[11px] uppercase tracking-[0.2em] text-white/52">
                  {copy.dobLabel}
                </label>
                <p className="text-[11px] text-white/42">{copy.dobHint}</p>
                <div className="grid grid-cols-3 gap-3">
                  <select
                    value={dobMonth}
                    aria-label={copy.dobMonthAria}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setDobMonth(next);
                      setDobError(null);
                      if (next >= 1 && dobYear >= 1900) {
                        const cap = daysInMonth(dobYear, next);
                        if (dobDay > cap) setDobDay(cap);
                      }
                    }}
                    className="rounded-2xl border border-white/[0.14] bg-black/35 px-3 py-2.5 text-white focus:border-cyan-300/50 focus:outline-none"
                  >
                    <option value={0}>{copy.monthPlaceholder}</option>
                    {copy.months.map((label, ix) => (
                      <option key={label} value={ix + 1}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={dobDay}
                    aria-label={copy.dobDayAria}
                    onChange={(e) => {
                      setDobDay(Number(e.target.value));
                      setDobError(null);
                    }}
                    className="rounded-2xl border border-white/[0.14] bg-black/35 px-3 py-2.5 text-white focus:border-cyan-300/50 focus:outline-none"
                  >
                    <option value={0}>{copy.dayPlaceholder}</option>
                    {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <select
                    value={dobYear}
                    aria-label={copy.dobYearAria}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setDobYear(next);
                      setDobError(null);
                      if (dobMonth >= 1 && next >= 1900) {
                        const cap = daysInMonth(next, dobMonth);
                        if (dobDay > cap) setDobDay(cap);
                      }
                    }}
                    className="rounded-2xl border border-white/[0.14] bg-black/35 px-3 py-2.5 text-white focus:border-cyan-300/50 focus:outline-none"
                  >
                    <option value={0}>{copy.yearPlaceholder}</option>
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                {dobError ? <p className="text-sm text-rose-300">{dobError}</p> : null}
              </fieldset>
            ) : null}

            {show("birth_place") ? (
              <fieldset className="space-y-2">
                <label className="text-[11px] uppercase tracking-[0.2em] text-white/52">
                  {copy.cityLabel}
                </label>
                <input
                  required
                  placeholder={copy.cityPlaceholder}
                  type="text"
                  value={birthCity}
                  onChange={(e) => setBirthCity(e.target.value)}
                  className="w-full rounded-2xl border border-white/[0.14] bg-black/35 px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
                />
                <p className="text-[11px] text-white/42">{copy.cityHint}</p>
              </fieldset>
            ) : null}

            {show("sex") ? (
              <fieldset className="space-y-2">
                <label className="text-[11px] uppercase tracking-[0.2em] text-white/52">
                  {copy.genderLabel}
                </label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as Gender)}
                  className="w-full rounded-2xl border border-white/[0.14] bg-black/35 px-4 py-2.5 text-white focus:border-cyan-300/50 focus:outline-none"
                >
                  <option value="female">{copy.genderFemale}</option>
                  <option value="male">{copy.genderMale}</option>
                  <option value="prefer_not_to_say">{copy.genderPreferNot}</option>
                </select>
              </fieldset>
            ) : null}

            {showName ? (
              <fieldset className="space-y-3">
                <label className="text-[11px] uppercase tracking-[0.2em] text-white/52">
                  {copy.nameLabel}
                </label>
                <p className="text-[12px] leading-relaxed text-white/55">{copy.nameUsedBy}</p>
                <select
                  aria-label={copy.nameScriptLabel}
                  value={nameScript}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (isNameScript(next)) setNameScript(next);
                  }}
                  className="w-full rounded-2xl border border-white/[0.14] bg-black/35 px-4 py-2.5 text-white focus:border-cyan-300/50 focus:outline-none"
                >
                  <option value="hangul">{copy.nameScriptHangul}</option>
                  <option value="hanja">{copy.nameScriptHanja}</option>
                  <option value="ja">{copy.nameScriptJa}</option>
                  <option value="latin">{copy.nameScriptLatin}</option>
                </select>
                <div className="grid gap-3 sm:grid-cols-2">
                  {latinOrder ? (
                    <>
                      <input
                        required={nameRequired}
                        placeholder={copy.nameGiven}
                        lang="en"
                        value={nameGiven}
                        onChange={(e) => setNameGiven(e.target.value)}
                        className="w-full rounded-2xl border border-white/[0.14] bg-black/35 px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
                      />
                      <input
                        required={nameRequired}
                        placeholder={copy.nameFamily}
                        lang="en"
                        value={nameSurname}
                        onChange={(e) => setNameSurname(e.target.value)}
                        className="w-full rounded-2xl border border-white/[0.14] bg-black/35 px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
                      />
                    </>
                  ) : (
                    <>
                      <input
                        required={nameRequired}
                        placeholder={copy.nameFamily}
                        lang={nameScript === "ja" ? "ja" : nameScript === "hanja" ? "zh" : "ko"}
                        value={nameSurname}
                        onChange={(e) => setNameSurname(e.target.value)}
                        className="w-full rounded-2xl border border-white/[0.14] bg-black/35 px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
                      />
                      <input
                        required={nameRequired}
                        placeholder={copy.nameGiven}
                        lang={nameScript === "ja" ? "ja" : nameScript === "hanja" ? "zh" : "ko"}
                        value={nameGiven}
                        onChange={(e) => setNameGiven(e.target.value)}
                        className="w-full rounded-2xl border border-white/[0.14] bg-black/35 px-4 py-2.5 text-white placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
                      />
                    </>
                  )}
                </div>
                <p className="text-[12px] leading-relaxed text-white/50">{nameMethodFor(nameScript)}</p>
              </fieldset>
            ) : null}

            {show("mbti") ? (
              <fieldset className="space-y-3">
                {mbti ? <p className="text-sm text-slate-200">{copy.mbtiCurrent(mbti, mbtiEstimated)}</p> : null}
                <MbtiEstimator
                  onResolved={(type, estimated) => {
                    setMbti(type);
                    setMbtiEstimated(estimated);
                  }}
                />
              </fieldset>
            ) : null}

            {fullForm ? (
              <fieldset className="space-y-4 rounded-3xl border border-white/[0.1] bg-white/[0.03] p-5">
                <legend className="px-2 text-[12px] font-semibold uppercase tracking-[0.15em] text-white/72">
                  {copy.timeLegend}
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
                  {copy.timeExact}
                </label>

                {timeKnowledge === "exact" ? (
                  <input
                    required
                    type="time"
                    step={60}
                    lang="ko"
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
                  {copy.timeUnknown}
                </label>

                {timeKnowledge === "unknown" ? (
                  <div className="space-y-4 pt-2">
                    {approxBandPersist ? (
                      <p className="rounded-xl border border-amber-300/35 bg-amber-950/20 px-3 py-2 text-[13px] text-amber-100">
                        {copy.timeApproxOnFile(birth_time_24h)}
                      </p>
                    ) : (
                      <>
                        <p className="text-[12px] leading-relaxed text-slate-400">{copy.surveyIntro}</p>
                        {inferBusy && !inferredTime ? (
                          <p className="text-[12px] text-slate-400">{copy.inferBusy}</p>
                        ) : null}
                        {message && inferredTime ? (
                          <p className="rounded-xl border border-emerald-400/35 bg-emerald-950/20 px-3 py-2 text-[13px] text-emerald-100">
                            {message}
                          </p>
                        ) : null}
                        {!inferredTime && !inferBusy ? (
                          <p className="text-[12px] text-slate-500">{copy.inferNeedAll}</p>
                        ) : null}
                        {ORACLE_PROFILE_SURVEY_IDS.map((id: OracleProfileSurveyId) => {
                          const row = copy.survey[id];
                          return (
                            <div key={id} className="space-y-1.5">
                              <div className="text-[13px] text-slate-100">{row.text}</div>
                              <div className="grid gap-1.5">
                                {row.choices.map((choice, ix) => (
                                  <label
                                    key={choice}
                                    className="flex cursor-pointer items-start gap-2 rounded-xl border border-white/[0.08] px-3 py-1.5 text-[12px] text-slate-200 hover:bg-white/[0.06]"
                                  >
                                    <input
                                      type="radio"
                                      name={id}
                                      checked={
                                        surveyAnswers[id as keyof SurveyAnswersExpected] === ix
                                      }
                                      onChange={() => {
                                        surveyAutoInferRef.current = false;
                                        setInferredTime(null);
                                        setInferredSijin(null);
                                        setMessage(null);
                                        setSurveyAnswers((prev) => ({
                                          ...prev,
                                          [id]: ix,
                                        }));
                                      }}
                                    />
                                    {choice}
                                  </label>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                ) : null}
              </fieldset>
            ) : null}

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
              {saving ? copy.saving : fullForm ? copy.saveFull : copy.savePartial}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function OracleProfilePage() {
  return (
    <Suspense fallback={<main className={BG} aria-busy="true" />}>
      <OracleProfileForm />
    </Suspense>
  );
}
