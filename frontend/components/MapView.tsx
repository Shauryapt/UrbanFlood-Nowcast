"use client";
import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MLMap, MapMouseEvent } from "maplibre-gl";
import { api } from "@/lib/api";
import type { Alert, Meta, Nowcast, OverlayKey, RoadSegment, StaticGrid, StreetStatus, Surface, Theme } from "@/lib/types";
import { DEPTH_STOPS, ELEV_STOPS, MAP_PALETTE, RAIN_STOPS, UTIL_STEPS } from "@/lib/mapStyle";

maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs"); // served from public/ (see postinstall)

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const SURFACE_LAYER: Record<Exclude<Surface, "none">, string> = {
  risk: "risk-fill", depth: "depth-fill", rain: "rain-fill", elevation: "elev-fill", imperv: "imperv-fill",
};
const OVERLAY_LAYERS: Record<OverlayKey, string[]> = {
  alerts: ["alerts-ring"],
  stress: ["nodes-circle"],
  network: ["pipes-line"],
  roads: ["roads-major", "roads-minor"],
  waterways: ["waterways-line"],
  historical: ["hist-circle"],
  streets: ["streets-line", "streets-hit", "streets-selected"],
};

interface Props {
  meta: Meta;
  theme: Theme;
  nowcast: Nowcast | null;
  staticGrid: StaticGrid | null;
  frame: number;
  surface: Surface;
  overlays: Record<OverlayKey, boolean>;
  alerts: Alert[];
  selected: number | null;
  focus: { lon: number; lat: number; seq: number } | null;
  onSelect: (cell: number | null) => void;
  streetStatus: StreetStatus | null;
  selectedRoad: number | null;
  onSelectRoad: (road: RoadSegment) => void;
}

function cellPolygon(meta: Meta, cell: number): GeoJSON.Polygon {
  const { nx, dlat, dlon } = meta.grid;
  const r = Math.floor(cell / nx), c = cell % nx;
  const w = meta.bbox.west + c * dlon, n = meta.bbox.north - r * dlat;
  return { type: "Polygon", coordinates: [[[w, n], [w + dlon, n], [w + dlon, n - dlat], [w, n - dlat], [w, n]]] };
}

const ramp = (prop: string, stops: readonly number[], colors: readonly string[]) =>
  ["interpolate", ["linear"], ["get", prop], ...stops.flatMap((s, i) => [s, colors[i]])] as never;

