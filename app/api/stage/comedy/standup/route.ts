import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/server";
import { resolveRouteAuth } from "@/lib/supabase/route-auth";
import { creditsForComedyStandup } from "@/lib/credits";
import { deductCreditsBalance, getCreditsBalance } from "@/lib/credits-server";
import { MODEL_BY_PROVIDER, runSingleAiProvider } from "@/lib/ai/router";
import {
  buildComedySystemPrompt,
  buildComedyTalkLanguagePrefix,
  buildStandupPerformanceOrder,
  COMEDY_LABEL,
  COMEDY_PROVIDERS,
  normalizeComedyPriorSets,
  STANDUP_PERFORMANCE_COUNT,
  STANDUP_TURN_COUNT,
  type ComedyPriorSet,
  type ComedyProvider,
  type ComedyTransportContext,
  type StandupPerformanceSlot,
} from "@/lib/ai/comedy-engine";

type Provider = ComedyProvider;

const PROVIDERS: Provider[] = [...COMEDY_PROVIDERS];

async function insertWithFallback(
  supabase: SupabaseClient,
  table: string,
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
) {
  const a = await supabase.from(table).insert([primary]);
  if (!a.error) return;
  const b = await supabase.from(table).insert([fallback]);
  if (b.error) console.warn(`[standup] ${table} insert:`, a.error.message, b.error.message);
}

async function createStandupSession(supabase: SupabaseClient, topic: string) {
  const primary = { mode: "standup", title: "STAGE — STAND-UP", prompt: topic };
  const fallback = { mode: "standup", prompt: topic };
  const ins = await supabase.from("sessions").insert([primary]).select().single();
  if (!ins.error && ins.data?.id) return ins.data.id as string;
  const ins2 = await supabase.from("sessions").insert([fallback]).select().single();
  if (ins2.error || !ins2.data?.id) {
    throw new Error(ins2.error?.message ?? "Could not start session");
  }
  return ins2.data.id as string;
}

async function insertUserDebateEntry(supabase: SupabaseClient, sessionId: string, prompt: string) {
  const a = await supabase
    .from("debate_logs")
    .insert([{ session_id: sessionId, role: "user", message_text: prompt }]);
  if (!a.error) return;
  const b = await supabase
    .from("debate_logs")
    .insert([{ session_id: sessionId, content: prompt, speaker: "user" }]);
  if (b.error) console.warn("[standup] debate_logs user insert:", b.error.message);
}

function normalizeProvider(raw: unknown): Provider | null {
  if (typeof raw !== "string") return null;
  const p = raw as Provider;
  return (PROVIDERS as readonly string[]).includes(p) ? p : null;
}

function normalizeStandupOrder(raw: unknown): StandupPerformanceSlot[] | null {
  if (!Array.isArray(raw)) return null;
  const slots: StandupPerformanceSlot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const provider = normalizeProvider(r.provider);
    if (!provider) continue;
    const standupTurn = r.standupTurn === 2 ? 2 : 1;
    slots.push({ provider, standupTurn });
  }
  if (slots.length !== STANDUP_PERFORMANCE_COUNT) return null;
  return slots;
}

function formatPriorSetsForStandup(priorSets: ComedyPriorSet[]): string {
  if (!priorSets.length) return "(no prior sets in this session yet)";
  return priorSets
    .map((s) => {
      const turn = s.standupTurn ? ` · round ${s.standupTurn}` : "";
      return `[${COMEDY_LABEL[s.provider]}${turn}] ${s.content}`;
    })
    .join("\n\n");
}

