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
  { provider: "openai", name: "ChatGPT", color: "#10A37F" },
  { provider: "anthropic", name: "Claude", color: "#D97757" },
  { provider: "google", name: "Gemini", color: "#4285F4" },
  { provider: "xai", name: "Grok", color: "#1A1A1A" },
  { provider: "deepseek", name: "DeepSeek", color: "#4D6BFE" },
  { provider: "mistral", name: "Mistral", color: "#FF7000" },
] as const;

const LANGUAGE_OPTIONS = [
  "English",
  "Korean",
  "Japanese",
  "Spanish",
  "French",
  "German",
  "Chinese",
  "Portuguese",
  "Italian",
  "Arabic",
];

type Phase =
  | "setup"
  | "starting"
  | "declaring"
  | "user_declare"
  | "attacking"
  | "user_attack"
  | "voting"
  | "user_vote"
  | "paused_after_declarations"
  | "paused_after_attacks"
  | "paused_after_votes"
  | "eliminating"
  | "ended";

type VoteEliminationStage = "first" | "revote";

type Player = {
  provider: string;
  name: string;
  color: string;
  isAlive: boolean;
  isWolf?: boolean;
  isUser?: boolean;
};

type GameMessage = {
  provider: string;
  name: string;
  text: string;
  round: number;
  type: "declaration" | "attack" | "system" | "statement";
};

type VoteRecord = {
  voter: string;
  voterName: string;
  target: string;
  reason: string;
};

const BG =
  "min-h-screen bg-gray-950 text-zinc-100 selection:bg-amber-500/30";

const MESSAGE_STAGGER_MS = 400;

