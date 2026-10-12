import assert from 'node:assert/strict';
import { AdminDashboardController } from '../src/modules/admin/admin-dashboard.controller.js';
import { ServiceLockService } from '../src/services/service-lock.service.js';
import { CommunityRealtime } from '../src/services/community-realtime.service.js';

// Test cho API admin GET/PUT /api/admin/dashboard/service-lock (Task 5).
// Không cần DB: monkey-patch ServiceLockService.getAdminStatus/setStatus và cổng
// realtime, rồi gọi thẳng handler với fake req/res. Controller không được tự biết
// key/shape của bảng setting nên test chỉ chạm interface của ServiceLockService.
// Mỗi ca in một dòng ✓/✗; cuối cùng đặt exitCode=1 nếu có ca đỏ để
// `node tests/test-admin-service-lock.js` fail-closed đúng cách.

const originalGetAdminStatus = ServiceLockService.getAdminStatus;
const originalSetStatus = ServiceLockService.setStatus;
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

function stubGetAdminStatus(data) {
  ServiceLockService.getAdminStatus = async () => data;
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

  await check('GET trả nguyên trạng thái đầy đủ từ getAdminStatus', async () => {
    stubGetAdminStatus({
      locked: false,
      title: 'T',
      message: 'M',
      updated_at: '2026-10-12T00:00:00.000Z',
      updated_by: 'ADMIN_1'
    });
    const res = response();
    await AdminDashboardController.getServiceLock({}, res);
    assert.equal(res.statusCode, 200, 'phải trả 200');
    assert.equal(res.body.result, true, 'result phải là true');
    assert.deepEqual(res.body.data, {
      locked: false,
      title: 'T',
      message: 'M',
      updated_at: '2026-10-12T00:00:00.000Z',
      updated_by: 'ADMIN_1'
    });
    assert.deepEqual(
      Object.keys(res.body.data).sort(),
      ['locked', 'title', 'message', 'updated_at', 'updated_by'].sort(),
      'data phải đủ locked/title/message/updated_at/updated_by'
    );
  });

  await check('GET vẫn 200 khi getAdminStatus fail-open', async () => {
    // Service tự fail-open; controller chỉ chuyển tiếp data.
    stubGetAdminStatus({
      locked: false,
      title: 'Dịch vụ đang tạm khóa để bảo trì',
      message: 'Hệ thống đang bảo trì, vui lòng quay lại sau.',
      updated_at: null,
      updated_by: null
    });
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

  await check('PUT lỗi ngoài dự kiến trả 500 với chuỗi cố định, không lộ err.message', async () => {
    ServiceLockService.setStatus = async () => {
      throw new Error('relation "system_settings" does not exist');
    };
    const res = response();
    await AdminDashboardController.setServiceLock(
      { identityAdminMssv: 'TESTADMIN', body: { locked: true } },
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
    ServiceLockService.setStatus = async () => {
      const error = new Error('title tối đa 120 ký tự.');
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
    assert.equal(res.body.message, 'title tối đa 120 ký tự.', '400 phải giữ nội dung validate');
  });
} finally {
  ServiceLockService.getAdminStatus = originalGetAdminStatus;
  ServiceLockService.setStatus = originalSetStatus;
  delete ServiceLockService.__lastSetArgs;
  CommunityRealtime.disconnectAllForMaintenance = originalDisconnect;
}

if (failed > 0) {
  console.log(`✗ Admin service-lock: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Admin service-lock: toàn bộ ca đạt.');
}
