/**
 * JEJU diagnostic (진단형) — client-safe category definitions.
 *
 * Pure constants and types — NO server imports, NO connectors, NO 'server-only'.
 * Safe to import from both 'use client' pages and server-side engine files.
 *
 * diagnostic.ts (engine) imports FROM this file.
 * diagnostic/page.tsx (client) imports FROM this file.
 */

export type DiagnosticCategory = {
  id: string
  emoji: string
  label: string
  /** Preset open question fired when the button is clicked. */
  presetQuestion: string
  /** Seed phrase for the Perplexity status search. */
  searchSeed: string
  /** True when live connectors directly back this category; else search-reliant. */
  dataBacked: boolean
}

/** 10 governance categories (no 언론·여론 — that is the separate media mode). */
export const DIAGNOSTIC_CATEGORIES: DiagnosticCategory[] = [
  {
    id: 'energy',
    emoji: '🔋',
    label: '에너지·계통',
    presetQuestion: '오늘 제주 에너지·계통 현황과 가장 시급한 현안은?',
    searchSeed: '제주 전력 계통 수급 SMP 재생에너지 출력제어 최신 현황',
    dataBacked: true,
  },
  {
    id: 'agri',
    emoji: '🌾',
    label: '농수산·감귤',
    presetQuestion: '오늘 제주 농수산·감귤 현황과 가장 시급한 현안은?',
    searchSeed: '제주 감귤 농수산물 시세 작황 최신 동향',
    dataBacked: true,
  },
  {
    id: 'tourism',
    emoji: '🏝',
    label: '관광',
    presetQuestion: '오늘 제주 관광 현황과 가장 시급한 현안은?',
    searchSeed: '제주 관광객 내국인 외국인 입도 동향 최신',
    dataBacked: true,
  },
  {
    id: 'climate',
    emoji: '🌦',
    label: '기후·재난',
    presetQuestion: '오늘 제주 기후·재난 현황과 가장 시급한 현안은?',
    searchSeed: '제주 기상 특보 태풍 호우 재난 안전 최신',
    dataBacked: true,
  },
  {
    id: 'prices',
    emoji: '💰',
    label: '물가·민생',
    presetQuestion: '오늘 제주 물가·민생 현황과 가장 시급한 현안은?',
    searchSeed: '제주 생활물가 장바구니 민생 경제 최신 동향',
    dataBacked: true,
  },
  {
    id: 'logistics',
    emoji: '🚢',
    label: '물류·교통',
    presetQuestion: '오늘 제주 물류·교통 현황과 가장 시급한 현안은?',
    searchSeed: '제주 항만 물동량 교통 대중교통 물류 최신 현황',
    dataBacked: true,
  },
  {
    id: 'industry',
    emoji: '🏭',
    label: '산업·수출',
    presetQuestion: '오늘 제주 산업·수출 현황과 가장 시급한 현안은?',
    searchSeed: '제주 수출 산업 반도체 제조 최신 실적 동향',
    dataBacked: true,
  },
  {
    id: 'construction',
    emoji: '🏗',
    label: '건설·주택',
    presetQuestion: '오늘 제주 건설·주택 현황과 가장 시급한 현안은?',
    searchSeed: '제주 건설 경기 주택 부동산 분양 최신 동향',
    dataBacked: false,
  },
  {
    id: 'environment',
    emoji: '♻️',
    label: '환경·자원순환',
    presetQuestion: '오늘 제주 환경·자원순환(폐기물) 현황과 가장 시급한 현안은?',
    searchSeed: '제주 폐기물 자원순환 재활용 쓰레기 처리 최신 현황',
    dataBacked: false,
  },
  {
    id: 'education',
    emoji: '🎓',
    label: '교육',
    presetQuestion: '오늘 제주 교육 현황과 가장 시급한 현안은?',
    searchSeed: '제주 교육 학교 학생 정책 최신 동향',
    dataBacked: false,
  },
]

export function getDiagnosticCategory(id: string): DiagnosticCategory | undefined {
  return DIAGNOSTIC_CATEGORIES.find((c) => c.id === id)
}
