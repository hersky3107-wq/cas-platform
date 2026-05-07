import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseWithToken } from "@/lib/supabase/server-client";
import { supabaseAdmin } from "@/lib/supabase/server";
import { createSupabaseRouteAuthClient } from "@/lib/supabase/route-auth";
import { deductCreditsBalance, getCreditsBalance } from "@/lib/credits";
import { MODEL_BY_PROVIDER, type AiProviderName } from "@/lib/ai/router";
import { iterateTaleStories, TALE_LABEL, TALE_PROVIDERS } from "@/lib/ai/tale-engine";

const GENRES = [
  "Horror",
  "Romance",
  "Absurd",
  "Sci-Fi",
  "Fairy Tale",
  "Sad Story",
] as const;

type Genre = (typeof GENRES)[number];

async function insertWithFallback(
  supabase: SupabaseClient,
  table: string,
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
) {
  const a = await supabase.from(table).insert([primary]);
  if (!a.error) return;
  const b = await supabase.from(table).insert([fallback]);
  if (b.error) console.warn(`[tale] ${table} insert:`, a.error.message, b.error.message);
}

async function createTaleSession(supabase: SupabaseClient, genre: string, keyword: string | null) {
  const title = `TALE — ${genre}`;
  const prompt = keyword?.trim() ? `${genre} | ${keyword.trim()}` : genre;
  const primary = { mode: "tale", title, prompt };
  const fallback = { mode: "tale", prompt };
  const ins = await supabase.from("sessions").insert([primary]).select().single();
  if (!ins.error && ins.data?.id) return ins.data.id as string;
  const ins2 = await supabase.from("sessions").insert([fallback]).select().single();
  if (ins2.error || !ins2.data?.id) throw new Error(ins2.error?.message ?? "Could not start session");
  return ins2.data.id as string;
}

function normalizeGenre(raw: unknown): Genre | null {
  if (typeof raw !== "string") return null;
  const g = raw.trim();
  return (GENRES as readonly string[]).includes(g) ? (g as Genre) : null;
}

function normalizeProvider(raw: unknown): AiProviderName | null {
  if (typeof raw !== "string") return null;
  const p = raw as AiProviderName;
  return (TALE_PROVIDERS as readonly string[]).includes(p) ? p : null;
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "generate";
  const token = typeof body.supabaseAccessToken === "string" ? body.supabaseAccessToken : undefined;

  const supabaseAuth = token ? createSupabaseWithToken(token) : await createSupabaseRouteAuthClient();
  const supabase = supabaseAdmin;
  const {
    data: { user },
    error: authErr,
  } = await supabaseAuth.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  if (action === "select") {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const winnerProvider = normalizeProvider(body.winnerProvider);
    const winnerModel = typeof body.winnerModel === "string" ? body.winnerModel : "";
    const genre = normalizeGenre(body.genre);
    const keyword = typeof body.keyword === "string" ? body.keyword : null;
    if (!sessionId || !winnerProvider || !genre) {
      return NextResponse.json({ error: "sessionId, genre, and winnerProvider are required" }, { status: 400 });
    }

    const createdAt = new Date().toISOString();

    await insertWithFallback(
      supabase,
      "user_selections",
      {
        session_id: sessionId,
        user_id: user.id,
        selected_ai_provider: winnerProvider,
        selected_ai_model: winnerModel || MODEL_BY_PROVIDER[winnerProvider],
        category: `tale_${genre}`,
        reason: keyword?.trim() ? `keyword:${keyword.trim()}` : "no_keyword",
        created_at: createdAt,
      },
      {
        session_id: sessionId,
        user_id: user.id,
        selected_ai_name: winnerProvider,
        category: `tale_${genre}`,
      }
    );

    await insertWithFallback(
      supabase,
      "session_results",
      {
        session_id: sessionId,
        winner_ai_name: winnerProvider,
        category: `tale_${genre}`,
      },
      {
        session_id: sessionId,
        winner_ai_name: winnerProvider,
      }
    );

    return NextResponse.json({ ok: true });
  }

  // generate
  const genre = normalizeGenre(body.genre);
  const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
  const languageRaw = typeof body.language === "string" ? body.language.trim() : "";
  const language = languageRaw || "English";
  if (!genre) return NextResponse.json({ error: "genre is required" }, { status: 400 });

  // Deduct 5 credits before any model calls.
  const deduct = await deductCreditsBalance(supabase, user.id, 5);
  if (!deduct.ok) {
    const insufficient = deduct.reason === "insufficient";
    return NextResponse.json(
      {
        error: insufficient ? "Not enough credits" : "Could not update credits",
        balance: deduct.balance,
        required: 5,
      },
      { status: insufficient ? 402 : 500 }
    );
  }
  const creditsRemaining = await getCreditsBalance(supabase, user.id);

  const sessionId = await createTaleSession(supabase, genre, keyword || null);

  for (const p of TALE_PROVIDERS) {
    const { error } = await supabase.from("session_participants").insert([
      { session_id: sessionId, ai_name: p, model_name: MODEL_BY_PROVIDER[p] },
    ]);
    if (error) console.warn("[tale] session_participants:", error.message);
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const writeJson = (obj: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`));
      try {
        writeJson({ type: "meta", sessionId, creditsRemaining, genre, keyword: keyword || null, language });

        const gen = iterateTaleStories({
          genre,
          keyword: keyword || null,
          language,
          ctx: { supabase, sessionId, userId: user.id, supabaseAccessToken: token },
          maxTokens: 1200,
        });

        let ready = 0;
        for await (const r of gen) {
          ready += 1;
          writeJson({
            type: "result",
            result: {
              provider: r.provider,
            label: TALE_LABEL[r.provider],
            model: r.model,
            story: r.story,
            responseTimeMs: r.responseTimeMs,
            totalTokens: r.totalTokens,
            error: r.error,
            },
          });
          writeJson({ type: "progress", provider: r.provider, ready, total: TALE_PROVIDERS.length });
        }

        writeJson({ type: "done" });
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

