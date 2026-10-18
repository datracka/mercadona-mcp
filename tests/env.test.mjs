import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('loads only Mercadona settings and preserves supplied environment values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mercadona-env-'));
  try {
    const envFile = join(dir, '.env');
    writeFileSync(envFile, 'MERCADONA_AUTHORIZATION="Token test-only-session"\nMERCADONA_CUSTOMER_ID=123\nAPI_KEY=must-not-load\n');
    const code = `
      import assert from 'node:assert/strict';
      import { loadMercadonaEnv } from ${JSON.stringify(new URL('../dist/env.js', import.meta.url).href)};
      loadMercadonaEnv(new URL(${JSON.stringify(pathToFileURL(join(dir, 'missing.env')).href)}));
      assert.equal(process.env.MERCADONA_AUTHORIZATION, undefined);
      loadMercadonaEnv(new URL(${JSON.stringify(pathToFileURL(envFile).href)}));
      assert.equal(process.env.MERCADONA_AUTHORIZATION, 'Token test-only-session');
      assert.equal(process.env.MERCADONA_CUSTOMER_ID, '456');
      assert.equal(process.env.API_KEY, undefined);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      env: { MERCADONA_CUSTOMER_ID: '456' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
