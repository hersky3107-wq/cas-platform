import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

function genreFromTitle(title: unknown): string | null {
  if (typeof title !== "string") return null;
  const t = title.trim();
  const prefix = "TALE — ";
  if (!t.startsWith(prefix)) return null;
  const g = t.slice(prefix.length).trim();
  return g ? g : null;
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const selectedProvider = typeof body.selectedProvider === "string" ? body.selectedProvider : "";

  if (!sessionId || !selectedProvider) {
    return NextResponse.json({ error: "sessionId and selectedProvider are required" }, { status: 400 });
  }

  const { data: sessionRow, error: sErr } = await supabaseAdmin
    .from("sessions")
    .select("title")
    .eq("id", sessionId)
    .limit(1)
    .maybeSingle();
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  const genre = genreFromTitle(sessionRow?.title) ?? "tale";

  const { error: insErr } = await supabaseAdmin.from("session_results").insert([
    {
      session_id: sessionId,
      winner_ai_name: selectedProvider,
      result_type: "tale",
      category: genre,
      created_at: new Date().toISOString(),
    },
  ]);
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

