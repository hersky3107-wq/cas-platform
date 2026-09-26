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
  type TalismanBuyPurpose,
} from "@/lib/oracle/talisman/entitlement";
import type { TalismanPngFormat } from "@/lib/oracle/talisman/png/formats";
import { PHYSICS_CAPTION, TALISMAN_FRAMES, type TalismanSpec } from "@/lib/oracle/talisman/variants";
import { TalismanSvg } from "@/lib/oracle/talisman/TalismanSvg";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

const FORMAT_LABELS: Record<TalismanPngFormat, string> = {
  phone: "휴대폰",
  wallet: "지갑",
  square: "정사각",
  desktop: "화면",
};

const FORMATS: TalismanPngFormat[] = ["phone", "wallet", "square", "desktop"];

type TalismanPayload = {
  ok?: boolean;
  hasReading?: boolean;
  sessionId?: string;
  purpose?: TalismanBuyPurpose;
  spec?: TalismanSpec;
  physicsCaption?: string;
  purchased?: boolean;
  isFirstIntegratedSession?: boolean;
  unlockedFormats?: TalismanPngFormat[];
  purchasedPurposes?: TalismanBuyPurpose[];
  price?: number;
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
  const unlocked = new Set(payload?.unlockedFormats ?? []);
  const caption = payload?.physicsCaption ?? spec?.physicsCaption ?? PHYSICS_CAPTION;
  const price = purpose === "deficiency" ? TALISMAN_PRICE.deficiency : TALISMAN_PRICE.purpose;
  const frame = useMemo(() => phoneFrame(), []);

  function hrefFor(next: TalismanBuyPurpose) {
    const q = new URLSearchParams();
    if (sessionId) q.set("session", sessionId);
    if (next !== "deficiency") q.set("purpose", next);
    return `/modes/oracle/talisman?${q.toString()}`;
  }

  async function download(format: TalismanPngFormat) {
    if (!sessionId) return;
    setMessage(null);
    const already =
      purchased ||
      unlocked.has(format) ||
      isFreePhoneGrant({ purpose, format, isFirstIntegratedSession: isFirst });
    if (!already) {
      setBusyFormat(format);
      const res = await fetch("/api/oracle/talisman", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, purpose }),
      }).catch(() => null);
      setBusyFormat(null);
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
            <nav className="mt-6 flex flex-wrap gap-2" aria-label="부적 종류">
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

            <div className="mt-6 grid grid-cols-2 gap-2">
              {FORMATS.map((format) => {
                const free = isFreePhoneGrant({
                  purpose,
                  format,
                  isFirstIntegratedSession: isFirst,
                });
                const open = purchased || unlocked.has(format) || free;
                const label = FORMAT_LABELS[format];
                const hint = open ? (free && !purchased ? "무료" : "받기") : `${price}크레딧`;
                return (
                  <button
                    key={format}
                    type="button"
                    disabled={busyFormat === format}
                    onClick={() => void download(format)}
                    className="rounded-2xl border border-white/15 bg-white/[0.04] px-3 py-3 text-sm hover:border-white/30 disabled:opacity-50"
                  >
                    {label}
                    <span className="mt-1 block text-[11px] text-white/45">{hint}</span>
                  </button>
                );
              })}
            </div>
            {message ? <p className="mt-3 text-center text-sm text-amber-200">{message}</p> : null}
          </>
        )}
      </div>
    </main>
  );
}
