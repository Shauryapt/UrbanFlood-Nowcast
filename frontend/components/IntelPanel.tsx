"use client";
import { exactUtil, fmtLead, fmtT, fmtUtil, RISK_COLORS, UTIL_CAP, UTIL_CAP_NOTE } from "@/lib/api";
import { frameSummary, rainContext } from "@/lib/metrics";
import type { CellDetail, Meta, Nowcast } from "@/lib/types";
import { CLASSES } from "@/lib/types";
import { DataTag } from "./Provenance";

interface Props {
  meta: Meta;
  nowcast: Nowcast | null;
  frame: number;
  detail: CellDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

function Reading({ label, value, unit, note, tone, title }: { label: string; value: string | number; unit?: string; note?: string; tone?: string; title?: string }) {
  return (
    <div className="border-t border-line py-1.5" title={title}>
      <div className="text-[11px] text-dim">{label}</div>
      <div className="num text-[15px] leading-tight" style={{ color: tone ?? "var(--ink)" }}>{value}<span className="ml-0.5 text-[11px] text-dim">{unit}</span></div>
      {note && <div className="text-[10px] text-faint">{note}</div>}
    </div>
  );
}

const km2 = (meta: Meta, cells: number) => ((cells * meta.grid.cell_m * meta.grid.cell_m) / 1e6).toFixed(1);

function RainfallContext({ nowcast }: { nowcast: Nowcast }) {
  const r = rainContext(nowcast);
  const live = nowcast.source === "live";
  const fetched = nowcast.live?.fetched ? new Date(nowcast.live.fetched).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }) : null;
  return (
    <section className="border-t border-line px-3 py-2.5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="label text-ink/80">Rainfall context</h3>
        <span className={`num px-1.5 text-[10px] ${live ? "bg-real/20 text-real" : "bg-raise text-dim"}`}>{live ? "LIVE · FORECAST MODEL" : "DEMO · DESIGN STORM"}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        <Reading label="Last hour" value={r.lastHour.toFixed(1)} unit="mm/h" />
        <Reading label="Past 6 h (antecedent)" value={r.past6h.toFixed(0)} unit="mm" />
        <Reading label="Next 3 h forecast" value={r.next3h.toFixed(0)} unit="mm" />
        <Reading label="Next 3 h peak" value={r.nextPeak.toFixed(1)} unit="mm/h" note={`hour starting ${fmtT(r.nextPeakHour * 60)}`} />
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-faint">
        {live ? `Open-Meteo hourly precipitation at the city centre${fetched ? `, fetched ${fetched}` : ""}. Weather-model output, not radar or gauge.` : "Scenario hyetograph (city mean)."}
        {" "}Values include the rainfall multiplier. Temperature, humidity, wind and cloud cover are not in the current data feed.
      </p>
    </section>
  );
}

function Overview({ meta, nowcast, frame }: { meta: Meta; nowcast: Nowcast | null; frame: number }) {
  if (!nowcast) return <div className="px-3 py-3 text-[12px] text-dim">Loading nowcast…</div>;
  const f = nowcast.frames[frame];
  const s = frameSummary(nowcast, frame);
  const total = f.counts.reduce((a, b) => a + b, 0);
  return (
    <div>
      <div className="px-3 pt-3">
        <h2 className="label text-ink/80">{meta.name} · operational summary · {fmtT(f.t_min)}</h2>
        <div className="mt-1 grid grid-cols-2 gap-x-4">
          <Reading label="High/Severe zones" value={s.zones} note={`${km2(meta, s.highSevereCells)} km² of cells`} tone={s.zones ? "var(--r2)" : undefined} />
          <Reading label="Surcharged drain nodes" value={s.surcharged} unit={`/ ${s.nodes}`} note="Representative network" />
          <Reading label="Max predicted depth" value={s.maxDepthCm} unit="cm" note="Prototype estimate" />
          <Reading label="Earliest alert lead" value={fmtLead(s.earliestLead)} note={s.earliestLead < 0 ? "No High within 3 h" : "First cell reaching High"} />
          <Reading label="Peak forecast hour" value={fmtT(nowcast.frames[s.peakFrame].t_min)} note={`${s.peakCells} cells High/Severe`} />
          <Reading label="Current rainfall" value={s.rainMean.toFixed(1)} unit="mm/h" note="Area mean at this step" />
          <Reading label="Peak drainage stress (modelled)" value={fmtUtil(s.peakUtil)} unit="%" title={UTIL_CAP_NOTE}
            note={s.peakUtil > UTIL_CAP ? `P95 of nodes; exact ${exactUtil(s.peakUtil)}*` : "95th percentile of representative nodes"} />
        </div>
        {s.peakUtil > UTIL_CAP && <p className="border-t border-line py-1.5 text-[10px] leading-snug text-faint">* {UTIL_CAP_NOTE}</p>}
      </div>
      <div className="space-y-1 px-3 pb-2.5 pt-2">
        {[3, 2, 1].map((c) => (
          <div key={c} className="grid grid-cols-[60px_1fr_70px] items-center gap-2 text-[12px]">
            <span className="text-dim">{CLASSES[c]}</span>
            <div className="h-2 bg-raise"><div className="h-full" style={{ width: `${total ? (f.counts[c] / total) * 100 : 0}%`, background: RISK_COLORS[c] }} /></div>
            <span className="num text-right text-ink">{km2(meta, f.counts[c])}<span className="text-[10px] text-dim"> km²</span></span>
          </div>
        ))}
      </div>
      <RainfallContext nowcast={nowcast} />
      <p className="border-t border-line px-3 py-2.5 text-[12px] leading-relaxed text-dim">Select a coloured cell, an alert or a searched road to see predicted depth, lead time and why the area is at risk.</p>
    </div>
  );
}

