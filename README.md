# REA → ChatGPT MCP connector

Minimal Streamable HTTP gateway forwarding the official REA MCP tools.
It does not fork or reimplement REA.

Upstream: https://github.com/morluto/rea  
Pinned npm release: `rea-agents@6.9.0`

## Deploy without a terminal

1. Open `https://github.com/Ant-rolland/MCP_SERVER`.
2. Choose **Add file → Upload files**.
3. Upload the contents of this folder (not the ZIP archive) to the repository root.
4. Commit to `main`.
5. Open the `REA Intelligence` workspace in Render.
6. Choose **New → Blueprint**, select `MCP_SERVER`, review the service and apply.
7. Wait until the service is Live.

Render URL will resemble `https://rea-intelligence-mcp.onrender.com`.

- MCP endpoint: `https://rea-intelligence-mcp.onrender.com/mcp`
- Health: `https://rea-intelligence-mcp.onrender.com/health`

## Connect in ChatGPT

1. ChatGPT Web → Plugins → `+` → Add custom MCP server.
2. Name: `REA Reverse Engineering`.
3. Server URL: the HTTPS address ending in `/mcp`.
4. Authentication: No authentication (initial personal test only).
5. Review the warning, then Create as a plugin.
6. Review discovered tools and install.

## Important limitations and security

- This first deployment has no authentication. Its public URL can be called by anyone who discovers it. Use only for a controlled test; add OAuth before sharing or using sensitive workflows.
- REA runs inside Render, not on the user's Windows computer. It cannot read files from the PC. Local-path tools can only access files in the Render container.
- For Android APKs or local JavaScript bundles, a secure upload/storage flow or a local Secure MCP Tunnel will be needed.
- Render Free services sleep when idle and may have cold starts.
- REA's native analysis engines depend on what is installed in the runtime. This gateway does not install Ghidra, JADX, Android SDK or other native engines.
- All upstream REA tools are forwarded. JavaScript, Web and Android are the initial target domains, not a hard filter on tool names.

## Runtime

Node 24.22.1 · Streamable HTTP `/mcp` · health `/health`  
Upstream command: `npx -y rea-agents@6.9.0 mcp`
