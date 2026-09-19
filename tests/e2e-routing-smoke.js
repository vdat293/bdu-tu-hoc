import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase } from '../src/db/database.js';

const port = Number(process.env.PORT || 3098);
process.env.PORT = String(port);
// Chunk cũ chỉ còn trong volume lịch sử (không có trong dist) vẫn phải tải
// được để HTML còn cache không 404 sau deploy.
const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-asset-history-'));
process.env.CLIENT_ASSET_HISTORY_DIR = historyDir;
const staleChunkName = 'GpaPage-oldchunk123.js';
fs.writeFileSync(path.join(historyDir, staleChunkName), 'export const stale = true;\n');
const server = (await import('../server.js')).default;

function get(path, headers = { Accept: 'text/html' }) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}${path}`, { headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        type: res.headers['content-type'],
        location: res.headers.location,
        cacheControl: res.headers['cache-control'],
        body
      }));
    });
    req.on('error', reject);
  });
}

await new Promise((resolve) => setTimeout(resolve, 250));
const routes = ['/gpa', '/info', '/schedule', '/leaderboard', '/learning/CSC101', '/vocab', '/vocab/a1-0-3-0', '/vocab/set/11111111-1111-4111-8111-111111111111', '/vocab/set/11111111-1111-4111-8111-111111111111/quiz', '/grammar', '/grammar/path/11111111-1111-4111-8111-111111111111', '/grammar/lesson/11111111-1111-4111-8111-111111111111', '/clans/42', '/route-does-not-exist'];
for (const route of routes) {
  const response = await get(route);
  assert.equal(response.status, 200, `${route} must serve the SPA document`);
  assert.match(response.body, /<div id="root"><\/div>/, `${route} must serve the React entry`);
}
const api404 = await get('/api/does-not-exist', { Accept: 'application/json' });
assert.equal(api404.status, 404);
assert.match(api404.type || '', /json/);
for (const stylesheet of ['/css/style.css', '/css/showcase.css']) {
  const response = await get(stylesheet, { Accept: 'text/css' });
  assert.equal(response.status, 200, `${stylesheet} must remain available to the React shell`);
  assert.match(response.type || '', /css|text\/plain/);
}
const asset404 = await get('/app-assets/definitely-missing.js', { Accept: '*/*' });
assert.equal(asset404.status, 404, '/app-assets must 404 without redirecting');
assert.notEqual(asset404.status, 301);

const staleChunk = await get(`/app-assets/${staleChunkName}`, { Accept: '*/*' });
assert.equal(staleChunk.status, 200, 'chunk cũ trong asset history phải được phục vụ');
assert.match(staleChunk.cacheControl || '', /immutable/, 'chunk cũ vẫn là immutable hợp lệ');

// Tab đang mở so build id để biết có bản mới; SPA document không bao giờ được
// cache còn asset legacy phải revalidate để deploy không bị kẹt bản cũ.
const version = await get('/api/version', { Accept: 'application/json' });
assert.equal(version.status, 200, '/api/version must return 200');
assert.match(version.type || '', /json/);
assert.match(version.cacheControl || '', /no-store/, '/api/version must not be cached');
assert.ok(JSON.parse(version.body)?.build_id, '/api/version must expose build_id after npm run build:client');
const spaDocument = await get('/gpa');
assert.match(spaDocument.cacheControl || '', /no-store/, 'SPA document must be no-store');
const legacyCss = await get('/css/style.css', { Accept: 'text/css' });
assert.match(legacyCss.cacheControl || '', /no-cache/, 'legacy CSS must revalidate after deploy');

// Các URL thư mục từng bị serve-static trả 301(`/games` → `/games/`). Origin
// phải trả 0 mã 3xx để CDN/WAF phía trước không biến nó thành vòng lặp.
const gamesRoutes = ['/games', '/games/', '/games/room/EHDY004X?role=player', '/games/challenges/abc?code=xyz'];
for (const route of gamesRoutes) {
  const response = await get(route);
  assert.equal(response.status, 200, `${route} must return 200 (got ${response.status})`);
  assert.equal(response.location, undefined, `${route} must not send a Location header`);
  assert.ok(response.status < 300, `${route} must not be a 3xx redirect`);
  assert.match(response.body, /\/games\/games\.js/, `${route} must serve the static games site, not the portal SPA`);
}
for (const route of ['/admin', '/admin/']) {
  const response = await get(route);
  assert.equal(response.status, 200, `${route} must return 200 (got ${response.status})`);
  assert.equal(response.location, undefined, `${route} must not send a Location header`);
  assert.ok(response.status < 300, `${route} must not be a 3xx redirect`);
}
console.log(`✓ Routing smoke passed for ${routes.length} deep links, API 404, static /games + /admin and /app-assets 404`);
await new Promise((resolve) => server.close(resolve));
const { AssetHistoryService } = await import('../src/services/asset-history.service.js');
AssetHistoryService.stop();
await closeDatabase();
fs.rmSync(historyDir, { recursive: true, force: true });
