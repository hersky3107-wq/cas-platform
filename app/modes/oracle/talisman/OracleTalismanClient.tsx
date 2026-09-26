"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, LoaderCircle } from "lucide-react";
import { TALISMAN_PRICE } from "@/lib/oracle/runner/conventions";
import {
  TALISMAN_BUY_PURPOSES,
  TALISMAN_PURPOSE_LABELS,
  isFreePhoneGrant,
  shouldShowFreePhoneHint,
  type TalismanBuyPurpose,
} from "@/lib/oracle/talisman/entitlement";
import type { TalismanPngFormat } from "@/lib/oracle/talisman/png/formats";
import { PHYSICS_CAPTION, TALISMAN_FRAMES, type TalismanSpec } from "@/lib/oracle/talisman/variants";
import { TalismanSvg } from "@/lib/oracle/talisman/TalismanSvg";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

const FORMAT_LABELS: Record<TalismanPngFormat, string> = {
  phone: "휴대폰",
  wallet: "지갑카드",
  square: "정사각",
  desktop: "화면",
};

const FORMATS: TalismanPngFormat[] = ["phone", "wallet", "square", "desktop"];

type TalismanSessionOption = {
  id: string;
  createdAt: string;
  label: string;
};

type TalismanPayload = {
  ok?: boolean;
  hasReading?: boolean;
  sessionId?: string;
  purpose?: TalismanBuyPurpose;
  spec?: TalismanSpec;
  physicsCaption?: string;
  purchased?: boolean;
  isFirstIntegratedSession?: boolean;
  firstEligibleSession?: {
    id: string;
    createdAt: string;
    dateLabel: string;
    purchased?: boolean;
  } | null;
  readingDateLabel?: string;
  sessions?: TalismanSessionOption[];
  unlockedFormats?: TalismanPngFormat[];
  purchasedPurposes?: TalismanBuyPurpose[];
  price?: number;
  prices?: Record<TalismanBuyPurpose, number>;
  error?: string;
};

function phoneFrame() {
  return TALISMAN_FRAMES.find((frame) => frame.id === "phone") ?? TALISMAN_FRAMES[0]!;
}

