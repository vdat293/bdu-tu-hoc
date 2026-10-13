/**
 * Test nền tảng giao diện /admin sau redesign (Task 5 của kế hoạch admin-insights).
 *
 * Thuần đọc file bằng fs.readFileSync + assert.match nên KHÔNG cần DB và chạy trần được:
 *   node tests/test-admin-redesign-ui.js
 * Nhớ chạy kèm env managed:
 *   $env:NODE_ENV='test'; $env:BDU_TEST_MODE='1'; $env:BDU_TEST_RUNNER='safe'
 *
 * Vì sao test tĩnh: /admin là HTML/CSS/JS thuần (không phải React) nên không có
 * sẵn môi trường DOM để render. Ở đây chỉ chốt các "hợp đồng" của nền tảng thiết
 * kế: theme mặc định sáng, token light-first, icon SVG thay emoji, bộ helper định
 * dạng/trạng thái, và việc GIỮ NGUYÊN id cũ cùng idiom escape mà các test khác đã ghim.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexHtml = fs.readFileSync(new URL('../public/admin/index.html', import.meta.url), 'utf8');
const adminJs = fs.readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
const adminCss = fs.readFileSync(new URL('../public/admin/admin.css', import.meta.url), 'utf8');

// Emoji/ký hiệu trang trí KHÔNG còn được phép xuất hiện ở phần shell (sidebar + topbar)
// vì chúng bị thay bằng inline SVG (spec mục 4.2: bỏ emoji, dùng Lucide-style SVG).
const SHELL_SYMBOL_RE = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

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

// Lấy nguyên khối markup giữa hai mốc, để chỉ soi đúng "shell" thay vì cả trang.
function sliceBetween(source, startMarker, endMarker) {
  const from = source.indexOf(startMarker);
  assert.ok(from !== -1, `Không tìm thấy mốc đầu "${startMarker}"`);
  const to = source.indexOf(endMarker, from);
  assert.ok(to !== -1, `Không tìm thấy mốc cuối "${endMarker}"`);
  return source.slice(from, to);
}

check('theme mặc định là SÁNG (light-first) ở cả markup và JS', () => {
  assert.match(
    indexHtml,
    /<html[^>]*data-theme="light"/,
    'index.html phải mở trang với data-theme="light"'
  );
  assert.match(
    adminJs,
    /const DEFAULT_THEME = 'light'/,
    "admin.js phải khai hằng DEFAULT_THEME = 'light'"
  );
  // Fallback khi đọc attribute rỗng cũng phải là 'light' chứ không phải 'dark'
  // (chấp nhận cả literal 'light' lẫn hằng DEFAULT_THEME = 'light').
  assert.match(
    adminJs,
    /data-theme['"]?\s*\)\s*\|\|\s*(?:DEFAULT_THEME|'light')/,
    "Fallback theme trong admin.js phải là 'light'"
  );
  // Chấp nhận mọi tên biến: chỉ cần đúng tam nguyên đảo dark <-> light.
  assert.match(
    adminJs,
    /===\s*'dark'\s*\?\s*'light'\s*:\s*'dark'/,
    'Công tắc theme vẫn phải chuyển qua lại giữa dark và light'
  );
});

check('token light-first đã khai báo trong admin.css', () => {
  assert.ok(adminCss.includes('[data-theme="light"]'), 'admin.css phải có selector [data-theme="light"]');
  assert.ok(adminCss.includes('[data-theme="dark"]'), 'admin.css phải có [data-theme="dark"] làm override');
  for (const token of [
    '--color-primary',
    '--color-background',
    '--color-card',
    '--color-foreground',
    '--color-muted-foreground',
    '--color-border',
    '--color-destructive'
  ]) {
    assert.ok(adminCss.includes(token), `admin.css thiếu token ${token}`);
  }
  // Bộ màu sáng theo spec mục 4.2 phải có mặt đúng giá trị đã chốt.
  for (const hex of ['#F8FAFC', '#FFFFFF', '#1E3A8A', '#475569', '#DBEAFE', '#1E40AF', '#3B82F6', '#D97706', '#DC2626', '#E9EEF6']) {
    assert.ok(
      adminCss.toUpperCase().includes(hex.toUpperCase()),
      `admin.css thiếu màu ${hex} của bảng màu light`
    );
  }
});

check('sidebar và topbar dùng inline SVG, không còn emoji', () => {
  // Mốc mở không kèm '>' vì thẻ <nav> còn thuộc tính aria-label phía sau class.
  const navBlock = sliceBetween(indexHtml, '<nav class="sidebar-menu"', '</nav>');
  const navButtonCount = (navBlock.match(/class="nav-btn/g) || []).length;
  assert.ok(navButtonCount >= 5, `Phải có ít nhất 5 nút nav trong sidebar, hiện có ${navButtonCount}`);
  const svgCount = (navBlock.match(/<svg\b/g) || []).length;
  assert.ok(
    svgCount >= navButtonCount,
    `Mỗi nút nav phải có 1 SVG (${navButtonCount} nút / ${svgCount} svg)`
  );
  assert.doesNotMatch(navBlock, SHELL_SYMBOL_RE, 'Sidebar vẫn còn emoji/ký hiệu trang trí');
  assert.doesNotMatch(
    sliceBetween(indexHtml, '<header class="admin-topbar">', '</header>'),
    SHELL_SYMBOL_RE,
    'Topbar vẫn còn emoji/ký hiệu trang trí'
  );
  assert.match(adminJs, /const ICONS = \{/, 'admin.js phải khai bộ ICONS');
});

check('helper định dạng và trạng thái dùng chung đã có trong admin.js', () => {
  for (const fnName of [
    'safeNumber',
    'formatNumber',
    'formatPercent',
    'formatDurationMs',
    'formatDateTime',
    'renderSkeleton',
    'renderEmpty',
    'renderError'
  ]) {
    assert.match(adminJs, new RegExp(`function ${fnName}\\(`), `admin.js thiếu helper ${fnName}`);
  }
  // safeNumber là nền của cả nhóm: formatNumber/formatDurationMs gọi nó. Nếu ai
  // đó xoá nhầm (đã xảy ra ở vòng implementer đầu) thì mọi tab gọi tới đều vỡ
  // bằng ReferenceError lúc chạy chứ không phải lúc test — nên ghim riêng ra.
  assert.match(adminJs, /function safeNumber\(value\)/, 'admin.js phải giữ hàm safeNumber(value)');
});

check('id cũ của tab Hệ thống vẫn được giữ nguyên', () => {
  for (const id of [
    'service-lock-toggle',
    'service-lock-title',
    'service-lock-message',
    'service-lock-state',
    'ranking-sync-toggle',
    'ranking-sync-state',
    'ranking-sync-last',
    'ranking-sync-next'
  ]) {
    assert.ok(indexHtml.includes(id), `index.html mất phần tử #${id}`);
  }
});

check('idiom escape mà test-admin-rendering-safety.js ghim vẫn còn', () => {
  // Nếu sửa markup bảng sinh viên mà bỏ escape thì test rendering-safety sẽ đỏ;
  // khóa luôn ở đây để Task 5 không làm gãy lớp bảo vệ XSS.
  assert.match(adminJs, /const safeMssv = escapeHtml\(s\.mssv\)/);
  assert.match(adminJs, /const safeFullName = escapeHtml\(s\.full_name/);
  assert.match(adminJs, /const methodCls = `method-\$\{cssToken\(method\)\}`/);
  assert.match(adminJs, /data-log="\$\{jsonStr\}"/);
});

check('class thành phần chung đã khai báo trong admin.css', () => {
  for (const cssClass of [
    '.panel-card',
    '.kpi-card',
    '.table-scroll',
    '.chip',
    '.stack-skeleton',
    '.state-empty',
    '.state-error',
    '.svg-icon'
  ]) {
    assert.ok(adminCss.includes(cssClass), `admin.css thiếu class thành phần chung ${cssClass}`);
  }
});

/* --------------------------------------------------------------------------
   Task 7 — tab Tổng quan.
   Hai hợp đồng dễ vỡ nhất khi làm lại Tổng quan: (1) KPI phải dùng bộ thành
   phần chung (.kpi-card) chứ không quay lại kiểu riêng, và (2) preview "top
   tính năng" phải TÁI DÙNG renderFeatureRanking thay vì dựng một renderer thứ
   hai — nếu tách đôi, tab Insights và Tổng quan dễ lệch nhau về cách đọc số.
   -------------------------------------------------------------------------- */

