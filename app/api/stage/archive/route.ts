import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/server";
import { createSupabaseRouteAuthClient } from "@/lib/supabase/route-auth";
import { deductCreditsBalance, getCreditsBalance } from "@/lib/credits";

type Genre = "Horror" | "Romance" | "Absurd" | "Sci-Fi" | "Fairy Tale" | "Sad Story";
const GENRES: Genre[] = ["Horror", "Romance", "Absurd", "Sci-Fi", "Fairy Tale", "Sad Story"];

async function insertWithFallback(
  supabase: SupabaseClient,
  table: string,
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
) {
  const a = await supabase.from(table).insert([primary]);
  if (!a.error) return { ok: true as const };
  const b = await supabase.from(table).insert([fallback]);
  if (!b.error) return { ok: true as const };
  return { ok: false as const, primaryError: a.error.message, fallbackError: b.error.message };
}

function normalizeGenreParam(raw: string | null): Genre | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s || s === "all") return null;
  const byLower: Record<string, Genre> = {
    horror: "Horror",
    romance: "Romance",
    absurd: "Absurd",
    "sci-fi": "Sci-Fi",
    scifi: "Sci-Fi",
    "sci fi": "Sci-Fi",
    fairy: "Fairy Tale",
    "fairy tale": "Fairy Tale",
    sad: "Sad Story",
    "sad story": "Sad Story",
  };
  return byLower[s] ?? null;
}

function parseGenreFromCategory(category: unknown): Genre | null {
  if (typeof category !== "string") return null;
  const c = category.trim();
  if (!c.toLowerCase().startsWith("tale_")) return null;
  const g = c.slice(5);
  return (GENRES as readonly string[]).includes(g) ? (g as Genre) : null;
}

