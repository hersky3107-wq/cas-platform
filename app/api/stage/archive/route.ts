import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/server";
import { resolveRouteAuth } from "@/lib/supabase/route-auth";
import { deductCreditsBalance, getCreditsBalance } from "@/lib/credits";

type Genre = "Horror" | "Romance" | "Absurd" | "Sci-Fi" | "Fairy Tale" | "Sad Story";
const GENRES: Genre[] = ["Horror", "Romance", "Absurd", "Sci-Fi", "Fairy Tale", "Sad Story"];

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

function inferLanguageFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (
    t.includes("korean") ||
    t.includes("한국어") ||
    t.includes("한글") ||
    t.includes("ko-kr") ||
    t.includes("ko_kr") ||
    t.includes("ko kr") ||
    t.includes("ko")
  )
    return "Korean";
  if (t.includes("japanese") || t.includes("日本語") || t.includes("にほんご") || t.includes("ja-jp") || t.includes("ja_jp"))
    return "Japanese";
  if (t.includes("english") || t.includes("영어") || t.includes("en-us") || t.includes("en_us") || t.includes("en"))
    return "English";
  if (t.includes("chinese") || t.includes("中文") || t.includes("汉语") || t.includes("zh-cn") || t.includes("zh_cn")) return "Chinese";
  return null;
}

function normalizeLanguage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s ? s : null;
}

