import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MetaController } from '../src/modules/meta/meta.controller.js';
import { ServiceLockService } from '../src/services/service-lock.service.js';

// Test cho endpoint công khai GET /api/status (Task 3). Không cần DB: monkey-patch
// ServiceLockService.getStatus để kiểm shape trả về của MetaController.getServiceStatus,
// đồng thời đọc source của meta.routes.js và app.js để chặn việc ai đó di chuyển
// cửa chặn hoặc xoá route về sau. Mỗi ca in một dòng ✓/✗; cuối cùng đặt
// exitCode=1 nếu có ca đỏ để fail-closed đúng cách.
//
// Import thẳng MetaController từ file domain thay vì barrel ApiController: barrel
// kéo theo english-exercise.service.js, service này ném ENGLISH_TEST_ANSWER_PATH_REQUIRED
// khi chạy test mà không có ENGLISH_ANSWERS_PATH (chỉ runner `run-safe-tests.mjs`
// mới tự cấp). getServiceStatus nằm trong MetaController nên import domain file là đủ.

const originalGetStatus = ServiceLockService.getStatus;

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const appSource = fs.readFileSync(path.join(srcRoot, 'app.js'), 'utf8');
const metaRoutesSource = fs.readFileSync(path.join(srcRoot, 'routes', 'meta.routes.js'), 'utf8');

let failed = 0;

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

try {
  await check('payload /api/status trả đúng 3 khoá locked/title/message', async () => {
    ServiceLockService.getStatus = async () => ({
      locked: true,
      title: 'Bảo trì định kỳ',
      message: 'Vui lòng quay lại sau ít phút.'
    });
    const res = response();
    await MetaController.getServiceStatus({}, res);
    assert.equal(res.statusCode, 200, 'phải trả 200');
    assert.equal(res.body.result, true, 'result phải là true');
    assert.equal(res.body.data.locked, true);
    assert.equal(res.body.data.title, 'Bảo trì định kỳ');
    assert.equal(res.body.data.message, 'Vui lòng quay lại sau ít phút.');
    assert.deepEqual(
      Object.keys(res.body.data).sort(),
      ['locked', 'message', 'title'],
      'data phải có đúng 3 khoá, không thừa không thiếu'
    );
  });

  await check('không lộ updated_by/updated_at ra payload công khai', async () => {
    // getStatus thật chỉ trả 3 khoá, nhưng phòng khi service tương lai trả thêm
    // trường nội bộ thì controller phải tự lọc bỏ chứ không được trả nguyên vẹn.
    ServiceLockService.getStatus = async () => ({
      locked: false,
      title: 'T',
      message: 'M',
      updated_at: '2026-01-01T00:00:00.000Z',
      updated_by: 'ADMIN'
    });
    const res = response();
    await MetaController.getServiceStatus({}, res);
    const str = JSON.stringify(res.body);
    assert.ok(!str.includes('updated_by'), 'không được lộ updated_by');
    assert.ok(!str.includes('updated_at'), 'không được lộ updated_at');
  });

  await check('route /status được đăng ký trong meta.routes.js', () => {
    assert.match(metaRoutesSource, /router\.get\('\/status'/);
  });

  await check('cửa chặn nằm TRƯỚC mount /api router', () => {
    const guardIndex = appSource.indexOf("app.use('/api', createServiceLockGuard");
    const apiMountIndex = appSource.indexOf("app.use('/api', apiRoutes)");
    assert.notEqual(guardIndex, -1, 'phải có dòng gắn createServiceLockGuard vào /api');
    assert.notEqual(apiMountIndex, -1, 'phải có dòng mount /api router');
    assert.ok(
      guardIndex < apiMountIndex,
      'cửa chặn phải nằm TRƯỚC app.use(\'/api\', apiRoutes) để chặn trọn /api'
    );
  });

  await check('cửa chặn nằm SAU mount static public', () => {
    const guardIndex = appSource.indexOf("app.use('/api', createServiceLockGuard");
    const staticIndex = appSource.indexOf("express.static(path.join(ROOT_DIR, 'public')");
    assert.notEqual(guardIndex, -1, 'phải có dòng gắn createServiceLockGuard vào /api');
    assert.notEqual(staticIndex, -1, 'phải có mount static cho public');
    assert.ok(
      guardIndex > staticIndex,
      'cửa chặn phải nằm SAU mount static public để SPA/màn hình bảo trì vẫn tải được'
    );
  });
} finally {
  ServiceLockService.getStatus = originalGetStatus;
}

if (failed > 0) {
  console.log(`✗ ServiceLockEndpoint: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ ServiceLockEndpoint: toàn bộ ca đạt.');
}