// Factor contributions grouped for the explanation. Keys come from the model's factor list.
const GROUPS: { label: string; keys: string[] }[] = [
  { label: "Predicted ponding", keys: ["depth"] },
  { label: "Drainage stress", keys: ["drain_util", "blockage"] },
  { label: "Rainfall intensity", keys: ["rain_int"] },
  { label: "Antecedent rainfall", keys: ["rain_cum"] },
  { label: "Terrain & micro-topography", keys: ["low_elev", "depression", "flat"] },
  { label: "Imperviousness", keys: ["imperv"] },
  { label: "Historical flooding nearby", keys: ["hist"] },
];
const SHADES = [100, 80, 64, 50, 38, 28, 20];

function WhyAtRisk({ t }: { t: CellDetail["timeline"][number] }) {
  const pts = Object.fromEntries(t.contributions.map((c) => [c.key, c.points]));
  const groups = GROUPS.map((g, i) => ({ ...g, points: g.keys.reduce((a, k) => a + (pts[k] ?? 0), 0), shade: SHADES[i] }))
    .sort((a, b) => b.points - a.points);
  const [a, b] = groups;
  return (
    <section className="border-t border-line px-3 py-2.5">
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="label text-ink/80">Why this area is at risk</h3>
        <span className="num text-[10px] text-faint">{fmtT(t.t_min)} · score {Math.round(t.score)}</span>
      </div>
      <p className="mb-2 text-[12px] leading-snug text-ink">
        {t.score < 1 ? "No factor is contributing at this step." :
          <>{a.label} ({a.points.toFixed(1)}) and {b.label.toLowerCase()} ({b.points.toFixed(1)}) contribute most to this cell’s score of {Math.round(t.score)}.</>}
      </p>
      <div className="mb-1.5 flex h-2.5 bg-raise" aria-hidden>
        {groups.filter((g) => g.points > 0).map((g) => (
          <i key={g.label} style={{ width: `${g.points}%`, background: `color-mix(in srgb, var(--steel) ${g.shade}%, transparent)` }} />
        ))}
      </div>
      <ul className="space-y-0.5">
        {groups.map((g) => (
          <li key={g.label} className={`grid grid-cols-[10px_1fr_auto] items-center gap-2 text-[12px] ${g.points < 0.05 ? "text-faint" : "text-ink"}`}>
            <i className="h-2 w-2" style={{ background: `color-mix(in srgb, var(--steel) ${g.shade}%, transparent)` }} />
            <span className="truncate">{g.label}</span>
            <span className="num text-dim">{g.points.toFixed(1)}</span>
          </li>
        ))}
      </ul>
      <details className="mt-1.5 text-[11px]">
        <summary className="cursor-pointer text-dim hover:text-ink">All {t.contributions.length} factors</summary>
        <ul className="mt-1 space-y-0.5">
          {t.contributions.map((c) => (
            <li key={c.key} className="flex justify-between text-dim"><span>{c.label}</span><span className="num">{c.points.toFixed(1)}</span></li>
          ))}
        </ul>
      </details>
      <p className="mt-1.5 text-[10px] leading-snug text-faint">Points = factor weight × normalised input, summing to the score. They show what the model weighs, not measured causes.</p>
    </section>
  );
}

