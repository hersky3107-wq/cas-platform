/**
 * AI Prediction League — Roster Seats Registry (`lib/league/seats.ts`).
 *
 * A "Seat" is a permanent competitive roster slot (e.g. `premier:openai`,
 * `challenger:meta`, `world:thinking-machines`). A seat decouples the fixed
 * league slot from the specific AI model occupying it over time.
 *
 * This provides:
 *  1. Track-record continuity across model swaps (official league ranking).
 *  2. Individual model benchmark retention (flagship vs compact analysis).
 *  3. Historical tenure archiving (retired models, W-L records, swap reasons).
 */

import type { LeagueTier } from './roster'

export interface ModelTenure {
  /** Model ID used in predictions (e.g. 'k-exaone-2.0', 'gpt-5.6-sol'). */
  modelId: string
  /** Human-readable model version / alias (e.g. 'EXAONE 2.0', 'GPT-5.6 Sol'). */
  modelLabel: string
  /** Date when this model began occupying this seat (YYYY-MM-DD). */
  activeFrom: string
  /** Date when this model was retired from this seat (YYYY-MM-DD), if applicable. */
  retiredAt?: string
  /** Stated operational reason for retirement/swap. */
  reason?: string
}

export interface LeagueSeat {
  /** Unique seat identifier, e.g. 'premier:openai', 'world:thinking-machines'. */
  seatId: string
  /** League tier or category. */
  tier: LeagueTier | 'extra'
  /** Operating brand / organization. */
  brand: string
  /** Brand slug used in seat identifier. */
  brandSlug: string
  /** Regional camp. */
  camp: 'us' | 'china' | 'other'
  /** Current active model identifier. */
  currentModelId: string
  /** Official seat display label (e.g. 'OpenAI 1부', 'Thinking Machines 3부'). */
  displayName: string
  /** History of models occupying this seat, ordered chronologically. */
  tenures: ModelTenure[]
}

export interface SeatSwapStatus {
  isSwapped: boolean
  currentModelId: string
  currentModelLabel: string
  lastSwapDate?: string
  pastTenuresCount: number
}

export interface RetiredTenureArchiveEntry {
  seatId: string
  seatLabel: string
  tier: LeagueTier | 'extra'
  brand: string
  modelId: string
  modelLabel: string
  activeFrom: string
  retiredAt: string
  reason?: string
}

