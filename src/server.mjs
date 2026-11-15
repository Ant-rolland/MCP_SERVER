import express from "express";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 10000);
const REA_HTTP_HOST = "127.0.0.1";
const REA_HTTP_PORT = Number(process.env.REA_HTTP_PORT ?? 10001);
const REA_PACKAGE = "rea-agents@6.9.0";
const REA_ENTRY = fileURLToPath(
  new URL("../node_modules/rea-agents/scripts/rea.mjs", import.meta.url)
);

const app = express();
app.use(express.json({ limit: "4mb" }));

let reaReady = false;
let shuttingDown = false;
let reaExit = null;

const rea = spawn(
  process.execPath,
  [
    REA_ENTRY,
    "mcp",
    "--http",
    "--host",
    REA_HTTP_HOST,
    "--port",
    String(REA_HTTP_PORT)
  ],
  {
    env: { ...process.env, REA_LOG_LEVEL: process.env.REA_LOG_LEVEL ?? "info" },
    stdio: ["ignore", "ignore", "pipe"]
  }
);

let stderrBuffer = "";
rea.stderr.setEncoding("utf8");
rea.stderr.on("data", chunk => {
  stderrBuffer += chunk;
  const lines = stderrBuffer.split(/\r?\n/);
  stderrBuffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line) continue;
    console.log(`[REA] ${line}`);
    try {
      const event = JSON.parse(line);
      if (event.msg === "MCP transport listening" && event.url) {
        reaReady = true;
        console.log(`REA native MCP ready at ${event.url}`);
      }
    } catch {
      // REA may emit human-readable diagnostics alongside structured logs.
    }
  }
});

rea.on("error", error => {
  console.error("[REA process error]", error);
  reaExit = error;
  reaReady = false;
  if (!shuttingDown) process.exit(1);
});

rea.on("exit", (code, signal) => {
  reaReady = false;
  reaExit = new Error(`REA exited (code=${code}, signal=${signal})`);
  console.error("[REA process exit]", reaExit.message);
  if (!shuttingDown) process.exit(1);
});

const startupTimer = setTimeout(() => {
  console.error("REA did not announce its native MCP HTTP listener within 60 seconds.");
  process.exit(1);
}, 60_000);

const readinessPoll = setInterval(() => {
  if (reaReady) {
    clearTimeout(startupTimer);
    clearInterval(readinessPoll);
  }
}, 100);

app.get("/health", (_req, res) => {
  if (!reaReady || reaExit) {
    res.status(503).json({
      status: "starting",
      upstream: REA_PACKAGE,
      error: reaExit?.message
    });
    return;
  }
  res.json({
    status: "ok",
    service: "rea-chatgpt-connector",
    transport: "streamable-http",
    upstream: REA_PACKAGE
  });
});

app.all("/mcp", async (req, res) => {
  if (!reaReady) {
    res.status(503).json({ error: "REA MCP server is starting." });
    return;
  }

  try {
    const headers = new Headers();
    for (const name of [
      "accept",
      "content-type",
      "mcp-session-id",
      "mcp-protocol-version",
      "last-event-id"
    ]) {
      const value = req.header(name);
      if (value) headers.set(name, value);
    }

    const init = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(120_000)
    };
    if (req.method === "POST" && req.body !== undefined) {
      init.body = JSON.stringify(req.body);
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
    }

    const upstream = await fetch(
      `http://${REA_HTTP_HOST}:${REA_HTTP_PORT}/mcp`,
      init
    );

    res.status(upstream.status);
    for (const name of [
      "content-type",
      "cache-control",
      "mcp-session-id",
      "mcp-protocol-version"
    ]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }

    if (!upstream.body) {
      res.end();
      return;
    }
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (error) {
    console.error("[MCP proxy error]", error);
    if (!res.headersSent) {
      res.status(502).json({
        error: "Unable to reach the REA MCP runtime.",
        message: error instanceof Error ? error.message : String(error)
      });
    } else {
      res.destroy(error);
    }
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`REA gateway listening on ${HOST}:${PORT}`);
  console.log(`Health check: ${HOST}:${PORT}/health`);
  console.log(`Upstream: ${REA_PACKAGE} native Streamable HTTP`);
  console.log(`REA entry: ${REA_ENTRY}`);
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(startupTimer);
  clearInterval(readinessPoll);
  reaReady = false;
  server.close();
  if (rea.exitCode === null && rea.signalCode === null) {
    rea.kill("SIGTERM");
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 10_000);
      rea.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
