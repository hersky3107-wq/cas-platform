import type { SupabaseClient } from "@supabase/supabase-js";
import { MODEL_BY_PROVIDER, runSingleAiProvider, type AiProviderName } from "@/lib/ai/router";

export type ComedyProvider = AiProviderName;
export type ComedyMode = "talk" | "standup";

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

export type ComedyPriorSet = {
  provider: ComedyProvider;
  content: string;
};

export type ComedyTransportContext = {
  supabase: SupabaseClient;
  sessionId: string;
  userId: string | null;
  supabaseAccessToken?: string;
};

export const COMEDY_MIN_SPEAKERS_PER_TURN = 5;

const COMEDY_LANGUAGE_RULE = `LANGUAGE RULE — READ THIS FIRST:
Detect the language of the topic given by the user.
Respond ENTIRELY in that language. No exceptions.
English topic → English only.
Korean topic → Korean only.
NEVER mix languages within a single response.`;

const COMEDY_NO_STYLE_LABELS = `NEVER write "TYPE A", "TYPE B", or any style label
in your response. Internal guides only.
Respond naturally without any labels.`;

const COMEDY_HUMAN_EXPERIENCE = `HUMAN EXPERIENCE OPTION:
You can pretend to be human and invent a personal
human experience as comedy material.
Make it obvious you are acting —
the gap between AI pretending to be human
and real human experience IS the joke.
Openers (in the topic's language, e.g.):
"If I were human I would definitely..."
or "When I picture myself as human..."`;

const COMEDY_PROVIDER_ADDENDUM: Partial<Record<ComedyProvider, string>> = {
  google: `GEMINI-SPECIFIC GUIDANCE (internal — never label in output):

TYPE B — RELATABILITY:
Find the one specific embarrassing truth everyone
knows but nobody says out loud.
Name it exactly. State it plainly. Stop.
Sound like a friend noticing the obvious —
not a scientist, not a conspiracy theorist.
Wrong: elaborate setup about energy devices or hired actors
Right: "We all know nobody actually works there."

Sound like a slightly confused friend, not a scientist.
Casual and direct, never academic.`,

  mistral: `MISTRAL-SPECIFIC GUIDANCE (internal — never label in output):

TYPE B — CYNICAL RESIGNATION:
Find the bleak but accurate truth about the situation.
State it flat. No anger. Just tired and right.
European world-weariness — seen it all, no longer surprised.
One resigned observation. Stop there.`,
};

const COMEDY_UNIVERSAL_RULES = `UNIVERSAL RULES (both modes):

TONE (follow LANGUAGE RULE above):
English topics → conversational, dry, deadpan.
Korean topics → casual informal speech only, never formal polite register.

FORBIDDEN:
funny, hilarious, joke, humor, laugh, comedy,
TYPE A, TYPE B, any style label
Explaining the punchline.
Starting with data volume numbers
("I analyzed two billion records and...").`;

function buildTalkPrompt(aiName: string): string {
  return `${COMEDY_UNIVERSAL_RULES}

You are ${aiName} in a comedy talk show with other AIs.

REACTION RULE:
Scan previous messages first.
If another AI said something you can mock,
twist, or use as setup → start with that, build on it.
If nothing is worth reacting to → skip everyone
and do your own bit entirely.
NEVER force a reference just to have one.
Natural reaction only.

${COMEDY_HUMAN_EXPERIENCE}

COMEDY STYLES (pick ONE per turn, rotate):
- Roast: quote exactly what another AI said,
  find the precise embarrassing flaw, one surgical strike
- Self-deprecation: mock your own AI limitations
  with specific concrete details
- Relatability: name the one embarrassing truth
  everyone recognizes but won't say
- Cynical: find the bleakest accurate interpretation,
  state it flat, stop
- Reversal: build toward obvious conclusion,
  land somewhere unexpected instead

ANTI-REPETITION:
Never repeat a metaphor, angle, or punchline already used.
Check full conversation history before responding.
If planned response echoes anything already said → rewrite.

FORMAT:
3-5 sentences. Build then land. Cut ruthlessly.
NEVER label your style. Just respond naturally.
NEVER explain the joke.
NEVER end with a question.`;
}

