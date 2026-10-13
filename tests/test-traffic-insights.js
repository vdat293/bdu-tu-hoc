/**
 * Test cho `src/services/traffic-insights.service.js`.
 *
 * Phần này chỉ chốt các HÀM THUẦN (không đụng DB): tách phiên
 * (`buildSessions`), đếm chuyển trang (`summarizeTransitions`) và gom theo tính
 * năng (`bucketByFeature`). Vì sao tách riêng khỏi truy vấn: ba hàm này là chỗ
 * dễ sai lặng lẽ nhất (ngưỡng 30 phút, thứ tự sự kiện, cộng dồn số) mà lại không
 * cần Postgres, nên khẳng định được ngay bằng dữ liệu dựng tay.
 *
 * Chạy (env managed bắt buộc):
 *   $env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-traffic-insights.js
 */
import assert from 'node:assert/strict';

import {
  ANALYTICS_TZ,
  SESSION_GAP_MS,
  buildSessions,
  summarizeTransitions,
  bucketByFeature,
  featureForPath,
  TrafficInsightsService
} from '../src/services/traffic-insights.service.js';
import { isDatabaseConfigured } from '../src/db/database.js';

let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`✗ ${name}`);
    console.log(`    ${error && error.message ? error.message : error}`);
  }
}

// Mốc gốc cố định để test không phụ thuộc giờ chạy máy.
const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);

// Dựng một sự kiện với mốc cách BASE `minutes` phút.
function ev(minutes, path, featureId) {
  return { at: new Date(BASE + minutes * 60 * 1000), path, featureId };
}

check('hằng số phân tích đúng múi giờ và ngưỡng phiên', () => {
  assert.equal(ANALYTICS_TZ, 'Asia/Ho_Chi_Minh');
  assert.equal(SESSION_GAP_MS, 1_800_000);
});

check('re-export featureForPath dùng chung taxonomy', () => {
  assert.equal(featureForPath('/api/wordfmt/format').id, 'wordfmt');
});

check('tách phiên đúng ngưỡng 30 phút', () => {
  // Cách 29 phút: vẫn cùng một phiên.
  const near = buildSessions([ev(0, '/a', 'vocab'), ev(29, '/b', 'vocab')]);
  assert.equal(near.length, 1);
  // Cách 31 phút: vượt ngưỡng nên tách thành hai phiên.
  const far = buildSessions([ev(0, '/a', 'vocab'), ev(31, '/b', 'vocab')]);
  assert.equal(far.length, 2);
});

check('sự kiện đơn và danh sách rỗng', () => {
  const single = buildSessions([ev(0, '/a', 'vocab')]);
  assert.equal(single.length, 1);
  assert.equal(single[0].eventCount, 1);
  assert.equal(single[0].durationMs, 0);
  assert.deepEqual(buildSessions([]), []);
});

check('phiên gom features duy nhất, giữ thứ tự xuất hiện', () => {
  const sessions = buildSessions([
    ev(0, '/a', 'vocab'),
    ev(1, '/b', 'grammar'),
    ev(2, '/c', 'vocab')
  ]);
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].features, ['vocab', 'grammar']);
});

check('phiên tính duration từ sự kiện đầu tới sự kiện cuối', () => {
  const sessions = buildSessions([ev(0, '/a', 'vocab'), ev(10, '/b', 'vocab')]);
  assert.equal(sessions[0].durationMs, 10 * 60 * 1000);
});

check('chuyển trang: A→B→A trong một phiên', () => {
  const sessions = buildSessions([
    ev(0, '/a', 'vocab'),
    ev(1, '/b', 'grammar'),
    ev(2, '/a', 'vocab')
  ]);
  const transitions = summarizeTransitions(sessions);
  assert.deepEqual(
    transitions.find((t) => t.from === '/a' && t.to === '/b'),
    { from: '/a', to: '/b', count: 1 }
  );
  assert.deepEqual(
    transitions.find((t) => t.from === '/b' && t.to === '/a'),
    { from: '/b', to: '/a', count: 1 }
  );
});

