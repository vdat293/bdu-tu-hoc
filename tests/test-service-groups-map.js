/**
 * Test bản đồ route SPA -> nhóm tính năng `client/src/app/serviceGroups.js` (Task 8).
 *
 * Vì sao test này quan trọng: phía server đã có `featureForPath` chặn theo nhóm,
 * còn phía client phải tự suy ra "trang đang mở thuộc nhóm nào" để hiện đúng màn
 * bảo trì. Hai bản đồ route (client ở đây, server ở `src/config/feature-groups.js`)
 * nếu lệch nhau thì người dùng thấy một đằng, server chặn một nẻo. Vì vậy test đối
 * chiếu trực tiếp với `pagePrefixes` của taxonomy server thay vì ghim cứng chuỗi —
 * thêm nhóm mới mà quên khai bên client sẽ đỏ ngay.
 *
 * `serviceGroups.js` cố tình là ESM thuần, không import gì, để test Node import
 * thẳng được mà không kéo theo React/router.
 *
 * Chạy (env managed bắt buộc):
 *   $env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-service-groups-map.js
 */
import assert from 'node:assert/strict';

import { featureForRoute } from '../client/src/app/serviceGroups.js';
import { FEATURE_GROUPS } from '../src/config/feature-groups.js';

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

check('mọi pagePrefix của nhóm lockable (trừ games) đều ánh xạ đúng id', () => {
  // Vì sao lọc `lockable` + bỏ `games`: chỉ nhóm lockable mới có màn bảo trì, còn
  // `games` không có route trang SPA nào (pagePrefixes rỗng) nên không có gì để khớp.
  const mapped = FEATURE_GROUPS
    .filter((group) => group.lockable && group.id !== 'games' && group.pagePrefixes.length > 0);

  assert.ok(mapped.length > 0, 'không có nhóm lockable nào để đối chiếu');

  for (const group of mapped) {
    for (const prefix of group.pagePrefixes) {
      assert.equal(
        featureForRoute(prefix),
        group.id,
        `pagePrefix "${prefix}" phải thuộc nhóm "${group.id}"`
      );
    }
  }
});

check('khớp tiền tố dài nhất theo ranh giới đoạn', () => {
  assert.equal(featureForRoute('/clans/5'), 'clubs');
  assert.equal(featureForRoute('/vocab/set/x'), 'vocab');
});

check('route lạ không thuộc nhóm nào thì trả null', () => {
  assert.equal(featureForRoute('/'), null);
  assert.equal(featureForRoute('/gpa'), null);
  assert.equal(featureForRoute('/unknown'), null);
});

check('không khớp lẫn sang nhóm khác chỉ vì giống chuỗi đầu', () => {
  // '/vocabulary' khác đoạn với '/vocab' nên không được coi là nhóm vocab; trả null
  // để MaintenanceGate không hiện màn bảo trì oan cho một trang lạ.
  assert.equal(featureForRoute('/vocabulary'), null);
  assert.equal(featureForRoute('/clansman'), null);
});

if (failed > 0) {
  console.log(`✗ Service groups map: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Service groups map: toàn bộ ca đạt.');
}
