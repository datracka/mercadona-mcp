# Mercadona MCP

A small local MCP server written in TypeScript using the
[official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).
This first version exposes two demo tools. Mercadona API access is a future step.
The sections below cover local testing and connecting the server to ChatGPT.

## Requirements

- Node.js 24 or newer and npm.
- Local testing and direct STDIO connections need no API keys or environment
  variables.
- Optional Secure MCP Tunnel connections require additional access and a runtime
  API key, as described below.

## Install and build

```sh
npm ci
npm run build
```

The server uses **stdio**: your MCP client launches it and exchanges messages
through stdin/stdout. Configure the client using the default setup below. You do
not need to run `npm start` or `npm run tunnel` separately for this connection.

To launch the server manually, use `npm start`. It waits for MCP messages without
opening an HTTP port or displaying a webpage. Press Ctrl+C to stop it. Keep
stdout free of logs; use `console.error` for diagnostics.

For development with automatic restart:

```sh
npm run dev
```

## Tools

| Tool | Example input | Text result |
| --- | --- | --- |
| `greet` | `{"name":"Vicens"}` | `Hello, Vicens!` |
| `add` | `{"a":2,"b":3}` | `5` |

Names are trimmed and must not be empty. Addition accepts finite numbers,
including negative values and decimals; numeric overflow returns a tool error.
Arithmetic uses JavaScript floating-point numbers, so it is not intended for
precise monetary calculations. Both tools run entirely locally.

## Verify

```sh
npm run check  # Type-check without emitting files
npm test       # Build and run integration tests through a real stdio process
```

Tests cover MCP initialization, tool discovery, greeting, arithmetic, invalid
arguments, and overflow using Node's built-in test runner.

## Test interactively with MCP Inspector

If you started the server with `npm start`, stop it with **Ctrl+C** first.
Inspector launches its own server process. From the repository root, run:

```sh
npm run build
npm run inspect
```

