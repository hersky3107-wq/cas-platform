import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseWithToken } from "@/lib/supabase/server-client";
import { supabaseAdmin } from "@/lib/supabase/server";
import { createSupabaseRouteAuthClient } from "@/lib/supabase/route-auth";
import { deductCreditsBalance, getCreditsBalance } from "@/lib/credits";
import { MODEL_BY_PROVIDER, type AiProviderName } from "@/lib/ai/router";
import {
  buildStandupPerformanceOrder,
  COMEDY_PROVIDERS,
  normalizeComedyPriorSets,
  produceStandupSet,
  type ComedyPriorSet,
  type ComedyProvider,
  type ComedyTransportContext,
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

async function runStandupProvider(params: {
  provider: Provider;
  topic: string;
  setIndex: number;
  priorSets: ComedyPriorSet[];
  ctx: ComedyTransportContext;
}): Promise<{ text: string; ms: number }> {
  const line = await produceStandupSet({
    provider: params.provider,
    topic: params.topic,
    setIndex: params.setIndex,
    priorSets: params.priorSets,
    ctx: params.ctx,
  });
  const text = line.ok ? line.content : line.content;
  return { text, ms: line.responseTimeMs };
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const token =
    typeof body.supabaseAccessToken === "string" ? body.supabaseAccessToken : undefined;

  const supabaseAuth = token
    ? createSupabaseWithToken(token)
    : await createSupabaseRouteAuthClient();
  const supabase = supabaseAdmin;
  const {
    data: { user },
    error: authErr,
  } = await supabaseAuth.auth.getUser();
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
    const deduct = await deductCreditsBalance(supabase, user.id, 3);
    if (!deduct.ok) {
      const insufficient = deduct.reason === "insufficient";
      return NextResponse.json(
        {
          error: insufficient ? "크레딧이 부족합니다" : "Could not update credits",
          balance: deduct.balance,
          required: 3,
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
    const provider = order[0]!;
    const ctx: ComedyTransportContext = {
      supabase,
      sessionId,
      userId: user.id,
      supabaseAccessToken: token,
    };

    const { text, ms } = await runStandupProvider({
      provider,
      topic,
      setIndex: 0,
      priorSets: [],
      ctx,
    });

    await insertWithFallback(
      supabase,
      "debate_logs",
      {
        session_id: sessionId,
        role: "assistant",
        ai_name: provider,
        message_text: text,
      },
      {
        session_id: sessionId,
        speaker: provider,
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
      provider,
      text: text.normalize("NFC"),
      ms,
    });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const orderRaw = Array.isArray(body.order) ? body.order : [];
  const idxRaw = typeof body.index === "number" ? body.index : Number(body.index);
  const index = Number.isFinite(idxRaw) ? Math.floor(idxRaw) : -1;
  if (!sessionId || index < 0 || index >= PROVIDERS.length - 1) {
    return NextResponse.json({ error: "Invalid sessionId/index" }, { status: 400 });
  }
  const order: Provider[] = [];
  for (const x of orderRaw) {
    const p = normalizeProvider(x);
    if (p) order.push(p);
  }
  if (order.length !== PROVIDERS.length) {
    return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  }

  const priorSets = normalizeComedyPriorSets(body.priorSets);
  const nextIndex = index + 1;
  const provider = order[nextIndex]!;
  const ctx: ComedyTransportContext = {
    supabase,
    sessionId,
    userId: user.id,
    supabaseAccessToken: token,
  };

  const { text, ms } = await runStandupProvider({
    provider,
    topic,
    setIndex: nextIndex,
    priorSets,
    ctx,
  });

  await insertWithFallback(
    supabase,
    "debate_logs",
    {
      session_id: sessionId,
      role: "assistant",
      ai_name: provider,
      message_text: text,
    },
    {
      session_id: sessionId,
      speaker: provider,
      content: text,
    }
  );

  return NextResponse.json({
    ok: true,
    sessionId,
    topic,
    order,
    index: nextIndex,
    provider,
    text: text.normalize("NFC"),
    ms,
  });
}
