import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { TrafficService, TrafficServiceInternals } from '../src/services/traffic.service.js';
import { AdminDashboardController } from '../src/controllers/admin-dashboard.controller.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';
import { attachRequestContext } from '../src/utils/request-context.js';
import { isDatabaseConfigured, query } from '../src/db/database.js';

console.log('--- Testing Traffic & Dashboard Service ---');

// Test 1: User Agent Parser
console.log('1. Testing parseUserAgent...');
const uaDesktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const resDesktop = TrafficService.parseUserAgent(uaDesktop);
assert.equal(resDesktop.deviceType, 'desktop');
assert.equal(resDesktop.os, 'macOS');
assert.equal(resDesktop.browser, 'Chrome');

const uaMobile = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const resMobile = TrafficService.parseUserAgent(uaMobile);
assert.equal(resMobile.deviceType, 'mobile');
assert.equal(resMobile.os, 'iOS');
assert.equal(resMobile.browser, 'Safari');

const uaAndroid = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const resAndroid = TrafficService.parseUserAgent(uaAndroid);
assert.equal(resAndroid.deviceType, 'mobile');
assert.equal(resAndroid.os, 'Android');
assert.equal(resAndroid.browser, 'Chrome');
console.log('✓ parseUserAgent passed');

// Test 1b: Route pattern resolution & query sanitizer
console.log('1b. Testing route pattern & query sanitizer...');
const { resolveRoutePattern, sanitizeQueryForLog, getTimeRangeInterval } = TrafficServiceInternals;

assert.equal(getTimeRangeInterval('all'), null, '"all" must not fall back to 24h');
assert.equal(getTimeRangeInterval('24h'), "INTERVAL '24 hours'");

assert.equal(
  resolveRoutePattern({ baseUrl: '/api', route: { path: '/students/:mssv/profile' }, path: '/api/students/123/profile' }),
  '/api/students/:mssv/profile'
);
assert.equal(
  resolveRoutePattern({ baseUrl: '/api', route: { path: ['/a', '/b'] }, path: '/a' }),
  '/api/a'
);
assert.equal(
  resolveRoutePattern({ route: undefined, path: '/some/404/path', originalUrl: '/some/404/path?x=1' }),
  '/some/404/path'
);

assert.equal(sanitizeQueryForLog({}), null);
const sanitized = JSON.parse(sanitizeQueryForLog({
  token: 'super-secret',
  password: 'hunter2',
  courseCode: 'IT001',
  nested: { refresh_token: 'zzz', keep: 1 }
}));
assert.equal(sanitized.token, '[REDACTED]');
assert.equal(sanitized.password, '[REDACTED]');
assert.equal(sanitized.courseCode, 'IT001', 'non-sensitive params must be preserved');
assert.equal(sanitized.nested.refresh_token, '[REDACTED]');
assert.equal(sanitized.nested.keep, 1);
console.log('✓ route pattern & query sanitizer passed');

// Test 1c: Request context identity capture
console.log('1c. Testing request context identity capture...');
const fakeReq = {};
await new Promise((resolve, reject) => {
  attachRequestContext(fakeReq, {}, () => {
    BduIdentityService.register('context-test-token', 'CTX12345', { expiresIn: 60 });
    BduIdentityService.resolveVerifiedMssv('Bearer context-test-token')
      .then((mssv) => {
        try {
          assert.equal(mssv, 'CTX12345');
          assert.equal(fakeReq.verifiedMssv, 'CTX12345', 'request must be marked with the verified MSSV');
          resolve();
        } catch (error) {
          reject(error);
        }
      })
      .catch(reject);
  });
});
assert.equal(BduIdentityService.peek('context-test-token'), 'CTX12345');
assert.equal(BduIdentityService.peek('unknown-token-xyz'), null);
console.log('✓ identity context capture passed');

