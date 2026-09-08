import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { CommunityRealtime, CommunityRealtimeInternals } from '../src/services/community-realtime.service.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';
import { BduService } from '../src/services/bdu.service.js';

function requestWith(headers) {
  return { headers };
}

const originalTrustProxy = process.env.WS_TRUST_PROXY;
const originalAllowedOrigins = process.env.WS_ALLOWED_ORIGINS;
const originalAuthTimeout = process.env.WS_AUTH_TIMEOUT_MS;
const originalGetProfile = BduService.getProfile;
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

// A restored session can need an external BDU profile check. The local auth
// deadline must not cut that check off, and its eventual completion must not
// resurrect a client which disconnected while waiting.
process.env.WS_AUTH_TIMEOUT_MS = '15';
let resolveDelayedProfile;
BduService.getProfile = () => new Promise((resolve) => { resolveDelayedProfile = resolve; });
const delayedAuthSocket = new WebSocket(`ws://127.0.0.1:${port}/ws/community`, {
  origin: 'https://portal.example.edu.vn',
  headers: { Host: 'bdu-hub:3000', 'X-Forwarded-Host': 'portal.example.edu.vn' }
});
await once(delayedAuthSocket, 'message');
delayedAuthSocket.send(JSON.stringify({ type: 'auth', token: 'delayed-auth-token' }));
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(delayedAuthSocket.readyState, WebSocket.OPEN, 'an in-flight BDU resolver must outlive the auth deadline');
const delayedClose = once(delayedAuthSocket, 'close');
delayedAuthSocket.close();
await delayedClose;
resolveDelayedProfile({ result: true, code: 200, data: { ma_sv: '24050002' } });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(CommunityRealtime.clients.size, 0);
assert.equal(CommunityRealtime.rooms.size, 0, 'a late auth resolution must not add a detached client to forum');
BduIdentityService.clear('delayed-auth-token');

// Likewise, a slow room authorization must not add a closed socket after its
// await resumes. This is the same race a DB stall can trigger on a VPS.
BduIdentityService.register('delayed-subscribe-token', '24050003');
const originalCanJoin = CommunityRealtime.canJoin;
let resolveCanJoin;
CommunityRealtime.canJoin = () => new Promise((resolve) => { resolveCanJoin = resolve; });
const delayedSubscribeSocket = new WebSocket(`ws://127.0.0.1:${port}/ws/community`, {
  origin: 'https://portal.example.edu.vn',
  headers: { Host: 'bdu-hub:3000', 'X-Forwarded-Host': 'portal.example.edu.vn' }
});
await once(delayedSubscribeSocket, 'message');
delayedSubscribeSocket.send(JSON.stringify({ type: 'auth', token: 'delayed-subscribe-token' }));
const [delayedAuthenticated] = await once(delayedSubscribeSocket, 'message');
assert.equal(JSON.parse(delayedAuthenticated.toString()).type, 'auth.ok');
delayedSubscribeSocket.send(JSON.stringify({ type: 'subscribe', room: 'community-post:99' }));
const delayedSubscribeClose = once(delayedSubscribeSocket, 'close');
delayedSubscribeSocket.close();
await delayedSubscribeClose;
resolveCanJoin(true);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(CommunityRealtime.rooms.has('community-post:99'), false, 'a late subscribe must not retain a disconnected client');
CommunityRealtime.canJoin = originalCanJoin;
BduIdentityService.clear('delayed-subscribe-token');

// The socket can remain open while a comments panel closes. Unsubscribe must
// win over an earlier subscribe whose database authorization is still pending.
BduIdentityService.register('unsubscribe-wins-token', '24050004');
let resolveUnsubscribeRace;
CommunityRealtime.canJoin = () => new Promise((resolve) => { resolveUnsubscribeRace = resolve; });
const unsubscribeWinsSocket = new WebSocket(`ws://127.0.0.1:${port}/ws/community`, {
  origin: 'https://portal.example.edu.vn',
  headers: { Host: 'bdu-hub:3000', 'X-Forwarded-Host': 'portal.example.edu.vn' }
});
await once(unsubscribeWinsSocket, 'message');
unsubscribeWinsSocket.send(JSON.stringify({ type: 'auth', token: 'unsubscribe-wins-token' }));
await once(unsubscribeWinsSocket, 'message');
unsubscribeWinsSocket.send(JSON.stringify({ type: 'subscribe', room: 'community-post:100' }));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(typeof resolveUnsubscribeRace, 'function');
unsubscribeWinsSocket.send(JSON.stringify({ type: 'unsubscribe', room: 'community-post:100' }));
resolveUnsubscribeRace(true);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(CommunityRealtime.rooms.has('community-post:100'), false, 'unsubscribe must prevent a delayed authorization from joining');
const unsubscribeWinsClose = once(unsubscribeWinsSocket, 'close');
unsubscribeWinsSocket.close();
await unsubscribeWinsClose;
CommunityRealtime.canJoin = originalCanJoin;
BduIdentityService.clear('unsubscribe-wins-token');

assert.equal(CommunityRealtimeInternals.communityPostRoom(42), 'community-post:42');
assert.equal(CommunityRealtimeInternals.coursePostRoom(42), 'course-post:42');

CommunityRealtime.close();
await new Promise((resolve) => server.close(resolve));
BduIdentityService.clear('realtime-test-token');
BduService.getProfile = originalGetProfile;

if (originalTrustProxy === undefined) delete process.env.WS_TRUST_PROXY;
else process.env.WS_TRUST_PROXY = originalTrustProxy;
if (originalAllowedOrigins === undefined) delete process.env.WS_ALLOWED_ORIGINS;
else process.env.WS_ALLOWED_ORIGINS = originalAllowedOrigins;
if (originalAuthTimeout === undefined) delete process.env.WS_AUTH_TIMEOUT_MS;
else process.env.WS_AUTH_TIMEOUT_MS = originalAuthTimeout;

console.log('✓ WebSocket upgrade, authentication and subscriptions work through a trusted reverse proxy.');
