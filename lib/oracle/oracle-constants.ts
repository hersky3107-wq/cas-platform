import type { AiProviderName } from '@/lib/ai/router'

/** Six parallel oracle readers (includes OpenAI gpt-4o). */
export const ORACLE_READER_ORDER: AiProviderName[] = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'deepseek',
  'mistral',
]

export const ORACLE_SESSION_COST = 8
export const ORACLE_READER_MAX_TOKENS = 600
export const ORACLE_CLAUDE_MAX_TOKENS = 800
export const ORACLE_SYNTH_MAX_TOKENS = 1500
/** OpenAI model id for oracle synthesis */
export const ORACLE_SYNTH_MODEL = 'gpt-4.1'
