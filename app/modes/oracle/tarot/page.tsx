"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { creditsForOracleTarotSpread, type OracleTarotSpreadKey } from "@/lib/credits";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

type SpreadKey = OracleTarotSpreadKey;

const SPREADS: Array<{
  key: SpreadKey;
  title: string;
  subtitle: string;
  cost: number;
  count: number;
}> = [
  {
    key: "one",
    title: "1 card",
    subtitle: "Today's Card",
    cost: creditsForOracleTarotSpread("one"),
    count: 1,
  },
  {
    key: "three",
    title: "3 cards",
    subtitle: "Past · Present · Future",
    cost: creditsForOracleTarotSpread("three"),
    count: 3,
  },
  {
    key: "five",
    title: "5 cards",
    subtitle: "Five Card Spread",
    cost: creditsForOracleTarotSpread("five"),
    count: 5,
  },
  {
    key: "celtic",
    title: "10 cards",
    subtitle: "Celtic Cross",
    cost: creditsForOracleTarotSpread("celtic"),
    count: 10,
  },
];

const POSITIONS: Record<SpreadKey, string[]> = {
  one: ["Today's message"],
  three: ["Past", "Present", "Future"],
  five: ["Situation", "Obstacle", "Advice", "External", "Outcome"],
  celtic: [
    "The Present",
    "The Challenge",
    "The Past",
    "The Future",
    "Above (Conscious)",
    "Below (Unconscious)",
    "Advice",
    "External Influences",
    "Hopes and Fears",
    "Outcome",
  ],
};

type DeckCard = { id: number; name: string; src: string };

type ReaderSlot = "anthropic" | "google" | "mistral" | "openai";
const READER_ORDER: ReaderSlot[] = ["anthropic", "google", "mistral"];

const AI_LABEL: Record<ReaderSlot, string> = {
  anthropic: "Claude",
  google: "Gemini",
  mistral: "Mistral",
  openai: "ChatGPT",
};

const AI_BORDER: Record<ReaderSlot, string> = {
  anthropic: "#D97757",
  google: "#4285F4",
  mistral: "#FF7000",
  openai: "#10A37F",
};

function Badge({ slot }: { slot: ReaderSlot }) {
  const base = "inline-flex rounded-lg px-2.5 py-0.5 text-xs font-bold sm:text-sm";
  if (slot === "openai") return <span className={`${base} bg-[#0a2540] text-white`}>{AI_LABEL.openai}</span>;
  if (slot === "anthropic") return <span className={`${base} bg-[#F5E6D3] text-[#3d2914]`}>{AI_LABEL.anthropic}</span>;
  if (slot === "google") return <span className={`${base} bg-[#0d1117] text-white`}>{AI_LABEL.google}</span>;
  return <span className={`${base} bg-[#FF7000] text-white`}>{AI_LABEL.mistral}</span>;
}

