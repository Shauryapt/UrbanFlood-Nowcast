"use client";
import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MLMap, MapMouseEvent } from "maplibre-gl";
import { api, RISK_COLORS } from "@/lib/api";
import type { Alert, LayerKey, Meta, Nowcast } from "@/lib/types";

maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs"); // served from public/ (see postinstall)

const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const LAYER_GROUPS: Record<LayerKey, string[]> = {
  rain: ["rain-fill"],
  risk: ["risk-fill"],
  waterways: ["waterways-line"],
  roads: ["roads-major", "roads-minor"],
  drainage: ["pipes-line", "nodes-circle"],
  historical: ["hist-circle"],
};

interface Props {
  meta: Meta;
  nowcast: Nowcast | null;
  frame: number;
  layers: Record<LayerKey, boolean>;
  alerts: Alert[];
  selected: number | null;
  onSelect: (cell: number | null) => void;
}

function cellPolygon(meta: Meta, cell: number): GeoJSON.Polygon {
  const { nx, dlat, dlon } = meta.grid;
  const r = Math.floor(cell / nx), c = cell % nx;
  const w = meta.bbox.west + c * dlon, n = meta.bbox.north - r * dlat;
  return { type: "Polygon", coordinates: [[[w, n], [w + dlon, n], [w + dlon, n - dlat], [w, n - dlat], [w, n]]] };
}

