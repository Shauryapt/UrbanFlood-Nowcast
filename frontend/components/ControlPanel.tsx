"use client";
import { fmtLead, fmtT, RISK_COLORS } from "@/lib/api";
import type { Alert, LayerKey, Meta, Params } from "@/lib/types";
import { CLASSES } from "@/lib/types";

const TIDE_LABEL: Record<string, string> = { low: "Low tide", rising: "Rising", high: "High tide" };

const LAYER_ROWS: { key: LayerKey; label: string; swatch: React.ReactNode }[] = [
  { key: "risk", label: "Flood risk", swatch: <span className="flex">{[1, 2, 3].map((c) => <i key={c} className="h-2.5 w-1.5" style={{ background: RISK_COLORS[c] }} />)}</span> },
  { key: "rain", label: "Rainfall", swatch: <i className="h-2.5 w-4 bg-gradient-to-r from-[#1c3a4d] to-[#6fb3d6]" /> },
  { key: "drainage", label: "Drainage stress", swatch: <i className="h-[2px] w-4 bg-r1" /> },
  { key: "roads", label: "Roads", swatch: <i className="h-[2px] w-4 bg-[#8795a1]" /> },
  { key: "waterways", label: "Waterways", swatch: <i className="h-[2px] w-4 bg-[#3e7394]" /> },
  { key: "historical", label: "Historical flooding spots", swatch: <i className="h-2.5 w-2.5 rounded-full border border-[#dfe6ea]" /> },
];

interface Props {
  meta: Meta;
  params: Params;
  setParams: (p: Partial<Params>) => void;
  liveError: string | null;
  layers: Record<LayerKey, boolean>;
  toggleLayer: (k: LayerKey) => void;
  alerts: { t_min: number; total: number; items: Alert[] } | null;
  selected: number | null;
  onSelect: (cell: number) => void;
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-3 py-2.5">
      <div className="mb-2 flex items-baseline justify-between"><h2 className="label text-ink/80">{title}</h2>{right}</div>
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

export default function ControlPanel({ meta, params, setParams, liveError, layers, toggleLayer, alerts, selected, onSelect }: Props) {
  const scen = meta.model.scenarios;
  return (
    <div className="flex h-full flex-col">
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
          <p className="mb-2.5 text-[11px] leading-snug text-dim">Hourly rainfall from Open-Meteo at the city centre: last 6 h and next 3 h (weather-model data), spread across the city by the CHIRPS July rainfall pattern.</p>
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
      </Section>

      <Section title="Layers">
        <ul className="space-y-1">
          {LAYER_ROWS.map((l) => (
            <li key={l.key}>
              <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                <input type="checkbox" checked={layers[l.key]} onChange={() => toggleLayer(l.key)} className="accent-[#7fa6bd]" />
                <span className="flex w-5 items-center justify-center">{l.swatch}</span>
                <span className={layers[l.key] ? "text-ink" : "text-faint"}>{l.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </Section>

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-baseline justify-between px-3 pb-1.5 pt-2.5">
          <h2 className="label text-ink/80">Alerts · {alerts ? fmtT(alerts.t_min) : "—"}</h2>
          <span className="num text-[11px] text-dim">{alerts ? `${alerts.total} zones` : ""}</span>
        </div>
        {alerts && alerts.total === 0 && <p className="px-3 text-[12px] text-dim">No drainage zone reaches High risk at this step.</p>}
        <ol className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {alerts?.items.map((a) => (
            <li key={a.cell}>
              <button onClick={() => onSelect(a.cell)}
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
