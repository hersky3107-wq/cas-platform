"use client";

import Link from "next/link";
import HelpModal from "@/components/HelpModal";
import { carrierHelpContent } from "@/lib/help-modal/carrier-content";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronLeft } from "lucide-react";
import { authenticatedFetch } from "@/lib/api/authenticated-fetch";
import { creditsForMindgameCareer } from "@/lib/credits";

const CARRIER_SESSION_COST = creditsForMindgameCareer();

const AI_PLAYERS = [
  { provider: "openai", name: "ChatGPT", color: "#10A37F", model: "gpt-4.1" },
  { provider: "anthropic", name: "Claude", color: "#D97757", model: "claude-sonnet-4-6" },
  { provider: "google", name: "Gemini", color: "#4285F4", model: "gemini-2.5-flash" },
  { provider: "xai", name: "Grok", color: "#1A1A1A", model: "grok-3" },
  { provider: "deepseek", name: "DeepSeek", color: "#4D6BFE", model: "deepseek-chat" },
  { provider: "mistral", name: "Mistral", color: "#FF7000", model: "mistral-large-latest" },
] as const;

const LANGUAGE_OPTIONS = [
  "English",
  "Korean",
  "Japanese",
  "Chinese",
  "Spanish",
  "French",
  "German",
  "Portuguese",
  "Arabic",
  "Hindi",
];

/** Localized UI strings — use `getCarrierUiPack(language)`; fallback English. */
type CarrierUiPack = {
  voteInvalidAlreadyRemoved: string;
  voteValidSummary: string;
  voteThresholdMet: string;
  voteThresholdNotMet: string;
  voteTwoRequiredNote: string;
  voteExpelledLine: string;
  voteNoExpulsionLine: string;
  wasZombie: string;
  wasHuman: string;
  labelEliminated: string;
  deductionBoardTitle: string;
  teamHistoryLabel: string;
  originalZombiesHeading: string;
  finalRolesHeading: string;
  finalRevealBlurb: string;
  roleZombie: string;
  roleHuman: string;
  noteCuredZombie: string;
  noteHumanInfected: string;
  humansWin: string;
  zombiesWin: string;
  gameOver: string;
  infectionHeading: string;
  infectionRule: string;
  playAgain: string;
  voteCountFmt: string;
  voteTieJoiner: string;
  voteSummaryTopOne: string;
  voteSummaryTopTie: string;
  voteTieNoExpel: string;
  voteSummaryNoVotes: string;
};

