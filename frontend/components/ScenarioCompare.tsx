"use client";
import { exactUtil, fmtLead, fmtT, fmtUtil, UTIL_CAP, UTIL_CAP_NOTE } from "@/lib/api";
import type { ScenarioMetrics } from "@/lib/metrics";

export interface Baseline { label: string; metrics: ScenarioMetrics }

const ROWS: { key: keyof ScenarioMetrics; label: string; fmt: (v: number) => string; worseIfHigher: boolean | null }[] = [
  { key: "highSevereCells", label: "High/Severe cells (peak)", fmt: (v) => String(v), worseIfHigher: true },
  { key: "peakHourMin", label: "Peak hour", fmt: (v) => fmtT(v), worseIfHigher: null },
  { key: "peakDepthCm", label: "Peak depth", fmt: (v) => `${v} cm`, worseIfHigher: true },
  { key: "surcharged", label: "Surcharged nodes (peak)", fmt: (v) => String(v), worseIfHigher: true },
  { key: "peakUtil", label: "Drain stress P95 (modelled)", fmt: (v) => `${fmtUtil(v)}%`, worseIfHigher: true },
  { key: "earliestLead", label: "Earliest High", fmt: (v) => fmtLead(v), worseIfHigher: null },
];

/** Compares a captured scenario with the current one using existing nowcast outputs only. */
export default function ScenarioCompare({ baseline, current, currentLabel, onCapture, onClear }: {
  baseline: Baseline | null; current: ScenarioMetrics | null; currentLabel: string;
  onCapture: () => void; onClear: () => void;
}) {
  return (
    <div className="mt-2.5 border-t border-line pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-dim">Compare scenario</span>
        <span className="flex gap-1">
          <button onClick={onCapture} disabled={!current}
            className="label border border-line-strong px-1.5 py-[1px] text-[10px] text-ink hover:border-steel disabled:opacity-40">
            {baseline ? "Recapture" : "Capture baseline"}
          </button>
          {baseline && <button onClick={onClear} className="label px-1 text-[10px] hover:text-ink">Clear</button>}
        </span>
      </div>
      {!baseline && <p className="mt-1 text-[11px] leading-snug text-faint">Capture the current scenario, then change rainfall, blockage or tide to compare the 0–3 h outcome.</p>}
      {baseline && current && (
        <table className="mt-1.5 w-full text-[11px]">
          <thead>
            <tr className="text-left text-faint">
              <th className="font-normal" />
              <th className="px-1 text-right font-normal" title={baseline.label}>Baseline</th>
              <th className="px-1 text-right font-normal" title={currentLabel}>Current</th>
            </tr>
          </thead>
          <tbody className="num">
            {ROWS.map((r) => {
              const b = baseline.metrics[r.key], c = current[r.key];
              const worse = r.worseIfHigher === null || b === c ? null : (c > b) === r.worseIfHigher;
              return (
                <tr key={r.key} className="border-t border-line/70">
                  <td className="py-[3px] font-sans text-dim">{r.label}</td>
                  <td className="whitespace-nowrap px-1 text-right text-dim" title={r.key === "peakUtil" ? `Exact ${exactUtil(b)}` : undefined}>{r.fmt(b)}</td>
                  <td className={`whitespace-nowrap px-1 text-right ${worse === null ? "text-ink" : worse ? "text-r2" : "text-real"}`}
                    title={r.key === "peakUtil" ? `Exact ${exactUtil(c)}` : undefined}>{r.fmt(c)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {baseline && <p className="mt-1 truncate text-[10px] text-faint" title={baseline.label}>Baseline: {baseline.label}</p>}
      {baseline && current && Math.max(baseline.metrics.peakUtil, current.peakUtil) > UTIL_CAP && (
        <p className="mt-0.5 text-[10px] leading-snug text-faint">
          Drain stress exact: baseline {exactUtil(baseline.metrics.peakUtil)}, current {exactUtil(current.peakUtil)}. {UTIL_CAP_NOTE}
        </p>
      )}
    </div>
  );
}
