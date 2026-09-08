"use client";

import Image from "next/image";
import tarotDeckJson from "@/public/tarot/deck.json";
import { tarotCardNameKo, tarotPositionKo } from "@/lib/oracle/display-copy";

type DrawnCard = {
  id?: number
  name?: string
  reversed?: boolean
  positionLabel?: string
}

type DeckEntry = { id: number; src: string; name: string }

const DECK = (tarotDeckJson as { deck: DeckEntry[] }).deck

function cardSrc(id: number | undefined): string | null {
  if (typeof id !== "number") return null
  return DECK.find((entry) => entry.id === id)?.src ?? null
}

export default function TarotSpreadChart({
  cards,
  size = "default",
}: {
  cards: DrawnCard[]
  size?: "default" | "hero"
}) {
  if (!cards.length) {
    return <p className="text-sm text-white/45">뽑은 카드가 없습니다.</p>
  }

  const hero = size === "hero"
  const width = hero ? 220 : 140
  const height = hero ? 374 : 238
  const imgClass = hero ? "h-auto w-[13.5rem] sm:w-[16rem]" : "h-auto w-[7.5rem]"

  return (
    <ul className={hero ? "flex justify-center" : "grid grid-cols-2 gap-3 sm:grid-cols-3"}>
      {cards.map((card, index) => {
        const src = cardSrc(card.id)
        const deckName =
          typeof card.id === "number" ? (DECK.find((entry) => entry.id === card.id)?.name ?? "") : ""
        const nameKo = tarotCardNameKo(card.name || deckName, typeof card.id === "number" ? card.id : -1)
        const position = tarotPositionKo(card.positionLabel ?? "")
        return (
          <li
            key={`${position}-${index}`}
            className={`flex flex-col items-center rounded-2xl border border-white/10 bg-black/20 ${hero ? "p-5" : "p-3"}`}
          >
            <p className="text-[11px] font-medium tracking-wide text-cyan-100/80">{position}</p>
            <div className="mt-2 overflow-hidden rounded-lg border border-white/15 bg-[#1a0533]">
              {src ? (
                <Image
                  src={src}
                  alt={nameKo}
                  width={width}
                  height={height}
                  className={`${imgClass} ${card.reversed ? "rotate-180" : ""}`}
                />
              ) : (
                <div
                  className={`flex items-center justify-center text-xs text-white/40 ${
                    hero ? "h-[374px] w-[13.5rem] sm:w-[16rem]" : "h-[238px] w-[7.5rem]"
                  }`}
                >
                  {nameKo}
                </div>
              )}
            </div>
            <p className={`mt-2 text-center font-semibold text-white ${hero ? "text-lg" : "text-sm"}`}>
              {nameKo}
            </p>
            {card.reversed ? (
              <p className="mt-0.5 text-[11px] text-amber-200/80">역방향</p>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
