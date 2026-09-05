import type { PrismColor } from '@/lib/oracle/engines/prism/tables'

/**
 * Display swatches for PRISM colour chips. Named pigments, not engine scores.
 * Onyx reads as black; ivory/pearl as white. Dark chips keep a light border
 * in the UI so they remain visible on the oracle background.
 */
export const PRISM_COLOR_HEX: Record<PrismColor, string> = {
  crimson: '#9B1B30',
  scarlet: '#FF2400',
  amber: '#FFBF00',
  gold: '#D4AF37',
  coral: '#FF7F50',
  rose: '#E8A0BF',
  azure: '#007FFF',
  indigo: '#4B0082',
  violet: '#7F00FF',
  teal: '#008080',
  sage: '#9CAF88',
  slate: '#708090',
  ochre: '#CC7722',
  olive: '#808000',
  bronze: '#CD7F32',
  sand: '#C2B280',
  ivory: '#FFFFF0',
  pearl: '#F7F4EC',
  silver: '#C0C0C0',
  mint: '#98FF98',
  onyx: '#111111',
  plum: '#8E4585',
  navy: '#000080',
  ember: '#C04000',
}

export const PRISM_COLOR_KO: Record<PrismColor, string> = {
  crimson: '진홍',
  scarlet: '주홍',
  amber: '호박',
  gold: '금색',
  coral: '산호',
  rose: '장미',
  azure: '하늘',
  indigo: '남색',
  violet: '보라',
  teal: '청록',
  sage: '세이지',
  slate: '슬레이트',
  ochre: '황토',
  olive: '올리브',
  bronze: '청동',
  sand: '모래',
  ivory: '아이보리',
  pearl: '진주',
  silver: '은색',
  mint: '민트',
  onyx: '오닉스',
  plum: '자두',
  navy: '네이비',
  ember: '잔불',
}
