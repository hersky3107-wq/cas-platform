"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default function AboutPage() {
  return (
    <main className="relative min-h-screen bg-[#0a0f1e] text-white">
      <Link
        href="/"
        aria-label="Back to lobby"
        className="absolute left-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
      >
        <ChevronLeft className="h-5 w-5" />
      </Link>

      <div className="flex min-h-screen items-center justify-center px-6">
        <p className="text-white">Coming Soon</p>
      </div>
    </main>
  );
}

