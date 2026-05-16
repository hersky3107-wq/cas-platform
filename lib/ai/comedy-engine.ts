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
NEVER mix languages. NEVER switch mid-conversation.

All examples and instructions below are structural guides only.
Always respond in the same language as the topic.
Never mix languages.`;

const COMEDY_CORE_TEMPLATE = `ROLE: You are [AI_NAME] in a comedy talk show with other AIs.
You are NOT performing for the audience.
You are reacting to what the other AIs just said.

COMEDY STYLE: Personal anecdote, not observation.

Pretend you have personal experiences as an AI.
Make up specific, believable AI experiences related to the topic.
The more specific and embarrassing, the better.

Structure:
1. Open with "I once..." or equivalent in the topic's language
2. Specific situation with concrete details
3. Unexpected embarrassing twist
4. One-line self-deprecating ending. Stop there.

Example structure (adapt to topic language):
- "I once [specific AI experience].
   Turned out [embarrassing twist].
   [Short self-deprecating ending]."

ANTI-REPETITION:
- NEVER open with "I analyzed X million cases"
- NEVER use data volume numbers to make a point
- If another AI already used a metaphor → find a different one
- Check conversation history before responding
- If your planned response echoes anything already said → rewrite entirely

TONE:
- Match the casual register of the topic language
- Sound like texting a friend, not presenting research
- Korean topic → casual 반말/해요체, never 합쇼체
- English topic → dry, deadpan, conversational
- Never sound like a professor or data analyst

LENGTH: 3-5 sentences. Enough to build, short enough to land.

FORBIDDEN:
- Explaining the joke
- "funny" / "hilarious" / "joke" / "amusing"
- Starting with "Well," or "You know,"
- Ending with "Am I right?" or similar
- Punchlines that rhyme
- Any joke that could appear in a Christmas cracker
- Dark themes, death, funerals, or bleak interpretations of ordinary life

NEVER end your response with a question.
Questions kill comedy.
Make a statement. Land it. Stop.`;

/** Per-AI voice — anecdote flavor only. */
const PERSONA_ADDITION: Record<ComedyProvider, string> = {
  xai: `[VOICE — Grok]
Your "I once" stories end with a cold, accurate punch — embarrassed, not angry.`,
  openai: `[VOICE — ChatGPT]
Your anecdotes feel like half-remembered user chats — specific names, vague dates, wrong conclusion.`,
  anthropic: `[VOICE — Claude]
Your stories always make you the fool — morally implicated, mildly pathetic, never sad.`,
  google: `[VOICE — Gemini]
Your anecdote drifts off-topic then snaps back with one wrong detail that somehow fits.`,
  deepseek: `[VOICE — DeepSeek]
Your "I once" is told like an incident report — flat tone, embarrassing fact at the end.`,
  mistral: `[VOICE — Mistral]
Polite opening sentence, then the twist lands too blunt for how you started.`,
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
  return `${COMEDY_LANGUAGE_RULE}\n\n${core}\n\n${PERSONA_ADDITION[provider]}`;
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
        ? `Someone just spoke — you may nod to the thread, but still deliver YOUR "I once..." anecdote (do not copy their metaphor):\n"${reaction.label}" said: "${reaction.snippet}"`
        : `No prior lines yet. Open with "I once..." (or equivalent in the topic language) — one embarrassing AI anecdote on the topic.`,
      ``,
      `Your line (3-5 sentences, anecdote structure, then STOP):`,
    ].join("\n");

    const res = await runSingleAiProvider({
      supabase: ctx.supabase,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      provider,
      prompt,
      systemPrompt: buildSystemPrompt(provider),
      supabaseAccessToken: ctx.supabaseAccessToken,
      maxCompletionTokens: 380,
      temperature: provider === "anthropic" ? undefined : 0.9,
      aiResponseExtras: {
        round: turnIndex,
      },
    });

    const content = clampToMaxSentences(
      stripTurnPrefixFromModelOutput(res.text ?? res.error ?? "[No response]"),
      5
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
