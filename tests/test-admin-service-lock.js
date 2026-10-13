import assert from 'node:assert/strict';
import { AdminDashboardController } from '../src/modules/admin/admin-dashboard.controller.js';
import { ServiceLockService, LOCKABLE_GROUPS } from '../src/services/service-lock.service.js';
import { CommunityRealtime } from '../src/services/community-realtime.service.js';

// Test cho API admin GET/PUT /api/admin/dashboard/service-lock theo nhóm (Task 6).
// Không cần DB: monkey-patch ServiceLockService.getAdminStatus/setGroupStatus và cổng
// realtime, rồi gọi thẳng handler với fake req/res. Controller không được tự biết
// key/shape của bảng setting nên test chỉ chạm interface của ServiceLockService.
// Mỗi ca in một dòng ✓/✗; cuối cùng đặt exitCode=1 nếu có ca đỏ để
// `node tests/test-admin-service-lock.js` fail-closed đúng cách.

const originalGetAdminStatus = ServiceLockService.getAdminStatus;
const originalSetGroupStatus = ServiceLockService.setGroupStatus;
const originalDisconnect = CommunityRealtime.disconnectAllForMaintenance;

let failed = 0;
let disconnectCalls = 0;
let setCalled = false;

async function check(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`✗ ${name}`);
    console.log(`    ${error && error.message ? error.message : error}`);
  }
}

// Fake `res` theo khuôn `response()` trong tests/test-profile-controller.js.
function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

// Dựng map groups đủ 10 nhóm lockable để stub trả về shape thật.
function sampleGroups(overrides = {}) {
  const groups = {};
  for (const { id } of LOCKABLE_GROUPS) {
    groups[id] = {
      locked: false,
      title: 'Dịch vụ đang tạm khóa để bảo trì',
      message: 'Hệ thống đang bảo trì, vui lòng quay lại sau.'
    };
  }
  for (const [id, entry] of Object.entries(overrides)) {
    groups[id] = entry;
  }
  return groups;
}

function sampleCatalog() {
  return LOCKABLE_GROUPS.map((group) => ({ ...group }));
}

function stubGetAdminStatus(data) {
  ServiceLockService.getAdminStatus = async () => data;
}

function stubSetGroupStatus(record) {
  ServiceLockService.setGroupStatus = async (...args) => {
    setCalled = true;
    ServiceLockService.__lastSetArgs = args;
    return record;
  };
}

