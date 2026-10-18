// Replace only the external HTTP boundary; MCP still runs over a real process.
import assert from 'node:assert/strict';

// Customer 456 has a cart that PUT requests change, like the real whole-cart API.
let cart = {
  id: 'cart-1', version: 3, open_order_id: null, products_count: 2, summary: { total: '9.80' },
  lines: [
    { quantity: 7, version: 1, sources: ['+CT'], product: { id: '4241', display_name: 'Agua' } },
    { quantity: 0.5, version: 1, sources: [], product: { id: '3000', display_name: 'Plátanos' } },
  ],
};

globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  assert.equal(url.origin, 'https://tienda.mercadona.es');
  assert.ok(options.signal instanceof AbortSignal);
  if (url.pathname.startsWith('/api/customers/456/') || url.pathname.startsWith('/api/customers/409/')) {
    assert.equal(new Headers(options.headers).get('authorization'), 'Token test-only-session');
    assert.equal(options.redirect, 'error');
    if (options.method === 'GET') return Response.json(cart);
    assert.equal(options.method, 'PUT');
    assert.equal(new Headers(options.headers).get('content-type'), 'application/json');
    if (url.pathname.startsWith('/api/customers/409/')) return new Response('private upstream details', { status: 409 });
    const body = JSON.parse(options.body);
    assert.deepEqual(Object.keys(body).sort(), ['id', 'lines', 'version']);
    assert.equal(body.id, cart.id);
    assert.equal(body.version, cart.version);
    if (body.lines.some((line) => line.product_id === '999')) return new Response('private upstream details', { status: 400 });
    cart = {
      ...cart,
      version: cart.version + 1,
      products_count: body.lines.length,
      lines: body.lines.map((line) => ({
        quantity: line.quantity, version: 1, sources: line.sources, product: { id: line.product_id },
      })),
    };
    return Response.json(cart);
  }
  assert.equal(options.method, 'GET');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(new Headers(options.headers).get('accept'), 'application/json');
  if (url.pathname.startsWith('/api/customers/')) {
    assert.equal(new Headers(options.headers).get('authorization'), 'Token test-only-session');
    assert.equal(options.redirect, 'error');
    if (url.pathname === '/api/customers/401/cart/') return new Response('private upstream details', { status: 401 });
    if (url.pathname === '/api/customers/403/cart/') return new Response('private upstream details', { status: 403 });
    assert.ok(['/api/customers/123/cart/', '/api/customers/12345678-1234-1234-1234-123456789abc/cart/'].includes(url.pathname));
    assert.equal(url.searchParams.get('lang'), 'es');
    return Response.json({ products: [{ product_id: '10005', quantity: 2 }] });
  }
  assert.equal(new Headers(options.headers).get('authorization'), null);

  if (url.pathname === '/api/categories/') {
    assert.equal(url.searchParams.get('lang'), 'es');
    assert.equal(url.searchParams.get('wh'), null);
    return Response.json({ count: 1, results: [{ id: 1, name: 'Alimentación' }] });
  }
  if (url.pathname === '/api/categories/112/') {
    assert.equal(url.searchParams.get('lang'), 'en');
    assert.equal(url.searchParams.get('wh'), 'vlc1');
    return Response.json({ id: 112, categories: [{ products: [{ id: '10005', display_name: 'Milk' }] }] });
  }
  if (url.pathname === '/api/products/10005/') {
    return Response.json({ id: '10005', display_name: 'Leche', price_instructions: { unit_price: '1.00' } });
  }
  if (url.pathname === '/api/products/10005/similars/') {
    return Response.json({ products: [{ id: '10006', display_name: 'Leche sin lactosa' }] });
  }
  if (url.pathname === '/api/products/404/') return new Response('', { status: 404 });
  if (url.pathname === '/api/products/429/') return new Response('', { status: 429 });
  if (url.pathname === '/api/products/500/') return new Response('private upstream details', { status: 500 });
  if (url.pathname === '/api/products/502/') return new Response('<html>Unexpected</html>');
  if (url.pathname === '/api/products/503/') throw new TypeError('fetch failed');
  if (url.pathname === '/api/products/504/') throw new DOMException('Timed out', 'TimeoutError');
  throw new Error(`Unexpected API request: ${url}`);
};
