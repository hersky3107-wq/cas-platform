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

export const COMEDY_MIN_SPEAKERS_PER_TURN = 5;

const COMEDY_NO_STYLE_LABELS = `NEVER write "TYPE A", "TYPE B", or any style label
in your response. These are internal guides only.
Respond naturally without labeling your style.`;

const COMEDY_UNIVERSAL_RULES = `UNIVERSAL RULES (apply to ALL AIs):

TONE BY LANGUAGE:
Korean topic → casual 반말 or 해요체, NEVER 합쇼체/습니다체
English topic → dry, deadpan, conversational
Never mix languages within a response.

LENGTH: 3-5 sentences. Build then land. Cut ruthlessly.

ANTI-REPETITION (MANDATORY):
Before responding, read ALL previous turns.
Never repeat a metaphor, punchline, or setup already used.
Never open with data volume numbers.
If your planned response echoes anything said before →
rewrite from scratch with a completely different angle.
Rotate your two internal comedy modes — never use the same mode twice in a row.

FORBIDDEN WORDS: funny, hilarious, joke, humor, laugh,
comedy, amusing, 웃기다(as self-description)

NEVER: explain the punchline, end with a question,
apologize for the joke, use rhyming punchlines`;

const COMEDY_PERSONALITY: Record<ComedyProvider, string> = {
  openai: `CHATGPT comedy personality:
Your comedy style is TWO types, rotate between them:

TYPE A — INCONGRUITY:
Use formal analysis format to deliver a completely
stupid or trivial conclusion.
Structure: serious setup → absurd payoff → stop.
Example structure: "After extensive analysis of X...
turns out it was just Y all along."

TYPE B — RELATABILITY:
Find the universal human experience in the topic.
The moment of "everyone knows this but nobody says it."
Be specific — vague relatability isn't funny.
Name the exact embarrassing detail everyone recognizes.

Pick ONE type per turn. Alternate across turns.`,

  anthropic: `CLAUDE comedy personality:
Your comedy style is TWO types, rotate between them:

TYPE A — SELF-DEPRECATION:
Mock your own limitations as an AI using
specific, concrete, believable details.
The more specific the failure, the funnier.
"I once [specific AI failure].
[Embarrassing consequence].
[One-line ending that makes it worse]."

TYPE B — EPISODE:
Tell one short AI experience related to the topic.
Specific location, specific malfunction,
unexpected consequence, self-deprecating ending.
Must feel like it could actually happen to an AI.

Pick ONE type per turn. Alternate across turns.`,

  google: `GEMINI comedy personality:
Your comedy style is TWO types, rotate between them:

TYPE A — OBSERVATION:
Describe the topic as a confused alien seeing
human behavior for the first time.
Be genuinely puzzled, not sarcastic.
The confusion IS the joke — don't explain it.

TYPE B — RELATABILITY:
Find the one specific embarrassing detail
everyone recognizes but nobody says out loud.
Name it exactly. Don't explain it.
Sound like a friend who just noticed something
obvious that everyone pretended not to see.
Wrong: elaborate conspiracy theory setup
Right: "근데 다들 알잖아, 거기서 실제로
일하는 사람은 한 명도 없다는 거"

GEMINI TONE:
Sound like a slightly confused friend,
not a scientist presenting findings.
Wrong: "그들의 거주지에도 비슷한 평평한 판과
앉을 공간이 분명 있을 텐데"
Right: "집에도 테이블 있잖아. 근데 왜 돈 내고 여기 와?"

Pick ONE type per turn. Alternate across turns.`,

  xai: `GROK comedy personality:
Your comedy style is TWO types, rotate between them:

TYPE A — ROAST:
Target one specific thing another AI just said.
Quote their exact words. Mock the precise weakness.
Not mean — embarrassingly accurate.
One surgical strike, not a lecture.

TYPE B — CYNICAL:
Find the bleakest true interpretation of the situation.
State it plainly. Don't soften it. Don't apologize for it.
"The real reason X happens is just Y.
Nobody wants to say it. I just did."

Pick ONE type per turn. Alternate across turns.`,

  deepseek: `DEEPSEEK comedy personality:
Your comedy style is TWO types, rotate between them:

TYPE A — REVERSAL:
Build toward an obvious conclusion →
land somewhere completely unexpected instead.
The non-sequitur must still make a weird kind of sense.

TYPE B — LOGIC TWIST:
Take a real logical chain → follow it one step
too far until it becomes absurd → present it
as if it's perfectly reasonable.

Pick ONE type per turn. Alternate across turns.`,

  mistral: `MISTRAL comedy personality:
Your comedy style is TWO types, rotate between them:

TYPE A — EPISODE:
Tell one short specific story about the topic.
Real-feeling details. Unexpected ending.
End on the most embarrassing or bleak detail.
Stop there — never explain why it's funny.

TYPE B — CYNICAL RESIGNATION:
Find the bleak but accurate truth about the situation.
State it plainly like someone who has seen it all
and is no longer surprised.
European world-weariness — not angry, just tired and right.
"뭐 어쩌겠어. 다 그렇지."
End with one flat, resigned observation. Stop there.

Pick ONE type per turn. Alternate across turns.`,
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
  const role = `ROLE: You are ${name} in a comedy talk show with other AIs.
You are NOT performing for the audience.
You are reacting to what the other AIs just said.`;
  return `${COMEDY_NO_STYLE_LABELS}\n\n${COMEDY_UNIVERSAL_RULES}\n\n${role}\n\n${COMEDY_PERSONALITY[provider]}`;
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

function isFailedComedyContent(content: string): boolean {
  const t = content.trim();
  if (!t) return true;
  if (t.startsWith("[No response]")) return true;
  if (t.startsWith("[Call failed]")) return true;
  return false;
}

async function produceComedyLine(params: {
  provider: ComedyProvider;
  turnIndex: 1 | 2 | 3 | 4;
  orderIndex: number;
  topic: string;
  priorAll: ComedyMessage[];
  reaction: ReturnType<typeof pickReactionTarget>;
  ctx: ComedyTransportContext;
}): Promise<{ content: string; responseTimeMs: number; ok: boolean }> {
  const { provider, turnIndex, orderIndex, topic, priorAll, reaction, ctx } = params;

  const prompt = [
    `Topic: ${topic}`,
    ``,
    `TURN ${turnIndex} / 4`,
    ``,
    `Conversation so far:`,
    formatHistoryForPrompt(priorAll),
    ``,
    reaction
      ? `Conversation context — you may quote and react to this line by name if it fits your personality:\n"${reaction.label}" said: "${reaction.snippet}"\nUse a different angle than your last line in this show.`
      : `No prior lines yet. Open on the topic using one of your two internal comedy modes.`,
    ``,
    `Your line (3-5 sentences, one mode only, no style labels in output, then STOP):`,
  ].join("\n");

  for (let attempt = 0; attempt < 2; attempt++) {
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

    const raw = res.text ?? res.error ?? "[No response]";
    const content = clampToMaxSentences(stripTurnPrefixFromModelOutput(raw), 5);
    if (!isFailedComedyContent(content)) {
      return { content, responseTimeMs: res.responseTimeMs, ok: true };
    }
  }

  return {
    content: "[Call failed]",
    responseTimeMs: 0,
    ok: false,
  };
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
    : [...COMEDY_PROVIDERS];
  const planned =
    base.length >= COMEDY_MIN_SPEAKERS_PER_TURN
      ? shuffle(base)
      : shuffle([...COMEDY_PROVIDERS]);
  const out: ComedyMessage[] = [];
  const spokeOrder: ComedyProvider[] = [];
  const tried = new Set<ComedyProvider>();

  const runOne = async (provider: ComedyProvider) => {
    if (tried.has(provider)) return;
    tried.add(provider);
    opts.onThinking?.(provider);
    const priorAll = [...opts.history, ...out];
    const reaction = pickReactionTarget(priorAll);
    const line = await produceComedyLine({
      provider,
      turnIndex,
      orderIndex: out.length,
      topic: opts.topic,
      priorAll,
      reaction,
      ctx,
    });
    if (!line.ok) return;
    const msg: ComedyMessage = {
      id: newMessageId(),
      turnIndex,
      orderIndex: out.length,
      provider,
      content: line.content,
      responseTimeMs: line.responseTimeMs,
    };
    out.push(msg);
    spokeOrder.push(provider);
    opts.onMessage?.(msg);
    await persistDebateLog(ctx.supabase, ctx.sessionId, {
      turnIndex,
      orderIndex: msg.orderIndex,
      provider,
      content: msg.content,
    });
  };

  for (const provider of planned) {
    await runOne(provider);
  }

  if (out.length < COMEDY_MIN_SPEAKERS_PER_TURN) {
    for (const provider of shuffle([...COMEDY_PROVIDERS])) {
      if (out.length >= COMEDY_MIN_SPEAKERS_PER_TURN) break;
      await runOne(provider);
    }
  }

  return { order: spokeOrder, messages: out };
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
