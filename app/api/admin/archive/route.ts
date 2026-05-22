import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { supabaseAdmin } from "@/lib/supabase/server";

type Genre = "Horror" | "Romance" | "Absurd" | "Sci-Fi" | "Fairy Tale" | "Sad Story";
const GENRES: Genre[] = ["Horror", "Romance", "Absurd", "Sci-Fi", "Fairy Tale", "Sad Story"];

function parseGenreFromCategory(category: unknown): Genre | null {
  if (typeof category !== "string") return null;
  const c = category.trim();
  if (!c.toLowerCase().startsWith("tale_")) return null;
  const g = c.slice(5);
  return (GENRES as readonly string[]).includes(g) ? (g as Genre) : null;
}

function normalizeLanguage(raw: unknown): string {
  if (typeof raw !== "string") return "Korean";
  const s = raw.trim();
  return s ? s : "Korean";
}

export async function GET(req: Request) {
  const forbidden = await requireAdmin(req);
  if (forbidden) return forbidden;

  const url = new URL(req.url);
  const genreFilter = url.searchParams.get("genre")?.trim() || "";

  const { data: sessionsRows, error: sErr } = await supabaseAdmin
    .from("sessions")
    .select("id, created_at")
    .eq("mode", "tale")
    .limit(10000);
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  const sessionIds = [...new Set((sessionsRows ?? []).map((s) => String((s as any).id ?? "")).filter(Boolean))];
  if (!sessionIds.length) return NextResponse.json({ stories: [] });

  const sessionCreatedAt = new Map<string, string>();
  for (const s of sessionsRows ?? []) {
    const id = String((s as any).id ?? "");
    if (!id) continue;
    const createdAt = String((s as any).created_at ?? "");
    if (createdAt) sessionCreatedAt.set(id, createdAt);
  }

  const { data: srRows, error: srErr } = await supabaseAdmin
    .from("session_results")
    .select("session_id, winner_ai_name, category, created_at, pinned")
    .in("session_id", sessionIds)
    .ilike("category", "tale_%")
    .limit(50000);
  if (srErr) return NextResponse.json({ error: srErr.message }, { status: 500 });

  const winners = (srRows ?? [])
    .map((r) => {
      const genre = parseGenreFromCategory((r as any).category);
      if (!genre) return null;
      if (genreFilter && genreFilter !== "All" && genre !== genreFilter) return null;
      const session_id = String((r as any).session_id ?? "");
      const ai_name = String((r as any).winner_ai_name ?? "");
      if (!session_id || !ai_name) return null;
      return {
        session_id,
        ai_name,
        genre,
        created_at: String((r as any).created_at ?? "") || sessionCreatedAt.get(session_id) || "",
        pinned: Boolean((r as any).pinned),
      };
    })
    .filter(Boolean) as { session_id: string; ai_name: string; genre: Genre; created_at: string; pinned: boolean }[];

  const winnerSessionIds = [...new Set(winners.map((w) => w.session_id))];
  if (!winnerSessionIds.length) return NextResponse.json({ stories: [] });
  const winnerAiNames = [...new Set(winners.map((w) => w.ai_name))];

  const { data: arRows, error: arErr } = await supabaseAdmin
    .from("ai_responses")
    .select("session_id, ai_name, response_text, tale_language, created_at")
    .in("session_id", winnerSessionIds)
    .in("ai_name", winnerAiNames)
    .limit(50000);
  if (arErr) return NextResponse.json({ error: arErr.message }, { status: 500 });

  const bySessionAi = new Map<string, any>();
  const key = (sessionId: string, aiName: string) => `${sessionId}::${aiName}`;
  for (const r of arRows ?? []) {
    const sessionId = String((r as any).session_id ?? "");
    const aiName = String((r as any).ai_name ?? "");
    if (!sessionId || !aiName) continue;
    const k = key(sessionId, aiName);
    if (!bySessionAi.has(k)) bySessionAi.set(k, r);
  }

  const { data: vRows, error: vErr } = await supabaseAdmin
    .from("votes")
    .select("session_id")
    .in("session_id", winnerSessionIds)
    .limit(200000);
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

  const voteCountsBySession = new Map<string, number>();
  for (const v of vRows ?? []) {
    const sessionId = String((v as any).session_id ?? "");
    if (!sessionId) continue;
    voteCountsBySession.set(sessionId, (voteCountsBySession.get(sessionId) ?? 0) + 1);
  }

  const stories = winners
    .map((w) => {
      const r = bySessionAi.get(key(w.session_id, w.ai_name));
      if (!r) return null;
      const story_text = typeof (r as any).response_text === "string" ? ((r as any).response_text as string) : "";
      if (!story_text) return null;
      const language = normalizeLanguage((r as any).tale_language);
      return {
        session_id: w.session_id,
        genre: w.genre,
        ai_name: w.ai_name,
        language,
        story_preview: story_text.slice(0, 50),
        vote_count: voteCountsBySession.get(w.session_id) ?? 0,
        created_at: w.created_at,
        pinned: w.pinned,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ stories });
}

export async function DELETE(req: Request) {
  const forbidden = await requireAdmin(req);
  if (forbidden) return forbidden;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!sessionId) return NextResponse.json({ error: "session_id is required" }, { status: 400 });

  const { data: sr, error: srErr } = await supabaseAdmin
    .from("session_results")
    .select("winner_ai_name")
    .eq("session_id", sessionId)
    .ilike("category", "tale_%")
    .limit(5);
  if (srErr) return NextResponse.json({ error: srErr.message }, { status: 500 });

  const aiNames = [...new Set((sr ?? []).map((r) => String((r as any).winner_ai_name ?? "")).filter(Boolean))];

  const delSr = await supabaseAdmin.from("session_results").delete().eq("session_id", sessionId).ilike("category", "tale_%");
  if (delSr.error) return NextResponse.json({ error: delSr.error.message }, { status: 500 });

  if (aiNames.length) {
    const delAr = await supabaseAdmin.from("ai_responses").delete().eq("session_id", sessionId).in("ai_name", aiNames);
    if (delAr.error) return NextResponse.json({ error: delAr.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const forbidden = await requireAdmin(req);
  if (forbidden) return forbidden;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!sessionId) return NextResponse.json({ error: "session_id is required" }, { status: 400 });

  const explicitPinned = typeof body.pinned === "boolean" ? body.pinned : null;

  const { data: rows, error } = await supabaseAdmin
    .from("session_results")
    .select("id, pinned")
    .eq("session_id", sessionId)
    .ilike("category", "tale_%")
    .limit(10);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const nextPinned = explicitPinned ?? !Boolean((rows[0] as any).pinned);
  const ids = rows.map((r) => (r as any).id);

  const upd = await supabaseAdmin.from("session_results").update({ pinned: nextPinned }).in("id", ids);
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });

  return NextResponse.json({ ok: true, pinned: nextPinned });
}

