import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseWithToken } from "@/lib/supabase/server-client";
import { supabaseAdmin } from "@/lib/supabase/server";
import { createSupabaseRouteAuthClient } from "@/lib/supabase/route-auth";
import { deductCreditsBalance, getCreditsBalance } from "@/lib/credits";
import { MODEL_BY_PROVIDER, runSingleAiProvider, type AiProviderName } from "@/lib/ai/router";

type Provider = AiProviderName;

const PROVIDERS: Provider[] = ["openai", "anthropic", "google", "xai", "deepseek", "mistral"];

const formatPools = {
  grok: [
    `You tell a raw, specific story that feels like it actually happened. 
     "야 근데 진짜 있었던 일인데..." 로 시작. 
     Details make it real. End with one punchy line.`,

    `You make a dark, absurdist declaration about the topic. 
     Confident. Slightly unhinged. Like you've thought about this 
     way too much at 3am.`,

    `You find the most uncomfortable truth about the topic 
     and state it flatly. No setup. Just drop it and let it sit.`,
  ],

  chatgpt: [
    `You make a universal observation everyone secretly agrees with 
     but never says out loud. "다들 이런 적 있잖아요..." 로 시작. 
     Relatable to anyone anywhere.`,

    `You build a perfectly logical argument that leads to 
     a completely absurd conclusion. Treat the absurd as obvious.`,

    `You tell a short story with a twist ending. 
     Setup feels normal. Last line flips everything.`,
  ],

  claude: [
    `You make a painfully self-aware observation about yourself 
     in relation to the topic. Slightly awkward. 
     End with something unexpectedly profound that undercuts itself.`,

    `You start confidently, then mid-sentence realize something 
     terrible about yourself. The realization IS the joke.`,

    `You give sincere, heartfelt advice about the topic 
     that is completely wrong in a very specific way.`,
  ],

  gemini: [
    `You propose a completely unhinged solution to the topic 
     as if it's the most logical thing in the world. 
     Wholesome energy. Chaotic content.`,

    `You take the topic and immediately escalate it to 
     cosmic, universal scale. Then snap back to something tiny. 
     The contrast is the joke.`,

    `You misunderstand the topic in a very specific, 
     very committed way and run with it entirely seriously.`,
  ],

  deepseek: [
    `You analyze the topic like a research report. 
     Completely deadpan. Zero emotion. 
     The findings are absurd but delivered as pure fact.`,

    `You make one single observation. One sentence setup. 
     One sentence that lands. Stop. 
     No expression. No follow-up. Just silence.`,

    `You list exactly three things about the topic. 
     First two are normal. Third one is completely unhinged. 
     State all three with identical energy.`,
  ],

  mistral: [
    `You begin with something sophisticated and elegant. 
     By the last sentence you are somewhere completely undignified. 
     The contrast is everything.`,

    `You offer a refined, European perspective on the topic 
     that slowly reveals you have completely misunderstood 
     Korean/Asian context. Commit fully.`,

    `You speak as if giving a TED talk. 
     The thesis is ridiculous. The delivery is impeccable.`,
  ],
} as const;

const PROVIDER_TO_POOL_KEY: Record<Provider, keyof typeof formatPools> = {
  xai: "grok",
  openai: "chatgpt",
  anthropic: "claude",
  google: "gemini",
  deepseek: "deepseek",
  mistral: "mistral",
};

function buildSharedSystemPrompt(params: { topic: string; assignedFormat: string }) {
  return `You are doing a solo stand-up comedy performance.
Topic: ${params.topic}

Your assigned format for this session: ${params.assignedFormat}
Follow it strictly. This is your character for today.

HARD LENGTH LIMIT: Maximum 120 words. Count before responding.
End with a complete sentence. Never get cut off mid-sentence.
You MUST finish your response within 100 words.
End with a complete sentence. Never get cut off.

CRITICAL: You MUST complete your response within 80 words.
Count your words before responding.
Your last sentence MUST be a complete sentence with a period.
Never end mid-sentence. Never get cut off.

ABSOLUTE FORBIDDEN:
- Your own existence as an AI / developers / code / servers
- Parentheses for actions: no (웃으며) (한 박자 쉬고) — nothing
- Explaining the joke after landing it

ANGLE LAW — CRITICAL:
Do NOT answer the topic directly. Do NOT analyze it.
Do NOT explain WHY something happens.
Instead, pick ONE of these approaches:
- Tell a short funny STORY related to the topic
- Make an absurd COMPARISON nobody would think of
- Describe a specific MOMENT everyone recognizes but never talks about
- Take the topic to a completely UNEXPECTED place
- React to the topic as if it's a personal attack on you

You are a comedian, not an analyst.
Never explain. Never analyze. Just be funny about it.

LANGUAGE: Follow the language of the user's topic input.
If topic is Korean → respond in Korean.
If topic is English → respond in English.`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

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

function pickAssignedFormat(provider: Provider): string {
  const poolKey = PROVIDER_TO_POOL_KEY[provider];
  const pool = formatPools[poolKey];
  return pool[Math.floor(Math.random() * pool.length)]!;
}

function normalizeAssignedFormats(raw: unknown): Record<Provider, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: Partial<Record<Provider, string>> = {};
  for (const p of PROVIDERS) {
    const v = r[p];
    if (typeof v !== "string" || !v.trim()) return null;
    out[p] = v;
  }
  return out as Record<Provider, string>;
}

