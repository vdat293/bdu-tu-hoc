/**
 * Test giao diện tab Insights của site tĩnh /admin (Task 6 của kế hoạch admin-insights).
 *
 * Thuần đọc file bằng fs.readFileSync + assert.match nên KHÔNG cần DB và chạy trần được:
 *   node tests/test-admin-insights-ui.js
 * Nhớ chạy kèm env managed:
 *   $env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'
 *
 * Vì sao test tĩnh: /admin là HTML/CSS/JS thuần (không phải React) nên không có sẵn
 * môi trường DOM để render. Ở đây chốt các "hợp đồng" dễ vỡ nhất của tab này:
 *   1. markup đủ 4 khối + nút điều hướng (không có thì tab không mở được),
 *   2. đúng 4 endpoint insights được gọi, mỗi cái bọc .catch() để MỘT endpoint lỗi
 *      không làm hỏng cả dashboard (rủi ro lớn nhất của tab này),
 *   3. heatmap LUÔN có đường số (bảng dự phòng + số trong từng ô) chứ không chỉ dựa
 *      vào màu — không dựa vào màu đơn thuần là nguyên tắc bắt buộc của spec mục 4.1,
 *   4. state.insights + 4 hàm render tồn tại, và mọi dữ liệu chèn DOM đều qua escapeHtml.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexHtml = fs.readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
const adminJs = fs.readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
const adminCss = fs.readFileSync(new URL('../public/admin/admin.css', import.meta.url), 'utf8');

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

/** Cắt nguyên thân một hàm: từ `function <name>(` tới khai báo hàm kế tiếp cùng cấp. */
function sliceFunction(name) {
  const start = adminJs.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `admin.js thiếu hàm ${name}()`);
  const next = adminJs.indexOf('\nfunction ', start + 1);
  return adminJs.slice(start, next === -1 ? adminJs.length : next);
}

/** Cắt khối `Promise.all([ ... ])` trong fetchAllData. */
function sliceInsightsFetch() {
  const start = adminJs.indexOf('async function fetchAllData(');
  assert.ok(start !== -1, 'admin.js thiếu hàm fetchAllData()');
  const end = adminJs.indexOf(']);', start);
  assert.ok(end !== -1, 'Không tìm thấy khối Promise.all trong fetchAllData()');
  return adminJs.slice(start, end);
}

check('markup /admin có đủ nút tab + 4 khối của tab Insights', () => {
  assert.match(indexHtml, /data-tab="insights"/, 'index.html thiếu nút điều hướng data-tab="insights"');
  assert.match(
    indexHtml,
    /<section[^>]*id="pane-insights"[^>]*class="tab-pane"|class="tab-pane"[^>]*id="pane-insights"/,
    'index.html thiếu <section id="pane-insights" class="tab-pane">'
  );
  for (const id of ['feature-ranking', 'hours-heatmap', 'cohort-chart', 'quality-table']) {
    assert.ok(indexHtml.includes(`id="${id}"`), `index.html thiếu khối #${id}`);
  }
  // Tiêu đề + phụ đề nêu câu hỏi là quy ước bắt buộc của spec mục 4.1: không được
  // để khối nào chỉ có số mà không nói số đó trả lời câu hỏi gì.
  const paneStart = indexHtml.indexOf('id="pane-insights"');
  const paneEnd = indexHtml.indexOf('</section>', paneStart);
  assert.ok(paneEnd !== -1, 'Không đóng được section#pane-insights');
  const pane = indexHtml.slice(paneStart, paneEnd);
  assert.ok((pane.match(/class="card-title"/g) || []).length >= 4, 'Mỗi khối Insights cần một card-title');
  assert.ok((pane.match(/class="card-subtitle"/g) || []).length >= 4, 'Mỗi khối Insights cần một card-subtitle nêu câu hỏi');
});

check('admin.js gọi đúng 4 endpoint insights', () => {
  for (const path of ['insights/features', 'insights/hours', 'insights/cohort', 'insights/quality']) {
    assert.ok(adminJs.includes(path), `admin.js chưa gọi endpoint ${path}`);
  }
});

