"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { api, fmtT } from "@/lib/api";
import { describeScenario, scenarioMetrics } from "@/lib/metrics";
import type { CellDetail, CityEntry, Meta, Nowcast, OverlayKey, Params, RoadSegment, StaticGrid, StreetStatus, Surface, Theme } from "@/lib/types";
import ControlPanel from "./ControlPanel";
import IntelPanel from "./IntelPanel";
import Timeline from "./Timeline";
import Provenance from "./Provenance";
import MapLegend from "./MapLegend";
import MapSearch from "./MapSearch";
import type { Baseline } from "./ScenarioCompare";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

const DEFAULT_PARAMS: Params = { source: "scenario", preset: "heavy", multiplier: 1, blockage: 0, tide: "high" };
const DEFAULT_OVERLAYS: Record<OverlayKey, boolean> = { alerts: true, stress: true, network: false, roads: true, waterways: true, historical: true, streets: false };
const THEME_KEY = "ufn-theme";

export default function Dashboard() {
  const [cities, setCities] = useState<CityEntry[]>([]);
  const [cityId, setCityId] = useState("mumbai");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [staticGrid, setStaticGrid] = useState<StaticGrid | null>(null);
  const [params, setParamsState] = useState<Params>(DEFAULT_PARAMS);
  const [nowcast, setNowcast] = useState<Nowcast | null>(null);
  const [frame, setFrame] = useState(0);
  const [surface, setSurface] = useState<Surface>("risk");
  const [overlays, setOverlays] = useState(DEFAULT_OVERLAYS);
  const [selected, setSelected] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ lon: number; lat: number; seq: number } | null>(null);
  const [detail, setDetail] = useState<CellDetail | null>(null);
  const [detailState, setDetailState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [showProv, setShowProv] = useState(false);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);   // null until the stored theme is read
  const [streetStatus, setStreetStatus] = useState<StreetStatus | null>(null);
  const [selectedRoad, setSelectedRoad] = useState<RoadSegment | null>(null);

  // theme: read what the pre-paint script applied; persist changes
  useEffect(() => { setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark"); }, []);
  const toggleTheme = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    if (next === "light") document.documentElement.dataset.theme = "light"; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    setTheme(next);
  };

  const setParams = useCallback((p: Partial<Params>) => {
    if (p.source === "live") setLiveError(null);
    setParamsState((cur) => ({ ...cur, ...p }));
  }, []);

  useEffect(() => { api.cities().then(setCities).catch((e) => setError(`Cannot reach the nowcast service: ${e.message}`)); }, []);

  useEffect(() => {
    setMeta(null); setNowcast(null); setStaticGrid(null); setSelected(null); setDetail(null); setBaseline(null);
    setStreetStatus(null); setSelectedRoad(null);
    api.meta(cityId).then(setMeta).catch((e) => setError(`Study area failed to load: ${e.message}`));
    api.staticGrid(cityId).then(setStaticGrid).catch(() => setStaticGrid(null));   // elevation/imperviousness layers only
  }, [cityId]);

  // nowcast (debounced for slider drags)
  useEffect(() => {
    if (!meta) return;
    let stale = false;
    const t = setTimeout(() => {
      setLoading(true);
      api.nowcast(meta.id, params)
        .then((n) => { if (!stale) { setNowcast(n); setError(null); } })
        .catch((e) => {
          if (stale) return;
          if (params.source === "live") { setLiveError(e.message); setParamsState((c) => ({ ...c, source: "scenario" })); }
          else setError(`Nowcast failed: ${e.message}`);
        })
        .finally(() => !stale && setLoading(false));
    }, 220);
    return () => { stale = true; clearTimeout(t); };
  }, [meta, params]);

  // derived street flood status: fetched only while the overlay (or a selected road) needs it
  const needStreets = overlays.streets || selectedRoad != null;
  useEffect(() => {
    if (!meta || !needStreets) return;
    let stale = false;
    const t = setTimeout(() => {
      api.streetStatus(meta.id, params)
        .then((s) => { if (!stale) setStreetStatus(s); })
        .catch((e) => { if (!stale) setError(`Street flood status failed: ${e.message}`); });
    }, 220);
    return () => { stale = true; clearTimeout(t); };
  }, [meta, params, needStreets]);

  const selectCell = useCallback((cell: number | null) => { setSelected(cell); setSelectedRoad(null); }, []);
  const selectRoad = useCallback((r: RoadSegment) => { setSelectedRoad(r); setSelected(null); }, []);

  // selected cell detail follows scenario changes
  useEffect(() => {
    if (!meta || selected == null || !nowcast) { setDetail(null); return; }
    let stale = false;
    setDetailState({ loading: true, error: null });
    api.cell(meta.id, selected, params)
      .then((d) => { if (!stale) { setDetail(d); setDetailState({ loading: false, error: null }); } })
      .catch((e) => { if (!stale) { setDetail(null); setDetailState({ loading: false, error: e.message.includes("not modelled") ? "That location is water or outside the modelled area." : e.message }); } });
    return () => { stale = true; };
  }, [meta, selected, nowcast]);

  // search: centre the map and select the nearest modelled cell
  const pickPlace = useCallback((p: { lon: number; lat: number }) => {
    setFocus((f) => ({ lon: p.lon, lat: p.lat, seq: (f?.seq ?? 0) + 1 }));
    if (!meta || !nowcast) return;
    const { nx, dlat, dlon } = meta.grid;
    const kx = Math.cos((p.lat * Math.PI) / 180);
    let best = -1, bd = Infinity;
    for (const cell of nowcast.cells) {
      const lon = meta.bbox.west + ((cell % nx) + 0.5) * dlon, lat = meta.bbox.north - (Math.floor(cell / nx) + 0.5) * dlat;
      const d = ((lon - p.lon) * kx) ** 2 + (lat - p.lat) ** 2;
      if (d < bd) { bd = d; best = cell; }
    }
    if (best >= 0 && Math.sqrt(bd) * 111_000 < 1_000) selectCell(best);
  }, [meta, nowcast, selectCell]);

  const current = useMemo(() => (nowcast ? scenarioMetrics(nowcast) : null), [nowcast]);
  const currentLabel = meta ? describeScenario(params, meta.model.scenarios[params.preset]?.label) : "";
  const alerts = nowcast?.alerts[frame] ?? null;
  const updated = useMemo(() => {
    if (!nowcast || !meta) return "—";
    const d = new Date(nowcast.generated);
    return d.toLocaleString("en-IN", { timeZone: meta.timezone, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short", hour12: false });
  }, [nowcast, meta]);
  const isLive = nowcast?.status === "LIVE";

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-line bg-panel px-3 py-2 lg:h-12 lg:flex-nowrap lg:py-0">
        <div className="flex items-baseline gap-3 whitespace-nowrap">
          <h1 className="font-cond text-[17px] font-bold tracking-wide text-ink">UrbanFlood Nowcast</h1>
          <span className="hidden text-[12px] text-dim xl:inline">Urban Flood Intelligence &amp; 0–3 Hour Nowcasting</span>
        </div>
        <label className="flex items-center gap-2">
          <span className="label">Study area</span>
          <select value={cityId} onChange={(e) => setCityId(e.target.value)}
            className="border border-line-strong bg-ground px-2 py-0.5 text-[13px] text-ink">
            {(cities.length ? cities : [{ id: "mumbai", name: "Mumbai", status: "ready" } as CityEntry]).map((c) => (
              <option key={c.id} value={c.id} disabled={c.status !== "ready"}>{c.name}{c.status !== "ready" ? " — not configured" : ""}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] lg:ml-auto">
          <span className="flex items-center gap-1.5">
            <span className="label">Data status</span>
            <span className={`num px-1.5 text-[11px] ${isLive ? "bg-real/20 text-real" : "bg-raise text-ink"}`}>{isLive ? "LIVE" : "DEMO"}</span>
          </span>
          <span className="hidden items-center gap-1.5 md:flex">
            <span className="label">Last update</span><span className="num text-ink">{updated}</span>
            {loading && <span className="text-[11px] text-dim">· updating</span>}
          </span>
          <button onClick={toggleTheme} disabled={!theme} aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            className="label border border-line-strong px-2 py-0.5 text-ink hover:border-steel">
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>
          <button onClick={() => setShowProv(true)} className="label border border-line-strong px-2 py-0.5 text-ink hover:border-steel" disabled={!meta}>
            Data provenance
          </button>
        </div>
      </header>

      {error && <div className="border-b border-r3/50 bg-r3/10 px-3 py-1 text-[12px] text-ink">{error}</div>}

      <main className="relative flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[272px_1fr_340px]">
        <aside className="order-2 min-h-0 border-line bg-panel lg:order-1 lg:border-r">
          {meta && (
            <ControlPanel meta={meta} params={params} setParams={setParams} liveError={liveError}
              surface={surface} setSurface={setSurface}
              overlays={overlays} toggleOverlay={(k) => setOverlays((o) => ({ ...o, [k]: !o[k] }))}
              alerts={alerts} selected={selected} onSelectAlert={selectCell}
              baseline={baseline} current={current} currentLabel={currentLabel}
              onCapture={() => current && setBaseline({ label: currentLabel, metrics: current })}
              onClearBaseline={() => setBaseline(null)} />
          )}
        </aside>

        <section className="order-1 flex min-h-[60vh] flex-col lg:order-2 lg:min-h-0">
          <div className="relative min-h-0 flex-1">
            {meta && theme && <MapView meta={meta} theme={theme} nowcast={nowcast} staticGrid={staticGrid} frame={frame}
              surface={surface} overlays={overlays} alerts={alerts?.items ?? []}
              selected={selected} focus={focus} onSelect={selectCell}
              streetStatus={streetStatus} selectedRoad={selectedRoad?.id ?? null} onSelectRoad={selectRoad} />}
            {meta && <div className="absolute left-2 top-2 z-10"><MapSearch city={meta.id} onPick={pickPlace} /></div>}
            <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[70%] flex-col items-start gap-1.5">
              {theme && <MapLegend theme={theme} surface={surface} overlays={overlays} frameLabel={fmtT((nowcast?.frames[frame]?.t_min) ?? 0)} />}
              <div className="bg-ground/80 px-2 py-1 text-[11px] text-dim">
                Prototype — representative drainage network; environmental layers use public data.
              </div>
            </div>
          </div>
          <div className="h-[128px] shrink-0">
            <Timeline nowcast={nowcast} frame={frame} onFrame={setFrame} designIntensity={meta?.drainage?.design_i_mmph ?? null} />
          </div>
        </section>

        <aside className="order-3 min-h-0 border-line bg-panel lg:border-l">
          {meta && <IntelPanel meta={meta} nowcast={nowcast} frame={frame} detail={detail}
            loading={detailState.loading} error={detailState.error} onClose={() => selectCell(null)}
            road={selectedRoad} streetStatus={streetStatus} onSelectCell={selectCell} />}
        </aside>

        {showProv && meta && <Provenance meta={meta} onClose={() => setShowProv(false)} />}
      </main>
    </div>
  );
}
