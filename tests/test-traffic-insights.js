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
  featureForPath
} from '../src/services/traffic-insights.service.js';

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

if (failed > 0) {
  console.log(`✗ Traffic insights: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Traffic insights: toàn bộ ca đạt.');
}