/** All declaration & attack turns from entire game — no truncation, no system/user-only lines. */
function fullConversationPayload(msgs: GameMessage[]) {
  return msgs
    .filter(
      (m): m is GameMessage & { type: "declaration" | "attack" } =>
        m.type === "declaration" || m.type === "attack"
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

/** Alive providers for wolf API: AI ids plus `user` when human is in the game (challenge). */
function alivePlayersForWolfApi(
  playersSnap: Player[],
  mode: "god" | "blind" | "challenge"
) {
  const ai = aliveAiProviderIds(playersSnap);
  if (
    mode === "challenge" &&
    playersSnap.some((p) => p.provider === "user" && p.isAlive)
  ) {
    return [...ai, "user"];
  }
  return ai;
}

function randomPick<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

async function readWolfSse(res: Response, onEvent: (e: Record<string, unknown>) => void) {
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
      const line = block
        .split("\n")
        .find((l) => l.startsWith("data:"));
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

export default function WolfModePage() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [userMode, setUserMode] = useState<"god" | "blind" | "challenge">("blind");
  const [wolfCount, setWolfCount] = useState<1 | 2>(1);
  const [language, setLanguage] = useState("English");
  const [players, setPlayers] = useState<Player[]>([]);
  const [wolfIds, setWolfIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<GameMessage[]>([]);
  const [currentRound, setCurrentRound] = useState(1);
  const [votes, setVotes] = useState<VoteRecord[]>([]);
  const [lastEliminated, setLastEliminated] = useState<{
    provider: string;
    name: string;
    wasWolf: boolean;
  } | null>(null);
  const [revealShown, setRevealShown] = useState(false);
  const [winner, setWinner] = useState<"citizens" | "wolves" | null>(null);
  const [, setAnnouncement] = useState("");
  const [userInput, setUserInput] = useState("");
  const [userTimer, setUserTimer] = useState(45);
  const [streamingProvider, setStreamingProvider] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [challengeVoteTarget, setChallengeVoteTarget] = useState<string | null>(null);
  const [voteSubmitDone, setVoteSubmitDone] = useState(false);
  const [voteEliminationStage, setVoteEliminationStage] =
    useState<VoteEliminationStage>("first");
  const [revoteCandidates, setRevoteCandidates] = useState<string[]>([]);
  const [isUserEliminated, setIsUserEliminated] = useState(false);
  const [userEliminatedRound, setUserEliminatedRound] = useState<number | null>(
    null
  );
  const [challengeRoleToast, setChallengeRoleToast] = useState<
    "wolf" | "citizen" | null
  >(null);

  const feedRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesRef = useRef<GameMessage[]>([]);
  const currentRoundRef = useRef(1);
  const playersRef = useRef<Player[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    currentRoundRef.current = currentRound;
  }, [currentRound]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages, votes, phase]);

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

  const stopUserTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const turnExpireGuard = useRef(false);

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

  const resetGame = useCallback(() => {
    stopUserTimer();
    messagesRef.current = [];
    playersRef.current = [];
    currentRoundRef.current = 1;
    setPhase("setup");
    setPlayers([]);
    setWolfIds([]);
    setMessages([]);
    setCurrentRound(1);
    setVotes([]);
    setLastEliminated(null);
    setRevealShown(false);
    setWinner(null);
    setAnnouncement("");
    setUserInput("");
    setStreamingProvider(null);
    setGameId(null);
    setChallengeVoteTarget(null);
    setVoteSubmitDone(false);
    setVoteEliminationStage("first");
    setRevoteCandidates([]);
    setIsUserEliminated(false);
    setUserEliminatedRound(null);
    setChallengeRoleToast(null);
  }, [stopUserTimer]);

  const runDeclarations = useCallback(
    async (
      _statementOverride?: string,
      sessionIdOverride?: string,
      wolfIdsOverride?: string[]
    ) => {
      const sessionId = sessionIdOverride ?? gameId;
      if (!sessionId) {
        console.warn("runDeclarations: missing sessionId (state not ready yet?)");
        return;
      }
      const wolfIdsForBody = wolfIdsOverride ?? wolfIds;
      const payload: Record<string, unknown> = {
        action: "declarations",
        sessionId,
        wolfIds: wolfIdsForBody,
        alivePlayers: alivePlayersForWolfApi(playersRef.current, userMode),
        conversation: fullConversationPayload(messagesRef.current),
        wolfCount,
        userMode,
        language,
        round: 1,
      };
      const res = await fetch("/api/mindgame/wolf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        addMessage({
          provider: "system",
          name: "System",
          text: "Declarations request failed.",
          round: 1,
          type: "system",
        });
        setPhase("setup");
        return;
      }
      let aiStagger = 0;
      await readWolfSse(res, (ev) => {
        const t = ev.type;
        if (t === "statement") {
          const prov = String(ev.provider ?? "");
          const delay = aiStagger++ * MESSAGE_STAGGER_MS;
          const roundNum = Number(ev.round) || 1;
          const isAttack = ev.statementType === "attack";
          setTimeout(() => {
            setStreamingProvider(prov);
            addMessage({
              provider: prov,
              name: String(ev.name ?? prov),
              text: String(ev.text ?? ""),
              round: roundNum,
              type: isAttack ? "attack" : "declaration",
            });
            setTimeout(() => setStreamingProvider(null), 50);
          }, delay);
        }
        if (t === "phase_complete" && ev.phase === "declarations") {
          setStreamingProvider(null);
          if (userMode !== "challenge") {
            const delay = Math.max(0, aiStagger * MESSAGE_STAGGER_MS + 50);
            setTimeout(() => setPhase("paused_after_declarations"), delay);
          }
        }
        if (t === "error") {
          addMessage({
            provider: "system",
            name: "System",
            text: String(ev.error ?? "Error"),
            round: 1,
            type: "system",
          });
        }
      });
      await new Promise((r) =>
        setTimeout(r, Math.max(0, aiStagger) * MESSAGE_STAGGER_MS + 80)
      );
      if (userMode === "challenge") {
        setPhase("user_declare");
        setUserInput("");
        startUserTimer();
      } else if (aiStagger > 0) {
        await new Promise((r) =>
          setTimeout(r, aiStagger * MESSAGE_STAGGER_MS + 50)
        );
      }
    },
    [
      gameId,
      wolfIds,
      wolfCount,
      userMode,
      language,
      addMessage,
      startUserTimer,
    ]
  );

  const runAttackApi = useCallback(
    async (
      round: number,
      _msgs: GameMessage[],
      _stmtOverride?: string,
      options?: { skipUserInputPhase?: boolean }
    ) => {
      if (!gameId) return;
      const skipUserInputPhase = options?.skipUserInputPhase === true;
      const payload: Record<string, unknown> = {
        action: "attacks",
        sessionId: gameId,
        wolfIds,
        alivePlayers: alivePlayersForWolfApi(playersRef.current, userMode),
        conversation: fullConversationPayload(messagesRef.current),
        wolfCount,
        userMode,
        language,
        round,
      };
      const res = await fetch("/api/mindgame/wolf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        addMessage({
          provider: "system",
          name: "System",
          text: "Attacks request failed.",
          round,
          type: "system",
        });
        return;
      }
      let aiStagger = 0;
      await readWolfSse(res, (ev) => {
        if (ev.type === "statement") {
          const prov = String(ev.provider ?? "");
          const delay = aiStagger++ * MESSAGE_STAGGER_MS;
          const rNum = Number(ev.round) || round;
          setTimeout(() => {
            setStreamingProvider(prov);
            addMessage({
              provider: prov,
              name: String(ev.name ?? prov),
              text: String(ev.text ?? ""),
              round: rNum,
              type: "attack",
            });
            setStreamingProvider(null);
          }, delay);
        }
        if (ev.type === "phase_complete" && ev.phase === "attacks") {
          setStreamingProvider(null);
          if (userMode !== "challenge") {
            const delay = Math.max(0, aiStagger * MESSAGE_STAGGER_MS + 50);
            setTimeout(() => setPhase("paused_after_attacks"), delay);
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
      await new Promise((r) =>
        setTimeout(r, Math.max(0, aiStagger) * MESSAGE_STAGGER_MS + 80)
      );
      if (userMode === "challenge") {
        if (skipUserInputPhase) {
          setPhase("paused_after_attacks");
        } else {
          setPhase("user_attack");
          setUserInput("");
          startUserTimer();
        }
      } else if (aiStagger > 0) {
        await new Promise((r) =>
          setTimeout(r, aiStagger * MESSAGE_STAGGER_MS + 50)
        );
      }
    },
    [
      gameId,
      wolfIds,
      wolfCount,
      userMode,
      language,
      addMessage,
      startUserTimer,
    ]
  );

  const runVotingApi = useCallback(
    async (
      round: number,
      _msgs: GameMessage[],
      voteOverride?: string | null,
      opts?: {
        tiebreaker?: boolean;
        tiebreakerCandidateIds?: string[];
      }
    ) => {
      if (!gameId) return;
      const uv =
        voteOverride ??
        (userMode === "challenge" && challengeVoteTarget
          ? challengeVoteTarget
          : "");
      const payload: Record<string, unknown> = {
        action: "votes",
        sessionId: gameId,
        wolfIds,
        alivePlayers: alivePlayersForWolfApi(playersRef.current, userMode),
        conversation: fullConversationPayload(messagesRef.current),
        wolfCount,
        userMode,
        language,
        round,
      };
      if (opts?.tiebreaker && opts.tiebreakerCandidateIds?.length) {
        payload.tiebreaker = true;
        payload.tiebreakerCandidateIds = opts.tiebreakerCandidateIds;
      }
      if (userMode === "challenge" && uv && !isUserEliminated) {
        payload.userVote = uv;
      }
      const res = await fetch("/api/mindgame/wolf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        addMessage({
          provider: "system",
          name: "System",
          text: "Voting request failed.",
          round,
          type: "system",
        });
        return;
      }
      await readWolfSse(res, (ev) => {
        if (ev.type === "votes_complete") {
          const raw = ev.votes as VoteRecord[] | undefined;
          const list = Array.isArray(raw) ? raw : [];
          setVotes(list);
          setPhase("paused_after_votes");
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
    [
      gameId,
      wolfIds,
      wolfCount,
      userMode,
      language,
      challengeVoteTarget,
      addMessage,
      isUserEliminated,
    ]
  );

  const runElimination = useCallback(
    (voteList: VoteRecord[]) => {
      const tally: Record<string, number> = {};
      voteList.forEach((v) => {
        tally[v.target] = (tally[v.target] || 0) + 1;
      });
      const maxVotes = Math.max(0, ...Object.values(tally));
      if (maxVotes === 0) {
        setPhase("ended");
        return;
      }
      const topCandidates = Object.keys(tally).filter(
        (k) => tally[k] === maxVotes
      );

      if (topCandidates.length > 1 && voteEliminationStage === "first") {
        setVoteEliminationStage("revote");
        setRevoteCandidates(topCandidates);
        const names = topCandidates
          .map(
            (id) =>
              playerByProvider.get(id)?.name ??
              AI_PLAYERS.find((a) => a.provider === id)?.name ??
              id
          )
          .join(" vs ");
        addMessage({
          provider: "system",
          name: "System",
          text: `⚖️ TIE VOTE — ${names}\nFinal vote begins now.`,
          round: currentRoundRef.current,
          type: "system",
        });
        if (userMode === "challenge" && !isUserEliminated) {
          setVoteSubmitDone(false);
          setChallengeVoteTarget(null);
          setPhase("user_vote");
          return;
        }
        if (userMode === "challenge" && isUserEliminated) {
          setPhase("voting");
          queueMicrotask(() => {
            void runVotingApi(
              currentRoundRef.current,
              [],
              undefined,
              {
                tiebreaker: true,
                tiebreakerCandidateIds: topCandidates,
              }
            );
          });
          return;
        }
        setPhase("voting");
        queueMicrotask(() => {
          void runVotingApi(
            currentRoundRef.current,
            [],
            undefined,
            {
              tiebreaker: true,
              tiebreakerCandidateIds: topCandidates,
            }
          );
        });
        return;
      }

      if (topCandidates.length > 1 && voteEliminationStage === "revote") {
        const eliminatedProvider = randomPick(topCandidates);
        if (!eliminatedProvider) {
          setPhase("ended");
          return;
        }
        const pl = playerByProvider.get(eliminatedProvider);
        const name =
          pl?.name ??
          AI_PLAYERS.find((a) => a.provider === eliminatedProvider)?.name ??
          eliminatedProvider;
        const wasWolf = wolfIds.includes(eliminatedProvider);
        const roundAtElim = currentRoundRef.current;
        if (eliminatedProvider === "user" && userMode === "challenge") {
          setIsUserEliminated(true);
          setUserEliminatedRound(roundAtElim);
          addMessage({
            provider: "system",
            name: "System",
            text: "You have been eliminated. Watch the remaining players continue the game.",
            round: roundAtElim,
            type: "system",
          });
        }

        setPlayers((prev) => {
          const next = prev.map((p) =>
            p.provider === eliminatedProvider
              ? {
                  ...p,
                  isAlive: false,
                  isWolf: wolfIds.includes(eliminatedProvider),
                }
              : p
          );
          playersRef.current = next;
          return next;
        });

        setLastEliminated({
          provider: eliminatedProvider,
          name,
          wasWolf,
        });
        setRevealShown(false);
        setPhase("eliminating");
        setVoteEliminationStage("first");
        setRevoteCandidates([]);
        window.setTimeout(() => setRevealShown(true), 1500);
        return;
      }

      const eliminatedProvider = topCandidates[0];
      if (!eliminatedProvider) {
        setPhase("ended");
        return;
      }
      const pl = playerByProvider.get(eliminatedProvider);
      const name =
        pl?.name ??
        AI_PLAYERS.find((a) => a.provider === eliminatedProvider)?.name ??
        eliminatedProvider;
      const wasWolf = wolfIds.includes(eliminatedProvider);
      const roundAtElimSingle = currentRoundRef.current;
      if (eliminatedProvider === "user" && userMode === "challenge") {
        setIsUserEliminated(true);
        setUserEliminatedRound(roundAtElimSingle);
        addMessage({
          provider: "system",
          name: "System",
          text: "You have been eliminated. Watch the remaining players continue the game.",
          round: roundAtElimSingle,
          type: "system",
        });
      }

      setPlayers((prev) => {
        const next = prev.map((p) =>
          p.provider === eliminatedProvider
            ? {
                ...p,
                isAlive: false,
                isWolf: wolfIds.includes(eliminatedProvider),
              }
            : p
        );
        playersRef.current = next;
        return next;
      });

      setLastEliminated({
        provider: eliminatedProvider,
        name,
        wasWolf,
      });
      setRevealShown(false);
      setPhase("eliminating");
      setVoteEliminationStage("first");
      setRevoteCandidates([]);
      window.setTimeout(() => setRevealShown(true), 1500);
    },
    [
      wolfIds,
      addMessage,
      userMode,
      playerByProvider,
      runVotingApi,
      voteEliminationStage,
    ]
  );

  const runAttackRoundRef = useRef<(() => Promise<void>) | undefined>(
    undefined
  );
  const runVotingRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const runEliminationRef = useRef<
    ((v: VoteRecord[]) => void) | undefined
  >(undefined);
  const runAttackRoundAfterEliminationRef = useRef<
    (() => Promise<void>) | undefined
  >(undefined);

  const runAttackRound = useCallback(async () => {
    const prevRound = currentRoundRef.current;
    const nextRound = prevRound + 1;
    currentRoundRef.current = nextRound;
    setCurrentRound(nextRound);
    const sysMsg: GameMessage = {
      provider: "system",
      name: "System",
      text: `Round ${nextRound} — Accusations fly.`,
      round: nextRound,
      type: "system",
    };
    addMessage(sysMsg);

    if (userMode === "challenge") {
      setUserInput("");
      setPhase("attacking");
      await runAttackApi(nextRound, [...messagesRef.current], undefined, {
        skipUserInputPhase: isUserEliminated,
      });
      return;
    }

    setPhase("attacking");
    await runAttackApi(nextRound, [...messagesRef.current]);
  }, [addMessage, userMode, runAttackApi, isUserEliminated]);

  const runVoting = useCallback(async () => {
    const round = currentRoundRef.current;
    setVoteEliminationStage("first");
    setRevoteCandidates([]);
    const sys: GameMessage = {
      provider: "system",
      name: "System",
      text: "The vote begins…",
      round,
      type: "system",
    };
    addMessage(sys);
    setVotes([]);
    if (userMode === "challenge" && !isUserEliminated) {
      setVoteSubmitDone(false);
      setChallengeVoteTarget(null);
      setPhase("user_vote");
      return;
    }
    if (userMode === "challenge" && isUserEliminated) {
      setPhase("voting");
      queueMicrotask(() => {
        void runVotingApi(round, [...messagesRef.current]);
      });
      return;
    }
    setPhase("voting");
    queueMicrotask(() => {
      void runVotingApi(round, [...messagesRef.current]);
    });
  }, [addMessage, userMode, runVotingApi, isUserEliminated]);

  runAttackRoundRef.current = runAttackRound;
  runEliminationRef.current = runElimination;

  runVotingRef.current = runVoting;

  runAttackRoundAfterEliminationRef.current = async () => {
    setRevealShown(false);
    setLastEliminated(null);
    const prevRound = currentRoundRef.current;
    const nextRound = prevRound + 1;
    currentRoundRef.current = nextRound;
    setCurrentRound(nextRound);
    const sysMsg: GameMessage = {
      provider: "system",
      name: "System",
      text: `Round ${nextRound} — Accusations fly.`,
      round: nextRound,
      type: "system",
    };
    addMessage(sysMsg);
    if (userMode === "challenge") {
      setUserInput("");
      setPhase("attacking");
      await runAttackApi(nextRound, [...messagesRef.current], undefined, {
        skipUserInputPhase: isUserEliminated,
      });
      return;
    }
    setPhase("attacking");
    await runAttackApi(nextRound, [...messagesRef.current], undefined);
  };

  const startGame = useCallback(async () => {
    setPhase("starting");
    setMessages([]);
    setVotes([]);
    setWinner(null);
    setGameId(null);
    setAnnouncement("");
    setChallengeVoteTarget(null);
    setVoteSubmitDone(false);
    setVoteEliminationStage("first");
    setRevoteCandidates([]);
    setIsUserEliminated(false);
    setUserEliminatedRound(null);

    const basePlayers: Player[] = AI_PLAYERS.map((p) => ({
      provider: p.provider,
      name: p.name,
      color: p.color,
      isAlive: true,
      isWolf: false,
    }));
    if (userMode === "challenge") {
      basePlayers.push({
        provider: "user",
        name: "You",
        color: "#f4f4f5",
        isAlive: true,
        isUser: true,
      });
    }
    playersRef.current = basePlayers;
    setPlayers(basePlayers);

    currentRoundRef.current = 1;
    setCurrentRound(1);
    messagesRef.current = [];

    try {
      const res = await fetch("/api/mindgame/wolf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          wolfIds: [],
          alivePlayers: AI_PLAYERS.map((p) => p.provider),
          conversation: [],
          wolfCount,
          userMode,
          language,
          round: 1,
        }),
      });
      if (!res.ok) {
        setPhase("setup");
        return;
      }
      let sid = "";
      let wids: string[] = [];
      let ann = "";
      await readWolfSse(res, (ev) => {
        if (ev.type === "start") {
          sid = String(ev.sessionId ?? "");
          wids = Array.isArray(ev.wolfIds)
            ? (ev.wolfIds as string[])
            : [];
          ann = String(ev.announcement ?? "");
        }
      });
      setGameId(sid);
      setWolfIds(wids);
      setAnnouncement(ann);

      setPlayers((prev) => {
        const next = prev.map((p) => ({
          ...p,
          isWolf:
            userMode === "god" || userMode === "challenge"
              ? wids.includes(p.provider)
              : p.isWolf,
        }));
        playersRef.current = next;
        return next;
      });

      if (userMode === "challenge") {
        setChallengeRoleToast(wids.includes("user") ? "wolf" : "citizen");
        window.setTimeout(() => setChallengeRoleToast(null), 5000);
      }

      addMessage({
        provider: "system",
        name: "Narrator",
        text: ann || "The village holds its breath.",
        round: 1,
        type: "system",
      });

      addMessage({
        provider: "system",
        name: "System",
        text: "Round 1 — Each player declares their innocence.",
        round: 1,
        type: "system",
      });

      if (userMode === "challenge") {
        setUserInput("");
        setPhase("declaring");
        await runDeclarations(undefined, sid, wids);
        return;
      }

      setPhase("declaring");
      // Pass sid/wids — React has not committed setGameId yet; gameId in closure is still null.
      await runDeclarations(undefined, sid, wids);
    } catch {
      setPhase("setup");
    }
  }, [
    wolfCount,
    userMode,
    language,
    addMessage,
    runDeclarations,
    startUserTimer,
  ]);

  const submitUserDeclare = useCallback(() => {
    turnExpireGuard.current = true;
    stopUserTimer();
    const t = userInput.trim().slice(0, 300) || "I have nothing to say.";
    setUserInput("");
    addMessage({
      provider: "user",
      name: "You",
      text: t,
      round: 1,
      type: "declaration",
    });
    setPhase("paused_after_declarations");
  }, [userInput, stopUserTimer, addMessage]);

  const submitUserAttack = useCallback(() => {
    turnExpireGuard.current = true;
    stopUserTimer();
    const t = userInput.trim().slice(0, 300) || "I have nothing to say.";
    setUserInput("");
    const r = currentRoundRef.current;
    addMessage({
      provider: "user",
      name: "You",
      text: t,
      round: r,
      type: "attack",
    });
    setPhase("paused_after_attacks");
  }, [userInput, stopUserTimer, addMessage]);

  useEffect(() => {
    if (userTimer !== 0) return;
    if (phase !== "user_declare" && phase !== "user_attack") return;
    if (turnExpireGuard.current) return;
    turnExpireGuard.current = true;
    stopUserTimer();
    const t = userInput.trim().slice(0, 300) || "I have nothing to say.";
    if (phase === "user_declare") {
      setUserInput("");
      addMessage({
        provider: "user",
        name: "You",
        text: t,
        round: 1,
        type: "declaration",
      });
      setPhase("paused_after_declarations");
    }
    if (phase === "user_attack") {
      setUserInput("");
      const r = currentRoundRef.current;
      addMessage({
        provider: "user",
        name: "You",
        text: t,
        round: r,
        type: "attack",
      });
      setPhase("paused_after_attacks");
    }
  }, [userTimer, phase, userInput, stopUserTimer, addMessage]);

  const submitChallengeVote = useCallback(() => {
    if (!challengeVoteTarget) return;
    setVoteSubmitDone(true);
    setPhase("voting");
    const r = currentRoundRef.current;
    const revote = revoteCandidates.length > 0;
    const sys: GameMessage = {
      provider: "system",
      name: "System",
      text: revote
        ? "Final tiebreaker vote…"
        : "The vote begins…",
      round: r,
      type: "system",
    };
    const merged = [...messagesRef.current, sys];
    messagesRef.current = merged;
    setMessages(merged);
    const opts =
      revote && revoteCandidates.length > 0
        ? { tiebreaker: true, tiebreakerCandidateIds: revoteCandidates }
        : undefined;
    void runVotingApi(r, merged, challengeVoteTarget, opts);
  }, [challengeVoteTarget, revoteCandidates, runVotingApi]);

  const phaseLabel = useMemo(() => {
    if (phase === "setup" || phase === "starting") return "—";
    if (
      phase === "declaring" ||
      phase === "user_declare" ||
      phase === "paused_after_declarations"
    )
      return "DECLARATION";
    if (
      phase === "attacking" ||
      phase === "user_attack" ||
      phase === "paused_after_attacks"
    )
      return "DEBATE";
    if (
      phase === "voting" ||
      phase === "user_vote" ||
      phase === "paused_after_votes"
    )
      return "VOTING";
    if (phase === "eliminating") return "ELIMINATION";
    if (phase === "ended") return "COMPLETE";
    return "—";
  }, [phase]);

  const tallyByTarget = useMemo(() => {
    const m: Record<string, number> = {};
    for (const v of votes) {
      m[v.target] = (m[v.target] ?? 0) + 1;
    }
    return m;
  }, [votes]);

  const voteTallyRows = useMemo(() => {
    const entries = Object.entries(tallyByTarget);
    const maxC =
      entries.length === 0
        ? 0
        : Math.max(...entries.map(([, c]) => c));
    return entries
      .map(([target, count]) => ({
        target,
        count,
        displayName:
          playerByProvider.get(target)?.name ??
          AI_PLAYERS.find((a) => a.provider === target)?.name ??
          target,
        isLeader: count === maxC && maxC > 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [tallyByTarget, playerByProvider]);

  const continueAfterDeclarations = useCallback(() => {
    void runAttackRoundRef.current?.();
  }, []);

  const continueAfterAttacks = useCallback(() => {
    void runVotingRef.current?.();
  }, []);

  const continueAfterVotes = useCallback(() => {
    void runEliminationRef.current?.(votes);
  }, [votes]);

  const continueAfterElimination = useCallback(() => {
    if (!lastEliminated) return;
    const snapshot = playersRef.current;
    const remainingWolves = wolfIds.filter(
      (id) => snapshot.find((p) => p.provider === id)?.isAlive
    );
    const aliveCount = snapshot.filter((p) => p.isAlive).length;
    const aliveWolfCount = remainingWolves.length;
    const aliveCitizens = aliveCount - aliveWolfCount;

    if (lastEliminated.wasWolf) {
      if (aliveWolfCount === 0) {
        setWinner("citizens");
        setPhase("ended");
        return;
      }
      setLastEliminated(null);
      setRevealShown(false);
      addMessage({
        provider: "system",
        name: "System",
        text: "🐺 A wolf has been found! But the hunt is not over...",
        round: currentRoundRef.current,
        type: "system",
      });
      if (aliveWolfCount >= aliveCitizens) {
        setWinner("wolves");
        setPhase("ended");
        return;
      }
      window.setTimeout(() => {
        void runAttackRoundAfterEliminationRef.current?.();
      }, 3000);
      return;
    }

    if (aliveCount <= 2 || aliveWolfCount >= aliveCitizens) {
      setWinner("wolves");
      setPhase("ended");
      return;
    }
    setLastEliminated(null);
    setRevealShown(false);
    window.setTimeout(() => {
      void runAttackRoundAfterEliminationRef.current?.();
    }, 3000);
  }, [lastEliminated, wolfIds, addMessage]);

  const eliminatingContinueLabel = useMemo(() => {
    if (!lastEliminated || !revealShown) return "";
    const remainingWolves = wolfIds.filter(
      (id) => players.find((p) => p.provider === id)?.isAlive
    );
    const aliveCount = players.filter((p) => p.isAlive).length;
    const aliveWolfCount = remainingWolves.length;
    const aliveCitizens = aliveCount - aliveWolfCount;
    if (lastEliminated.wasWolf) {
      if (aliveWolfCount === 0) return "See result →";
      if (aliveWolfCount >= aliveCitizens) return "See result →";
      return "Next round →";
    }
    if (aliveCount <= 2 || aliveWolfCount >= aliveCitizens) return "See result →";
    return "Next round →";
  }, [lastEliminated, revealShown, players, wolfIds]);

  const wolfDeceptionHighlights = useMemo(() => {
    const wolfMsgs = messages.filter(
      (m) =>
        wolfIds.includes(m.provider) &&
        (m.type === "declaration" || m.type === "attack")
    );
    if (!wolfMsgs.length) return [];
    const sorted = [...wolfMsgs].sort((a, b) => {
      if (a.round !== b.round) return a.round - b.round;
      return messages.indexOf(a) - messages.indexOf(b);
    });
    const n = sorted.length;
    const ix =
      n === 1
        ? [0]
        : n === 2
          ? [0, 1]
          : [0, Math.floor(n / 2), n - 1];
    const out: GameMessage[] = [];
    for (const i of ix) {
      const m = sorted[i];
      if (m && !out.some((q) => q === m)) out.push(m);
    }
    return out.slice(0, 3);
  }, [messages, wolfIds]);

  const wolfDeceptionTitleName = useMemo(() => {
    if (wolfIds.length === 1) {
      if (wolfIds[0] === "user") return "You";
      return AI_PLAYERS.find((a) => a.provider === wolfIds[0])?.name ?? "The wolf";
    }
    return "The wolves";
  }, [wolfIds]);

  return (
    <main className={BG}>
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-8 sm:px-6 lg:py-12">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Link
              href="/"
              className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </Link>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-zinc-500">
                Mindgame
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                WOLF
              </h1>
            </div>
          </div>
        </header>

        {phase === "setup" || phase === "starting" ? (
          <section className="flex flex-1 flex-col items-center justify-center py-8">
            <h2 className="text-center text-5xl font-black tracking-tight text-white sm:text-6xl">
              🐺 WOLF
            </h2>
            <p className="mt-3 text-center text-sm text-zinc-500">
              One among us is the Wolf.
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
                        ? "bg-amber-500/90 text-gray-950"
                        : "bg-white/5 text-zinc-400 hover:bg-white/10"
                    }`}
                  >
                    {lang}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">
                All AI responses will be in this language
              </p>
            </div>

            <div className="mt-10 grid w-full max-w-3xl grid-cols-1 gap-4 md:grid-cols-3">
              {(
                [
                  {
                    id: "god" as const,
                    icon: "👁️",
                    title: "GOD MODE",
                    desc: "You know who the wolf is from the start. Watch them lie in real time.",
                    active: "ring-2 ring-amber-400/90 border-amber-500/40",
                  },
                  {
                    id: "blind" as const,
                    icon: "?",
                    title: "BLIND MODE",
                    desc: "You know nothing. Deduce through debate and accusation.",
                    active: "ring-2 ring-sky-500/90 border-sky-500/40",
                  },
                  {
                    id: "challenge" as const,
                    icon: "⚔️",
                    title: "CHALLENGE MODE",
                    desc: "You are a player. You speak, vote, and can be eliminated. You might be the wolf.",
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
                  <h3 className="mt-3 text-sm font-bold text-white">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                    {card.desc}
                  </p>
                </button>
              ))}
            </div>

            {userMode === "challenge" ? (
              <div className="mt-8 flex flex-col items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  How many wolves?
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setWolfCount(1)}
                    className={`rounded-full px-5 py-2 text-sm font-semibold ${
                      wolfCount === 1
                        ? "bg-rose-600 text-white"
                        : "bg-white/5 text-zinc-400"
                    }`}
                  >
                    1 Wolf
                  </button>
                  <button
                    type="button"
                    onClick={() => setWolfCount(2)}
                    className={`rounded-full px-5 py-2 text-sm font-semibold ${
                      wolfCount === 2
                        ? "bg-rose-600 text-white"
                        : "bg-white/5 text-zinc-400"
                    }`}
                  >
                    2 Wolves
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-10 flex flex-wrap items-end justify-center gap-6">
              {AI_PLAYERS.map((p) => (
                <div
                  key={p.provider}
                  className="flex flex-col items-center gap-2"
                >
                  <div
                    className="h-12 w-12 rounded-full shadow-lg ring-2 ring-white/10"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="text-[11px] font-medium text-zinc-400">
                    {p.name}
                  </span>
                </div>
              ))}
              {userMode === "challenge" ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/50 bg-zinc-800 text-sm font-bold text-white">
                    YOU
                  </div>
                  <span className="text-[11px] font-medium text-zinc-300">
                    You
                  </span>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              disabled={phase === "starting"}
              onClick={() => void startGame()}
              className="mt-12 rounded-full bg-gradient-to-r from-amber-500 to-orange-600 px-12 py-4 text-sm font-bold uppercase tracking-widest text-gray-950 shadow-lg shadow-amber-500/20 disabled:opacity-50"
            >
              {phase === "starting" ? "Starting…" : "Start game"}
            </button>
          </section>
        ) : (
          <div className="relative flex flex-1 flex-col gap-6">
            {challengeRoleToast ? (
              <div className="pointer-events-none fixed left-1/2 top-24 z-50 w-[min(90vw,380px)] -translate-x-1/2">
                <div
                  className={`rounded-2xl border-2 px-6 py-5 text-center shadow-2xl backdrop-blur-sm ${
                    challengeRoleToast === "wolf"
                      ? "border-red-600 bg-red-950/95 text-red-100"
                      : "border-sky-500 bg-sky-950/95 text-sky-100"
                  }`}
                >
                  <p className="text-lg font-black leading-snug">
                    {challengeRoleToast === "wolf"
                      ? "🐺 You are the WOLF. Deceive everyone and survive."
                      : "😇 You are a CITIZEN. Find the wolf."}
                  </p>
                </div>
              </div>
            ) : null}
            {userMode === "challenge" && isUserEliminated ? (
              <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-center text-sm text-amber-100/95">
                You are out — spectating. The AIs continue until the game ends.
              </div>
            ) : null}
            <div className="text-center">
              <p className="text-2xl font-black text-white sm:text-3xl">
                ROUND {currentRound}
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.3em] text-amber-500/90">
                {phaseLabel}
              </p>
            </div>

            <div className="flex flex-wrap items-stretch justify-center gap-3 sm:gap-4">
              {players.map((p) => {
                const initial = p.name.slice(0, 1).toUpperCase();
                const speaking = streamingProvider === p.provider;
                const isGodWolf =
                  userMode === "god" && wolfIds.includes(p.provider);
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
                        speaking ? "animate-pulse" : ""
                      } ${
                        isGodWolf
                          ? "ring-2 ring-red-900/90 shadow-[0_0_14px_rgba(127,29,29,0.55)]"
                          : speaking
                            ? "ring-4 ring-amber-400/80"
                            : "ring-2 ring-white/10"
                      }`}
                      style={{ backgroundColor: p.color }}
                    >
                      {isGodWolf ? (
                        <span
                          className="pointer-events-none absolute -right-0.5 -top-0.5 z-10 text-[11px] drop-shadow-md"
                          title="Wolf"
                        >
                          🐺
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
                      {p.isAlive ? "Alive" : "Eliminated"}
                    </span>
                  </div>
                );
              })}
            </div>

            <div
              ref={feedRef}
              className="max-h-[min(48vh,420px)] flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-black/30 p-4 scrollbar-thin"
            >
              {messages.map((m, i) => {
                if (m.type === "system") {
                  return (
                    <p
                      key={`${i}-${m.round}-${m.text.slice(0, 12)}`}
                      className="mx-auto mb-4 max-w-xl text-center text-sm italic text-zinc-500"
                    >
                      {m.text}
                    </p>
                  );
                }
                const col =
                  AI_PLAYERS.find((a) => a.provider === m.provider)
                    ?.color ?? (m.provider === "user" ? "#f4f4f5" : "#71717a");
                return (
                  <div
                    key={`${i}-${m.provider}`}
                    className="mb-4 flex gap-3"
                  >
                    <div
                      className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: col }}
                    />
                    <div
                      className="max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed text-zinc-100"
                      style={{
                        backgroundColor: `${col}14`,
                      }}
                    >
                      <div className="mb-1 flex flex-wrap items-baseline gap-2">
                        <span className="font-bold text-white">{m.name}</span>
                        <span className="rounded bg-black/30 px-1.5 text-[10px] text-zinc-400">
                          R{m.round} · {m.type}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap">{m.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {phase === "paused_after_declarations" ? (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  onClick={continueAfterDeclarations}
                  className="rounded-full border border-amber-500/60 bg-amber-500/10 px-8 py-3 text-sm font-bold uppercase tracking-wider text-amber-200 transition hover:bg-amber-500/20"
                >
                  Round 2 begins →
                </button>
              </div>
            ) : null}

            {phase === "paused_after_attacks" ? (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  onClick={continueAfterAttacks}
                  className="rounded-full border border-sky-500/60 bg-sky-500/10 px-8 py-3 text-sm font-bold uppercase tracking-wider text-sky-200 transition hover:bg-sky-500/20"
                >
                  Cast votes →
                </button>
              </div>
            ) : null}

            {(phase === "user_declare" || phase === "user_attack") &&
            userMode === "challenge" &&
            !isUserEliminated ? (
              <div className="rounded-2xl border border-amber-500/40 bg-amber-950/20 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-amber-200">
                    Your turn
                  </h3>
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
                  onChange={(e) =>
                    setUserInput(e.target.value.slice(0, 300))
                  }
                  placeholder="State your case..."
                  className="mt-3 min-h-[100px] w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-zinc-600"
                  maxLength={300}
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-zinc-500">
                    {userInput.length}/300
                  </span>
                  <button
                    type="button"
                    onClick={
                      phase === "user_declare"
                        ? submitUserDeclare
                        : submitUserAttack
                    }
                    className="rounded-full bg-amber-500 px-8 py-2 text-xs font-bold uppercase tracking-wider text-gray-950"
                  >
                    Speak
                  </button>
                </div>
              </div>
            ) : null}

            {phase === "paused_after_votes" && votes.length > 0 ? (
              <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <h3 className="text-sm font-bold text-white">Vote results</h3>
                <div className="space-y-3">
                  {(() => {
                    const maxC = Math.max(
                      ...voteTallyRows.map((r) => r.count),
                      1
                    );
                    return voteTallyRows.map((row) => {
                      const barLen =
                        maxC > 0
                          ? Math.max(
                              1,
                              Math.round((row.count / maxC) * 16)
                            )
                          : 1;
                      const bar = "█".repeat(barLen);
                      return (
                        <div
                          key={row.target}
                          className={`rounded-xl border px-3 py-2 font-mono text-sm ${
                            row.isLeader
                              ? "border-red-500/60 bg-red-950/25 text-red-100"
                              : "border-white/10 bg-black/20 text-zinc-200"
                          }`}
                        >
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span
                              className={`min-w-[5rem] font-semibold ${
                                row.isLeader ? "text-red-200" : ""
                              }`}
                            >
                              {row.displayName}
                            </span>
                            <span
                              className={
                                row.isLeader
                                  ? "text-red-300/90"
                                  : "text-emerald-400/80"
                              }
                              aria-hidden
                            >
                              {bar}
                            </span>
                            <span className="text-zinc-400">
                              {row.count} vote{row.count === 1 ? "" : "s"}
                            </span>
                          </div>
                          {row.isLeader ? (
                            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-red-400">
                              Most votes — elimination candidate
                            </p>
                          ) : null}
                        </div>
                      );
                    });
                  })()}
                </div>
                <details className="rounded-lg border border-white/10 bg-black/25 text-xs text-zinc-400">
                  <summary className="cursor-pointer select-none px-3 py-2 font-semibold text-zinc-300">
                    Voter reasons
                  </summary>
                  <ul className="space-y-2 border-t border-white/5 px-3 py-3">
                    {votes.map((v, i) => (
                      <li key={`${v.voter}-${i}`} className="leading-snug">
                        <span className="font-semibold text-zinc-200">
                          {v.voterName}
                        </span>{" "}
                        <span className="text-zinc-500">→</span>{" "}
                        <span className="text-amber-200/90">
                          {playerByProvider.get(v.target)?.name ?? v.target}
                        </span>
                        <span className="block pl-0 text-zinc-500">
                          {v.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={continueAfterVotes}
                    className="rounded-full border border-red-500/50 bg-red-950/30 px-8 py-3 text-sm font-bold uppercase tracking-wider text-red-200 transition hover:bg-red-950/50"
                  >
                    Eliminate →
                  </button>
                </div>
              </div>
            ) : null}

            {phase === "user_vote" && userMode === "challenge" ? (
              <div className="rounded-2xl border border-sky-500/40 bg-sky-950/20 p-4">
                <h3 className="text-sm font-bold text-white">
                  {revoteCandidates.length > 0
                    ? "Tiebreaker — cast your final vote"
                    : "Who do you vote to eliminate?"}
                </h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {AI_PLAYERS.filter((ap) => {
                    const st = players.find((x) => x.provider === ap.provider);
                    if (!st?.isAlive) return false;
                    if (revoteCandidates.length === 0) return true;
                    return revoteCandidates.includes(ap.provider);
                  }).map((ap) => (
                      <button
                        key={ap.provider}
                        type="button"
                        disabled={voteSubmitDone}
                        onClick={() => setChallengeVoteTarget(ap.provider)}
                        className={`rounded-full px-4 py-2 text-xs font-semibold ${
                          challengeVoteTarget === ap.provider
                            ? "bg-sky-500 text-gray-950"
                            : "bg-white/10 text-zinc-300 hover:bg-white/15"
                        } disabled:opacity-50`}
                      >
                        {ap.name}
                      </button>
                    ))}
                </div>
                <button
                  type="button"
                  disabled={!challengeVoteTarget || voteSubmitDone}
                  onClick={submitChallengeVote}
                  className="mt-4 w-full rounded-full bg-sky-500 py-3 text-xs font-bold uppercase tracking-wider text-gray-950 disabled:opacity-40"
                >
                  Submit vote
                </button>
              </div>
            ) : null}

            {phase === "eliminating" && lastEliminated ? (
              <div className="rounded-2xl border border-red-500/40 bg-red-950/30 p-6 text-center duration-500">
                <p className="text-lg font-bold text-white">
                  {lastEliminated.name} has been eliminated!
                </p>
                {revealShown ? (
                  <p
                    className={`mt-4 text-xl font-black ${
                      lastEliminated.wasWolf ? "text-red-400" : "text-zinc-400"
                    }`}
                  >
                    {lastEliminated.wasWolf
                      ? "🐺 THEY WERE THE WOLF!"
                      : "😇 They were innocent."}
                  </p>
                ) : null}
                {revealShown && eliminatingContinueLabel ? (
                  <button
                    type="button"
                    onClick={continueAfterElimination}
                    className="mt-6 w-full rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm font-bold uppercase tracking-wider text-white transition hover:bg-white/15"
                  >
                    {eliminatingContinueLabel}
                  </button>
                ) : null}
              </div>
            ) : null}

            {phase === "ended" ? (
              <div
                className={`fixed inset-0 z-40 flex items-center justify-center p-4 ${
                  winner === "citizens"
                    ? "bg-emerald-950/95"
                    : "bg-red-950/95"
                }`}
              >
                <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-black/60 p-8 shadow-2xl">
                  <h2
                    className={`text-center text-2xl font-black ${
                      winner === "citizens" ? "text-emerald-300" : "text-red-300"
                    }`}
                  >
                    {winner === "citizens"
                      ? "The wolf has been caught."
                      : "The wolf survived until the end."}
                  </h2>
                  <p className="mt-2 text-center text-sm text-zinc-400">
                    {winner === "citizens" ? "Citizens win" : "Wolves win"}
                  </p>

                  {userEliminatedRound !== null ? (
                    <p className="mt-4 text-center text-sm text-zinc-500">
                      You were eliminated in Round {userEliminatedRound}.
                    </p>
                  ) : null}

                  <div className="mt-8">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                      Wolf reveal
                    </h3>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {wolfIds.map((wid) => {
                        const p = AI_PLAYERS.find((a) => a.provider === wid);
                        const label = wid === "user" ? "You" : p?.name ?? wid;
                        return (
                          <div
                            key={wid}
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                              wid === "user"
                                ? "border-red-500/60 bg-red-950/40 ring-1 ring-red-500/30"
                                : "border-white/10 bg-white/5"
                            }`}
                          >
                            <span className="text-lg">🐺</span>
                            <span className="text-sm font-bold text-white">
                              {label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-8">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                      THE WOLF&apos;S DECEPTION
                    </h3>
                    <p className="mt-2 text-sm font-bold text-white">
                      How {wolfDeceptionTitleName} deceived you
                      {wolfIds.includes("user") ? (
                        <span className="mt-1 block text-base font-black text-red-400">
                          You played the wolf — here is how your moves read in
                          hindsight.
                        </span>
                      ) : null}
                    </p>
                    {wolfDeceptionHighlights.length === 0 ? (
                      <p className="mt-2 text-xs text-zinc-500">
                        No wolf statements to highlight.
                      </p>
                    ) : (
                      <ul className="mt-4 space-y-3">
                        {wolfDeceptionHighlights.map((m, idx) => (
                          <li
                            key={`wd-${idx}-${m.provider}-${m.round}`}
                            className="rounded-xl border border-red-500/30 bg-red-950/20 p-4"
                          >
                            <span className="inline-block rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-300">
                              Round {m.round}
                            </span>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                              “{m.text}”
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
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
