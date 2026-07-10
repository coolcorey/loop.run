# loop.run

Plan closed-loop runs from where you are, train toward a goal, and run with live coach nudges.

**Stack:** Vue 3 Composition API · Vite · Pinia · MapLibre · Hono API · xAI Grok · OSRM/ORS routing · PWA-ready

## Quick start

```bash
cd ~/Desktop/code/loop.run
cp .env.example .env
# Add XAI_API_KEY=... from https://console.x.ai/

npm install
npm run dev
```

- Web (desktop): https://localhost:9090 (dev uses a self-signed cert)  
- Web (phone on LAN): use the **https://192.168.…** URL Vite prints — accept the cert warning  
- API: http://127.0.0.1:8787 (`/api/health`)

`npm run dev` starts **both** Vite and the API (Vite proxies `/api` → `:8787`).

**GPS note:** browsers block geolocation on plain `http://` except localhost. Testing on a phone via `http://192.168.x.x` will fail location — use **https://**.

## Environment

| Variable | Where | Purpose |
|----------|--------|---------|
| `XAI_API_KEY` | server `.env` | Grok for plans, route notes, coach nudges |
| `XAI_MODEL` | server | default `grok-4.3` |
| `ORS_API_KEY` | server | optional OpenRouteService (better than public OSRM) |
| `VITE_AI_PROVIDER` | client | `xai` (default) or `mock` |
| `VITE_MAP_STYLE` | client | MapLibre style URL (default OpenFreeMap **dark**) |

**Never** put `XAI_API_KEY` in a `VITE_*` variable — it would ship to the browser.

Without `XAI_API_KEY`, road routing still works; AI features fall back to mock.

## Features (now)

| Area | Behavior |
|------|----------|
| **Maps** | MapLibre + free OSM-style tiles (OpenFreeMap) |
| **Routing** | Closed road loop via OSRM foot (or ORS if keyed) |
| **xAI** | Route summary/notes, training plans, in-run nudges |
| **Voice** | Free browser TTS for coach + turns (Settings) |
| **Guest mode** | Plans/runs in localStorage |
| **Turn cues** | Close announce distance (default 40m, configurable) |

Voice upgrade path (cloud TTS, costs): see **[docs/VOICE.md](docs/VOICE.md)**.  
AI ideas & roadmap: **[docs/AI_IDEAS.md](docs/AI_IDEAS.md)**.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | API + web |
| `npm run dev:web` | Vite only |
| `npm run dev:api` | Hono API only |
| `npm run build` | Production frontend build |

## Project layout

```
src/
  components/RouteMap.vue   MapLibre path + user
  services/ai/              mock + remote (xAI via API)
  services/api.ts           fetch helper
  views/                    Plan, Run, Plans, …
server/
  index.ts                  Hono routes
  routing.ts                loop planner (OSRM/ORS)
  xai.ts                    Grok chat completions
```

## API

- `GET  /api/health`
- `POST /api/route/loop` — road-snapped loop + optional xAI title/notes
- `POST /api/ai/training-plan`
- `POST /api/ai/coach-nudge`
