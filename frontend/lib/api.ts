import type { CellDetail, CityEntry, Meta, Nowcast, Params } from "./types";

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
  nowcast: (city: string, p: Params) => get<Nowcast>(`/api/cities/${city}/nowcast?${qs(p)}`),
  cell: (city: string, cell: number, p: Params) => get<CellDetail>(`/api/cities/${city}/cell/${cell}?${qs(p)}`),
};

export const RISK_COLORS = ["transparent", "#d4b24c", "#e07b39", "#c8313a"];
export const fmtLead = (m: number) => (m < 0 ? "—" : m === 0 ? "Now" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim());
export const fmtT = (m: number) => (m === 0 ? "NOW" : `+${m / 60} HR`);
