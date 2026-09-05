import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const port = 34870 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
});
let output = '';
child.stdout.on('data', chunk => { output += chunk.toString(); });
child.stderr.on('data', chunk => { output += chunk.toString(); });

try {
  let response;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  assert.ok(response, `Server không khởi động được. Output: ${output}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-cache');

  const assetPath = path.join('public', 'css', 'style.min.css');
  const compressedPath = `${assetPath}.br`;
  const asset = await fetch(`http://127.0.0.1:${port}/css/style.min.css?v=20260905-perf-v22`, {
    headers: { 'Accept-Encoding': 'br' }
  });
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('content-encoding'), 'br');
  assert.match(asset.headers.get('vary') || '', /Accept-Encoding/i);
  assert.match(asset.headers.get('cache-control') || '', /immutable/);
  assert.equal(Number(asset.headers.get('content-length')), fs.statSync(compressedPath).size);
  console.log('✓ Brotli sidecar, cache headers and HTML revalidation passed');
} finally {
  child.kill();
}
