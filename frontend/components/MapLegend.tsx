"use client";
import { DEPTH_STOPS, ELEV_STOPS, MAP_PALETTE, RAIN_STOPS } from "@/lib/mapStyle";
import { STREET_STATUSES } from "@/lib/types";
import type { OverlayKey, Surface, Theme } from "@/lib/types";

function Ramp({ colors, labels, unit }: { colors: readonly string[]; labels: (string | number)[]; unit: string }) {
  return (
    <div>
      <div className="flex h-2">{colors.map((c, i) => <i key={i} className="flex-1" style={{ background: c }} />)}</div>
      <div className="num mt-0.5 flex justify-between text-[10px] text-dim">
        {labels.map((l, i) => <span key={i}>{l}</span>)}<span className="text-faint">{unit}</span>
      </div>
    </div>
  );
}

const TITLE: Record<Exclude<Surface, "none">, string> = {
  risk: "Flood risk class", depth: "Predicted ponding depth", rain: "Rainfall intensity",
  elevation: "Elevation (SRTM)", imperv: "Imperviousness (WorldCover)",
};

/** Compact legend for the active surface and the symbolised overlays. */
export default function MapLegend({ theme, surface, overlays, frameLabel }: {
  theme: Theme; surface: Surface; overlays: Record<OverlayKey, boolean>; frameLabel: string;
}) {
  const P = MAP_PALETTE[theme];
  const rows: React.ReactNode[] = [];
  if (overlays.alerts) rows.push(<Row key="a"><i className="h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: P.risk[3] }} />Alert: High / Severe zone</Row>);
  if (overlays.stress) rows.push(
    <Row key="s"><span className="flex gap-0.5">{[P.nodeOk, P.risk[1], P.risk[2], P.risk[3]].map((c) => <i key={c} className="h-2 w-2 rounded-full" style={{ background: c }} />)}</span>
      Modelled node load &lt;100 · 100 · 150 · 300%+</Row>);
  if (overlays.network) rows.push(<Row key="n"><i className="h-0 w-4 border-t border-dashed" style={{ borderColor: P.pipe }} />Drainage network (representative)</Row>);
  if (overlays.streets) rows.push(
    <div key="st" className="py-0.5">
      <div className="text-dim">Street flood status · derived from 300 m model grid</div>
      <div className="mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
        {STREET_STATUSES.map((st, i) => (
          <span key={st} className="flex items-center gap-1 text-[10px] text-dim">
            <i className="h-[3px] w-3" style={{ background: i ? P.risk[i] : P.nodeOk, opacity: i ? 1 : 0.5 }} />{st}
          </span>))}
      </div>
    </div>);
  if (overlays.historical) rows.push(<Row key="h"><i className="h-2.5 w-2.5 rounded-full border" style={{ borderColor: P.spot }} />Historical flooding spot</Row>);

  if (surface === "none" && !rows.length) return null;   // (overlay rows are hidden on phones to keep the map visible)
  return (
    <div className="pointer-events-none w-[176px] border sm:w-[216px] border-line bg-panel/92 px-2 py-1.5 text-[11px] text-ink">
      {surface !== "none" && (
        <div className="mb-1">
          <div className="mb-1 flex justify-between"><span className="label text-[10px] text-ink/80">{TITLE[surface]}</span>
            {["risk", "depth", "rain"].includes(surface) && <span className="num text-[10px] text-dim">{frameLabel}</span>}</div>
          {surface === "risk" && (
            <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
              {["Moderate", "High", "Severe"].map((c, i) => (
                <span key={c} className="flex items-center gap-1"><i className="h-2 w-2.5" style={{ background: P.risk[i + 1] }} />{c}</span>))}
            </div>
          )}
          {surface === "depth" && <Ramp colors={P.depth} labels={DEPTH_STOPS} unit="cm" />}
          {surface === "rain" && <Ramp colors={P.rain} labels={RAIN_STOPS} unit="mm/h" />}
          {surface === "elevation" && <Ramp colors={P.elev} labels={ELEV_STOPS} unit="m" />}
          {surface === "imperv" && <Ramp colors={P.imperv} labels={[0, 50, 100]} unit="%" />}
        </div>
      )}
      {rows.length > 0 && <div className={`hidden space-y-0.5 sm:block ${surface !== "none" ? "border-t border-line pt-1" : ""}`}>{rows}</div>}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1.5 text-dim">{children}</div>;
}
