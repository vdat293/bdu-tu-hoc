import assert from 'node:assert/strict';
import { AdminDashboardController } from '../src/modules/admin/admin-dashboard.controller.js';
import { ServiceLockService } from '../src/services/service-lock.service.js';
import { SystemSettingsService } from '../src/services/system-settings.service.js';
import { CommunityRealtime } from '../src/services/community-realtime.service.js';

// Test cho API admin GET/PUT /api/admin/dashboard/service-lock (Task 5).
// Không cần DB: monkey-patch ServiceLockService.getStatus/setStatus,
// SystemSettingsService.getRecord và cổng realtime, rồi gọi thẳng handler với
// fake req/res. Mỗi ca in một dòng ✓/✗; cuối cùng đặt exitCode=1 nếu có ca đỏ
// để `node tests/test-admin-service-lock.js` fail-closed đúng cách.

const originalGetStatus = ServiceLockService.getStatus;
const originalSetStatus = ServiceLockService.setStatus;
const originalGetRecord = SystemSettingsService.getRecord;
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

function stubGetStatus(status) {
  ServiceLockService.getStatus = async () => status;
}

function stubGetRecord(record) {
  SystemSettingsService.getRecord = async () => record;
}

function stubSetStatus(record) {
  ServiceLockService.setStatus = async (...args) => {
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

  await check('GET trả trạng thái kèm metadata người ghi', async () => {
    stubGetStatus({ locked: false, title: 'T', message: 'M' });
    stubGetRecord({
      key: 'service_lock',
      value: { locked: false },
      updated_at: '2026-10-12T00:00:00.000Z',
      updated_by: 'ADMIN_1'
    });
    const res = response();
    await AdminDashboardController.getServiceLock({}, res);
    assert.equal(res.statusCode, 200, 'phải trả 200');
    assert.equal(res.body.result, true, 'result phải là true');
    assert.equal(res.body.data.locked, false, 'data.locked theo giá trị service trả');
    assert.equal(res.body.data.title, 'T');
    assert.equal(res.body.data.message, 'M');
    assert.equal(res.body.data.updated_at, '2026-10-12T00:00:00.000Z');
    assert.equal(res.body.data.updated_by, 'ADMIN_1');
  });

  await check('GET chịu được lỗi đọc metadata (updated_* về null)', async () => {
    stubGetStatus({ locked: false, title: 'T', message: 'M' });
    SystemSettingsService.getRecord = async () => {
      throw new Error('DB đang lỗi');
    };
    const res = response();
    await AdminDashboardController.getServiceLock({}, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.locked, false);
    assert.equal(res.body.data.updated_at, null);
    assert.equal(res.body.data.updated_by, null);
  });

  await check('PUT ghi và trả record, truyền đúng updatedBy là MSSV admin', async () => {
    setCalled = false;
    stubSetStatus({
      locked: true,
      title: 'Bảo trì',
      message: 'Chờ chút',
      updated_at: '2026-10-12T01:00:00.000Z',
      updated_by: 'TESTADMIN'
    });
    const res = response();
    await AdminDashboardController.setServiceLock(
      { identityAdminMssv: 'TESTADMIN', body: { locked: true, title: 'Bảo trì', message: 'Chờ chút' } },
      res
    );
    assert.equal(res.statusCode, 200, 'phải trả 200');
    assert.equal(setCalled, true, 'setStatus phải được gọi');
    assert.deepEqual(
      ServiceLockService.__lastSetArgs[0],
      { locked: true, title: 'Bảo trì', message: 'Chờ chút' },
      'payload phải được chuyển nguyên vẹn'
    );
    assert.equal(ServiceLockService.__lastSetArgs[1], 'TESTADMIN', 'updatedBy phải là MSSV admin');
    assert.equal(res.body.data.updated_by, 'TESTADMIN');
    assert.equal(res.body.data.locked, true);
  });

  await check('PUT không có identityAdminMssv dùng ADMIN_KEY', async () => {
    stubSetStatus({ locked: false, title: 'T', message: 'M', updated_at: null, updated_by: 'ADMIN_KEY' });
    const res = response();
    await AdminDashboardController.setServiceLock({ body: { locked: false } }, res);
    assert.equal(ServiceLockService.__lastSetArgs[1], 'ADMIN_KEY', 'thiếu MSSV thì dùng ADMIN_KEY');
  });

  await check('PUT locked:true đóng WebSocket đúng 1 lần', async () => {
    stubSetStatus({ locked: true, title: 'T', message: 'M', updated_at: null, updated_by: 'TESTADMIN' });
    disconnectCalls = 0;
    const res = response();
    await AdminDashboardController.setServiceLock(
      { identityAdminMssv: 'TESTADMIN', body: { locked: true } },
      res
    );
    assert.equal(disconnectCalls, 1, 'bật khóa phải gọi disconnectAllForMaintenance đúng 1 lần');
  });

  await check('PUT locked:false KHÔNG đóng WebSocket', async () => {
    stubSetStatus({ locked: false, title: 'T', message: 'M', updated_at: null, updated_by: 'TESTADMIN' });
    disconnectCalls = 0;
    const res = response();
    await AdminDashboardController.setServiceLock(
      { identityAdminMssv: 'TESTADMIN', body: { locked: false } },
      res
    );
    assert.equal(disconnectCalls, 0, 'mở khóa không được đóng kết nối');
  });

  await check('PUT body sai (locked không phải boolean) trả 400, không gọi service', async () => {
    setCalled = false;
    stubSetStatus({ locked: true });
    const res = response();
    await AdminDashboardController.setServiceLock({ body: { locked: 'true' } }, res);
    assert.equal(res.statusCode, 400, 'locked sai kiểu phải trả 400');
    assert.equal(res.body.result, false);
    assert.equal(setCalled, false, 'không được gọi setStatus khi body sai');
  });

  await check('PUT ô nội dung trống giữ nguyên (không biến thành null)', async () => {
    stubSetStatus({ locked: false, title: 'T', message: 'M', updated_at: null, updated_by: 'TESTADMIN' });
    const res = response();
    await AdminDashboardController.setServiceLock(
      { identityAdminMssv: 'TESTADMIN', body: { locked: false, title: '', message: '' } },
      res
    );
    const payload = ServiceLockService.__lastSetArgs[0];
    assert.equal(payload.title, '', 'chuỗi rỗng phải giữ nguyên, không đổi thành null');
    assert.equal(payload.message, '', 'chuỗi rỗng phải giữ nguyên, không đổi thành null');

    // Thiếu hẳn trường cũng phải là undefined (service hiểu là dùng default).
    await AdminDashboardController.setServiceLock(
      { identityAdminMssv: 'TESTADMIN', body: { locked: false } },
      res
    );
    const bare = ServiceLockService.__lastSetArgs[0];
    assert.equal(bare.title, undefined, 'thiếu title phải là undefined, không phải null');
    assert.equal(bare.message, undefined, 'thiếu message phải là undefined, không phải null');
  });

  await check('PUT khi service ném lỗi không có status trả 500', async () => {
    ServiceLockService.setStatus = async () => {
      throw new Error('lỗi ngoài dự kiến');
    };
    const res = response();
    await AdminDashboardController.setServiceLock(
      { identityAdminMssv: 'TESTADMIN', body: { locked: true } },
      res
    );
    assert.equal(res.statusCode, 500, 'lỗi không có status phải thành 500');
    assert.equal(res.body.result, false);
  });

  await check('PUT lỗi validate từ service (status 400) giữ nguyên 400', async () => {
    ServiceLockService.setStatus = async () => {
      const error = new Error('title quá dài');
      error.status = 400;
      throw error;
    };
    const res = response();
    await AdminDashboardController.setServiceLock(
      { identityAdminMssv: 'TESTADMIN', body: { locked: true, title: 'x' } },
      res
    );
    assert.equal(res.statusCode, 400, 'lỗi validate của service phải giữ 400');
    assert.equal(res.body.result, false);
  });
} finally {
  ServiceLockService.getStatus = originalGetStatus;
  ServiceLockService.setStatus = originalSetStatus;
  delete ServiceLockService.__lastSetArgs;
  SystemSettingsService.getRecord = originalGetRecord;
  CommunityRealtime.disconnectAllForMaintenance = originalDisconnect;
}

if (failed > 0) {
  console.log(`✗ Admin service-lock: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Admin service-lock: toàn bộ ca đạt.');
}
