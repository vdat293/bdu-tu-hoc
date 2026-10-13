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

/**
 * Emoji trong MÃ admin.js (không phải trong markup tĩnh).
 * Cố ý KHÔNG bắt khoảng Geometric Shapes 25A0-25FF (▲ ▼ ■ ●) vì đó là ký hiệu
 * xu hướng đi kèm số/chữ — spec mục 4.1 yêu cầu "không dựa vào màu đơn thuần,
 * luôn kèm số/nhãn/ký hiệu" — và cũng không bắt General Punctuation (— – •).
 * Các ký hiệu này là glyph văn bản, render giống nhau mọi máy.
 */
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

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
  // Ghim CẢ tuỳ chọn compact + limit: nếu ai bỏ `{ limit: 5, compact: true }`,
  // panel hẹp sẽ nhận bảng 8 cột và tràn ngang — đúng lỗi cần chặn.
  assert.match(
    adminJs,
    /renderFeatureRanking\([^)]*endpoints-list-preview',\s*\{\s*limit:\s*5,\s*compact:\s*true\s*\}/,
    'admin.js phải tái dùng renderFeatureRanking cho preview xếp hạng tính năng của Tổng quan với { limit: 5, compact: true }'
  );
});

/* --------------------------------------------------------------------------
   Task 7b — gộp tab Charts cũ vào Tổng quan/Insights.
   Spec mục 4.3: "Tab Charts cũ được gộp: timeline chi tiết + devices/OS/browser
   chuyển sang Insights; KPI/timeline preview ở Tổng quan." Nên tab `charts`, phần
   <section id="pane-charts"> và mọi id cũ của nó (canvas timeline chi tiết,
   lưới thiết bị, danh sách OS/trình duyệt) phải biến mất khỏi HTML và khỏi JS.
   Rủi ro cần chặn: còn sót một id trong admin.js mà không có trong index.html thì
   runtime chỉ ném lỗi câm (đã xảy ra với safeNumber), test tĩnh không thấy.
   -------------------------------------------------------------------------- */