const CARRIER_UI_BY_LANG: Record<string, CarrierUiPack> = {
  English: {
    voteInvalidAlreadyRemoved: "(invalid — voter already removed)",
    voteValidSummary: "Valid votes: {n} — expulsion threshold {met}. {two}",
    voteThresholdMet: "met",
    voteThresholdNotMet: "not met",
    voteTwoRequiredNote: "2 votes required for expulsion.",
    voteExpelledLine: "Tally: {name} expelled ({tally}){role}",
    voteNoExpulsionLine: "Tally: no expulsion — tie or fewer than 2 votes on top target{tally}",
    wasZombie: " — was a zombie!",
    wasHuman: " — was human…",
    labelEliminated: "eliminated",
    deductionBoardTitle: "📋 Deduction Board",
    teamHistoryLabel: "Team history",
    originalZombiesHeading: "Original zombies (game start)",
    finalRolesHeading: "Final roles (game end)",
    finalRevealBlurb: "Full reveal — original zombies vs final roles.",
    roleZombie: "Zombie",
    roleHuman: "Human",
    noteCuredZombie: "cured by vaccine",
    noteHumanInfected: "infected",
    humansWin: "Humans win",
    zombiesWin: "Zombies win",
    gameOver: "Game over",
    infectionHeading: "Infection",
    infectionRule:
      "End-of-round rule: any surviving human who shares a team with a living zombie becomes a zombie unless they were vaccinated that same round.",
    voteCountFmt: "{name}: {n}",
    voteTieJoiner: " vs ",
    voteSummaryTopOne:
      "Highest valid vote total on one player — {detail}. Expulsion threshold: {met}. {two}",
    voteSummaryTopTie:
      "{list} ({tieNote}). Expulsion threshold: {met}. {two}",
    voteTieNoExpel: "Tie — nobody expelled",
    voteSummaryNoVotes: "No valid votes toward any target. Expulsion threshold: {met}. {two}",
    playAgain: "Play again",
  },
  Korean: {
    voteInvalidAlreadyRemoved: "(무효 — 이미 제거됨)",
    voteValidSummary: "유효표: {n}표 — 추방 기준 {met}. {two}",
    voteThresholdMet: "달성",
    voteThresholdNotMet: "미달",
    voteTwoRequiredNote: "추방에는 최다 득표자에게 유효 2표가 필요합니다.",
    voteExpelledLine: "집계: {name} 추방 ({tally}){role}",
    voteNoExpulsionLine: "집계: 추방 없음 — 동표 또는 최다 2표 미만{tally}",
    wasZombie: " — 🧟 좀비였습니다!",
    wasHuman: " — 😇 인간이었습니다...",
    labelEliminated: "제거됨",
    deductionBoardTitle: "📋 추리 보드",
    teamHistoryLabel: "팀 편성",
    originalZombiesHeading: "원래 좀비 (게임 시작 시)",
    finalRolesHeading: "최종 역할 (게임 종료 시)",
    finalRevealBlurb: "전체 공개 — 시작 시 좀비와 종료 시 역할.",
    roleZombie: "좀비",
    roleHuman: "인간",
    noteCuredZombie: "백신으로 치료됨",
    noteHumanInfected: "감염됨",
    humansWin: "인간 승리",
    zombiesWin: "좀비 승리",
    gameOver: "게임 종료",
    infectionHeading: "감염",
    infectionRule:
      "라운드 말 규칙: 살아 있는 좀비와 같은 팀에 남은 인간은, 같은 라운드에 백신을 맞지 않았다면 좀비가 된다.",
    voteCountFmt: "{name} {n}표",
    voteTieJoiner: " vs ",
    voteSummaryTopOne: "한 명에게 모인 유효 표가 가장 많음 — {detail}. 추방 기준 {met}. {two}",
    voteSummaryTopTie: "{list} ({tieNote}). 추방 기준 {met}. {two}",
    voteTieNoExpel: "동표 — 추방 없음",
    voteSummaryNoVotes: "유효한 추방 대상 표가 없습니다. 추방 기준 {met}. {two}",
    playAgain: "다시 하기",
  },
  Japanese: {
    voteInvalidAlreadyRemoved: "(無効 — 投票者は既に脱落)",
    voteValidSummary: "有効票: {n}票 — 追放条件は{met}。{two}",
    voteThresholdMet: "達成",
    voteThresholdNotMet: "未達",
    voteTwoRequiredNote: "追放には最多得票者へ有効2票が必要です。",
    voteExpelledLine: "集計: {name} を追放 ({tally}){role}",
    voteNoExpulsionLine: "集計: 追放なし — 同票または最多2票未満{tally}",
    wasZombie: " — 🧟 ゾンビでした!",
    wasHuman: " — 😇 人間でした...",
    labelEliminated: "脱落",
    deductionBoardTitle: "📋 推理ボード",
    teamHistoryLabel: "チーム編成",
    originalZombiesHeading: "当初のゾンビ（ゲーム開始時）",
    finalRolesHeading: "最終役職（ゲーム終了時）",
    finalRevealBlurb: "全公開 — 開始時のゾンビと最終役職。",
    roleZombie: "ゾンビ",
    roleHuman: "人間",
    noteCuredZombie: "ワクチンで治療",
    noteHumanInfected: "感染",
    humansWin: "人間の勝利",
    zombiesWin: "ゾンビの勝利",
    gameOver: "ゲーム終了",
    infectionHeading: "感染",
    infectionRule:
      "ラウンド終了時のルール: 生存ゾンビと同じチームに残った人間は、そのラウンドにワクチンを打っていなければゾンビになる。",
    voteCountFmt: "{name} {n}票",
    voteTieJoiner: " vs ",
    voteSummaryTopOne: "最多の有効票が集まった対象 — {detail}。追放条件は{met}。{two}",
    voteSummaryTopTie: "{list}（{tieNote}）。追放条件は{met}。{two}",
    voteTieNoExpel: "同票のため追放なし",
    voteSummaryNoVotes: "有効な追放票がありません。追放条件は{met}。{two}",
    playAgain: "もう一度",
  },
  Chinese: {
    voteInvalidAlreadyRemoved: "(无效 — 投票者已被淘汰)",
    voteValidSummary: "有效票：{n} — 放逐门槛{met}。{two}",
    voteThresholdMet: "已达成",
    voteThresholdNotMet: "未达成",
    voteTwoRequiredNote: "放逐需要最高票者获得至少2张有效票。",
    voteExpelledLine: "计票：放逐 {name}（{tally}）{role}",
    voteNoExpulsionLine: "计票：无人放逐 — 平票或最高票不足2票{tally}",
    wasZombie: " — 🧟 是僵尸!",
    wasHuman: " — 😇 是人类...",
    labelEliminated: "已淘汰",
    deductionBoardTitle: "📋 推理板",
    teamHistoryLabel: "分队记录",
    originalZombiesHeading: "初始僵尸（游戏开始时）",
    finalRolesHeading: "最终身份（游戏结束时）",
    finalRevealBlurb: "完整公开 — 初始僵尸与最终身份。",
    roleZombie: "僵尸",
    roleHuman: "人类",
    noteCuredZombie: "疫苗治愈",
    noteHumanInfected: "被感染",
    humansWin: "人类胜利",
    zombiesWin: "僵尸胜利",
    gameOver: "游戏结束",
    infectionHeading: "感染",
    infectionRule:
      "回合结束规则：若幸存人类与仍存活的僵尸同队，且当回合未接种疫苗，则会变为僵尸。",
    voteCountFmt: "{name} {n}票",
    voteTieJoiner: " vs ",
    voteSummaryTopOne: "单一目标得票最高（有效票）— {detail}。放逐门槛{met}。{two}",
    voteSummaryTopTie: "{list}（{tieNote}）。放逐门槛{met}。{two}",
    voteTieNoExpel: "平票 — 无人放逐",
    voteSummaryNoVotes: "没有有效的放逐目标票。放逐门槛{met}。{two}",
    playAgain: "再玩一局",
  },
  Spanish: {
    voteInvalidAlreadyRemoved: "(inválido — votante ya eliminado)",
    voteValidSummary: "Votos válidos: {n} — umbral de expulsión: {met}. {two}",
    voteThresholdMet: "cumplido",
    voteThresholdNotMet: "no cumplido",
    voteTwoRequiredNote: "Se requieren 2 votos válidos para expulsar al más votado.",
    voteExpelledLine: "Recuento: expulsión de {name} ({tally}){role}",
    voteNoExpulsionLine: "Recuento: sin expulsión — empate o menos de 2 votos al tope{tally}",
    wasZombie: " — ¡era zombie!",
    wasHuman: " — era humano...",
    labelEliminated: "eliminado",
    deductionBoardTitle: "📋 Tablero de deducción",
    teamHistoryLabel: "Historial de equipos",
    originalZombiesHeading: "Zombies originales (inicio)",
    finalRolesHeading: "Roles finales (fin de partida)",
    finalRevealBlurb: "Revelación completa — zombies iniciales y roles finales.",
    roleZombie: "Zombie",
    roleHuman: "Humano",
    noteCuredZombie: "curado con vacuna",
    noteHumanInfected: "infectado",
    humansWin: "Ganan los humanos",
    zombiesWin: "Ganan los zombies",
    gameOver: "Fin de la partida",
    infectionHeading: "Infección",
    infectionRule:
      "Al cierre de ronda: un humano vivo que comparte equipo con un zombie vivo se infecta salvo que se vacune en esa misma ronda.",
    voteCountFmt: "{name}: {n}",
    voteTieJoiner: " vs ",
    voteSummaryTopOne:
      "Más votos válidos en un solo jugador — {detail}. Umbral de expulsión: {met}. {two}",
    voteSummaryTopTie: "{list} ({tieNote}). Umbral de expulsión: {met}. {two}",
    voteTieNoExpel: "Empate — nadie expulsado",
    voteSummaryNoVotes: "Sin votos válidos hacia ningún objetivo. Umbral de expulsión: {met}. {two}",
    playAgain: "Jugar de nuevo",
  },
  French: {
    voteInvalidAlreadyRemoved: "(invalide — votant déjà éliminé)",
    voteValidSummary: "Votes valides : {n} — seuil d’expulsion : {met}. {two}",
    voteThresholdMet: "atteint",
    voteThresholdNotMet: "non atteint",
    voteTwoRequiredNote: "2 votes valides requis pour expulser le plus voté.",
    voteExpelledLine: "Dépouillement : expulsion de {name} ({tally}){role}",
    voteNoExpulsionLine: "Dépouillement : pas d’expulsion — égalité ou moins de 2 votes{tally}",
    wasZombie: " — c’était un zombie !",
    wasHuman: " — c’était un humain...",
    labelEliminated: "éliminé",
    deductionBoardTitle: "📋 Tableau de déduction",
    teamHistoryLabel: "Historique des équipes",
    originalZombiesHeading: "Zombies d’origine (début de partie)",
    finalRolesHeading: "Rôles finaux (fin de partie)",
    finalRevealBlurb: "Révélation complète — zombies d’origine et rôles finaux.",
    roleZombie: "Zombie",
    roleHuman: "Humain",
    noteCuredZombie: "guéri par vaccin",
    noteHumanInfected: "infecté",
    humansWin: "Victoire des humains",
    zombiesWin: "Victoire des zombies",
    gameOver: "Partie terminée",
    infectionHeading: "Infection",
    infectionRule:
      "Fin de manche : tout humain survivant en équipe avec un zombie vivant devient zombie, sauf s’il a été vacciné durant cette même manche.",
    voteCountFmt: "{name} : {n}",
    voteTieJoiner: " vs ",
    voteSummaryTopOne:
      "Plus de votes valides sur un joueur — {detail}. Seuil d’expulsion : {met}. {two}",
    voteSummaryTopTie: "{list} ({tieNote}). Seuil d’expulsion : {met}. {two}",
    voteTieNoExpel: "Égalité — personne expulsé",
    voteSummaryNoVotes: "Aucun vote valide vers une cible. Seuil d’expulsion : {met}. {two}",
    playAgain: "Rejouer",
  },
  German: {
    voteInvalidAlreadyRemoved: "(ungültig — Wähler bereits ausgeschieden)",
    voteValidSummary: "Gültige Stimmen: {n} — Ausschlussgrenze: {met}. {two}",
    voteThresholdMet: "erreicht",
    voteThresholdNotMet: "nicht erreicht",
    voteTwoRequiredNote: "Zum Rauswurf des Führenden sind 2 gültige Stimmen nötig.",
    voteExpelledLine: "Auszählung: {name} rausgewählt ({tally}){role}",
    voteNoExpulsionLine: "Auszählung: kein Rauswurf — Patt oder weniger als 2 Stimmen{tally}",
    wasZombie: " — war ein Zombie!",
    wasHuman: " — war ein Mensch...",
    labelEliminated: "ausgeschieden",
    deductionBoardTitle: "📋 Deduktionstafel",
    teamHistoryLabel: "Teamverlauf",
    originalZombiesHeading: "Ursprüngliche Zombies (Spielstart)",
    finalRolesHeading: "Endrollen (Spielende)",
    finalRevealBlurb: "Volle Aufdeckung — ursprüngliche Zombies und Endrollen.",
    roleZombie: "Zombie",
    roleHuman: "Mensch",
    noteCuredZombie: "durch Impfung geheilt",
    noteHumanInfected: "infiziert",
    humansWin: "Menschen gewinnen",
    zombiesWin: "Zombies gewinnen",
    gameOver: "Spiel beendet",
    infectionHeading: "Infektion",
    infectionRule:
      "Regel am Rundenende: Überlebende Menschen im Team mit einem lebenden Zombie werden infiziert, sofern sie in derselben Runde nicht geimpft wurden.",
    voteCountFmt: "{name}: {n}",
    voteTieJoiner: " vs ",
    voteSummaryTopOne:
      "Meiste gültige Stimmen auf einen Spieler — {detail}. Ausschlussgrenze: {met}. {two}",
    voteSummaryTopTie: "{list} ({tieNote}). Ausschlussgrenze: {met}. {two}",
    voteTieNoExpel: "Gleichstand — niemand raus",
    voteSummaryNoVotes: "Keine gültigen Stimmen auf ein Ziel. Ausschlussgrenze: {met}. {two}",
    playAgain: "Nochmal spielen",
  },
  Portuguese: {
    voteInvalidAlreadyRemoved: "(inválido — votante já eliminado)",
    voteValidSummary: "Votos válidos: {n} — limiar de expulsão: {met}. {two}",
    voteThresholdMet: "atingido",
    voteThresholdNotMet: "não atingido",
    voteTwoRequiredNote: "São necessários 2 votos válidos para expulsar o mais votado.",
    voteExpelledLine: "Apuração: {name} expulso(a) ({tally}){role}",
    voteNoExpulsionLine: "Apuração: sem expulsão — empate ou menos de 2 votos no topo{tally}",
    wasZombie: " — era zumbi!",
    wasHuman: " — era humano...",
    labelEliminated: "eliminado",
    deductionBoardTitle: "📋 Quadro de dedução",
    teamHistoryLabel: "Histórico de equipes",
    originalZombiesHeading: "Zumbis originais (início)",
    finalRolesHeading: "Papéis finais (fim de jogo)",
    finalRevealBlurb: "Revelação completa — zumbis iniciais e papéis finais.",
    roleZombie: "Zumbi",
    roleHuman: "Humano",
    noteCuredZombie: "curado com vacina",
    noteHumanInfected: "infectado",
    humansWin: "Humanos vencem",
    zombiesWin: "Zumbis vencem",
    gameOver: "Fim de jogo",
    infectionHeading: "Infecção",
    infectionRule:
      "Regra no fim da rodada: qualquer humano vivo no mesmo time de um zumbi vivo vira zumbi, salvo se for vacinado na mesma rodada.",
    voteCountFmt: "{name}: {n}",
    voteTieJoiner: " vs ",
    voteSummaryTopOne:
      "Mais votos válidos em um jogador — {detail}. Limiar de expulsão: {met}. {two}",
    voteSummaryTopTie: "{list} ({tieNote}). Limiar de expulsão: {met}. {two}",
    voteTieNoExpel: "Empate — ninguém expulso",
    voteSummaryNoVotes: "Sem votos válidos para alvo. Limiar de expulsão: {met}. {two}",
    playAgain: "Jogar novamente",
  },
  Arabic: {
    voteInvalidAlreadyRemoved: "(غير صالح — الناخب أُزيل مسبقًا)",
    voteValidSummary: "أصوات صالحة: {n} — عتبة الطرد: {met}. {two}",
    voteThresholdMet: "متحقق",
    voteThresholdNotMet: "غير متحقق",
    voteTwoRequiredNote: "يلزم صوتان صالحان لطرد الأعلى أصواتًا.",
    voteExpelledLine: "الفرز: طرد {name} ({tally}){role}",
    voteNoExpulsionLine: "الفرز: لا طرد — تعادل أو أقل من صوتين{tally}",
    wasZombie: " — كان زومبيًا!",
    wasHuman: " — كان بشريًا...",
    labelEliminated: "أُزيل",
    deductionBoardTitle: "📋 لوحة الاستنتاج",
    teamHistoryLabel: "سجل الفرق",
    originalZombiesHeading: "الزومبي الأصليون (بداية اللعبة)",
    finalRolesHeading: "الأدوار النهائية (نهاية اللعبة)",
    finalRevealBlurb: "كشف كامل — الزومبي الأصليون والأدوار النهائية.",
    roleZombie: "زومبي",
    roleHuman: "بشر",
    noteCuredZombie: "شُفي بلقاح",
    noteHumanInfected: "أُصيب",
    humansWin: "فوز البشر",
    zombiesWin: "فوز الزومبي",
    gameOver: "انتهت اللعبة",
    infectionHeading: "عدوى",
    infectionRule:
      "قاعدة نهاية الجولة: أي إنسان حي يشارك فريقًا مع زومبي حي يصبح زومبيًا ما لم يُطعَّم في تلك الجولة نفسها.",
    voteCountFmt: "{name}: {n}",
    voteTieJoiner: " vs ",
    voteSummaryTopOne: "أعلى أصوات صالحة على لاعب واحد — {detail}. عتبة الطرد: {met}. {two}",
    voteSummaryTopTie: "{list} ({tieNote}). عتبة الطرد: {met}. {two}",
    voteTieNoExpel: "تعادل — لا طرد",
    voteSummaryNoVotes: "لا أصوات صالحة نحو أي هدف. عتبة الطرد: {met}. {two}",
    playAgain: "العب مجددًا",
  },
  Hindi: {
    voteInvalidAlreadyRemoved: "(अमान्य — मतदाता पहले ही हट चुका है)",
    voteValidSummary: "मान्य मत: {n} — निष्कासन सीमा {met}। {two}",
    voteThresholdMet: "पूरी",
    voteThresholdNotMet: "अपूर्ण",
    voteTwoRequiredNote: "निष्कासन के लिए सर्वाधिक वोट पर 2 मान्य मत चाहिए।",
    voteExpelledLine: "गणना: {name} निष्कासित ({tally}){role}",
    voteNoExpulsionLine: "गणना: कोई निष्कासन नहीं — बराबरी या 2 से कम वोट{tally}",
    wasZombie: " — ज़ॉम्बी था!",
    wasHuman: " — इंसान था...",
    labelEliminated: "हटाया गया",
    deductionBoardTitle: "📋 निष्कर्ष बोर्ड",
    teamHistoryLabel: "टीम इतिहास",
    originalZombiesHeading: "मूल ज़ॉम्बी (खेल की शुरुआत)",
    finalRolesHeading: "अंतिम भूमिकाएँ (खेल का अंत)",
    finalRevealBlurb: "पूर्ण खुलासा — मूल ज़ॉम्बी और अंतिम भूमिकाएँ।",
    roleZombie: "ज़ॉम्बी",
    roleHuman: "इंसान",
    noteCuredZombie: "टीके से ठीक",
    noteHumanInfected: "संक्रमित",
    humansWin: "इंसानों की जीत",
    zombiesWin: "ज़ॉम्बी की जीत",
    gameOver: "खेल समाप्त",
    infectionHeading: "संक्रमण",
    infectionRule:
      "राउंड समाप्ति नियम: जीवित ज़ॉम्बी के साथ टीम में बचा इंसान, यदि उसी राउंड में टीका न लगवाया हो तो ज़ॉम्बी बन जाता है।",
    voteCountFmt: "{name}: {n}",
    voteTieJoiner: " vs ",
    voteSummaryTopOne:
      "एक खिलाड़ी पर सबसे अधिक मान्य वोट — {detail}। निष्कासन सीमा {met}। {two}",
    voteSummaryTopTie: "{list} ({tieNote})। निष्कासन सीमा {met}। {two}",
    voteTieNoExpel: "बराबरी — कोई निष्कासन नहीं",
    voteSummaryNoVotes: "किसी लक्ष्य पर कोई मान्य वोट नहीं। निष्कासन सीमा {met}। {two}",
    playAgain: "फिर से खेलें",
  },
};

function getCarrierUiPack(language: string): CarrierUiPack {
  return CARRIER_UI_BY_LANG[language] ?? CARRIER_UI_BY_LANG.English;
}

/** Valid votes only; per-target counts — summary shows leader count or tied breakdown. */
function computeCarrierVoteSummaryLine(
  pack: CarrierUiPack,
  allVotes: Record<string, string> | undefined,
  invalidVoters: Set<string>,
  playersSnap: Player[],
  expelMet: boolean
): string {
  const metLabel = expelMet ? pack.voteThresholdMet : pack.voteThresholdNotMet;
  const two = pack.voteTwoRequiredNote;
  if (!allVotes || Object.keys(allVotes).length === 0) {
    return pack.voteSummaryNoVotes.replace("{met}", metLabel).replace("{two}", two);
  }
  const counts: Record<string, number> = {};
  for (const [voter, target] of Object.entries(allVotes)) {
    if (invalidVoters.has(voter)) continue;
    counts[target] = (counts[target] ?? 0) + 1;
  }
  const entries = Object.entries(counts).filter(([, c]) => c > 0);
  if (entries.length === 0) {
    return pack.voteSummaryNoVotes.replace("{met}", metLabel).replace("{two}", two);
  }
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topN = entries[0]![1];
  const leaders = entries.filter(([, c]) => c === topN);
  const fmt = (pid: string, n: number) =>
    pack.voteCountFmt
      .replace("{name}", carrierDisplayNameForProvider(pid, playersSnap))
      .replace("{n}", String(n));

  if (leaders.length === 1) {
    const [pid, n] = leaders[0]!;
    return pack.voteSummaryTopOne
      .replace("{detail}", fmt(pid, n))
      .replace("{met}", metLabel)
      .replace("{two}", two);
  }
  const list = leaders.map(([pid, n]) => fmt(pid, n)).join(pack.voteTieJoiner);
  return pack.voteSummaryTopTie
    .replace("{list}", list)
    .replace("{tieNote}", pack.voteTieNoExpel)
    .replace("{met}", metLabel)
    .replace("{two}", two);
}