export async function GET(req: Request) {
  const { user, error: authErr } = await resolveRouteAuth(req);
  if (authErr || !user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const url = new URL(req.url);
  const genreFilter = normalizeGenreParam(url.searchParams.get("genre"));
  const supabase = supabaseAdmin;

  // 1) Sessions (TALE only)
  const { data: sessionsRows, error: sErr } = await supabase
    .from("sessions")
    .select("id, created_at, title, prompt")
    .eq("mode", "tale")
    .limit(5000);
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  const sessionIds = [...new Set((sessionsRows ?? []).map((s) => String((s as any).id ?? "")).filter(Boolean))];
  if (!sessionIds.length) return NextResponse.json({ stories: [] as unknown[] });

  const sessionLangHint = new Map<string, string>();
  for (const s of sessionsRows ?? []) {
    const id = String((s as any).id ?? "");
    if (!id) continue;
    const title = typeof (s as any).title === "string" ? (s as any).title : "";
    const prompt = typeof (s as any).prompt === "string" ? (s as any).prompt : "";
    const inferred = inferLanguageFromText(`${title}\n${prompt}`);
    if (inferred) sessionLangHint.set(id, inferred);
  }

  // 2) Winner rows
  const { data: srRows, error: srErr } = await supabase
    .from("session_results")
    .select("session_id, winner_ai_name, category, created_at, pinned, result_type")
    .in("session_id", sessionIds)
    .eq("result_type", "tale")
    .limit(5000);
  if (srErr) return NextResponse.json({ error: srErr.message }, { status: 500 });

  // Keep latest result per session_id (if duplicates exist).
  const latestBySession = new Map<string, any>();
  for (const r of srRows ?? []) {
    const sid = String((r as any).session_id ?? "");
    if (!sid) continue;
    const prev = latestBySession.get(sid);
    if (!prev) {
      latestBySession.set(sid, r);
      continue;
    }
    const prevAt = String((prev as any).created_at ?? "");
    const nextAt = String((r as any).created_at ?? "");
    if (nextAt && (!prevAt || nextAt > prevAt)) latestBySession.set(sid, r);
  }

  const winners = [...latestBySession.values()]
    .map((r) => {
      const session_id = String((r as any).session_id ?? "");
      const ai_provider = String((r as any).winner_ai_name ?? "");
      const category = String((r as any).category ?? "").trim();
      const selected_at = String((r as any).created_at ?? "");
      const pinned = Boolean((r as any).pinned);
      if (!session_id || !ai_provider) return null;
      const genre = category || "Custom";
      if (genreFilter && genre !== genreFilter) return null;
      return { session_id, ai_provider, genre, selected_at, pinned };
    })
    .filter(Boolean) as { session_id: string; ai_provider: string; genre: string; selected_at: string; pinned: boolean }[];

  if (!winners.length) return NextResponse.json({ stories: [] as unknown[] });

  const winnerSessionIds = [...new Set(winners.map((w) => w.session_id))];
  const winnerProviders = [...new Set(winners.map((w) => w.ai_provider))];

  // 3) Winner AI response text + language
  const { data: responsesRows, error: arErr } = await supabase
    .from("ai_responses")
    .select("session_id, ai_name, model_name, response_text, tale_language, created_at")
    .in("session_id", winnerSessionIds)
    .in("ai_name", winnerProviders)
    .limit(50000);
  if (arErr) return NextResponse.json({ error: arErr.message }, { status: 500 });

  const respIndex = new Map<string, any>();
  const key = (sessionId: string, provider: string) => `${sessionId}::${provider}`;
  for (const r of responsesRows ?? []) {
    const sessionId = String((r as any).session_id ?? "");
    const provider = String((r as any).ai_name ?? "");
    if (!sessionId || !provider) continue;
    const k = key(sessionId, provider);
    if (!respIndex.has(k)) respIndex.set(k, r);
  }

  // 4) Votes per story (session_id + target_ai_name)
  const { data: votesRows, error: vErr } = await supabase
    .from("votes")
    .select("session_id, user_id, target_ai_name")
    .in("session_id", winnerSessionIds)
    .limit(200000);
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

  const voteCountsByStory = new Map<string, number>();
  const userVotedWinner = new Set<string>();
  for (const v of votesRows ?? []) {
    const sessionId = String((v as any).session_id ?? "");
    const userId = String((v as any).user_id ?? "");
    const target = String((v as any).target_ai_name ?? "");
    if (!sessionId || !target) continue;

    const k = key(sessionId, target);
    voteCountsByStory.set(k, (voteCountsByStory.get(k) ?? 0) + 1);
    if (userId && userId === user.id) userVotedWinner.add(k);
  }

  const PROVIDER_LABEL: Record<string, string> = {
    anthropic: "Claude",
    openai: "ChatGPT",
    google: "Gemini",
    xai: "Grok",
    deepseek: "DeepSeek",
    mistral: "Mistral",
  };

  const stories = winners
    .map((w) => {
      const r = respIndex.get(key(w.session_id, w.ai_provider));
      if (!r) return null;
      const story_text = typeof (r as any).response_text === "string" ? ((r as any).response_text as string) : "";
      if (!story_text) return null;
      const language = normalizeLanguage((r as any).tale_language) ?? sessionLangHint.get(w.session_id) ?? "Korean";
      const ai_model = typeof (r as any).model_name === "string" ? ((r as any).model_name as string) : "";
      const vote_count = voteCountsByStory.get(key(w.session_id, w.ai_provider)) ?? 0;
      const user_has_voted = userVotedWinner.has(key(w.session_id, w.ai_provider));
      return {
        session_id: w.session_id,
        ai_provider: w.ai_provider,
        ai_provider_label: PROVIDER_LABEL[w.ai_provider] ?? w.ai_provider,
        ai_model,
        genre: w.genre,
        language,
        story_text,
        vote_count,
        selected_at: w.selected_at,
        pinned: w.pinned,
        user_has_voted,
      };
    })
    .filter(Boolean) as any[];

  stories.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
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

  const { user, error: authErr } = await resolveRouteAuth(req, body);
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
      .eq("target_ai_name", provider)
      .limit(1);
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
    if (existing && existing.length) return NextResponse.json({ ok: true, already: true });

    const { error: insErr } = await supabase.from("votes").insert([
      {
      session_id: sessionId,
      user_id: user.id,
      target_ai_name: provider,
      voter_ai_name: "user",
      reason: "archive_like",
      },
    ]);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