// Test 2: Database logging and queries
if (isDatabaseConfigured()) {
  console.log('2. Testing database logging & aggregation...');
  const testMssv = 'TESTADMIN' + Date.now().toString().slice(-4);

  // Enqueue test items
  TrafficService.enqueue({
    method: 'GET',
    path: '/api/grades',
    route: '/api/grades',
    queryJson: JSON.stringify({ course: 'IT001' }),
    statusCode: 200,
    responseTimeMs: 45.2,
    mssv: testMssv,
    fullName: 'Sinh Viên Test',
    ip: '127.0.0.1',
    userAgent: uaDesktop,
    deviceType: 'desktop',
    os: 'macOS',
    browser: 'Chrome',
    referrer: 'http://localhost:3000/gpa',
    errorMessage: null,
    createdAt: new Date()
  });

  TrafficService.enqueue({
    method: 'POST',
    path: '/api/schedule',
    route: '/api/schedule',
    queryJson: null,
    statusCode: 400,
    responseTimeMs: 120.5,
    mssv: testMssv,
    fullName: 'Sinh Viên Test',
    ip: '127.0.0.1',
    userAgent: uaMobile,
    deviceType: 'mobile',
    os: 'iOS',
    browser: 'Safari',
    referrer: 'http://localhost:3000/schedule',
    errorMessage: 'Học kỳ không hợp lệ',
    createdAt: new Date()
  });

  // Flush to database
  await TrafficService.flush();

  // Verify getOverviewStats
  const overview = await TrafficService.getOverviewStats({ timeRange: '1h' });
  assert(overview.totalRequests >= 2, 'Total requests should be at least 2');
  assert(overview.errorRate >= 0, 'Error rate should be non-negative');
  console.log('✓ getOverviewStats:', overview);

  // Verify getTimeline
  const timeline = await TrafficService.getTimeline({ timeRange: '1h' });
  assert(Array.isArray(timeline), 'Timeline should return an array');
  assert(timeline.length > 0, 'Timeline should have at least 1 bucket');
  console.log('✓ getTimeline count:', timeline.length);

  // Verify getTopEndpoints
  const endpoints = await TrafficService.getTopEndpoints({ timeRange: '1h', limit: 50 });
  assert(Array.isArray(endpoints), 'Endpoints should return an array');
  assert(endpoints.some(e => e.path === '/api/grades' || e.path === '/api/schedule'));
  console.log('✓ getTopEndpoints:', endpoints.length);

  // Verify getTopUsers
  const topUsers = await TrafficService.getTopUsers({ timeRange: '1h', limit: 50 });
  assert(Array.isArray(topUsers));
  assert(topUsers.some(u => u.mssv === testMssv));
  console.log('✓ getTopUsers found test student:', testMssv);

  // Verify getDeviceStats
  const devices = await TrafficService.getDeviceStats({ timeRange: '1h' });
  assert(Array.isArray(devices.devices));
  assert(Array.isArray(devices.os));
  assert(Array.isArray(devices.browsers));
  console.log('✓ getDeviceStats passed');

  // Verify getDetailedLogs with filtering
  const logs = await TrafficService.getDetailedLogs({
    mssv: testMssv,
    page: 1,
    limit: 10
  });
  assert.equal(logs.pagination.total, 2);
  assert.equal(logs.logs.length, 2);
  assert.equal(logs.logs[0].mssv, testMssv);
  assert(logs.logs.some((row) => row.route === '/api/grades'));
  const gradeLog = logs.logs.find((row) => row.route === '/api/grades');
  assert.equal(gradeLog.query.course, 'IT001');
  console.log('✓ getDetailedLogs filtered by MSSV:', logs.logs.length);

  // Verify status filter
  const errorLogs = await TrafficService.getDetailedLogs({
    mssv: testMssv,
    status: '4xx'
  });
  assert.equal(errorLogs.pagination.total, 1);
  assert.equal(errorLogs.logs[0].statusCode, 400);
  console.log('✓ getDetailedLogs filtered by 4xx status');

  // Verify route filter
  const routeLogs = await TrafficService.getDetailedLogs({
    mssv: testMssv,
    route: '/api/grades'
  });
  assert.equal(routeLogs.pagination.total, 1);
  assert.equal(routeLogs.logs[0].route, '/api/grades');
  console.log('✓ getDetailedLogs filtered by route');

  // Verify middleware captures route, sanitized query and MSSV
  const middleware = TrafficService.middleware();
  const finishHandlers = [];
  const mockRes = {
    statusCode: 200,
    on(event, cb) {
      if (event === 'finish') finishHandlers.push(cb);
    },
    getHeader() {
      return null;
    }
  };
  const mockReq = {
    method: 'GET',
    originalUrl: '/api/rankings/me?token=SUPERSECRET&course=IT001',
    url: '/api/rankings/me?token=SUPERSECRET&course=IT001',
    path: '/api/rankings/me',
    baseUrl: '/api',
    route: { path: '/rankings/me' },
    headers: { authorization: 'Bearer context-test-token', 'user-agent': uaDesktop },
    query: { token: 'SUPERSECRET', course: 'IT001' },
    body: {},
    socket: { remoteAddress: '127.0.0.1' },
    verifiedMssv: 'CTX12345'
  };
  middleware(mockReq, mockRes, () => {});
  finishHandlers.forEach((handler) => handler());
  await TrafficService.flush();

  const captured = await query(
    `SELECT mssv, route, query_json FROM traffic_logs WHERE path = $1 ORDER BY id DESC LIMIT 1`,
    [mockReq.originalUrl]
  );
  assert.equal(captured.rows[0].mssv, 'CTX12345', 'middleware must persist the resolved MSSV');
  assert.equal(captured.rows[0].route, '/api/rankings/me', 'middleware must persist the matched route pattern');
  const capturedQuery = JSON.parse(captured.rows[0].query_json);
  assert.equal(capturedQuery.token, '[REDACTED]');
  assert.equal(capturedQuery.course, 'IT001');
  await query('DELETE FROM traffic_logs WHERE mssv = $1', ['CTX12345']);
  console.log('✓ middleware route/query/MSSV capture passed');

  // Verify per-student activity aggregation
  const activity = await TrafficService.getUserActivity({ mssv: testMssv, timeRange: '1h' });
  assert.equal(activity.summary.totalRequests, 2);
  assert.equal(activity.summary.errorCount, 1);
  assert(activity.routes.some((row) => row.route === '/api/grades'));
  assert(activity.routes.some((row) => row.route === '/api/schedule'));
  console.log('✓ getUserActivity aggregation passed');

  // Verify distinct route catalog
  const distinctRoutes = await TrafficService.getDistinctRoutes({ timeRange: '1h' });
  assert(distinctRoutes.some((row) => row.route === '/api/grades' && row.method === 'GET'));
  console.log('✓ getDistinctRoutes passed');

  // Clean up test logs
  await query('DELETE FROM traffic_logs WHERE mssv = $1', [testMssv]);
  console.log('✓ Cleaned up test records');
}