check('tab Tổng quan dùng thành phần chung và giữ id KPI cũ', () => {
  const overview = sliceBetween(indexHtml, 'id="pane-overview"', '</section>');
  assert.match(overview, /class="kpi-card"/, 'Vùng Tổng quan phải dùng thành phần chung .kpi-card');
  // renderOverview() ghi thẳng vào các id này. Đổi id là vỡ runtime (ô KPI đứng
  // "--" mãi) mà test tĩnh không thấy ngay, nên chốt luôn danh sách id KPI cũ.
  for (const id of [
    'kpi-total-requests',
    'kpi-growth',
    'kpi-2xx',
    'kpi-4xx',
    'kpi-5xx',
    'kpi-unique-mssv',
    'kpi-unique-users',
    'kpi-avg-latency',
    'kpi-latency-status',
    'kpi-error-rate',
    'kpi-error-status'
  ]) {
    assert.ok(overview.includes(`id="${id}"`), `Vùng Tổng quan mất #${id}`);
  }
});

check('preview top tính năng ở Tổng quan tái dùng renderFeatureRanking', () => {
  assert.ok(indexHtml.includes('id="endpoints-list-preview"'), 'index.html phải giữ #endpoints-list-preview');
  assert.match(
    adminJs,
    /renderFeatureRanking\([^)]*endpoints-list-preview/,
    'admin.js phải tái dùng renderFeatureRanking cho preview xếp hạng tính năng của Tổng quan'
  );
});

if (failed > 0) {
  console.log(`✗ Admin redesign UI foundation: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Admin redesign UI foundation: toàn bộ ca đạt.');
}
