import type { Nowcast, NowcastTimeline, Series } from "./types";

/** 15-min model forecast -> display series. Per-cell rainfall = step intensity x the model's spatial pattern. */
export function seriesFromTimeline(t: NowcastTimeline): Series {
  return {
    stepMin: t.resolution.model_dt_min,
    cells: t.cells,
    frames: t.frames.map((f) => ({ ...f, rain: t.rain_pattern.map((p) => Math.round(p * f.rain_mmph * 10) / 10) })),
    alerts: t.alerts,
    lead_min: t.lead_min,
  };
}

/** Fallback when the timeline is unavailable: the hourly /nowcast frames. */
export function seriesFromNowcast(n: Nowcast): Series {
  return { stepMin: 60, cells: n.cells, frames: n.frames, alerts: n.alerts, lead_min: n.lead_min };
}

/** Index of the frame at t_min, or of the last frame before it (e.g. +75 min on an hourly series -> +1 h). */
export function frameIndexAt(s: Series, tMin: number) {
  let i = 0;
  s.frames.forEach((f, k) => { if (f.t_min <= tMin) i = k; });
  return i;
}

/** Entry of a per-step list at t_min, or the last one before it. */
export function atTime<T extends { t_min: number }>(steps: T[], tMin: number): T {
  let best = steps[0];
  for (const s of steps) if (s.t_min <= tMin) best = s;
  return best;
}