// Test 3: System Metrics
console.log('3. Testing getSystemMetrics...');
const metrics = await TrafficService.getSystemMetrics();
assert(metrics.server.uptimeSeconds >= 0);
assert(metrics.memory.heapUsedMb > 0);
assert(typeof metrics.realtime.connected_clients === 'number');
console.log('✓ getSystemMetrics passed:', metrics.memory);

// Test 4: Auth middleware check with admin key
console.log('4. Testing AdminDashboardController.requireAdmin with key...');
process.env.ADMIN_DASHBOARD_KEY = 'super-secret-test-key';
let nextCalled = false;
const reqKey = {
  headers: { 'x-admin-key': 'super-secret-test-key' },
  query: {}
};
const resMock = {
  status(code) {
    return {
      json(payload) {
        return { statusCode: code, payload };
      }
    };
  }
};
await AdminDashboardController.requireAdmin(reqKey, resMock, () => {
  nextCalled = true;
});
assert.equal(nextCalled, true, 'Next should be called when valid admin key provided');
console.log('✓ Admin key authorization passed');

// Test unauthenticated
let blockedStatus = null;
const reqInvalid = {
  headers: {},
  query: {}
};
const resInvalid = {
  status(code) {
    blockedStatus = code;
    return {
      json(payload) { return payload; }
    };
  }
};
await AdminDashboardController.requireAdmin(reqInvalid, resInvalid, () => {});
assert.equal(blockedStatus, 401, 'Should block unauthorized request with 401');
console.log('✓ Unauthorized request correctly rejected with 401');

