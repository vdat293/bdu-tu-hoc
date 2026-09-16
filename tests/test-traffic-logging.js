import assert from 'node:assert/strict';
import { TrafficService } from '../src/services/traffic.service.js';
import { AdminDashboardController } from '../src/controllers/admin-dashboard.controller.js';
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

// Test 2: Database logging and queries
if (isDatabaseConfigured()) {
  console.log('2. Testing database logging & aggregation...');
  const testMssv = 'TESTADMIN' + Date.now().toString().slice(-4);

  // Enqueue test items
  TrafficService.enqueue({
    method: 'GET',
    path: '/api/grades',
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
  const endpoints = await TrafficService.getTopEndpoints({ timeRange: '1h', limit: 10 });
  assert(Array.isArray(endpoints), 'Endpoints should be an array');
  assert(endpoints.some(e => e.path === '/api/grades' || e.path === '/api/schedule'));
  console.log('✓ getTopEndpoints:', endpoints.length);

  // Verify getTopUsers
  const topUsers = await TrafficService.getTopUsers({ timeRange: '1h', limit: 10 });
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
  console.log('✓ getDetailedLogs filtered by MSSV:', logs.logs.length);

  // Verify status filter
  const errorLogs = await TrafficService.getDetailedLogs({
    mssv: testMssv,
    status: '4xx'
  });
  assert.equal(errorLogs.pagination.total, 1);
  assert.equal(errorLogs.logs[0].statusCode, 400);
  console.log('✓ getDetailedLogs filtered by 4xx status');

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

// Test 5: SYSTEM_OWNER_MSSV as admin key and login
console.log('5. Testing SYSTEM_OWNER_MSSV authorization...');
process.env.SYSTEM_OWNER_MSSV = '24050126';
let ownerKeyPassed = false;
const reqOwnerKey = {
  headers: { 'x-admin-key': '24050126' },
  query: {}
};
await AdminDashboardController.requireAdmin(reqOwnerKey, resMock, () => {
  ownerKeyPassed = true;
});
assert.equal(ownerKeyPassed, true, 'SYSTEM_OWNER_MSSV should authorize directly as admin key');
console.log('✓ SYSTEM_OWNER_MSSV direct key authorization passed');

// Test login endpoint with key matching SYSTEM_OWNER_MSSV
let loginResult = null;
const reqLogin = {
  body: { key: '24050126' }
};
const resLogin = {
  json(data) { loginResult = data; return data; },
  status(code) { return { json(data) { loginResult = data; return data; } }; }
};
await AdminDashboardController.login(reqLogin, resLogin);
assert.equal(loginResult.result, true);
assert.equal(loginResult.mssv, '24050126');
console.log('✓ Admin login endpoint with SYSTEM_OWNER_MSSV passed');

console.log('\n✅ ALL TRAFFIC & DASHBOARD BACKEND TESTS PASSED!');
process.exit(0);
