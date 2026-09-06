import assert from 'node:assert/strict';
import http from 'node:http';
import { closeDatabase } from '../src/db/database.js';

const port = Number(process.env.PORT || 3098);
process.env.PORT = String(port);
const server = (await import('../server.js')).default;

function get(path, headers = { Accept: 'text/html' }) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}${path}`, { headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    });
    req.on('error', reject);
  });
}

await new Promise((resolve) => setTimeout(resolve, 250));
const routes = ['/gpa', '/info', '/schedule', '/leaderboard', '/learning/CSC101', '/clans/42', '/route-does-not-exist'];
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
const asset404 = await get('/app-assets/does-not-exist.js', { Accept: '*/*' });
assert.equal(asset404.status, 404);
console.log(`✓ Routing smoke passed for ${routes.length} deep links and API 404`);
await new Promise((resolve) => server.close(resolve));
await closeDatabase();