// Test 5: The owner MSSV must never work as an admin key
console.log('5. Testing ADMIN_DASHBOARD_KEY-only key auth...');
process.env.SYSTEM_OWNER_MSSV = '24050126';
process.env.ADMIN_DASHBOARD_KEY = 'super-secret-test-key';

let ownerKeyPassed = false;
let ownerKeyStatus = null;
const reqOwnerKey = {
  headers: { 'x-admin-key': '24050126' },
  query: {},
  socket: {}
};
const resOwnerKey = {
  status(code) {
    ownerKeyStatus = code;
    return { json(payload) { return payload; } };
  },
  json(payload) { return payload; }
};
await AdminDashboardController.requireAdmin(reqOwnerKey, resOwnerKey, () => {
  ownerKeyPassed = true;
});
assert.equal(ownerKeyPassed, false, 'SYSTEM_OWNER_MSSV must never authorize as an admin key');
assert.equal(ownerKeyStatus, 401, 'MSSV-as-key must be rejected with 401');
console.log('✓ owner MSSV rejected as admin key');

// Login with the owner MSSV as "key" must fail
let badLoginStatus = null;
let badLoginPayload = null;
const reqBadLogin = {
  body: { key: '24050126' },
  headers: {},
  socket: {}
};
const resBadLogin = {
  status(code) {
    badLoginStatus = code;
    return {
      json(data) {
        badLoginPayload = data;
        return data;
      }
    };
  },
  json(data) { badLoginPayload = data; return data; }
};
await AdminDashboardController.login(reqBadLogin, resBadLogin);
assert.notEqual(badLoginPayload?.result, true, 'MSSV must not unlock the dashboard');
assert.equal(badLoginStatus, 401);
assert(!String(badLoginPayload?.message || '').includes('24050126'), 'error must not echo the owner MSSV');
console.log('✓ login with owner MSSV rejected');

// Login with the configured technical key must succeed
let keyLoginStatus = null;
let keyLoginPayload = null;
const reqKeyLogin = {
  body: { key: 'super-secret-test-key' },
  headers: {},
  socket: {}
};
const resKeyLogin = {
  status(code) {
    keyLoginStatus = code;
    return {
      json(data) {
        keyLoginPayload = data;
        return data;
      }
    };
  },
  json(data) { keyLoginPayload = data; return data; }
};
await AdminDashboardController.login(reqKeyLogin, resKeyLogin);
assert.equal(keyLoginStatus, null, 'valid key login must not set an error status');
assert.equal(keyLoginPayload?.result, true);
assert.equal(keyLoginPayload?.adminKey, 'super-secret-test-key');
assert.equal(keyLoginPayload?.mssv, undefined, 'key login must not expose an owner MSSV');
console.log('✓ login with ADMIN_DASHBOARD_KEY passed');

// Test 6: The static admin login page must not leak the owner MSSV
console.log('6. Testing admin login page leaks...');
const adminHtml = await fs.readFile(new URL('../public/admin/index.html', import.meta.url), 'utf8');
assert(!adminHtml.includes('24050126'), 'admin login page must not hardcode the owner MSSV');
assert(!adminHtml.includes('SYSTEM_OWNER_MSSV'), 'admin login page must not reveal the owner env var');
console.log('✓ admin login page does not leak owner identity');

console.log('\n✅ ALL TRAFFIC & DASHBOARD BACKEND TESTS PASSED!');
process.exit(0);
