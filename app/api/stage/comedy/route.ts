import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/server";
import { resolveRouteAuth } from "@/lib/supabase/route-auth";
import { creditsForComedyTalkTurn } from "@/lib/credits";
import { deductCreditsBalance, getCreditsBalance } from "@/lib/credits-server";
import {
  COMEDY_PROVIDERS,
  ensureComedyParticipantsInserted,
  pickComedySpeakerSubset,
  runComedyTurn,
  type ComedyMessage,
  type ComedyProvider,
  type ComedyTransportContext,
} from "@/lib/ai/comedy-engine";

async function insertWithFallback(
  supabase: SupabaseClient,
  table: string,
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
) {
  const primaryRes = await supabase.from(table).insert([primary]);
  if (!primaryRes.error) return { ok: true as const };
  const fallbackRes = await supabase.from(table).insert([fallback]);
  if (!fallbackRes.error) return { ok: true as const };
  return {
    ok: false as const,
    primaryError: primaryRes.error.message,
    fallbackError: fallbackRes.error.message,
  };
}

async function createComedySession(supabase: SupabaseClient) {
  // Prefer new schema fields; fall back to minimal schema (mode/prompt).
  const primary = { mode: "comedy", title: "STAGE — COMEDY", prompt: "" };
  const fallback = { mode: "comedy", prompt: "" };
  const ins = await supabase.from("sessions").insert([primary]).select().single();
  if (!ins.error && ins.data?.id) return ins.data.id as string;

  const ins2 = await supabase.from("sessions").insert([fallback]).select().single();
  if (ins2.error || !ins2.data?.id) {
    throw new Error(ins2.error?.message ?? "Could not start session");
  }
  return ins2.data.id as string;
}

async function insertUserDebateEntry(supabase: SupabaseClient, sessionId: string, prompt: string) {
  const a = await supabase.from("debate_logs").insert([{ session_id: sessionId, role: "user", message_text: prompt }]);
  if (!a.error) return;
  const b = await supabase.from("debate_logs").insert([{ session_id: sessionId, content: prompt, speaker: "user" }]);
  if (b.error) console.warn("[comedy] debate_logs user insert:", b.error.message);
}

function normalizeProvidersList(raw: unknown): ComedyProvider[] {
  if (!Array.isArray(raw)) return [];
  const out: ComedyProvider[] = [];
  for (const x of raw) {
    const p = normalizeProvider(x);
    if (p) out.push(p);
  }
  return Array.from(new Set(out));
}

function normalizeSpeakCounts(raw: unknown): Record<ComedyProvider, number> {
  const base: Record<ComedyProvider, number> = {
    openai: 0,
    anthropic: 0,
    google: 0,
    xai: 0,
    deepseek: 0,
    mistral: 0,
  };
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  for (const p of COMEDY_PROVIDERS) {
    const v = r[p];
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && n >= 0) base[p] = Math.floor(n);
  }
  return base;
}

function normalizeProvider(raw: unknown): ComedyProvider | null {
  if (typeof raw !== "string") return null;
  const p = raw as ComedyProvider;
  return (COMEDY_PROVIDERS as readonly string[]).includes(p) ? p : null;
}

