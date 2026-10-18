import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Only Mercadona account settings are loaded; tunnel credentials are separate.
export function loadMercadonaEnv(envFile = new URL('../.env', import.meta.url)) {
  const keys = ['MERCADONA_AUTHORIZATION', 'MERCADONA_CUSTOMER_ID'] as const;
  if (keys.every((key) => process.env[key] !== undefined)) return;
  try {
    const values = parseEnv(readFileSync(envFile, 'utf8'));
    for (const key of keys) {
      if (process.env[key] === undefined && values[key] !== undefined) {
        process.env[key] = values[key];
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error('Could not load local Mercadona settings from .env. Check file permissions and format.');
    }
  }
}