export default function MapView({ meta, nowcast, frame, layers, alerts, selected, onSelect }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const geom = useRef<Map<number, GeoJSON.Polygon>>(new Map());
  const pending = useRef<() => void>(() => {});
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // init map per study area
  useEffect(() => {
    if (!box.current) return;
    ready.current = false;
    const m = new maplibregl.Map({
      container: box.current, style: BASEMAP, center: meta.map.center, zoom: meta.map.zoom,
      attributionControl: { compact: true }, maxBounds: [[meta.bbox.west - 0.3, meta.bbox.south - 0.3], [meta.bbox.east + 0.3, meta.bbox.north + 0.3]],
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

    m.once("style.load", () => {
      // mute basemap: dim labels so data layers carry the contrast
      for (const l of m.getStyle().layers ?? []) {
        if (l.type === "symbol") m.setPaintProperty(l.id, "text-opacity", 0.55);
      }
      const src = (id: string, data: string | GeoJSON.FeatureCollection, promoteId?: string) =>
        m.addSource(id, { type: "geojson", data, ...(promoteId ? { promoteId } : {}) });
      src("grid", EMPTY);
      src("waterways", meta.layers.includes("waterways") ? api.layerUrl(meta.id, "waterways") : EMPTY);
      src("roads", meta.layers.includes("roads") ? api.layerUrl(meta.id, "roads") : EMPTY);
      src("pipes", api.layerUrl(meta.id, "drainage_pipes"), "id");
      src("nodes", api.layerUrl(meta.id, "drainage_nodes"), "id");
      src("hist", api.layerUrl(meta.id, "historical_spots"));
      src("alerts", EMPTY);
      src("selected", EMPTY);

      m.addLayer({ id: "rain-fill", type: "fill", source: "grid", paint: {
        "fill-color": ["interpolate", ["linear"], ["get", "rain"], 0, "#1c3a4d", 10, "#2b5f80", 25, "#3f86ad", 50, "#6fb3d6", 100, "#b9e0f2"],
        "fill-opacity": ["interpolate", ["linear"], ["get", "rain"], 0, 0, 2, 0.35, 25, 0.55], "fill-antialias": false } });
      m.addLayer({ id: "risk-fill", type: "fill", source: "grid", filter: [">=", ["get", "cls"], 1], paint: {
        "fill-color": ["match", ["get", "cls"], 1, RISK_COLORS[1], 2, RISK_COLORS[2], 3, RISK_COLORS[3], "transparent"],
        "fill-opacity": ["match", ["get", "cls"], 1, 0.16, 2, 0.62, 3, 0.8, 0], "fill-antialias": false } });
      m.addLayer({ id: "grid-hit", type: "fill", source: "grid", paint: { "fill-opacity": 0 } });
      m.addLayer({ id: "waterways-line", type: "line", source: "waterways", paint: {
        "line-color": "#3e7394", "line-width": ["match", ["get", "waterway"], "river", 1.6, "canal", 1.2, 0.8], "line-opacity": 0.85 } });
      m.addLayer({ id: "roads-minor", type: "line", source: "roads", filter: ["==", ["get", "highway"], "secondary"],
        minzoom: 11.5, paint: { "line-color": "#6c7a86", "line-width": 0.6, "line-opacity": 0.5 } });
      m.addLayer({ id: "roads-major", type: "line", source: "roads", filter: ["!=", ["get", "highway"], "secondary"],
        paint: { "line-color": "#8795a1", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 1.8], "line-opacity": 0.6 } });
      const util = ["coalesce", ["feature-state", "util"], 0];
      const utilColor = ["step", util, "#51616d", 0.8, "#9aa7b1", 1.0, RISK_COLORS[1], 1.5, RISK_COLORS[2], 3, RISK_COLORS[3]];
      m.addLayer({ id: "pipes-line", type: "line", source: "pipes", paint: {
        "line-color": utilColor as never, "line-width": ["interpolate", ["linear"], ["get", "d_m"], 0.6, 0.4, 3, 1.4], "line-opacity": 0.4 } });
      m.addLayer({ id: "nodes-circle", type: "circle", source: "nodes", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 14, 4.5],
        "circle-color": utilColor as never,
        "circle-stroke-width": ["case", ["==", ["get", "type"], "outfall"], 1, 0], "circle-stroke-color": "#c5d0d8" } });
      m.addLayer({ id: "hist-circle", type: "circle", source: "hist", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 14, 7], "circle-color": "transparent",
        "circle-stroke-width": 1.2, "circle-stroke-color": "#dfe6ea", "circle-stroke-opacity": 0.75 } });
      m.addLayer({ id: "alerts-ring", type: "circle", source: "alerts", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 11], "circle-color": "transparent",
        "circle-stroke-width": 2, "circle-stroke-color": ["match", ["get", "cls"], "Severe", RISK_COLORS[3], RISK_COLORS[2]] } });
      m.addLayer({ id: "selected-line", type: "line", source: "selected", paint: { "line-color": "#ffffff", "line-width": 2 } });

      m.on("click", (e: MapMouseEvent) => {
        const hit = m.queryRenderedFeatures(e.point, { layers: ["alerts-ring", "grid-hit"] });
        const f = hit[0];
        onSelectRef.current(f ? Number(f.properties?.cell) : null);
      });
      for (const l of ["alerts-ring", "risk-fill"]) {
        m.on("mouseenter", l, () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", l, () => (m.getCanvas().style.cursor = ""));
      }
      ready.current = true;
      pending.current();
    });
    return () => { m.remove(); map.current = null; geom.current.clear(); };
  }, [meta]);

  // push frame data
  useEffect(() => {
    const apply = () => {
      const m = map.current;
      if (!m || !ready.current || !nowcast) return;
      const f = nowcast.frames[frame];
      const features: GeoJSON.Feature[] = nowcast.cells.map((cell, k) => {
        let g = geom.current.get(cell);
        if (!g) { g = cellPolygon(meta, cell); geom.current.set(cell, g); }
        return { type: "Feature", geometry: g, properties: { cell, cls: f.cls[k], rain: f.rain[k] } };
      });
      (m.getSource("grid") as GeoJSONSource).setData({ type: "FeatureCollection", features });
      f.node_util.forEach((u, id) => {
        m.setFeatureState({ source: "nodes", id }, { util: u });
        m.setFeatureState({ source: "pipes", id }, { util: u });
      });
      (m.getSource("alerts") as GeoJSONSource).setData({ type: "FeatureCollection", features: alerts.map((a) => ({
        type: "Feature", geometry: { type: "Point", coordinates: [a.lon, a.lat] }, properties: { cell: a.cell, cls: a.cls } })) });
    };
    pending.current = apply;
    apply();
  }, [nowcast, frame, alerts, meta]);

  // selection outline
  useEffect(() => {
    const m = map.current;
    const apply = () => {
      if (!m || !ready.current) return;
      (m.getSource("selected") as GeoJSONSource).setData(selected == null ? EMPTY : {
        type: "FeatureCollection", features: [{ type: "Feature", geometry: cellPolygon(meta, selected), properties: {} }] });
    };
    if (ready.current) apply(); else m?.once("style.load", apply);
  }, [selected, meta]);

  // layer visibility
  useEffect(() => {
    const m = map.current;
    const apply = () => {
      if (!m || !ready.current) return;
      for (const [k, ids] of Object.entries(LAYER_GROUPS)) {
        for (const id of ids) m.setLayoutProperty(id, "visibility", layers[k as LayerKey] ? "visible" : "none");
      }
    };
    if (ready.current) apply(); else m?.once("style.load", apply);
  }, [layers]);

  return (
    <div className="absolute inset-0">
      <div ref={box} className="h-full w-full" aria-label={`Map of ${meta.name} study area`} />
    </div>
  );
}