try {
  // Spy cổng realtime: đếm số lần đóng kết nối khi bật khóa.
  CommunityRealtime.disconnectAllForMaintenance = () => {
    disconnectCalls += 1;
  };

  await check('GET trả groups + catalog đủ 10 nhóm lockable', async () => {
    stubGetAdminStatus({
      groups: sampleGroups(),
      catalog: sampleCatalog(),
      updated_at: '2026-10-12T00:00:00.000Z',
      updated_by: 'ADMIN_1'
    });
    const res = response();
    await AdminDashboardController.getServiceLock({}, res);
    assert.equal(res.statusCode, 200, 'phải trả 200');
    assert.equal(res.body.result, true, 'result phải là true');
    assert.equal(Object.keys(res.body.data.groups).length, 10, 'groups phải đủ 10 nhóm');
    assert.equal(res.body.data.catalog.length, 10, 'catalog phải đủ 10 mục');
    for (const item of res.body.data.catalog) {
      assert.equal(typeof item.id, 'string', 'mỗi mục catalog phải có id chuỗi');
      assert.equal(typeof item.label, 'string', 'mỗi mục catalog phải có label chuỗi');
    }
    assert.equal(res.body.data.updated_at, '2026-10-12T00:00:00.000Z');
    assert.equal(res.body.data.updated_by, 'ADMIN_1');
  });

  await check('GET vẫn 200 khi getAdminStatus fail-open', async () => {
    // Service tự fail-open; controller chỉ chuyển tiếp data.
    stubGetAdminStatus({
      groups: sampleGroups(),
      catalog: sampleCatalog(),
      updated_at: null,
      updated_by: null
    });
    const res = response();
    await AdminDashboardController.getServiceLock({}, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.groups.vocab.locked, false);
    assert.equal(res.body.data.updated_at, null);
    assert.equal(res.body.data.updated_by, null);
  });

  await check('PUT ghi theo nhóm, truyền đúng group + updatedBy là MSSV admin', async () => {
    setCalled = false;
    stubSetGroupStatus({
      groups: sampleGroups({ vocab: { locked: true, title: 'Bảo trì', message: 'Chờ chút' } }),
      updated_at: '2026-10-12T01:00:00.000Z',
      updated_by: 'TESTADMIN'
    });
    const res = response();
    await AdminDashboardController.setServiceLock(
      { identityAdminMssv: 'TESTADMIN', body: { group: 'vocab', locked: true, title: 'Bảo trì', message: 'Chờ chút' } },
      res
    );
    assert.equal(res.statusCode, 200, 'phải trả 200');
    assert.equal(setCalled, true, 'setGroupStatus phải được gọi');
    assert.deepEqual(
      ServiceLockService.__lastSetArgs[0],
      { group: 'vocab', locked: true, title: 'Bảo trì', message: 'Chờ chút' },
      'payload phải gồm group/locked/title/message'
    );
    assert.equal(ServiceLockService.__lastSetArgs[1], 'TESTADMIN', 'updatedBy phải là MSSV admin');
    assert.equal(res.body.data.updated_by, 'TESTADMIN');
    assert.equal(res.body.data.groups.vocab.locked, true);
  });

  await check('PUT không có identityAdminMssv dùng ADMIN_KEY', async () => {
    stubSetGroupStatus({ groups: sampleGroups(), updated_at: null, updated_by: 'ADMIN_KEY' });
    const res = response();
    await AdminDashboardController.setServiceLock({ body: { group: 'vocab', locked: false } }, res);
    assert.equal(ServiceLockService.__lastSetArgs[1], 'ADMIN_KEY', 'thiếu MSSV thì dùng ADMIN_KEY');
  });

  await check('PUT khóa community đóng WebSocket đúng 1 lần', async () => {
    stubSetGroupStatus({
      groups: sampleGroups({ community: { locked: true, title: 'T', message: 'M' } }),
      updated_at: null,
      updated_by: 'TESTADMIN'
    });
    disconnectCalls = 0;
    const res = response();
    await AdminDashboardController.setServiceLock(
      { identityAdminMssv: 'TESTADMIN', body: { group: 'community', locked: true } },
      res
    );
    assert.equal(disconnectCalls, 1, 'khóa community phải gọi disconnectAllForMaintenance đúng 1 lần');
  });

  await check('PUT khóa nhóm khác (vocab) KHÔNG đóng WebSocket', async () => {
    stubSetGroupStatus({
      groups: sampleGroups({ vocab: { locked: true, title: 'T', message: 'M' } }),
      updated_at: null,
      updated_by: 'TESTADMIN'
    });
    disconnectCalls = 0;
    const res = response();
    await AdminDashboardController.setServiceLock(
      { identityAdminMssv: 'TESTADMIN', body: { group: 'vocab', locked: true } },
      res
    );
    assert.equal(disconnectCalls, 0, 'khóa nhóm khác community không được đóng kết nối');
  });

  await check('PUT mở khóa community (locked:false) KHÔNG đóng WebSocket', async () => {
    stubSetGroupStatus({ groups: sampleGroups(), updated_at: null, updated_by: 'TESTADMIN' });
    disconnectCalls = 0;
    const res = response();
    await AdminDashboardController.setServiceLock(
      { identityAdminMssv: 'TESTADMIN', body: { group: 'community', locked: false } },
      res
    );
    assert.equal(disconnectCalls, 0, 'mở khóa không được đóng kết nối');
  });

  await check('PUT thiếu group trả 400, không gọi service', async () => {
    setCalled = false;
    stubSetGroupStatus({ groups: sampleGroups(), updated_at: null, updated_by: 'TESTADMIN' });
    const res = response();
    await AdminDashboardController.setServiceLock({ body: { locked: true } }, res);
    assert.equal(res.statusCode, 400, 'thiếu group phải trả 400');
    assert.equal(res.body.result, false);
    assert.equal(setCalled, false, 'không được gọi setGroupStatus khi body sai');
  });

  await check('PUT locked không phải boolean trả 400, không gọi service', async () => {
    setCalled = false;
    stubSetGroupStatus({ groups: sampleGroups(), updated_at: null, updated_by: 'TESTADMIN' });
    const res = response();
    await AdminDashboardController.setServiceLock(
      { body: { group: 'vocab', locked: 'true' } },
      res
    );
    assert.equal(res.statusCode, 400, 'locked sai kiểu phải trả 400');
    assert.equal(res.body.result, false);
    assert.equal(setCalled, false, 'không được gọi setGroupStatus khi body sai');
  });

  await check('PUT ô nội dung trống giữ nguyên (không biến thành null)', async () => {
    stubSetGroupStatus({ groups: sampleGroups(), updated_at: null, updated_by: 'TESTADMIN' });
    const res = response();
    await AdminDashboardController.setServiceLock(
      { identityAdminMssv: 'TESTADMIN', body: { group: 'vocab', locked: false, title: '', message: '' } },
      res
    );
    const payload = ServiceLockService.__lastSetArgs[0];
    assert.equal(payload.title, '', 'chuỗi rỗng phải giữ nguyên, không đổi thành null');
    assert.equal(payload.message, '', 'chuỗi rỗng phải giữ nguyên, không đổi thành null');

    // Thiếu hẳn trường cũng phải là undefined (service hiểu là dùng default).
    await AdminDashboardController.setServiceLock(
      { identityAdminMssv: 'TESTADMIN', body: { group: 'vocab', locked: false } },
      res
    );
    const bare = ServiceLockService.__lastSetArgs[0];
    assert.equal(bare.title, undefined, 'thiếu title phải là undefined, không phải null');
    assert.equal(bare.message, undefined, 'thiếu message phải là undefined, không phải null');
  });

  await check('PUT lỗi ngoài dự kiến trả 500 với chuỗi cố định, không lộ err.message', async () => {
    ServiceLockService.setGroupStatus = async () => {
      throw new Error('relation "system_settings" does not exist');
    };
    const res = response();
    await AdminDashboardController.setServiceLock(
      { identityAdminMssv: 'TESTADMIN', body: { group: 'vocab', locked: true } },
      res
    );
    assert.equal(res.statusCode, 500, 'lỗi không có status phải thành 500');
    assert.equal(res.body.result, false);
    assert.equal(
      res.body.message,
      'Không thể lưu trạng thái khóa dịch vụ.',
      '500 phải trả chuỗi cố định'
    );
    assert.doesNotMatch(res.body.message, /relation|system_settings/, 'không được lộ chi tiết DB');
  });

  await check('PUT lỗi validate từ service (status 400) giữ nguyên 400 và err.message', async () => {
    ServiceLockService.setGroupStatus = async () => {
      const error = new Error('Nhóm tính năng không hợp lệ hoặc không được phép khóa.');
      error.status = 400;
      throw error;
    };
    const res = response();
    await AdminDashboardController.setServiceLock(
      { identityAdminMssv: 'TESTADMIN', body: { group: 'portal', locked: true } },
      res
    );
    assert.equal(res.statusCode, 400, 'lỗi validate của service phải giữ 400');
    assert.equal(res.body.result, false);
    assert.equal(res.body.message, 'Nhóm tính năng không hợp lệ hoặc không được phép khóa.', '400 phải giữ nội dung validate');
  });
} finally {
  ServiceLockService.getAdminStatus = originalGetAdminStatus;
  ServiceLockService.setGroupStatus = originalSetGroupStatus;
  delete ServiceLockService.__lastSetArgs;
  CommunityRealtime.disconnectAllForMaintenance = originalDisconnect;
}

if (failed > 0) {
  console.log(`✗ Admin service-lock: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Admin service-lock: toàn bộ ca đạt.');
}
