"use client";
import { fmtLead, fmtT, RISK_COLORS } from "@/lib/api";
import type { ScenarioMetrics } from "@/lib/metrics";
import type { Alert, Meta, OverlayKey, Params, Surface } from "@/lib/types";
import { CLASSES } from "@/lib/types";
import ScenarioCompare, { type Baseline } from "./ScenarioCompare";

const TIDE_LABEL: Record<string, string> = { low: "Low tide", rising: "Rising", high: "High tide" };

const SURFACES: { key: Surface; label: string }[] = [
  { key: "risk", label: "Flood risk" },
  { key: "depth", label: "Predicted depth" },
  { key: "rain", label: "Rainfall" },
  { key: "elevation", label: "Elevation" },
  { key: "imperv", label: "Imperviousness" },
  { key: "none", label: "None" },
];
const OVERLAYS: { key: OverlayKey; label: string }[] = [
  { key: "alerts", label: "Alerts" },
  { key: "stress", label: "Drainage stress" },
  { key: "network", label: "Drainage network" },
  { key: "roads", label: "Roads" },
  { key: "waterways", label: "Waterways" },
  { key: "historical", label: "Historical flood spots" },
  { key: "streets", label: "Street flood status" },
];

interface Props {
  meta: Meta;
  params: Params;
  setParams: (p: Partial<Params>) => void;
  liveError: string | null;
  surface: Surface;
  setSurface: (s: Surface) => void;
  overlays: Record<OverlayKey, boolean>;
  toggleOverlay: (k: OverlayKey) => void;
  alerts: { t_min: number; total: number; items: Alert[] } | null;
  selected: number | null;
  onSelectAlert: (cell: number) => void;
  baseline: Baseline | null;
  current: ScenarioMetrics | null;
  currentLabel: string;
  onCapture: () => void;
  onClearBaseline: () => void;
  autoRefresh: boolean;
  setAutoRefresh: (v: boolean) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-2.5">
      <h2 className="label mb-2 text-ink/80">{title}</h2>
      {children}
    </section>
  );
}

