import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import test from 'node:test';

// Exercise the compiled server over its actual stdio transport.
async function startClient(t, credentials = {}) {
  const child = spawn(process.execPath, ['--import', './tests/fixtures/mercadona-fetch.mjs', 'dist/index.js'], {
    cwd: new URL('../', import.meta.url),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, MERCADONA_AUTHORIZATION: '', MERCADONA_CUSTOMER_ID: '', ...credentials },
  });
  const exited = once(child, 'exit');
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0;

  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        request.resolve(message);
      }
    } catch (error) {
      for (const request of pending.values()) request.reject(error);
    }
  });
  child.on('exit', () => {
    for (const request of pending.values()) {
      request.reject(new Error(`Server exited unexpectedly: ${stderr}`));
    }
  });
  child.on('error', (error) => {
    for (const request of pending.values()) request.reject(error);
  });
  t.after(async () => {
    child.stdin.end();
    child.kill();
    await exited;
    lines.close();
  });

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
  });

  const initialized = await request('initialize', {
    protocolVersion: '2026-07-28',
    capabilities: {},
    clientInfo: { name: 'local-test-client', version: '1.0.0' },
  });
  assert.ok(initialized.result?.serverInfo, JSON.stringify(initialized));
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  return request;
}

test('local MCP server', { timeout: 15_000 }, async (t) => {
  const request = await startClient(t, {
    MERCADONA_AUTHORIZATION: 'Token test-only-session', MERCADONA_CUSTOMER_ID: '123',
  });

  await t.test('discovers demo and Mercadona catalog tools', async () => {
    const response = await request('tools/list');
    assert.deepEqual(response.result?.tools.map((tool) => tool.name).sort(), [
      'add', 'greet', 'mercadona_add_to_cart', 'mercadona_get_cart', 'mercadona_get_category',
      'mercadona_get_product', 'mercadona_get_similar_products', 'mercadona_list_categories',
      'mercadona_remove_from_cart',
    ]);
  });

  await t.test('retrieves categories, category products, product details, and alternatives', async () => {
    const cases = [
      ['mercadona_list_categories', {}, '/api/categories/?lang=es',
        { count: 1, results: [{ id: 1, name: 'Alimentación' }] }],
      ['mercadona_get_category', { category_id: '112', lang: 'en', warehouse: 'vlc1' }, '/api/categories/112/?lang=en&wh=vlc1',
        { id: 112, categories: [{ products: [{ id: '10005', display_name: 'Milk' }] }] }],
      ['mercadona_get_product', { product_id: '10005' }, '/api/products/10005/?lang=es',
        { id: '10005', display_name: 'Leche', price_instructions: { unit_price: '1.00' } }],
      ['mercadona_get_similar_products', { product_id: '10005' }, '/api/products/10005/similars/?lang=es',
        { products: [{ id: '10006', display_name: 'Leche sin lactosa' }] }],
    ];
    for (const [name, args, path, data] of cases) {
      const response = await request('tools/call', { name, arguments: args });
      assert.ok(response.result && !response.result.isError, JSON.stringify(response));
      assert.deepEqual(JSON.parse(response.result.content[0].text), {
        source_url: `https://tienda.mercadona.es${path}`, data,
      });
    }
  });

  await t.test('rejects invalid IDs and location/language inputs', async () => {
    for (const [name, args] of [
      ['mercadona_get_category', { category_id: '../products' }],
      ['mercadona_get_product', {}],
      ['mercadona_get_product', { product_id: '0' }],
      ['mercadona_get_similar_products', { product_id: '-5' }],
      ['mercadona_list_categories', { lang: 'invalid' }],
      ['mercadona_list_categories', { warehouse: 'vlc1&wh=mad1' }],
    ]) {
      const response = await request('tools/call', { name, arguments: args });
      assert.ok(response.error || response.result?.isError, JSON.stringify(response));
      assert.match(JSON.stringify(response.error ?? response.result), /validation|invalid/i);
    }
  });

  await t.test('reports HTTP, malformed response, network, and timeout failures as tool errors', async () => {
    for (const [id, message] of [
      ['404', /not found/i], ['429', /rate limit/i], ['500', /HTTP 500/],
      ['502', /invalid JSON/i], ['503', /could not reach/i], ['504', /timed out/i],
    ]) {
      const response = await request('tools/call', { name: 'mercadona_get_product', arguments: { product_id: id } });
      assert.equal(response.result?.isError, true, JSON.stringify(response));
      assert.match(response.result.content[0].text, message);
      assert.doesNotMatch(response.result.content[0].text, /private upstream details/);
    }
  });

  await t.test('greets the supplied person', async () => {
    const response = await request('tools/call', { name: 'greet', arguments: { name: 'Vicens' } });
    assert.equal(response.result?.isError, undefined);
    assert.deepEqual(response.result?.content, [{ type: 'text', text: 'Hello, Vicens!' }]);
  });

  await t.test('adds positive, negative, zero, and fractional numbers', async () => {
    for (const [a, b, expected] of [[2, 3, '5'], [-4, 1, '-3'], [0, 0, '0'], [1.5, 2.25, '3.75']]) {
      const response = await request('tools/call', { name: 'add', arguments: { a, b } });
      assert.deepEqual(response.result?.content, [{ type: 'text', text: expected }]);
    }
  });

  await t.test('rejects invalid tool inputs', async () => {
    for (const params of [
      { name: 'greet', arguments: { name: '   ' } },
      { name: 'greet', arguments: {} },
      { name: 'add', arguments: { a: '2', b: 3 } },
      { name: 'add', arguments: { a: 2 } },
    ]) {
      const response = await request('tools/call', params);
      assert.ok(response.error || response.result?.isError, JSON.stringify(response));
    }
  });

  await t.test('reports arithmetic overflow as a tool error', async () => {
    const response = await request('tools/call', {
      name: 'add', arguments: { a: 1e308, b: 1e308 },
    });
    assert.equal(response.result?.isError, true);
  });
});


