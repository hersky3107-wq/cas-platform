"use client";

/**
 * Reader/synthesizer brand chip.
 *
 * Brands only — this module must never import the model registry, whose
 * `model` column is server-only. An unlisted brand still renders, just
 * without its accent.
 */
const BRAND_STYLE: Record<string, string> = {
  "Z.ai": "border-violet-300/30 bg-violet-400/10 text-violet-100",
  "Moonshot AI": "border-cyan-300/30 bg-cyan-400/10 text-cyan-100",
  xAI: "border-white/25 bg-white/[0.08] text-white",
  NVIDIA: "border-lime-300/30 bg-lime-400/10 text-lime-100",
  DeepSeek: "border-blue-300/30 bg-blue-400/10 text-blue-100",
  Google: "border-sky-300/30 bg-sky-400/10 text-sky-100",
  OpenAI: "border-emerald-300/30 bg-emerald-400/10 text-emerald-100",
  Anthropic: "border-orange-300/30 bg-orange-400/10 text-orange-100",
  Cohere: "border-teal-300/30 bg-teal-400/10 text-teal-100",
  Meta: "border-blue-400/30 bg-blue-500/10 text-blue-100",
  MiniMax: "border-rose-300/30 bg-rose-400/10 text-rose-100",
  Mistral: "border-amber-300/30 bg-amber-400/10 text-amber-100",
  NAVER: "border-green-300/30 bg-green-400/10 text-green-100",
};

export default function BrandBadge({
  brand,
  size = "md",
}: {
  brand: string;
  size?: "sm" | "md";
}) {
  const scale = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs";
  return (
    <span
      className={`inline-flex rounded-full border font-semibold ${scale} ${
        BRAND_STYLE[brand] ?? "border-white/15 bg-white/5 text-slate-200"
      }`}
    >
      {brand}
    </span>
  );
}
