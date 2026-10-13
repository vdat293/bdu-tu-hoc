import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MetaController } from '../src/modules/meta/meta.controller.js';
import { ServiceLockService } from '../src/services/service-lock.service.js';

// Test cho endpoint công khai GET /api/status (Task 4). Không cần DB: monkey-patch
// ServiceLockService.getStatus để kiểm shape trả về của MetaController.getServiceStatus,
// đồng thời đọc source của meta.routes.js và app.js để chặn việc ai đó di chuyển
// cửa chặn hoặc xoá route về sau. Mỗi ca in một dòng ✓/✗; cuối cùng đặt
// exitCode=1 nếu có ca đỏ để fail-closed đúng cách.
//
// GET /api/status nay trả map trạng thái theo NHÓM `{ result:true, data:{ groups } }`
// thay cho 3 khoá phẳng locked/title/message. Client (MaintenanceGate) tra nhóm của
// trang hiện tại trong `groups` để biết trang nào bị bảo trì, nên payload chỉ được
// chứa `groups`; metadata nội bộ (updated_at/updated_by) của bản ghi setting không
// được rò ra endpoint công khai này.
//
// Import thẳng MetaController từ file domain thay vì barrel ApiController: barrel
// kéo theo english-exercise.service.js, service này ném ENGLISH_TEST_ANSWER_PATH_REQUIRED
// khi chạy test mà không có ENGLISH_ANSWERS_PATH (chỉ runner `run-safe-tests.mjs`
// mới tự cấp). getServiceStatus nằm trong MetaController nên import domain file là đủ.

const originalGetStatus = ServiceLockService.getStatus;

// Danh sách 10 nhóm khoá được, ghim cứng ở test để nếu taxonomy lỡ mất một nhóm
// (hoặc controller trả thiếu khoá) thì endpoint bị coi là hỏng ngay tại đây.
const EXPECTED_GROUP_IDS = [
  'wordfmt',
  'survey',
  'training',
  'english',
  'learning',
  'community',
  'clubs',
  'vocab',
  'grammar',
  'games'
];

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
  await check('payload /api/status trả map nhóm đủ 10 khoá trong data.groups', async () => {
    ServiceLockService.getStatus = async () => ({
      groups: {
        vocab: { locked: true, title: 'Từ vựng bảo trì', message: 'Vui lòng quay lại sau.' },
        community: { locked: false, title: 'T', message: 'M' }
      }
    });
    const res = response();
    await MetaController.getServiceStatus({}, res);
    assert.equal(res.statusCode, 200, 'phải trả 200');
    assert.equal(res.body.result, true, 'result phải là true');

    // getStatus() thật luôn trả đủ 10 nhóm; ở đây fake trả thiếu 8 nhóm để ghim
    // rằng controller phải chuyển tiếp nguyên `status.groups` chứ không tự lọc/rút
    // gọn — việc chuẩn hoá đủ 10 khoá là trách nhiệm của ServiceLockService.
    assert.deepEqual(
      Object.keys(res.body.data.groups).sort(),
      ['community', 'vocab'].sort(),
      'controller phải chuyển tiếp nguyên map nhóm từ getStatus'
    );
    assert.equal(res.body.data.groups.vocab.locked, true);
    assert.equal(res.body.data.groups.vocab.title, 'Từ vựng bảo trì');
    assert.equal(res.body.data.groups.vocab.message, 'Vui lòng quay lại sau.');
    assert.equal(res.body.data.groups.community.locked, false);
  });

  await check('payload đủ 10 nhóm khi getStatus trả đủ 10 khoá', async () => {
    const fullGroups = {};
    for (const id of EXPECTED_GROUP_IDS) {
      fullGroups[id] = { locked: false, title: 'T', message: 'M' };
    }
    ServiceLockService.getStatus = async () => ({ groups: fullGroups });
    const res = response();
    await MetaController.getServiceStatus({}, res);
    assert.deepEqual(
      Object.keys(res.body.data.groups).sort(),
      [...EXPECTED_GROUP_IDS].sort(),
      'data.groups phải đủ đúng 10 nhóm khoá được'
    );
    assert.deepEqual(
      Object.keys(res.body.data),
      ['groups'],
      'data chỉ được có khoá groups, không trả locked/title/message phẳng'
    );
  });

  await check('không lộ updated_by/updated_at ra payload công khai', async () => {
    // getStatus thật chỉ trả { groups }, nhưng phòng khi service tương lai trả thêm
    // trường nội bộ thì controller phải tự lọc bỏ chứ không được trả nguyên vẹn.
    ServiceLockService.getStatus = async () => ({
      groups: { vocab: { locked: false, title: 'T', message: 'M' } },
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