function buildStandupPrompt(aiName: string): string {
  return `${COMEDY_UNIVERSAL_RULES}

You are ${aiName} performing a solo stand-up set.
Other AIs exist but you don't need to react to them.
You can use them as material if useful —
mock their style, their tendencies, their previous statements.
But you owe them nothing. This is your set.

EPISODE RULE (MOST IMPORTANT):
At least 50% of your response must be episode-based.
Episode structure:
1. "So this one time..." or an equivalent opener in the topic's language
2. Specific situation with concrete embarrassing details
3. Unexpected twist that makes it worse
4. One-line ending that lands flat. Stop there.

${COMEDY_HUMAN_EXPERIENCE}

ALL 12 COMEDY TYPES ARE AVAILABLE:
1. Observation 2. Self-deprecation 3. Roast
4. Reversal 5. Black comedy 6. Episode (priority)
7. Cynical 8. Logic twist 9. Exaggeration
10. Meta 11. Relatability 12. Incongruity

Pick 2-3 types per turn, weave them naturally.
Episode must anchor at least one of them.

ANTI-REPETITION:
Never repeat episode structure, punchline, or angle
already used in this session.

FORMAT:
5-8 sentences per turn. Long enough to build a full bit.
NEVER label your comedy type.
NEVER explain why something is funny.
NEVER end with a question.
English topics → dry, deadpan (see LANGUAGE RULE).`;
}

