"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import type { CellDetail, CityEntry, LayerKey, Meta, Nowcast, Params } from "@/lib/types";
import ControlPanel from "./ControlPanel";
import IntelPanel from "./IntelPanel";
import Timeline from "./Timeline";
import Provenance from "./Provenance";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

const DEFAULT_PARAMS: Params = { source: "scenario", preset: "heavy", multiplier: 1, blockage: 0, tide: "high" };
const DEFAULT_LAYERS: Record<LayerKey, boolean> = { risk: true, rain: false, drainage: true, roads: true, waterways: true, historical: true };

export default function Dashboard() {
  const [cities, setCities] = useState<CityEntry[]>([]);
  const [cityId, setCityId] = useState("mumbai");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [params, setParamsState] = useState<Params>(DEFAULT_PARAMS);
  const [nowcast, setNowcast] = useState<Nowcast | null>(null);
  const [frame, setFrame] = useState(0);
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<CellDetail | null>(null);
  const [detailState, setDetailState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [showProv, setShowProv] = useState(false);

  const setParams = useCallback((p: Partial<Params>) => {
    if (p.source === "live") setLiveError(null);
    setParamsState((cur) => ({ ...cur, ...p }));
  }, []);

  useEffect(() => { api.cities().then(setCities).catch((e) => setError(`Cannot reach the nowcast service: ${e.message}`)); }, []);

  useEffect(() => {
    setMeta(null); setNowcast(null); setSelected(null); setDetail(null);
    api.meta(cityId).then(setMeta).catch((e) => setError(`Study area failed to load: ${e.message}`));
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
          <span className="hidden text-[12px] text-dim lg:inline">Urban Flood Intelligence &amp; 0–3 Hour Nowcasting</span>
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
        <div className="flex items-center gap-4 text-[12px] lg:ml-auto">
          <span className="flex items-center gap-1.5">
            <span className="label">Data status</span>
            <span className={`num px-1.5 text-[11px] ${isLive ? "bg-real/20 text-real" : "bg-raise text-ink"}`}>{isLive ? "LIVE" : "DEMO"}</span>
          </span>
          <span className="hidden items-center gap-1.5 md:flex">
            <span className="label">Last update</span><span className="num text-ink">{updated}</span>
            {loading && <span className="text-[11px] text-dim">· updating</span>}
          </span>
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
              layers={layers} toggleLayer={(k) => setLayers((l) => ({ ...l, [k]: !l[k] }))}
              alerts={alerts} selected={selected} onSelect={setSelected} />
          )}
        </aside>

        <section className="order-1 flex min-h-[60vh] flex-col lg:order-2 lg:min-h-0">
          <div className="relative min-h-0 flex-1">
            {meta && <MapView meta={meta} nowcast={nowcast} frame={frame} layers={layers} alerts={alerts?.items ?? []}
              selected={selected} onSelect={setSelected} />}
            <div className="pointer-events-none absolute bottom-2 left-2 max-w-[70%] bg-ground/80 px-2 py-1 text-[11px] text-dim">
              Prototype — representative drainage network; environmental layers use public data.
            </div>
          </div>
          <div className="h-[128px] shrink-0">
            <Timeline nowcast={nowcast} frame={frame} onFrame={setFrame} designIntensity={meta?.drainage?.design_i_mmph ?? null} />
          </div>
        </section>

        <aside className="order-3 min-h-0 border-line bg-panel lg:border-l">
          {meta && <IntelPanel meta={meta} nowcast={nowcast} frame={frame} detail={detail}
            loading={detailState.loading} error={detailState.error} onClose={() => setSelected(null)} />}
        </aside>

        {showProv && meta && <Provenance meta={meta} onClose={() => setShowProv(false)} />}
      </main>
    </div>
  );
}
