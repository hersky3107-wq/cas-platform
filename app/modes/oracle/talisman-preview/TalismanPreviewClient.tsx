"use client";

import { useState } from "react";
import Link from "next/link";
import { TalismanSvg } from "./TalismanSvg";
import { TALISMAN_FRAMES, TALISMAN_VARIANTS, type FrameSpec, type TalismanSpec } from "./variants";

function FrameCard({ spec, frame }: { spec: TalismanSpec; frame: FrameSpec }) {
  const height = frame.id === "phone" ? 520 : frame.id === "wallet" ? 430 : frame.id === "square" ? 280 : 188;
  const width = Math.round(height * frame.aspect);
  return (
    <figure className="flex min-w-0 flex-col items-center">
      <div
        className="overflow-hidden border border-white/10 bg-[#07080c]"
        style={{ width, height }}
      >
        <TalismanSvg spec={spec} frame={frame} uid={`crop-${spec.id}-${frame.id}`} />
      </div>
      <figcaption className="mt-2 flex w-full items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium tracking-[0.18em] text-white/70 uppercase">
          {frame.label}
        </span>
        <span className="text-[10px] tracking-[0.16em] text-white/35">{frame.sub}</span>
      </figcaption>
    </figure>
  );
}

export default function TalismanPreviewClient() {
  const [active, setActive] = useState(0);
  const spec = TALISMAN_VARIANTS[active] ?? TALISMAN_VARIANTS[0]!;

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
        <p className="text-[10px] tracking-[0.32em] text-white/40 uppercase">throwaway · no engine</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">부적 preview</h1>
          <Link href="/modes/oracle" className="text-[12px] tracking-[0.14em] text-white/45 hover:text-white/80">
            ← oracle
          </Link>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          SVG only, hard-coded charts. Four crops of one composition, then six value
          variants. This route is disposable.
        </p>

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
        <p className="mt-3 text-sm text-slate-300">{spec.note}</p>

        <section className="mt-8">
          <h2 className="text-[10px] tracking-[0.28em] text-white/40 uppercase">Four crops</h2>
          <div className="mt-4 flex flex-wrap items-end justify-center gap-8">
            {TALISMAN_FRAMES.map((frame) => (
              <FrameCard key={frame.id} spec={spec} frame={frame} />
            ))}
          </div>
        </section>

        <section className="mt-14">
          <h2 className="text-[10px] tracking-[0.28em] text-white/40 uppercase">Six variants · square</h2>
          <div className="mt-4 grid grid-cols-2 gap-5 md:grid-cols-3">
            {TALISMAN_VARIANTS.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActive(index)}
                className="text-left"
              >
                <div className="overflow-hidden border border-white/10 bg-[#07080c]" style={{ aspectRatio: "1 / 1" }}>
                  <TalismanSvg spec={item} frame={TALISMAN_FRAMES[2]!} uid={`thumb-${item.id}`} />
                </div>
                <p className="mt-2 text-[11px] tracking-[0.12em] text-white/70">{item.title}</p>
                <p className="text-[10px] leading-relaxed text-white/35">{item.note}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-14 max-w-3xl border-t border-white/10 pt-6 text-[13px] leading-relaxed text-slate-400">
          <h2 className="text-[10px] tracking-[0.28em] text-white/40 uppercase">Legibility notes</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              Hardest at phone width: 수비 digits on nested polygons, 점성술 Roman house
              numerals, 숙요 27 ticks vs 촐킨 13/20. They become texture, not readable marks.
            </li>
            <li>
              Collisions: PRISM hex vs 낙서 square share the same band — the square sides
              cut the hex. 주역 trigrams vs 육친 seats vs 사주 characters crowd 160–210.
              符膽 spine crosses 일간 and the ASC tick on purpose; at phone size the 財
              glyph on variant 6 collides with ring 5–6.
            </li>
            <li>
              Square avatar crop clips 숙요/촐킨 and the 符頭/符腳. Wallet contains
              everything; phone and 16:9 bleed the grid and outer ticks only.
            </li>
            <li>
              Drain core (variant 3) reads if the hollow ring and outward ticks stay
              emphasis-weight. Fill vs drain collapses if both use the same disc fill.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