check('một endpoint insights lỗi KHÔNG làm sập cả dashboard', () => {
  const block = sliceInsightsFetch();
  const lines = block.split('\n').filter((line) => line.includes('insights/'));
  assert.equal(lines.length, 4, `Phải có đúng 4 lời gọi insights trong fetchAllData, thấy ${lines.length}`);
  for (const line of lines) {
    assert.match(line, /\.catch\(/, `Lời gọi insights phải bọc .catch(() => null): ${line.trim()}`);
  }
});

check('state.insights và 4 hàm render của tab Insights đã có', () => {
  assert.match(adminJs, /insights:\s*\{/, 'admin.js phải khai state.insights');
  for (const fnName of ['renderFeatureRanking', 'renderHoursHeatmap', 'renderCohort', 'renderQuality']) {
    assert.ok(adminJs.includes(`function ${fnName}(`), `admin.js thiếu hàm ${fnName}()`);
  }
});

check('heatmap có đường số dự phòng, không chỉ dựa vào màu', () => {
  // Bảng số dự phòng: bắt buộc có trong markup VÀ được JS đổ dữ liệu vào.
  assert.ok(indexHtml.includes('id="hours-heatmap-table"'), 'index.html thiếu bảng số dự phòng #hours-heatmap-table');
  assert.ok(adminJs.includes('hours-heatmap-table'), 'admin.js chưa đổ dữ liệu vào #hours-heatmap-table');
  const heatmap = sliceFunction('renderHoursHeatmap');
  assert.match(heatmap, /heatmap-cell/, 'Mỗi ô heatmap phải có class heatmap-cell');
  assert.match(heatmap, /title=/, 'Mỗi ô heatmap phải có title mô tả thứ + giờ + số lượt');
  // Ô nào cũng phải in số ra (kể cả 0) để không ai phải đoán bằng màu.
  assert.match(heatmap, /heatmap-lv/, 'Ô heatmap phải có bậc màu heatmap-lv theo cường độ');
});

check('CSS có lưới heatmap 24 giờ và thang màu cool→hot', () => {
  assert.ok(adminCss.includes('.heatmap-grid'), 'admin.css thiếu .heatmap-grid');
  assert.ok(adminCss.includes('.heatmap-cell'), 'admin.css thiếu .heatmap-cell');
  assert.match(
    adminCss,
    /\.heatmap-grid\s*\{[^}]*repeat\(24/,
    '.heatmap-grid phải khai 24 cột (mỗi cột là một giờ trong ngày)'
  );
  // Thang màu phải có đủ 6 bậc 0..5 và có bản nền tối riêng, không chỉ dựa vào màu.
  for (let level = 0; level <= 5; level += 1) {
    assert.ok(adminCss.includes(`.heatmap-lv${level}`), `admin.css thiếu bậc màu .heatmap-lv${level}`);
  }
  const darkBlock = adminCss.slice(adminCss.indexOf('[data-theme="dark"]'));
  assert.match(darkBlock, /--heat-0-bg/, 'Theme tối phải có bảng màu heatmap riêng');
});

check('mọi dữ liệu chèn DOM ở tab Insights đều qua escapeHtml', () => {
  for (const fnName of ['renderFeatureRanking', 'renderHoursHeatmap', 'renderCohort', 'renderQuality']) {
    const body = sliceFunction(fnName);
    assert.match(body, /escapeHtml\(/, `render${fnName.replace('render', '')} phải escape dữ liệu trước khi chèn DOM`);
  }
});

check('tab Insights không đẩy tràn ngang cả trang ở 375/768px', () => {
  // Vì sao cần: khối chứa bảng số dự phòng có min-width 900px. Nếu cột của
  // .insight-stack để `auto`, lưới sẽ bị nới theo bảng đó và
  // documentElement.scrollWidth vượt viewport ở mọi màn hình.
  assert.match(
    adminCss,
    /\.insight-stack\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    '.insight-stack phải kẹp cột bằng minmax(0, 1fr), không được để cột auto'
  );
  // Phần rộng phải nằm trong khung cuộn riêng, không phải tràn ra ngoài.
  assert.ok(indexHtml.includes('class="table-scroll"'), 'Bảng số dự phòng phải nằm trong khung .table-scroll');
});

check('bảng số dự phòng dùng selector kết hợp đúng (F2)', () => {
  // Markup đặt CÙNG class trên một thẻ: <table class="admin-data-table heatmap-numbers">,
  // nên selector hậu duệ (con của .heatmap-numbers) không bao giờ khớp. Bỏ comment
  // trước khi so để chính chú thích giải thích cũng không làm test đỏ.
  const rules = adminCss.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(
    rules.includes('.admin-data-table.heatmap-numbers'),
    'admin.css phải dùng selector kết hợp .admin-data-table.heatmap-numbers'
  );
  assert.ok(
    !/\.heatmap-numbers\s+\.admin-data-table/.test(rules),
    'admin.css vẫn còn selector chết dạng hậu duệ `.heatmap-numbers .admin-data-table`'
  );
});

check('ô heatmap rỗng không bị hạ mờ mất tương phản (F3)', () => {
  // Ô rỗng vẫn in số "0" ⇒ mang thông tin ⇒ không được hạ opacity (từng làm
  // tương phản rơi còn ~2.7:1 ở theme sáng, dưới ngưỡng 4.5:1).
  const start = adminCss.indexOf('.heatmap-cell--zero {');
  assert.ok(start !== -1, 'admin.css thiếu khối .heatmap-cell--zero');
  const block = adminCss.slice(start, adminCss.indexOf('}', start));
  assert.ok(
    !/opacity\s*:/.test(block),
    `Khối .heatmap-cell--zero không được hạ opacity: ${block.trim()}`
  );
});

if (failed > 0) {
  console.log(`✗ Admin insights UI: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Admin insights UI: toàn bộ ca đạt.');
}