export default function IntelPanel({ meta, nowcast, frame, detail, loading, error, onClose }: Props) {
  if (!detail) {
    return (
      <div className="h-full lg:overflow-y-auto scroll-thin">
        {loading && <p className="border-b border-line px-3 py-1.5 text-[12px] text-dim">Loading location…</p>}
        {error && <p className="border-b border-line px-3 py-1.5 text-[12px] text-r1">{error}</p>}
        <Overview meta={meta} nowcast={nowcast} frame={frame} />
      </div>
    );
  }
  const t = detail.timeline[frame];
  const ci = CLASSES.indexOf(t.cls);
  const peak = detail.timeline.reduce((p, s) => (s.score > p.score ? s : p), detail.timeline[0]);
  const peakCi = CLASSES.indexOf(peak.cls);
  const isAlert = ci >= 2;   // High/Severe at this step = alert zone (same rule as the alert list)

  return (
    <div className={`scroll-thin h-full lg:overflow-y-auto ${loading ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between border-b border-line px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="label text-ink/80">{isAlert ? "Alert detail" : "Selected location"}</h2>
          <div className="truncate text-[13px] text-ink">{detail.place ? `Near ${detail.place}` : `Cell ${detail.cell}`}</div>
          <div className="num text-[11px] text-faint">{detail.lat.toFixed(4)}° N, {detail.lon.toFixed(4)}° E · {meta.grid.cell_m} m cell · node {detail.node.id}</div>
        </div>
        <button onClick={onClose} className="label px-1 hover:text-ink" aria-label="Clear selection">Clear</button>
      </div>

      {isAlert && (
        <div className="grid grid-cols-4 border-b border-line text-[11px]" style={{ boxShadow: `inset 3px 0 0 ${RISK_COLORS[ci]}` }}>
          {[
            ["Severity", t.cls, RISK_COLORS[ci]],
            ["Peak hour", fmtT(peak.t_min), undefined],
            ["Lead time", fmtLead(detail.lead_min), undefined],
            ["Peak depth", `${peak.depth_cm} cm`, undefined],
          ].map(([k, v, c]) => (
            <div key={k} className="border-r border-line px-2 py-1.5 last:border-r-0">
              <div className="text-dim">{k}</div>
              <div className="num text-[13px]" style={{ color: c ?? "var(--ink)" }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[1fr_auto] items-end border-b border-line px-3 py-2.5" style={{ boxShadow: `inset 3px 0 0 ${ci ? RISK_COLORS[ci] : "var(--line-strong)"}` }}>
        <div>
          <div className="text-[11px] text-dim">Risk level at {fmtT(t.t_min)}</div>
          <div className="font-cond text-[26px] font-semibold uppercase leading-none tracking-wide" style={{ color: ci ? RISK_COLORS[ci] : "var(--ink)" }}>{t.cls}</div>
        </div>
        <div className="num text-right text-[22px] leading-none text-ink">{Math.round(t.score)}<span className="text-[11px] text-dim"> /100</span></div>
      </div>

      <div className="grid grid-cols-4 border-b border-line">
        {detail.timeline.map((s, i) => {
          const c = CLASSES.indexOf(s.cls);
          return (
            <div key={i} className={`border-r border-line px-1.5 py-1 last:border-r-0 ${i === frame ? "bg-raise" : ""}`}>
              <div className="num text-[10px] text-dim">{fmtT(s.t_min)}</div>
              <div className="h-1" style={{ background: c ? RISK_COLORS[c] : "var(--line)" }} />
              <div className="num text-[11px] text-ink">{s.depth_cm} cm</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-x-4 px-3 pb-1 pt-1">
        <Reading label="Predicted depth" value={t.depth_cm} unit="cm" note="Prototype estimate" />
        <Reading label="Lead time to High" value={fmtLead(detail.lead_min)} note={detail.lead_min < 0 ? "Not reached in 3 h" : undefined} />
        <Reading label="Peak forecast" value={fmtT(peak.t_min)} note={`${peak.cls}, ${peak.depth_cm} cm`} tone={peakCi ? RISK_COLORS[peakCi] : undefined} />
        <Reading label="Rainfall" value={t.rain_mmph} unit="mm/h" note={`${t.cum_mm} mm since event start${detail.static.july_clim_mm ? ` · July norm ${detail.static.july_clim_mm} mm` : ""}`} />
        <Reading label="Drainage utilisation (modelled)" value={fmtUtil(t.util)} unit="%" title={UTIL_CAP_NOTE}
          note={t.util > UTIL_CAP ? `Exact ${exactUtil(t.util)}; backwater-throttled node (simplified)` : t.util > 1 ? "Surcharged (representative node)" : "Representative node"} />
        <Reading label="Drain blockage" value={detail.node.blockage_pct} unit="%" />
        <Reading label="Elevation" value={detail.static.elev_m} unit="m" note={`${detail.static.hand_m} m above drain node`} />
        <Reading label="Imperviousness" value={detail.static.imperv_pct} unit="%" />
        <Reading label="Nearest historical spot" value={detail.static.dist_hist_m >= 1000 ? (detail.static.dist_hist_m / 1000).toFixed(1) : detail.static.dist_hist_m} unit={detail.static.dist_hist_m >= 1000 ? "km" : "m"} />
      </div>

      <WhyAtRisk t={t} />

      <div className="border-t border-line px-3 py-2.5">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="label text-ink/80">Drainage node {detail.node.id}</h3>
          <DataTag cls="REPRESENTATIVE" />
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-y-0.5 text-[12px]">
          <dt className="text-dim">Conduit</dt><dd className="num text-ink">{detail.node.barrels > 1 ? `${detail.node.barrels} × ` : ""}Ø {detail.node.pipe_d_m} m</dd>
          <dt className="text-dim">Full-flow capacity</dt><dd className="num text-ink">{detail.node.capacity_m3s.toFixed(1)} m³/s</dd>
          <dt className="text-dim">Contributing area</dt><dd className="num text-ink">{detail.node.acc_area_km2} km²</dd>
          <dt className="text-dim">Surcharge volume</dt><dd className="num text-ink">{t.surcharge_m3.toLocaleString()} m³</dd>
        </dl>
      </div>
    </div>
  );
}
