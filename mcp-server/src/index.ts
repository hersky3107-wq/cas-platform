/**
 * Jeju Tourist MCP server — Kakao PlayMCP (Agentic Player) entry point.
 *
 * Transport: Streamable HTTP (single endpoint /mcp), STATELESS mode
 * (sessionIdGenerator: undefined). A fresh McpServer + transport is created per
 * request so any container replica can serve any request — no sticky sessions,
 * safe for horizontal scaling, and it avoids cross-client state leakage.
 *
 * Also exposes GET /health (200) for the Kakao Cloud health check.
 *
 * This is a PURE TOOL server: it runs no LLM. Every tool proxies an existing
 * deployed Next.js API route (APP_BASE_URL) server-to-server.
 */

import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { APP_BASE_URL, HOST, PORT, SERVER_NAME, SERVER_VERSION } from './config.js';
import { registerTools } from './tools.js';

function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server);
  return server;
}

const DUAL_ACCEPT = 'application/json, text/event-stream';

/**
 * Guarantee the request carries an Accept header listing BOTH application/json
 * and text/event-stream, as the Streamable HTTP transport requires. The SDK
 * (via Hono) reads req.rawHeaders to build its web Request, so we patch both
 * rawHeaders (the array of key,value,key,value…) and the parsed headers object.
 */
function ensureDualAccept(req: Request): void {
  req.headers.accept = DUAL_ACCEPT;
  const raw = req.rawHeaders;
  if (Array.isArray(raw)) {
    let patched = false;
    for (let i = 0; i < raw.length - 1; i += 2) {
      if (typeof raw[i] === 'string' && raw[i].toLowerCase() === 'accept') {
        raw[i + 1] = DUAL_ACCEPT;
        patched = true;
      }
    }
    if (!patched) raw.push('Accept', DUAL_ACCEPT);
  }
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// ── Health check (Kakao Cloud) ────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', server: SERVER_NAME, version: SERVER_VERSION });
});

// Root convenience page (not part of MCP; helps humans verify the deploy).
app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    server: SERVER_NAME,
    version: SERVER_VERSION,
    mcpEndpoint: '/mcp',
    health: '/health',
    appBaseUrl: APP_BASE_URL,
  });
});

// ── MCP endpoint — stateless Streamable HTTP ──────────────────────────────────
app.post('/mcp', async (req: Request, res: Response) => {
  // The Streamable HTTP transport (per MCP spec) rejects a POST with HTTP 406
  // unless the client's Accept header lists BOTH application/json AND
  // text/event-stream. Some MCP clients/validators (incl. Kakao PlayMCP) send
  // only application/json — or no Accept header — and would get a 406 with NO
  // tool list, which looks downstream like "tools/annotations missing". Since
  // we run in JSON-response mode, normalize the header so every client can read
  // tools/list (with its annotations) and call tools successfully.
  //
  // NOTE: the SDK transport builds the internal web Request from req.rawHeaders
  // (via Hono), NOT the parsed req.headers object, so we must patch rawHeaders.
  ensureDualAccept(req);

  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e: unknown) {
    console.error('[mcp] request handling failed:', e instanceof Error ? e.message : e);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// Stateless server rejects session-oriented GET/DELETE on /mcp.
function methodNotAllowed(_req: Request, res: Response) {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed. This server is stateless; use POST /mcp.' },
    id: null,
  });
}
app.get('/mcp', methodNotAllowed);
app.delete('/mcp', methodNotAllowed);

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`[${SERVER_NAME}] listening on http://${HOST}:${PORT}`);
  console.log(`[${SERVER_NAME}] MCP endpoint:  POST /mcp`);
  console.log(`[${SERVER_NAME}] health check:  GET  /health`);
  console.log(`[${SERVER_NAME}] proxying app:  ${APP_BASE_URL}`);
});

// Graceful shutdown for containers.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`[${SERVER_NAME}] received ${sig}, shutting down...`);
    httpServer.close(() => process.exit(0));
  });
}
