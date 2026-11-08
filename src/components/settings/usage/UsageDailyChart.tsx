"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { useLocalePick } from "@/i18n/IntlProvider";
import type { DayPoint } from "@/lib/usage";

import { formatCompactNumber, formatUsd, niceTicks } from "./usage-format";

export type ChartMetric = "tokens" | "cost";

type Series = { key: "codex" | "claude"; label: string; color: string };

const SERIES: readonly Series[] = [
  { key: "codex", label: "Codex", color: "var(--color-series-1)" },
  { key: "claude", label: "Claude Code", color: "var(--color-series-2)" },
];

const HEIGHT = 220;
const PAD = { top: 12, right: 88, bottom: 26, left: 52 } as const;
const Y_TICK_TARGET = 4;
const MARKER_RADIUS = 4;
const LABEL_MIN_GAP = 13;

function valueOf(point: DayPoint, key: Series["key"], metric: ChartMetric): number {
  if (metric === "cost") return key === "claude" ? point.claudeCost : point.codexCost;
  return point[key];
}

function formatValue(n: number, metric: ChartMetric): string {
  return metric === "cost" ? formatUsd(n) : formatCompactNumber(n);
}

function formatDay(day: string, locale: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(locale, { month: "short", day: "numeric" });
}

type Props = { daily: readonly DayPoint[]; metric: ChartMetric };

export function UsageDailyChart({ daily, metric }: Props) {
  const pick = useLocalePick();
  const locale = pick("tr-TR", "en-US");
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const maxValue = useMemo(
    () => Math.max(0, ...daily.flatMap((d) => SERIES.map((s) => valueOf(d, s.key, metric)))),
    [daily, metric],
  );
  const ticks = niceTicks(maxValue, Y_TICK_TARGET);
  const yMax = ticks[ticks.length - 1] ?? 1;
  const x = (i: number) => PAD.left + (daily.length <= 1 ? plotW / 2 : (i / (daily.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  const paths = SERIES.map((s) => {
    const pts = daily.map((d, i) => `${x(i).toFixed(1)},${y(valueOf(d, s.key, metric)).toFixed(1)}`);
    const line = `M${pts.join("L")}`;
    const area = daily.length > 0 ? `${line}L${x(daily.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : "";
    return { series: s, line, area };
  });

  // End labels: one per series at the last point, nudged apart when they collide.
  const last = daily[daily.length - 1];
  const endLabels = last
    ? SERIES.map((s) => ({ s, yPos: y(valueOf(last, s.key, metric)) })).sort((a, b) => a.yPos - b.yPos)
    : [];
  for (let i = 1; i < endLabels.length; i++) {
    const prev = endLabels[i - 1];
    const cur = endLabels[i];
    if (prev && cur && cur.yPos - prev.yPos < LABEL_MIN_GAP) cur.yPos = prev.yPos + LABEL_MIN_GAP;
  }

  const xLabelIdx = daily.length <= 2 ? daily.map((_, i) => i) : [0, Math.floor((daily.length - 1) / 2), daily.length - 1];

  function indexAt(clientX: number, rect: DOMRect): number {
    const rel = (clientX - rect.left - PAD.left) / Math.max(1, plotW);
    return Math.min(daily.length - 1, Math.max(0, Math.round(rel * (daily.length - 1))));
  }

  function handlePointer(e: PointerEvent<SVGRectElement>): void {
    const svg = e.currentTarget.ownerSVGElement;
    if (svg && daily.length > 0) setActive(indexAt(e.clientX, svg.getBoundingClientRect()));
  }

  function handleKey(e: KeyboardEvent<HTMLDivElement>): void {
    if (daily.length === 0) return;
    if (e.key === "ArrowRight") setActive((i) => Math.min(daily.length - 1, (i ?? -1) + 1));
    else if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? daily.length) - 1));
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  }

  const activePoint = active !== null ? daily[active] : undefined;
  const tooltipLeft = active !== null ? Math.min(x(active) + 12, width - 180) : 0;
  const summary = pick(
    `Günlük ${metric === "cost" ? "maliyet" : "token"} grafiği, ${daily.length} gün`,
    `Daily ${metric === "cost" ? "cost" : "token"} chart, ${daily.length} days`,
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-[2px] w-3.5 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>
      <div
        ref={containerRef}
        className="relative w-full rounded-[var(--radius-sm)] outline-none focus-visible:ring-2 focus-visible:ring-accent"
        tabIndex={0}
        onKeyDown={handleKey}
        onBlur={() => setActive(null)}
        aria-label={summary}
      >
        <svg width={width} height={HEIGHT} role="img" aria-label={summary} className="block">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-rule)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-ink-4)">
                {formatValue(t, metric)}
              </text>
            </g>
          ))}
          {xLabelIdx.map((i) => {
            const day = daily[i];
            if (!day) return null;
            const anchor = i === 0 && daily.length > 1 ? "start" : i === daily.length - 1 && daily.length > 1 ? "end" : "middle";
            return (
              <text key={day.day} x={x(i)} y={HEIGHT - 6} textAnchor={anchor} fontSize={11} fill="var(--color-ink-4)">
                {formatDay(day.day, locale).toLocaleUpperCase(locale)}
              </text>
            );
          })}
          {paths.map(({ series, area }) => (
            <path key={`${series.key}-area`} d={area} fill={series.color} fillOpacity={0.1} />
          ))}
          {paths.map(({ series, line }) => (
            <path key={series.key} d={line} fill="none" stroke={series.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {endLabels.map(({ s, yPos }) => (
            <text key={s.key} x={width - PAD.right + 8} y={yPos} dy="0.32em" fontSize={11.5} fill="var(--color-ink-2)">
              {s.label}
            </text>
          ))}
          {activePoint && active !== null ? (
            <g pointerEvents="none">
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--color-ink-4)" strokeWidth={1} />
              {SERIES.map((s) => (
                <circle
                  key={s.key}
                  cx={x(active)}
                  cy={y(valueOf(activePoint, s.key, metric))}
                  r={MARKER_RADIUS}
                  fill={s.color}
                  stroke="var(--color-paper-2)"
                  strokeWidth={2}
                />
              ))}
            </g>
          ) : null}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={Math.max(0, plotW)}
            height={plotH}
            fill="transparent"
            onPointerMove={handlePointer}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
        {activePoint ? (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[160px] rounded-[var(--radius-sm)] border border-rule bg-paper px-3 py-2 text-[12px] shadow-[var(--shadow-medium)]"
            style={{ left: tooltipLeft }}
            role="status"
          >
            <div className="mb-1 text-ink-3">{formatDay(activePoint.day, locale)}</div>
            {SERIES.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <span className="h-[2px] w-3 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                <span className="font-semibold tabular-nums text-ink">{formatValue(valueOf(activePoint, s.key, metric), metric)}</span>
                <span className="text-ink-3">{s.label}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