export default function MapView(props: Props) {
  const { meta, theme, nowcast, staticGrid, frame, surface, overlays, alerts, selected, focus, onSelect, streetStatus, selectedRoad } = props;
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const camera = useRef<{ city: string; center: [number, number]; zoom: number } | null>(null);
  const geom = useRef<{ city: string; cells: Map<number, GeoJSON.Polygon> }>({ city: "", cells: new Map() });
  const streetsLoaded = useRef(false);          // street geometry is fetched on first use of the overlay
  const streetsApplied = useRef<unknown>(null);  // last (status, frame) written to feature-state
  const latest = useRef(props);
  latest.current = props;

  const applyData = () => {
    const m = map.current; const p = latest.current;
    if (!m || !ready.current || !p.nowcast) return;
    const f = p.nowcast.frames[p.frame];
    const st = p.staticGrid && p.staticGrid.cells.length === p.nowcast.cells.length ? p.staticGrid : null;
    const features: GeoJSON.Feature[] = p.nowcast.cells.map((cell, k) => {
      let g = geom.current.cells.get(cell);
      if (!g) { g = cellPolygon(p.meta, cell); geom.current.cells.set(cell, g); }
      return { type: "Feature", geometry: g, properties: {
        cell, cls: f.cls[k], rain: f.rain[k], depth: f.depth_cm[k],
        elev: st ? st.elev_m[k] : null, imperv: st ? st.imperv[k] : null } };
    });
    (m.getSource("grid") as GeoJSONSource).setData({ type: "FeatureCollection", features });
    f.node_util.forEach((u, id) => {
      m.setFeatureState({ source: "nodes", id }, { util: u });
      m.setFeatureState({ source: "pipes", id }, { util: u });
    });
    (m.getSource("alerts") as GeoJSONSource).setData({ type: "FeatureCollection", features: p.alerts.map((a) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [a.lon, a.lat] }, properties: { cell: a.cell, cls: a.cls } })) });
    applyStreets();
  };
  /** Street status per road segment for the current frame, via feature-state (geometry is never re-sent). */
  const applyStreets = () => {
    const m = map.current; const p = latest.current;
    if (!m || !ready.current || !p.overlays.streets) return;
    if (!streetsLoaded.current) {
      (m.getSource("streets") as GeoJSONSource).setData(api.streetsUrl(p.meta.id));
      streetsLoaded.current = true;
    }
    const f = p.streetStatus?.frames[p.frame];
    if (!f || streetsApplied.current === f) return;
    streetsApplied.current = f;
    for (let id = 0; id < f.status.length; id++) m.setFeatureState({ source: "streets", id }, { status: f.status[id] });
  };
  const applySelection = () => {
    const m = map.current; const p = latest.current;
    if (!m || !ready.current) return;
    (m.getSource("selected") as GeoJSONSource).setData(p.selected == null ? EMPTY : {
      type: "FeatureCollection", features: [{ type: "Feature", geometry: cellPolygon(p.meta, p.selected), properties: {} }] });
    m.setFilter("streets-selected", ["==", ["get", "id"], p.selectedRoad ?? -1]);
  };
  const applyVisibility = () => {
    const m = map.current; const p = latest.current;
    if (!m || !ready.current) return;
    for (const [s, id] of Object.entries(SURFACE_LAYER)) m.setLayoutProperty(id, "visibility", p.surface === s ? "visible" : "none");
    for (const [k, ids] of Object.entries(OVERLAY_LAYERS)) {
      for (const id of ids) m.setLayoutProperty(id, "visibility", p.overlays[k as OverlayKey] ? "visible" : "none");
    }
    applyStreets();
  };

  // (re)create the map per study area and theme; the camera is preserved across theme switches
  useEffect(() => {
    if (!box.current) return;
    ready.current = false;
    streetsLoaded.current = false; streetsApplied.current = null;
    const P = MAP_PALETTE[theme];
    if (geom.current.city !== meta.id) geom.current = { city: meta.id, cells: new Map() };
    const cam = camera.current?.city === meta.id ? camera.current : { center: meta.map.center, zoom: meta.map.zoom };
    const m = new maplibregl.Map({
      container: box.current, style: P.basemap, center: cam.center, zoom: cam.zoom,
      attributionControl: { compact: true },
      maxBounds: [[meta.bbox.west - 0.3, meta.bbox.south - 0.3], [meta.bbox.east + 0.3, meta.bbox.north + 0.3]],
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    m.on("moveend", () => { const c = m.getCenter(); camera.current = { city: meta.id, center: [c.lng, c.lat], zoom: m.getZoom() }; });

    m.once("style.load", () => {
      for (const l of m.getStyle().layers ?? []) {
        if (l.type === "symbol") m.setPaintProperty(l.id, "text-opacity", 0.6);
      }
      const src = (id: string, data: string | GeoJSON.FeatureCollection, promoteId?: string) =>
        m.addSource(id, { type: "geojson", data, ...(promoteId ? { promoteId } : {}) });
      src("grid", EMPTY);
      src("waterways", meta.layers.includes("waterways") ? api.layerUrl(meta.id, "waterways") : EMPTY);
      src("roads", meta.layers.includes("roads") ? api.layerUrl(meta.id, "roads") : EMPTY);
      src("pipes", api.layerUrl(meta.id, "drainage_pipes"), "id");
      src("nodes", api.layerUrl(meta.id, "drainage_nodes"), "id");
      src("hist", api.layerUrl(meta.id, "historical_spots"));
      src("streets", EMPTY, "id");
      src("alerts", EMPTY);
      src("selected", EMPTY);

      const fill = (id: string, paint: Record<string, unknown>, filter?: unknown) =>
        m.addLayer({ id, type: "fill", source: "grid", ...(filter ? { filter } : {}), paint: { "fill-antialias": false, ...paint } } as never);
      fill("elev-fill", { "fill-color": ramp("elev", ELEV_STOPS, P.elev), "fill-opacity": 0.72 }, ["!=", ["get", "elev"], null]);
      fill("imperv-fill", { "fill-color": ramp("imperv", [0, 0.5, 1], P.imperv), "fill-opacity": 0.72 }, ["!=", ["get", "imperv"], null]);
      fill("rain-fill", { "fill-color": ramp("rain", RAIN_STOPS, P.rain),
        "fill-opacity": ["interpolate", ["linear"], ["get", "rain"], 0, 0, 2, 0.4, 25, 0.62] });
      fill("depth-fill", { "fill-color": ramp("depth", DEPTH_STOPS, P.depth), "fill-opacity": 0.8 }, [">=", ["get", "depth"], DEPTH_STOPS[0]]);
      fill("risk-fill", { "fill-color": ["match", ["get", "cls"], 1, P.risk[1], 2, P.risk[2], 3, P.risk[3], "transparent"],
        "fill-opacity": ["match", ["get", "cls"], 1, 0.18, 2, 0.62, 3, 0.8, 0] }, [">=", ["get", "cls"], 1]);
      m.addLayer({ id: "grid-hit", type: "fill", source: "grid", paint: { "fill-opacity": 0 } });
      m.addLayer({ id: "waterways-line", type: "line", source: "waterways", paint: {
        "line-color": P.water, "line-width": ["match", ["get", "waterway"], "river", 1.6, "canal", 1.2, 0.8], "line-opacity": 0.85 } });
      m.addLayer({ id: "roads-minor", type: "line", source: "roads", filter: ["==", ["get", "highway"], "secondary"],
        minzoom: 11.5, paint: { "line-color": P.roadMinor, "line-width": 0.6, "line-opacity": 0.55 } });
      m.addLayer({ id: "roads-major", type: "line", source: "roads", filter: ["!=", ["get", "highway"], "secondary"],
        paint: { "line-color": P.road, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 1.8], "line-opacity": 0.65 } });
      m.addLayer({ id: "pipes-line", type: "line", source: "pipes", paint: {
        "line-color": P.pipe, "line-width": ["interpolate", ["linear"], ["get", "d_m"], 0.6, 0.5, 3, 1.6], "line-opacity": 0.55,
        "line-dasharray": [3, 1.5] } });
      // derived street flood status: CLEAR is kept faint so flooded segments stand out
      const st = ["coalesce", ["feature-state", "status"], -1];
      m.addLayer({ id: "streets-line", type: "line", source: "streets", layout: { "line-cap": "round" }, paint: {
        "line-color": ["match", st, 1, P.risk[1], 2, P.risk[2], 3, P.risk[3], P.nodeOk] as never,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, ["match", st, 3, 2.6, 2, 2.2, 1, 1.6, 0.6] as never,
          15, ["match", st, 3, 6, 2, 5, 1, 4, 1.4] as never],
        "line-opacity": ["match", st, -1, 0, 0, 0.35, 0.95] as never } });
      m.addLayer({ id: "streets-hit", type: "line", source: "streets", paint: { "line-width": 12, "line-opacity": 0 } });
      m.addLayer({ id: "streets-selected", type: "line", source: "streets", filter: ["==", ["get", "id"], -1],
        paint: { "line-color": P.select, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 7], "line-opacity": 0.9 } });
      const util = ["coalesce", ["feature-state", "util"], 0];
      m.addLayer({ id: "nodes-circle", type: "circle", source: "nodes", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 14, 4.5],
        "circle-color": ["step", util, P.nodeIdle, UTIL_STEPS[0], P.nodeOk, UTIL_STEPS[1], P.risk[1], UTIL_STEPS[2], P.risk[2], UTIL_STEPS[3], P.risk[3]] as never,
        "circle-stroke-width": ["case", ["==", ["get", "type"], "outfall"], 1, 0], "circle-stroke-color": P.outfallRing } });
      m.addLayer({ id: "hist-circle", type: "circle", source: "hist", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 14, 7], "circle-color": "transparent",
        "circle-stroke-width": 1.2, "circle-stroke-color": P.spot, "circle-stroke-opacity": 0.75 } });
      m.addLayer({ id: "alerts-ring", type: "circle", source: "alerts", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 11], "circle-color": "transparent",
        "circle-stroke-width": 2, "circle-stroke-color": ["match", ["get", "cls"], "Severe", P.risk[3], P.risk[2]] } });
      m.addLayer({ id: "selected-line", type: "line", source: "selected", paint: { "line-color": P.select, "line-width": 2 } });

      m.on("click", (e: MapMouseEvent) => {
        const ov = latest.current.overlays;
        const layers = ["grid-hit", ...(ov.streets ? ["streets-hit"] : []), ...(ov.alerts ? ["alerts-ring"] : [])];
        const hit = m.queryRenderedFeatures(e.point, { layers: layers.reverse() });
        const h = hit[0];
        if (h?.layer.id === "streets-hit") {
          const q = h.properties ?? {};
          latest.current.onSelectRoad({ id: Number(q.id), road_id: Number(q.road_id), name: q.name ?? null, highway: q.highway ?? null, cell: Number(q.cell) });
        } else latest.current.onSelect(h ? Number(h.properties?.cell) : null);
      });
      for (const l of ["alerts-ring", "risk-fill", "depth-fill", "streets-hit"]) {
        m.on("mouseenter", l, () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", l, () => (m.getCanvas().style.cursor = ""));
      }
      ready.current = true;
      applyData(); applySelection(); applyVisibility();
    });
    return () => { m.remove(); map.current = null; };
  }, [meta, theme]);

  useEffect(applyData, [nowcast, staticGrid, frame, alerts]);
  useEffect(applyStreets, [streetStatus, frame]);
  useEffect(applySelection, [selected, selectedRoad]);
  useEffect(applyVisibility, [surface, overlays]);
  useEffect(() => {
    if (focus && map.current) map.current.flyTo({ center: [focus.lon, focus.lat], zoom: Math.max(map.current.getZoom(), 14), duration: 600 });
  }, [focus]);

  return (
    <div className="absolute inset-0">
      <div ref={box} className="h-full w-full" aria-label={`Map of ${meta.name} study area`} />
    </div>
  );
}
