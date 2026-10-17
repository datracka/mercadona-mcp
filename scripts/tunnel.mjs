import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const action = process.argv[2];
if (!['run', 'doctor'].includes(action)) {
  console.error('Use npm run tunnel or npm run tunnel:check.');
  process.exit(1);
}

if (!process.env.API_KEY?.trim() || !process.env.TUNNEL_ID?.trim()) {
  console.error('Set API_KEY and TUNNEL_ID in .env before starting the tunnel.');
  process.exit(1);
}

const serverPath = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const command = [process.execPath, serverPath].map((part) => JSON.stringify(part)).join(' ');
const result = spawnSync('tunnel-client', [
  action,
  '--control-plane.api-key', 'env:API_KEY',
  '--control-plane.tunnel-id', process.env.TUNNEL_ID,
  '--mcp.command', command,
  ...(action === 'doctor' ? ['--explain'] : []),
], { stdio: 'inherit' });

if (result.error) {
  console.error('Could not launch tunnel-client. Ensure it is installed and on your PATH.');
}
process.exitCode = result.status ?? 1;
