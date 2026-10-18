import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const API_BASE = 'https://tienda.mercadona.es/api/';
const TIMEOUT_MS = 10_000;
const id = z.string().regex(/^[1-9]\d{0,11}$/, 'Use a positive numeric ID as a string');
const customerIdSchema = z.union([
  id,
  z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
]);
const catalogOptions = {
  lang: z.string().regex(/^[a-z]{2}$/).default('es').describe('Two-letter language code, default es'),
  warehouse: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/).optional()
    .describe('Optional Mercadona warehouse code, such as vlc1 or mad1. Omit if unknown.'),
};
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

class MercadonaApiError extends Error {}

type RequestOptions = { lang: string; warehouse?: string };
type Account = { authorization: string; customerId: string };
type CartLine = { quantity: number; sources?: unknown[]; product?: { id?: unknown }; product_id?: unknown };
type Cart = { id: string; version: number; lines: CartLine[]; summary?: { total?: string }; products_count?: number };

function buildUrl(path: string, options: RequestOptions) {
  const url = new URL(path, API_BASE);
  url.searchParams.set('lang', options.lang);
  if (options.warehouse) url.searchParams.set('wh', options.warehouse);
  return url;
}

async function requestJson(url: URL, init: { method?: 'GET' | 'PUT'; authorization?: string; body?: unknown } = {}) {
  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.authorization ? { authorization: init.authorization } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 400) {
    throw new MercadonaApiError('Mercadona rejected the request (HTTP 400). Check the product ID and quantity.');
  }
  if (response.status === 401) {
    throw new MercadonaApiError('Mercadona authentication failed (HTTP 401). Update MERCADONA_AUTHORIZATION with a current session header and restart the MCP connection.');
  }
  if (response.status === 403) {
    throw new MercadonaApiError('Mercadona access denied (HTTP 403). Check that the session can access the configured customer account.');
  }
  if (response.status === 404) {
    throw new MercadonaApiError('Mercadona resource not found (HTTP 404). Check the category or product ID.');
  }
  if (response.status === 409) {
    throw new MercadonaApiError('The Mercadona cart changed while it was being updated (HTTP 409). Try again.');
  }
  if (response.status === 429) {
    throw new MercadonaApiError('Mercadona rate limit reached (HTTP 429). Try again later.');
  }
  if (!response.ok) {
    throw new MercadonaApiError(`Mercadona API returned HTTP ${response.status}. Try again later.`);
  }

  try {
    return await response.json() as unknown;
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw error;
    throw new MercadonaApiError('Mercadona API returned invalid JSON. The unofficial API may have changed.');
  }
}

function toolError(error: unknown) {
  let message = 'Could not reach Mercadona. Check your internet connection and try again.';
  if (error instanceof MercadonaApiError) message = error.message;
  else if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
    message = 'Mercadona request timed out after 10 seconds. Try again later.';
  }
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

async function getCatalog(path: string, options: RequestOptions, authorization?: string) {
  const url = buildUrl(path, options);
  try {
    const data = await requestJson(url, { authorization });
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ source_url: url.href, data }) }],
    };
  } catch (error) {
    return toolError(error);
  }
}

// Returns the configured account, or a tool error explaining what to fix locally.
function readAccount(): Account | ReturnType<typeof toolError> {
  const authorization = process.env.MERCADONA_AUTHORIZATION?.trim();
  const customerId = process.env.MERCADONA_CUSTOMER_ID?.trim();
  if (!authorization || !customerId) {
    return toolError(new MercadonaApiError('Set MERCADONA_AUTHORIZATION and MERCADONA_CUSTOMER_ID in the local .env file, then restart the MCP connection. Do not share credentials in chat.'));
  }
  if (!customerIdSchema.safeParse(customerId).success) {
    return toolError(new MercadonaApiError('Mercadona customer ID must be a positive numeric ID or a UUID. Update MERCADONA_CUSTOMER_ID locally.'));
  }
  if (/[\r\n]/.test(authorization)) {
    return toolError(new MercadonaApiError('MERCADONA_AUTHORIZATION must contain a single header value on one line.'));
  }
  return { authorization, customerId };
}

const lineProductId = (line: CartLine) => String(line.product?.id ?? line.product_id ?? '');

function parseCart(data: unknown): Cart {
  const cart = data as Partial<Cart> | null;
  if (!cart || typeof cart.id !== 'string' || typeof cart.version !== 'number' || !Array.isArray(cart.lines)
    || !cart.lines.every((line) => typeof line?.quantity === 'number' && lineProductId(line))) {
    throw new MercadonaApiError('Mercadona returned an unexpected cart format. The unofficial API may have changed.');
  }
  return cart as Cart;
}

