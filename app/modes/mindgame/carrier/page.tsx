"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronLeft } from "lucide-react";

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

  const postCarrier = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/mindgame/carrier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return res;
    },
    []
  );

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
        const tally = ev.tally as Record<string, number> | undefined;
        const expelled =
          typeof ev.expelled === "string" && ev.expelled.length > 0 ? ev.expelled : null;
        const expelledRoleEv =
          ev.expelledRole === "zombie" || ev.expelledRole === "human"
            ? ev.expelledRole
            : null;
        const snap = playersRef.current;
        const koLang = languageRef.current === "Korean";
        const tallyStr =
          tally && typeof tally === "object"
            ? Object.entries(tally)
                .map(
                  ([id, n]) =>
                    `${carrierDisplayNameForProvider(id, snap)} ×${String(n)}`
                )
                .join(", ")
            : "";
        if (expelled) {
          const roleSuffix =
            expelledRoleEv === "zombie"
              ? koLang
                ? " — 🧟 좀비였습니다!"
                : " — 🧟 Was a zombie!"
              : expelledRoleEv === "human"
                ? koLang
                  ? " — 😇 인간이었습니다..."
                  : " — 😇 Was human..."
                : "";
          const tone: ActionFeedLine["tone"] =
            expelledRoleEv === "zombie"
              ? "ok"
              : expelledRoleEv === "human"
                ? "bad"
                : "neutral";
          pushActionLine(
            `📋 집계: ${carrierDisplayNameForProvider(expelled, snap)} 추방 (${tallyStr || "표"})${roleSuffix}`,
            tone,
            { provider: expelled, actionType: "vote_out" }
          );
        } else {
          pushActionLine(
            `📋 집계: 추방 없음 — 동표 또는 최다 2표 미만${tallyStr ? ` (${tallyStr})` : ""}`,
            "neutral",
            { provider: "system", actionType: "vote_none" }
          );
        }

        const allVotes = ev.votes as Record<string, string> | undefined;
        if (allVotes && tally && typeof tally === "object") {
          const tallyTotal = Object.values(tally).reduce((a, b) => a + b, 0);
          const voteTotal = Object.keys(allVotes).length;
          if (tallyTotal < voteTotal) {
            const invalidCount = voteTotal - tallyTotal;
            const invalidNote = koLang
              ? `⚠️ ${invalidCount}표 무효 처리 (투표 후 사살된 플레이어)`
              : `⚠️ ${invalidCount} vote(s) invalidated (voter eliminated after voting)`;
            pushActionLine(invalidNote, "neutral", {
              provider: "system",
              actionType: "vote_invalid_note",
            });
          }
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
              {phase === "starting" ? "Starting…" : "Start game"}
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
                    {language === "Korean" ? "📋 추리 보드" : "📋 Deduction Board"}
                  </span>
                  <span className="text-xs font-bold text-violet-400 tabular-nums">
                    {deductionBoardOpen ? "▲" : "▼"}
                  </span>
                </button>
                {deductionBoardOpen ? (
                  <div className="max-h-[min(50vh,420px)] space-y-3 overflow-y-auto border-t border-violet-500/25 px-4 py-3 text-xs leading-relaxed text-zinc-300">
                    {deductionRoundHistory.map((rh) => {
                      const ko = language === "Korean";
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
                              {ko ? "팀 편성" : "Team history"}
                            </p>
                            {rh.teams.map((team, ti) => (
                              <p key={`${rh.round}-${team.id}-${ti}`} className="pl-2 text-zinc-400">
                                {ko ? `팀 ${ti + 1}` : `Team ${ti + 1}`}:{" "}
                                {team.members
                                  .map((id) => carrierDisplayNameForProvider(id, players))
                                  .join(", ")}
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
                      ["샷건", "SHOTGUN"],
                      ["백신", "VACCINE"],
                      ["추방 투표", "EXPEL"],
                      ["패스", "NONE"],
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
                      ? "Humans win"
                      : winner === "zombies"
                        ? "Zombies win"
                        : "Game over"}
                  </h2>
                  <p className="mt-2 text-center text-sm text-zinc-400">
                    Full reveal — roles at end, original zombies, and infection notes.
                  </p>

                  <div className="mt-8">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                      Original zombies
                    </h3>
                    <p className="mt-2 text-lg font-bold text-white">
                      {formatCarrierOriginalZombiesLine(zombieIds)}
                    </p>
                  </div>

                  <div className="mt-6">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                      Final roles
                    </h3>
                    <ul className="mt-2 space-y-1 text-sm text-zinc-200">
                      {players.map((p) => (
                        <li key={p.provider}>
                          {p.name}: {p.role === "zombie" ? "🦠 Zombie" : "Human"}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-6">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                      Infection
                    </h3>
                    <p className="mt-2 text-xs text-zinc-400">
                      End-of-round rule: any surviving human who shares a team with a living zombie
                      becomes a zombie unless they were vaccinated that same round.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={resetGame}
                    className="mt-8 w-full rounded-full bg-white py-3 text-sm font-bold text-gray-950"
                  >
                    Play again
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
