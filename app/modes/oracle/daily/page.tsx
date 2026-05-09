"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

type ReaderSlot = "deepseek" | "google" | "anthropic" | "openai";

const AI_LABEL: Record<ReaderSlot, string> = {
  deepseek: "DeepSeek",
  google: "Gemini",
  anthropic: "Claude",
  openai: "ChatGPT",
};

const AI_BORDER: Record<ReaderSlot, string> = {
  deepseek: "#4D6BFE",
  google: "#4285F4",
  anthropic: "#D97757",
  openai: "#10A37F",
};

function Badge({ slot }: { slot: ReaderSlot }) {
  const base = "inline-flex rounded-lg px-2.5 py-0.5 text-xs font-bold sm:text-sm";
  if (slot === "openai") return <span className={`${base} bg-[#0a2540] text-white`}>{AI_LABEL.openai}</span>;
  if (slot === "anthropic") return <span className={`${base} bg-[#F5E6D3] text-[#3d2914]`}>{AI_LABEL.anthropic}</span>;
  if (slot === "google") return <span className={`${base} bg-[#0d1117] text-white`}>{AI_LABEL.google}</span>;
  return <span className={`${base} bg-[#1a1464] text-white`}>{AI_LABEL.deepseek}</span>;
}

function fmtDate(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const fmt = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric" });
  return fmt.format(d);
}

type NdMeta = {
  type: "meta";
  sessionId: string;
  creditsRemaining: number;
  cost: number;
  today: string;
  tarot: { id: number; name: string; src: string };
  western_chart: { sunSign: string; moonSign: string; risingSign: string };
};

type NdReader = {
  type: "reader_result";
  slot: ReaderSlot;
  text: string | null;
  error: string | null;
};

type NdSynth = { type: "synthesis"; text: string | null };
type NdError = { type: "error"; error: string };
type NdDone = { type: "done" };

export default function OracleDailyPage() {
  const router = useRouter();
  const [meta, setMeta] = useState<NdMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [readers, setReaders] = useState<Map<ReaderSlot, string>>(new Map());
  const [synth, setSynth] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/oracle/profile").catch(() => null);
      if (!res?.ok || cancelled) return;
      const j = (await res.json().catch(() => null)) as { complete?: boolean; profile?: unknown | null };
      const hasProfile = j?.profile != null && typeof j.profile === "object";
      if ((!hasProfile || !j?.complete) && !cancelled) router.replace("/modes/oracle/profile");
    })();
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRunning(true);
      setErr(null);
      setReaders(new Map());
      setSynth(null);
      setMeta(null);

      const res = await fetch("/api/oracle/daily", { method: "POST" }).catch(() => null);
      if (!res || cancelled) return;
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string };
        setErr(j?.error ?? "Request failed");
        setRunning(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setErr("No response body");
        setRunning(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          let msg: any;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg?.type === "meta") setMeta(msg as NdMeta);
          if (msg?.type === "reader_result") {
            const m = msg as NdReader;
            setReaders((prev) => new Map(prev).set(m.slot, m.text ?? m.error ?? ""));
          }
          if (msg?.type === "synthesis") setSynth((msg as NdSynth).text ?? null);
          if (msg?.type === "error") setErr((msg as NdError).error ?? "Error");
          if (msg?.type === "done") setRunning(false);
        }
      }
      setRunning(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className={BG}>
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 pb-28 pt-8 sm:px-8 lg:pb-24">
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <Link
            href="/modes/oracle"
            className="inline-flex items-center gap-1 text-sm text-cyan-200/90 hover:text-cyan-100"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden /> Oracle lobby
          </Link>
          {meta?.creditsRemaining != null ? (
            <span className="rounded-full bg-[#131c35] px-3 py-1 text-xs font-medium text-slate-200">
              Credits: {meta.creditsRemaining}
            </span>
          ) : null}
        </div>

        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Today&apos;s Fortune
        </h1>
        <p className="mt-2 text-sm text-slate-300">
          {meta?.today ? fmtDate(meta.today) : ""}
        </p>

        {err ? (
          <p className="mt-6 rounded-2xl border border-rose-500/40 bg-rose-950/35 px-4 py-3 text-sm text-rose-100">
            {err}
          </p>
        ) : null}

        {meta?.tarot ? (
          <section className="mt-10 flex flex-col items-center">
            <div className="text-[11px] font-medium uppercase tracking-[0.26em] text-white/55">
              Today&apos;s Tarot Card
            </div>
            <div className="mt-4 relative h-[245px] w-[140px] overflow-hidden rounded-[8px] border border-white/10 bg-[#1a1a2e] shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
              <Image src={meta.tarot.src} alt={meta.tarot.name} fill className="object-contain" sizes="140px" />
            </div>
            <div className="mt-3 text-lg font-semibold text-white">{meta.tarot.name}</div>
            {meta?.today ? (
              <div className="mt-2 rounded-full border border-white/10 bg-[#131c35] px-3 py-1 text-xs font-medium text-slate-200">
                {fmtDate(meta.today)}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="mt-12 space-y-4">
          {([
            { slot: "deepseek" as const, title: "Saju" },
            { slot: "google" as const, title: "Astrology" },
            { slot: "anthropic" as const, title: "Tarot" },
          ] as const).map((x) => (
            <article
              key={x.slot}
              className="rounded-[18px] border border-solid bg-[#0e1528]/90 p-4 sm:p-5"
              style={{ borderColor: `${AI_BORDER[x.slot]}55` }}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge slot={x.slot} />
                <span className="text-[11px] text-white/35">{x.title}</span>
                {running && !readers.get(x.slot) ? (
                  <span className="animate-pulse text-[11px] text-white/40">thinking…</span>
                ) : null}
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                {readers.get(x.slot) ?? ""}
              </div>
            </article>
          ))}

          {synth || running ? (
            <article
              className="rounded-[18px] border border-solid bg-[#0e1528]/90 p-4 sm:p-5"
              style={{ borderColor: `${AI_BORDER.openai}55` }}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge slot="openai" />
                <span className="text-sm font-semibold text-white/80">Synthesis</span>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                {synth ?? (running ? "Composing weave…" : "")}
              </div>
            </article>
          ) : null}
        </section>
      </div>
    </main>
  );
}