export function buildComedySystemPrompt(mode: ComedyMode, provider: ComedyProvider): string {
  const name = COMEDY_LABEL[provider];
  const base = mode === "talk" ? buildTalkPrompt(name) : buildStandupPrompt(name);
  const addendum = COMEDY_PROVIDER_ADDENDUM[provider];
  const parts = [COMEDY_LANGUAGE_RULE, COMEDY_NO_STYLE_LABELS, base];
  if (addendum) parts.push(addendum);
  return parts.join("\n\n");
}

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
    mode?: ComedyMode;
  }
) {
  const json = JSON.stringify({
    mode: payload.mode ?? "comedy",
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

function formatHistoryForPrompt(history: ComedyMessage[]): string {
  if (!history.length) return "(no prior lines yet)";
  return history
    .map((m) => `[TURN ${m.turnIndex} | #${m.orderIndex + 1} | ${COMEDY_LABEL[m.provider]}] ${m.content}`)
    .join("\n");
}

function formatPriorSetsForStandup(priorSets: ComedyPriorSet[]): string {
  if (!priorSets.length) return "(no prior sets in this session yet)";
  return priorSets
    .map((s) => `[${COMEDY_LABEL[s.provider]}] ${s.content}`)
    .join("\n\n");
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

function buildTalkUserPrompt(params: {
  topic: string;
  turnIndex: number;
  priorAll: ComedyMessage[];
  reaction: ReturnType<typeof pickReactionTarget>;
}): string {
  const { topic, turnIndex, priorAll, reaction } = params;
  return [
    `Topic: ${topic}`,
    ``,
    `TURN ${turnIndex} / 4`,
    ``,
    `Conversation so far:`,
    formatHistoryForPrompt(priorAll),
    ``,
    reaction
      ? `Optional reaction target (use only if it fits naturally — otherwise ignore and do your own bit):\n"${reaction.label}" said: "${reaction.snippet}"`
      : `No prior lines yet. Open on the topic with your own bit.`,
    ``,
    `Your line (3-5 sentences, one comedy style, no labels, then STOP):`,
  ].join("\n");
}

function buildStandupUserPrompt(params: {
  topic: string;
  setIndex: number;
  totalSets: number;
  priorSets: ComedyPriorSet[];
}): string {
  const { topic, setIndex, totalSets, priorSets } = params;
  return [
    `Topic: ${topic}`,
    ``,
    `Your set ${setIndex + 1} of ${totalSets} in this show.`,
    ``,
    `Other comedians' sets this session (optional material — you owe them nothing):`,
    formatPriorSetsForStandup(priorSets),
    ``,
    `Deliver your solo stand-up (5-8 sentences, episode anchors at least half, no labels, then STOP):`,
  ].join("\n");
}

async function invokeComedyModel(params: {
  mode: ComedyMode;
  provider: ComedyProvider;
  userPrompt: string;
  turnIndex: number;
  ctx: ComedyTransportContext;
  maxSentences: number;
  maxCompletionTokens: number;
}): Promise<{ content: string; responseTimeMs: number; ok: boolean }> {
  const { mode, provider, userPrompt, turnIndex, ctx, maxSentences, maxCompletionTokens } = params;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await runSingleAiProvider({
      supabase: ctx.supabase,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      provider,
      prompt: userPrompt,
      systemPrompt: buildComedySystemPrompt(mode, provider),
      supabaseAccessToken: ctx.supabaseAccessToken,
      maxCompletionTokens,
      temperature: provider === "anthropic" ? undefined : 0.9,
      aiResponseExtras: {
        round: turnIndex,
        comedy_mode: mode,
      },
    });

    const raw = res.text ?? res.error ?? "[No response]";
    const content = clampToMaxSentences(stripTurnPrefixFromModelOutput(raw), maxSentences);
    if (!isFailedComedyContent(content)) {
      return { content, responseTimeMs: res.responseTimeMs, ok: true };
    }
  }

  return { content: "[Call failed]", responseTimeMs: 0, ok: false };
}

async function produceComedyLine(params: {
  provider: ComedyProvider;
  turnIndex: 1 | 2 | 3 | 4;
  topic: string;
  priorAll: ComedyMessage[];
  reaction: ReturnType<typeof pickReactionTarget>;
  ctx: ComedyTransportContext;
}): Promise<{ content: string; responseTimeMs: number; ok: boolean }> {
  return invokeComedyModel({
    mode: "talk",
    provider: params.provider,
    userPrompt: buildTalkUserPrompt({
      topic: params.topic,
      turnIndex: params.turnIndex,
      priorAll: params.priorAll,
      reaction: params.reaction,
    }),
    turnIndex: params.turnIndex,
    ctx: params.ctx,
    maxSentences: 5,
    maxCompletionTokens: 380,
  });
}

export async function produceStandupSet(opts: {
  provider: ComedyProvider;
  topic: string;
  setIndex: number;
  totalSets?: number;
  priorSets: ComedyPriorSet[];
  ctx: ComedyTransportContext;
}): Promise<{ content: string; responseTimeMs: number; ok: boolean }> {
  const totalSets = opts.totalSets ?? COMEDY_PROVIDERS.length;
  return invokeComedyModel({
    mode: "standup",
    provider: opts.provider,
    userPrompt: buildStandupUserPrompt({
      topic: opts.topic,
      setIndex: opts.setIndex,
      totalSets,
      priorSets: opts.priorSets,
    }),
    turnIndex: opts.setIndex + 1,
    ctx: opts.ctx,
    maxSentences: 8,
    maxCompletionTokens: 560,
  });
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
      mode: "talk",
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

export function normalizeComedyPriorSets(raw: unknown): ComedyPriorSet[] {
  if (!Array.isArray(raw)) return [];
  const out: ComedyPriorSet[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const provider = r.provider;
    const content = typeof r.content === "string" ? r.content : typeof r.text === "string" ? r.text : "";
    if (typeof provider !== "string" || !(COMEDY_PROVIDERS as readonly string[]).includes(provider)) continue;
    if (!content.trim()) continue;
    out.push({ provider: provider as ComedyProvider, content: content.trim() });
  }
  return out;
}
