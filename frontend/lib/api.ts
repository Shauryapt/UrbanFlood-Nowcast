import type { CellDetail, CityEntry, Meta, Nowcast, Params, StaticGrid, StreetStatus } from "./types";

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) {
    let msg = `${r.status}`;
    try { msg = (await r.json()).detail ?? msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

const qs = (p: Params) =>
  new URLSearchParams({ source: p.source, preset: p.preset, multiplier: String(p.multiplier),
    blockage: String(p.blockage), tide: p.tide }).toString();

export const api = {
  cities: () => get<CityEntry[]>("/api/cities"),
  meta: (city: string) => get<Meta>(`/api/cities/${city}/meta`),
  layerUrl: (city: string, name: string) => `/api/cities/${city}/layers/${name}`,
  staticGrid: (city: string) => get<StaticGrid>(`/api/cities/${city}/static`),
  nowcast: (city: string, p: Params) => get<Nowcast>(`/api/cities/${city}/nowcast?${qs(p)}`),
  cell: (city: string, cell: number, p: Params) => get<CellDetail>(`/api/cities/${city}/cell/${cell}?${qs(p)}`),
  /** Road-segment geometry for the derived street layer (loaded once; values are applied from streetStatus). */
  streetsUrl: (city: string) => `/api/cities/${city}/streets`,
  streetStatus: (city: string, p: Params) => get<StreetStatus>(`/api/cities/${city}/streets/status?${qs(p)}`),
};

/** Risk colours for DOM elements (theme-aware CSS variables). Map paint uses MapView's palette. */
export const RISK_COLORS = ["transparent", "var(--r1)", "var(--r2)", "var(--r3)"];
export const fmtLead = (m: number) => (m < 0 ? "—" : m === 0 ? "Now" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim());
/** Modelled node utilisation as %. Display is capped above 10x capacity; the exact value is always shown alongside. */
export const UTIL_CAP = 10;
export const fmtUtil = (u: number) => (u > UTIL_CAP ? "> 1000" : String(Math.round(u * 100)));
export const exactUtil = (u: number) => `${Math.round(u * 100).toLocaleString("en-IN")}%`;
export const UTIL_CAP_NOTE =
  "Modelled stress on the representative drainage network. Values above 1000% arise from its simplified backwater-throttling " +
  "representation (a surcharged downstream node throttles upstream capacity), not from measured flows.";
export const fmtT = (m: number) => (m === 0 ? "NOW" : `+${m / 60} HR`);