check('chuyển trang không vượt ranh giới phiên', () => {
  // Hai phiên tách biệt: cặp /b→/c nối qua ranh giới KHÔNG được đếm.
  const sessions = buildSessions([
    ev(0, '/a', 'vocab'),
    ev(1, '/b', 'vocab'),
    ev(60, '/c', 'vocab'),
    ev(61, '/d', 'vocab')
  ]);
  assert.equal(sessions.length, 2);
  const transitions = summarizeTransitions(sessions);
  assert.equal(transitions.find((t) => t.from === '/b' && t.to === '/c'), undefined);
});

check('phiên serialize ra JSON chỉ còn đúng 5 trường hợp đồng', () => {
  // Vì sao canh: giá trị của việc giữ `events` ở thuộc tính không liệt kê nằm ở
  // chỗ phiên trả ra API chỉ còn 5 trường; nếu ai đó đổi sang thuộc tính thường
  // thì `events` (mảng sự kiện gốc) sẽ lọt vào JSON mà không test nào bắt.
  const sessions = buildSessions([ev(0, '/a', 'vocab'), ev(1, '/b', 'grammar')]);
  assert.deepEqual(
    Object.keys(sessions[0]),
    ['startAt', 'endAt', 'durationMs', 'eventCount', 'features']
  );
  assert.deepEqual(JSON.parse(JSON.stringify(sessions[0])), {
    // JSON.stringify chuyển Date thành chuỗi ISO, nên kỳ vọng phải là chuỗi ISO.
    startAt: new Date(BASE).toISOString(),
    endAt: new Date(BASE + 60 * 1000).toISOString(),
    durationMs: 60000,
    eventCount: 2,
    features: ['vocab', 'grammar']
  });
});

check('top N: cắt đúng số lượng và sắp theo count giảm dần', () => {
  // Một phiên đủ dài để /a→/b lặp 3 lần và /b→/a lặp 2 lần.
  const sessions = buildSessions([
    ev(0, '/a', 'vocab'),
    ev(1, '/b', 'vocab'),
    ev(2, '/a', 'vocab'),
    ev(3, '/b', 'vocab'),
    ev(4, '/a', 'vocab'),
    ev(5, '/b', 'vocab')
  ]);
  const top1 = summarizeTransitions(sessions, 1);
  assert.equal(top1.length, 1);
  assert.deepEqual(top1[0], { from: '/a', to: '/b', count: 3 });
  const top2 = summarizeTransitions(sessions, 2);
  assert.equal(top2.length, 2);
  assert.ok(top2[0].count >= top2[1].count, 'phải sắp giảm dần theo count');
});

check('bucket gộp: cộng dồn requests/users và tính errorRate', () => {
  const { items, other } = bucketByFeature([
    { featureId: 'wordfmt', requests: 10, users: 4, errors: 2 },
    { featureId: 'wordfmt', requests: 5, users: 3, errors: 1 },
    { featureId: 'other', requests: 7, users: 2, errors: 3 },
    { featureId: 'khong-ton-tai', requests: 2, users: 1, errors: 0 }
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'wordfmt');
  assert.equal(items[0].label, 'Word Formatting');
  assert.equal(items[0].requests, 15);
  assert.equal(items[0].users, 7);
  assert.equal(items[0].errorRate, 3 / 15);
  // Nhóm "other" gom cả row other lẫn row featureId lạ (không khớp taxonomy).
  assert.equal(other.requests, 9);
  assert.equal(other.users, 3);
  assert.equal(other.errorRate, 3 / 9);
});

check('bucket không chia cho 0 khi requests bằng 0', () => {
  const { other } = bucketByFeature([{ featureId: 'other', requests: 0, users: 0, errors: 0 }]);
  assert.equal(other.errorRate, 0);
});

/* ------------------------------------------------------------------
 * PHẦN 2 — hàm truy vấn (fake `runner` bắt `sql`/`params`).
 *
 * Vì sao dùng runner giả: 5 hàm truy vấn nhận `runner?` để test bắt đúng câu
 * SQL và tham số mà không cần Postgres thật. Khi truyền runner thì hàm dùng
 * luôn và bỏ qua kiểm tra DB; khi không truyền thì dùng `query` thật và trả
 * cấu trúc rỗng nếu `isDatabaseConfigured()` false.
 * ------------------------------------------------------------------ */

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`✗ ${name}`);
    console.log(`    ${error && error.message ? error.message : error}`);
  }
}