export default function OracleTalismanClient() {
  const router = useRouter();
  const search = useSearchParams();
  const sessionParam = search.get("session");
  const purposeParam = (search.get("purpose") ?? "deficiency") as TalismanBuyPurpose;
  const purpose: TalismanBuyPurpose = TALISMAN_BUY_PURPOSES.includes(purposeParam)
    ? purposeParam
    : "deficiency";

  const [ready, setReady] = useState(false);
  const [payload, setPayload] = useState<TalismanPayload | null>(null);
  const [buying, setBuying] = useState(false);
  const [busyFormat, setBusyFormat] = useState<TalismanPngFormat | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (sessionParam) q.set("session", sessionParam);
    if (purpose !== "deficiency") q.set("purpose", purpose);
    const res = await fetch(`/api/oracle/talisman?${q.toString()}`).catch(() => null);
    if (res?.status === 401) {
      router.replace("/auth");
      return;
    }
    if (!res?.ok) {
      setPayload({ ok: false, hasReading: false });
      setReady(true);
      return;
    }
    const json = (await res.json().catch(() => null)) as TalismanPayload | null;
    setPayload(json);
    setReady(true);
  }, [purpose, router, sessionParam]);

  useEffect(() => {
    void load();
  }, [load]);

  const spec = payload?.spec ?? null;
  const sessionId = payload?.sessionId ?? sessionParam;
  const purchased = Boolean(payload?.purchased);
  const isFirst = Boolean(payload?.isFirstIntegratedSession);
  const caption = payload?.physicsCaption ?? spec?.physicsCaption ?? PHYSICS_CAPTION;
  const price = payload?.price ?? (purpose === "deficiency" ? TALISMAN_PRICE.deficiency : TALISMAN_PRICE.purpose);
  const frame = useMemo(() => phoneFrame(), []);
  const readingDate =
    payload?.readingDateLabel ?? (spec?.dateLabel ? `${spec.dateLabel} 통합 판독 기준` : "");
  const freePhone =
    !purchased &&
    isFreePhoneGrant({
      purpose,
      format: "phone",
      isFirstIntegratedSession: isFirst,
    });

  const firstEligible =
    payload?.firstEligibleSession ??
    (payload?.sessions && payload.sessions.length > 0
      ? {
          id: payload.sessions[payload.sessions.length - 1]!.id,
          createdAt: payload.sessions[payload.sessions.length - 1]!.createdAt,
          dateLabel: payload.sessions[payload.sessions.length - 1]!.label.replace(" 통합 판독", ""),
          purchased: false,
        }
      : null);

  const showFreeHint = shouldShowFreePhoneHint({
    selectedSessionId: sessionId,
    firstEligibleSessionId: firstEligible?.id,
    firstEligiblePurchased: firstEligible?.purchased,
  });

  function hrefFor(next: TalismanBuyPurpose) {
    const q = new URLSearchParams();
    if (sessionId) q.set("session", sessionId);
    if (next !== "deficiency") q.set("purpose", next);
    return `/modes/oracle/talisman?${q.toString()}`;
  }

  function switchSession(nextId: string, nextPurpose?: TalismanBuyPurpose) {
    const targetPurpose = nextPurpose ?? purpose;
    const q = new URLSearchParams();
    q.set("session", nextId);
    if (targetPurpose !== "deficiency") q.set("purpose", targetPurpose);
    router.replace(`/modes/oracle/talisman?${q.toString()}`);
  }

  async function buyAll() {
    if (!sessionId) return;
    setMessage(null);
    setBuying(true);
    const res = await fetch("/api/oracle/talisman", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, purpose }),
    }).catch(() => null);
    setBuying(false);
    if (res?.status === 402) {
      setMessage("크레딧이 부족합니다.");
      return;
    }
    if (!res?.ok) {
      setMessage("받을 수 없습니다.");
      return;
    }
    const json = (await res.json().catch(() => null)) as TalismanPayload | null;
    setPayload((prev) => ({
      ...prev,
      purchased: true,
      unlockedFormats: json?.unlockedFormats ?? FORMATS,
    }));
  }

  async function download(format: TalismanPngFormat) {
    if (!sessionId) return;
    setMessage(null);
    const q = new URLSearchParams({ format });
    if (purpose !== "deficiency") q.set("purpose", purpose);
    window.location.href = `/api/oracle/session/${sessionId}/talisman/png?${q.toString()}`;
  }

  if (!ready) {
    return (
      <main className={`${BG} flex items-center justify-center`}>
        <LoaderCircle className="h-6 w-6 animate-spin text-white/40" aria-hidden />
      </main>
    );
  }

  return (
    <main className={`${BG} px-4 py-8 md:px-8`}>
      <style>{`
        .talisman-svg line,
        .talisman-svg circle,
        .talisman-svg rect,
        .talisman-svg polygon,
        .talisman-svg polyline,
        .talisman-svg path {
          vector-effect: non-scaling-stroke;
        }
      `}</style>
      <div className="mx-auto max-w-md">
        <Link
          href="/modes/oracle"
          className="inline-flex items-center gap-1 text-[12px] tracking-[0.14em] text-white/45 hover:text-white/80"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          오라클
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">부적</h1>

        {!payload?.hasReading || !spec ? (
          <section className="mt-8 rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
            <p className="text-sm leading-relaxed text-slate-300">
              부적은 통합 12체계 판독이 끝난 뒤에 받을 수 있습니다.
            </p>
            <Link
              href="/modes/oracle/integrated"
              className="mt-5 inline-flex rounded-full border border-amber-300/40 bg-amber-400/15 px-4 py-2 text-sm text-amber-50 hover:bg-amber-400/25"
            >
              통합 판독 시작
            </Link>
          </section>
        ) : (
          <>
            {readingDate ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-white/50">
                <span>{readingDate}</span>
                {payload?.sessions && payload.sessions.length > 1 ? (
                  <select
                    value={sessionId ?? ""}
                    onChange={(e) => switchSession(e.target.value)}
                    className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/80 focus:border-white/40 focus:outline-none"
                    aria-label="판독 선택"
                  >
                    {payload.sessions.map((s) => (
                      <option key={s.id} value={s.id} className="bg-[#0a0f1e] text-white">
                        {s.label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            ) : null}

            <nav className="mt-4 flex flex-wrap gap-2" aria-label="부적 종류">
              {TALISMAN_BUY_PURPOSES.map((id) => (
                <Link
                  key={id}
                  href={hrefFor(id)}
                  className={`rounded-full border px-3 py-1.5 text-[12px] ${
                    purpose === id
                      ? "border-white/40 bg-white/10 text-white"
                      : "border-white/10 text-white/55 hover:border-white/25"
                  }`}
                >
                  {TALISMAN_PURPOSE_LABELS[id]}
                </Link>
              ))}
            </nav>

            <figure className="mt-8 flex flex-col items-center">
              <div
                className="overflow-hidden border border-white/10 bg-[#07080c]"
                style={{ width: 240, height: Math.round(240 / frame.aspect) }}
              >
                <TalismanSvg spec={spec} frame={frame} uid={`live-${spec.id}-${purpose}`} />
              </div>
              <figcaption className="mt-4 max-w-sm text-center text-[11px] leading-relaxed text-white/40">
                {caption}
              </figcaption>
            </figure>

            {showFreeHint && firstEligible ? (
              <p className="mt-6 text-center text-xs text-white/60">
                <button
                  type="button"
                  onClick={() => switchSession(firstEligible.id, "deficiency")}
                  className="text-amber-300 underline underline-offset-2 hover:text-amber-200 transition cursor-pointer"
                >
                  첫 통합 판독({firstEligible.dateLabel})으로 휴대폰 부적을 무료로 받을 수 있어요
                </button>
              </p>
            ) : null}

            <div className={`${showFreeHint ? "mt-3" : "mt-6"} flex flex-col gap-2.5`}>
              {purchased ? (
                <>
                  <div className="flex items-center justify-center gap-1.5 text-xs text-white/50">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    구매 완료
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {FORMATS.map((format) => (
                      <button
                        key={format}
                        type="button"
                        disabled={busyFormat === format}
                        onClick={() => void download(format)}
                        className="rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm font-medium hover:border-white/30 disabled:opacity-50 transition"
                      >
                        {FORMAT_LABELS[format]}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  {freePhone ? (
                    <button
                      type="button"
                      disabled={busyFormat === "phone"}
                      onClick={() => void download("phone")}
                      className="w-full rounded-2xl border border-white/20 bg-white/[0.07] px-4 py-3 text-sm font-medium text-white hover:border-white/40 hover:bg-white/[0.12] disabled:opacity-50 transition"
                    >
                      휴대폰 배경화면 무료로 받기
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={buying}
                    onClick={() => void buyAll()}
                    className="w-full rounded-2xl border border-amber-300/40 bg-amber-400/20 px-4 py-3.5 text-sm font-semibold text-amber-50 hover:bg-amber-400/30 disabled:opacity-50 transition shadow-lg shadow-amber-950/20"
                  >
                    {buying ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <LoaderCircle className="h-4 w-4 animate-spin text-amber-200" />
                        결제 중...
                      </span>
                    ) : (
                      `${price}크레딧으로 4가지 형식 모두 받기`
                    )}
                  </button>
                </>
              )}
            </div>
            {message ? <p className="mt-3 text-center text-sm text-amber-200">{message}</p> : null}
          </>
        )}
      </div>
    </main>
  );
}