function normalizeHistory(raw: unknown): ComedyMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ComedyMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const provider = normalizeProvider(r.provider);
    const content = typeof r.content === "string" ? r.content : "";
    const turnIndexNum =
      typeof r.turnIndex === "number" ? r.turnIndex : Number(r.turnIndex);
    const orderIndexNum =
      typeof r.orderIndex === "number" ? r.orderIndex : Number(r.orderIndex);
    if (!provider) continue;
    if (!Number.isFinite(turnIndexNum) || turnIndexNum < 1 || turnIndexNum > 4) continue;
    if (!Number.isFinite(orderIndexNum) || orderIndexNum < 0 || orderIndexNum > 99) continue;
    out.push({
      id: typeof r.id === "string" ? r.id : `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      provider,
      content,
      turnIndex: Math.floor(turnIndexNum),
      orderIndex: Math.floor(orderIndexNum),
      responseTimeMs: 0,
    });
  }
  return out;
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
    const voted = normalizeProvider(body.votedAiProvider);
    if (!sessionId || !voted) {
      return NextResponse.json(
        { error: "sessionId and votedAiProvider are required" },
        { status: 400 }
      );
    }

    const primary: Record<string, unknown> = {
      session_id: sessionId,
      user_id: user.id,
      voted_ai_provider: voted,
      created_at: new Date().toISOString(),
    };
    const fallback: Record<string, unknown> = {
      session_id: sessionId,
      user_id: user.id,
      category: "comedy_funny",
      vote_choice: voted,
    };
    const ins = await insertWithFallback(supabase, "votes", primary, fallback);
    if (!ins.ok) {
      console.warn("[comedy] votes insert:", ins.primaryError, ins.fallbackError);
    }

    await insertWithFallback(
      supabase,
      "session_results",
      { session_id: sessionId, winner_ai: voted, category: "comedy_winner", score: 1 },
      { session_id: sessionId, winner: voted, category: "comedy_winner" }
    );
    return NextResponse.json({ ok: true, winner: voted });
  }

  if (action !== "start" && action !== "turn") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  const requestedTurnRaw = typeof body.turnIndex === "number" ? body.turnIndex : Number(body.turnIndex);
  const requestedTurn =
    action === "turn" && Number.isFinite(requestedTurnRaw) ? Math.floor(requestedTurnRaw) : 1;
  const turnIndex: 1 | 2 | 3 | 4 =
    requestedTurn === 2 ? 2 : requestedTurn === 3 ? 3 : requestedTurn === 4 ? 4 : 1;

  const sessionId =
    action === "turn"
      ? (typeof body.sessionId === "string" ? body.sessionId : "")
      : await createComedySession(supabase);

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  await ensureComedyParticipantsInserted({ supabase, sessionId });

  const comedyTurnCost = creditsForComedyTalkTurn();
  if (action === "start" || action === "turn") {
    const deduct = await deductCreditsBalance(supabase, user.id, comedyTurnCost);
    if (!deduct.ok) {
      const insufficient = deduct.reason === "insufficient";
      return NextResponse.json(
        {
          error: insufficient ? "Insufficient credits" : "Could not update credits",
          balance: deduct.balance,
          required: comedyTurnCost,
        },
        { status: insufficient ? 402 : 500 }
      );
    }
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const writeJson = (obj: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`));

      const history: ComedyMessage[] = action === "turn" ? normalizeHistory(body.history) : [];
      const lastTurnSpoke = normalizeProvidersList(body.lastTurnSpoke);
      const speakCounts = normalizeSpeakCounts(body.speakCounts);

      try {
        const creditsRemaining = await getCreditsBalance(supabase, user.id);
        writeJson({ type: "meta", sessionId, action, creditsRemaining });

        const ctx: ComedyTransportContext = {
          supabase,
          sessionId,
          userId: user.id,
          supabaseAccessToken: accessToken ?? undefined,
        };

        if (action === "start") {
          await supabase
            .from("sessions")
            .update({ prompt: topic })
            .eq("id", sessionId);
          await insertUserDebateEntry(supabase, sessionId, topic);
        }

        const selectedProviders = pickComedySpeakerSubset({
          turnIndex,
          lastTurnSpoke,
          speakCounts,
        });
        writeJson({ type: "turn_start", turnIndex, totalTurns: 4, selectedProviders });
        const res = await runComedyTurn({
          turnIndex,
          topic,
          history,
          selectedProviders,
          ctx,
          onThinking: (provider) => {
            writeJson({ type: "thinking", turnIndex, provider });
          },
          onMessage: (m) => {
            writeJson({ type: "message", message: m });
          },
        });
        history.push(...res.messages);
        writeJson({ type: "turn_done", turnIndex, spoke: res.order });
        if (turnIndex >= 4) {
          writeJson({ type: "show_done" });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        writeJson({ type: "error", error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

