# REA → ChatGPT MCP connector

A remote Streamable HTTP gateway for the official REA MCP server. This repository does not fork or reimplement REA.

- Upstream: https://github.com/morluto/rea
- Pinned release: `rea-agents@6.9.0`
- Production endpoint: https://rea-intelligence-mcp.onrender.com/mcp
- Health endpoint: https://rea-intelligence-mcp.onrender.com/health

## Runtime architecture

The Render web service runs a small Express gateway and starts the installed REA package directly through Node:

1. REA runs its native `rea mcp --http` Streamable HTTP server on loopback only.
2. The public Express gateway proxies MCP requests to that local listener.
3. `/health` reports healthy only after REA announces that its MCP listener is ready.
4. The gateway preserves MCP session and protocol headers and streams responses.

This uses REA's native HTTP transport rather than maintaining a second MCP server implementation or launching `npx` for every client session.

## Deployment

Render is connected to the `main` branch and deploys automatically.

- Runtime: Node.js 24.22.1
- Build command: `npm install`
- Start command: `npm start`
- Health check: `/health`
- Region: Frankfurt
- Plan: Render Free

## Verification

GitHub Actions runs `npm run test:smoke` after pushes to `main`. The test:

- waits for the Render health endpoint;
- initializes an MCP session through the public HTTPS endpoint;
- calls `tools/list`;
- fails if REA exposes no tools.

The deployed release has passed the smoke test with **255 REA tools discovered**. See the [latest successful workflow](https://github.com/Ant-rolland/MCP_SERVER/actions/runs/43759896371).

Run the same test locally against a deployed instance:

```bash
npm install
MCP_URL=https://rea-intelligence-mcp.onrender.com npm run test:smoke
```

## ChatGPT compatibility

The endpoint implements Streamable HTTP at `/mcp`, which is the remote MCP transport expected by ChatGPT's custom MCP server connection flow.

Current OpenAI plan availability is separate from server compatibility:
- Business and Enterprise/Edu: full custom MCP support on ChatGPT web.
- Pro: custom MCP connections with read/fetch permissions.
- Free: custom MCP server connections are not currently listed as supported.

See the [OpenAI connection guide](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt).

## Security status — prototype only

**The deployed service currently has no authentication.** Render allows inbound traffic from `0.0.0.0/0`, and all upstream REA tools are exposed through the public endpoint. Do not use it with sensitive files, credentials, or workflows, and do not share the endpoint as a production service.

Before production use, implement OAuth 2.1 for MCP with protected-resource metadata, an authorization server, and per-request access-token validation. A static API key or bearer token is not a supported substitute for ChatGPT MCP authentication. See the [OpenAI MCP authentication guide](https://developers.openai.com/plugins/build/auth).

## Runtime limitations

- REA runs inside Render, not on the user's Windows computer. It cannot access local PC paths. Local-path tools can only access files uploaded to or present in the Render container.
- A secure upload/storage flow or a local Secure MCP Tunnel is needed for APKs and JavaScript bundles stored on the PC.
- Render Free services can sleep when idle and have cold starts.
- REA's native analysis engines depend on what is installed in the runtime. This deployment does not install Ghidra, JADX, Android SDK, Hopper, or other external analysis engines.
- All 255 upstream tools are forwarded; this deployment does not currently filter tool families or restrict write-capable tools.

## Repository scripts

- `npm start`: starts the gateway and the native REA HTTP runtime.
- `npm run test:smoke`: checks health, MCP initialization, and tool discovery.