function tarotBack() {
  return (
    <svg
      viewBox="0 0 100 170"
      className="h-full w-full overflow-hidden rounded-xl border border-white/10"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="tarotBg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1a0533" />
          <stop offset="100%" stopColor="#0d1b4b" />
        </linearGradient>

        <pattern id="tarotDiamonds" width="10" height="10" patternUnits="userSpaceOnUse">
          <path
            d="M5 1 L9 5 L5 9 L1 5 Z"
            fill="none"
            stroke="#c9a84c"
            strokeOpacity="0.14"
            strokeWidth="0.7"
          />
        </pattern>

        <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* background */}
      <rect x="0" y="0" width="100" height="170" fill="url(#tarotBg)" />
      <rect x="0" y="0" width="100" height="170" fill="url(#tarotDiamonds)" opacity="0.55" />

      {/* double ornate border */}
      <rect x="5" y="5" width="90" height="160" rx="8" fill="none" stroke="#c9a84c" strokeWidth="1.6" />
      <rect x="9" y="9" width="82" height="152" rx="7" fill="none" stroke="#c9a84c" strokeOpacity="0.65" strokeWidth="1.1" />

      {/* corner ornaments */}
      {[
        { x: 12, y: 12, r: 0 },
        { x: 88, y: 12, r: 90 },
        { x: 88, y: 158, r: 180 },
        { x: 12, y: 158, r: 270 },
      ].map((c, i) => (
        <g key={i} transform={`translate(${c.x} ${c.y}) rotate(${c.r})`} stroke="#c9a84c" strokeOpacity="0.9" fill="none">
          <path d="M0 0 C6 0 8 2 8 8" strokeWidth="1.3" />
          <path d="M0 0 C4 0 6 1.5 6 6" strokeWidth="0.9" strokeOpacity="0.7" />
          <circle cx="8" cy="8" r="1.2" fill="#c9a84c" />
        </g>
      ))}

      {/* central 8-point star / mandala */}
      <g transform="translate(50 87)" filter="url(#softGlow)">
        <circle r="18" fill="none" stroke="#c9a84c" strokeOpacity="0.5" strokeWidth="1.2" />
        <circle r="10" fill="none" stroke="#c9a84c" strokeOpacity="0.75" strokeWidth="1" />
        <g stroke="#c9a84c" strokeWidth="1.4" strokeLinecap="round">
          {Array.from({ length: 8 }).map((_, i) => (
            <line
              key={i}
              x1="0"
              y1="-22"
              x2="0"
              y2="-6"
              transform={`rotate(${i * 45})`}
              opacity={i % 2 === 0 ? 0.95 : 0.6}
            />
          ))}
        </g>
        <path
          d="M0,-26 L4,-14 L16,-16 L8,-6 L14,6 L0,0 L-14,6 L-8,-6 L-16,-16 L-4,-14 Z"
          fill="none"
          stroke="#c9a84c"
          strokeWidth="1.2"
          strokeOpacity="0.85"
        />
        <circle r="2.2" fill="#c9a84c" />
      </g>

      {/* moon & sun */}
      <g transform="translate(50 22)">
        <path
          d="M7 0 A7 7 0 1 1 7 14 A5 5 0 1 0 7 0 Z"
          fill="#c9a84c"
          opacity="0.85"
        />
      </g>
      <g transform="translate(50 150)" stroke="#c9a84c" strokeOpacity="0.9" fill="none">
        <circle r="5.5" strokeWidth="1.2" />
        {Array.from({ length: 12 }).map((_, i) => (
          <line
            key={i}
            x1="0"
            y1="-9"
            x2="0"
            y2="-13"
            strokeWidth="1.1"
            transform={`rotate(${i * 30})`}
          />
        ))}
      </g>
    </svg>
  );
}