test('authenticated cart retrieval', { timeout: 15_000 }, async (t) => {
  const request = await startClient(t, {
    MERCADONA_AUTHORIZATION: 'Token test-only-session', MERCADONA_CUSTOMER_ID: '123',
  });
  const response = await request('tools/call', { name: 'mercadona_get_cart', arguments: {} });
  assert.ok(response.result && !response.result.isError, JSON.stringify(response));
  assert.deepEqual(JSON.parse(response.result.content[0].text), {
    source_url: 'https://tienda.mercadona.es/api/customers/123/cart/?lang=es',
    data: { products: [{ product_id: '10005', quantity: 2 }] },
  });
  assert.doesNotMatch(JSON.stringify(response), /test-only-session/);
});

test('authenticated cart accepts a UUID customer ID', { timeout: 15_000 }, async (t) => {
  const request = await startClient(t, {
    MERCADONA_AUTHORIZATION: 'Token test-only-session',
    MERCADONA_CUSTOMER_ID: '12345678-1234-1234-1234-123456789abc',
  });
  const response = await request('tools/call', { name: 'mercadona_get_cart', arguments: {} });
  assert.ok(response.result && !response.result.isError, JSON.stringify(response));
  assert.deepEqual(JSON.parse(response.result.content[0].text), {
    source_url: 'https://tienda.mercadona.es/api/customers/12345678-1234-1234-1234-123456789abc/cart/?lang=es',
    data: { products: [{ product_id: '10005', quantity: 2 }] },
  });
});