function cumulativeEliminatedThroughRound(
  fullHistory: DeductionRoundHistory[],
  throughRound: number
): Set<string> {
  const s = new Set<string>();
  for (const e of fullHistory) {
    if (e.round > throughRound) continue;
    if (e.expelResult) s.add(e.expelResult);
    for (const ev of e.shotgunEvents) {
      if (ev.result === "zombie_killed" || ev.result === "human_killed") {
        s.add(ev.target);
      }
    }
    for (const el of e.eliminations ?? []) {
      if (el.provider) s.add(el.provider);
    }
  }
  return s;
}

type Phase =
  | "setup"
  | "starting"
  | "speeches"
  | "user_speech"
  | "paused_after_speeches"
  | "actions"
  | "paused_user_action"
  | "summary"
  | "between_rounds"
  | "pre_end_aggregate"
  | "ended";

type Role = "human" | "zombie";

type PlayerStatus = "HUMAN" | "ZOMBIE";

type Player = {
  provider: string;
  name: string;
  color: string;
  isAlive: boolean;
  role: Role;
  status: PlayerStatus;
  teamId: string | null;
  isUser?: boolean;
};

function roleToPlayerStatus(role: Role): PlayerStatus {
  return role === "zombie" ? "ZOMBIE" : "HUMAN";
}

function syncPlayersWithRolesTeams(
  prev: Player[],
  roles: Record<string, Role>,
  teams: CarrierTeam[]
): Player[] {
  return prev.map((p) => {
    const role = roles[p.provider] ?? p.role;
    const t = teams.find((tm) => tm.members.includes(p.provider));
    return {
      ...p,
      role,
      status: roleToPlayerStatus(role),
      teamId: t?.id ?? null,
    };
  });
}

type GameMessage = {
  provider: string;
  name: string;
  text: string;
  round: number;
  type: "speech" | "system";
};

type CarrierTeam = {
  id: string;
  members: string[];
  hasLatentInfection?: boolean;
  round?: number;
};

type RoundSummaryEntry = {
  round: number;
  announcement: string;
  hint: string;
  shotgunResult: string;
  vaccineResult: string;
  teams: CarrierTeam[];
  score: { humans: number; zombies: number; humansAll: number; zombiesAll: number };
  /** Latent zombie-in-team risk after this round's actions (before summary infection roll). */
  allianceLatentFromActionsRound?: boolean;
};

type CarrierRoundHistoryEntry = {
  round: number;
  shotgunResult: string;
  vaccineResult: string;
  infiltrationHint: string;
};

type DeductionShotgunEvent = {
  shooter: string;
  target: string;
  result: "zombie_killed" | "human_killed";
};

type DeductionVaccineEvent = {
  user: string;
  target: string;
  result: "saved" | "no_effect" | "immunized";
};

type DeductionElimination = { provider: string; reason: string };

/** Mirrors server — spectator / AI deduction trail. */
type DeductionRoundHistory = {
  round: number;
  teams: { id: string; members: string[] }[];
  speeches: { provider: string; name: string; summary: string }[];
  votes: Record<string, string>;
  expelResult: string | null;
  expelledRole?: "human" | "zombie" | null;
  shotgunEvents: DeductionShotgunEvent[];
  vaccineEvents: DeductionVaccineEvent[];
  infectionOccurred: boolean;
  infectionCount: number;
  newInfections?: string[];
  aliveAfter: string[];
  zombieCountAfter?: number;
  humanCountAfter?: number;
  eliminations?: DeductionElimination[];
};

type UserRoundAction = "SHOTGUN" | "VACCINE" | "EXPEL" | "NONE";

type ActionFeedLine = { id: string; text: string; tone?: "ok" | "bad" | "neutral" };

type ActionsUserTurnPayload = {
  acted: string[];
  order: string[];
  resumeIndex: number;
  teams: CarrierTeam[];
  roles: Record<string, Role>;
  eliminated: string[];
  shotgunUsed: number;
  vaccineUsed: number;
  shotgunResult: string;
  vaccineResult: string;
  allianceLatentThisRound: boolean;
  actionsThisRound?: Record<string, string>;
  expelVotes?: Record<string, string>;
  vaccinatedThisRound?: string[];
  shotgunEventsDeduction?: DeductionShotgunEvent[];
  vaccineEventsDeduction?: DeductionVaccineEvent[];
  eliminationsDeduction?: DeductionElimination[];
};

function parseCarrierToolUses(raw: unknown, max = 3): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.min(max, Math.floor(raw)));
  }
  if (raw === true) return 1;
  return 0;
}

const MAX_CARRIER_TOOL_USES = 3;

function formatCarrierOriginalZombiesLine(ids: string[]): string {
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return "—";
  return uniq
    .map((id) =>
      id === "user"
        ? "You"
        : AI_PLAYERS.find((a) => a.provider === id)?.name ?? id
    )
    .join(" · ");
}

function carrierDisplayNameForProvider(pid: string, players: Player[]): string {
  if (pid === "user") {
    const u = players.find((p) => p.isUser || p.provider === "user");
    return u?.name ?? "You";
  }
  const pl = players.find((p) => p.provider === pid);
  if (pl) return pl.name;
  return AI_PLAYERS.find((a) => a.provider === pid)?.name ?? pid;
}

function summarizeDeductionVotes(votes: Record<string, string>, players: Player[]): string {
  const entries = Object.entries(votes);
  if (!entries.length) return "—";
  return entries
    .map(
      ([v, t]) =>
        `${carrierDisplayNameForProvider(v, players)}→${carrierDisplayNameForProvider(t, players)}`
    )
    .join(", ");
}

const BG =
  "min-h-screen bg-gray-950 text-zinc-100 selection:bg-emerald-500/30";

const TEAM_BORDER_ACCENT_PALETTE = [
  "#34d399",
  "#38bdf8",
  "#c084fc",
  "#fb923c",
  "#f472b6",
  "#fcd34d",
] as const;

/** API `result` strings → Korean labels for action feed (접종/발사). */
function formatCarrierToolResultKo(result: unknown): string {
  const r = String(result ?? "");
  switch (r) {
    case "human_died":
      return "인간이었습니다 (낭비)";
    case "no_effect":
      return "인간이었습니다 (효과 없음)";
    case "immunized":
      return "면역 부여 (이번 라운드 감염 방지)";
    case "zombie_eliminated":
      return "좀비 제거 성공!";
    case "zombie_cured":
      return "좀비 치료 성공!";
    case "not_used":
      return "미사용";
    default:
      return r;
  }
}

const MESSAGE_STAGGER_MS = 400;

function fullConversationPayload(msgs: GameMessage[]) {
  return msgs
    .filter((m): m is GameMessage => m.type === "speech")
    .map((m) => ({
      provider: m.provider,
      name: m.name,
      text: m.text,
      round: m.round,
      type: "speech" as const,
    }));
}

function aliveAiProviderIds(playersSnap: Player[]) {
  return playersSnap
    .filter((p) => p.isAlive && p.provider !== "user")
    .map((p) => p.provider);
}

function alivePlayersForApi(playersSnap: Player[], mode: "god" | "blind" | "challenge") {
  const ai = aliveAiProviderIds(playersSnap);
  if (mode === "challenge" && playersSnap.some((p) => p.provider === "user" && p.isAlive)) {
    return [...ai, "user"];
  }
  return ai;
}

