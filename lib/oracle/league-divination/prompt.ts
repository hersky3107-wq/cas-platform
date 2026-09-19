/**
 * Single-reader prompt. 4–5 lines of PURE DIVINATION REASONING.
 * The code already decided the verdict — the model explains it.
 */
import { MARKET_LANGUAGE_BAN } from './parse-reader'
import {
  LEAGUE_READER_LINE_MAX,
  LEAGUE_READER_LINE_MIN,
  LEAGUE_READER_RATIONALE_MAX_CHARS,
} from './conventions'
import type { LeagueReaderCompactPack } from './compact-pack'

export const LEAGUE_READER_PROMPT_VERSION = 'league-reader-v1'

export const LEAGUE_READER_STRICT_RETRY =
  `\n\nSTRICT RETRY: Output ONLY ${LEAGUE_READER_LINE_MIN}–${LEAGUE_READER_LINE_MAX} Korean lines of divination reasoning. No JSON preamble, no title, no market words. Explain the CODE verdict already given. Do not vote.`

export function buildLeagueReaderSystemPrompt(): string {
  const ban = MARKET_LANGUAGE_BAN.join(', ')
  return [
    'You are a divination reader. The CODE already computed a binary verdict from 육효, 타로, 룬, and 사주 택일.',
    'Write ONLY the rationale. Do not decide or restate a vote as if it were yours.',
    `Output exactly ${LEAGUE_READER_LINE_MIN} or ${LEAGUE_READER_LINE_MAX} lines of Korean prose, each on its own line. Hard cap ${LEAGUE_READER_RATIONALE_MAX_CHARS} Unicode characters total.`,
    'Speak in the systems\' own terms: 본괘/변괘/용신/월령, 타로 패와 정역, 룬 정역, 택일 일진·월건·용신 오행. 점성술 and 구성 are display-only — mention them at most as colour, never as a vote.',
    `HARD BAN — never use these words or English equivalents: ${ban}.`,
    'The 택일 label is 택일, never 명리. Do not mention 대운 or a person\'s 일간.',
    'Do not mention prices, markets, news, or what will happen to money. Reason only from the charts.',
    'If hourPin.applied is true, you may note that the 야자시 hour was read as the previous hour so the day pillar does not fork — do not invent another reason.',
  ].join('\n')
}

export function buildLeagueReaderUserPrompt(pack: LeagueReaderCompactPack): string {
  return [
    `CODE VERDICT (do not change this): ${pack.codeVerdict}`,
    `Proposition: ${pack.proposition}`,
    `Subject: ${pack.subjectName}`,
    `Category: ${pack.category}`,
    `Seoul clock: ${pack.seoul.date} ${pack.seoul.time} ${pack.seoul.tz}`,
    `hourPin: ${JSON.stringify(pack.hourPin)}`,
    `Charts: ${JSON.stringify({
      iching: pack.iching,
      tarot: pack.tarot,
      runes: pack.runes,
      taeil: pack.taeil,
      astro: pack.astro,
      ninestar: pack.ninestar,
      votes: pack.votes,
    })}`,
    `Write ${LEAGUE_READER_LINE_MIN}–${LEAGUE_READER_LINE_MAX} lines explaining why the code verdict follows from these charts.`,
  ].join('\n')
}