test('cart changes', { timeout: 15_000 }, async (t) => {
  const request = await startClient(t, {
    MERCADONA_AUTHORIZATION: 'Token test-only-session', MERCADONA_CUSTOMER_ID: '456',
  });
  const call = async (name, args) => {
    const response = await request('tools/call', { name, arguments: args });
    assert.ok(response.result, JSON.stringify(response));
    assert.doesNotMatch(JSON.stringify(response), /test-only-session|private upstream details/);
    return response.result;
  };
  const changed = async (name, args) => {
    const result = await call(name, args);
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  const cartLines = async () => JSON.parse((await call('mercadona_get_cart', {})).content[0].text).data.lines
    .map((line) => [line.product.id, line.quantity]);

  await t.test('adds a new product with the default quantity and keeps other lines', async () => {
    assert.deepEqual(await changed('mercadona_add_to_cart', { product_id: '10005' }), {
      source_url: 'https://tienda.mercadona.es/api/customers/456/cart/?lang=es',
      product_id: '10005', previous_quantity: 0, quantity: 1, products_count: 3, total: '9.80',
    });
    assert.deepEqual(await cartLines(), [['4241', 7], ['3000', 0.5], ['10005', 1]]);
  });

  await t.test('increases an existing product, including decimal kg quantities', async () => {
    assert.equal((await changed('mercadona_add_to_cart', { product_id: '4241', quantity: 2 })).quantity, 9);
    assert.equal((await changed('mercadona_add_to_cart', { product_id: '3000', quantity: 0.3 })).quantity, 0.8);
  });

  await t.test('decreases a product, then removes it entirely', async () => {
    const decreased = await changed('mercadona_remove_from_cart', { product_id: '4241', quantity: 4 });
    assert.deepEqual([decreased.previous_quantity, decreased.quantity], [9, 5]);
    assert.equal((await changed('mercadona_remove_from_cart', { product_id: '4241' })).quantity, 0);
    assert.equal((await changed('mercadona_remove_from_cart', { product_id: '3000', quantity: 5 })).quantity, 0);
    assert.deepEqual(await cartLines(), [['10005', 1]]);
  });

  await t.test('reports products missing from the cart and rejected updates', async () => {
    const missing = await call('mercadona_remove_from_cart', { product_id: '4241' });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /not in the cart/);
    const rejected = await call('mercadona_add_to_cart', { product_id: '999' });
    assert.equal(rejected.isError, true);
    assert.match(rejected.content[0].text, /rejected.*400/);
    assert.deepEqual(await cartLines(), [['10005', 1]]);
  });

  await t.test('rejects invalid quantities and product IDs', async () => {
    for (const [name, args] of [
      ['mercadona_add_to_cart', { product_id: '10005', quantity: 0 }],
      ['mercadona_add_to_cart', { product_id: '10005', quantity: -1 }],
      ['mercadona_add_to_cart', { product_id: '../cart' }],
      ['mercadona_remove_from_cart', {}],
    ]) {
      const response = await request('tools/call', { name, arguments: args });
      assert.ok(response.error || response.result?.isError, JSON.stringify(response));
    }
  });
});

test('cart change reports a concurrent update conflict', { timeout: 15_000 }, async (t) => {
  const request = await startClient(t, {
    MERCADONA_AUTHORIZATION: 'Token test-only-session', MERCADONA_CUSTOMER_ID: '409',
  });
  const response = await request('tools/call', { name: 'mercadona_add_to_cart', arguments: { product_id: '10005' } });
  assert.equal(response.result?.isError, true, JSON.stringify(response));
  assert.match(response.result.content[0].text, /changed while it was being updated.*409/);
});

test('cart changes require credentials', { timeout: 15_000 }, async (t) => {
  const request = await startClient(t);
  for (const name of ['mercadona_add_to_cart', 'mercadona_remove_from_cart']) {
    const response = await request('tools/call', { name, arguments: { product_id: '10005' } });
    assert.equal(response.result?.isError, true, JSON.stringify(response));
    assert.match(response.result.content[0].text, /set MERCADONA_AUTHORIZATION and MERCADONA_CUSTOMER_ID/i);
  }
});

for (const [label, credentials, message] of [
  ['missing credentials', {}, /set MERCADONA_AUTHORIZATION and MERCADONA_CUSTOMER_ID/i],
  ['missing customer ID', { MERCADONA_AUTHORIZATION: 'Token test-only-session' }, /set MERCADONA_AUTHORIZATION and MERCADONA_CUSTOMER_ID/i],
  ['invalid customer ID', { MERCADONA_AUTHORIZATION: 'Token test-only-session', MERCADONA_CUSTOMER_ID: '../123' }, /customer ID must/i],
  ['invalid authorization header', { MERCADONA_AUTHORIZATION: 'Token test-only-session\r\nInjected: value', MERCADONA_CUSTOMER_ID: '123' }, /single header value/i],
  ['expired credentials', { MERCADONA_AUTHORIZATION: 'Token test-only-session', MERCADONA_CUSTOMER_ID: '401' }, /authentication.*401/i],
  ['forbidden account', { MERCADONA_AUTHORIZATION: 'Token test-only-session', MERCADONA_CUSTOMER_ID: '403' }, /access denied.*403/i],
]) {
  test(`cart reports ${label}`, { timeout: 15_000 }, async (t) => {
    const request = await startClient(t, credentials);
    const response = await request('tools/call', { name: 'mercadona_get_cart', arguments: {} });
    assert.equal(response.result?.isError, true, JSON.stringify(response));
    assert.match(response.result.content[0].text, message);
    assert.doesNotMatch(JSON.stringify(response), /test-only-session|private upstream details/);
  });
}
