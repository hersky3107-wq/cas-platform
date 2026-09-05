"use client";

import { useState, type ReactNode } from "react";
import {
  BODY_KO,
  DOMAIN_KO,
  ELEMENT_KO,
  GYEOK_KO,
  PALACE_KO,
  PRISM_CYCLE_KO,
  PRISM_RELATION_KO,
  RUNE_KO,
  SIGN_KO,
  oneDecimal,
} from "@/lib/oracle/display-copy";
import { PRISM_COLOR_HEX, PRISM_COLOR_KO } from "@/lib/oracle/prism-swatches";
import type { PrismColor } from "@/lib/oracle/engines/prism/tables";
import StructuredComputationPanel from "./StructuredComputationPanel";
import TarotSpreadChart from "./TarotSpreadChart";

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/6 py-1.5 last:border-0">
      <dt className="shrink-0 text-[12px] text-white/50">{label}</dt>
      <dd className="text-right text-sm text-slate-100">{value}</dd>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <dl className="mt-3">{children}</dl>
    </div>
  );
}

function ComingSoon() {
  return <p className="text-sm leading-relaxed text-white/50">전용 차트 준비 중</p>;
}

function nest(value: unknown, ...keys: string[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function prismSummary(calculation: Json) {
  const prism = nest(calculation, "prism");
  if (!isRecord(prism)) return null;
  const colors = isRecord(prism.colors) ? prism.colors : null;
  const annual = isRecord(prism.annualCycle) ? prism.annualCycle : null;
  const monthly = isRecord(prism.monthlyCycle) ? prism.monthlyCycle : null;
  const rows: { label: string; value: string }[] = [];

  const colorRow = (key: "impulse" | "need" | "identity", label: string) => {
    const id = colors?.[key];
    if (typeof id !== "string") return;
    const ko = PRISM_COLOR_KO[id as PrismColor] ?? id;
    rows.push({ label, value: ko });
  };
  colorRow("impulse", "충동");
  colorRow("need", "필요");
  colorRow("identity", "정체성");

  if (typeof prism.opportunityDomain === "string") {
    rows.push({
      label: "기회",
      value: DOMAIN_KO[prism.opportunityDomain] ?? prism.opportunityDomain,
    });
  }
  if (typeof prism.warningDomain === "string") {
    rows.push({
      label: "주의",
      value: DOMAIN_KO[prism.warningDomain] ?? prism.warningDomain,
    });
  }
  if (typeof prism.elementRelation === "string") {
    rows.push({
      label: "오행 관계",
      value: PRISM_RELATION_KO[prism.elementRelation] ?? prism.elementRelation,
    });
  }
  if (annual && typeof annual.name === "string") {
    const copy = PRISM_CYCLE_KO[annual.name];
    rows.push({ label: "올해 주기", value: copy?.name ?? annual.name });
    if (copy) {
      rows.push({ label: "올해 하면 좋은 일", value: copy.lucky });
      rows.push({ label: "올해 피할 일", value: copy.taboo });
    }
  }
  if (monthly && typeof monthly.name === "string") {
    const copy = PRISM_CYCLE_KO[monthly.name];
    rows.push({ label: "이달 주기", value: copy?.name ?? monthly.name });
  }

  return (
    <Panel title="PRISM">
      {colors ? (
        <div className="mb-3 flex gap-2">
          {(["impulse", "need", "identity"] as const).map((key) => {
            const id = colors[key];
            if (typeof id !== "string") return null;
            const hex = PRISM_COLOR_HEX[id as PrismColor];
            return (
              <span
                key={key}
                title={PRISM_COLOR_KO[id as PrismColor] ?? id}
                className="h-7 w-7 rounded-full border border-white/25"
                style={{ background: hex ?? "#888" }}
              />
            );
          })}
        </div>
      ) : null}
      {rows.map((row) => (
        <Row key={row.label} label={row.label} value={row.value} />
      ))}
    </Panel>
  );
}

function astroSummary(calculation: Json) {
  const natal = nest(calculation, "natal");
  if (!isRecord(natal)) return null;
  const bodies = isRecord(natal.bodies) ? natal.bodies : null;
  if (!bodies) return <ComingSoon />;
  const rows: { label: string; value: string }[] = [];
  for (const key of ["Sun", "Moon"] as const) {
    const body = isRecord(bodies[key]) ? bodies[key] : null;
    if (!body || typeof body.sign !== "string") continue;
    const deg = typeof body.degreeInSign === "number" ? ` ${oneDecimal(body.degreeInSign)}°` : "";
    rows.push({
      label: BODY_KO[key] ?? key,
      value: `${SIGN_KO[body.sign] ?? body.sign}${deg}`,
    });
  }
  const angles = isRecord(natal.angles) ? natal.angles : null;
  if (angles && typeof angles.ascendant === "number") {
    const signIndex = Math.floor((((angles.ascendant % 360) + 360) % 360) / 30);
    const signs = Object.keys(SIGN_KO);
    const sign = signs[signIndex];
    if (sign) rows.push({ label: "상승", value: SIGN_KO[sign] ?? sign });
  }
  if (!rows.length) return <ComingSoon />;
  return (
    <Panel title="출생 차트">
      {rows.map((row) => (
        <Row key={row.label} label={row.label} value={row.value} />
      ))}
    </Panel>
  );
}

function numerologySummary(calculation: Json) {
  const numbers = nest(calculation, "numbers");
  if (!isRecord(numbers)) return null;
  const rows = [
    ["라이프 패스", numbers.lifePath],
    ["생일 수", numbers.birthdayNumber],
    ["개인 연도", numbers.personalYear],
    ["개인 월", numbers.personalMonth],
  ].filter(([, v]) => typeof v === "number") as [string, number][];
  if (!rows.length) return <ComingSoon />;
  return (
    <Panel title="핵심 수">
      {rows.map(([label, value]) => (
        <Row key={label} label={label} value={String(value)} />
      ))}
    </Panel>
  );
}

function nameSummary(calculation: Json) {
  const reading = nest(calculation, "reading");
  if (!isRecord(reading) || reading.supported === false) return <ComingSoon />;
  const gyeok = isRecord(reading.gyeok) ? reading.gyeok : null;
  const suri = isRecord(reading.numerology81) ? reading.numerology81 : null;
  if (!gyeok) return <ComingSoon />;
  return (
    <Panel title="오격">
      {(["cheon", "in", "ji", "oe", "chong"] as const).map((key) => {
        const n = gyeok[key];
        const entry = isRecord(suri?.[key]) ? suri[key] : null;
        const label = typeof entry?.label === "string" ? ` · ${entry.label}` : "";
        return (
          <Row
            key={key}
            label={GYEOK_KO[key] ?? key}
            value={typeof n === "number" ? `${n}${label}` : "—"}
          />
        );
      })}
    </Panel>
  );
}

function ichingSummary(calculation: Json) {
  const draw = nest(calculation, "draw");
  if (!isRecord(draw)) return null;
  const primary = isRecord(draw.primary) ? draw.primary : null;
  const resulting = isRecord(draw.resulting) ? draw.resulting : null;
  if (!primary) return <ComingSoon />;
  return (
    <Panel title="괘">
      <Row
        label="본괘"
        value={`${typeof primary.hanja === "string" ? primary.hanja : ""} ${typeof primary.hangul === "string" ? primary.hangul : ""}`.trim()}
      />
      {resulting ? (
        <Row
          label="변괘"
          value={`${typeof resulting.hanja === "string" ? resulting.hanja : ""} ${typeof resulting.hangul === "string" ? resulting.hangul : ""}`.trim()}
        />
      ) : null}
    </Panel>
  );
}

function runesSummary(calculation: Json) {
  const draw = nest(calculation, "draw");
  if (!isRecord(draw) || !Array.isArray(draw.runes)) return null;
  const names = draw.runes
    .map((rune) => {
      if (!isRecord(rune)) return null;
      const glyph = typeof rune.glyph === "string" ? rune.glyph : "";
      const raw = typeof rune.name === "string" ? rune.name : "";
      const name = raw ? RUNE_KO[raw] ?? raw : "";
      const reversed = rune.reversed === true ? " (역)" : "";
      return `${glyph} ${name}${reversed}`.trim();
    })
    .filter((row): row is string => Boolean(row));
  if (!names.length) return <ComingSoon />;
  return (
    <Panel title="뽑은 룬">
      {names.map((name, i) => (
        <Row key={`${name}-${i}`} label={`${i + 1}`} value={name} />
      ))}
    </Panel>
  );
}

function ninestarSummary(calculation: Json) {
  const natal = nest(calculation, "natal");
  if (!isRecord(natal)) return null;
  const cell = (key: string, label: string) => {
    const star = isRecord(natal[key]) ? natal[key] : null;
    if (!star) return null;
    const hangul = typeof star.hangul === "string" ? star.hangul : "";
    const number = typeof star.number === "number" ? star.number : "";
    const element =
      typeof star.element === "string" ? ELEMENT_KO[star.element] ?? "" : "";
    return (
      <Row
        key={key}
        label={label}
        value={[number && `${number}성`, hangul, element].filter(Boolean).join(" · ")}
      />
    );
  };
  return (
    <Panel title="구성">
      {cell("year", "본명성")}
      {cell("month", "월명성")}
      {cell("day", "일명성")}
    </Panel>
  );
}

function sukuyouSummary(calculation: Json) {
  const natal = nest(calculation, "natal");
  if (!isRecord(natal)) return null;
  const hanja = typeof natal.hanja === "string" ? natal.hanja : "";
  const hangul = typeof natal.hangul === "string" ? natal.hangul : "";
  if (!hanja && !hangul) return <ComingSoon />;
  return (
    <Panel title="태어난 숙">
      <Row label="숙" value={`${hanja} ${hangul}`.trim()} />
    </Panel>
  );
}

function tzolkinSummary(calculation: Json) {
  const natal = nest(calculation, "natal");
  if (!isRecord(natal)) return null;
  const tone = natal.tone;
  const nawal = typeof natal.nawalName === "string" ? natal.nawalName : "";
  if (!nawal && tone == null) return <ComingSoon />;
  return (
    <Panel title="촐킨">
      {typeof tone === "number" ? <Row label="톤" value={String(tone)} /> : null}
      {nawal ? <Row label="날의 문양" value={nawal} /> : null}
    </Panel>
  );
}

function ziweiSummary(calculation: Json) {
  const chart = nest(calculation, "chart");
  if (!isRecord(chart)) return null;
  const palaces = Array.isArray(chart.palaces) ? chart.palaces : null;
  const ming = palaces?.find((p) => isRecord(p) && p.name === "命");
  const ju = isRecord(chart.wuXingJu) ? chart.wuXingJu : null;
  const rows: { label: string; value: string }[] = [];
  if (ju && typeof ju.name === "string") rows.push({ label: "오행국", value: ju.name });
  if (isRecord(ming) && Array.isArray(ming.stars)) {
    const majors = ming.stars
      .filter((star): star is Json => isRecord(star) && star.category === "major")
      .map((star) => (typeof star.name === "string" ? star.name : ""))
      .filter(Boolean);
    if (majors.length) rows.push({ label: PALACE_KO.命 ?? "명궁", value: majors.join(" · ") });
  }
  if (!rows.length) return <ComingSoon />;
  return (
    <Panel title="자미두수">
      {rows.map((row) => (
        <Row key={row.label} label={row.label} value={row.value} />
      ))}
    </Panel>
  );
}

function tarotCards(calculation: Json): Array<Record<string, unknown>> {
  const draw = nest(calculation, "draw");
  if (!isRecord(draw) || !Array.isArray(draw.cards)) return [];
  return draw.cards.filter(isRecord);
}

function summaryFor(system: string, calculation: Json) {
  switch (system) {
    case "prism":
      return prismSummary(calculation);
    case "astro":
      return astroSummary(calculation);
    case "numerology":
      return numerologySummary(calculation);
    case "name":
      return nameSummary(calculation);
    case "iching":
      return ichingSummary(calculation);
    case "runes":
      return runesSummary(calculation);
    case "ninestar":
      return ninestarSummary(calculation);
    case "sukuyou":
      return sukuyouSummary(calculation);
    case "tzolkin":
      return tzolkinSummary(calculation);
    case "ziwei":
      return ziweiSummary(calculation);
    case "tarot":
      return <TarotSpreadChart cards={tarotCards(calculation)} />;
    default:
      return <ComingSoon />;
  }
}

function stripTarotInternals(calculation: Json): Json {
  const draw = nest(calculation, "draw");
  if (!isRecord(draw) || !Array.isArray(draw.cards)) return calculation;
  const { seed: _seed, ...drawRest } = draw;
  void _seed;
  return {
    ...calculation,
    draw: {
      ...drawRest,
      cards: draw.cards.map((card) => {
        if (!isRecord(card)) return card;
        const { id: _id, pickedPosition: _pos, ...rest } = card;
        void _id;
        void _pos;
        return rest;
      }),
    },
  };
}

export default function ComputationSummary({
  system,
  systemName,
  calculation,
  engineVersion,
  unreadable,
}: {
  system: string;
  systemName: string;
  calculation: Json | null;
  engineVersion: string | null;
  unreadable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const body = !calculation || unreadable ? <ComingSoon /> : summaryFor(system, calculation);
  const detail = calculation && system === "tarot" ? stripTarotInternals(calculation) : calculation;

  return (
    <article className="rounded-[22px] border border-white/10 bg-[#10182b] p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-200/65">계산</p>
      <div className="mt-3">{body}</div>
      {detail && !unreadable ? (
        <div className="mt-4 border-t border-white/8 pt-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[12px] text-white/45 underline-offset-2 hover:text-white/70 hover:underline"
          >
            {open ? "간단히" : "자세히 보기"}
          </button>
          {open ? (
            <div className="mt-3">
              <StructuredComputationPanel
                systemName={systemName}
                calculation={detail}
                engineVersion={engineVersion}
                embedded
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
