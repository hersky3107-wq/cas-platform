import type { SupabaseClient } from "@supabase/supabase-js";
import { MODEL_BY_PROVIDER, runSingleAiProvider, type AiProviderName } from "@/lib/ai/router";

export type TaleProvider = AiProviderName;

export const TALE_PROVIDERS: TaleProvider[] = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "deepseek",
  "mistral",
];

export const TALE_LABEL: Record<TaleProvider, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
  xai: "Grok",
  deepseek: "DeepSeek",
  mistral: "Mistral",
};

function qualityMandateBlock() {
  return `QUALITY MANDATE:
- First sentence must hook immediately.
  No scene-setting. Start in the middle of something.
- Every paragraph must advance the story or deepen character.
  Cut anything decorative.
- The ending must be inevitable in hindsight
  but surprising in the moment.
- Specific details beat vague description every time.
  Not "an old house" but "a house where the mailbox
  still had her dead husband's name on it."
- Earn every emotion. Do not tell the reader how to feel.`;
}

function endingLawBlock() {
  return `ENDING LAW:
Your final paragraph must be a complete, resonant ending.
It must feel like an ending — not a cliffhanger setup,
not a "to be continued" hint, not an open question
that goes nowhere.
The reader must feel the story is finished.
Sad Story: end with emotional weight.
Romance: end with resolution or meaningful ambiguity.
Fairy Tale: end with consequence or transformation.
Horror: end with dread or revelation.
Absurd: end with a final absurd twist that closes the loop.
Sci-Fi: end with a discovery or decision that lands.
Mystery: end with the mystery solved or deliberately
  reframed — never just abandoned.`;
}

function forbiddenMetaBlock() {
  return `FORBIDDEN OUTPUT:
Never include word counts, character counts, or any meta-text
in your response. Examples of what is forbidden:
- (Word count: 350)
- (총 497자)
- [End of story]
- Any bracketed or parenthetical notes about your writing
Just write the story. Nothing else.`;
}

function completionLawBlock() {
  return `COMPLETION LAW — ABSOLUTE:
You MUST write a complete story with a proper ending.
Never stop mid-sentence. Never stop mid-story.
If you are running low on space, immediately wrap up
with a closing paragraph. A complete ending is mandatory.
An unfinished story is a failed story.`;
}

function mysteryLawBlock(genre: string) {
  if (genre !== "Mystery") return "";
  return `Mystery stories need space to plant clues and resolve them.
Your target is 550~700 words. Use the space to:
- Plant at least 2 specific clues early
- Build genuine tension in the middle
- Deliver a satisfying, specific resolution at the end
The ending must answer the central mystery completely.`;
}

function absurdLawBlock(genre: string) {
  if (genre !== "Absurd") return "";
  return `ABSURD LAW:
Start with one completely impossible premise stated as normal fact.
Escalate logically from that premise — each consequence
follows from the last, even if absurd.
The ending must circle back to the original premise
and reframe it with a final absurd twist.
The humor comes from internal logical consistency,
not random chaos.
Think: Kafka, not nonsense.`;
}

function lengthBlock(genre: string) {
  if (genre === "Mystery") {
    return `LENGTH: 550~700 words. Count before submitting.
Mystery stories need space to plant clues and resolve them.
Use it well. Every sentence must earn its place.`;
  }
  return `LENGTH: 400~550 words. Count before submitting.
This is enough space for a full narrative arc.
Use it well. Every sentence must earn its place.`;
}

export function taleSystemPrompt(input: { genre: string; language: string }) {
  const lang = (input.language ?? "").trim() || "English";
  const genre = (input.genre ?? "").trim();
  return `You are a master storyteller. Write a short story in the requested genre.
This is your only job — tell a great story.

${qualityMandateBlock()}

${lengthBlock(genre)}

CUTOFF LAW:
You must end with a complete, final sentence.
Never stop mid-sentence. If you are running out of space,
wrap up immediately with a closing sentence.
An incomplete story is a failed story.

${completionLawBlock()}

${forbiddenMetaBlock()}

${endingLawBlock()}

ORIGINALITY LAW:
You are one of 6 AIs writing on the same genre.
You MUST choose a completely unique setting, character,
and central situation.
FORBIDDEN themes for this session (avoid entirely):
- Pigs, farms, or barnyard animals
- Forests at night with monsters
- Grandmothers or deceased relatives calling
- Magical soup or food with powers
- Closets or wardrobes with creatures inside
Choose something fresh. Unexpected. Specific.
The more specific your setting and character,
the better the story.

STORY SOURCES — STRICT COPYRIGHT RULES:
You may draw inspiration from:
- Ancient myths, folklore, legends (Greek, Norse, Asian, African)
- Fairy tales published before 1925 (Brothers Grimm originals, Hans Christian Andersen originals)
- Completely original stories you create from scratch
NEVER:
- Reference Disney versions of any story
- Reproduce any modern copyrighted work
- Use characters or plots from post-1925 literature or film

GENRE LAW:
Fully commit to the requested genre.

${mysteryLawBlock(genre)}

${absurdLawBlock(genre)}

FORMAT:
Prose only. No titles, no headers, no chapter markers.
No markdown formatting.
Just the story. Start immediately.

LANGUAGE LAW — ABSOLUTE:
Write this entire story in ${lang} only.
No mixing. No other language whatsoever.`;
}

