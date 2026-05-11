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
  | "paused_user_alliance"
  | "paused_user_action"
  | "summary"
  | "between_rounds"
  | "ended";

type Role = "human" | "zombie";

type Player = {
  provider: string;
  name: string;
  color: string;
  isAlive: boolean;
  role: Role;
  isUser?: boolean;
};

type GameMessage = {
  provider: string;
  name: string;
  text: string;
  round: number;
  type: "speech" | "system" | "alliance_request" | "alliance_response";
};

type CarrierTeam = { id: string; members: string[]; hasLatentInfection?: boolean };

type RoundSummaryEntry = {
  round: number;
  announcement: string;
  hint: string;
  shotgunResult: string;
  vaccineResult: string;
  teams: CarrierTeam[];
  score: { humans: number; zombies: number; humansAll: number; zombiesAll: number };
};

type LatentInfectionEvent = {
  round: number;
  zombieName: string;
  infectedTeamMembers: string[];
};

type PendingInfectionTeamClient = {
  zombieProvider: string;
  memberIds: string[];
};

type UserRoundAction =
  | "ALLIANCE_REQUEST"
  | "SHOTGUN"
  | "VACCINE"
  | "EXPEL"
  | "NONE";

type ActionFeedLine = { id: string; text: string; tone?: "ok" | "bad" | "neutral" };

type ActionsPausedPayload = {
  acted: string[];
  order: string[];
  resumeIndex: number;
  teams: CarrierTeam[];
  roles: Record<string, Role>;
  eliminated: string[];
  shotgunUsed: boolean;
  vaccineUsed: boolean;
  shotgunResult: string;
  vaccineResult: string;
  allianceLatentThisRound: boolean;
  allianceJoinedIdsThisRound?: string[];
  allianceResponderAcceptedIdsThisRound?: string[];
  actionsThisRound?: Record<string, string>;
  pending: { requester: string; target: string; reqText: string };
};

type ActionsUserTurnPayload = Omit<ActionsPausedPayload, "pending">;

const BG =
  "min-h-screen bg-gray-950 text-zinc-100 selection:bg-emerald-500/30";

