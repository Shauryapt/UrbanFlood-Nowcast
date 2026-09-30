export type RiskClass = "Low" | "Moderate" | "High" | "Severe";
export const CLASSES: RiskClass[] = ["Low", "Moderate", "High", "Severe"];
export type DataClass = "REAL" | "REPRESENTATIVE" | "SIMULATED";

export interface CityEntry {
  id: string;
  name: string;
  region: string;
  status: "ready" | "planned";
  bbox?: Bbox;
  map?: { center: [number, number]; zoom: number };
}
export interface Bbox { west: number; south: number; east: number; north: number }

export interface ProvenanceItem { layer: string; cls: DataClass; source: string; detail: string; url: string | null }

export interface Meta {
  id: string;
  name: string;
  region: string;
  timezone: string;
  bbox: Bbox;
  map: { center: [number, number]; zoom: number };
  coastal: boolean;
  drainage?: { design_i_mmph: number; note: string };
  grid: { nx: number; ny: number; dlat: number; dlon: number; cell_m: number };
  layers: string[];
  model: {
    factors: { key: string; label: string; weight: number }[];
    scenarios: Record<string, { label: string; hourly: number[] }>;
    tides: string[];
    depth_thresholds_m: number[];
    score_thresholds: number[];
  };
  provenance: ProvenanceItem[];
}

export interface Frame {
  t_min: number;
  score: number[];
  cls: number[];
  depth_cm: number[];
  rain: number[];
  node_util: number[];
  tide: number;
  counts: number[];
}

export interface Alert {
  cell: number; node: number; lon: number; lat: number; cls: RiskClass; score: number;
  depth_cm: number; lead_min: number; util: number; place: string | null;
}

export interface Nowcast {
  city: string;
  cells: number[];
  frames: Frame[];
  lead_min: number[];
  node_blockage: number[];
  rain_hourly: number[];
  rain_hours: number[];
  alerts: { t_min: number; total: number; items: Alert[] }[];
  source: "scenario" | "live";
  status: "LIVE" | "DEMO";
  generated: string;
  live?: { hourly: number[]; times: string[]; fetched: string };
}

export interface CellDetail {
  cell: number; lon: number; lat: number; lead_min: number; place: string | null;
  static: { elev_m: number; slope_deg: number; imperv_pct: number; curve_number: number; hand_m: number;
            dist_hist_m: number; dist_waterway_m: number | null; july_clim_mm: number | null };
  node: { id: number; type: string; capacity_m3s: number; pipe_d_m: number; barrels: number;
          blockage_pct: number; acc_area_km2: number };
  timeline: {
    t_min: number; score: number; cls: RiskClass; depth_cm: number; rain_mmph: number; cum_mm: number;
    util: number; surcharge_m3: number; tide: number;
    contributions: { key: string; label: string; points: number }[];
  }[];
}

export interface Params {
  source: "scenario" | "live";
  preset: string;
  multiplier: number;
  blockage: number;
  tide: string;
}

/** One thematic grid surface is shown at a time; overlays are independent. */
export type Surface = "risk" | "depth" | "rain" | "elevation" | "imperv" | "none";
export type OverlayKey = "alerts" | "stress" | "network" | "roads" | "waterways" | "historical" | "streets";
export type Theme = "dark" | "light";

/** Static per-cell inputs already used by the model (same cell order as Nowcast.cells). */
export interface StaticGrid { cells: number[]; elev_m: number[]; imperv: number[] }

/** Street flood status, DERIVED from the 300 m model grid: the depth class of the cell a road segment lies in. */
export const STREET_STATUSES = ["CLEAR", "CAUTION", "HIGH RISK", "ROAD CLOSURE RISK"] as const;
export type StreetStatusName = (typeof STREET_STATUSES)[number];
/** A clicked road segment (static properties from the streets layer). */
export interface RoadSegment { id: number; road_id: number; name: string | null; highway: string | null; cell: number }

export interface AlertSet { t_min: number; total: number; items: Alert[] }

/** /nowcast/timeline: the model's native 15-min frames (T+0..T+3 h) from the same run as /nowcast. */
export interface TimelineFrame {
  t_min: number; cls: number[]; depth_cm: number[]; depth_cls: number[]; node_util: number[]; tide: number;
  counts: number[]; high_severe: number; rain_mmph: number;
}
export interface NowcastTimeline {
  city: string;
  cells: number[];
  rain_pattern: number[];
  frames: TimelineFrame[];
  lead_min: number[];
  alerts: AlertSet[];
  resolution: { model_dt_min: number; frames: number; rain_input: string; live_cache_s: number; note: string };
  source: "scenario" | "live";
  status: "LIVE" | "DEMO";
  generated: string;
}

/** One forecast step as shown by the map, summary and timeline: a 15-min model frame, or an hourly
 *  /nowcast frame when the timeline is unavailable (then depth_cls, and so street status, is absent). */
export interface SeriesFrame {
  t_min: number; cls: number[]; depth_cm: number[]; rain: number[]; node_util: number[]; tide: number; counts: number[];
  depth_cls?: number[];
}
export interface Series { stepMin: number; cells: number[]; frames: SeriesFrame[]; alerts: AlertSet[]; lead_min: number[] }
