import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import test from 'node:test';

// Exercise the compiled server over its actual stdio transport.
test('local MCP server', { timeout: 15_000 }, async (t) => {
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: new URL('../', import.meta.url),
    stdio: ['pipe', 'pipe', 'pipe'],
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

  await t.test('discovers both tools', async () => {
    const response = await request('tools/list');
    assert.deepEqual(response.result?.tools.map((tool) => tool.name).sort(), ['add', 'greet']);
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
