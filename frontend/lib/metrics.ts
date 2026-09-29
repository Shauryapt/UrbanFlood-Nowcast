import type { Nowcast, Params } from "./types";

const maxOf = (a: number[]) => a.reduce((m, v) => (v > m ? v : m), -Infinity);
/** 95th percentile: a robust "peak" for node utilisation, where single-node maxima are backwater outliers. */
export const p95 = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))] ?? 0; };

/** Operational summary for one nowcast step, derived only from API outputs. */
export function frameSummary(n: Nowcast, frame: number) {
  const f = n.frames[frame];
  const highSevere = f.counts[2] + f.counts[3];
  const perFrame = n.frames.map((x) => x.counts[2] + x.counts[3]);
  const peakFrame = perFrame.indexOf(maxOf(perFrame));
  return {
    zones: n.alerts[frame]?.total ?? 0,
    highSevereCells: highSevere,
    severeCells: f.counts[3],
    surcharged: f.node_util.filter((u) => u > 1).length,
    nodes: f.node_util.length,
    maxDepthCm: Math.max(0, maxOf(f.depth_cm)),
    peakUtil: p95(f.node_util),
    rainMean: f.rain.reduce((a, b) => a + b, 0) / f.rain.length,
    earliestLead: earliestLead(n),
    peakFrame,
    peakCells: perFrame[peakFrame],
  };
}

/** First time any cell reaches High within the 3 h horizon (minutes), or -1. */
export function earliestLead(n: Nowcast) {
  let best = -1;
  for (const l of n.lead_min) if (l >= 0 && (best < 0 || l < best)) best = l;
  return best;
}

export interface ScenarioMetrics {
  highSevereCells: number;   // peak over NOW..+3 h
  peakHourMin: number;
  peakDepthCm: number;
  surcharged: number;        // peak over NOW..+3 h
  peakUtil: number;          // max over NOW..+3 h of the 95th-percentile node utilisation
  earliestLead: number;
}

/** Whole-horizon metrics used by the scenario comparison. */
export function scenarioMetrics(n: Nowcast): ScenarioMetrics {
  const hs = n.frames.map((f) => f.counts[2] + f.counts[3]);
  const peak = hs.indexOf(maxOf(hs));
  return {
    highSevereCells: hs[peak],
    peakHourMin: n.frames[peak].t_min,
    peakDepthCm: Math.max(0, ...n.frames.map((f) => maxOf(f.depth_cm))),
    surcharged: Math.max(...n.frames.map((f) => f.node_util.filter((u) => u > 1).length)),
    peakUtil: Math.max(0, ...n.frames.map((f) => p95(f.node_util))),
    earliestLead: earliestLead(n),
  };
}

export function describeScenario(p: Params, presetLabel?: string) {
  const src = p.source === "live" ? "Observed / forecast" : presetLabel ?? p.preset;
  return `${src} · ×${p.multiplier.toFixed(2)} rain · +${Math.round(p.blockage * 100)}% blockage · ${p.tide} tide`;
}

/** Rainfall context from the hyetograph already returned by the API (mm/h per hour). */
export function rainContext(n: Nowcast) {
  const past = n.rain_hourly.filter((_, i) => n.rain_hours[i] < 0);
  const next = n.rain_hourly.filter((_, i) => n.rain_hours[i] >= 0);
  return {
    lastHour: past[past.length - 1] ?? 0,
    past6h: past.reduce((a, b) => a + b, 0),
    next3h: next.reduce((a, b) => a + b, 0),
    nextPeak: next.length ? maxOf(next) : 0,
    nextPeakHour: next.length ? next.indexOf(maxOf(next)) : 0,
  };
}
