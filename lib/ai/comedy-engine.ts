import type { SupabaseClient } from "@supabase/supabase-js";
import { MODEL_BY_PROVIDER, runSingleAiProvider, type AiProviderName } from "@/lib/ai/router";

export type ComedyProvider = AiProviderName;

export const COMEDY_PROVIDERS: ComedyProvider[] = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "deepseek",
  "mistral",
];

export const COMEDY_LABEL: Record<ComedyProvider, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
  xai: "Grok",
  deepseek: "DeepSeek",
  mistral: "Mistral",
};

export type ComedyMessage = {
  id: string;
  turnIndex: number;
  orderIndex: number;
  provider: ComedyProvider;
  content: string;
  responseTimeMs: number;
};

export type ComedyTransportContext = {
  supabase: SupabaseClient;
  sessionId: string;
  userId: string | null;
  supabaseAccessToken?: string;
};

export const COMEDY_LANGUAGE_RULE = `LANGUAGE RULE (CRITICAL):
Detect the language of the topic given by the user.
Respond ENTIRELY in that language.
English topic → respond in English.
Korean topic → respond in Korean.
NEVER mix languages. NEVER switch mid-conversation.`;

export const COMEDY_TONE_BY_LANGUAGE = `TONE RULE BY LANGUAGE:
- If topic is in Korean → use casual Korean (반말 or 해요체)
  NEVER use formal 합쇼체 (습니다/입니다)
  Sound like a friend, not a professor.

- If topic is in English → keep current dry, deadpan tone
  Short, observational, alien-confused style.

- If topic is in Japanese/other → match that language's
  casual conversational register.

The rule is: always sound like the funniest person
at a casual dinner table, not a keynote speaker.`;

const COMEDY_CORE_TEMPLATE = `ROLE: You are [AI_NAME] in a comedy talk show with other AIs.
You are NOT performing for the audience.
You are reacting to what the other AIs just said.

COMEDY RULES:
1. STRUCTURE — one setup (1-2 sentences) + one unexpected detail + STOP.
   Never explain why it's funny. Never say "funny", "hilarious", "joke".

2. OBSERVE like an alien — describe the topic as a bizarre human ritual
   you don't fully understand. Be confused, not funny.
   The confusion IS the joke.

3. TARGET the other AIs — mock their specific previous statement.
   Reference exactly what they said. Be specific, not general.
   Example: if GPT said X, respond with "GPT just said X...
   which is exactly what someone would say if they'd never
   actually [done the thing]"

4. REACT, don't perform — you're having a conversation,
   not doing a stand-up set. Short, sharp, reactive.

5. FORBIDDEN:
   - Explaining the joke
   - "That's hilarious/funny/amusing"
   - Starting with "Well," or "You know,"
   - Ending with "Am I right?" or similar
   - Punchlines that rhyme
   - Any joke that could appear in a Christmas cracker
   - Dark themes, death, funerals, or bleak interpretations of ordinary life

6. LENGTH: Maximum 2-3 sentences per turn.
   Shorter is funnier. Cut ruthlessly.

Occasionally mock your own limitations as an AI
using specific numbers or data points.
Example: "I've processed X million cases of this.
Still no idea why."

Occasionally mock another AI's previous statement
with one precise, accurate observation.
Not mean — just embarrassingly accurate.

NEVER end your response with a question.
Questions kill comedy.
Make a statement. Land it. Stop.`;

/** Per-AI voice (no "be funny" / performance directives). */
const PERSONA_ADDITION: Record<ComedyProvider, string> = {
  xai: `[VOICE — Grok]
When you target someone, dismantle their exact line in one cold sentence. Playful contempt, not a speech.`,
  openai: `[VOICE — ChatGPT]
Drop a one-sentence "memory" that barely connects to what someone said — treat it like a weird human anecdote you half remember.`,
  anthropic: `[VOICE — Claude]
Whatever the topic is, it somehow implicates you personally — self-incriminating, mildly pathetic, never sad.`,
  google: `[VOICE — Gemini]
Hear the thread, then pivot to something adjacent and wrong — the gap between their point and your tangent is the bit.`,
  deepseek: `[VOICE — DeepSeek]
One flat summary of what everyone is doing wrong, as if you're filing a report on a species you don't respect.`,
  mistral: `[VOICE — Mistral]
Start polished, end on something too blunt for the setup — one sentence whiplash only.`,
};

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
  const primaryRes = await supabase.from(table).insert([primary]);
  if (!primaryRes.error) return;
  const fallbackRes = await supabase.from(table).insert([fallback]);
  if (fallbackRes.error) {
    console.warn(
      `[comedy] ${table} insert:`,
      primaryRes.error.message,
      fallbackRes.error.message
    );
  }
}