// Bọc handler thành runner giả, ghi lại mọi cặp (sql, params) được gọi.
function makeRunner(handler) {
  const calls = [];
  const runner = async (sql, params = []) => {
    calls.push({ sql, params });
    return handler(sql, params, calls);
  };
  runner.calls = calls;
  return runner;
}

const WEEKDAYS_VI = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

await checkAsync('heatmap: SQL chứa múi giờ Việt Nam', async () => {
  const runner = makeRunner(() => ({ rows: [] }));
  await TrafficInsightsService.getHourHeatmap({ timeRange: '7d' }, runner);
  assert.equal(runner.calls.length >= 1, true);
  assert.match(runner.calls[0].sql, /AT TIME ZONE 'Asia\/Ho_Chi_Minh'/);
});

await checkAsync('features: endpoint lạ map theo tính năng + share trên tổng', async () => {
  // Vì sao endpoint thô: fake trả dòng chưa gom để khẳng định tầng JS tự map
  // qua featureForPath (SQL thật gom bằng CASE WHEN, xem service).
  const runner = makeRunner(() => ({
    rows: [{ endpoint: '/wordfmt/format', requests: 3, users: 2, errors: 0 }]
  }));
  const data = await TrafficInsightsService.getFeatures({ timeRange: '7d' }, runner);
  assert.equal(data.totalRequests, 3);
  assert.equal(data.items[0].id, 'wordfmt');
  assert.equal(data.items[0].share, 1);
});

await checkAsync("features 'all': bỏ delta, params không mốc thời gian", async () => {
  const runner = makeRunner(() => ({
    rows: [{ feature_id: 'wordfmt', requests: 3, users: 2, errors: 0 }]
  }));
  const data = await TrafficInsightsService.getFeatures({ timeRange: 'all' }, runner);
  // Chỉ một lượt truy vấn (không có truy vấn kỳ trước) và delta luôn null.
  assert.equal(runner.calls.length, 1);
  for (const item of data.items) assert.equal(item.deltaPct, null);
  for (const call of runner.calls) {
    assert.deepEqual(call.params, []);
    assert.equal(/NOW\(\)/.test(call.sql), false);
  }
});

await checkAsync('heatmap: matrix 7x24 và peak đúng ô lớn nhất', async () => {
  const rows = [];
  for (let d = 0; d < 7; d += 1) {
    for (let h = 0; h < 24; h += 1) rows.push({ weekday: d, hour: h, count: d * 24 + h });
  }
  const runner = makeRunner(() => ({ rows }));
  const data = await TrafficInsightsService.getHourHeatmap({ timeRange: '7d' }, runner);
  assert.equal(data.tz, 'Asia/Ho_Chi_Minh');
  assert.deepEqual(data.weekdays, WEEKDAYS_VI);
  assert.equal(data.matrix.length, 7);
  for (const row of data.matrix) assert.equal(row.length, 24);
  assert.equal(data.matrix[6][23], 167);
  assert.deepEqual(data.peak, { weekday: 6, hour: 23, count: 167 });
  assert.equal(data.max, 167);
});

await checkAsync('cohort: totals và dayBuckets cộng khớp', async () => {
  const runner = makeRunner((sql) => {
    // Vì sao rẽ nhánh theo SQL: cohort chạy 2 lượt (buckets theo ngày +
    // tổng/stickiness); fake nhận diện lượt buckets qua `date_trunc`.
    if (/date_trunc/i.test(sql)) {
      return {
        rows: [
          { date: '2026-01-01', active: 5, new: 2, returning: 3 },
          { date: '2026-01-02', active: 4, new: 1, returning: 3 }
        ]
      };
    }
    return {
      rows: [{ active: 7, new: 3, returning: 6, dau: 4, wau: 7, also_prev: 5, active7: 7 }]
    };
  });
  const data = await TrafficInsightsService.getCohort({ timeRange: '30d' }, runner);
  assert.equal(data.dayBuckets.length, 2);
  for (const bucket of data.dayBuckets) {
    assert.equal(bucket.new + bucket.returning, bucket.active);
  }
  const sumNew = data.dayBuckets.reduce((sum, bucket) => sum + bucket.new, 0);
  const sumReturning = data.dayBuckets.reduce((sum, bucket) => sum + bucket.returning, 0);
  assert.equal(data.totals.new, sumNew);
  assert.equal(data.totals.returning, sumReturning);
  assert.equal(data.totals.new, 3);
  assert.deepEqual(data.stickiness, { dau: 4, wau: 7, ratio: 0.5714 });
});

