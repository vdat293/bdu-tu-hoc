/**
 * Test taxonomy tính năng `src/config/feature-groups.js` (Task 1).
 *
 * Vì sao test tách riêng: `featureForPath` là hàm thuần, không đụng DB, nên chốt
 * được các "hợp đồng" gom nhóm tính năng ngay tại đây. Mọi tầng phân tích phía
 * sau (bảng xếp hạng tính năng, phiên, heatmap) đều dựa vào kết quả hàm này; chỉ
 * cần một tiền tố khớp sai là số liệu hiển thị lệch mà không ai thấy.
 *
 * Chạy (env managed bắt buộc):
 *   $env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'; node tests/test-feature-groups.js
 */
import assert from 'node:assert/strict';

import { FEATURE_GROUPS, OTHER_FEATURE, featureForPath } from '../src/config/feature-groups.js';

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

check('khớp API route theo tiền tố', () => {
  assert.equal(featureForPath('/api/wordfmt/format').id, 'wordfmt');
});

check('khớp trang SPA theo pagePrefixes', () => {
  assert.equal(featureForPath('/confession').id, 'community');
  assert.equal(featureForPath('/clans').id, 'clubs');
});

check('bỏ tiền tố /api trước khi so', () => {
  assert.equal(featureForPath('/api/vocab/themes').id, 'vocab');
  assert.equal(featureForPath('/vocab/themes').id, 'vocab');
});

check('bỏ phần query ?... trước khi so', () => {
  assert.equal(featureForPath('/grammar/progress?x=1').id, 'grammar');
});

check('so tiền tố theo ranh giới đoạn', () => {
  // '/vocabulary' chỉ giống chuỗi đầu của '/vocab' nhưng khác đoạn ⇒ phải rơi vào other.
  assert.equal(featureForPath('/vocabulary').id, 'other');
});

check('tiền tố dài nhất thắng', () => {
  // '/community/clans/5' khớp cả community lẫn clubs; clubs dài hơn nên phải thắng.
  assert.equal(featureForPath('/community/clans/5').id, 'clubs');
});

check('không khớp tính năng nào thì rơi vào other', () => {
  assert.equal(featureForPath('/api/login').id, 'other');
  assert.equal(featureForPath('/notifications').id, 'other');
});

check('portal nằm trong taxonomy', () => {
  assert.equal(featureForPath('/gpa').id, 'portal');
});

check('OTHER_FEATURE có id other và nhãn Khác', () => {
  assert.equal(OTHER_FEATURE.id, 'other');
  assert.equal(OTHER_FEATURE.label, 'Khác');
});

check('FEATURE_GROUPS đủ 11 nhóm và mỗi nhóm có apiPrefixes/pagePrefixes', () => {
  assert.equal(FEATURE_GROUPS.length, 11);
  for (const group of FEATURE_GROUPS) {
    assert.ok(typeof group.id === 'string' && group.id.length > 0, 'nhóm thiếu id');
    assert.ok(typeof group.label === 'string' && group.label.length > 0, `nhóm ${group.id} thiếu label`);
    assert.ok(Array.isArray(group.apiPrefixes), `nhóm ${group.id} thiếu apiPrefixes`);
    assert.ok(Array.isArray(group.pagePrefixes), `nhóm ${group.id} thiếu pagePrefixes`);
  }
});

check('ghim danh sách id và thứ tự nhóm', () => {
  // Vì sao ghim cứng: file này là "nguồn sự thật duy nhất" mà Task 3 sẽ dựng
  // CASE WHEN từ hằng số FEATURE_GROUPS. Kiểm kiểu dữ liệu thôi thì một lỗi gõ
  // id hay đổi thứ tự sẽ trôi qua mà không test nào bắt.
  assert.deepEqual(
    FEATURE_GROUPS.map((group) => group.id),
    ['portal', 'wordfmt', 'survey', 'training', 'english', 'learning', 'community', 'clubs', 'vocab', 'grammar', 'games']
  );
});

check('ghim apiPrefixes của clubs (không rơi sót poll)', () => {
  // Vì sao ghim riêng nhóm clubs: đây là nhóm dùng chung tiền tố gốc /community
  // với community, dễ bị gán thiếu prefix khi sửa tay; sót '/community/polls'
  // sẽ khiến poll CLB bị đếm lẫn sang nhóm khác mà số liệu vẫn "trông đúng".
  assert.deepEqual(
    FEATURE_GROUPS.find((group) => group.id === 'clubs').apiPrefixes,
    ['/community/clans', '/community/polls']
  );
});

check('tiền tố không lồng nhau giữa các nhóm (giữ JS và SQL cùng kết luận)', () => {
  // `featureForPath` (JS) cho tiền tố DÀI NHẤT thắng; `buildFeatureCaseSql` (SQL)
  // dựng CASE nên phải sắp giảm dần theo độ dài. Nếu có cặp tiền tố lồng nhau
  // (hoặc trùng chuỗi ở hai nhóm) thì hai đường tra cứu có thể cho hai đáp án
  // khác nhau ⇒ số liệu lệch mà không test nào bắt.
  const entries = FEATURE_GROUPS.flatMap((group) => (
    [...group.apiPrefixes, ...group.pagePrefixes].map((prefix) => ({ prefix, id: group.id }))
  ));
  for (const a of entries) {
    for (const b of entries) {
      if (a.prefix === b.prefix) {
        assert.equal(a.id, b.id, `tiền tố "${a.prefix}" bị khai ở cả "${a.id}" và "${b.id}"`);
        continue;
      }
      assert.ok(
        !(b.prefix.length > a.prefix.length && b.prefix.startsWith(a.prefix)),
        `tiền tố "${b.prefix}" (${b.id}) lồng trong "${a.prefix}" (${a.id}): SQL/JS có thể gán khác nhau`
      );
    }
  }
});

if (failed > 0) {
  console.log(`✗ Feature groups: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Feature groups: toàn bộ ca đạt.');
}