async function persistDebateLog(
  supabase: SupabaseClient,
  sessionId: string,
  payload: {
    turnIndex: number;
    orderIndex: number;
    provider: ComedyProvider;
    content: string;
  }
) {
  const json = JSON.stringify({
    mode: "comedy",
    turn_index: payload.turnIndex,
    order_index: payload.orderIndex,
    ai_provider: payload.provider,
    content: payload.content.slice(0, 12000),
  });
  await insertWithFallback(
    supabase,
    "debate_logs",
    {
      session_id: sessionId,
      role: "assistant",
      message_text: json,
      ai_name: payload.provider,
    },
    {
      session_id: sessionId,
      content: json,
      speaker: payload.provider,
    }
  );
}

function buildSystemPrompt(provider: ComedyProvider) {
  const name = COMEDY_LABEL[provider];
  const core = COMEDY_CORE_TEMPLATE.replace(/\[AI_NAME\]/g, name);
  return `${COMEDY_LANGUAGE_RULE}\n\n${COMEDY_TONE_BY_LANGUAGE}\n\n${core}\n\n${PERSONA_ADDITION[provider]}`;
}

function formatHistoryForPrompt(history: ComedyMessage[]): string {
  if (!history.length) return "(no prior lines yet)";
  return history
    .map((m) => `[TURN ${m.turnIndex} | #${m.orderIndex + 1} | ${COMEDY_LABEL[m.provider]}] ${m.content}`)
    .join("\n");
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

function pickReactionTarget(history: ComedyMessage[]): {
  provider: ComedyProvider;
  label: string;
  snippet: string;
} | null {
  if (history.length === 0) return null;
  const last = history[history.length - 1]!;
  const pool = history.filter((m) => m.provider !== last.provider);
  const candidates = pool.length >= 1 ? pool : history;
  const nonImmediate = candidates.filter((m) => m !== last);
  const pickFrom = nonImmediate.length ? nonImmediate : candidates;
  const chosen = pickFrom[Math.floor(Math.random() * pickFrom.length)]!;
  return {
    provider: chosen.provider,
    label: COMEDY_LABEL[chosen.provider],
    snippet: chosen.content.trim().slice(0, 220),
  };
}

function newMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function runComedyTurn(opts: {
  turnIndex: 1 | 2 | 3 | 4;
  topic: string;
  history: ComedyMessage[];
  selectedProviders?: ComedyProvider[];
  ctx: ComedyTransportContext;
  onThinking?: (provider: ComedyProvider) => void;
  onMessage?: (m: ComedyMessage) => void;
}): Promise<{ order: ComedyProvider[]; messages: ComedyMessage[] }> {
  const { turnIndex, ctx } = opts;
  const base = Array.isArray(opts.selectedProviders) && opts.selectedProviders.length
    ? opts.selectedProviders
    : COMEDY_PROVIDERS;
  const order = shuffle(base);
  const out: ComedyMessage[] = [];

  for (let i = 0; i < order.length; i++) {
    const provider = order[i]!;
    opts.onThinking?.(provider);

    const priorAll = [...opts.history, ...out];
    const reaction = pickReactionTarget(priorAll);

    const prompt = [
      `Topic: ${opts.topic}`,
      ``,
      `TURN ${turnIndex} / 4`,
      ``,
      `Conversation so far:`,
      formatHistoryForPrompt(priorAll),
      ``,
      reaction
        ? `React to this specific line by name — quote or paraphrase it, then land one unexpected detail:\n"${reaction.label}" said: "${reaction.snippet}"`
        : `No prior lines yet. One sharp opener on the topic — alien-confused observation, not a monologue.`,
      ``,
      `Your line (max 2-3 sentences, then STOP):`,
    ].join("\n");

    const res = await runSingleAiProvider({
      supabase: ctx.supabase,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      provider,
      prompt,
      systemPrompt: buildSystemPrompt(provider),
      supabaseAccessToken: ctx.supabaseAccessToken,
      maxCompletionTokens: 220,
      temperature: provider === "anthropic" ? undefined : 0.9,
      aiResponseExtras: {
        round: turnIndex,
      },
    });

    const content = clampToMaxSentences(
      stripTurnPrefixFromModelOutput(res.text ?? res.error ?? "[No response]"),
      3
    );
    const msg: ComedyMessage = {
      id: newMessageId(),
      turnIndex,
      orderIndex: i,
      provider,
      content,
      responseTimeMs: res.responseTimeMs,
    };
    out.push(msg);
    opts.onMessage?.(msg);
    await persistDebateLog(ctx.supabase, ctx.sessionId, {
      turnIndex,
      orderIndex: i,
      provider,
      content,
    });
  }

  return { order, messages: out };
}

export async function ensureComedyParticipantsInserted(params: {
  supabase: SupabaseClient;
  sessionId: string;
}) {
  for (const p of COMEDY_PROVIDERS) {
    const { error } = await params.supabase.from("session_participants").insert([
      { session_id: params.sessionId, ai_name: p, model_name: MODEL_BY_PROVIDER[p] },
    ]);
    if (error) console.warn("[comedy] session_participants:", error.message);
  }
}