check('tab Charts cũ đã bị gộp, không còn trong markup hay JS', () => {
  assert.ok(!indexHtml.includes('data-tab="charts"'), 'index.html vẫn còn nút nav data-tab="charts"');
  assert.ok(!indexHtml.includes('id="pane-charts"'), 'index.html vẫn còn <section id="pane-charts">');
  // Id của tab cũ phải biến mất cùng nó — nếu còn thì hoặc là markup mồ côi,
  // hoặc admin.js vẫn đang truy cập canvas không tồn tại.
  for (const deadId of ['chart-timeline-detailed', 'devices-summary-grid', 'os-browser-summary']) {
    assert.ok(!indexHtml.includes(`id="${deadId}"`), `index.html vẫn còn #${deadId} của tab Charts cũ`);
    assert.ok(!adminJs.includes(deadId), `admin.js vẫn còn tham chiếu #${deadId} đã bị xoá`);
  }
  assert.doesNotMatch(adminJs, /renderDetailedChart/, 'admin.js vẫn còn hàm vẽ biểu đồ timeline chi tiết của tab Charts');
  assert.doesNotMatch(adminJs, /charts:\s*'Biểu Đồ/, 'admin.js vẫn còn tiêu đề tab "Biểu Đồ & Xu Hướng"');
  // Timeline nay chỉ còn MỘT bản đang hoạt động ở Tổng quan.
  assert.equal(
    (indexHtml.match(/<canvas[^>]*id="chart-timeline/g) || []).length,
    1,
    'Chỉ được còn đúng 1 canvas timeline (ở Tổng quan), không nhân bản 2 canvas'
  );
});

check('khối Thiết Bị đã chuyển sang tab Insights với id mới', () => {
  assert.ok(indexHtml.includes('id="insights-devices-grid"'), 'Insights thiếu lưới thiết bị #insights-devices-grid');
  assert.ok(indexHtml.includes('id="insights-os-browser"'), 'Insights thiếu khối OS/trình duyệt #insights-os-browser');
  // Id mới phải nằm trong section#pane-insights, không phải rơi lại ở Tổng quan.
  const paneStart = indexHtml.indexOf('id="pane-insights"');
  const paneEnd = indexHtml.indexOf('</section>', paneStart);
  const insightsPane = indexHtml.slice(paneStart, paneEnd);
  assert.ok(insightsPane.includes('id="insights-devices-grid"'), '#insights-devices-grid phải nằm trong pane-insights');
  assert.ok(insightsPane.includes('id="insights-os-browser"'), '#insights-os-browser phải nằm trong pane-insights');
  // renderDevices phải vẽ vào id mới, không trỏ lại id đã xoá.
  const renderDevices = adminJs.slice(
    adminJs.indexOf('function renderDevices('),
    adminJs.indexOf('function renderDevices(') + 2500
  );
  assert.match(renderDevices, /dom\.insightsDevicesGrid/, 'renderDevices phải vẽ vào #insights-devices-grid');
  assert.match(renderDevices, /dom\.insightsOsBrowser/, 'renderDevices phải vẽ vào #insights-os-browser');
});

check('mọi id mà admin.js truy cập đều tồn tại trong index.html', () => {
  // Chặn lớp bug "id mồ côi": JS lấy getElementById/resolveElement mà HTML không
  // có phần tử thì chỉ chết lúc chạy, và im lặng chứ không báo lỗi cho ai thấy.
  const htmlIds = new Set([...indexHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const referenced = new Set();
  for (const m of adminJs.matchAll(/getElementById\('([^']+)'\)/g)) referenced.add(m[1]);
  for (const m of adminJs.matchAll(/resolveElement\('#([^']+)'\)/g)) referenced.add(m[1]);
  for (const m of adminJs.matchAll(/renderSkeleton\('#([^']+)'/g)) referenced.add(m[1]);
  for (const m of adminJs.matchAll(/renderEmpty\('#([^']+)'/g)) referenced.add(m[1]);
  const missing = [...referenced].filter((id) => !htmlIds.has(id)).sort();
  assert.deepEqual(missing, [], `admin.js tham chiếu id không tồn tại trong index.html: ${missing.join(', ')}`);
  // Chiều ngược: canvas trong HTML phải được JS biết tới (tránh khối trống câm).
  const canvases = [...indexHtml.matchAll(/<canvas[^>]*id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(canvases.length > 0, 'index.html không còn canvas nào — biểu đồ đã bị xoá nhầm');
});

check('admin.js không còn emoji nào (chỉ dùng inline SVG)', () => {
  // Bỏ comment trước khi so: dấu "→" trong chú thích tiếng Việt không phải icon.
  const code = adminJs
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(
    code,
    EMOJI_RE,
    `admin.js còn emoji — thay bằng ICONS/renderIcon. Ký tự tìm thấy: ${(code.match(EMOJI_RE) || []).join(' ')}`
  );
  // Chặn đúng những emoji từng còn trong file (renderDevices 📱📟🤖💻, nút Chép 📋,
  // nút xem 👁, cảnh báo ⚠, trạng thái sinh viên 🟢⚪, nút Dấu vết 🧭, dấu chép ✓).
  for (const emoji of ['\u{1F4F1}', '\u{1F4DF}', '\u{1F916}', '\u{1F4BB}', '\u{1F4C1}', '\u{1F441}', '\u{26A0}', '\u{1F7E2}', '\u{26AA}', '\u{1F9ED}', '\u{2713}']) {
    assert.ok(!adminJs.includes(emoji), `admin.js vẫn còn emoji ${emoji}`);
  }
  // renderDevices phải đi qua ICONS chứ không chọn emoji theo tên thiết bị.
  assert.match(adminJs, /const DEVICE_PRESENTATION = \{/, 'admin.js phải khai bảng map tên thiết bị → icon SVG');
  assert.match(adminJs, /DEVICE_PRESENTATION\[name\]/, 'renderDevices phải tra DEVICE_PRESENTATION để lấy icon');
});

/* --------------------------------------------------------------------------
   Task 8 — tab Nhật ký + Sinh viên.
   Hai hợp đồng dễ vỡ nhất của hai tab này:
     1. Bảng phải nằm trong khung cuộn riêng (.table-scroll) để bảng rộng 720px+
        không đẩy tràn ngang CẢ TRANG ở 375/1024 (đúng lỗi tràn mà review Task 7b
        đã ghi nhận: Nhật ký ~15px ở 375, Sinh viên ~389px ở 1024).
     2. Nút "Hành trình" trong bảng Sinh viên phải gọi openJourney() (Task 10 nối
        endpoint /insights/users/:mssv/journey). Task 8 chỉ dựng nút + khung hàm.
   Vẫn khóa việc GIỮ các id cũ mà JS đổ dữ liệu vào — đổi id là bảng trắng câm.
   -------------------------------------------------------------------------- */

check('bảng Nhật ký và Sinh viên được bọc trong khung .table-scroll', () => {
  // Không chỉ khẳng định class có mặt: phải đúng cấu trúc "khung bao quanh bảng"
  // (<div class="table-scroll"> rồi tới <table>), nếu không thì bảng vẫn có thể
  // nằm ngoài khung cuộn và đẩy tràn trang dù class xuất hiện đâu đó.
  const logsPane = sliceBetween(indexHtml, 'id="pane-logs"', '</section>');
  assert.match(
    logsPane,
    /<div class="table-scroll">\s*<table/,
    'Vùng Nhật ký phải đặt .table-scroll BAO QUANH <table> để bảng không đẩy tràn cả trang'
  );
  const usersPane = sliceBetween(indexHtml, 'id="pane-users"', '</section>');
  assert.match(
    usersPane,
    /<div class="table-scroll">\s*<table/,
    'Vùng Sinh viên phải đặt .table-scroll BAO QUANH <table> để bảng không đẩy tràn cả trang'
  );
});

check('bảng Sinh viên có nút Hành trình gọi openJourney()', () => {
  // Ghim NÚT GỌI hàm, không chỉ khai báo function openJourney(). Chỉ khớp
  // /openJourney\(/ thì chính dòng `function openJourney(` cũng thoả — nút có
  // thể chưa được nối mà test vẫn xanh. Yêu cầu chuỗi nút nằm NGAY trước lời gọi.
  assert.match(
    adminJs,
    /btn-view-student-journey[\s\S]{0,400}openJourney\(/,
    'admin.js phải có nút .btn-view-student-journey được NỐI tới openJourney()'
  );
});

check('id cũ của hai tab Nhật ký + Sinh viên vẫn được giữ', () => {
  for (const id of ['logs-table-body', 'visited-students-table-body']) {
    assert.ok(indexHtml.includes(`id="${id}"`), `index.html mất phần tử #${id}`);
  }
});

if (failed > 0) {
  console.log(`✗ Admin redesign UI foundation: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Admin redesign UI foundation: toàn bộ ca đạt.');
}