export const LEAGUE_SEATS: readonly LeagueSeat[] = [
  // ==========================================================================
  // PREMIER (1부 - 10 Seats)
  // ==========================================================================
  {
    seatId: 'premier:openai',
    tier: 'premier',
    brand: 'OpenAI',
    brandSlug: 'openai',
    camp: 'us',
    currentModelId: 'gpt-6-astra',
    displayName: 'OpenAI 1부',
    tenures: [
      {
        modelId: 'gpt-5.6-sol',
        modelLabel: 'GPT-5.6 Sol',
        activeFrom: '2026-08-01',
        retiredAt: '2026-09-27',
        reason: 'GPT-6 Astra flagship launch',
      },
      {
        modelId: 'gpt-6-astra',
        modelLabel: 'GPT-6 Astra',
        activeFrom: '2026-09-27',
      },
    ],
  },
  {
    seatId: 'premier:anthropic',
    tier: 'premier',
    brand: 'Anthropic',
    brandSlug: 'anthropic',
    camp: 'us',
    currentModelId: 'claude-fable-5.1',
    displayName: 'Anthropic 1부',
    tenures: [
      {
        modelId: 'claude-fable-5',
        modelLabel: 'Claude Fable 5',
        activeFrom: '2026-08-01',
        retiredAt: '2026-09-27',
        reason: 'Claude Fable 5.1 flagship update',
      },
      {
        modelId: 'claude-fable-5.1',
        modelLabel: 'Claude Fable 5.1',
        activeFrom: '2026-09-27',
      },
    ],
  },
  {
    seatId: 'premier:google',
    tier: 'premier',
    brand: 'Google',
    brandSlug: 'google',
    camp: 'us',
    currentModelId: 'gemini-3.1-pro',
    displayName: 'Google 1부',
    tenures: [
      {
        modelId: 'gemini-3.1-pro',
        modelLabel: 'Gemini 3.1 Pro',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'premier:xai',
    tier: 'premier',
    brand: 'xAI',
    brandSlug: 'xai',
    camp: 'us',
    currentModelId: 'grok-4.7',
    displayName: 'xAI 1부',
    tenures: [
      {
        modelId: 'grok-4.5',
        modelLabel: 'Grok 4.5',
        activeFrom: '2026-08-01',
        retiredAt: '2026-09-27',
        reason: 'Grok 4.7 flagship launch (2026-09-21)',
      },
      {
        modelId: 'grok-4.7',
        modelLabel: 'Grok 4.7',
        activeFrom: '2026-09-27',
      },
    ],
  },
  {
    seatId: 'premier:meta-muse',
    tier: 'premier',
    brand: 'Meta / Muse',
    brandSlug: 'meta-muse',
    camp: 'us',
    currentModelId: 'muse-spark-1.2',
    displayName: 'Meta / Muse 1부',
    tenures: [
      {
        modelId: 'muse-spark-1.2',
        modelLabel: 'Muse Spark 1.2',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'premier:qwen',
    tier: 'premier',
    brand: 'Alibaba Qwen',
    brandSlug: 'qwen',
    camp: 'china',
    currentModelId: 'qwen3.8-max',
    displayName: 'Alibaba Qwen 1부',
    tenures: [
      {
        modelId: 'qwen3.8-max',
        modelLabel: 'Qwen 3.8 Max',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'premier:deepseek',
    tier: 'premier',
    brand: 'DeepSeek',
    brandSlug: 'deepseek',
    camp: 'china',
    currentModelId: 'deepseek-v4-pro',
    displayName: 'DeepSeek 1부',
    tenures: [
      {
        modelId: 'deepseek-v4-pro',
        modelLabel: 'DeepSeek V4 Pro',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'premier:moonshot-ai',
    tier: 'premier',
    brand: 'Moonshot AI',
    brandSlug: 'moonshot-ai',
    camp: 'china',
    currentModelId: 'kimi-k3',
    displayName: 'Moonshot AI 1부',
    tenures: [
      {
        modelId: 'kimi-k3',
        modelLabel: 'Kimi K3',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'premier:z-ai',
    tier: 'premier',
    brand: '01.AI',
    brandSlug: 'z-ai',
    camp: 'china',
    currentModelId: 'glm-5.3',
    displayName: '01.AI 1부',
    tenures: [
      {
        modelId: 'glm-5.2',
        modelLabel: 'GLM 5.2',
        activeFrom: '2026-08-01',
        retiredAt: '2026-09-27',
        reason: 'GLM 5.3 current flagship',
      },
      {
        modelId: 'glm-5.3',
        modelLabel: 'GLM 5.3',
        activeFrom: '2026-09-27',
      },
    ],
  },
  {
    seatId: 'premier:minimax',
    tier: 'premier',
    brand: 'MiniMax',
    brandSlug: 'minimax',
    camp: 'china',
    currentModelId: 'minimax-m3',
    displayName: 'MiniMax 1부',
    tenures: [
      {
        modelId: 'minimax-m3',
        modelLabel: 'MiniMax M3',
        activeFrom: '2026-08-01',
      },
    ],
  },

  // ==========================================================================
  // CHALLENGER (2부 - 10 Seats)
  // ==========================================================================
  {
    seatId: 'challenger:openai',
    tier: 'challenger',
    brand: 'OpenAI',
    brandSlug: 'openai',
    camp: 'us',
    currentModelId: 'gpt-5.6-terra',
    displayName: 'OpenAI 2부',
    tenures: [
      {
        modelId: 'gpt-5.6-terra',
        modelLabel: 'GPT-5.6 Terra',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'challenger:anthropic',
    tier: 'challenger',
    brand: 'Anthropic',
    brandSlug: 'anthropic',
    camp: 'us',
    currentModelId: 'claude-sonnet-5',
    displayName: 'Anthropic 2부',
    tenures: [
      {
        modelId: 'claude-sonnet-5',
        modelLabel: 'Claude Sonnet 5',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'challenger:google',
    tier: 'challenger',
    brand: 'Google',
    brandSlug: 'google',
    camp: 'us',
    currentModelId: 'gemini-3.6-flash',
    displayName: 'Google 2부',
    tenures: [
      {
        modelId: 'gemini-3.6-flash',
        modelLabel: 'Gemini 3.6 Flash',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'challenger:xai',
    tier: 'challenger',
    brand: 'xAI',
    brandSlug: 'xai',
    camp: 'us',
    currentModelId: 'grok-4.3',
    displayName: 'xAI 2부',
    tenures: [
      {
        modelId: 'grok-4.3',
        modelLabel: 'Grok 4.3',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'challenger:nvidia',
    tier: 'challenger',
    brand: 'NVIDIA',
    brandSlug: 'nvidia',
    camp: 'us',
    currentModelId: 'nemotron-3-ultra-550b',
    displayName: 'NVIDIA 2부',
    tenures: [
      {
        modelId: 'nemotron-3-ultra-550b',
        modelLabel: 'Nemotron 3 Ultra 550B',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'challenger:mistral',
    tier: 'challenger',
    brand: 'Mistral AI',
    brandSlug: 'mistral',
    camp: 'other',
    currentModelId: 'mistral-medium-3.5',
    displayName: 'Mistral AI 2부',
    tenures: [
      {
        modelId: 'mistral-medium-3.5',
        modelLabel: 'Mistral Medium 3.5',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'challenger:cohere',
    tier: 'challenger',
    brand: 'Cohere',
    brandSlug: 'cohere',
    camp: 'other',
    currentModelId: 'command-a',
    displayName: 'Cohere 2부',
    tenures: [
      {
        modelId: 'command-a',
        modelLabel: 'Command A',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'challenger:deepseek',
    tier: 'challenger',
    brand: 'DeepSeek',
    brandSlug: 'deepseek',
    camp: 'china',
    currentModelId: 'deepseek-flash',
    displayName: 'DeepSeek 2부',
    tenures: [
      {
        modelId: 'deepseek-v3.2',
        modelLabel: 'DeepSeek V3.2',
        activeFrom: '2026-08-01',
        retiredAt: '2026-09-18',
        reason: 'DeepSeek first-party Flash 모델 출시로 교체',
      },
      {
        modelId: 'deepseek-flash',
        modelLabel: 'DeepSeek Flash',
        activeFrom: '2026-09-18',
      },
    ],
  },
  {
    seatId: 'challenger:tencent',
    tier: 'challenger',
    brand: 'Tencent',
    brandSlug: 'tencent',
    camp: 'china',
    currentModelId: 'hunyuan-3',
    displayName: 'Tencent 2부',
    tenures: [
      {
        modelId: 'kimi-k2.6',
        modelLabel: 'Kimi K2.6',
        activeFrom: '2026-08-01',
        retiredAt: '2026-09-18',
        reason: 'Tencent Hunyuan 3 공식 도입으로 교체',
      },
      {
        modelId: 'hunyuan-3',
        modelLabel: 'Hunyuan 3',
        activeFrom: '2026-09-18',
      },
    ],
  },
  {
    seatId: 'challenger:meta',
    tier: 'challenger',
    brand: 'Meta',
    brandSlug: 'meta',
    camp: 'us',
    currentModelId: 'llama-4-maverick',
    displayName: 'Meta 2부',
    tenures: [
      {
        modelId: 'qwen3.5-plus',
        modelLabel: 'Qwen 3.5 Plus',
        activeFrom: '2026-08-01',
        retiredAt: '2026-09-20',
        reason: 'Meta Llama 4 Maverick 도입으로 교체',
      },
      {
        modelId: 'llama-4-maverick',
        modelLabel: 'Llama 4 Maverick',
        activeFrom: '2026-09-20',
      },
    ],
  },

  // ==========================================================================
  // WORLD (3부 - 14 Seats)
  // ==========================================================================
  {
    seatId: 'world:openai',
    tier: 'world',
    brand: 'OpenAI',
    brandSlug: 'openai',
    camp: 'us',
    currentModelId: 'gpt-5.6-luna',
    displayName: 'OpenAI 3부',
    tenures: [
      {
        modelId: 'gpt-5.6-luna',
        modelLabel: 'GPT-5.6 Luna',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'world:anthropic',
    tier: 'world',
    brand: 'Anthropic',
    brandSlug: 'anthropic',
    camp: 'us',
    currentModelId: 'claude-haiku-4.5',
    displayName: 'Anthropic 3부',
    tenures: [
      {
        modelId: 'claude-haiku-4.5',
        modelLabel: 'Claude Haiku 4.5',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'world:google',
    tier: 'world',
    brand: 'Google',
    brandSlug: 'google',
    camp: 'us',
    currentModelId: 'gemini-3.5-flash-lite',
    displayName: 'Google 3부',
    tenures: [
      {
        modelId: 'gemini-3.5-flash-lite',
        modelLabel: 'Gemini 3.5 Flash-Lite',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'world:amazon',
    tier: 'world',
    brand: 'Amazon',
    brandSlug: 'amazon',
    camp: 'us',
    currentModelId: 'nova-2-lite',
    displayName: 'Amazon 3부',
    tenures: [
      {
        modelId: 'nova-2-lite',
        modelLabel: 'Nova 2 Lite',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'world:microsoft',
    tier: 'world',
    brand: 'Microsoft',
    brandSlug: 'microsoft',
    camp: 'us',
    currentModelId: 'phi-4',
    displayName: 'Microsoft 3부',
    tenures: [
      {
        modelId: 'phi-4',
        modelLabel: 'Phi-4',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'world:deepseek',
    tier: 'world',
    brand: 'DeepSeek',
    brandSlug: 'deepseek',
    camp: 'china',
    currentModelId: 'deepseek-v4-flash',
    displayName: 'DeepSeek 3부',
    tenures: [
      {
        modelId: 'deepseek-v4-flash',
        modelLabel: 'DeepSeek V4 Flash',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'world:qwen',
    tier: 'world',
    brand: 'Alibaba Qwen',
    brandSlug: 'qwen',
    camp: 'china',
    currentModelId: 'qwen3.5-flash',
    displayName: 'Alibaba Qwen 3부',
    tenures: [
      {
        modelId: 'qwen3.5-flash',
        modelLabel: 'Qwen 3.5 Flash',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'world:xiaomi',
    tier: 'world',
    brand: 'Xiaomi',
    brandSlug: 'xiaomi',
    camp: 'china',
    currentModelId: 'mimo-v2.5',
    displayName: 'Xiaomi 3부',
    tenures: [
      {
        modelId: 'mimo-v2.5',
        modelLabel: 'MiMo v2.5',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'world:upstage',
    tier: 'world',
    brand: 'Upstage',
    brandSlug: 'upstage',
    camp: 'other',
    currentModelId: 'solar-pro3',
    displayName: 'Upstage 3부',
    tenures: [
      {
        modelId: 'solar-pro3',
        modelLabel: 'Solar Pro 3',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'world:naver',
    tier: 'world',
    brand: 'NAVER',
    brandSlug: 'naver',
    camp: 'other',
    currentModelId: 'hcx-007',
    displayName: 'NAVER 3부',
    tenures: [
      {
        modelId: 'hcx-007',
        modelLabel: 'HyperCLOVA X 007',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'world:thinking-machines',
    tier: 'world',
    brand: 'Thinking Machines',
    brandSlug: 'thinking-machines',
    camp: 'other',
    currentModelId: 'inkling',
    displayName: 'Thinking Machines 3부',
    tenures: [
      {
        modelId: 'k-exaone-2.0',
        modelLabel: 'EXAONE 2.0',
        activeFrom: '2026-08-01',
        retiredAt: '2026-09-07',
        reason: 'EXAONE 2.0 퇴역 및 Inkling 영입',
      },
      {
        modelId: 'inkling',
        modelLabel: 'Inkling',
        activeFrom: '2026-09-07',
      },
    ],
  },
  {
    seatId: 'world:google-gemma',
    tier: 'world',
    brand: 'Google',
    brandSlug: 'google-gemma',
    camp: 'us',
    currentModelId: 'gemma-4-31b-it',
    displayName: 'Google Gemma 3부',
    tenures: [
      {
        modelId: 'ernie-4.5-vl',
        modelLabel: 'ERNIE 4.5 VL',
        activeFrom: '2026-08-01',
        retiredAt: '2026-09-07',
        reason: 'Baidu ERNIE API 지원 중단 및 Gemma 4 영입',
      },
      {
        modelId: 'gemma-4-31b-it',
        modelLabel: 'Gemma 4 31B',
        activeFrom: '2026-09-07',
      },
    ],
  },
  {
    seatId: 'world:mistral',
    tier: 'world',
    brand: 'Mistral AI',
    brandSlug: 'mistral',
    camp: 'other',
    currentModelId: 'mistral-small-3.2-24b',
    displayName: 'Mistral AI 3부',
    tenures: [
      {
        modelId: 'granite-4.2-8b',
        modelLabel: 'Granite 4.2 8B',
        activeFrom: '2026-08-01',
        retiredAt: '2026-09-15',
        reason: 'Granite 4.2 퇴역 및 Mistral Small 3.2 영입',
      },
      {
        modelId: 'mistral-small-3.2-24b',
        modelLabel: 'Mistral Small 3.2 24B',
        activeFrom: '2026-09-15',
      },
    ],
  },
  {
    seatId: 'world:bytedance',
    tier: 'world',
    brand: 'ByteDance',
    brandSlug: 'bytedance',
    camp: 'china',
    currentModelId: 'seed-1.6',
    displayName: 'ByteDance 3부',
    tenures: [
      {
        modelId: 'seed-1.6',
        modelLabel: 'Seed 1.6',
        activeFrom: '2026-08-01',
      },
    ],
  },

  // ==========================================================================
  // SCOUT (탐색부 - 6 Seats)
  // ==========================================================================
  {
    seatId: 'scout:openai',
    tier: 'scout',
    brand: 'OpenAI',
    brandSlug: 'openai',
    camp: 'us',
    currentModelId: 'gpt-5-search-api',
    displayName: 'OpenAI 탐색부',
    tenures: [
      {
        modelId: 'gpt-5-search-api',
        modelLabel: 'GPT-5 Search',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'scout:google',
    tier: 'scout',
    brand: 'Google',
    brandSlug: 'google',
    camp: 'us',
    currentModelId: 'gemini-3.6-flash-grounded',
    displayName: 'Google 탐색부',
    tenures: [
      {
        modelId: 'gemini-3.6-flash-grounded',
        modelLabel: 'Gemini 3.6 Flash Grounded',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'scout:xai',
    tier: 'scout',
    brand: 'xAI',
    brandSlug: 'xai',
    camp: 'us',
    currentModelId: 'grok-4.6-livesearch',
    displayName: 'xAI 탐색부',
    tenures: [
      {
        modelId: 'grok-4.6-livesearch',
        modelLabel: 'Grok 4.6 LiveSearch',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'scout:anthropic',
    tier: 'scout',
    brand: 'Anthropic',
    brandSlug: 'anthropic',
    camp: 'us',
    currentModelId: 'claude-sonnet-5-websearch',
    displayName: 'Anthropic 탐색부',
    tenures: [
      {
        modelId: 'claude-sonnet-5-websearch',
        modelLabel: 'Claude Sonnet 5 WebSearch',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'scout:perplexity',
    tier: 'scout',
    brand: 'Perplexity',
    brandSlug: 'perplexity',
    camp: 'us',
    currentModelId: 'sonar-reasoning-pro',
    displayName: 'Perplexity 탐색부',
    tenures: [
      {
        modelId: 'sonar-reasoning-pro',
        modelLabel: 'Sonar Reasoning Pro',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'scout:youcom',
    tier: 'scout',
    brand: 'You.com',
    brandSlug: 'youcom',
    camp: 'us',
    currentModelId: 'youcom-research',
    displayName: 'You.com 탐색부',
    tenures: [
      {
        modelId: 'youcom-research',
        modelLabel: 'You.com Research',
        activeFrom: '2026-08-01',
      },
    ],
  },

  // ==========================================================================
  // EXTRA (외전 - 5 Seats)
  // ==========================================================================
  {
    seatId: 'extra:divination',
    tier: 'extra',
    brand: '육효 육임 주역',
    brandSlug: 'divination',
    camp: 'other',
    currentModelId: 'divination',
    displayName: '육효/주역 엔진',
    tenures: [
      {
        modelId: 'divination',
        modelLabel: '육효/주역 엔진',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'extra:sentiment',
    tier: 'extra',
    brand: '감성 지수',
    brandSlug: 'sentiment',
    camp: 'other',
    currentModelId: 'sentiment',
    displayName: '소셜 감성 지수',
    tenures: [
      {
        modelId: 'sentiment',
        modelLabel: '소셜 감성 지수',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'extra:history',
    tier: 'extra',
    brand: '역사적 패턴',
    brandSlug: 'history',
    camp: 'other',
    currentModelId: 'history',
    displayName: '역사적 패턴 분석',
    tenures: [
      {
        modelId: 'history',
        modelLabel: '역사적 패턴 분석',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'extra:consensus',
    tier: 'extra',
    brand: '합의 예측',
    brandSlug: 'consensus',
    camp: 'other',
    currentModelId: 'consensus',
    displayName: '40개 모델 다수결',
    tenures: [
      {
        modelId: 'consensus',
        modelLabel: '40개 모델 다수결',
        activeFrom: '2026-08-01',
      },
    ],
  },
  {
    seatId: 'extra:crow',
    tier: 'extra',
    brand: '까마귀',
    brandSlug: 'crow',
    camp: 'other',
    currentModelId: 'crow',
    displayName: '까마귀',
    tenures: [
      {
        modelId: 'crow',
        modelLabel: '까마귀',
        activeFrom: '2026-09-27',
      },
    ],
  },
] as const

const SEATS_BY_ID = new Map<string, LeagueSeat>(
  LEAGUE_SEATS.map((seat) => [seat.seatId, seat])
)

/**
 * Fast lookup of a seat by seatId (e.g. 'premier:openai').
 */
export function lookupSeat(seatId: string): LeagueSeat | undefined {
  return SEATS_BY_ID.get(seatId)
}

/**
 * Returns all configured league seats.
 */
export function getAllSeats(): readonly LeagueSeat[] {
  return LEAGUE_SEATS
}

/**
 * Finds the seat for a given model ID. If tier is provided, checks tier first.
 * Checks both current model ID and past tenures.
 */
export function seatForModelId(modelId: string, tier?: string): LeagueSeat | undefined {
  if (tier) {
    const seatInTier = LEAGUE_SEATS.find(
      (s) => s.tier === tier && (s.currentModelId === modelId || s.tenures.some((t) => t.modelId === modelId))
    )
    if (seatInTier) return seatInTier
  }

  // Fallback to checking any tier where current model matches
  const currentMatch = LEAGUE_SEATS.find((s) => s.currentModelId === modelId)
  if (currentMatch) return currentMatch

  // Fallback to checking past tenures
  return LEAGUE_SEATS.find((s) => s.tenures.some((t) => t.modelId === modelId))
}

/**
 * Derives the canonical seat ID for a model prediction entry.
 */
export function seatIdForModel(modelId: string, tier?: string): string {
  const seat = seatForModelId(modelId, tier)
  if (seat) return seat.seatId

  // Fallback slug generation if unknown
  const tierSlug = tier || 'unknown'
  const cleanModel = modelId.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `${tierSlug}:${cleanModel}`
}

/**
 * Formats the official label for a seat (e.g. "OpenAI 1부").
 */
export function formatSeatLabel(seat: LeagueSeat): string {
  return seat.displayName
}

/**
 * Computes whether a seat has undergone model swaps and returns swap status.
 */
export function formatSeatSwapStatus(seat: LeagueSeat): SeatSwapStatus {
  const retiredTenures = seat.tenures.filter((t) => Boolean(t.retiredAt))
  const currentTenure = seat.tenures.find((t) => t.modelId === seat.currentModelId) || seat.tenures[seat.tenures.length - 1]
  const isSwapped = retiredTenures.length > 0

  return {
    isSwapped,
    currentModelId: seat.currentModelId,
    currentModelLabel: currentTenure?.modelLabel ?? seat.currentModelId,
    lastSwapDate: isSwapped ? currentTenure?.activeFrom : undefined,
    pastTenuresCount: retiredTenures.length,
  }
}

/**
 * Returns all retired tenures across all seats.
 */
export function getRetiredTenures(): RetiredTenureArchiveEntry[] {
  const list: RetiredTenureArchiveEntry[] = []
  for (const seat of LEAGUE_SEATS) {
    for (const tenure of seat.tenures) {
      if (tenure.retiredAt) {
        list.push({
          seatId: seat.seatId,
          seatLabel: seat.displayName,
          tier: seat.tier,
          brand: seat.brand,
          modelId: tenure.modelId,
          modelLabel: tenure.modelLabel,
          activeFrom: tenure.activeFrom,
          retiredAt: tenure.retiredAt,
          reason: tenure.reason,
        })
      }
    }
  }
  return list
}