function buildStandupUserPrompt(params: {
  topic: string;
  setIndex: number;
  totalSets: number;
  standupTurn: 1 | 2;
  provider: ComedyProvider;
  priorSets: ComedyPriorSet[];
}): string {
  const { topic, setIndex, totalSets, standupTurn, provider, priorSets } = params;
  const myTurn1 = priorSets.find((s) => s.provider === provider && s.standupTurn === 1);
  const turn2Note =
    standupTurn === 2 && myTurn1
      ? `\nYour turn 1 set (do NOT reuse this angle):\n"${myTurn1.content.slice(0, 400)}"\n`
      : standupTurn === 2
        ? "\nTurn 2: fresh material only — different aspect of the topic.\n"
        : "";
  return [
    `Topic: ${topic}`,
    ``,
    `Show round ${standupTurn} of ${STANDUP_TURN_COUNT}.`,
    `Your performance ${setIndex + 1} of ${totalSets} in this show.`,
    turn2Note,
    `Other comedians' sets this session (optional material — you owe them nothing):`,
    formatPriorSetsForStandup(priorSets),
    ``,
    `Deliver your stand-up (8-12 lines minimum, follow STRUCTURE, strongest line last, then STOP):`,
  ].join("\n");
}

function stripTurnPrefixFromModelOutput(raw: string): string {
  const t = String(raw ?? "").replace(/\r\n/g, "\n").trimStart();
  const removed = t.replace(/^\s*\[TURN[^\]]*\]\s*/i, "");
  return removed.replace(/^\s*\[TURN[^\]]*\][^\n]*\n/i, "").trim();
}

function clampToMaxSentences(raw: string, maxSentences: number): string {
  const t = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!t) return t;
  const parts = t.split(/(?<=[.!?。！？…])\s+|\n+/).filter((x) => x.trim().length > 0);
  if (parts.length <= maxSentences) return t;
  return parts.slice(0, maxSentences).join(" ").trim();
}

function isFailedStandupContent(content: string): boolean {
  const t = content.trim();
  if (!t) return true;
  if (t.startsWith("[No response]")) return true;
  if (t.startsWith("[Call failed]")) return true;
  return false;
}

