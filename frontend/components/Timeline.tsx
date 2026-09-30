"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtT, RESOLUTION_NOTE } from "@/lib/api";
import type { Nowcast, Series } from "@/lib/types";

interface Props {
  nowcast: Nowcast | null;
  series: Series | null;
  frame: number;
  onPick: (tMin: number) => void;
  designIntensity: number | null;
}

const HOURLY_T = [0, 60, 120, 180];

/** Hourly rainfall input (6 h antecedent + 3 h) with the High/Severe cell count at every forecast step,
 *  and a step selector over the 15-min model frames (or the hourly frames if only those are available). */
export default function Timeline({ nowcast, series, frame, onPick, designIntensity }: Props) {
  const [playing, setPlaying] = useState(false);
  const frames = useMemo(() => series?.frames ?? [], [series]);
  const steps = useMemo(() => (frames.length ? frames.map((f) => f.t_min) : HOURLY_T), [frames]);
  const tNow = steps[Math.min(frame, steps.length - 1)] ?? 0;
  const fine = (series?.stepMin ?? 60) < 60;

  useEffect(() => {
    if (!playing || !steps.length) return;
    const t = setInterval(() => onPick(steps[(frame + 1) % steps.length]), fine ? 700 : 1400);
    return () => clearInterval(t);
  }, [playing, frame, steps, fine, onPick]);

  // keep the selected step chip in view in whichever box scrolls (horizontal only; never scrolls the page)
  const outer = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const chip = strip.current?.querySelector<HTMLElement>(`[data-t="${tNow}"]`);
    if (!chip) return;
    for (const box of [strip.current, outer.current]) {
      if (!box || box.scrollWidth <= box.clientWidth) continue;
      const b = box.getBoundingClientRect(), e = chip.getBoundingClientRect();
      if (e.left < b.left || e.right > b.right) box.scrollLeft += e.left + e.width / 2 - (b.left + b.width / 2);
    }
  }, [tNow]);

  const rain = nowcast?.rain_hourly ?? Array(9).fill(0);
  const hours = nowcast?.rain_hours ?? [-6, -5, -4, -3, -2, -1, 0, 1, 2];
  const nPast = hours.filter((h) => h < 0).length;
  const n = rain.length;
  const ymax = Math.max(60, ...rain.map((r) => r * 1.15));
  const risk = frames.map((f) => f.counts[2] + f.counts[3]);
  const rmax = Math.max(10, ...risk) * 1.15;
  const xAt = (tMin: number) => ((nPast + tMin / 60) / n) * 100;
  const isLive = nowcast?.source === "live";
  const step = (d: number) => { setPlaying(false); onPick(steps[Math.min(steps.length - 1, Math.max(0, frame + d))]); };

  return (
    <div className="flex h-full select-none overflow-hidden border-t border-line bg-panel">
      <div className="flex w-[100px] shrink-0 flex-col justify-between border-r border-line px-2.5 py-2 sm:w-[136px] sm:px-3">
        <div>
          <div className="label">Forecast time</div>
          <div className="num mt-0.5 text-[15px] text-ink">{fmtT(tNow)}</div>
          <div className="text-[10px] leading-tight text-faint" title={RESOLUTION_NOTE}>{fine ? "15-min model forecast" : "Hourly steps"}</div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setPlaying((p) => !p)} title="Play the 0–3 h forecast"
            className="label whitespace-nowrap border border-line-strong px-1.5 py-0.5 text-ink hover:border-steel">
            {playing ? "Pause" : "Play"}
          </button>
          <button onClick={() => step(-1)} disabled={frame === 0} aria-label="Previous forecast step"
            className="num border border-line-strong px-1 py-0.5 text-[11px] text-ink hover:border-steel disabled:opacity-30">‹</button>
          <button onClick={() => step(1)} disabled={frame >= steps.length - 1} aria-label="Next forecast step"
            className="num border border-line-strong px-1 py-0.5 text-[11px] text-ink hover:border-steel disabled:opacity-30">›</button>
        </div>
      </div>

      {/* phones: the chart and step selector scroll horizontally together instead of squeezing */}
      <div ref={outer} className="scroll-thin min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
      <div className="flex h-full min-w-[520px] flex-col sm:min-w-0">
        <div className="relative min-h-0 flex-1 pb-4 pl-4 pr-6 pt-5">
          {/* legend */}
          <div className="absolute left-4 right-4 top-1 hidden gap-4 truncate text-[11px] text-dim sm:flex">
            <span><i className="mr-1 inline-block h-2 w-2 bg-water/50 align-middle" />Rainfall input, hourly, {isLive ? "past 6 h" : "antecedent 6 h"} (mm/h)</span>
            <span><i className="mr-1 inline-block h-2 w-2 bg-water align-middle" />{isLive ? "Forecast" : "Scenario"} next 3 h</span>
            <span><i className="mr-1 inline-block h-[2px] w-3 bg-r2 align-middle" />Cells at High or Severe</span>
          </div>

          <div className="relative h-full">
            {/* rainfall bars (hourly input; the model holds each hour's intensity for its four 15-min steps) */}
            <div className="absolute inset-0 flex items-end">
              {rain.map((r, i) => (
                <div key={i} className="relative flex h-full flex-1 items-end border-r border-line/60 px-[3px]">
                  <div className={`w-full ${hours[i] < 0 ? "bg-water/45" : "bg-water"}`} style={{ height: `${(r / ymax) * 100}%` }}
                    title={`${hours[i] < 0 ? hours[i] : "+" + hours[i]} h: ${r} mm/h`} />
                  <span className="num absolute -bottom-[15px] left-0 -translate-x-1/2 text-[10px] text-faint">
                    {hours[i] < 0 ? `${hours[i]}h` : hours[i] === 0 ? "NOW" : `+${hours[i]}h`}
                  </span>
                </div>
              ))}
            </div>

            {designIntensity != null && (
              <div className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-dim/60"
                style={{ bottom: `${(designIntensity / ymax) * 100}%` }}>
                <span className="absolute -top-[15px] left-1 text-[10px] text-dim">Drain design {designIntensity} mm/h</span>
              </div>
            )}

            {/* High/Severe count at every forecast step */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 100">
              <polyline fill="none" stroke="var(--r2)" strokeWidth={2} vectorEffect="non-scaling-stroke"
                points={risk.map((v, i) => `${xAt(frames[i].t_min)},${100 - (v / rmax) * 100}`).join(" ")} />
            </svg>
            {risk.map((v, i) => {
              const t = frames[i].t_min, sel = i === frame, hourly = t % 60 === 0;
              return (
                <button key={t} onClick={() => { setPlaying(false); onPick(t); }} aria-label={`${fmtT(t)}: ${v} cells High or Severe`}
                  className="absolute -translate-x-1/2 translate-y-1/2 p-1" style={{ left: `${xAt(t)}%`, bottom: `${(v / rmax) * 100}%` }}>
                  <div className={`rotate-45 ${hourly || sel ? "h-2 w-2" : "h-1.5 w-1.5"} ${sel ? "bg-r2" : "border border-r2 bg-panel"}`} />
                  {(sel || hourly) && (
                    <span className="num absolute -top-[16px] left-2 whitespace-nowrap bg-panel/90 px-1 text-[10px] text-r2">{v}</span>
                  )}
                </button>
              );
            })}

            <div className="pointer-events-none absolute bottom-0 top-0 border-l border-ink/70" style={{ left: `${xAt(0)}%` }} />
            {tNow > 0 && <div className="pointer-events-none absolute bottom-0 top-0 border-l border-steel" style={{ left: `${xAt(tNow)}%` }} />}
          </div>
        </div>

        {/* step selector: NOW, +15 ... +180 (scrolls horizontally when narrow) */}
        <div ref={strip} role="radiogroup" aria-label="Forecast step"
          className="scroll-thin flex shrink-0 items-center gap-0.5 overflow-x-auto border-t border-line px-2 py-1">
          {steps.map((t, i) => (
            <button key={t} data-t={t} role="radio" aria-checked={i === frame} onClick={() => { setPlaying(false); onPick(t); }}
              className={`num shrink-0 px-1.5 py-[1px] text-[11px] ${i === frame ? "bg-ink text-ground" : t % 60 === 0 ? "text-ink hover:bg-raise" : "text-dim hover:bg-raise hover:text-ink"}`}>
              {t === 0 ? "NOW" : `+${t}`}
            </button>
          ))}
          <span className="ml-auto hidden shrink-0 pl-2 text-[10px] text-faint sm:inline">{fine ? "min · 15-min model step" : "min"}</span>
        </div>
      </div>
      </div>
    </div>
  );
}
