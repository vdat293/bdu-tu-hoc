import assert from 'node:assert/strict';
import { BduIdentityInternals, BduIdentityService } from '../src/services/bdu-identity.service.js';
import { BduService } from '../src/services/bdu.service.js';

const originalFetch = globalThis.fetch;
const originalGetProfile = BduService.getProfile;
const originalDateNow = Date.now;
const originalRestoredTtl = process.env.BDU_RESTORED_TOKEN_TTL_MS;

try {
  globalThis.fetch = async () => { throw new Error('connect ECONNREFUSED'); };
  await assert.rejects(
    BduService.getProfile('network-token'),
    (error) => error?.status === 503 && error?.code === 'AUTH_UNAVAILABLE' && error?.retryable === true
  );

  globalThis.fetch = async () => ({ status: 502, async json() { return { message: 'bad gateway' }; } });
  await assert.rejects(
    BduService.getProfile('gateway-token'),
    (error) => error?.status === 503 && error?.code === 'AUTH_UNAVAILABLE'
  );

  globalThis.fetch = async () => ({ status: 200, async json() { throw new SyntaxError('Unexpected token <'); } });
  await assert.rejects(
    BduService.getProfile('html-token'),
    (error) => error?.status === 503 && error?.code === 'AUTH_UNAVAILABLE'
  );

  globalThis.fetch = async () => ({ status: 401, async json() { return { result: false, code: 401 }; } });
  await assert.rejects(
    BduService.getProfile('expired-token'),
    (error) => error?.status === 401 && error?.code === 'AUTH_INVALID'
  );

  // A normal login registration has no restored-session TTL override and must
  // remain usable; `null` must never be coerced into a zero-millisecond TTL.
  BduIdentityService.register('fresh-login-token', '24050000');
  assert.equal(await BduIdentityService.resolveVerifiedMssv('fresh-login-token'), '24050000');
  BduIdentityService.clear('fresh-login-token');

  let calls = 0;
  let resolveProfile;
  BduService.getProfile = () => {
    calls += 1;
    return new Promise((resolve) => { resolveProfile = resolve; });
  };
  const first = BduIdentityService.resolveVerifiedMssv('single-flight-token');
  const second = BduIdentityService.resolveVerifiedMssv('Bearer single-flight-token');
  assert.equal(calls, 1, 'concurrent restored sockets must share one BDU verification');
  resolveProfile({ result: true, code: 200, data: { ma_sv: '24050001' } });
  assert.equal(await first, '24050001');
  assert.equal(await second, '24050001');
  BduIdentityService.clear('single-flight-token');

  BduService.getProfile = async () => ({ result: true, code: 200, data: { maintenance: true } });
  await assert.rejects(
    BduIdentityService.resolveVerifiedMssv('partial-profile-token'),
    (error) => error?.status === 503 && error?.code === 'AUTH_UNAVAILABLE'
  );
  BduIdentityService.clear('partial-profile-token');

  // Opaque login tokens must honor the authoritative expires_in, not remain in
  // the process cache for the old 24-hour fallback.
  calls = 0;
  BduIdentityService.register('expired-opaque-token', '24050002', { expiresIn: 0 });
  BduService.getProfile = async () => {
    calls += 1;
    return { result: true, code: 200, data: { ma_sv: '24050003' } };
  };
  assert.equal(await BduIdentityService.resolveVerifiedMssv('expired-opaque-token'), '24050003');
  assert.equal(calls, 1);
  BduIdentityService.clear('expired-opaque-token');

  // A token restored after a process restart has no login expires_in. It must
  // revalidate after the short restored-session TTL, not the old 24-hour cache.
  let now = 1_000_000;
  Date.now = () => now;
  process.env.BDU_RESTORED_TOKEN_TTL_MS = '50';
  calls = 0;
  BduService.getProfile = async () => {
    calls += 1;
    return { result: true, code: 200, data: { ma_sv: '24050004' } };
  };
  assert.equal(await BduIdentityService.resolveVerifiedMssv('restored-opaque-token'), '24050004');
  now += 49;
  assert.equal(await BduIdentityService.resolveVerifiedMssv('restored-opaque-token'), '24050004');
  assert.equal(calls, 1, 'restored token should use its short cache before TTL expiry');
  now += 2;
  assert.equal(await BduIdentityService.resolveVerifiedMssv('restored-opaque-token'), '24050004');
  assert.equal(calls, 2, 'restored opaque token must revalidate after restored-session TTL');
  BduIdentityService.clear('restored-opaque-token');

  const jwtWithEarlyExpiry = `x.${Buffer.from(JSON.stringify({ exp: 1001 })).toString('base64url')}.x`;
  assert.equal(
    BduIdentityInternals.tokenExpiresAt(jwtWithEarlyExpiry, undefined, 300_000),
    1_001_000,
    'an earlier JWT exp must beat the restored-session cache TTL'
  );

  console.log('✓ BDU identity classifies only confirmed invalid auth as fatal and single-flights restored WebSocket verification.');
} finally {
  BduService.getProfile = originalGetProfile;
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  if (originalRestoredTtl === undefined) delete process.env.BDU_RESTORED_TOKEN_TTL_MS;
  else process.env.BDU_RESTORED_TOKEN_TTL_MS = originalRestoredTtl;
}