function Slider({ label, value, display, min, max, step, onChange }: {
  label: string; value: number; display: string; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <label className="mb-2 block">
      <span className="flex justify-between text-[12px] text-dim"><span>{label}</span><span className="num text-ink">{display}</span></span>
      <input type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export default function ControlPanel(p: Props) {
  const { meta, params, setParams, liveError, alerts, selected } = p;
  const scen = meta.model.scenarios;
  return (
    <div className="flex h-full flex-col scroll-thin lg:overflow-y-auto">
      <Section title="Scenario">
        <div className="mb-2 grid grid-cols-2 border border-line-strong text-[12px]" role="radiogroup" aria-label="Rainfall source">
          {(["live", "scenario"] as const).map((s) => (
            <button key={s} role="radio" aria-checked={params.source === s} onClick={() => setParams({ source: s })}
              className={`py-1 ${params.source === s ? "bg-raise text-ink" : "text-dim hover:text-ink"}`}>
              {s === "live" ? "Observed / Forecast" : "Design storm"}
            </button>
          ))}
        </div>
        {liveError && <p className="mb-2 text-[11px] leading-snug text-r1">Live rainfall unavailable ({liveError}). Showing design storm.</p>}
        {params.source === "scenario" ? (
          <select value={params.preset} onChange={(e) => setParams({ preset: e.target.value })}
            className="mb-2.5 w-full border border-line-strong bg-ground px-2 py-1 text-[12px] text-ink" aria-label="Design storm">
            {Object.entries(scen).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        ) : (
          <>
            <p className="mb-1.5 text-[11px] leading-snug text-dim">Hourly rainfall from Open-Meteo at the city centre: last 6 h and next 3 h (weather-model data), spread across the city by the CHIRPS July rainfall pattern.</p>
            <label className="mb-2.5 flex cursor-pointer items-center gap-1.5 text-[12px]">
              <input type="checkbox" checked={p.autoRefresh} onChange={(e) => p.setAutoRefresh(e.target.checked)} />
              <span className={p.autoRefresh ? "text-ink" : "text-dim"}>Auto-refresh</span>
              <span className="text-[11px] text-faint">· Live update cycle: 10 min</span>
            </label>
          </>
        )}
        <Slider label="Rainfall multiplier" value={params.multiplier} display={`× ${params.multiplier.toFixed(2)}`}
          min={0.25} max={3} step={0.25} onChange={(v) => setParams({ multiplier: v })} />
        <Slider label="Added drain blockage" value={params.blockage} display={`+${Math.round(params.blockage * 100)}%`}
          min={0} max={0.6} step={0.05} onChange={(v) => setParams({ blockage: v })} />
        {meta.coastal && (
          <div>
            <span className="text-[12px] text-dim">Tide at outfalls, at NOW</span>
            <div className="mt-1 grid grid-cols-3 border border-line-strong text-[12px]" role="radiogroup" aria-label="Tide condition">
              {meta.model.tides.map((t) => (
                <button key={t} role="radio" aria-checked={params.tide === t} onClick={() => setParams({ tide: t })}
                  className={`py-1 ${params.tide === t ? "bg-raise text-ink" : "text-dim hover:text-ink"}`}>{TIDE_LABEL[t] ?? t}</button>
              ))}
            </div>
          </div>
        )}
        <ScenarioCompare baseline={p.baseline} current={p.current} currentLabel={p.currentLabel}
          onCapture={p.onCapture} onClear={p.onClearBaseline} />
      </Section>

      <Section title="Map layers">
        <div className="grid grid-cols-[auto_1fr] gap-x-4">
          <fieldset>
            <legend className="mb-1 text-[11px] text-faint">Surface</legend>
            {SURFACES.map((s) => (
              <label key={s.key} className="flex cursor-pointer items-center gap-1.5 py-[1px] text-[12px]">
                <input type="radio" name="surface" checked={p.surface === s.key} onChange={() => p.setSurface(s.key)} />
                <span className={p.surface === s.key ? "text-ink" : "text-dim"}>{s.label}</span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-[11px] text-faint">Overlays</legend>
            {OVERLAYS.map((o) => (
              <label key={o.key} className="flex cursor-pointer items-center gap-1.5 py-[1px] text-[12px]">
                <input type="checkbox" checked={p.overlays[o.key]} onChange={() => p.toggleOverlay(o.key)} />
                <span className={p.overlays[o.key] ? "text-ink" : "text-dim"}>{o.label}</span>
              </label>
            ))}
          </fieldset>
        </div>
      </Section>

      <section className="flex min-h-[220px] flex-1 flex-col">
        <div className="flex items-baseline justify-between px-3 pb-1.5 pt-2.5">
          <h2 className="label text-ink/80">Alerts · {alerts ? fmtT(alerts.t_min) : "—"}</h2>
          <span className="num text-[11px] text-dim">{alerts ? `${alerts.total} zones` : ""}</span>
        </div>
        {alerts && alerts.total === 0 && <p className="px-3 text-[12px] text-dim">No drainage zone reaches High risk at this step.</p>}
        <ol className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {alerts?.items.map((a) => (
            <li key={a.cell}>
              <button onClick={() => p.onSelectAlert(a.cell)}
                className={`grid w-full grid-cols-[4px_1fr_auto] gap-x-2 border-t border-line px-3 py-1.5 text-left hover:bg-raise ${selected === a.cell ? "bg-raise" : ""}`}>
                <i className="row-span-2 h-full" style={{ background: RISK_COLORS[CLASSES.indexOf(a.cls)] }} />
                <span className="truncate text-[12px] text-ink">{a.place ? `Near ${a.place}` : `Zone ${a.node}`}</span>
                <span className="num text-[11px] text-ink">{a.depth_cm} cm</span>
                <span className="text-[11px] text-dim">{a.cls} · risk {a.score}</span>
                <span className="num text-[11px] text-dim">{a.lead_min === 0 ? "High at NOW" : `lead ${fmtLead(a.lead_min)}`}</span>
              </button>
            </li>
          ))}
        </ol>
        {alerts && alerts.total > alerts.items.length && (
          <p className="border-t border-line px-3 py-1 text-[11px] text-faint">Top {alerts.items.length} of {alerts.total} by severity</p>
        )}
      </section>
    </div>
  );
}
