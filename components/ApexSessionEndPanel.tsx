"use client";

import { useCallback, useState } from "react";
import { PUBLIC_SHARE_BASE } from "@/lib/compare/session-types";
import type { SynodLocale } from "@/lib/synod/ui-labels";
import type { ApexUiPack } from "@/lib/apex/ui-labels";
import { AI_COLORS, BRAND, APEX_PROVIDERS } from "@/lib/apex/config";

/** Platforms with a web share intent. Names are proper nouns — never translated. */
const SOCIAL_PLATFORMS = [
  "X",
  "Facebook",
  "WhatsApp",
  "Telegram",
  "LINE",
  "Reddit",
  "Threads",
] as const;

type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

function socialIntentUrl(platform: SocialPlatform, text: string, url: string): string {
  switch (platform) {
    case "X":
      return `https://twitter.com/intent/tweet?text=${text}&url=${url}`;
    case "Facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${url}`;
    case "WhatsApp":
      return `https://wa.me/?text=${text}%20${url}`;
    case "Telegram":
      return `https://t.me/share/url?url=${url}&text=${text}`;
    case "LINE":
      return `https://line.me/R/share?text=${text}%20${url}`;
    case "Reddit":
      return `https://www.reddit.com/submit?url=${url}&title=${text}`;
    case "Threads":
      return `https://www.threads.net/intent/post?text=${text}%20${url}`;
  }
}

type ApexSessionEndPanelProps = {
  sessionId: string;
  shareId: string | null;
  t: ApexUiPack;
  locale: SynodLocale;
  votedAi: string | null;
  onVoted: (provider: string) => void;
};

export function ApexSessionEndPanel({
  sessionId,
  shareId,
  t,
  locale,
  votedAi,
  onVoted,
}: ApexSessionEndPanelProps) {
  void locale; // RTL flows from <main dir>; kept for future locale-specific tweaks.

  const [voting, setVoting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [goPublicLoading, setGoPublicLoading] = useState(false);
  const [goPublicDone, setGoPublicDone] = useState(false);
  const [goPublicError, setGoPublicError] = useState<string | null>(null);

  const shareUrl = shareId ? `${PUBLIC_SHARE_BASE}/${shareId}` : null;

  const submitVote = useCallback(
    async (provider: string) => {
      if (voting) return;
      setVoting(true);
      setVoteError(null);
      try {
        const res = await fetch("/api/apex", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "vote", sessionId, voted_ai: provider }),
        });
        if (!res.ok) {
          setVoteError(t.requestFailed(res.status));
          return;
        }
        const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (!data || data.ok !== true) {
          setVoteError(t.networkError);
          return;
        }
        onVoted(provider);
      } catch {
        setVoteError(t.networkError);
      } finally {
        setVoting(false);
      }
    },
    [voting, sessionId, t, onVoted]
  );

  const copyShareLink = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — ignore */
    }
  }, [shareUrl]);

  const handleGoPublic = useCallback(async () => {
    if (goPublicLoading || goPublicDone || !sessionId) return;
    setGoPublicLoading(true);
    setGoPublicError(null);
    try {
      const res = await fetch("/api/apex/go-public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { share_id?: string; error?: string }
        | null;
      if (!res.ok) {
        setGoPublicError(data?.error ?? t.networkError);
        return;
      }
      setGoPublicDone(true);
    } catch {
      setGoPublicError(t.networkError);
    } finally {
      setGoPublicLoading(false);
    }
  }, [goPublicLoading, goPublicDone, sessionId, t]);

  return (
    <section className="space-y-5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 sm:px-5">
      {/* VOTE */}
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-amber-300/80">
          {t.votePrompt}
        </p>
        <div className="flex flex-wrap gap-2">
          {APEX_PROVIDERS.map((provider) => {
            const selected = votedAi === provider;
            return (
              <button
                key={provider}
                type="button"
                onClick={() => void submitVote(provider)}
                disabled={voting}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                  selected
                    ? "border-amber-400/50 bg-amber-500/20 text-amber-200"
                    : "border-white/10 bg-white/[0.04] text-slate-300 hover:border-white/25 hover:bg-white/10"
                }`}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: AI_COLORS[provider] }}
                  aria-hidden
                />
                {BRAND[provider]}
              </button>
            );
          })}
        </div>
        {votedAi ? (
          <p className="mt-2 text-xs text-amber-300/90">{t.voteThanks}</p>
        ) : null}
        {voteError ? (
          <p className="mt-2 text-xs text-rose-300/90">{voteError}</p>
        ) : null}
      </div>

      {/* SHARE */}
      <div className="border-t border-white/10 pt-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
          {t.shareHeading}
        </p>
        {shareUrl ? (
          <div className="flex flex-wrap gap-2">
            {SOCIAL_PLATFORMS.map((platform) => (
              <a
                key={platform}
                href={socialIntentUrl(
                  platform,
                  encodeURIComponent(t.shareTweet),
                  encodeURIComponent(shareUrl)
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-200 transition hover:border-white/25 hover:bg-white/10"
              >
                {platform}
              </a>
            ))}
          </div>
        ) : null}
        <div className="mt-2 flex flex-col items-start gap-1">
          <button
            type="button"
            onClick={() => void copyShareLink()}
            disabled={!shareUrl}
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-white/25 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copied ? t.copied : t.copyLink}
          </button>
          <p className="text-xs italic text-slate-500">
            KakaoTalk · TikTok · Instagram · Discord — copy link &amp; paste
          </p>
        </div>
      </div>

      {/* GO PUBLIC */}
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
        {goPublicDone ? (
          <div className="text-sm">
            <p className="font-medium text-amber-200">✅ {t.published}</p>
            {shareId ? (
              <p className="mt-1 break-all text-xs text-slate-400">
                aimani.ai/share/{shareId}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <p className="text-sm font-bold text-white">
              <span className="mr-1.5" aria-hidden>
                🔍
              </span>
              {t.goPublicHeading}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {t.goPublicSubtext}
            </p>
            <div className="mt-3">
              <button
                type="button"
                onClick={() => void handleGoPublic()}
                disabled={goPublicLoading || !sessionId}
                className="inline-flex items-center justify-center rounded-full border border-amber-400/50 bg-amber-500/20 px-4 py-1.5 text-sm font-semibold text-amber-300 transition hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {goPublicLoading ? t.publishing : t.goPublicButton}
              </button>
            </div>
            {goPublicError ? (
              <p className="mt-2 text-xs text-rose-300/90">{goPublicError}</p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
