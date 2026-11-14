import express from "express";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 10000);
const REA_PACKAGE = process.env.REA_PACKAGE ?? "rea-agents@6.9.0";
const app = express();
app.use(express.json({ limit: "25mb" }));
const sessions = new Map();

function reaCommand() {
  if (process.platform === "win32") {
    return { command: process.env.COMSPEC ?? "cmd.exe",
      args: ["/d", "/s", "/c", `npx -y ${REA_PACKAGE} mcp`] };
  }
  return { command: process.env.NPX_PATH ?? "npx", args: ["-y", REA_PACKAGE, "mcp"] };
}

async function closeSession(id, session) {
  if (id) sessions.delete(id);
  try { await session.mcpServer?.close(); } catch {}
  try { await session.reaClient?.close(); } catch {}
  try { await session.reaTransport?.close(); } catch {}
}

async function createSession() {
  const { command, args } = reaCommand();
  const reaTransport = new StdioClientTransport({
    command, args, env: process.env, stderr: "inherit"
  });
  const reaClient = new Client(
    { name: "rea-chatgpt-gateway", version: "1.0.0" }, { capabilities: {} }
  );
  await reaClient.connect(reaTransport);

  const mcpServer = new Server(
    { name: "rea-chatgpt-connector", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => reaClient.listTools());
  mcpServer.setRequestHandler(CallToolRequestSchema, async ({ params }) =>
    reaClient.callTool({ name: params.name, arguments: params.arguments ?? {} })
  );

  const session = { reaTransport, reaClient, mcpServer, httpTransport: null };
  const httpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: id => sessions.set(id, session)
  });
  session.httpTransport = httpTransport;
  httpTransport.onclose = async () => {
    const entry = [...sessions.entries()].find(([, value]) => value === session);
    await closeSession(entry?.[0], session);
  };
  await mcpServer.connect(httpTransport);
  return session;
}

app.get("/health", (_req, res) => res.json({
  status: "ok", service: "rea-chatgpt-connector",
  transport: "streamable-http", upstream: REA_PACKAGE
}));

async function handleMcp(req, res) {
  try {
    const id = req.header("mcp-session-id");
    let session = id ? sessions.get(id) : undefined;
    if (!session && req.method === "POST" && !id) {
      if (req.body?.method !== "initialize") {
        res.status(400).json({ error: "First request must initialize an MCP session." });
        return;
      }
      session = await createSession();
    }
    if (!session) {
      res.status(404).json({ error: "Unknown MCP session. Initialize a new session." });
      return;
    }
    await session.httpTransport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[REA MCP gateway]", err);
    if (!res.headersSent) res.status(500).json({
      error: "REA MCP gateway error",
      message: err instanceof Error ? err.message : String(err)
    });
  }
}

app.post("/mcp", handleMcp);
app.get("/mcp", handleMcp);
app.delete("/mcp", async (req, res) => {
  const id = req.header("mcp-session-id");
  const session = id ? sessions.get(id) : undefined;
  if (!session) return res.status(404).json({ error: "Unknown MCP session" });
  await session.httpTransport.handleRequest(req, res, req.body);
});

const server = app.listen(PORT, HOST, () => {
  console.log(`REA MCP listening on ${HOST}:${PORT}/mcp`);
  console.log(`Health check: ${HOST}:${PORT}/health`);
  console.log(`Upstream: ${REA_PACKAGE}`);
});

async function shutdown() {
  for (const [id, session] of [...sessions.entries()]) await closeSession(id, session);
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
