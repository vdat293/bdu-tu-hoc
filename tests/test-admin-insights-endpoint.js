import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdminDashboardController } from '../src/modules/admin/admin-dashboard.controller.js';
import { TrafficInsightsService } from '../src/services/traffic-insights.service.js';

// Test cho 5 endpoint admin /api/admin/dashboard/insights/* (Task 4).
// Không cần DB: monkey-patch TrafficInsightsService rồi gọi thẳng handler với
// fake req/res. Mỗi ca in một dòng ✓/✗; cuối cùng đặt exitCode=1 nếu có ca đỏ.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const originals = {
  getFeatures: TrafficInsightsService.getFeatures,
  getHourHeatmap: TrafficInsightsService.getHourHeatmap,
  getCohort: TrafficInsightsService.getCohort,
  getQuality: TrafficInsightsService.getQuality,
  getUserJourney: TrafficInsightsService.getUserJourney
};

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

// Fake `res` theo khuôn `response()` trong tests/test-admin-service-lock.js.
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
  await check('GET features trả 200 với data có items/totalRequests/other', async () => {
    TrafficInsightsService.getFeatures = async () => ({
      timeRange: '7d',
      totalRequests: 10,
      items: [{ id: 'wordfmt', label: 'Word', requests: 10, users: 2, share: 1, errorRate: 0, deltaPct: null }],
      other: { requests: 0, users: 0, share: 0 }
    });
    const res = response();
    await AdminDashboardController.getInsightsFeatures({ query: { timeRange: '7d' } }, res);
    assert.equal(res.statusCode, 200, 'phải trả 200');
    assert.equal(res.body.result, true, 'result phải là true');
    assert.ok(res.body.data && typeof res.body.data === 'object', 'data phải là object');
    assert.ok(Array.isArray(res.body.data.items), 'data.items phải là mảng');
    assert.equal(typeof res.body.data.totalRequests, 'number', 'data.totalRequests phải là số');
    assert.ok(res.body.data.other && typeof res.body.data.other === 'object', 'data.other phải là object');
  });

  await check('GET journey chuẩn hoá mssv thành chữ hoa khi gọi service', async () => {
    let received = null;
    TrafficInsightsService.getUserJourney = async (args) => {
      received = args;
      return { mssv: 'SV1', student: null, events: [], sessions: [], transitions: [], truncated: false };
    };
    const res = response();
    await AdminDashboardController.getInsightsJourney(
      { params: { mssv: 'sv1' }, query: { timeRange: '7d', limit: '50' } },
      res
    );
    assert.equal(res.statusCode, 200, 'phải trả 200');
    assert.equal(received && received.mssv, 'SV1', 'service phải nhận mssv đã viết hoa');
  });

  await check('GET journey khi student null vẫn trả 200, không 404', async () => {
    TrafficInsightsService.getUserJourney = async () => ({
      mssv: 'SVKHONGTONTAI', student: null, events: [], sessions: [], transitions: [], truncated: false
    });
    const res = response();
    await AdminDashboardController.getInsightsJourney(
      { params: { mssv: 'svkhongtontai' }, query: {} },
      res
    );
    assert.equal(res.statusCode, 200, 'mssv lạ vẫn phải 200 vì hành trình biên không 404');
    assert.equal(res.body.result, true);
    assert.equal(res.body.data.student, null);
    assert.deepEqual(res.body.data.events, []);
  });

  await check('lỗi ngoài dự kiến trả 500 với chuỗi cố định, không lộ chi tiết SQL', async () => {
    TrafficInsightsService.getQuality = async () => {
      throw new Error('relation "traffic_logs" does not exist');
    };
    const res = response();
    await AdminDashboardController.getInsightsQuality({ query: {} }, res);
    assert.equal(res.statusCode, 500, 'lỗi không có status phải thành 500');
    assert.equal(res.body.result, false);
    assert.equal(res.body.message, 'Không thể lấy dữ liệu chất lượng dịch vụ.', '500 phải trả chuỗi cố định');
    assert.doesNotMatch(res.body.message, /relation|traffic_logs/, 'không được lộ chi tiết DB');
  });

  await check('route đã đăng ký đủ 5 endpoint insights (kể cả :mssv)', async () => {
    // Vì sao đọc file thay vì gọi router thật: route admin đăng ký qua hàm
    // registerAdminRoutes(router) nhận router dùng chung nên đếm chuỗi khai báo
    // là cách nhẹ nhất mà vẫn bắt được thiếu route.
    const source = fs.readFileSync(path.join(root, 'src/routes/admin.routes.js'), 'utf8');
    for (const routePath of [
      '/admin/dashboard/insights/features',
      '/admin/dashboard/insights/hours',
      '/admin/dashboard/insights/cohort',
      '/admin/dashboard/insights/quality',
      '/admin/dashboard/insights/users/:mssv/journey'
    ]) {
      assert.ok(
        source.includes(routePath),
        `thiếu route ${routePath} trong src/routes/admin.routes.js`
      );
    }
  });
} finally {
  TrafficInsightsService.getFeatures = originals.getFeatures;
  TrafficInsightsService.getHourHeatmap = originals.getHourHeatmap;
  TrafficInsightsService.getCohort = originals.getCohort;
  TrafficInsightsService.getQuality = originals.getQuality;
  TrafficInsightsService.getUserJourney = originals.getUserJourney;
}

if (failed > 0) {
  console.log(`✗ Admin insights endpoint: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Admin insights endpoint: toàn bộ ca đạt.');
}
