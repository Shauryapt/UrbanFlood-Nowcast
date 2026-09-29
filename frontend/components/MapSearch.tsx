"use client";
import { useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

interface Place { name: string; kind: string; lon: number; lat: number }

/** Builds a name index from the OSM road and waterway layers already served for the map. */
async function buildIndex(city: string): Promise<Place[]> {
  const out = new Map<string, Place & { n: number }>();
  for (const [layer, key] of [["roads", "highway"], ["waterways", "waterway"]] as const) {
    const fc: GeoJSON.FeatureCollection = await fetch(api.layerUrl(city, layer)).then((r) => (r.ok ? r.json() : { features: [] }));
    for (const f of fc.features) {
      const name = f.properties?.name as string | undefined;
      if (!name || f.geometry.type !== "LineString") continue;
      const c = f.geometry.coordinates;
      const prev = out.get(name);
      if (prev && prev.n >= c.length) continue;          // keep the longest segment as the anchor
      const [lon, lat] = c[Math.floor(c.length / 2)];
      out.set(name, { name, kind: String(f.properties?.[key] ?? layer), lon, lat, n: c.length });
    }
  }
  return [...out.values()].map(({ n: _n, ...p }) => p).sort((a, b) => a.name.localeCompare(b.name));
}

export default function MapSearch({ city, onPick }: { city: string; onPick: (p: Place) => void }) {
  const [index, setIndex] = useState<Place[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const loadedFor = useRef<string | null>(null);

  const ensure = () => {
    if (loadedFor.current === city) return;
    loadedFor.current = city; setStatus("loading");
    buildIndex(city).then((i) => { setIndex(i); setStatus("idle"); }).catch(() => { setStatus("error"); loadedFor.current = null; });
  };

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!index || t.length < 2) return [];
    const starts = index.filter((p) => p.name.toLowerCase().startsWith(t));
    const has = index.filter((p) => !p.name.toLowerCase().startsWith(t) && p.name.toLowerCase().includes(t));
    return [...starts, ...has].slice(0, 8);
  }, [q, index]);

  const pick = (p: Place) => { onPick(p); setQ(p.name); setOpen(false); };

  return (
    <div className="relative w-[260px] max-w-[calc(100vw-80px)]">
      <input value={q} placeholder="Search road or waterway"
        onFocus={() => { ensure(); setOpen(true); }} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setHi(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && results[hi]) pick(results[hi]);
          else if (e.key === "Escape") setOpen(false);
        }}
        aria-label="Search roads and waterways" role="combobox" aria-expanded={open && results.length > 0}
        className="w-full border border-line-strong bg-panel px-2 py-1 text-[12px] text-ink placeholder:text-faint" />
      {open && q.trim().length >= 2 && (
        <ul role="listbox" className="absolute left-0 right-0 top-full z-10 border border-t-0 border-line-strong bg-panel text-[12px]">
          {status === "loading" && <li className="px-2 py-1 text-dim">Loading place names…</li>}
          {status === "error" && <li className="px-2 py-1 text-r1">Place names unavailable.</li>}
          {status === "idle" && results.length === 0 && <li className="px-2 py-1 text-dim">No road or waterway named “{q.trim()}”.</li>}
          {results.map((p, i) => (
            <li key={p.name} role="option" aria-selected={i === hi}>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)} onMouseEnter={() => setHi(i)}
                className={`flex w-full justify-between gap-2 px-2 py-1 text-left ${i === hi ? "bg-raise" : ""}`}>
                <span className="truncate text-ink">{p.name}</span><span className="shrink-0 text-[11px] text-faint">{p.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