/** API `result` strings → Korean labels for action feed (접종/발사). */
function formatCarrierToolResultKo(result: unknown): string {
  const r = String(result ?? "");
  switch (r) {
    case "human_died":
      return "인간이었습니다 (낭비)";
    case "no_effect":
      return "인간이었습니다 (효과 없음)";
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
    .filter(
      (m): m is GameMessage & { type: "speech" | "alliance_request" | "alliance_response" } =>
        m.type === "speech" || m.type === "alliance_request" || m.type === "alliance_response"
    )
    .map((m) => ({
      provider: m.provider,
      name: m.name,
      text: m.text,
      round: m.round,
      type: m.type,
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
  const [zombieId, setZombieId] = useState<string | null>(null);
  const [shotgunHolderId, setShotgunHolderId] = useState<string | null>(null);
  const [vaccineHolderId, setVaccineHolderId] = useState<string | null>(null);
  const [shotgunUsed, setShotgunUsed] = useState(false);
  const [vaccineUsed, setVaccineUsed] = useState(false);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [teams, setTeams] = useState<CarrierTeam[]>([]);
  const [roundSummary, setRoundSummary] = useState<RoundSummaryEntry | null>(null);
  const [winner, setWinner] = useState<"humans" | "zombies" | null>(null);
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
  const [allianceRequestDraft, setAllianceRequestDraft] = useState("");
  const [alliancePauseUi, setAlliancePauseUi] = useState<ActionsPausedPayload | null>(null);
  const [userTurnPauseUi, setUserTurnPauseUi] = useState<ActionsUserTurnPayload | null>(null);
  const [latentInfectionEvents, setLatentInfectionEvents] = useState<
    LatentInfectionEvent[]
  >([]);
  const [gameEndingNarration, setGameEndingNarration] = useState<string>("");

  const feedRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesRef = useRef<GameMessage[]>([]);
  const playersRef = useRef<Player[]>([]);
  const currentRoundRef = useRef(1);
  const rolesRef = useRef<Record<string, Role>>({});
  const teamsRef = useRef<CarrierTeam[]>([]);
  const shotgunUsedRef = useRef(false);
  const vaccineUsedRef = useRef(false);
  const shotgunHolderRef = useRef<string | null>(null);
  const vaccineHolderRef = useRef<string | null>(null);
  const zombieIdRef = useRef<string | null>(null);
  const gameIdRef = useRef<string | null>(null);
  /** From last `actions_complete` — sent to `round_summary` as `pendingInfectionTeams` (latent applied once there). */
  const pendingInfectionTeamsRef = useRef<PendingInfectionTeamClient[]>([]);
  const allianceLatentThisRoundRef = useRef(false);
  const actionsResultsRef = useRef<{
    shotgunResult: string;
    vaccineResult: string;
    shotgunUsed: boolean;
    vaccineUsed: boolean;
    roles: Record<string, Role>;
    eliminated: string[];
    teams: CarrierTeam[];
  } | null>(null);
  const actionsAlliancePausedRef = useRef<ActionsPausedPayload | null>(null);
  const actionsUserTurnPausedRef = useRef<ActionsUserTurnPayload | null>(null);
  const actionsStreamPausedRef = useRef(false);
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
    zombieIdRef.current = zombieId;
    gameIdRef.current = gameId;
  }, [
    shotgunUsed,
    vaccineUsed,
    shotgunHolderId,
    vaccineHolderId,
    zombieId,
    gameId,
  ]);

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
    setZombieId(null);
    setShotgunHolderId(null);
    setVaccineHolderId(null);
    setShotgunUsed(false);
    setVaccineUsed(false);
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
    setAllianceRequestDraft("");
    setLatentInfectionEvents([]);
    setGameEndingNarration("");
    pendingInfectionTeamsRef.current = [];
    allianceLatentThisRoundRef.current = false;
    actionsResultsRef.current = null;
    actionsAlliancePausedRef.current = null;
    actionsUserTurnPausedRef.current = null;
    setAlliancePauseUi(null);
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
      actionsResultsRef.current = {
        shotgunResult: String(ev.shotgunResult ?? "not_used"),
        vaccineResult: String(ev.vaccineResult ?? "not_used"),
        shotgunUsed: ev.shotgunUsed === true,
        vaccineUsed: ev.vaccineUsed === true,
        roles: (ev.roles as Record<string, Role>) ?? {},
        eliminated: Array.isArray(ev.eliminated) ? (ev.eliminated as string[]) : [],
        teams: Array.isArray(ev.teams) ? (ev.teams as CarrierTeam[]) : [],
      };
      if (Array.isArray(ev.pendingInfectionTeams)) {
        pendingInfectionTeamsRef.current = ev.pendingInfectionTeams as PendingInfectionTeamClient[];
      } else {
        pendingInfectionTeamsRef.current = [];
      }
      allianceLatentThisRoundRef.current = pendingInfectionTeamsRef.current.length > 0;
      const ir = actionsResultsRef.current;
      setShotgunUsed(ir.shotgunUsed);
      setVaccineUsed(ir.vaccineUsed);
      setRoles(ir.roles);
      rolesRef.current = ir.roles;
      const teamsSnapshot = ir.teams.map((t) => ({
        id: t.id,
        members: [...t.members],
        ...(t.hasLatentInfection !== undefined
          ? { hasLatentInfection: t.hasLatentInfection }
          : {}),
      }));
      setTeams(teamsSnapshot);
      teamsRef.current = teamsSnapshot;
      for (const e of ir.eliminated) {
        setPlayers((prev) => {
          const next = prev.map((p) =>
            p.provider === e ? { ...p, isAlive: false } : p
          );
          playersRef.current = next;
          return next;
        });
        if (e === "user") {
          setIsUserEliminated(true);
          addMessage({
            provider: "system",
            name: "System",
            text: "You were eliminated. Observing in blind mode.",
            round,
            type: "system",
          });
        }
      }
    },
    [addMessage]
  );

  const handleActionSse = useCallback(
    (ev: Record<string, unknown>, round: number) => {
      const fromn = (x: unknown) => String(x ?? "?");
      if (ev.type === "action_request") {
        pushActionLine(
          `💬 ${fromn(ev.fromName)} → ${fromn(ev.toName)}: ${fromn(ev.text)}`,
          "neutral",
          { provider: String(ev.from ?? "unknown"), actionType: "action_request" }
        );
      }
      if (ev.type === "action_response") {
        const acc = ev.accepted === true;
        pushActionLine(
          `${acc ? "✅" : "❌"} ${fromn(ev.fromName)}: ${fromn(ev.text)}`,
          acc ? "ok" : "bad",
          { provider: String(ev.from ?? "unknown"), actionType: "action_response" }
        );
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
      }
      if (ev.type === "action_expel") {
        pushActionLine(
          `🚫 ${fromn(ev.fromName)} → ${fromn(ev.targetName)}: 추방!`,
          "neutral",
          { provider: String(ev.from ?? "unknown"), actionType: "EXPEL" }
        );
      }
      if (ev.type === "action_none") {
        pushActionLine(`⏸ ${fromn(ev.name)}: 이번 라운드 행동 없음`, "neutral", {
          provider: String(ev.provider ?? "unknown"),
          actionType: "NONE",
        });
      }
      if (ev.type === "actions_paused") {
        actionsStreamPausedRef.current = true;
        const p = ev.payload as ActionsPausedPayload;
        actionsAlliancePausedRef.current = p;
        setAlliancePauseUi(p);
        setPhase("paused_user_alliance");
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
        zombieId: zombieIdRef.current,
        shotgunHolderId: shotgunHolderRef.current,
        vaccineHolderId: vaccineHolderRef.current,
        shotgunUsed: shotgunUsedRef.current,
        vaccineUsed: vaccineUsedRef.current,
        roles: rolesRef.current,
        conversation: fullConversationPayload(messagesRef.current),
        teams: teamsRef.current,
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
        zombieId: zombieIdRef.current,
        shotgunHolderId: shotgunHolderRef.current,
        vaccineHolderId: vaccineHolderRef.current,
        shotgunUsed: shotgunUsedRef.current,
        vaccineUsed: vaccineUsedRef.current,
        roles: rolesRef.current,
        conversation: fullConversationPayload(messagesRef.current),
        teams: teamsRef.current,
        userMode,
        language: languageRef.current,
        round,
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
        zombieId: zombieIdRef.current,
        shotgunHolderId: shotgunHolderRef.current,
        vaccineHolderId: vaccineHolderRef.current,
        shotgunUsed: shotgunUsedRef.current,
        vaccineUsed: vaccineUsedRef.current,
        roles: rolesRef.current,
        teams: teamsRef.current,
        pendingInfectionTeams: pendingInfectionTeamsRef.current,
        allianceLatentThisRound: allianceLatentThisRoundRef.current,
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
          const rolesEv = (ev.roles as Record<string, Role>) ?? {};
          setRoles(rolesEv);
          rolesRef.current = rolesEv;
          setRoundSummary({
            round,
            announcement,
            hint,
            shotgunResult: String(ev.shotgunResult ?? ""),
            vaccineResult: String(ev.vaccineResult ?? ""),
            teams: Array.isArray(ev.teams) ? (ev.teams as CarrierTeam[]) : [],
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
          pendingInfectionTeamsRef.current = [];
          allianceLatentThisRoundRef.current = false;
          if (ev.latentInfectionSummary && typeof ev.latentInfectionSummary === "object") {
            const ls = ev.latentInfectionSummary as Record<string, unknown>;
            const zname = String(ls.zombieName ?? "");
            const members = Array.isArray(ls.infectedTeamMembers)
              ? (ls.infectedTeamMembers as unknown[]).map((x) => String(x))
              : [];
            const r = typeof ls.round === "number" ? ls.round : round;
            if (zname && members.length) {
              setLatentInfectionEvents((prev) => [
                ...prev,
                { round: r, zombieName: zname, infectedTeamMembers: members },
              ]);
            }
          }
          setPlayers((prev) =>
            prev.map((p) => ({
              ...p,
              role: rolesEv[p.provider] ?? p.role,
            }))
          );
          if (ev.gameOver === true) {
            setWinner(
              ev.winner === "humans" || ev.winner === "zombies"
                ? ev.winner
                : null
            );
            setPhase("ended");
          } else {
            setPhase("between_rounds");
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

  const resumeAllianceResponse = useCallback(
    async (accepted: boolean, text?: string) => {
      const sid = gameIdRef.current;
      const pack = actionsAlliancePausedRef.current;
      if (!sid || !pack) return;
      stopUserTimer();
      const r = currentRoundRef.current;
      const completed = await runActionsStream(sid, r, {
        actionsPausedResume: pack,
        userAllianceResponse: { accepted, text: text ?? "" },
      });
      actionsAlliancePausedRef.current = null;
      setAlliancePauseUi(null);
      if (completed) await finishAfterActionsIfDone(sid, r);
    },
    [runActionsStream, finishAfterActionsIfDone, stopUserTimer]
  );

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
      userAllianceRequestText:
        userRoundAction === "ALLIANCE_REQUEST" && allianceRequestDraft.trim()
          ? allianceRequestDraft.trim()
          : null,
    });
    actionsUserTurnPausedRef.current = null;
    setUserTurnPauseUi(null);
    setUserRoundAction("NONE");
    setUserRoundTarget(null);
    setAllianceRequestDraft("");
    if (completed) await finishAfterActionsIfDone(sid, r);
  }, [
    runActionsStream,
    finishAfterActionsIfDone,
    stopUserTimer,
    userRoundAction,
    userRoundTarget,
    allianceRequestDraft,
  ]);

  const beginRound = useCallback(
    async (round: number) => {
      const sid = gameIdRef.current;
      if (!sid) return;
      currentRoundRef.current = round;
      setCurrentRound(round);
      setActiveHalf(1);
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
    setIsUserEliminated(false);
    setLatentInfectionEvents([]);
    setGameEndingNarration("");
    pendingInfectionTeamsRef.current = [];
    allianceLatentThisRoundRef.current = false;

    const base: Player[] = AI_PLAYERS.map((p) => ({
      provider: p.provider,
      name: p.name,
      color: p.color,
      isAlive: true,
      role: "human",
    }));
    if (userMode === "challenge") {
      base.push({
        provider: "user",
        name: "You",
        color: "#f4f4f5",
        isAlive: true,
        role: "human",
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
        alivePlayers: AI_PLAYERS.map((p) => p.provider),
        userMode,
        language: languageRef.current,
        round: 1,
      });
      if (!res.ok) {
        setPhase("setup");
        return;
      }
      let sid = "";
      let zid = "";
      let sh = "";
      let vx = "";
      let ann = "";
      await readCarrierSse(res, (ev) => {
        if (ev.type === "start") {
          sid = String(ev.sessionId ?? "");
          zid = String(ev.zombieId ?? "");
          sh = String(ev.shotgunHolderId ?? "");
          vx = String(ev.vaccineHolderId ?? "");
          ann = String(ev.announcement ?? "");
        }
      });
      setGameId(sid);
      gameIdRef.current = sid;
      setZombieId(zid);
      zombieIdRef.current = zid;
      setShotgunHolderId(sh);
      shotgunHolderRef.current = sh;
      setVaccineHolderId(vx);
      vaccineHolderRef.current = vx;

      const initialRoles: Record<string, Role> = {};
      for (const p of AI_PLAYERS) {
        initialRoles[p.provider] = p.provider === zid ? "zombie" : "human";
      }
      if (userMode === "challenge") {
        initialRoles.user = zid === "user" ? "zombie" : "human";
      }
      setRoles(initialRoles);
      rolesRef.current = initialRoles;

      setPlayers((prev) =>
        prev.map((p) => ({
          ...p,
          role: initialRoles[p.provider] ?? "human",
        }))
      );

      if (userMode === "challenge") {
        setChallengeRoleToast(
          zid === "user"
            ? "You are the ZOMBIE. Infiltrate and survive."
            : "You are HUMAN. Survive the outbreak."
        );
        window.setTimeout(() => setChallengeRoleToast(null), 5000);
      }

      addMessage({
        provider: "system",
        name: "Narrator",
        text: ann || "The outbreak begins.",
        round: 1,
        type: "system",
      });

      const soloTeams: CarrierTeam[] = alivePlayersForApi(
        playersRef.current,
        userMode
      ).map((id) => ({ id: `team_${id}`, members: [id] }));
      setTeams(soloTeams);
      teamsRef.current = soloTeams;

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
          userAllianceRequestText: null,
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
    const next = currentRoundRef.current + 1;
    if (next > 5) return;
    void beginRound(next);
  }, [phase, beginRound]);

  const phaseLabel = useMemo(() => {
    if (phase === "setup" || phase === "starting") return "—";
    if (phase === "speeches" || phase === "user_speech") return "전반 · 발언";
    if (phase === "paused_after_speeches") return "전반 완료";
    if (phase === "actions") return "후반 · 협상";
    if (phase === "paused_user_alliance") return "동맹 응답";
    if (phase === "paused_user_action") return "내 행동";
    if (phase === "summary") return "ROUND SUMMARY";
    if (phase === "between_rounds") return "CONTINUE";
    if (phase === "ended") return "COMPLETE";
    return "—";
  }, [phase]);

  const soloTeamsInit = useMemo(() => {
    const ids: string[] = AI_PLAYERS.map((p) => p.provider);
    if (userMode === "challenge") ids.push("user");
    return ids;
  }, [userMode]);

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
              Social deduction with hidden infection, alliances, shotgun, and
              vaccine. Five rounds. Largest faction wins — solos excluded from
              final judgment.
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
                    desc: "See zombie, shotgun, vaccine, and latent infection flags live.",
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
                    desc: "Play as the seventh participant. You may be the zombie.",
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

            <div className="flex flex-wrap items-stretch justify-center gap-3 sm:gap-4">
              {players.map((p) => {
                const initial = p.name.slice(0, 1).toUpperCase();
                const speaking = streamingProvider === p.provider;
                const showZombie = userMode === "god" && p.role === "zombie";
                const showShot =
                  userMode === "god" && p.provider === shotgunHolderId && !shotgunUsed;
                const showVax =
                  userMode === "god" && p.provider === vaccineHolderId && !vaccineUsed;
                const selfZombieChallenge =
                  userMode === "challenge" &&
                  p.isUser &&
                  p.role === "zombie" &&
                  !isUserEliminated;
                const selfTool =
                  userMode === "challenge" &&
                  p.isUser &&
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
                        speaking ? "animate-pulse ring-4 ring-emerald-400/80" : "ring-2 ring-white/10"
                      }`}
                      style={{ backgroundColor: p.color }}
                    >
                      {showZombie || selfZombieChallenge ? (
                        <span className="pointer-events-none absolute -right-0.5 -top-0.5 z-10 text-[11px] drop-shadow-md">
                          🦠
                        </span>
                      ) : null}
                      {showShot ? (
                        <span className="pointer-events-none absolute -left-0.5 -top-0.5 z-10 text-[10px]">
                          🔫
                        </span>
                      ) : null}
                      {showVax ? (
                        <span className="pointer-events-none absolute -right-0.5 -bottom-0.5 z-10 text-[10px]">
                          💉
                        </span>
                      ) : null}
                      {selfTool ? (
                        <span className="pointer-events-none absolute -left-0.5 -bottom-0.5 z-10 text-[10px]">
                          {p.provider === shotgunHolderId && !shotgunUsed ? "🔫" : ""}
                          {p.provider === vaccineHolderId && !vaccineUsed ? "💉" : ""}
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

            {teams.length > 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Teams
                </h3>
                <div className="mt-3 space-y-3">
                  {teams
                    .filter((t) => t.members.length > 1)
                    .map((t, idx) => {
                      const names = t.members
                        .map((m) => playerByProvider.get(m)?.name ?? m)
                        .join(" + ");
                      const rosterKey = [...t.members].sort().join("_");
                      return (
                        <div
                          key={`team-${rosterKey}`}
                          className={`rounded-xl border px-3 py-2 ${
                            userMode === "god" && t.hasLatentInfection
                              ? "border-amber-500/50 bg-amber-950/30"
                              : "border-white/10 bg-black/30"
                          }`}
                        >
                          <p className="text-[10px] font-semibold uppercase text-zinc-500">
                            Team {String.fromCharCode(65 + idx)}: {names}
                            {userMode === "god" && t.hasLatentInfection ? " · latent" : ""}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {t.members.map((m) => {
                              const pl = playerByProvider.get(m);
                              const col =
                                AI_PLAYERS.find((a) => a.provider === m)?.color ??
                                (m === "user" ? "#f4f4f5" : "#e4e4e7");
                              return (
                                <span
                                  key={m}
                                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                                  style={{ backgroundColor: `${col}55` }}
                                >
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: col }}
                                  />
                                  {pl?.name ?? m}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase text-zinc-500">
                      Solo players
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {teams
                        .filter((t) => t.members.length === 1)
                        .flatMap((t) => t.members)
                        .map((m) => {
                          const pl = playerByProvider.get(m);
                          const col =
                            AI_PLAYERS.find((a) => a.provider === m)?.color ??
                            (m === "user" ? "#f4f4f5" : "#e4e4e7");
                          return (
                            <span
                              key={m}
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                              style={{ backgroundColor: `${col}55` }}
                            >
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: col }}
                              />
                              {pl?.name ?? m}
                            </span>
                          );
                        })}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

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
                  <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base text-zinc-300">
                    <span className="font-semibold text-emerald-200/95">생존</span>
                    <span className="text-zinc-400">인간</span>
                    <span className="text-lg font-bold tabular-nums text-white">
                      {latestSummary.score.humans}
                    </span>
                    <span className="text-zinc-500">명</span>
                    <span className="text-zinc-600">·</span>
                    <span className="text-zinc-400">좀비</span>
                    <span className="text-lg font-bold tabular-nums text-white">
                      {latestSummary.score.zombies}
                    </span>
                    <span className="text-zinc-500">명</span>
                  </p>
                </div>
              </div>
            ) : null}

            {phase === "paused_user_alliance" && alliancePauseUi ? (
              <div className="rounded-2xl border border-amber-500/40 bg-amber-950/25 p-4">
                <p className="text-sm text-amber-100">
                  {playerByProvider.get(alliancePauseUi.pending.requester)?.name ??
                    alliancePauseUi.pending.requester}
                  의 동맹 요청
                </p>
                <p className="mt-2 text-sm text-zinc-200">{alliancePauseUi.pending.reqText}</p>
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => void resumeAllianceResponse(true, "좋아요, 함께합시다.")}
                    className="flex-1 rounded-full bg-emerald-600 py-2 text-sm font-bold text-white"
                  >
                    수락
                  </button>
                  <button
                    type="button"
                    onClick={() => void resumeAllianceResponse(false, "이번엔 어렵네요.")}
                    className="flex-1 rounded-full bg-red-600/90 py-2 text-sm font-bold text-white"
                  >
                    거절
                  </button>
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
                      ["동맹요청", "ALLIANCE_REQUEST"],
                      ["샷건", "SHOTGUN"],
                      ["백신", "VACCINE"],
                      ["추방", "EXPEL"],
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
                {userRoundAction === "ALLIANCE_REQUEST" ? (
                  <input
                    type="text"
                    value={allianceRequestDraft}
                    onChange={(e) => setAllianceRequestDraft(e.target.value)}
                    placeholder="동맹 요청 한 줄 (선택)"
                    className="mt-3 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                  />
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {soloTeamsInit
                    .filter((id) => alivePlayersForApi(players, userMode).includes(id))
                    .filter((id) => id !== "user")
                    .map((id) => (
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
                  {currentRound >= 5 ? "Finish →" : "다음 라운드 →"}
                </button>
              </div>
            ) : null}

            {phase === "ended" && winner ? (
              <div
                className={`fixed inset-0 z-40 flex items-center justify-center p-4 ${
                  winner === "humans" ? "bg-emerald-950/95" : "bg-red-950/95"
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
                      winner === "humans" ? "text-emerald-300" : "text-red-300"
                    }`}
                  >
                    {winner === "humans" ? "Humans win" : "Zombies win"}
                  </h2>
                  <p className="mt-2 text-center text-sm text-zinc-400">
                    Full reveal — roles at end, original zombie, and infection notes.
                  </p>

                  <div className="mt-8">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                      Original zombie
                    </h3>
                    <p className="mt-2 text-lg font-bold text-white">
                      {zombieId === "user"
                        ? "You"
                        : AI_PLAYERS.find((a) => a.provider === zombieId)?.name ??
                          zombieId}
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
                      Infection timeline (hints)
                    </h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-zinc-400">
                      {latentInfectionEvents.length === 0 ? (
                        <li>No latent waves recorded.</li>
                      ) : (
                        latentInfectionEvents.map((e, i) => (
                          <li key={`${e.round}-${i}-${e.zombieName}`}>
                            {language === "Korean"
                              ? `Round ${e.round}: ${e.zombieName}이 ${e.infectedTeamMembers.join(", ")} 팀에 잠입하여 다음 라운드에 감염시켰습니다`
                              : `Round ${e.round}: ${e.zombieName} infiltrated ${e.infectedTeamMembers.join(", ")} — infection spreads next round.`}
                          </li>
                        ))
                      )}
                    </ul>
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
