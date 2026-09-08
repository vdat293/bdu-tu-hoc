import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { CommunityRealtime, CommunityRealtimeInternals } from '../src/services/community-realtime.service.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';

function requestWith(headers) {
  return { headers };
}

const originalTrustProxy = process.env.WS_TRUST_PROXY;
const originalAllowedOrigins = process.env.WS_ALLOWED_ORIGINS;
delete process.env.WS_TRUST_PROXY;
delete process.env.WS_ALLOWED_ORIGINS;

assert.equal(CommunityRealtimeInternals.isAllowedOrigin(requestWith({
  host: 'bdu-hub:3000',
  origin: 'https://portal.example.edu.vn',
  'x-forwarded-host': 'portal.example.edu.vn'
})), false, 'must not trust a forwarded host unless the proxy is explicitly trusted');
assert.equal(CommunityRealtimeInternals.isAllowedOrigin(requestWith({
  host: 'bdu-hub:3000',
  origin: 'https://untrusted.example.edu.vn',
  'x-forwarded-host': 'untrusted.example.edu.vn'
})), false, 'a forged forwarded host must not permit an unrelated origin');
assert.equal(CommunityRealtimeInternals.isAllowedOrigin(requestWith({
  host: 'bdu-hub:3000',
  origin: 'not a valid origin'
})), false, 'malformed origins must be rejected');
assert.equal(CommunityRealtimeInternals.isAllowedOrigin(requestWith({
  host: 'bdu-hub:3000'
})), true, 'non-browser clients may omit Origin and must authenticate separately');

process.env.WS_TRUST_PROXY = 'true';
assert.equal(CommunityRealtimeInternals.isAllowedOrigin(requestWith({
  host: 'bdu-hub:3000',
  origin: 'https://portal.example.edu.vn',
  'x-forwarded-host': 'portal.example.edu.vn'
})), true, 'trusted reverse proxies may preserve the public host in X-Forwarded-Host');
assert.equal(CommunityRealtimeInternals.isAllowedOrigin(requestWith({
  host: 'bdu-hub:3000',
  origin: 'https://portal.example.edu.vn',
  forwarded: 'for=192.0.2.42;host=portal.example.edu.vn;proto=https'
})), true, 'trusted reverse proxies may use the standard Forwarded header');

process.env.WS_TRUST_PROXY = 'false';
process.env.WS_ALLOWED_ORIGINS = 'https://portal.example.edu.vn';
assert.equal(CommunityRealtimeInternals.isAllowedOrigin(requestWith({
  host: 'bdu-hub:3000',
  origin: 'https://portal.example.edu.vn'
})), true, 'explicit origin allowlists support separate frontend origins');
assert.equal(CommunityRealtimeInternals.isAllowedOrigin(requestWith({
  host: 'untrusted.example.edu.vn',
  origin: 'https://untrusted.example.edu.vn'
})), false, 'an allowlist must remain authoritative over the request host');
assert.equal(CommunityRealtimeInternals.isAllowedOrigin(requestWith({
  host: 'portal.example.edu.vn',
  origin: 'http://portal.example.edu.vn'
})), false, 'an allowlist must match the complete origin, including its scheme');

delete process.env.WS_ALLOWED_ORIGINS;
process.env.WS_TRUST_PROXY = 'true';
BduIdentityService.register('realtime-test-token', '24050001');

const server = createServer();
CommunityRealtime.attach(server);
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();

const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/community`, {
  origin: 'https://portal.example.edu.vn',
  headers: {
    Host: 'bdu-hub:3000',
    'X-Forwarded-Host': 'portal.example.edu.vn'
  }
});
const [hello] = await once(socket, 'message');
assert.deepEqual(JSON.parse(hello.toString()), {
  type: 'hello', protocol: 1, requiresAuthMessage: true
});

socket.send(JSON.stringify({ type: 'auth', token: 'realtime-test-token' }));
const [authenticated] = await once(socket, 'message');
assert.deepEqual(JSON.parse(authenticated.toString()), {
  type: 'auth.ok', mssv: '24050001', rooms: ['forum']
});

socket.send(JSON.stringify({ type: 'subscribe', room: 'forum' }));
const [subscribed] = await once(socket, 'message');
assert.deepEqual(JSON.parse(subscribed.toString()), { type: 'subscribed', room: 'forum' });

socket.close();
await once(socket, 'close');
CommunityRealtime.close();
await new Promise((resolve) => server.close(resolve));
BduIdentityService.clear('realtime-test-token');

if (originalTrustProxy === undefined) delete process.env.WS_TRUST_PROXY;
else process.env.WS_TRUST_PROXY = originalTrustProxy;
if (originalAllowedOrigins === undefined) delete process.env.WS_ALLOWED_ORIGINS;
else process.env.WS_ALLOWED_ORIGINS = originalAllowedOrigins;

console.log('✓ WebSocket upgrade, authentication and subscriptions work through a trusted reverse proxy.');