// The cart API replaces the whole cart, so read it, change one line, and write every line back.
async function updateCartLine(
  account: Account,
  productId: string,
  options: RequestOptions,
  nextQuantity: (current: number) => number,
) {
  const url = buildUrl(`customers/${account.customerId}/cart/`, options);
  try {
    const cart = parseCart(await requestJson(url, { authorization: account.authorization }));
    const existing = cart.lines.find((line) => lineProductId(line) === productId);
    const previousQuantity = existing?.quantity ?? 0;
    // Round away float noise from decimal (kg) quantities, e.g. 0.3 - 0.1.
    const quantity = Math.round(nextQuantity(previousQuantity) * 1000) / 1000;

    const lines = cart.lines
      .filter((line) => line !== existing)
      .map((line) => ({ quantity: line.quantity, product_id: lineProductId(line), sources: line.sources ?? [] }));
    if (quantity > 0) lines.push({ quantity, product_id: productId, sources: existing?.sources ?? [] });

    await requestJson(url, {
      method: 'PUT',
      authorization: account.authorization,
      body: { id: cart.id, version: cart.version, lines },
    });

    // Read back so the result reflects what Mercadona actually saved.
    const saved = parseCart(await requestJson(url, { authorization: account.authorization }));
    const savedQuantity = saved.lines.find((line) => lineProductId(line) === productId)?.quantity ?? 0;
    if (savedQuantity !== quantity) {
      throw new MercadonaApiError(`Mercadona saved quantity ${savedQuantity} for product ${productId} instead of ${quantity}. Check the cart before continuing.`);
    }
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          source_url: url.href,
          product_id: productId,
          previous_quantity: previousQuantity,
          quantity: savedQuantity,
          products_count: saved.products_count,
          total: saved.summary?.total,
        }),
      }],
    };
  } catch (error) {
    return toolError(error);
  }
}

export function registerMercadonaTools(server: McpServer) {
  server.registerTool('mercadona_get_cart', {
    description: 'Read the configured Mercadona account shopping cart. Requires MERCADONA_AUTHORIZATION and MERCADONA_CUSTOMER_ID configured locally. Never ask for credentials as tool arguments. Does not change the cart or place an order.',
    inputSchema: z.object(catalogOptions),
    annotations,
  }, async (options) => {
    const account = readAccount();
    if ('isError' in account) return account;
    return getCatalog(`customers/${account.customerId}/cart/`, options, account.authorization);
  });

  server.registerTool('mercadona_add_to_cart', {
    description: 'Add a product to the configured Mercadona account cart, increasing its quantity if it is already there. Use product IDs from the catalog tools. Products sold by weight accept decimal quantities in kg. Does not place an order.',
    inputSchema: z.object({
      ...catalogOptions,
      product_id: id.describe('Product ID to add'),
      quantity: z.number().positive().max(999).default(1).describe('Units (or kg for weighed products) to add, default 1'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ product_id, quantity, ...options }) => {
    const account = readAccount();
    if ('isError' in account) return account;
    return updateCartLine(account, product_id, options, (current) => current + quantity);
  });

  server.registerTool('mercadona_remove_from_cart', {
    description: 'Remove a product from the configured Mercadona account cart. Omit quantity to remove the product entirely, or pass a quantity to decrease it. Does not place an order.',
    inputSchema: z.object({
      ...catalogOptions,
      product_id: id.describe('Product ID currently in the cart'),
      quantity: z.number().positive().max(999).optional().describe('Units (or kg) to remove. Omit to remove the product entirely.'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async ({ product_id, quantity, ...options }) => {
    const account = readAccount();
    if ('isError' in account) return account;
    return updateCartLine(account, product_id, options, (current) => {
      if (current === 0) throw new MercadonaApiError(`Product ${product_id} is not in the cart.`);
      return quantity === undefined ? 0 : Math.max(0, current - quantity);
    });
  });

  server.registerTool('mercadona_list_categories', {
    description: 'Browse Mercadona catalog categories and their IDs. Start here to discover category IDs. Uses the unofficial public API; no login required.',
    inputSchema: z.object(catalogOptions),
    annotations,
  }, async (options) => getCatalog('categories/', options));

  server.registerTool('mercadona_get_category', {
    description: 'Get a Mercadona category and its subcategories/products using an ID from mercadona_list_categories. Product entries may be nested under subcategories.',
    inputSchema: z.object({ ...catalogOptions, category_id: id.describe('Category ID from the category tree') }),
    annotations,
  }, async ({ category_id, ...options }) => getCatalog(`categories/${category_id}/`, options));

  server.registerTool('mercadona_get_product', {
    description: 'Get Mercadona product details and prices by product ID discovered in a category. Prices/availability can depend on the warehouse; this is not a delivery or stock guarantee.',
    inputSchema: z.object({ ...catalogOptions, product_id: id.describe('Product ID from category products') }),
    annotations,
  }, async ({ product_id, ...options }) => getCatalog(`products/${product_id}/`, options));

  server.registerTool('mercadona_get_similar_products', {
    description: 'Get alternatives suggested by Mercadona for an existing product ID. Uses the unofficial public catalog API.',
    inputSchema: z.object({ ...catalogOptions, product_id: id.describe('Product ID to find alternatives for') }),
    annotations,
  }, async ({ product_id, ...options }) => getCatalog(`products/${product_id}/similars/`, options));
}