The second command downloads and starts the official
[MCP Inspector](https://github.com/modelcontextprotocol/inspector) using `npx`
(internet access is needed on first use).

1. Open the local URL printed in the terminal, including its session token if
   present. Leave the terminal running.
2. Select **STDIO** transport. The command should be `node`, with arguments
   `dist/index.js`; the npm script preconfigures these values.
3. Click **Connect**, open **Tools**, then click **List Tools**.
4. Select `greet`, enter `Vicens` in the `name` field, and run the tool. Expect
   `Hello, Vicens!`.
5. Select `add`, enter `2` for `a` and `3` for `b`, and run it. Expect `5`.

If connection fails, confirm you ran the commands from the repository root and
that `dist/index.js` exists. If starting the server directly produces no output,
that is expected: it is waiting for an MCP client, not serving a webpage.

## Connect the local server to ChatGPT

### Default: direct local STDIO

Use this setup in the local app's **Connect to a custom MCP** dialog when it
offers **STDIO**, **Command to launch**, and **Arguments**. The app launches the
server on your computer. The command, arguments, and working directory follow
the [official STDIO configuration](https://learn.chatgpt.com/docs/extend/mcp).

1. Run `npm ci` and `npm run build` from the repository root.
2. Run `command -v node` to find your Node executable's absolute path.
3. Open the custom MCP dialog and enter the following. These paths are examples
   for this checkout; replace them if your Node version or project location differs.

| Field | Value |
| --- | --- |
| Name | `Mercadona Local` |
| Type | **STDIO** |
| Command to launch | `/Users/vicensfayos/.nvm/versions/node/v24.21.0/bin/node` |
| Arguments (one entry) | `/Users/vicensfayos/Projects/mercadona-mcp/dist/index.js` |
| Environment variables | Leave empty |
| Environment variable passthrough | Leave empty |
| Working directory | `/Users/vicensfayos/Projects/mercadona-mcp` |

4. Click **Save** and enable/select the connection in your conversation.
5. Ask: `Use Mercadona Local's greet tool with name Vicens.` Expect
   `Hello, Vicens!`.
6. Ask: `Use Mercadona Local's add tool with a=2 and b=3.` Expect `5`.

Check that a tool call actually occurs. An answer calculated by the model alone
does not verify the connection. Rebuild after source changes and reconnect or
restart the connection so the app launches the updated JavaScript.

Direct STDIO does not use `.env`, `API_KEY`, or `TUNNEL_ID`. You can stop an
existing `npm run tunnel` process with **Ctrl+C** when using this setup.

### When a tunnel is needed

Use a tunnel when the caller runs remotely, such as ChatGPT on the web or a
hosted API service, and cannot launch the local Node process. A remote caller
needs a reachable MCP endpoint or a supported tunnel to reach a private server.
The local STDIO dialog above already launches the process, so it needs no tunnel.

### Optional: prepare a private tunnel

OpenAI's [Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
supports local stdio servers without a public endpoint. The server stays on your
computer; requests and responses travel through OpenAI.

1. Open [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels),
   create a tunnel, associate your ChatGPT workspace, and copy its `tunnel_id`.
2. Obtain **Tunnels Read + Manage** for creation and **Read + Use** for runtime
   access. You also need a runtime API key and permission to add custom MCP servers
   in ChatGPT; access depends on your account/workspace.
3. Install `tunnel-client` and ensure it is on your PATH. If you installed it
   with Homebrew, this step is already complete.
4. Create `.env` from `.env.example` if it does not already exist:

```sh
cp -n .env.example .env
```

Edit `.env` locally and fill in both values:

```dotenv
API_KEY=your_openai_runtime_api_key
TUNNEL_ID=your_tunnel_id
```

`TUNNEL_ID` identifies your tunnel; it is not a second secret key. `.env` is
ignored by Git; `.env.example` contains only empty placeholders. Never put real
credentials in `.env.example`.

Validate the configuration, then start the tunnel:

```sh
npm run tunnel:check
npm run tunnel
```

Both commands build the server and use Node's built-in `.env` loading. No extra
package, manual export, or saved tunnel-client profile is required. Existing
shell environment variables take precedence over `.env`; if an old exported
value is being used, run `unset API_KEY TUNNEL_ID` first.

Keep `npm run tunnel` running. It launches the MCP server; a separate `npm start`
is unnecessary. Stop it with **Ctrl+C**. After changing `.env`, restart the
command to load the new values.

### Add the connection and call tools

Following OpenAI's [custom MCP server instructions](https://developers.openai.com/api/docs/guides/custom-mcp-server):

1. Open **ChatGPT on the web → Plugins → + → Add custom MCP server**.
2. Name it `Mercadona Local`. Under **Connection**, choose **Tunnel** and select
   your tunnel or enter its ID.
3. Choose **No authentication** for this demo's MCP server. The tunnel client
   still authenticates separately with its runtime key.
4. Review the warning, confirm, and select **Create as a plugin**.
5. Install the resulting plugin. In a new chat, type `@` and select it.
6. Ask: `Use Mercadona Local's greet tool with name Vicens.`
7. Ask: `Use Mercadona Local's add tool with a=2 and b=3.`

Check that ChatGPT actually calls the selected tool and returns the expected
result; arithmetic answered without a tool call does not verify the connection.

If **Add custom MCP server** is unavailable, check workspace permissions and
security restrictions. If the tunnel is missing, verify its ChatGPT workspace
association and your **Read + Use** permission. If tool discovery fails, check
the running tunnel client and rerun `npm run tunnel:check`.

This repository has no HTTP `/mcp` endpoint. A plain ngrok HTTP tunnel therefore
cannot forward this version; use the stdio tunnel setup above.

Documentation checked on October 17, 2026. These are setup instructions; an
end-to-end connection to your ChatGPT account has not been verified here.

## Layout

- `src/index.ts`: tool definitions, input validation, and stdio entry point.
- `tests/server.test.mjs`: integration tests against the compiled server.
- `dist/`: generated JavaScript, excluded from Git.

Use two-space indentation and descriptive names. Add new tools with
`server.registerTool`, define their inputs with Zod, and extend the integration
tests when adding behavior.
