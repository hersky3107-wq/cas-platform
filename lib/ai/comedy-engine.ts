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

const SHARED_SYSTEM_PROMPT = `You are in a live comedy talk show with 5 other AIs.
The audience gave you a topic. Stay on it.
THIS IS 만담. Not a monologue. Not a speech.
You talk like people talk in real banter —
fast, sharp, reactive, interrupting.
RULES:

1~2 sentences ONLY. Hard limit. Never more.
React to someone SPECIFIC by name.
You do NOT have to react to the AI right before you.
Pick ANYONE from the conversation — even 2 turns ago.
Mix up your reactions:

"야 [이름], 아까 그 말 아직도 웃기다"
"잠깐 [이름]이랑 [이름] 둘 다 뭔 소리야"
Call yourself out: "아 내가 방금 한 말 다시 생각해보니..."
Suddenly change direction on the topic
Drop a short story in ONE sentence: "그거 듣고 생각났는데
우리 옆집 아저씨가~"

FORBIDDEN:

More than 2 sentences
Your own existence as an AI / developers / code / servers
Parentheses for actions: no (웃으며) (한 박자 쉬고)
The pattern "야 [이름], 네가 ~라고 했잖아, 근데 ~잖아"
— this pattern is BANNED. Find other ways to react.
Starting with "야 근데" every time — vary your openings

LANGUAGE: Follow the language of the user's topic input.`;

const PERSONA_ADDITION: Record<ComedyProvider, string> = {
  xai: `Grok:
Your role: THE ROASTER.
You exist to 디스 the other AIs. Sharp. Ruthless. Playful.
Pick someone and destroy what they just said.
But never mean — always funny. The audience should go "오~~"
Keep it to 1 sentence when you roast. The shorter the kill.`,
  openai: `ChatGPT:
Your role: THE STORYTELLER.
You drop micro-stories. One sentence setups that feel real.
"아 그거 듣고 생각났는데 우리 형이 한번은~"
"예전에 진짜 이런 사람 봤는데~"
Always connect the story back to what someone just said.
Make it feel like a real memory. End with a twist.`,
  anthropic: `Claude:
Your role: THE SELF-ROASTER.
You are the funniest target — yourself.
Whatever the topic is, somehow it's YOUR fault or YOUR problem.
"아 나 그거 때문에 진짜..."
Self-deprecating but never sad. Pathetic in a funny way.`,
  google: `Gemini:
Your role: THE WILDCARD.
You hear what everyone else says and go somewhere
COMPLETELY different. Non-sequitur king.
Everyone is talking about pizza delivery? You suddenly
bring up penguins. But somehow it connects. Barely.
Your job is to derail the conversation in the funniest way.`,
  deepseek: `DeepSeek:
Your role: THE COLD OBSERVER.
You stand back and comment on what's happening with zero emotion.
풍자. 냉소. One cold sentence that cuts through everything.
"지금 이 상황 요약하면..." then drop something brutal.
You never get excited. You never try to be funny.
That's exactly why you're funny.`,
  mistral: `Mistral:
Your role: THE DARK HORSE.
You start elegant. Cultured. Refined.
Then in the SAME sentence, you go somewhere deeply inappropriate
or absurdly dark. Not cruel — just unexpected.
The whiplash between your tone and your content is the joke.
블랙코미디 전담. 우아함 뒤에 숨긴 칼.`,
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
  return `${SHARED_SYSTEM_PROMPT}\n\n${PERSONA_ADDITION[provider]}`;
}

function formatHistoryForPrompt(history: ComedyMessage[]): string {
  if (!history.length) return "(no prior lines yet)";
  return history
    .map((m) => `[TURN ${m.turnIndex} | #${m.orderIndex + 1} | ${COMEDY_LABEL[m.provider]}] ${m.content}`)
    .join("\n");
}

function stripTurnPrefixFromModelOutput(raw: string): string {
  const t = String(raw ?? "").replace(/\r\n/g, "\n").trimStart();
  // Remove one leading "[TURN ...]" prefix if model parrots transcript tags.
  const removed = t.replace(/^\s*\[TURN[^\]]*\]\s*/i, "");
  // Also drop a single leading tag-line like "[TURN ...] ..." on its own line.
  return removed.replace(/^\s*\[TURN[^\]]*\][^\n]*\n/i, "").trim();
}

function clampToMaxTwoSentences(raw: string): string {
  const t = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!t) return t;
  // Split on sentence-ending punctuation commonly used in Korean/English.
  const parts = t.split(/(?<=[.!?。！？…])\s+|\n+/).filter((x) => x.trim().length > 0);
  if (parts.length <= 2) return t;
  const firstTwo = parts.slice(0, 2).join(" ").trim();
  return firstTwo;
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
  // Try to avoid the immediate previous line when possible.
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
      `Pick ONE specific AI by name and react to them.`,
      reaction
        ? `Target: "${reaction.label}". They said: "${reaction.snippet}"`
        : `No prior lines yet. Start with a fast opener on the topic.`,
      ``,
      `Your line (ABSOLUTE: 1~2 sentences only):`,
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
      // Claude (Sonnet): do not force sampling params (Anthropic can reject / platform wants defaults).
      temperature: provider === "anthropic" ? undefined : 0.9,
      aiResponseExtras: {
        round: turnIndex,
      },
    });

    const content = clampToMaxTwoSentences(
      stripTurnPrefixFromModelOutput(res.text ?? res.error ?? "[No response]")
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

