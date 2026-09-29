"use client";
import { fmtLead, fmtT, RISK_COLORS } from "@/lib/api";
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

function Reading({ label, value, unit, note }: { label: string; value: string | number; unit?: string; note?: string }) {
  return (
    <div className="border-t border-line py-1.5">
      <div className="text-[11px] text-dim">{label}</div>
      <div className="num text-[15px] leading-tight text-ink">{value}<span className="ml-0.5 text-[11px] text-dim">{unit}</span></div>
      {note && <div className="text-[10px] text-faint">{note}</div>}
    </div>
  );
}

function Overview({ meta, nowcast, frame }: { meta: Meta; nowcast: Nowcast | null; frame: number }) {
  const f = nowcast?.frames[frame];
  const total = f ? f.counts.reduce((a, b) => a + b, 0) : 0;
  const surcharged = f ? f.node_util.filter((u) => u > 1).length : 0;
  const km2 = (n: number) => ((n * meta.grid.cell_m * meta.grid.cell_m) / 1e6).toFixed(1);
  return (
    <div className="px-3 py-3">
      <h2 className="label text-ink/80">{meta.name} · {f ? fmtT(f.t_min) : "—"}</h2>
      <div className="mt-2 space-y-1">
        {[3, 2, 1].map((c) => (
          <div key={c} className="grid grid-cols-[60px_1fr_70px] items-center gap-2 text-[12px]">
            <span className="text-dim">{CLASSES[c]}</span>
            <div className="h-2 bg-raise"><div className="h-full" style={{ width: `${f && total ? (f.counts[c] / total) * 100 : 0}%`, background: RISK_COLORS[c] }} /></div>
            <span className="num text-right text-ink">{f ? km2(f.counts[c]) : "—"}<span className="text-[10px] text-dim"> km²</span></span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4">
        <Reading label="Drainage nodes surcharged" value={f ? surcharged : "—"} unit={f ? `/ ${f.node_util.length}` : ""} />
        <Reading label="Rainfall, area mean" value={f ? (f.rain.reduce((a, b) => a + b, 0) / f.rain.length).toFixed(1) : "—"} unit="mm/h" />
      </div>
      <p className="mt-4 text-[12px] leading-relaxed text-dim">Select a coloured cell or an alert to see its predicted depth, lead time and what is driving the risk.</p>
    </div>
  );
}

export default function IntelPanel({ meta, nowcast, frame, detail, loading, error, onClose }: Props) {
  if (!detail) {
    return (
      <div className="h-full">
        <Overview meta={meta} nowcast={nowcast} frame={frame} />
        {loading && <p className="px-3 text-[12px] text-dim">Loading location…</p>}
        {error && <p className="px-3 text-[12px] text-r1">{error}</p>}
      </div>
    );
  }
  const t = detail.timeline[frame];
  const ci = CLASSES.indexOf(t.cls);
  const top = t.contributions.filter((c) => c.points > 0.05).slice(0, 6);
  const maxPts = Math.max(...top.map((c) => c.points), 1);

  return (
    <div className={`scroll-thin h-full overflow-y-auto ${loading ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between border-b border-line px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="label text-ink/80">Selected location</h2>
          <div className="truncate text-[13px] text-ink">{detail.place ? `Near ${detail.place}` : `Cell ${detail.cell}`}</div>
          <div className="num text-[11px] text-faint">{detail.lat.toFixed(4)}° N, {detail.lon.toFixed(4)}° E · {meta.grid.cell_m} m cell</div>
        </div>
        <button onClick={onClose} className="label px-1 hover:text-ink" aria-label="Clear selection">Clear</button>
      </div>

      <div className="grid grid-cols-[1fr_auto] items-end border-b border-line px-3 py-2.5" style={{ boxShadow: `inset 3px 0 0 ${RISK_COLORS[ci] === "transparent" ? "#33424e" : RISK_COLORS[ci]}` }}>
        <div>
          <div className="text-[11px] text-dim">Risk level at {fmtT(t.t_min)}</div>
          <div className="font-cond text-[26px] font-semibold uppercase leading-none tracking-wide" style={{ color: ci ? RISK_COLORS[ci] : "var(--color-ink)" }}>{t.cls}</div>
        </div>
        <div className="num text-right text-[22px] leading-none text-ink">{Math.round(t.score)}<span className="text-[11px] text-dim"> /100</span></div>
      </div>

      <div className="grid grid-cols-4 border-b border-line">
        {detail.timeline.map((s, i) => (
          <div key={i} className={`border-r border-line px-1.5 py-1 last:border-r-0 ${i === frame ? "bg-raise" : ""}`}>
            <div className="num text-[10px] text-dim">{fmtT(s.t_min)}</div>
            <div className="h-1" style={{ background: RISK_COLORS[CLASSES.indexOf(s.cls)] === "transparent" ? "#24303a" : RISK_COLORS[CLASSES.indexOf(s.cls)] }} />
            <div className="num text-[11px] text-ink">{s.depth_cm} cm</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-x-4 px-3 pb-1 pt-1">
        <Reading label="Predicted depth" value={t.depth_cm} unit="cm" note="Prototype estimate" />
        <Reading label="Lead time to High" value={fmtLead(detail.lead_min)} note={detail.lead_min < 0 ? "Not reached in 3 h" : undefined} />
        <Reading label="Rainfall" value={t.rain_mmph} unit="mm/h" note={`${t.cum_mm} mm since event start${detail.static.july_clim_mm ? ` · July norm ${detail.static.july_clim_mm} mm` : ""}`} />
        <Reading label="Drainage utilisation" value={Math.round(t.util * 100)} unit="%" note={t.util > 1 ? "Surcharged" : undefined} />
        <Reading label="Drain blockage" value={detail.node.blockage_pct} unit="%" />
        <Reading label="Elevation" value={detail.static.elev_m} unit="m" note={`${detail.static.hand_m} m above drain node`} />
        <Reading label="Imperviousness" value={detail.static.imperv_pct} unit="%" />
        <Reading label="Nearest historical spot" value={detail.static.dist_hist_m >= 1000 ? (detail.static.dist_hist_m / 1000).toFixed(1) : detail.static.dist_hist_m} unit={detail.static.dist_hist_m >= 1000 ? "km" : "m"} />
      </div>

      <div className="border-t border-line px-3 py-2.5">
        <div className="mb-1.5 flex items-baseline justify-between">
          <h3 className="label text-ink/80">Contributing factors</h3>
          <span className="text-[10px] text-faint">risk points, sum = score</span>
        </div>
        <ul className="space-y-1">
          {top.map((c) => (
            <li key={c.key} className="grid grid-cols-[1fr_90px_32px] items-center gap-2 text-[12px]">
              <span className="truncate text-ink">{c.label}</span>
              <div className="h-1.5 bg-raise"><div className="h-full bg-steel" style={{ width: `${(c.points / maxPts) * 100}%` }} /></div>
              <span className="num text-right text-dim">{c.points.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      </div>

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
