import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const baseUrl = (process.env.MCP_URL ?? "https://rea-intelligence-mcp.onrender.com").replace(/\/$/, "");
const healthUrl = new URL("/health", baseUrl);
const mcpUrl = new URL("/mcp", baseUrl);
const attempts = Number(process.env.SMOKE_ATTEMPTS ?? 30);
const delayMs = Number(process.env.SMOKE_DELAY_MS ?? 10_000);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForHealth() {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        const payload = await response.json();
        if (payload.status === "ok") {
          console.log(`Health check passed on attempt ${attempt}.`);
          return;
        }
        lastError = new Error(`Unexpected health payload: ${JSON.stringify(payload)}`);
      } else {
        lastError = new Error(`Health endpoint returned HTTP ${response.status}`);
      }
    } catch (error) {
      lastError = error;
    }
    console.log(`Waiting for Render health (${attempt}/${attempts}): ${lastError.message}`);
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(`Service did not become healthy: ${lastError?.message ?? "unknown error"}`);
}

function isTransient(error) {
  const message = String(error?.message ?? error);
  return /HTTP 502|HTTP 503|HTTP 504|502|503|504|fetch failed|ECONNRESET|ECONNREFUSED|socket hang up|timed out/i.test(message);
}

async function verifyMcp() {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = new Client(
      { name: "rea-mcp-smoke-test", version: "1.0.0" },
      { capabilities: {} }
    );
    const transport = new StreamableHTTPClientTransport(mcpUrl);
    try {
      await client.connect(transport);
      const result = await client.listTools();
      const tools = result.tools ?? [];
      if (tools.length === 0) {
        throw new Error("MCP connected, but REA returned no tools.");
      }
      console.log(`MCP initialize passed. REA exposed ${tools.length} tools.`);
      console.log("Sample tools:", tools.slice(0, 10).map(tool => tool.name).join(", "));
      return;
    } catch (error) {
      lastError = error;
      if (!isTransient(error)) throw error;
      console.log(`MCP endpoint is restarting or unavailable (${attempt}/${attempts}): ${String(error.message).split("\n")[0]}`);
    } finally {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(`MCP did not become ready: ${lastError?.message ?? "unknown error"}`);
}

await waitForHealth();
await verifyMcp();
