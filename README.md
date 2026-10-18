# Mercadona MCP

A small local MCP server written in TypeScript using the
[official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).
Browse Mercadona's public catalog through four tools backed by its unofficial
API, plus an optional authenticated cart tool. Two local demo tools are also available. The sections below cover testing
and connecting the server to ChatGPT, with direct local STDIO as the default.

## Requirements

- Node.js 24 or newer and npm.
- Public catalog tools need no credentials. The optional cart tool needs a
  Mercadona session configured locally. Mercadona tools require internet access;
  automated tests use controlled API responses.
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

## Configuration

The catalog tools and the local demos need no configuration. Everything else is
read from a `.env` file in the repository root, which is ignored by Git. Create
it from the template:

```sh
cp -n .env.example .env
```

Then fill in only the variables for the features you use:

| Variable | Needed for | Where to find it |
| --- | --- | --- |
| `MERCADONA_AUTHORIZATION` | Cart tools (`mercadona_get_cart`, `mercadona_add_to_cart`, `mercadona_remove_from_cart`) | Your browser session on tienda.mercadona.es (see below) |
| `MERCADONA_CUSTOMER_ID` | Cart tools | Same browser session (see below) |
| `API_KEY` | Secure MCP Tunnel only | [OpenAI Platform → API keys](https://platform.openai.com/api-keys); needs **Tunnels Read + Use** |
| `TUNNEL_ID` | Secure MCP Tunnel only | [OpenAI Platform → Tunnels](https://platform.openai.com/settings/organization/tunnels) |

### Finding your Mercadona session values

Mercadona has no official API keys; the cart tools reuse your own logged-in
browser session.

1. Log in at [tienda.mercadona.es](https://tienda.mercadona.es) in a desktop browser.
2. Open the developer tools (**Cmd+Option+I** on macOS, **F12** elsewhere) and
   select the **Network** tab. Filter by `cart`.
3. Open your cart, or reload the page, so a request to
   `/api/customers/<customer_id>/cart/` appears. Click it.
4. **Customer ID:** the `<customer_id>` part of that request URL. Copy it into
   `MERCADONA_CUSTOMER_ID`.
5. **Authorization:** under **Request Headers**, copy the full value of the
   `Authorization` header, including its prefix (for example `Bearer ...`), into
   `MERCADONA_AUTHORIZATION`. Quote it in `.env`.

```dotenv
MERCADONA_AUTHORIZATION="Bearer eyJ..."
MERCADONA_CUSTOMER_ID=123456
```

The session expires after some time. When a cart tool reports HTTP 401, repeat
the steps above to copy a fresh `Authorization` value.

### How the values are loaded

- The MCP server loads only `MERCADONA_AUTHORIZATION` and
  `MERCADONA_CUSTOMER_ID` from `.env` at startup, regardless of which client
  launches it. Variables already set in the process environment take precedence.
- `npm run tunnel` and `npm run tunnel:check` load `API_KEY` and `TUNNEL_ID`
  from the same file.
- After editing `.env`, restart the MCP connection (or `npm run tunnel`) so the
  new values are picked up.

Keep real values only in `.env`. Never commit them, put them in `.env.example`,
or paste them into a chat.

## Tools

### Mercadona catalog

| Tool | Example input | Result |
| --- | --- | --- |
| `mercadona_list_categories` | `{}` | Category tree and IDs |
| `mercadona_get_category` | `{"category_id":"112"}` | Category, subcategories, and their product entries |
| `mercadona_get_product` | `{"product_id":"10005"}` | Product details, including available price fields |
| `mercadona_get_similar_products` | `{"product_id":"10005"}` | Alternatives suggested by Mercadona |

Discover current IDs by browsing categories first; example IDs may become
unavailable. IDs are positive numeric **strings**. All four tools accept optional
`lang` (two-letter code, default `es`) and `warehouse` (such as `vlc1` or `mad1`).
For example:

```json
{"product_id":"10005","lang":"es","warehouse":"vlc1"}
```

Each successful tool result contains JSON with `source_url` and the original API
response under `data`. Category products can be nested under subcategories.
Warehouse selection can affect prices and availability; omitting it leaves the
API's default behavior. These responses do not guarantee stock or delivery to
your postcode.

Example ChatGPT prompts after enabling the MCP connection:

- `Use Mercadona Local to list the product categories.`
- `Browse the dairy categories and show me the milk products and prices.`
- `Use mercadona_get_product for product 10005, then find similar products.`

The integration follows the [unofficial API reference](https://github.com/datania/mercadona-catalog/blob/main/api.md).
Catalog tools only send public GET requests. The separate cart tools below use
your account session. Login and checkout are not implemented.
Requests time out after 10 seconds. API
errors, rate limits, invalid JSON, and connection failures return MCP tool errors;
requests are not automatically retried. The unofficial API may change.

Live API verification was blocked by DNS/network restrictions in the development
session. Automated tests verify request URLs, language/warehouse parameters,
responses, and failures using controlled fixtures, not live Mercadona data.

After updating, run `npm run build` and reconnect/restart the STDIO connection.
Refresh its tool list so ChatGPT discovers the current tools.

### Authenticated cart (optional)

`mercadona_get_cart` reads your configured account's cart using
`GET /api/customers/<customer_id>/cart/`. Input is `{}`; optional `lang` and
`warehouse` work as for catalog tools. Credentials and customer ID are local
configuration, never tool arguments.

Set `MERCADONA_AUTHORIZATION` and `MERCADONA_CUSTOMER_ID` in `.env` as described
in [Configuration](#configuration). Numeric and UUID customer IDs are supported.
No changes to the STDIO launch command or its dialog are needed.

Rebuild and restart/reconnect the MCP connection, refresh tools, then ask:

> Use Mercadona Local's mercadona_get_cart tool to show my shopping cart.

Missing credentials return a setup message. HTTP 401 requests a fresh session;
HTTP 403 indicates account access was denied. Update credentials locally and
restart after expiry; automatic login/refresh is not implemented. The tool is
read-only and never changes the cart or places an order. Its cart response is
shared with the MCP client when you call it.

The authenticated endpoint and header handling are tested with controlled
responses, and a live cart read has been confirmed with a real session.

### Changing the cart (optional)

Two tools change the configured account's cart. They use the same `.env`
settings as `mercadona_get_cart`.

| Tool | Example input | Effect |
| --- | --- | --- |
| `mercadona_add_to_cart` | `{"product_id":"10005","quantity":2}` | Adds units (default 1); increases the quantity if already in the cart |
| `mercadona_remove_from_cart` | `{"product_id":"10005"}` | Removes the product; pass `quantity` to decrease it instead |

Products sold by weight accept decimal quantities in kg. Mercadona's cart API
replaces the whole cart on each `PUT`, so each tool reads the cart, changes one
line, writes all lines back with the cart `version`, then reads the cart again
and reports the saved quantity, product count, and total. If the cart changes
elsewhere at the same moment, the tool reports a conflict instead of retrying.
Neither tool places an order or touches checkout.

The request format was derived from the live cart response and other unofficial
clients; automated tests use a controlled fake cart.

### Local demos

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

Tests cover MCP initialization, tool discovery, catalog retrieval, API failures,
input validation, greeting, arithmetic, and overflow using Node's built-in test
runner. The API boundary is replaced in tests; production always calls
`https://tienda.mercadona.es/api/`.

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

Direct STDIO does not need the OpenAI `API_KEY` or `TUNNEL_ID`. It only loads
Mercadona account settings from `.env` if configured for the optional cart tool.
You can stop an existing `npm run tunnel` process with **Ctrl+C** for this setup.

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
- `src/mercadona.ts`: Mercadona tool schemas and shared HTTP/error handling.
- `src/env.ts`: optional local Mercadona account configuration loading.
- `tests/server.test.mjs`: integration tests against the compiled server.
- `tests/fixtures/mercadona-fetch.mjs`: controlled external API responses for tests.
- `dist/`: generated JavaScript, excluded from Git.

Use two-space indentation and descriptive names. Add new tools with
`server.registerTool`, define their inputs with Zod, and extend the integration
tests when adding behavior.