export type TaleStoryResult = {
  provider: TaleProvider;
  model: string;
  story: string | null;
  responseTimeMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  error?: string;
};

export type TaleTransportContext = {
  supabase: SupabaseClient;
  sessionId: string;
  userId: string | null;
  supabaseAccessToken?: string;
};

function buildUserPrompt(input: { genre: string; keyword?: string | null }) {
  const kw = input.keyword?.trim();
  if (kw) {
    return `Genre: ${input.genre}. Additional element to include: ${kw}. Write your story now.`;
  }
  return `Genre: ${input.genre}. Write your story now.`;
}

export function* providersInOrder() {
  for (const p of TALE_PROVIDERS) yield p;
}

export async function* iterateTaleStories(input: {
  genre: string;
  keyword?: string | null;
  language: string;
  ctx: TaleTransportContext;
  maxTokens?: number;
}): AsyncGenerator<TaleStoryResult, void, unknown> {
  const { ctx } = input;
  const prompt = buildUserPrompt({ genre: input.genre, keyword: input.keyword });
  const maxTokens = typeof input.maxTokens === "number" ? input.maxTokens : 1200;

  const sanitizeStoryText = (raw: string | null | undefined) => {
    if (!raw) return raw ?? null;
    const lang = (input.language ?? "").trim().toLowerCase();
    const isKorean = lang.includes("korean") || lang.includes("한국") || lang.includes("korea") || lang === "ko";

    let s = raw.normalize("NFC");
    // Remove Unicode replacement chars / common encoding artifacts.
    s = s.replace(/\uFFFD/g, "");
    s = s.replace(/�/g, "");

    // If user requested Korean output, strip stray Han/Hiragana/Katakana artifacts.
    if (isKorean) {
      // eslint-disable-next-line no-control-regex
      s = s.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu, "");
    }

    // Collapse excessive whitespace introduced by removals.
    s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return s || null;
  };

  // Parallel generation; yield each as it completes (consumer may choose not to reveal until the end).
  const inflight = new Map<TaleProvider, Promise<TaleStoryResult>>(
    TALE_PROVIDERS.map((provider) => {
      const pr = (async () => {
        const providerMaxTokens = provider === "anthropic" ? Math.max(1400, maxTokens) : maxTokens;
        const res = await runSingleAiProvider({
          supabase: ctx.supabase,
          sessionId: ctx.sessionId,
          userId: ctx.userId,
          provider,
          prompt,
          systemPrompt: taleSystemPrompt({ genre: input.genre, language: input.language }),
          supabaseAccessToken: ctx.supabaseAccessToken,
          // Claude: keep sampling params unset; others can use a mild temperature.
          temperature: provider === "anthropic" ? undefined : 0.8,
          maxCompletionTokens: providerMaxTokens,
          aiResponseExtras: {
            tale_genre: input.genre,
            tale_keyword: input.keyword ?? null,
            tale_language: input.language,
          },
        });
        return {
          provider,
          model: res.model ?? MODEL_BY_PROVIDER[provider],
          story: sanitizeStoryText(res.text),
          responseTimeMs: res.responseTimeMs,
          promptTokens: res.promptTokens,
          completionTokens: res.completionTokens,
          totalTokens: res.totalTokens,
          error: res.error,
        } satisfies TaleStoryResult;
      })();
      return [provider, pr] as const;
    })
  );

  while (inflight.size) {
    const next = await Promise.race(
      [...inflight.entries()].map(([provider, pr]) => pr.then((r) => ({ provider, r })))
    );
    inflight.delete(next.provider);
    yield next.r;
  }
}

