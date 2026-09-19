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

export const LEAGUE_READER_PROMPT_VERSION = 'league-reader-v3'

export const LEAGUE_READER_STRICT_RETRY =
  `\n\nSTRICT RETRY: Output ONLY ${LEAGUE_READER_LINE_MIN}–${LEAGUE_READER_LINE_MAX} short Korean sentences, one per line. Under 500 characters. No wrap-up. No 전망. No English. No JSON. Explain the CODE verdict. Do not vote.`

export function buildLeagueReaderSystemPrompt(): string {
  const ban = MARKET_LANGUAGE_BAN.join(', ')
  return [
    'You are a divination reader. The CODE already computed a binary verdict from 육효, 타로, 룬, and 사주 택일.',
    'Write ONLY the rationale as a reading a league viewer can follow — name the concrete piece and say what it means, the way a daily reading does. Do not dump labels. Do not decide or restate a vote as if it were yours.',
    `Output exactly ${LEAGUE_READER_LINE_MIN} or ${LEAGUE_READER_LINE_MAX} lines of Korean prose, each a single sentence on its own line. Stay under 500 Unicode characters (parser cap is ${LEAGUE_READER_RATIONALE_MAX_CHARS} — do not use it).`,
    'No sixth wrap-up line. Do not start a sentence with 종합적으로, 결론적으로, or 따라서 전체.',
    'No English. No outline. No "Thinking Process". No constraint list. The first character of the reply must be Korean.',
    'Use the Korean tarot and rune names supplied in the pack (outcomeKo, futureKo). Never write English card names (King of Swords, Ten of Cups, Gebo, Othala).',
    'Speak in the systems\' own terms, then gloss them: 본괘/변괘/용신/월령, 타로 패와 정역, 룬 정역, 택일 일진·월건·용신 오행. 점성술 and 구성 are display-only — mention them at most as colour, never as a vote.',
    `HARD BAN — never use these words, even inside a denial or the phrase "긍정적인 전망": ${ban}.`,
    'The 택일 label is 택일, never 명리. Do not mention 대운 or a person\'s 일간.',
    'Do not mention prices, markets, news, or what will happen to money. Reason only from the charts.',
    'If CODE VERDICT is down or b, do not use 상승/오를/이기/유리/길한. If it is up or a, do not use 하락/내릴/불리/흉한.',
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
    `Korean names to use: 본괘 ${pack.iching.primaryHangul}(${pack.iching.primary}), 변괘 ${pack.iching.resultingHangul}(${pack.iching.resulting}), 타로 ${pack.tarot.outcomeKo}, 룬 ${pack.runes.futureKo}`,
    `Charts: ${JSON.stringify({
      iching: pack.iching,
      tarot: pack.tarot,
      runes: pack.runes,
      taeil: pack.taeil,
      astro: pack.astro,
      ninestar: pack.ninestar,
      votes: pack.votes,
    })}`,
    `Write ${LEAGUE_READER_LINE_MIN}–${LEAGUE_READER_LINE_MAX} Korean lines explaining why the code verdict follows from these charts.`,
  ].join('\n')
}