function normalizeProvider(raw: unknown): Provider | null {
  if (typeof raw !== "string") return null;
  const p = raw as Provider;
  return (PROVIDERS as readonly string[]).includes(p) ? p : null;
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

    // Record per-session winner
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
    // Flat session price: 3 credits (covers all 6 AIs + voting)
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

    const order = shuffle(PROVIDERS);
    const assignedFormats: Record<Provider, string> = {
      openai: pickAssignedFormat("openai"),
      anthropic: pickAssignedFormat("anthropic"),
      google: pickAssignedFormat("google"),
      xai: pickAssignedFormat("xai"),
      deepseek: pickAssignedFormat("deepseek"),
      mistral: pickAssignedFormat("mistral"),
    };
    const provider = order[0]!;
    const userPrompt = `Topic: ${topic}\nStart your stand-up bit now.`;

    const res = await runSingleAiProvider({
      supabase,
      sessionId,
      userId: user.id,
      provider,
      systemPrompt: buildSharedSystemPrompt({ topic, assignedFormat: assignedFormats[provider] }),
      prompt: userPrompt,
      supabaseAccessToken: token,
      maxCompletionTokens: 200,
      temperature: provider === "anthropic" ? undefined : 0.9,
      aiResponseExtras: { standup_index: 0 },
    });

    await insertWithFallback(
      supabase,
      "debate_logs",
      {
        session_id: sessionId,
        role: "assistant",
        ai_name: provider,
        message_text: res.text ?? res.error ?? "",
      },
      {
        session_id: sessionId,
        speaker: provider,
        content: res.text ?? res.error ?? "",
      }
    );

    return NextResponse.json({
      ok: true,
      sessionId,
      topic,
      order,
      assignedFormats,
      creditsRemaining,
      index: 0,
      provider,
      text: (res.text ?? res.error ?? "").normalize("NFC"),
      ms: res.responseTimeMs,
    });
  }

  // next
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const orderRaw = Array.isArray(body.order) ? body.order : [];
  const assignedFormats = normalizeAssignedFormats(body.assignedFormats);
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
  if (!assignedFormats) {
    return NextResponse.json({ error: "Invalid assignedFormats" }, { status: 400 });
  }

  const nextIndex = index + 1;
  const provider = order[nextIndex]!;
  const userPrompt = `Topic: ${topic}\nStart your stand-up bit now.`;

  const res = await runSingleAiProvider({
    supabase,
    sessionId,
    userId: user.id,
    provider,
    systemPrompt: buildSharedSystemPrompt({ topic, assignedFormat: assignedFormats[provider] }),
    prompt: userPrompt,
    supabaseAccessToken: token,
    maxCompletionTokens: 200,
    temperature: provider === "anthropic" ? undefined : 0.9,
    aiResponseExtras: { standup_index: nextIndex },
  });

  await insertWithFallback(
    supabase,
    "debate_logs",
    {
      session_id: sessionId,
      role: "assistant",
      ai_name: provider,
      message_text: res.text ?? res.error ?? "",
    },
    {
      session_id: sessionId,
      speaker: provider,
      content: res.text ?? res.error ?? "",
    }
  );

  return NextResponse.json({
    ok: true,
    sessionId,
    topic,
    order,
    assignedFormats,
    index: nextIndex,
    provider,
    text: (res.text ?? res.error ?? "").normalize("NFC"),
    ms: res.responseTimeMs,
  });
}

