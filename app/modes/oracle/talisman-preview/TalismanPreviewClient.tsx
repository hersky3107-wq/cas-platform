"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TalismanSvg } from "./TalismanSvg";
import { TALISMAN_FRAMES, TALISMAN_VARIANTS, type FrameSpec, type TalismanSpec } from "./variants";
import type { TalismanPurpose } from "@/lib/oracle/talisman";

type SessionPayload = {
  ok: boolean;
  reason?: string;
  error?: string;
  spec?: TalismanSpec;
  stats?: {
    seals: number;
    emptyPalaces: number;
    hyungbang: number;
    centreSource: string;
    centreMode: string;
    centreElement: string | null;
  };
  arrival?: {
    nativeMissing: Array<{ system: string; field: string }>;
  };
};

const PURPOSES: Array<{ id: TalismanPurpose | ""; label: string }> = [
  { id: "", label: "결핍 · BINDRUNE" },
  { id: "wealth", label: "재물 財" },
  { id: "love", label: "연애 和合" },
  { id: "promotion", label: "승진 登科" },
  { id: "health", label: "건강 康寧" },
  { id: "exorcism", label: "파마 鎭" },
];

function FrameCard({ spec, frame }: { spec: TalismanSpec; frame: FrameSpec }) {
  const height = frame.id === "phone" ? 520 : frame.id === "wallet" ? 430 : frame.id === "square" ? 280 : 188;
  const width = Math.round(height * frame.aspect);
  return (
    <figure className="flex min-w-0 flex-col items-center">
      <div className="overflow-hidden border border-white/10 bg-[#07080c]" style={{ width, height }}>
        <TalismanSvg spec={spec} frame={frame} uid={`crop-${spec.id}-${frame.id}`} />
      </div>
      <figcaption className="mt-2 flex w-full items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium tracking-[0.18em] text-white/70 uppercase">{frame.label}</span>
        <span className="text-[10px] tracking-[0.16em] text-white/35">{frame.sub}</span>
      </figcaption>
    </figure>
  );
}

export default function TalismanPreviewClient({
  sessionId,
  purpose: purposeParam,
}: {
  sessionId: string | null;
  purpose: string | null;
}) {
  const [active, setActive] = useState(0);
  const [purpose, setPurpose] = useState(purposeParam ?? "");
  const [payload, setPayload] = useState<SessionPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hardcoded = TALISMAN_VARIANTS[active] ?? TALISMAN_VARIANTS[0]!;

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const query = purpose ? `?purpose=${encodeURIComponent(purpose)}` : "";
    fetch(`/api/oracle/session/${sessionId}/talisman${query}`)
      .then(async (res) => {
        const body = (await res.json()) as SessionPayload & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        if (!cancelled) setPayload(body);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, purpose]);

  const spec = sessionId ? payload?.spec ?? null : hardcoded;
  const live = Boolean(sessionId);

  const sessionHref = useMemo(() => {
    if (!sessionId) return "/modes/oracle/talisman-preview";
    const q = new URLSearchParams({ session: sessionId });
    if (purpose) q.set("purpose", purpose);
    return `/modes/oracle/talisman-preview?${q.toString()}`;
  }, [sessionId, purpose]);

  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-8 text-white md:px-8">
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
      <div className="mx-auto max-w-6xl">
        <p className="text-[10px] tracking-[0.32em] text-white/40 uppercase">
          {live ? "session · computeTalisman" : "throwaway · hard-coded"}
        </p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">부적 preview</h1>
          <Link href="/modes/oracle" className="text-[12px] tracking-[0.14em] text-white/45 hover:text-white/80">
            ← oracle
          </Link>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          {live
            ? "Real session charts through computeTalisman. Six hard-coded variants remain below for comparison."
            : "SVG only, hard-coded charts. Add ?session=<id> to draw from a finished oracle session."}
        </p>

        {live ? (
          <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex flex-wrap gap-2">
              {PURPOSES.map((item) => (
                <a
                  key={item.id || "bindrune"}
                  href={
                    item.id
                      ? `/modes/oracle/talisman-preview?session=${sessionId}&purpose=${item.id}`
                      : `/modes/oracle/talisman-preview?session=${sessionId}`
                  }
                  onClick={(event) => {
                    event.preventDefault();
                    setPurpose(item.id);
                  }}
                  className={`rounded-full border px-3 py-1.5 text-[11px] tracking-[0.08em] ${
                    purpose === item.id
                      ? "border-white/40 bg-white/10 text-white"
                      : "border-white/10 text-white/55 hover:border-white/25"
                  }`}
                >
                  {item.label}
                </a>
              ))}
            </div>
            {loadError ? <p className="mt-3 text-sm text-rose-300">{loadError}</p> : null}
            {payload && !payload.ok ? (
              <p className="mt-3 text-sm text-amber-200">gate: {payload.reason ?? "refused"}</p>
            ) : null}
            {payload?.stats ? (
              <dl className="mt-4 grid grid-cols-2 gap-2 text-[12px] text-white/70 md:grid-cols-3">
                <div>seals {payload.stats.seals}</div>
                <div>empty 宮 {payload.stats.emptyPalaces}</div>
                <div>흉방 {payload.stats.hyungbang}</div>
                <div>centre {payload.stats.centreSource}</div>
                <div>mode {payload.stats.centreMode}</div>
                <div>element {payload.stats.centreElement ?? "none"}</div>
              </dl>
            ) : null}
            {payload?.arrival?.nativeMissing?.length ? (
              <p className="mt-3 text-[11px] text-amber-200/80">
                missing: {payload.arrival.nativeMissing.map((row) => `${row.system}.${row.field}`).join(", ")}
              </p>
            ) : null}
            <p className="mt-2 text-[10px] tracking-[0.14em] text-white/30">{sessionHref}</p>
          </section>
        ) : (
          <nav className="mt-6 flex flex-wrap gap-2" aria-label="variants">
            {TALISMAN_VARIANTS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActive(index)}
                className={`rounded-full border px-3 py-1.5 text-left text-[11px] tracking-[0.08em] transition ${
                  index === active
                    ? "border-white/40 bg-white/10 text-white"
                    : "border-white/10 text-white/55 hover:border-white/25 hover:text-white/80"
                }`}
              >
                {item.title}
              </button>
            ))}
          </nav>
        )}
        <p className="mt-3 text-sm text-slate-300">{spec?.note ?? (live ? "loading…" : hardcoded.note)}</p>

        {spec ? (
          <section className="mt-8">
            <h2 className="text-[10px] tracking-[0.28em] text-white/40 uppercase">Four crops</h2>
            <div className="mt-4 flex flex-wrap items-end justify-center gap-8">
              {TALISMAN_FRAMES.map((frame) => (
                <FrameCard key={frame.id} spec={spec} frame={frame} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-14">
          <h2 className="text-[10px] tracking-[0.28em] text-white/40 uppercase">Six variants · square</h2>
          <div className="mt-4 grid grid-cols-2 gap-5 md:grid-cols-3">
            {TALISMAN_VARIANTS.map((item, index) => (
              <button key={item.id} type="button" onClick={() => setActive(index)} className="text-left">
                <div className="overflow-hidden border border-white/10 bg-[#07080c]" style={{ aspectRatio: "1 / 1" }}>
                  <TalismanSvg spec={item} frame={TALISMAN_FRAMES[2]!} uid={`thumb-${item.id}`} />
                </div>
                <p className="mt-2 text-[11px] tracking-[0.12em] text-white/70">{item.title}</p>
                <p className="text-[10px] leading-relaxed text-white/35">{item.note}</p>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
