# UrbanFlood Nowcast — frontend

Next.js + React + TypeScript + Tailwind dashboard, with map rendering by MapLibre GL.

See the [root README](../README.md) for the project overview, setup, data provenance and limitations.

- `app/`: Next.js app entry (layout, global styles, page)
- `components/`: dashboard UI (map, timeline, control and intelligence panels, provenance, legend, search)
- `lib/`: API client, shared types, metrics, 15-minute series helpers, operational-mode guidance

Development: `npm ci`, then `npm run dev` (http://localhost:3000). The backend must run on :8000. `/api` requests are proxied by `next.config.ts`, and you can set `API_ORIGIN` to point elsewhere. `npm ci` also copies the MapLibre worker into `public/maplibre/`, which is git-ignored.