async function readCarrierSse(
  res: Response,
  onEvent: (e: Record<string, unknown>) => void
) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
    }
    const parts = buffer.split(/\n\n/);
    buffer = parts.pop() ?? "";
    for (const block of parts) {
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const json = line.replace(/^data:\s*/, "").trim();
      if (!json || json === "[DONE]") continue;
      try {
        onEvent(JSON.parse(json) as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
    if (done) break;
  }
}

export default function CarrierModePage() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [userMode, setUserMode] = useState<"god" | "blind" | "challenge">("blind");
  const [language, setLanguage] = useState("English");
  const languageRef = useRef(language);
  const [players, setPlayers] = useState<Player[]>([]);
  const [messages, setMessages] = useState<GameMessage[]>([]);
  const [currentRound, setCurrentRound] = useState(1);
  const [gameId, setGameId] = useState<string | null>(null);
  const [zombieIds, setZombieIds] = useState<string[]>([]);
  const [shotgunHolderId, setShotgunHolderId] = useState<string | null>(null);
  const [vaccineHolderId, setVaccineHolderId] = useState<string | null>(null);
  const [shotgunUsed, setShotgunUsed] = useState(0);
  const [vaccineUsed, setVaccineUsed] = useState(0);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [teams, setTeams] = useState<CarrierTeam[]>([]);
  const [roundSummary, setRoundSummary] = useState<RoundSummaryEntry | null>(null);
  const [winner, setWinner] = useState<"humans" | "zombies" | null>(null);
  const [gameEndingNarration, setGameEndingNarration] = useState("");
  const [userInput, setUserInput] = useState("");
  const [userTimer, setUserTimer] = useState(45);
  const [streamingProvider, setStreamingProvider] = useState<string | null>(null);
  const [isUserEliminated, setIsUserEliminated] = useState(false);
  const [challengeRoleToast, setChallengeRoleToast] = useState<string | null>(null);
  const [userJoinTarget, setUserJoinTarget] = useState<string | null>(null);
  const [activeHalf, setActiveHalf] = useState<1 | 2>(1);
  const [actionFeed, setActionFeed] = useState<ActionFeedLine[]>([]);
  const [userRoundAction, setUserRoundAction] = useState<UserRoundAction>("NONE");
  const [userRoundTarget, setUserRoundTarget] = useState<string | null>(null);
  const [userTurnPauseUi, setUserTurnPauseUi] = useState<ActionsUserTurnPayload | null>(null);
  const [roundHistories, setRoundHistories] = useState<CarrierRoundHistoryEntry[]>(
    []
  );
  const [pendingGameEnd, setPendingGameEnd] = useState<{
    winner: "humans" | "zombies";
    soloEliminated: string[];
    teamsAtJudgment: CarrierTeam[];
  } | null>(null);
  /** From the most recent `round_summary` SSE (drives continue-button → pre_end vs next round). */
  const [summaryHadGameOver, setSummaryHadGameOver] = useState(false);
  const [deductionRoundHistory, setDeductionRoundHistory] = useState<DeductionRoundHistory[]>([]);
  const [deductionBoardOpen, setDeductionBoardOpen] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesRef = useRef<GameMessage[]>([]);
  const playersRef = useRef<Player[]>([]);
  const currentRoundRef = useRef(1);
  const rolesRef = useRef<Record<string, Role>>({});
  const teamsRef = useRef<CarrierTeam[]>([]);
  const shotgunUsedRef = useRef(0);
  const vaccineUsedRef = useRef(0);
  const shotgunHolderRef = useRef<string | null>(null);
  const vaccineHolderRef = useRef<string | null>(null);
  const zombieIdsRef = useRef<string[]>([]);
  const gameIdRef = useRef<string | null>(null);
  /** From last `actions_complete` — sent to `round_summary` for announcer hint. */
  const allianceLatentThisRoundRef = useRef(false);
  const actionsResultsRef = useRef<{
    shotgunResult: string;
    vaccineResult: string;
    shotgunUsed: number;
    vaccineUsed: number;
    roles: Record<string, Role>;
    eliminated: string[];
    teams: CarrierTeam[];
  } | null>(null);
  const actionsUserTurnPausedRef = useRef<ActionsUserTurnPayload | null>(null);
  const actionsStreamPausedRef = useRef(false);
  const roundHistoriesRef = useRef<CarrierRoundHistoryEntry[]>([]);
  const deductionRoundHistoryRef = useRef<DeductionRoundHistory[]>([]);
  const turnExpireGuard = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    if (phase !== "paused_user_action" || !userTurnPauseUi || userMode !== "challenge") {
      return;
    }
    const canShotgun =
      shotgunHolderId === "user" &&
      userTurnPauseUi.shotgunUsed < MAX_CARRIER_TOOL_USES;
    const canVaccine =
      vaccineHolderId === "user" &&
      userTurnPauseUi.vaccineUsed < MAX_CARRIER_TOOL_USES;
    if (userRoundAction === "SHOTGUN" && !canShotgun) {
      setUserRoundAction("NONE");
    }
    if (userRoundAction === "VACCINE" && !canVaccine) {
      setUserRoundAction("NONE");
    }
  }, [
    phase,
    userMode,
    userTurnPauseUi,
    shotgunHolderId,
    vaccineHolderId,
    userRoundAction,
  ]);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);
  useEffect(() => {
    currentRoundRef.current = currentRound;
  }, [currentRound]);
  useEffect(() => {
    rolesRef.current = roles;
  }, [roles]);
  useEffect(() => {
    teamsRef.current = teams;
  }, [teams]);
  useEffect(() => {
    shotgunUsedRef.current = shotgunUsed;
    vaccineUsedRef.current = vaccineUsed;
    shotgunHolderRef.current = shotgunHolderId;
    vaccineHolderRef.current = vaccineHolderId;
    zombieIdsRef.current = zombieIds;
    gameIdRef.current = gameId;
  }, [
    shotgunUsed,
    vaccineUsed,
    shotgunHolderId,
    vaccineHolderId,
    zombieIds,
    gameId,
  ]);

  useEffect(() => {
    roundHistoriesRef.current = roundHistories;
  }, [roundHistories]);

  useEffect(() => {
    deductionRoundHistoryRef.current = deductionRoundHistory;
  }, [deductionRoundHistory]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages, roundSummary, phase, teams, actionFeed, activeHalf]);

  const stopUserTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startUserTimer = useCallback(() => {
    stopUserTimer();
    turnExpireGuard.current = false;
    setUserTimer(45);
    timerRef.current = setInterval(() => {
      setUserTimer((t) => {
        if (t <= 1) {
          stopUserTimer();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
  }, [stopUserTimer]);

  const addMessage = useCallback((m: GameMessage) => {
    setMessages((prev) => {
      const next = [...prev, m];
      messagesRef.current = next;
      return next;
    });
  }, []);

  const playerByProvider = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of players) m.set(p.provider, p);
    return m;
  }, [players]);

  const challengeUserPauseCanShotgun = useMemo(() => {
    if (phase !== "paused_user_action" || !userTurnPauseUi || userMode !== "challenge") {
      return false;
    }
    return (
      shotgunHolderId === "user" &&
      userTurnPauseUi.shotgunUsed < MAX_CARRIER_TOOL_USES
    );
  }, [phase, userTurnPauseUi, userMode, shotgunHolderId]);

  const challengeUserPauseCanVaccine = useMemo(() => {
    if (phase !== "paused_user_action" || !userTurnPauseUi || userMode !== "challenge") {
      return false;
    }
    return (
      vaccineHolderId === "user" &&
      userTurnPauseUi.vaccineUsed < MAX_CARRIER_TOOL_USES
    );
  }, [phase, userTurnPauseUi, userMode, vaccineHolderId]);

  const latestSummary = roundSummary;

  const resetGame = useCallback(() => {
    stopUserTimer();
    setPhase("setup");
    setPlayers([]);
    setMessages([]);
    setCurrentRound(1);
    setGameId(null);
    setZombieIds([]);
    zombieIdsRef.current = [];
    setShotgunHolderId(null);
    setVaccineHolderId(null);
    setShotgunUsed(0);
    setVaccineUsed(0);
    setRoles({});
    setTeams([]);
    setRoundSummary(null);
    setWinner(null);
    setUserInput("");
    setStreamingProvider(null);
    setIsUserEliminated(false);
    setChallengeRoleToast(null);
    setUserJoinTarget(null);
    setActiveHalf(1);
    setActionFeed([]);
    setUserRoundAction("NONE");
    setUserRoundTarget(null);
    setRoundHistories([]);
    roundHistoriesRef.current = [];
    setDeductionRoundHistory([]);
    deductionRoundHistoryRef.current = [];
    setDeductionBoardOpen(false);
    setGameEndingNarration("");
    setPendingGameEnd(null);
    setSummaryHadGameOver(false);
    allianceLatentThisRoundRef.current = false;
    actionsResultsRef.current = null;
    actionsUserTurnPausedRef.current = null;
    setUserTurnPauseUi(null);
    messagesRef.current = [];
    playersRef.current = [];
    currentRoundRef.current = 1;
  }, [stopUserTimer]);

  const postCarrier = useCallback(async (payload: Record<string, unknown>) => {
    return authenticatedFetch("/api/mindgame/carrier", { method: "POST", json: payload });
  }, []);

  const pushActionLine = useCallback(
    (
      text: string,
      tone: ActionFeedLine["tone"] | undefined,
      idParts: { provider: string; actionType: string }
    ) => {
      const r = currentRoundRef.current;
      setActionFeed((p) => {
        const index = p.length;
        const id = `${idParts.provider}-${idParts.actionType}-${r}-${index}-${Date.now()}`;
        return [...p, { id, text, tone: tone ?? "neutral" }];
      });
    },
    []
  );

  const applyActionsComplete = useCallback(
    (ev: Record<string, unknown>, round: number) => {
      const rolesRaw = (ev.roles as Record<string, Role>) ?? {}
      const roles =
        userMode === "blind" && Object.keys(rolesRaw).length === 0
          ? rolesRef.current
          : rolesRaw

      actionsResultsRef.current = {
        shotgunResult: String(ev.shotgunResult ?? "not_used"),
        vaccineResult: String(ev.vaccineResult ?? "not_used"),
        shotgunUsed: parseCarrierToolUses(ev.shotgunUsed, MAX_CARRIER_TOOL_USES),
        vaccineUsed: parseCarrierToolUses(ev.vaccineUsed, MAX_CARRIER_TOOL_USES),
        roles,
        eliminated: Array.isArray(ev.eliminated) ? (ev.eliminated as string[]) : [],
        teams: Array.isArray(ev.teams) ? (ev.teams as CarrierTeam[]) : [],
      }
      allianceLatentThisRoundRef.current = ev.allianceLatentThisRound === true
      const ir = actionsResultsRef.current
      setShotgunUsed(ir.shotgunUsed)
      setVaccineUsed(ir.vaccineUsed)
      setRoles(ir.roles)
      rolesRef.current = ir.roles
      const teamsSnapshot = ir.teams.map((t) => ({
        id: t.id,
        members: [...t.members],
        ...(t.hasLatentInfection !== undefined
          ? { hasLatentInfection: t.hasLatentInfection }
          : {}),
      }))
      setTeams(teamsSnapshot)
      teamsRef.current = teamsSnapshot

      setPlayers((prev) => {
        let next = syncPlayersWithRolesTeams(prev, roles, teamsSnapshot)
        for (const e of ir.eliminated) {
          next = next.map((p) => (p.provider === e ? { ...p, isAlive: false } : p))
        }
        playersRef.current = next
        return next
      })

      for (const e of ir.eliminated) {
        if (e === "user") {
          setIsUserEliminated(true)
          addMessage({
            provider: "system",
            name: "System",
            text: "You were eliminated. Observing in blind mode.",
            round,
            type: "system",
          })
        }
      }

      const rawDeduction = ev.deductionRoundEntry as DeductionRoundHistory | undefined;
      if (rawDeduction && typeof rawDeduction.round === "number") {
        const speechMsgs = messagesRef.current.filter(
          (m) => m.round === round && m.type === "speech"
        );
        const speeches = speechMsgs.map((m) => ({
          provider: m.provider,
          name: m.name,
          summary: m.text.length > 200 ? `${m.text.slice(0, 197)}…` : m.text,
        }));
        const merged: DeductionRoundHistory = { ...rawDeduction, speeches };
        setDeductionRoundHistory((prev) => {
          const rest = prev.filter((x) => x.round !== merged.round);
          const next = [...rest, merged].sort((a, b) => a.round - b.round);
          deductionRoundHistoryRef.current = next;
          return next;
        });
      }
    },
    [addMessage, userMode]
  );

  const handleActionSse = useCallback(
    (ev: Record<string, unknown>, round: number) => {
      const fromn = (x: unknown) => String(x ?? "?");
      if (ev.type === "action_speech") {
        const sp = typeof ev.speech === "string" ? ev.speech.trim() : "";
        if (sp) {
          const act = typeof ev.action === "string" ? ev.action : "";
          const ov = ev.overridden === true ? " (서버 수정)" : "";
          pushActionLine(
            `🎭 ${fromn(ev.name)}: ${sp}${act ? ` [${act}]` : ""}${ov}`,
            "neutral",
            { provider: String(ev.provider ?? "unknown"), actionType: "action_speech" }
          );
        }
      }
      if (ev.type === "action_shotgun") {
        pushActionLine(
          `🔫 ${fromn(ev.shooterName)} → ${fromn(ev.targetName)}: 발사! ${formatCarrierToolResultKo(ev.result)}`,
          "neutral",
          { provider: String(ev.shooter ?? "unknown"), actionType: "SHOTGUN" }
        );
      }
      if (ev.type === "action_vaccine") {
        pushActionLine(
          `💉 ${fromn(ev.userName)} → ${fromn(ev.targetName)}: 접종! ${formatCarrierToolResultKo(ev.result)}`,
          "neutral",
          { provider: String(ev.user ?? "unknown"), actionType: "VACCINE" }
        );
        if (ev.result === "zombie_cured") {
          const tgt = String(ev.target ?? "");
          if (tgt) {
            setPlayers((prev) => {
              const next = prev.map((p) =>
                p.provider === tgt
                  ? {
                      ...p,
                      isAlive: true,
                      role: "human" as Role,
                      status: "HUMAN" as PlayerStatus,
                    }
                  : p
              );
              playersRef.current = next;
              return next;
            });
            setRoles((prev) => {
              const n = { ...prev, [tgt]: "human" as Role };
              rolesRef.current = n;
              return n;
            });
          }
        }
      }
      if (ev.type === "action_vote") {
        pushActionLine(
          `🗳 ${fromn(ev.voterName)} → ${fromn(ev.targetName)}: 추방 투표`,
          "neutral",
          { provider: String(ev.voter ?? "unknown"), actionType: "VOTE" }
        );
      }
      if (ev.type === "vote_resolution") {
        const pack = getCarrierUiPack(languageRef.current);
        const tally = ev.tally as Record<string, number> | undefined;
        const expelled =
          typeof ev.expelled === "string" && ev.expelled.length > 0 ? ev.expelled : null;
        const expelledRoleEv =
          ev.expelledRole === "zombie" || ev.expelledRole === "human"
            ? ev.expelledRole
            : null;
        const snap = playersRef.current;
        const tallyStr =
          tally && typeof tally === "object"
            ? Object.entries(tally)
                .map(
                  ([id, n]) =>
                    `${carrierDisplayNameForProvider(id, snap)} ×${String(n)}`
                )
                .join(", ")
            : "";
        const allVotes = ev.votes as Record<string, string> | undefined;
        const invalidVoters = new Set(
          Array.isArray(ev.invalidVoters)
            ? (ev.invalidVoters as unknown[]).filter((x): x is string => typeof x === "string")
            : []
        );
        const expelMet = ev.expelThresholdMet === true;

        if (allVotes && Object.keys(allVotes).length > 0) {
          for (const [voter, target] of Object.entries(allVotes)) {
            const invalid = invalidVoters.has(voter);
            const vName = carrierDisplayNameForProvider(voter, snap);
            const tName = carrierDisplayNameForProvider(target, snap);
            const suffix = invalid ? ` ${pack.voteInvalidAlreadyRemoved}` : "";
            pushActionLine(`🗳 ${vName} → ${tName}${suffix}`, "neutral", {
              provider: voter,
              actionType: "VOTE",
            });
          }
        }

        const summaryLine = computeCarrierVoteSummaryLine(
          pack,
          allVotes,
          invalidVoters,
          snap,
          expelMet
        );
        pushActionLine(summaryLine, "neutral", {
          provider: "system",
          actionType: "vote_validity_summary",
        });

        if (expelled) {
          const roleSuffix =
            expelledRoleEv === "zombie"
              ? pack.wasZombie
              : expelledRoleEv === "human"
                ? pack.wasHuman
                : "";
          const tone: ActionFeedLine["tone"] =
            expelledRoleEv === "zombie"
              ? "ok"
              : expelledRoleEv === "human"
                ? "bad"
                : "neutral";
          const tallyPart = tallyStr ? tallyStr : "—";
          const line = pack.voteExpelledLine
            .replace("{name}", carrierDisplayNameForProvider(expelled, snap))
            .replace("{tally}", tallyPart)
            .replace("{role}", roleSuffix);
          pushActionLine(line, tone, { provider: expelled, actionType: "vote_out" });
        } else {
          const tallySuffix = tallyStr ? ` (${tallyStr})` : "";
          const line = pack.voteNoExpulsionLine.replace("{tally}", tallySuffix);
          pushActionLine(line, "neutral", { provider: "system", actionType: "vote_none" });
        }
      }
      if (ev.type === "action_none") {
        pushActionLine(`⏸ ${fromn(ev.name)}: 이번 라운드 행동 없음`, "neutral", {
          provider: String(ev.provider ?? "unknown"),
          actionType: "NONE",
        });
      }
      if (ev.type === "actions_paused_user_turn") {
        actionsStreamPausedRef.current = true;
        const p = ev.payload as ActionsUserTurnPayload;
        actionsUserTurnPausedRef.current = p;
        setUserTurnPauseUi(p);
        setPhase("paused_user_action");
        startUserTimer();
      }
      if (ev.type === "actions_complete") {
        applyActionsComplete(ev, round);
      }
      if (ev.type === "error") {
        addMessage({
          provider: "system",
          name: "System",
          text: String(ev.error ?? "Error"),
          round,
          type: "system",
        });
      }
    },
    [addMessage, pushActionLine, applyActionsComplete, startUserTimer]
  );

  const runActionsStream = useCallback(
    async (sid: string, round: number, extra?: Record<string, unknown>) => {
      setPhase("actions");
      actionsStreamPausedRef.current = false;
      const res = await postCarrier({
        action: "actions",
        sessionId: sid,
        alivePlayers: alivePlayersForApi(playersRef.current, userMode),
        zombieIds: zombieIdsRef.current,
        shotgunHolderId: shotgunHolderRef.current,
        vaccineHolderId: vaccineHolderRef.current,
        shotgunUsed: shotgunUsedRef.current,
        vaccineUsed: vaccineUsedRef.current,
        roles: rolesRef.current,
        deductionRoundHistory: deductionRoundHistoryRef.current,
        conversation: fullConversationPayload(messagesRef.current),
        userMode,
        language: languageRef.current,
        round,
        ...extra,
      });
      if (!res.ok) {
        addMessage({
          provider: "system",
          name: "System",
          text: "Actions request failed.",
          round,
          type: "system",
        });
        setPhase("setup");
        return false;
      }
      await readCarrierSse(res, (ev) => handleActionSse(ev, round));
      return !actionsStreamPausedRef.current;
    },
    [postCarrier, userMode, addMessage, handleActionSse]
  );

  const runSpeeches = useCallback(
    async (sid: string, round: number) => {
      setPhase("speeches");
      setStreamingProvider(null);
      const res = await postCarrier({
        action: "speeches",
        sessionId: sid,
        alivePlayers: alivePlayersForApi(playersRef.current, userMode),
        zombieIds: zombieIdsRef.current,
        shotgunHolderId: shotgunHolderRef.current,
        vaccineHolderId: vaccineHolderRef.current,
        shotgunUsed: shotgunUsedRef.current,
        vaccineUsed: vaccineUsedRef.current,
        roles: rolesRef.current,
        conversation: fullConversationPayload(messagesRef.current),
        userMode,
        language: languageRef.current,
        round,
        roundHistories: roundHistoriesRef.current,
        deductionRoundHistory: deductionRoundHistoryRef.current,
      });
      if (!res.ok) {
        addMessage({
          provider: "system",
          name: "System",
          text: "Speeches request failed.",
          round,
          type: "system",
        });
        setPhase("setup");
        return;
      }
      await readCarrierSse(res, (ev) => {
        if (ev.type === "round_teams") {
          const rTeams = Array.isArray(ev.teams)
            ? (ev.teams as CarrierTeam[]).map((t) => ({
                id: String(t.id),
                members: [...t.members],
                ...(t.hasLatentInfection !== undefined
                  ? { hasLatentInfection: t.hasLatentInfection }
                  : {}),
                ...(typeof (t as CarrierTeam).round === "number"
                  ? { round: (t as CarrierTeam).round }
                  : {}),
              }))
            : [];
          const snap = rTeams.filter((x) => x.members.length > 0);
          setTeams(snap);
          teamsRef.current = snap;
          const nar = typeof ev.narration === "string" ? ev.narration.trim() : "";
          if (nar) {
            addMessage({
              provider: "system",
              name: "Teams",
              text: nar,
              round: typeof ev.round === "number" ? ev.round : round,
              type: "system",
            });
          }
          const rolesEv = rolesRef.current;
          setPlayers((prev) => {
            const next = syncPlayersWithRolesTeams(prev, rolesEv, snap);
            playersRef.current = next;
            return next;
          });
        }
        if (ev.type === "speech") {
          setStreamingProvider(String(ev.provider ?? ""));
          addMessage({
            provider: String(ev.provider ?? "system"),
            name: String(ev.name ?? "Unknown"),
            text: String(ev.text ?? ""),
            round: typeof ev.round === "number" ? ev.round : round,
            type: "speech",
          });
        }
        if (ev.type === "phase_complete" && ev.phase === "speeches") {
          setStreamingProvider(null);
          const u = playersRef.current.find((p) => p.provider === "user");
          const challengeUser =
            userMode === "challenge" && u !== undefined && u.isAlive;
          if (challengeUser) {
            setPhase("user_speech");
            startUserTimer();
          } else {
            setPhase("paused_after_speeches");
          }
        }
        if (ev.type === "error") {
          addMessage({
            provider: "system",
            name: "System",
            text: String(ev.error ?? "Error"),
            round,
            type: "system",
          });
        }
      });
    },
    [postCarrier, userMode, addMessage, startUserTimer]
  );

  const runRoundSummary = useCallback(
    async (sid: string, round: number) => {
      setPhase("summary");
      const ir = actionsResultsRef.current;
      const res = await postCarrier({
        action: "round_summary",
        sessionId: sid,
        alivePlayers: alivePlayersForApi(playersRef.current, userMode),
        zombieIds: zombieIdsRef.current,
        shotgunHolderId: shotgunHolderRef.current,
        vaccineHolderId: vaccineHolderRef.current,
        shotgunUsed: shotgunUsedRef.current,
        vaccineUsed: vaccineUsedRef.current,
        roles: rolesRef.current,
        allianceLatentThisRound: allianceLatentThisRoundRef.current,
        deductionRoundHistory: deductionRoundHistoryRef.current,
        shotgunResult: ir?.shotgunResult ?? "not_used",
        vaccineResult: ir?.vaccineResult ?? "not_used",
        userMode,
        language: languageRef.current,
        round,
      });
      if (!res.ok) {
        addMessage({
          provider: "system",
          name: "System",
          text: "Round summary failed.",
          round,
          type: "system",
        });
        setPhase("setup");
        return;
      }
      await readCarrierSse(res, (ev) => {
        if (ev.type === "game_ending_narration") {
          setGameEndingNarration(String(ev.text ?? ""));
        }
        if (ev.type === "round_summary") {
          const announcement = String(ev.announcement ?? "");
          const hint = String(ev.hint ?? "");
          const score = ev.score as RoundSummaryEntry["score"];
          const rolesEvRaw = (ev.roles as Record<string, Role>) ?? {};
          const rolesEv =
            userMode === "blind" && Object.keys(rolesEvRaw).length === 0
              ? rolesRef.current
              : rolesEvRaw;
          setRoles(rolesEv);
          rolesRef.current = rolesEv;
          setRoundSummary({
            round,
            announcement,
            hint,
            shotgunResult: String(ev.shotgunResult ?? ""),
            vaccineResult: String(ev.vaccineResult ?? ""),
            teams: Array.isArray(ev.teams) ? (ev.teams as CarrierTeam[]) : [],
            allianceLatentFromActionsRound: ev.allianceLatentFromActionsRound === true,
            score: score ?? {
              humans: 0,
              zombies: 0,
              humansAll: 0,
              zombiesAll: 0,
            },
          });
          addMessage({
            provider: "system",
            name: "Round summary",
            text: `${hint}\n${announcement}`,
            round,
            type: "system",
          });
          allianceLatentThisRoundRef.current = ev.allianceLatentFromActionsRound === true;
          const teamsSnap = Array.isArray(ev.teams)
            ? (ev.teams as CarrierTeam[]).map((t) => ({
                id: t.id,
                members: [...t.members],
                ...(t.hasLatentInfection !== undefined
                  ? { hasLatentInfection: t.hasLatentInfection }
                  : {}),
                ...(typeof t.round === "number" ? { round: t.round } : {}),
              }))
            : [];
          setRoundHistories((prev) => {
            const rest = prev.filter((x) => x.round !== round);
            const next = [
              ...rest,
              {
                round,
                shotgunResult: String(ev.shotgunResult ?? "unknown"),
                vaccineResult: String(ev.vaccineResult ?? "unknown"),
                infiltrationHint: hint,
              },
            ];
            next.sort((a, b) => a.round - b.round);
            roundHistoriesRef.current = next;
            return next;
          });
          setPlayers((prev) => {
            const next = syncPlayersWithRolesTeams(prev, rolesEv, teamsSnap);
            playersRef.current = next;
            return next;
          });
          const gameOver = ev.gameOver === true;
          if (
            gameOver &&
            Array.isArray(ev.originalZombieIds) &&
            ev.originalZombieIds.length > 0
          ) {
            const oz = (ev.originalZombieIds as unknown[]).filter(
              (x): x is string => typeof x === "string"
            );
            setZombieIds(oz);
            zombieIdsRef.current = oz;
          }
          const w =
            ev.winner === "humans" || ev.winner === "zombies" ? ev.winner : null;
          setTeams(teamsSnap);
          teamsRef.current = teamsSnap;
          const soloIdsFromPayload = Array.isArray(ev.soloEliminatedForJudgment)
            ? (ev.soloEliminatedForJudgment as unknown[]).filter(
                (x): x is string => typeof x === "string"
              )
            : teamsSnap
                .filter((t) => t.members.length === 1)
                .flatMap((t) => t.members);
          const soloNames = soloIdsFromPayload.map((id) =>
            carrierDisplayNameForProvider(id, playersRef.current)
          );

          setSummaryHadGameOver(gameOver);
          setPhase("between_rounds");

          if (gameOver && w) {
            setWinner(w);
            setPendingGameEnd({
              winner: w,
              soloEliminated: soloNames,
              teamsAtJudgment: teamsSnap,
            });
          } else if (gameOver && !w) {
            setWinner(null);
            setPendingGameEnd(null);
          } else if (round >= 5) {
            const ww: "humans" | "zombies" = w ?? "humans";
            setWinner(ww);
            setPendingGameEnd({
              winner: ww,
              soloEliminated: soloNames,
              teamsAtJudgment: teamsSnap,
            });
          } else {
            setPendingGameEnd(null);
          }
        }
        if (ev.type === "error") {
          addMessage({
            provider: "system",
            name: "System",
            text: String(ev.error ?? "Error"),
            round,
            type: "system",
          });
        }
      });
    },
    [postCarrier, userMode, addMessage]
  );

  const finishAfterActionsIfDone = useCallback(
    async (sid: string, round: number) => {
      await runRoundSummary(sid, round);
    },
    [runRoundSummary]
  );

  const continueToSecondHalf = useCallback(() => {
    const sid = gameIdRef.current;
    if (!sid) return;
    setActiveHalf(2);
    setActionFeed([]);
    void (async () => {
      const r = currentRoundRef.current;
      const completed = await runActionsStream(sid, r, undefined);
      if (completed) await finishAfterActionsIfDone(sid, r);
    })();
  }, [runActionsStream, finishAfterActionsIfDone]);

  const submitUserRoundAction = useCallback(async () => {
    const sid = gameIdRef.current;
    const pack = actionsUserTurnPausedRef.current;
    if (!sid || !pack) return;
    stopUserTimer();
    const r = currentRoundRef.current;
    const completed = await runActionsStream(sid, r, {
      actionsUserTurnResume: pack,
      userAction: {
        action: userRoundAction,
        target: userRoundTarget,
      },
    });
    actionsUserTurnPausedRef.current = null;
    setUserTurnPauseUi(null);
    setUserRoundAction("NONE");
    setUserRoundTarget(null);
    if (completed) await finishAfterActionsIfDone(sid, r);
  }, [
    runActionsStream,
    finishAfterActionsIfDone,
    stopUserTimer,
    userRoundAction,
    userRoundTarget,
  ]);

  const beginRound = useCallback(
    async (round: number) => {
      const sid = gameIdRef.current;
      if (!sid) return;
      setActionFeed([]);
      currentRoundRef.current = round;
      setCurrentRound(round);
      setActiveHalf(1);
      setSummaryHadGameOver(false);
      setRoundSummary(null);
      setMessages((prev) => {
        const next = prev.filter((m) => !(m.type === "system" && m.round < round));
        messagesRef.current = next;
        return next;
      });
      addMessage({
        provider: "system",
        name: "System",
        text: `Round ${round} — 전반: 발언.`,
        round,
        type: "system",
      });
      await runSpeeches(sid, round);
    },
    [addMessage, runSpeeches]
  );

  const startGame = useCallback(async () => {
    setPhase("starting");
    setMessages([]);
    setRoundSummary(null);
    setWinner(null);
    setPendingGameEnd(null);
    setSummaryHadGameOver(false);
    setShotgunUsed(0);
    setVaccineUsed(0);
    setIsUserEliminated(false);
    setRoundHistories([]);
    roundHistoriesRef.current = [];
    setDeductionRoundHistory([]);
    deductionRoundHistoryRef.current = [];
    setDeductionBoardOpen(false);
    setGameEndingNarration("");
    allianceLatentThisRoundRef.current = false;

    const base: Player[] = AI_PLAYERS.map((p) => ({
      provider: p.provider,
      name: p.name,
      color: p.color,
      isAlive: true,
      role: "human",
      status: "HUMAN",
      teamId: null,
    }));
    if (userMode === "challenge") {
      base.push({
        provider: "user",
        name: "You",
        color: "#f4f4f5",
        isAlive: true,
        role: "human",
        status: "HUMAN",
        teamId: null,
        isUser: true,
      });
    }
    setPlayers(base);
    playersRef.current = base;
    currentRoundRef.current = 1;
    setCurrentRound(1);

    try {
      const res = await postCarrier({
        action: "start",
        alivePlayers:
          userMode === "challenge"
            ? [...AI_PLAYERS.map((p) => p.provider), "user"]
            : AI_PLAYERS.map((p) => p.provider),
        userMode,
        language: languageRef.current,
        round: 1,
      });
      if (!res.ok) {
        setPhase("setup");
        return;
      }
      let sid = "";
      let zids: string[] = [];
      let sh = "";
      let vx = "";
      let ann = "";
      await readCarrierSse(res, (ev) => {
        if (ev.type === "start") {
          sid = String(ev.sessionId ?? "");
          if (Array.isArray(ev.zombieIds)) {
            zids = (ev.zombieIds as unknown[])
              .filter((x): x is string => typeof x === "string")
              .slice(0, 4);
          }
          if (zids.length < 2 && typeof ev.zombieId === "string" && ev.zombieId) {
            zids = [ev.zombieId];
          }
          zids = [...new Set(zids)];
          sh = String(ev.shotgunHolderId ?? "");
          vx = String(ev.vaccineHolderId ?? "");
          ann = String(ev.announcement ?? "");
        }
      });
      setGameId(sid);
      gameIdRef.current = sid;
      setZombieIds(zids);
      zombieIdsRef.current = zids;
      setShotgunHolderId(sh);
      shotgunHolderRef.current = sh;
      setVaccineHolderId(vx);
      vaccineHolderRef.current = vx;

      const initialRoles: Record<string, Role> = {};
      if (userMode === "blind") {
        // BLIND: do not infer roles from zombieIds (server omits them). Empty roles → server bootstrap from DB.
      } else {
        for (const p of AI_PLAYERS) {
          initialRoles[p.provider] = zids.includes(p.provider) ? "zombie" : "human";
        }
        if (userMode === "challenge") {
          initialRoles.user = zids.includes("user") ? "zombie" : "human";
        }
      }
      setRoles(initialRoles);
      rolesRef.current = initialRoles;

      setPlayers((prev) => {
        const next = prev.map((p) => {
          const role = initialRoles[p.provider] ?? "human";
          return {
            ...p,
            role,
            status: roleToPlayerStatus(role),
            teamId: null,
          };
        });
        playersRef.current = next;
        return next;
      });

      if (userMode === "challenge") {
        setChallengeRoleToast(
          zids.includes("user")
            ? "🧟 당신은 좀비입니다. 들키지 마세요."
            : "😇 당신은 인간입니다. 생존하세요."
        );
        window.setTimeout(() => setChallengeRoleToast(null), 8000);
      }

      addMessage({
        provider: "system",
        name: "Narrator",
        text: ann || "The outbreak begins.",
        round: 1,
        type: "system",
      });

      setTeams([]);
      teamsRef.current = [];

      await beginRound(1);
    } catch {
      setPhase("setup");
    }
  }, [userMode, language, postCarrier, addMessage, beginRound]);

  useEffect(() => {
    if (userTimer !== 0) return;
    if (phase !== "user_speech" && phase !== "paused_user_action") return;
    if (turnExpireGuard.current) return;
    turnExpireGuard.current = true;
    stopUserTimer();
    if (phase === "user_speech") {
      setPhase("paused_after_speeches");
      return;
    }
    if (phase === "paused_user_action") {
      void (async () => {
        const sid = gameIdRef.current;
        const pack = actionsUserTurnPausedRef.current;
        if (!sid || !pack) return;
        const r = currentRoundRef.current;
        const completed = await runActionsStream(sid, r, {
          actionsUserTurnResume: pack,
          userAction: { action: "NONE", target: null },
        });
        actionsUserTurnPausedRef.current = null;
        setUserTurnPauseUi(null);
        setUserRoundAction("NONE");
        setUserRoundTarget(null);
        if (completed) await finishAfterActionsIfDone(sid, r);
      })();
    }
  }, [userTimer, phase, stopUserTimer, runActionsStream, finishAfterActionsIfDone]);

  const submitUserSpeech = useCallback(() => {
    turnExpireGuard.current = true;
    stopUserTimer();
    const text = userInput.trim();
    if (text) {
      addMessage({
        provider: "user",
        name: "You",
        text,
        round: currentRoundRef.current,
        type: "speech",
      });
    }
    setUserInput("");
    setPhase("paused_after_speeches");
  }, [addMessage, userInput, stopUserTimer]);

  const continueNextRound = useCallback(() => {
    if (phase !== "between_rounds") return;
    const r = currentRoundRef.current;
    if (r >= 5 || summaryHadGameOver) {
      if (pendingGameEnd) {
        setActionFeed([]);
        setRoundSummary(null);
        setPhase("pre_end_aggregate");
      } else if (summaryHadGameOver) {
        setActionFeed([]);
        setRoundSummary(null);
        setPhase("ended");
      }
      return;
    }
    const next = r + 1;
    if (next > 5) return;
    void beginRound(next);
  }, [phase, beginRound, summaryHadGameOver, pendingGameEnd]);

  const phaseLabel = useMemo(() => {
    if (phase === "setup" || phase === "starting") return "—";
    const halfKo = activeHalf === 1 ? "전반" : "후반";
    if (phase === "speeches" || phase === "user_speech") return `${currentRound}라운드 ${halfKo} · 발언`;
    if (phase === "paused_after_speeches") return `${currentRound}라운드 전반 완료`;
    if (phase === "actions") return `${currentRound}라운드 ${halfKo} · 협상`;
    if (phase === "paused_user_action") return `${currentRound}라운드 · 내 행동`;
    if (phase === "summary") return `${currentRound}라운드 · ROUND SUMMARY`;
    if (phase === "between_rounds") return `${currentRound}라운드 · CONTINUE`;
    if (phase === "pre_end_aggregate") return "최종 집계";
    if (phase === "ended") return "COMPLETE";
    return "—";
  }, [phase, currentRound, activeHalf]);

  const challengeUserActionTargets = useMemo(() => {
    const alive = alivePlayersForApi(players, userMode);
    const myTeam = teams.find((t) => t.members.includes("user"));
    if (userRoundAction === "VACCINE") {
      const m = myTeam?.members.filter((id) => alive.includes(id)) ?? [];
      return m.length ? m : alive.includes("user") ? ["user"] : [];
    }
    if (userRoundAction === "EXPEL") {
      return alive.filter((id) => id !== "user");
    }
    if (userRoundAction === "SHOTGUN") {
      return alive.filter((id) => id !== "user");
    }
    return [];
  }, [players, userMode, teams, userRoundAction]);

  return (
    <main className={BG}>
      <HelpModal content={carrierHelpContent} />
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-8 sm:px-6 lg:py-12">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Link
              href="/modes/mindgame"
              className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </Link>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-zinc-500">
                Mindgame
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                CARRIER
              </h1>
            </div>
          </div>
        </header>

        {phase === "setup" || phase === "starting" ? (
          <section className="flex flex-1 flex-col items-center justify-center py-8">
            <h2 className="text-center text-5xl font-black tracking-tight text-white sm:text-6xl">
              🦠 CARRIER
            </h2>
            <p className="mt-4 text-center">
              <span className="rounded-full border border-emerald-400/30 bg-emerald-950/30 px-3 py-1 text-xs font-medium text-emerald-100">
                {CARRIER_SESSION_COST} credits
              </span>
            </p>
            <p className="mt-3 max-w-md text-center text-sm text-zinc-500">
              Two hidden zombies; each round the host assigns new two-person teams at
              random. One human holds three shotgun shots, another three vaccine doses.
              Actions run in order: shotgun kills immediately, vaccine protects (or cures
              zombies) this round. Expel is a majority vote tallied after everyone acts
              (needs 2+ votes; ties expel no one). After votes, humans on a team with a
              living zombie turn zombie unless vaccinated this round. Up to five rounds;
              zombies win when their count meets or beats humans among the living, or one
              side is wiped out.
            </p>

            <div className="mt-10 w-full max-w-lg">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Game language
              </label>
              <div className="flex flex-wrap gap-2">
                {LANGUAGE_OPTIONS.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setLanguage(lang)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      language === lang
                        ? "bg-emerald-500/90 text-gray-950"
                        : "bg-white/5 text-zinc-400 hover:bg-white/10"
                    }`}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-10 grid w-full max-w-3xl grid-cols-1 gap-4 md:grid-cols-3">
              {(
                [
                  {
                    id: "god" as const,
                    icon: "👁️",
                    title: "GOD MODE",
                    desc: "See both zombies, shotgun, vaccine, and latent infection flags live.",
                    active: "ring-2 ring-emerald-400/90 border-emerald-500/40",
                  },
                  {
                    id: "blind" as const,
                    icon: "?",
                    title: "BLIND MODE",
                    desc: "Spectate with no secret knowledge until the end.",
                    active: "ring-2 ring-sky-500/90 border-sky-500/40",
                  },
                  {
                    id: "challenge" as const,
                    icon: "⚔️",
                    title: "CHALLENGE MODE",
                    desc: "Play as the sixth participant. You may be one of the zombies.",
                    active: "ring-2 ring-rose-500/90 border-rose-500/40",
                  },
                ] as const
              ).map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setUserMode(card.id)}
                  className={`rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left transition hover:bg-white/[0.07] ${
                    userMode === card.id ? card.active : ""
                  }`}
                >
                  <span className="text-2xl">{card.icon}</span>
                  <h3 className="mt-3 text-sm font-bold text-white">{card.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-zinc-400">{card.desc}</p>
                </button>
              ))}
            </div>

            <div className="mt-10 flex flex-wrap items-end justify-center gap-6">
              {AI_PLAYERS.map((p) => (
                <div key={p.provider} className="flex flex-col items-center gap-2">
                  <div
                    className="h-12 w-12 rounded-full shadow-lg ring-2 ring-white/10"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="text-[11px] font-medium text-zinc-400">{p.name}</span>
                </div>
              ))}
              {userMode === "challenge" ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/50 bg-zinc-800 text-sm font-bold text-white">
                    YOU
                  </div>
                  <span className="text-[11px] font-medium text-zinc-300">You</span>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              disabled={phase === "starting"}
              onClick={() => void startGame()}
              className="mt-12 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 px-12 py-4 text-sm font-bold uppercase tracking-widest text-gray-950 shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            >
              {phase === "starting" ? "Starting…" : `Start game (${CARRIER_SESSION_COST} credits)`}
            </button>
          </section>
        ) : (
          <div className="relative flex flex-1 flex-col gap-6">
            {challengeRoleToast ? (
              <div className="pointer-events-none fixed left-1/2 top-24 z-50 w-[min(90vw,380px)] -translate-x-1/2">
                <div className="rounded-2xl border-2 border-emerald-600 bg-emerald-950/95 px-6 py-5 text-center text-emerald-50 shadow-2xl backdrop-blur-sm">
                  <p className="text-lg font-black leading-snug">{challengeRoleToast}</p>
                </div>
              </div>
            ) : null}
            {userMode === "challenge" && isUserEliminated ? (
              <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-center text-sm text-amber-100/95">
                You are out — spectating.
              </div>
            ) : null}

            <div className="text-center">
              <p className="text-2xl font-black text-white sm:text-3xl">
                ROUND {currentRound}
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500/90">
                {phaseLabel}
              </p>
            </div>

            {deductionRoundHistory.length > 0 ? (
              <div className="mx-auto w-full max-w-2xl rounded-2xl border border-violet-500/35 bg-violet-950/15">
                <button
                  type="button"
                  onClick={() => setDeductionBoardOpen((o) => !o)}
                  className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition hover:bg-violet-500/10"
                >
                  <span className="text-sm font-bold text-violet-200">
                    {getCarrierUiPack(language).deductionBoardTitle}
                  </span>
                  <span className="text-xs font-bold text-violet-400 tabular-nums">
                    {deductionBoardOpen ? "▲" : "▼"}
                  </span>
                </button>
                {deductionBoardOpen ? (
                  <div className="max-h-[min(50vh,420px)] space-y-3 overflow-y-auto border-t border-violet-500/25 px-4 py-3 text-xs leading-relaxed text-zinc-300">
                    {deductionRoundHistory.map((rh) => {
                      const ko = language === "Korean";
                      const pack = getCarrierUiPack(language);
                      const cumDead = cumulativeEliminatedThroughRound(
                        deductionRoundHistory,
                        rh.round
                      );
                      const shLine =
                        rh.shotgunEvents.length > 0
                          ? rh.shotgunEvents
                              .map((e) => {
                                const r =
                                  e.result === "zombie_killed"
                                    ? ko
                                      ? "좀비 제거"
                                      : "zombie killed"
                                    : ko
                                      ? "인간 오사"
                                      : "human killed";
                                return `${carrierDisplayNameForProvider(e.shooter, players)} → ${carrierDisplayNameForProvider(e.target, players)} (${r})`;
                              })
                              .join("; ")
                          : ko
                            ? "샷건 미사용"
                            : "Shotgun not used";
                      const vxLine =
                        rh.vaccineEvents.length > 0
                          ? rh.vaccineEvents
                              .map((e) => {
                                const r =
                                  e.result === "saved"
                                    ? ko
                                      ? "구원/치료"
                                      : "saved/cured"
                                    : e.result === "immunized"
                                      ? ko
                                        ? "면역 부여"
                                        : "immunized"
                                      : ko
                                        ? "무효"
                                        : "no effect";
                                return `${carrierDisplayNameForProvider(e.user, players)} → ${carrierDisplayNameForProvider(e.target, players)} (${r})`;
                              })
                              .join("; ")
                          : ko
                            ? "백신 미사용"
                            : "Vaccine not used";
                      const elimLine =
                        rh.eliminations?.length
                          ? rh.eliminations
                              .map(
                                (e) =>
                                  `${carrierDisplayNameForProvider(e.provider, players)} — ${e.reason}`
                              )
                              .join("; ")
                          : ko
                            ? "없음"
                            : "None";
                      return (
                        <div
                          key={rh.round}
                          className="rounded-xl border border-white/10 bg-black/25 p-3 shadow-inner"
                        >
                          <p className="mb-2 font-black uppercase tracking-wider text-violet-300">
                            {ko ? `라운드 ${rh.round}` : `Round ${rh.round}`}
                          </p>
                          <section className="mt-2 space-y-1">
                            <p className="font-bold text-zinc-400">
                              {pack.teamHistoryLabel}
                            </p>
                            {rh.teams.map((team, ti) => (
                              <p key={`${rh.round}-${team.id}-${ti}`} className="pl-2 text-zinc-400">
                                {ko ? `팀 ${ti + 1}` : `Team ${ti + 1}`}:{" "}
                                {team.members.map((mid, midIdx) => (
                                  <span key={`${rh.round}-${team.id}-m-${mid}`}>
                                    {midIdx > 0 ? ", " : null}
                                    {cumDead.has(mid) ? (
                                      <>
                                        <del className="opacity-80">
                                          {carrierDisplayNameForProvider(mid, players)}
                                        </del>{" "}
                                        <span className="text-zinc-500">
                                          ({pack.labelEliminated})
                                        </span>
                                      </>
                                    ) : (
                                      carrierDisplayNameForProvider(mid, players)
                                    )}
                                  </span>
                                ))}
                              </p>
                            ))}
                          </section>
                          <section className="mt-2 space-y-1">
                            <p className="font-bold text-zinc-400">
                              {ko ? "감염" : "Infection"}
                            </p>
                            <p className="pl-2">
                              {rh.infectionOccurred
                                ? ko
                                  ? `⚠️ 감염 발생 (${rh.infectionCount}명 전환)`
                                  : `⚠️ New infection (${rh.infectionCount} turned)`
                                : ko
                                  ? "✅ 감염 없음"
                                  : "✅ No new infections"}
                            </p>
                          </section>
                          <section className="mt-2 space-y-1">
                            <p className="font-bold text-zinc-400">
                              {ko ? "투표" : "Votes"}
                            </p>
                            <p className="pl-2">
                              {summarizeDeductionVotes(rh.votes, players)} →{" "}
                              {rh.expelResult
                                ? ko
                                  ? `${carrierDisplayNameForProvider(rh.expelResult, players)} 추방${
                                      rh.expelledRole === "zombie"
                                        ? " — 🧟 좀비였습니다!"
                                        : rh.expelledRole === "human"
                                          ? " — 😇 인간이었습니다..."
                                          : ""
                                    }`
                                  : `${carrierDisplayNameForProvider(rh.expelResult, players)} expelled${
                                      rh.expelledRole === "zombie"
                                        ? " — was zombie"
                                        : rh.expelledRole === "human"
                                          ? " — was human"
                                          : ""
                                    }`
                                : ko
                                  ? "추방 없음"
                                  : "No expulsion"}
                            </p>
                          </section>
                          <section className="mt-2 space-y-1">
                            <p className="font-bold text-zinc-400">
                              {ko ? "아이템" : "Items"}
                            </p>
                            <p className="pl-2">
                              {shLine}. {vxLine}.
                            </p>
                          </section>
                          <section className="mt-2 space-y-1">
                            <p className="font-bold text-zinc-400">
                              {ko ? "제거" : "Eliminations"}
                            </p>
                            <p className="pl-2">{elimLine}</p>
                          </section>
                          <section className="mt-2 space-y-1">
                            <p className="font-bold text-zinc-400">
                              {ko ? "생존자" : "Alive"}
                            </p>
                            <p className="pl-2">
                              {rh.aliveAfter
                                .map((id) => carrierDisplayNameForProvider(id, players))
                                .join(", ")}
                            </p>
                          </section>
                          {userMode === "god" &&
                          (rh.newInfections?.length ||
                            typeof rh.zombieCountAfter === "number") ? (
                            <section className="mt-2 space-y-1 border-t border-amber-500/30 pt-2">
                              <p className="font-bold text-amber-400">
                                {ko ? "GOD 정보" : "GOD intel"}
                              </p>
                              {rh.newInfections?.length ? (
                                <p className="pl-2 text-amber-200/95">
                                  {ko ? "이번 라운드 전환: " : "Turned this round: "}
                                  {rh.newInfections
                                    .map((id) => carrierDisplayNameForProvider(id, players))
                                    .join(", ")}
                                </p>
                              ) : null}
                              {typeof rh.zombieCountAfter === "number" &&
                              typeof rh.humanCountAfter === "number" ? (
                                <p className="pl-2 text-amber-200/95">
                                  {ko
                                    ? `좀비 ${rh.zombieCountAfter} · 인간 ${rh.humanCountAfter}`
                                    : `Zombies ${rh.zombieCountAfter} · Humans ${rh.humanCountAfter}`}
                                </p>
                              ) : null}
                            </section>
                          ) : null}
                          {rh.speeches.length > 0 ? (
                            <section className="mt-2 space-y-1 border-t border-white/10 pt-2">
                              <p className="font-bold text-zinc-400">
                                {ko ? "발언 요약" : "Speech summaries"}
                              </p>
                              <ul className="list-inside list-disc space-y-1 pl-1 text-zinc-500">
                                {rh.speeches.map((s, i) => (
                                  <li key={`${rh.round}-sp-${i}`}>
                                    <span className="font-semibold text-zinc-400">{s.name}: </span>
                                    {s.summary}
                                  </li>
                                ))}
                              </ul>
                            </section>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-stretch justify-center gap-4 sm:gap-5">
              {(teams.length > 0 ? teams : [{ id: "pending", members: players.map((x) => x.provider) }]).map(
                (t, ti) => {
                  const accent =
                    TEAM_BORDER_ACCENT_PALETTE[ti % TEAM_BORDER_ACCENT_PALETTE.length] ?? "#64748b";
                  const showBand = teams.length > 0;
                  return (
                    <div
                      key={`${t.id}-${ti}`}
                      className={`flex min-w-[8rem] flex-col gap-2 rounded-2xl px-3 py-3 sm:min-w-[9rem] ${
                        showBand
                          ? "border-2 bg-white/[0.03] shadow-sm"
                          : "border border-dashed border-white/15 bg-transparent"
                      }`}
                      style={
                        showBand ? { borderColor: `${accent}cc`, boxShadow: `0 0 0 1px ${accent}22 inset` } : {}
                      }
                    >
                      {showBand ? (
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className="text-[10px] font-black uppercase tracking-wider"
                            style={{ color: accent }}
                          >
                            Team {ti + 1}
                          </span>
                          {userMode === "god" && t.hasLatentInfection === true ? (
                            <span
                              className="text-[9px] font-bold text-amber-400"
                              title="Living zombie + human together"
                            >
                              잠복
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-center text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          라운드 팀 로딩 중…
                        </p>
                      )}
                      <div className="flex flex-wrap justify-center gap-3">
                        {t.members.map((mid) => {
                          const p = playerByProvider.get(mid);
                          if (!p) return null;
                          const initial = p.name.slice(0, 1).toUpperCase();
                          const speaking = streamingProvider === p.provider;
                          const showGodSecrets = userMode === "god";
                          const showSelfSecrets = userMode === "challenge" && p.isUser === true;
                          const showRoleBadges = showGodSecrets || showSelfSecrets;
                          const showItemBadges = showGodSecrets || showSelfSecrets;

                          const showZombieBadge = showRoleBadges && p.status === "ZOMBIE";
                          const showShot =
                            showItemBadges &&
                            p.provider === shotgunHolderId &&
                            shotgunUsed < MAX_CARRIER_TOOL_USES;
                          const showVax =
                            showItemBadges &&
                            p.provider === vaccineHolderId &&
                            vaccineUsed < MAX_CARRIER_TOOL_USES;
                          const selfTool =
                            showSelfSecrets &&
                            p.isUser === true &&
                            !isUserEliminated &&
                            (p.provider === shotgunHolderId || p.provider === vaccineHolderId);
                          return (
                            <div
                              key={p.provider}
                              className={`relative flex min-w-[4.5rem] flex-col items-center gap-1.5 rounded-xl border px-2 py-3 ${
                                p.isUser
                                  ? "border-white/40 bg-white/[0.06]"
                                  : "border-white/10 bg-white/[0.03]"
                              } ${!p.isAlive ? "opacity-50 grayscale" : ""} `}
                            >
                              <div
                                className={`relative flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold text-white ${
                                  speaking
                                    ? "animate-pulse ring-4 ring-emerald-400/80"
                                    : "ring-2 ring-white/10"
                                }`}
                                style={{ backgroundColor: p.color }}
                              >
                                {showZombieBadge ? (
                                  <span className="pointer-events-none absolute -right-1 -top-1 z-10 text-xl drop-shadow-md">
                                    🧟
                                  </span>
                                ) : null}
                                {showShot ? (
                                  <span className="pointer-events-none absolute -left-1 -bottom-1 z-10 text-xl drop-shadow-md">
                                    🎯
                                  </span>
                                ) : null}
                                {showVax ? (
                                  <span className="pointer-events-none absolute -right-1 -bottom-1 z-10 text-xl drop-shadow-md">
                                    💉
                                  </span>
                                ) : null}
                                {selfTool ? (
                                  <span className="pointer-events-none absolute -left-1 -bottom-1 z-10 flex flex-col gap-0.5 text-xl leading-none drop-shadow-md">
                                    {p.provider === shotgunHolderId &&
                                    shotgunUsed < MAX_CARRIER_TOOL_USES ? (
                                      <span>🎯</span>
                                    ) : null}
                                    {p.provider === vaccineHolderId &&
                                    vaccineUsed < MAX_CARRIER_TOOL_USES ? (
                                      <span>💉</span>
                                    ) : null}
                                  </span>
                                ) : null}
                                {initial}
                                {!p.isAlive ? (
                                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 text-lg text-red-500">
                                    ✕
                                  </span>
                                ) : null}
                              </div>
                              <span className="max-w-[5rem] truncate text-center text-[10px] font-semibold text-zinc-200">
                                {p.name}
                              </span>
                              <span
                                className={`text-[9px] font-bold uppercase ${
                                  p.isAlive ? "text-emerald-400" : "text-red-400"
                                }`}
                              >
                                {p.isAlive ? "Alive" : "Out"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
              )}
            </div>

            {phase === "user_speech" && userMode === "challenge" ? (
              <div className="rounded-2xl border border-sky-500/40 bg-sky-950/25 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-sky-200">당신의 연설 (45초)</h3>
                  <span
                    className={`text-2xl font-black tabular-nums ${
                      userTimer < 10 ? "text-red-500" : "text-white"
                    }`}
                  >
                    {userTimer}s
                  </span>
                </div>
                <textarea
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  className="mt-3 w-full rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-white placeholder:text-zinc-600"
                  rows={3}
                  placeholder="이번 라운드 발언을 입력하세요…"
                />
                <button
                  type="button"
                  onClick={submitUserSpeech}
                  className="mt-3 w-full rounded-full bg-sky-500 py-2 text-xs font-bold uppercase tracking-wider text-gray-950"
                >
                  제출
                </button>
              </div>
            ) : null}

            {phase === "paused_after_speeches" && activeHalf === 1 ? (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  onClick={() => {
                    turnExpireGuard.current = false;
                    continueToSecondHalf();
                  }}
                  className="rounded-full border border-emerald-500/60 bg-emerald-500/15 px-8 py-3 text-sm font-bold tracking-wider text-emerald-100 transition hover:bg-emerald-500/25"
                >
                  후반 협상 시작 →
                </button>
              </div>
            ) : null}

            <div
              ref={feedRef}
              className="max-h-[min(40vh,360px)] flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-black/30 p-4"
            >
              {activeHalf === 2 ? (
                <div className="space-y-2">
                  {actionFeed.length === 0 ? (
                    <p className="text-center text-sm text-zinc-500">행동 로그 대기 중…</p>
                  ) : (
                    actionFeed.map((line) => (
                      <p
                        key={line.id}
                        className={`text-sm leading-relaxed ${
                          line.tone === "ok"
                            ? "text-emerald-300"
                            : line.tone === "bad"
                              ? "text-red-300"
                              : "text-zinc-200"
                        }`}
                      >
                        {line.text}
                      </p>
                    ))
                  )}
                </div>
              ) : (
                messages.map((m, i) => {
                  if (m.type === "system") {
                    return (
                      <p
                        key={`${i}-${m.round}-${m.text.slice(0, 16)}`}
                        className="mx-auto mb-4 max-w-xl whitespace-pre-wrap text-center text-sm italic text-zinc-500"
                      >
                        {m.text}
                      </p>
                    );
                  }
                  const col =
                    AI_PLAYERS.find((a) => a.provider === m.provider)?.color ??
                    (m.provider === "user" ? "#f4f4f5" : "#71717a");
                  return (
                    <div key={`${i}-${m.provider}-${i}`} className="mb-4 flex gap-3">
                      <div
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: col }}
                      />
                      <div
                        className="max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed text-zinc-100"
                        style={{ backgroundColor: `${col}14` }}
                      >
                        <div className="mb-1 flex flex-wrap items-baseline gap-2">
                          <span className="font-bold text-white">{m.name}</span>
                          <span className="rounded bg-black/30 px-1.5 text-[10px] text-zinc-400">
                            R{m.round}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap">{m.text}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {latestSummary ? (
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Round summary
                </h3>
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-50/95">
                  <p className="text-[10px] font-bold uppercase text-emerald-400/90">
                    Round {latestSummary.round}
                  </p>
                  <p className="mt-1 text-xs text-emerald-200/90">{latestSummary.hint}</p>
                  <p className="mt-2 whitespace-pre-wrap text-zinc-200">
                    {latestSummary.announcement}
                  </p>
                  <p className="mt-3 text-base leading-relaxed text-zinc-300">
                    <span className="font-semibold text-zinc-400">샷건</span>{" "}
                    {formatCarrierToolResultKo(latestSummary.shotgunResult)}
                    <span className="text-zinc-600"> · </span>
                    <span className="font-semibold text-zinc-400">백신</span>{" "}
                    {formatCarrierToolResultKo(latestSummary.vaccineResult)}
                  </p>
                  <p className="mt-3 text-base leading-relaxed text-zinc-300">
                    {(() => {
                      const currentDeduction = deductionRoundHistory.find(
                        (d) => d.round === latestSummary.round
                      );
                      const infected = currentDeduction?.infectionOccurred ?? false;
                      const count = currentDeduction?.infectionCount ?? 0;
                      const ko = language === "Korean";
                      if (infected) {
                        return ko
                          ? `⚠️ 이번 라운드 감염 발생! (${count}명 전환)`
                          : `⚠️ Infection this round! (${count} turned)`;
                      }
                      return ko ? "✅ 이번 라운드 감염 없음" : "✅ No infection this round";
                    })()}
                  </p>
                </div>
              </div>
            ) : null}

            {phase === "paused_user_action" && userTurnPauseUi ? (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-950/25 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-rose-200">내 행동 (45초)</h3>
                  <span
                    className={`text-2xl font-black tabular-nums ${
                      userTimer < 10 ? "text-red-500" : "text-white"
                    }`}
                  >
                    {userTimer}s
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(
                    [
                      ...(challengeUserPauseCanShotgun
                        ? ([["샷건", "SHOTGUN" as const]] as const)
                        : []),
                      ...(challengeUserPauseCanVaccine
                        ? ([["백신", "VACCINE" as const]] as const)
                        : []),
                      ["추방 투표", "EXPEL" as const],
                      ["패스", "NONE" as const],
                    ] as const
                  ).map(([label, a]) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setUserRoundAction(a)}
                      className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                        userRoundAction === a
                          ? "bg-rose-500 text-gray-950"
                          : "bg-white/10 text-zinc-300"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {userRoundAction !== "NONE" ? (
                  <p className="mt-2 text-[11px] text-zinc-500">
                    {userRoundAction === "SHOTGUN"
                      ? "샷건 대상 (본인 제외 생존자)"
                      : userRoundAction === "VACCINE"
                        ? "백신 대상 (이번 라운드 같은 팀 + 본인)"
                        : userRoundAction === "EXPEL"
                          ? "추방 투표 대상 (생존 플레이어)"
                          : "대상 선택"}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {challengeUserActionTargets.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setUserRoundTarget(id)}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                          userRoundTarget === id
                            ? "bg-rose-500 text-white"
                            : "bg-white/10 text-zinc-300"
                        }`}
                      >
                        {playerByProvider.get(id)?.name ??
                          AI_PLAYERS.find((a) => a.provider === id)?.name ??
                          id}
                      </button>
                    ))}
                </div>
                <button
                  type="button"
                  onClick={() => void submitUserRoundAction()}
                  className="mt-4 w-full rounded-full bg-rose-500 py-2 text-xs font-bold uppercase tracking-wider text-gray-950"
                >
                  행동 확정
                </button>
              </div>
            ) : null}

            {phase === "between_rounds" ? (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  onClick={continueNextRound}
                  className="rounded-full border border-emerald-500/60 bg-emerald-500/15 px-8 py-3 text-sm font-bold uppercase tracking-wider text-emerald-100 transition hover:bg-emerald-500/25"
                >
                  다음 라운드 →
                </button>
              </div>
            ) : null}

            {phase === "pre_end_aggregate" && pendingGameEnd ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
                <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/15 bg-zinc-900/95 p-8 shadow-2xl">
                  <h2 className="text-center text-xl font-black text-white sm:text-2xl">
                    최종 결과 집계 중...
                  </h2>
                  <div className="mt-6 space-y-2 text-sm text-zinc-200">
                    {pendingGameEnd.soloEliminated.length > 0
                      ? pendingGameEnd.soloEliminated.map((name) => (
                          <p key={name} className="text-center">
                            {name}은 혼자 남아 제거되었습니다 ☠️
                          </p>
                        ))
                      : null}
                  </div>
                  <div className="mt-8">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                      판정 기준 팀 구성
                    </h3>
                    <div className="mt-3 space-y-2 text-sm text-zinc-200">
                      {pendingGameEnd.teamsAtJudgment
                        .filter((t) => t.members.length > 1)
                        .map((t, idx) => {
                          const names = t.members
                            .map((m) => carrierDisplayNameForProvider(m, players))
                            .join(", ");
                          return (
                            <p key={`pre-${t.id}-${idx}`}>
                              Team {String.fromCharCode(65 + idx)} ({t.members.length}명):{" "}
                              {names}
                            </p>
                          );
                        })}
                      {pendingGameEnd.teamsAtJudgment.every((t) => t.members.length <= 1) ? (
                        <p className="text-zinc-500">다인 팀 없음 (전원 솔로)</p>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingGameEnd(null);
                      setPhase("ended");
                    }}
                    className="mt-10 w-full rounded-full bg-emerald-500 py-4 text-base font-black text-gray-950 shadow-lg shadow-emerald-500/25"
                  >
                    최종 결과 확인 →
                  </button>
                </div>
              </div>
            ) : null}

            {phase === "ended" ? (
              <div
                className={`fixed inset-0 z-40 flex items-center justify-center p-4 ${
                  winner === "humans"
                    ? "bg-emerald-950/95"
                    : winner === "zombies"
                      ? "bg-red-950/95"
                      : "bg-zinc-950/95"
                }`}
              >
                <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-black/60 p-8 shadow-2xl">
                  {(() => {
                    const pack = getCarrierUiPack(language);
                    const originalZombieSet = new Set(zombieIds);
                    return (
                      <>
                  {gameEndingNarration ? (
                    <p className="mb-6 whitespace-pre-wrap text-center text-sm leading-relaxed text-zinc-100">
                      {gameEndingNarration}
                    </p>
                  ) : null}
                  <h2
                    className={`text-center text-2xl font-black ${
                      winner === "humans"
                        ? "text-emerald-300"
                        : winner === "zombies"
                          ? "text-red-300"
                          : "text-zinc-300"
                    }`}
                  >
                    {winner === "humans"
                      ? pack.humansWin
                      : winner === "zombies"
                        ? pack.zombiesWin
                        : pack.gameOver}
                  </h2>
                  <p className="mt-2 text-center text-sm text-zinc-400">
                    {pack.finalRevealBlurb}
                  </p>

                  <div className="mt-8">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                      {pack.originalZombiesHeading}
                    </h3>
                    <p className="mt-2 text-lg font-bold text-white">
                      {formatCarrierOriginalZombiesLine(zombieIds)}
                    </p>
                  </div>

                  <div className="mt-6">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                      {pack.finalRolesHeading}
                    </h3>
                    <ul className="mt-2 space-y-1 text-sm text-zinc-200">
                      {players.map((p) => {
                        const wasOriginalZombie = originalZombieSet.has(p.provider);
                        if (wasOriginalZombie && p.role === "human") {
                          return (
                            <li key={p.provider}>
                              🧟→😇 {p.name} ({pack.noteCuredZombie})
                            </li>
                          );
                        }
                        if (!wasOriginalZombie && p.role === "zombie") {
                          return (
                            <li key={p.provider}>
                              😇→🦠 {p.name} ({pack.noteHumanInfected})
                            </li>
                          );
                        }
                        return (
                          <li key={p.provider}>
                            {p.name}: {p.role === "zombie" ? `🦠 ${pack.roleZombie}` : pack.roleHuman}
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div className="mt-6">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                      {pack.infectionHeading}
                    </h3>
                    <p className="mt-2 text-xs text-zinc-400">{pack.infectionRule}</p>
                  </div>

                  <button
                    type="button"
                    onClick={resetGame}
                    className="mt-8 w-full rounded-full bg-white py-3 text-sm font-bold text-gray-950"
                  >
                    {pack.playAgain}
                  </button>
                      </>
                    );
                  })()}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