await checkAsync('quality: p95Ms lấy từ cột p95 của runner', async () => {
  const runner = makeRunner((sql) => {
    if (/GROUP BY/i.test(sql)) {
      return {
        rows: [{ feature_id: 'wordfmt', requests: 10, errors: 2, avg_ms: 120.5, p95_ms: 450 }]
      };
    }
    return { rows: [{ requests: 10, errors: 2, avg_ms: 120.5, p95_ms: 450 }] };
  });
  const data = await TrafficInsightsService.getQuality({ timeRange: '7d' }, runner);
  assert.equal(data.items[0].id, 'wordfmt');
  assert.equal(data.items[0].p95Ms, 450);
  assert.equal(data.overall.p95Ms, 450);
});

await checkAsync('journey: ORDER BY ASC + clamp limit 9999 về 500 + mssv hoa', async () => {
  const runner = makeRunner((sql) => {
    if (/FROM students/i.test(sql)) {
      return { rows: [{ mssv: 'SV001', full_name: 'An', class_code: 'L1', faculty_code: 'CNTT' }] };
    }
    return { rows: [] };
  });
  const data = await TrafficInsightsService.getUserJourney(
    { mssv: 'sv001', timeRange: '7d', limit: 9999 },
    runner
  );
  assert.equal(data.mssv, 'SV001');
  const eventCall = runner.calls.find((call) => /ORDER BY created_at ASC/i.test(call.sql));
  assert.ok(eventCall, 'câu sự kiện phải ORDER BY created_at ASC');
  assert.ok(eventCall.params.includes(500), 'limit 9999 phải clamp về 500 trong params');
  assert.deepEqual(data.student, {
    mssv: 'SV001',
    full_name: 'An',
    class_code: 'L1',
    faculty_code: 'CNTT'
  });
});

await checkAsync('journey rỗng: events/sessions/transitions [] và không ném', async () => {
  const runner = makeRunner(() => ({ rows: [] }));
  const data = await TrafficInsightsService.getUserJourney({ mssv: 'KHONGCO', timeRange: '7d' }, runner);
  assert.deepEqual(data.events, []);
  assert.deepEqual(data.sessions, []);
  assert.deepEqual(data.transitions, []);
  assert.equal(data.truncated, false);
});

await checkAsync('chưa cấu hình DB: gọi không runner trả rỗng, không 500', async () => {
  // Vì sao khẳng định tiền đề: env test managed không nạp `.env` nên DB coi
  // như chưa cấu hình; nếu tiền đề vỡ thì các khẳng định rỗng bên dưới vô nghĩa.
  assert.equal(isDatabaseConfigured(), false);
  const features = await TrafficInsightsService.getFeatures({ timeRange: '7d' });
  assert.equal(features.totalRequests, 0);
  assert.deepEqual(features.items, []);
  const hours = await TrafficInsightsService.getHourHeatmap({ timeRange: '7d' });
  assert.equal(hours.matrix.length, 7);
  const cohort = await TrafficInsightsService.getCohort({ timeRange: '7d' });
  assert.deepEqual(cohort.dayBuckets, []);
  const quality = await TrafficInsightsService.getQuality({ timeRange: '7d' });
  assert.equal(quality.overall.requests, 0);
  assert.deepEqual(quality.items, []);
  const journey = await TrafficInsightsService.getUserJourney({ mssv: 'SV001' });
  assert.deepEqual(journey.events, []);
  assert.deepEqual(journey.sessions, []);
  assert.deepEqual(journey.transitions, []);
});

if (failed > 0) {
  console.log(`✗ Traffic insights: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Traffic insights: toàn bộ ca đạt.');
}
