/** Shared SYNOD debater identity — keys, brand names, colors. Imported by the
 * mode page and the result panel so both stay in sync. */

export type SynodProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "deepseek"
  | "mistral";

/** Debater order: chatgpt, claude, gemini, grok, deepseek, mistral — as the
 * provider keys /api/synod expects. */
export const DEBATERS: SynodProvider[] = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "deepseek",
  "mistral",
];

export const BRAND: Record<SynodProvider, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
  xai: "Grok",
  deepseek: "DeepSeek",
  mistral: "Mistral",
};

/** Brand colors (mirrors Arena's palette; xai light gray for dark bg). */
export const AI_COLORS: Record<SynodProvider, string> = {
  openai: "#10A37F",
  anthropic: "#D97757",
  google: "#4285F4",
  xai: "#E5E7EB",
  deepseek: "#4D6BFE",
  mistral: "#FF7000",
};

export function isSynodProvider(s: string): s is SynodProvider {
  return (DEBATERS as string[]).includes(s);
}
