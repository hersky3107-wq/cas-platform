# Jeju Tourist MCP Server

A standalone **Model Context Protocol (MCP)** tool server for the **Kakao PlayMCP** contest (Agentic Player). It exposes Jeju (제주도) tourism tools that an LLM agent can call.

It is a **pure tool server**: it runs **no LLM**. Every tool is a thin proxy that fetches an existing deployed Next.js API route (server-to-server) and returns the JSON as MCP tool content. Weather is fetched directly from Open-Meteo (no existing route).

- **Transport:** Streamable HTTP (single endpoint), **stateless** mode. SSE/stdio are not used.
- **MCP endpoint:** `POST /mcp`
- **Health check:** `GET /health` → `200`
- Binds `0.0.0.0` and reads `PORT` from env (cloud/container friendly).

## Tools

| Tool | Proxies | Purpose |
|------|---------|---------|
| `plan_jeju_course` | `POST /api/jeju/tourist-course` (start + poll ~40s) | AI travel course; starts an async job, waits up to ~40s. Returns finished courses, or a `jobId` + "preparing" message to check via `check_jeju_course` |
| `check_jeju_course` | `GET /api/jeju/tourist-course?jobId=` | Retrieve a started course by `jobId` (ready → courses; not yet → "still preparing") |
| `find_hidden_spots` | `POST /api/jeju/tourist-local` | Hidden local gems for a query |
| `get_jeju_seasonal` | `POST /api/jeju/tourist-seasonal` | What's special in Jeju right now |
| `get_jeju_festivals` | `POST /api/jeju/tourist-festivals` | Current festivals & events |
| `get_jeju_trending` | `POST /api/jeju/tourist-featured` | Trending / featured places |
| `get_rainy_day_spots` | `POST /api/jeju/tourist` (indoor query) | Rainy-day / indoor spots (museums, aquariums, galleries) |
| `get_jeju_islands` | `POST /api/jeju/tourist-ferry` | Ferry island day-trips (우도/가파도/마라도/추자도/비양도) |
| `get_olle_trails` | `GET /api/jeju/tourist-olle` | Jeju Olle walking trail courses |
| `get_oreum_hallasan` | `GET /api/jeju/tourist-oreum` | Oreum (volcanic cones) & Hallasan-area trails |
| `find_nearby_bus_stops` | `POST /api/jeju/bus/nearby` | Bus stops near a coordinate |
| `get_bus_arrivals` | `POST /api/jeju/bus/arrivals` | Real-time arrivals at a stop (by `nodeId`) |
| `search_bus_route` | `POST /api/jeju/bus/route` | Bus route by number → ordered stops |
| `get_exchange_rates` | `GET /api/jeju/exchange` | KRW rates (USD/CNY/JPY/EUR/HKD/TWD) |
| `get_jeju_weather` | Open-Meteo (direct) | 3–7 day forecast for 5 Jeju regions |

> **Not exposed:** the "외국인 대행 서비스 / Coming Soon" panel is a non-functional vision/policy-proposal display and is intentionally **not** an MCP tool. Only real, working features are exposed.

Tools that accept `locale` support `ko | en | ja | zh-TW | zh-CN` (default `ko`).

## Environment variables

| Var | Required | Default | Description |
|-----|----------|---------|-------------|
| `APP_BASE_URL` | Yes (in practice) | `https://www.aimani.ai` | Origin of the deployed Next.js app whose `/api/jeju/*` routes are proxied. No trailing slash needed. |
| `PORT` | No | `3000` | Port to listen on. Kakao Cloud injects this. |
| `HOST` | No | `0.0.0.0` | Bind address. Keep `0.0.0.0` for containers. |

## Local development

```bash
cd mcp-server
npm install

# Point at a deployed app (or a local Next.js dev server)
export APP_BASE_URL=https://www.aimani.ai   # PowerShell: $env:APP_BASE_URL="https://www.aimani.ai"

# Dev (auto-reload)
npm run dev

# Or build + run
npm run build
npm start
```

### Verify

```bash
# Health check
curl http://localhost:3000/health
# → {"status":"ok",...}

# List tools over MCP (Streamable HTTP, JSON response)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# Call a tool
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_exchange_rates","arguments":{}}}'
```

> The `Accept` header must include both `application/json` and `text/event-stream` — the Streamable HTTP transport requires it.

## Docker

```bash
cd mcp-server

# Build
docker build -t jeju-mcp-server .

# Run (map port, provide APP_BASE_URL)
docker run --rm -p 3000:3000 \
  -e APP_BASE_URL=https://www.aimani.ai \
  jeju-mcp-server

# Health
curl http://localhost:3000/health
```

## Deploying to Kakao PlayMCP (Kakao Cloud)

- Deploy this `mcp-server/` folder via Git source or the built container image.
- Kakao Cloud provides `PORT`; the server binds `0.0.0.0` automatically.
- Set `APP_BASE_URL` to your deployed app origin.
- Register the MCP endpoint as `https://<your-host>/mcp`.
- Health check path: `/health`.

## Notes

- **No auth:** the proxied `/api/jeju/*` routes currently require no auth, so the server calls them directly. There is no rate limiting here — add one at the gateway if needed before public exposure.
- **Robustness:** every tool wraps fetch with a ~15s timeout (course polling longer) and never throws; upstream errors (including HTTP 200 with `{ ok: false }`) are returned as clear error content.
- **Stateless:** a fresh MCP server + transport is created per request, so replicas scale horizontally without sticky sessions.