function CelticCrossLayout(props: {
  drawn: Array<{ position: string; card: DeckCard }>;
}) {
  const c = props.drawn;
  // Positions 1-6: cross; 7-10: staff.
  const box = (i: number, extra?: string) => {
    const p = c[i];
    if (!p) return null;
    return (
      <div className={`rounded-xl border border-white/10 bg-black/30 p-2 ${extra ?? ""}`}>
        <div className="text-[11px] text-white/45">{p.position}</div>
        <div className="mt-2 flex justify-center">
          <div className="relative h-[280px] w-[160px] overflow-hidden rounded-[8px] border border-white/10 bg-[#1a1a2e] shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
            <Image
              src={p.card.src}
              alt={p.card.name}
              fill
              sizes="160px"
              className="object-contain"
            />
          </div>
        </div>
        <div className="mt-2 text-[12px] text-white">{p.card.name}</div>
      </div>
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="lg:col-span-8">
        <div className="grid grid-cols-3 gap-4">
          <div className="col-start-2">{box(4)}</div>
          <div className="col-start-1 row-start-2">{box(2)}</div>
          <div className="col-start-2 row-start-2">{box(0)}</div>
          <div className="col-start-3 row-start-2">{box(3)}</div>
          <div className="col-start-2 row-start-3">{box(5)}</div>
          <div className="col-start-2 row-start-4">{box(1)}</div>
        </div>
      </div>
      <div className="lg:col-span-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {box(6)}
          {box(7)}
          {box(8)}
          {box(9)}
        </div>
      </div>
    </div>
  );
}

export default function OracleTarotPage() {
  const [deck, setDeck] = useState<DeckCard[] | null>(null);
  const [phase, setPhase] = useState<"spread" | "pick" | "reading">("spread");
  const [spread, setSpread] = useState<SpreadKey | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [pickedIds, setPickedIds] = useState<number[]>([]);
  const [running, setRunning] = useState(false);
  const [readersOut, setReadersOut] = useState<Map<ReaderSlot, string>>(new Map());
  const [synth, setSynth] = useState<string | null>(null);
  const [drawn, setDrawn] = useState<Array<{ position: string; card: DeckCard }>>([]);

  const needCount = spread ? POSITIONS[spread].length : 0;
  const canRead = spread && pickedIds.length === needCount && !!sessionId && !running;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/tarot/deck.json").catch(() => null);
      if (!res?.ok || cancelled) return;
      const j = (await res.json().catch(() => null)) as { deck?: DeckCard[] };
      if (Array.isArray(j?.deck) && !cancelled) setDeck(j.deck);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const picked = useMemo(() => {
    if (!deck) return [];
    if (!spread) return [];
    return pickedIds.map((id, i) => ({
      position: POSITIONS[spread][i]!,
      card: deck[id]!,
    }));
  }, [deck, pickedIds, spread]);

  async function startSpread(s: SpreadKey) {
    setError(null);
    setSessionId(null);
    setPickedIds([]);
    setReadersOut(new Map());
    setSynth(null);
    setDrawn([]);
    setSpread(s);

    const res = await fetch("/api/oracle/tarot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: "start", spread: s }),
    }).catch(() => null);
    if (!res) {
      setError("Request failed");
      return;
    }
    const j = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      setError(j?.error ?? "Could not start");
      if (typeof j?.balance === "number") setCredits(j.balance);
      return;
    }
    setSessionId(String(j.sessionId));
    if (typeof j.creditsRemaining === "number") setCredits(j.creditsRemaining);
    setPhase("pick");
  }

  async function runReading() {
    if (!spread || !sessionId) return;
    if (!deck) return;
    if (pickedIds.length !== needCount) return;

    setRunning(true);
    setError(null);
    setReadersOut(new Map());
    setSynth(null);
    setDrawn(picked);
    setPhase("reading");

    const res = await fetch("/api/oracle/tarot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: "read",
        spread,
        sessionId,
        cardIds: pickedIds,
        question,
      }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as any;
      setError(j?.error ?? "Request failed");
      setRunning(false);
      return;
    }
    const reader = res.body?.getReader();
    if (!reader) {
      setError("No response body");
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
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg?.type === "reader_result") {
          const slot = msg.slot as ReaderSlot;
          if (slot === "anthropic" || slot === "google" || slot === "mistral") {
            setReadersOut((prev) => new Map(prev).set(slot, msg.text ?? msg.error ?? ""));
          }
        }
        if (msg?.type === "synthesis") {
          setSynth(msg.text ?? null);
        }
        if (msg?.type === "error") {
          setError(msg.error ?? "Error");
        }
      }
    }
    setRunning(false);
  }

  function togglePick(id: number) {
    if (!spread) return;
    if (phase !== "pick") return;
    setError(null);
    setSynth(null);
    setReadersOut(new Map());
    setDrawn([]);

    setPickedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= needCount) return prev;
      return [...prev, id];
    });
  }

  return (
    <main className={BG}>
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 pb-28 pt-8 sm:px-8 lg:pb-24">
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <Link
            href="/modes/oracle"
            className="inline-flex items-center gap-1 text-sm text-cyan-200/90 hover:text-cyan-100"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden /> Oracle lobby
          </Link>
          {typeof credits === "number" ? (
            <span className="rounded-full bg-[#131c35] px-3 py-1 text-xs font-medium text-slate-200">
              Credits: {credits}
            </span>
          ) : null}
        </div>

        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Tarot
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">
          Choose a spread, draw your cards, then receive three readings plus a synthesis.
        </p>

        {error ? (
          <p className="mt-6 rounded-2xl border border-rose-500/40 bg-rose-950/35 px-4 py-3 text-sm text-rose-100">
            {error}
          </p>
        ) : null}

        {phase === "spread" ? (
          <section className="mt-10 grid gap-4 sm:grid-cols-2">
            {SPREADS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => startSpread(s.key)}
                className="rounded-[22px] border border-white/12 bg-[#0e1528]/90 p-5 text-left transition hover:border-white/25 hover:bg-[#101a33]/90"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold text-white">{s.title}</div>
                    <div className="mt-1 text-sm text-slate-300">{s.subtitle}</div>
                  </div>
                  <div className="rounded-xl border border-emerald-400/25 bg-emerald-950/20 px-3 py-1 text-sm font-semibold text-emerald-100">
                    {s.cost} credits
                  </div>
                </div>
              </button>
            ))}
          </section>
        ) : null}

        {phase === "pick" ? (
          <section className="mt-10 space-y-6">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.2em] text-white/55">
                What would you like to know? <span className="text-white/35">(optional)</span>
              </label>
              <textarea
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="w-full resize-y rounded-2xl border border-white/15 bg-black/35 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300/55 focus:outline-none"
                placeholder="What would you like to know?"
              />
              <div className="text-[11px] text-white/40">
                Pick {needCount} card{needCount === 1 ? "" : "s"}.
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              {deck ? (
                deck.map((c) => {
                  const selected = pickedIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => togglePick(c.id)}
                      className="group relative h-[280px] w-[160px] [perspective:900px]"
                      aria-label={c.name}
                    >
                      <div
                        className={`relative h-full w-full rounded-xl transition-transform duration-500 [transform-style:preserve-3d] ${
                          selected ? "[transform:rotateY(180deg)]" : ""
                        }`}
                      >
                        <div className="absolute inset-0 [backface-visibility:hidden]">
                          {tarotBack()}
                        </div>
                        <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] overflow-hidden rounded-[8px] border border-white/10 bg-[#1a1a2e] shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                          <Image
                            src={c.src}
                            alt={c.name}
                            fill
                            sizes="160px"
                            className="object-contain"
                          />
                        </div>
                      </div>
                    </button>
                  );
                })
              ) : (
                <p className="text-sm text-white/60">Loading deck…</p>
              )}
            </div>

            {picked.length ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="text-[11px] font-medium uppercase tracking-[0.26em] text-white/55">
                  Selected
                </div>
                {spread === "celtic" && picked.length === 10 ? (
                  <div className="mt-4">
                    <CelticCrossLayout drawn={picked} />
                  </div>
                ) : (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {picked.map((p) => (
                      <div key={`${p.position}-${p.card.id}`} className="flex items-center gap-3">
                        <div className="relative h-[280px] w-[160px] overflow-hidden rounded-[8px] border border-white/10 bg-[#1a1a2e] shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                          <Image
                            src={p.card.src}
                            alt={p.card.name}
                            fill
                            sizes="160px"
                            className="object-contain"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] text-white/45">{p.position}</div>
                          <div className="truncate text-sm text-white">{p.card.name}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <button
              type="button"
              onClick={runReading}
              disabled={!canRead}
              className="w-full rounded-2xl bg-gradient-to-r from-fuchsia-500 to-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-purple-900/35 hover:brightness-[1.06] disabled:pointer-events-none disabled:opacity-45"
            >
              Read my cards
            </button>
          </section>
        ) : null}

        {phase === "reading" ? (
          <section className="mt-10 space-y-8">
            {drawn.length ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="text-[11px] font-medium uppercase tracking-[0.26em] text-white/55">
                  Your spread
                </div>
                {spread === "celtic" && drawn.length === 10 ? (
                  <div className="mt-4">
                    <CelticCrossLayout drawn={drawn} />
                  </div>
                ) : (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    {drawn.map((p) => (
                      <div key={`${p.position}-${p.card.id}`} className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <div className="text-[11px] text-white/45">{p.position}</div>
                        <div className="mt-2 flex justify-center">
                          <div className="relative h-[280px] w-[160px] overflow-hidden rounded-[8px] border border-white/10 bg-[#1a1a2e] shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                            <Image
                              src={p.card.src}
                              alt={p.card.name}
                              fill
                              sizes="160px"
                              className="object-contain"
                            />
                          </div>
                        </div>
                        <div className="mt-2 text-sm text-white">{p.card.name}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <div className="grid gap-4">
              {READER_ORDER.map((slot) => (
                <article
                  key={slot}
                  className="rounded-[18px] border border-solid bg-[#0e1528]/90 p-4 sm:p-5"
                  style={{ borderColor: `${AI_BORDER[slot]}55` }}
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge slot={slot} />
                    {running && !readersOut.get(slot) ? (
                      <span className="animate-pulse text-[11px] text-white/40">
                        thinking…
                      </span>
                    ) : null}
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
                    {readersOut.get(slot) ?? ""}
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
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