export async function GET(req: Request) {
  const supabaseAuth = await createSupabaseRouteAuthClient();
  const {
    data: { user },
    error: authErr,
  } = await supabaseAuth.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const url = new URL(req.url);
  const genreFilter = normalizeGenreParam(url.searchParams.get("genre"));
  const supabase = supabaseAdmin;

  const { data: resultsRows, error: srErr } = await supabase
    .from("session_results")
    .select("session_id, winner_ai_name, category, created_at")
    .ilike("category", "tale_%")
    .limit(500);
  if (srErr) return NextResponse.json({ error: srErr.message }, { status: 500 });

  const winners = (resultsRows ?? [])
    .map((r) => {
      const genre = parseGenreFromCategory((r as any).category);
      if (!genre) return null;
      if (genreFilter && genre !== genreFilter) return null;
      const session_id = String((r as any).session_id ?? "");
      const ai_provider = String((r as any).winner_ai_name ?? "");
      const selected_at = String((r as any).created_at ?? "");
      if (!session_id || !ai_provider) return null;
      return { session_id, ai_provider, genre, selected_at };
    })
    .filter(Boolean) as { session_id: string; ai_provider: string; genre: Genre; selected_at: string }[];

  if (!winners.length) return NextResponse.json({ stories: [] as unknown[] });

  const sessionIds = [...new Set(winners.map((w) => w.session_id))];

  const { data: responsesRows, error: arErr } = await supabase
    .from("ai_responses")
    .select("session_id, ai_name, model_name, response_text, created_at, tale_language")
    .in("session_id", sessionIds)
    .limit(5000);
  if (arErr) return NextResponse.json({ error: arErr.message }, { status: 500 });

  const { data: votesRows, error: vErr } = await supabase
    .from("votes")
    .select("session_id, user_id, voted_ai_provider, ai_provider, vote_choice, created_at")
    .in("session_id", sessionIds)
    .limit(20000);
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

  const voteCountKey = (sessionId: string, provider: string) => `${sessionId}::${provider}`;
  const voteCounts = new Map<string, number>();
  const userVoted = new Set<string>();

  for (const row of votesRows ?? []) {
    const sessionId = String((row as any).session_id ?? "");
    const userId = String((row as any).user_id ?? "");
    const provider =
      (typeof (row as any).voted_ai_provider === "string" && (row as any).voted_ai_provider) ||
      (typeof (row as any).ai_provider === "string" && (row as any).ai_provider) ||
      (typeof (row as any).vote_choice === "string" && (row as any).vote_choice) ||
      "";
    if (!sessionId || !provider) continue;
    const k = voteCountKey(sessionId, provider);
    voteCounts.set(k, (voteCounts.get(k) ?? 0) + 1);
    if (userId && userId === user.id) userVoted.add(k);
  }

  const respIndex = new Map<string, any>();
  for (const r of responsesRows ?? []) {
    const sessionId = String((r as any).session_id ?? "");
    const provider = String((r as any).ai_name ?? "");
    if (!sessionId || !provider) continue;
    respIndex.set(voteCountKey(sessionId, provider), r);
  }

  const stories = winners
    .map((w) => {
      const r = respIndex.get(voteCountKey(w.session_id, w.ai_provider));
      if (!r) return null;
      const story_text = typeof (r as any).response_text === "string" ? ((r as any).response_text as string) : "";
      if (!story_text) return null;
      const language = typeof (r as any).tale_language === "string" ? ((r as any).tale_language as string) : "English";
      const ai_model = typeof (r as any).model_name === "string" ? ((r as any).model_name as string) : "";
      const vote_count = voteCounts.get(voteCountKey(w.session_id, w.ai_provider)) ?? 0;
      const user_has_voted = userVoted.has(voteCountKey(w.session_id, w.ai_provider));
      return {
        session_id: w.session_id,
        ai_provider: w.ai_provider,
        ai_model,
        genre: w.genre,
        language,
        story_text,
        vote_count,
        selected_at: w.selected_at,
        user_has_voted,
      };
    })
    .filter(Boolean) as any[];

  stories.sort((a, b) => {
    const dv = (b.vote_count ?? 0) - (a.vote_count ?? 0);
    if (dv !== 0) return dv;
    return String(b.selected_at).localeCompare(String(a.selected_at));
  });

  return NextResponse.json({ stories });
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";

  const supabaseAuth = await createSupabaseRouteAuthClient();
  const {
    data: { user },
    error: authErr,
  } = await supabaseAuth.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const supabase = supabaseAdmin;

  if (action === "enter") {
    const deduct = await deductCreditsBalance(supabase, user.id, 1);
    if (!deduct.ok) {
      const insufficient = deduct.reason === "insufficient";
      return NextResponse.json(
        {
          error: insufficient ? "Not enough credits" : "Could not update credits",
          balance: deduct.balance,
          required: 1,
        },
        { status: insufficient ? 402 : 500 }
      );
    }
    const creditsRemaining = await getCreditsBalance(supabase, user.id);
    return NextResponse.json({ ok: true, creditsRemaining });
  }

  if (action === "vote") {
    const sessionId = typeof body.session_id === "string" ? body.session_id : "";
    const provider = typeof body.ai_provider === "string" ? body.ai_provider : "";
    if (!sessionId || !provider) {
      return NextResponse.json({ error: "session_id and ai_provider are required" }, { status: 400 });
    }

    const { data: existing, error: exErr } = await supabase
      .from("votes")
      .select("id")
      .eq("session_id", sessionId)
      .eq("user_id", user.id)
      .or(`voted_ai_provider.eq.${provider},ai_provider.eq.${provider},vote_choice.eq.${provider}`)
      .limit(1);
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
    if (existing && existing.length) return NextResponse.json({ ok: true, already: true });

    const primary: Record<string, unknown> = {
      session_id: sessionId,
      user_id: user.id,
      voted_ai_provider: provider,
      created_at: new Date().toISOString(),
      category: "archive_story_like",
    };
    const fallback: Record<string, unknown> = {
      session_id: sessionId,
      user_id: user.id,
      category: "archive_story_like",
      vote_choice: provider,
    };
    const ins = await insertWithFallback(supabase, "votes", primary, fallback);
    if (!ins.ok) return NextResponse.json({ error: "Could not save vote" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

