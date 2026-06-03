import Link from "next/link";
import { Coins } from "lucide-react";

const DEFAULT_CLASS =
  "inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-[#131c35] px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:border-cyan-400/50 hover:bg-[#1a2648]";

/** Header link to credits page — icon only (no balance number). */
export function ModuleCreditsLink({ className }: { className?: string }) {
  return (
    <Link href="/modes/credits" aria-label="Credits" className={className ?? DEFAULT_CLASS}>
      <Coins className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </Link>
  );
}