async function runStandupProvider(params: {
  slot: StandupPerformanceSlot;
  topic: string;
  setIndex: number;
  priorSets: ComedyPriorSet[];
  ctx: ComedyTransportContext;
  standupLanguagePrefix: string;
}): Promise<{ text: string; ms: number }> {
  const { slot, topic, setIndex, priorSets, ctx, standupLanguagePrefix } = params;
  const provider = slot.provider;
  const standupTurn = slot.standupTurn;
  const baseSystemPrompt = buildComedySystemPrompt("standup", provider, standupTurn);
  const systemPrompt = `${standupLanguagePrefix}${baseSystemPrompt}`;
  const userPrompt = buildStandupUserPrompt({
    topic,
    setIndex,
    totalSets: STANDUP_PERFORMANCE_COUNT,
    standupTurn,
    provider,
    priorSets,
  });
  const maxCompletionTokens = provider === "anthropic" ? 900 : 720;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await runSingleAiProvider({
      supabase: ctx.supabase,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      provider,
      prompt: userPrompt,
      systemPrompt,
      skipLanguageInjection: true,
      supabaseAccessToken: ctx.supabaseAccessToken,
      maxCompletionTokens,
      temperature: provider === "anthropic" ? undefined : 0.9,
      modelOverride: MODEL_BY_PROVIDER[provider],
      aiResponseExtras: {
        round: setIndex + 1,
        comedy_mode: "standup",
      },
    });

    const raw = res.text ?? res.error ?? "[No response]";
    const content = clampToMaxSentences(stripTurnPrefixFromModelOutput(raw), 12);
    if (!isFailedStandupContent(content)) {
      return { text: content, ms: res.responseTimeMs };
    }
  }

  return { text: "[Call failed]", ms: 0 };
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const { user, error: authErr, accessToken } = await resolveRouteAuth(req, body);
  const supabase = supabaseAdmin;
  if (authErr || !user) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  if (action === "vote") {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const provider = normalizeProvider(body.provider);
    if (!sessionId || !provider) {
      return NextResponse.json({ error: "sessionId and provider are required" }, { status: 400 });
    }

    const primary: Record<string, unknown> = {
      session_id: sessionId,
      ai_provider: provider,
      vote_type: "funny",
      created_at: new Date().toISOString(),
    };
    const fallback: Record<string, unknown> = {
      session_id: sessionId,
      user_id: user.id,
      voted_ai_provider: provider,
      vote_choice: "funny",
      category: "standup_final_vote_funny",
    };
    await insertWithFallback(supabase, "votes", primary, fallback);

    await insertWithFallback(
      supabase,
      "session_results",
      {
        session_id: sessionId,
        winner_ai: provider,
        category: "standup_winner",
        score: 1,
      },
      {
        session_id: sessionId,
        winner: provider,
        category: "standup_winner",
      }
    );

    return NextResponse.json({ ok: true, winner: provider });
  }

  if (action !== "start" && action !== "next") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) return NextResponse.json({ error: "topic is required" }, { status: 400 });

  if (action === "start") {
    const standupCost = creditsForComedyStandup();
    const deduct = await deductCreditsBalance(supabase, user.id, standupCost, 'stage_standup');
    if (!deduct.ok) {
      const insufficient = deduct.reason === "insufficient";
      return NextResponse.json(
        {
          error: insufficient ? "크레딧이 부족합니다" : "Could not update credits",
          balance: deduct.balance,
          required: standupCost,
        },
        { status: insufficient ? 402 : 500 }
      );
    }
    const creditsRemaining = await getCreditsBalance(supabase, user.id);

    const sessionId = await createStandupSession(supabase, topic);
    await insertUserDebateEntry(supabase, sessionId, topic);

    for (const p of PROVIDERS) {
      const { error } = await supabase.from("session_participants").insert([
        { session_id: sessionId, ai_name: p, model_name: MODEL_BY_PROVIDER[p] },
      ]);
      if (error) console.warn("[standup] session_participants:", error.message);
    }

    const order = buildStandupPerformanceOrder();
    const slot = order[0]!;
    const standupLanguagePrefix = buildComedyTalkLanguagePrefix(topic);
    const ctx: ComedyTransportContext = {
      supabase,
      sessionId,
      userId: user.id,
      supabaseAccessToken: accessToken ?? undefined,
    };

    const { text, ms } = await runStandupProvider({
      slot,
      topic,
      setIndex: 0,
      priorSets: [],
      ctx,
      standupLanguagePrefix,
    });

    await insertWithFallback(
      supabase,
      "debate_logs",
      {
        session_id: sessionId,
        role: "assistant",
        ai_name: slot.provider,
        message_text: text,
      },
      {
        session_id: sessionId,
        speaker: slot.provider,
        content: text,
      }
    );

    return NextResponse.json({
      ok: true,
      sessionId,
      topic,
      order,
      creditsRemaining,
      index: 0,
      provider: slot.provider,
      standupTurn: slot.standupTurn,
      text: text.normalize("NFC"),
      ms,
    });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const orderRaw = Array.isArray(body.order) ? body.order : [];
  const idxRaw = typeof body.index === "number" ? body.index : Number(body.index);
  const index = Number.isFinite(idxRaw) ? Math.floor(idxRaw) : -1;
  if (!sessionId || index < 0 || index >= STANDUP_PERFORMANCE_COUNT - 1) {
    return NextResponse.json({ error: "Invalid sessionId/index" }, { status: 400 });
  }
  const order = normalizeStandupOrder(orderRaw);
  if (!order) {
    return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  }

  const priorSets = normalizeComedyPriorSets(body.priorSets);
  const nextIndex = index + 1;
  const slot = order[nextIndex]!;
  const standupLanguagePrefix = buildComedyTalkLanguagePrefix(topic);
  const ctx: ComedyTransportContext = {
    supabase,
    sessionId,
    userId: user.id,
    supabaseAccessToken: accessToken ?? undefined,
  };

  const { text, ms } = await runStandupProvider({
    slot,
    topic,
    setIndex: nextIndex,
    priorSets,
    ctx,
    standupLanguagePrefix,
  });

  await insertWithFallback(
    supabase,
    "debate_logs",
    {
      session_id: sessionId,
      role: "assistant",
      ai_name: slot.provider,
      message_text: text,
    },
    {
      session_id: sessionId,
      speaker: slot.provider,
      content: text,
    }
  );

  return NextResponse.json({
    ok: true,
    sessionId,
    topic,
    order,
    index: nextIndex,
    provider: slot.provider,
    standupTurn: slot.standupTurn,
    text: text.normalize("NFC"),
    ms,
  });
}
