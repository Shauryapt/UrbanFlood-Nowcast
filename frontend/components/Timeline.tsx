"use client";
import { useEffect, useState } from "react";
import { fmtT } from "@/lib/api";
import type { Nowcast } from "@/lib/types";

interface Props {
  nowcast: Nowcast | null;
  frame: number;
  onFrame: (f: number) => void;
  designIntensity: number | null;
}

/** Rainfall hyetograph (6 h antecedent + 3 h forecast) with the High/Severe cell count at each nowcast step. */
export default function Timeline({ nowcast, frame, onFrame, designIntensity }: Props) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => onFrame((frame + 1) % 4), 1400);
    return () => clearInterval(t);
  }, [playing, frame, onFrame]);

  const rain = nowcast?.rain_hourly ?? Array(9).fill(0);
  const hours = nowcast?.rain_hours ?? [-6, -5, -4, -3, -2, -1, 0, 1, 2];
  const nPast = hours.filter((h) => h < 0).length;
  const n = rain.length;
  const ymax = Math.max(60, ...rain.map((r) => r * 1.15));
  const risk = (nowcast?.frames ?? []).map((f) => f.counts[2] + f.counts[3]);
  const rmax = Math.max(10, ...risk) * 1.15;
  const xAt = (i: number) => ((nPast + i) / n) * 100;          // frame i -> % position
  const isLive = nowcast?.source === "live";

  return (
    <div className="flex h-full select-none overflow-hidden border-t border-line bg-panel">
      <div className="flex w-[92px] shrink-0 flex-col sm:w-[136px] justify-between border-r border-line px-3 py-2">
        <div>
          <div className="label">Nowcast horizon</div>
          <div className="num mt-0.5 text-[15px] text-ink">{fmtT((nowcast?.frames[frame]?.t_min) ?? 0)}</div>
        </div>
        <button onClick={() => setPlaying((p) => !p)}
          className="label w-fit border border-line-strong px-2 py-0.5 text-ink hover:border-steel">
          {playing ? "Pause" : "Play 0–3 h"}
        </button>
      </div>

      <div className="relative min-w-0 flex-1 pb-7 pl-4 pr-6 pt-5">
        {/* legend */}
        <div className="absolute left-4 right-4 top-1 hidden gap-4 text-[11px] text-dim sm:flex">
          <span><i className="mr-1 inline-block h-2 w-2 bg-water/50 align-middle" />Rainfall, {isLive ? "past 6 h" : "antecedent 6 h"} (mm/h)</span>
          <span><i className="mr-1 inline-block h-2 w-2 bg-water align-middle" />{isLive ? "Forecast" : "Scenario"} next 3 h</span>
          <span><i className="mr-1 inline-block h-[2px] w-3 bg-r2 align-middle" />Cells at High or Severe</span>
        </div>

        <div className="relative h-full">
          {/* rainfall bars */}
          <div className="absolute inset-0 flex items-end">
            {rain.map((r, i) => (
              <div key={i} className="relative flex h-full flex-1 items-end border-r border-line/60 px-[3px]">
                <div className={`w-full ${hours[i] < 0 ? "bg-water/45" : "bg-water"}`} style={{ height: `${(r / ymax) * 100}%` }}
                  title={`${hours[i] < 0 ? hours[i] : "+" + hours[i]} h: ${r} mm/h`} />
                <span className="num absolute -bottom-[18px] left-0 -translate-x-1/2 text-[10px] text-faint">
                  {i < nPast ? `${hours[i]}h` : ""}
                </span>
              </div>
            ))}
          </div>

          {/* legacy drain design intensity reference */}
          {designIntensity != null && (
            <div className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-dim/60"
              style={{ bottom: `${(designIntensity / ymax) * 100}%` }}>
              <span className="absolute -top-[15px] left-1 text-[10px] text-dim">Drain design {designIntensity} mm/h</span>
            </div>
          )}

          {/* risk line */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 100">
            <polyline fill="none" stroke="var(--color-r2)" strokeWidth={2} vectorEffect="non-scaling-stroke"
              points={risk.map((v, i) => `${xAt(i)},${100 - (v / rmax) * 100}`).join(" ")} />
          </svg>
          {risk.map((v, i) => (
            <div key={i} className="pointer-events-none absolute -translate-x-1/2 translate-y-1/2" style={{ left: `${xAt(i)}%`, bottom: `${(v / rmax) * 100}%` }}>
              <div className={`h-2 w-2 rotate-45 ${i === frame ? "bg-r2" : "border border-r2 bg-panel"}`} />
              <span className="num absolute -top-[18px] left-1.5 whitespace-nowrap bg-panel/90 px-1 text-[10px] text-r2">{v}</span>
            </div>
          ))}

          {/* NOW divider */}
          <div className="pointer-events-none absolute bottom-0 top-0 border-l border-ink/70" style={{ left: `${xAt(0)}%` }} />

          {/* frame selectors */}
          {[0, 1, 2, 3].map((i) => (
            <button key={i} onClick={() => { setPlaying(false); onFrame(i); }}
              aria-pressed={i === frame}
              className={`num absolute -bottom-[27px] whitespace-nowrap px-1.5 py-[1px] text-[11px] ${i === 3 ? "-translate-x-full" : "-translate-x-1/2"} ${
                i === frame ? "bg-ink text-ground" : "text-dim hover:text-ink"}`}
              style={{ left: `${xAt(i)}%` }}>
              <span className="hidden sm:inline">{fmtT(i * 60)}</span><span className="sm:hidden">{i === 0 ? "NOW" : `+${i}h`}</span>
            </button>
          ))}
          {frame > 0 && (
            <div className="pointer-events-none absolute bottom-0 top-0 border-l border-steel" style={{ left: `${xAt(frame)}%` }} />
          )}
        </div>
      </div>
    </div>
  );
}
