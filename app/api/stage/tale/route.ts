import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { runSingleAiProvider, type AiProviderName } from "@/lib/ai/router";

const TALE_PROVIDERS_IN_ORDER: AiProviderName[] = ["google", "openai", "deepseek", "mistral", "anthropic", "xai"];

function buildSystemPrompt(input: { genre: string; keyword: string; language: string }) {
  const genre = input.genre.trim();
  const keyword = input.keyword.trim();
  const language = input.language.trim() || "English";
  return `You are a master storyteller. Write a short story in this genre: ${genre}.
${keyword ? `Include this element: ${keyword}` : ""}
Write entirely in: ${language}
LENGTH: 400~550 words.
Strong opening line. Clear narrative arc. Surprising ending.
Never include word counts or meta-text.
Complete the story fully - never cut off mid-sentence.`;
}

function buildUserPrompt(input: { genre: string; keyword: string }) {
  const genre = input.genre.trim();
  const keyword = input.keyword.trim();
  if (keyword) return `Genre: ${genre}. Element to include: ${keyword}. Write the story now.`;
  return `Genre: ${genre}. Write the story now.`;
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const genre = typeof body.genre === "string" ? body.genre.trim() : "";
  const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
  const language = typeof body.language === "string" ? body.language.trim() : "";
  const userId = typeof body.userId === "string" ? body.userId : null;

  if (!genre) return NextResponse.json({ error: "genre is required" }, { status: 400 });

  const { data: sessionRow, error: sErr } = await supabaseAdmin
    .from("sessions")
    .insert([
      {
        mode: "tale",
        title: `TALE — ${genre}`,
        user_id: userId,
        prompt: keyword,
      },
    ])
    .select()
    .single();
  if (sErr || !sessionRow?.id) return NextResponse.json({ error: sErr?.message ?? "Could not create session" }, { status: 500 });
  const sessionId = String(sessionRow.id);

  const systemPrompt = buildSystemPrompt({ genre, keyword, language: language || "English" });
  const prompt = buildUserPrompt({ genre, keyword });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for (const provider of TALE_PROVIDERS_IN_ORDER) {
          const maxCompletionTokens = provider === "anthropic" ? 1400 : 1200;
          const r = await runSingleAiProvider({
            // Avoid router persistence; we will save rows ourselves.
            supabase: supabaseAdmin as any,
            sessionId: null,
            userId: null,
            provider,
            prompt,
            systemPrompt,
            maxCompletionTokens,
          });

          const row = {
            session_id: sessionId,
            ai_name: r.provider,
            model_name: r.model,
            response_text: r.text,
            response_time_ms: r.responseTimeMs,
            token_input: r.promptTokens,
            token_output: r.completionTokens,
            tale_language: language || "English",
          };
          const { error: insErr } = await supabaseAdmin.from("ai_responses").insert([row]);
          if (insErr) {
            send({ provider: r.provider, error: insErr.message });
          }

          send({
            provider: r.provider,
            model: r.model,
            story: r.text,
            responseTimeMs: r.responseTimeMs,
            token_input: r.promptTokens,
            token_output: r.completionTokens,
            error: r.error,
          });
        }

        send({ done: true, sessionId });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        send({ error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

