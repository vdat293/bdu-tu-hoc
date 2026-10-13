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

/* --------------------------------------------------------------------------
   Task 9 — tab Hệ thống.
   Hai hợp đồng dễ vỡ nhất khi làm lại tab này:
     1. Panel VPS + ranking-sync + service-lock phải dùng bộ thành phần chung
        (.panel-card/.system-metrics-row/.sys-card) và KHÔNG còn style inline
        rải rác — nếu không, đổi token là tab này lệch khỏi các tab còn lại.
     2. Logic service-lock/ranking-sync giữ nguyên: đúng endpoint, đúng
        method PUT, confirm() chỉ trong nhánh BẬT khóa. Đổi nhầm là đá nhầm
        người dùng ra màn hình bảo trì hoặc tắt nhầm đồng bộ xếp hạng.
   -------------------------------------------------------------------------- */

check('tab Hệ thống dùng thành phần chung, không còn style inline', () => {
  const systemPane = sliceBetween(indexHtml, 'id="pane-system"', '</section>');
  assert.match(systemPane, /class="panel-card"/, 'Vùng Hệ thống phải dùng thành phần chung .panel-card');
  assert.match(systemPane, /class="system-metrics-row"/, 'Vùng Hệ thống phải giữ lưới .system-metrics-row');
  assert.match(systemPane, /class="sys-card"/, 'Vùng Hệ thống phải giữ thẻ số liệu .sys-card');
  // Style lẻ trong markup là mầm lệch theme: khoảng cách gom vào CSS
  // (.system-stack), đổi một chỗ là cả tab đổi theo.
  assert.doesNotMatch(systemPane, /style="/, 'Vùng Hệ thống không được còn style inline');
  assert.ok(adminCss.includes('.system-stack'), 'admin.css phải có class .system-stack cho tab Hệ thống');
});

check('logic service-lock và ranking-sync giữ nguyên sau redesign', () => {
  // Endpoint + method là hợp đồng với backend: đổi nhầm là công tắc gọi sai chỗ.
  assert.match(adminJs, /\/api\/admin\/dashboard\/service-lock/, 'admin.js phải giữ endpoint service-lock');
  assert.match(adminJs, /\/api\/admin\/dashboard\/ranking-sync/, 'admin.js phải giữ endpoint ranking-sync');
  assert.match(adminJs, /method:\s*'PUT'/, "admin.js phải giữ method: 'PUT'");
  // confirm() chỉ trong nhánh BẬT khóa: khóa nhầm đá toàn bộ người dùng đang
  // online sang màn hình bảo trì, còn mở khóa thì an toàn nên không hỏi.
  const lockFlow = adminJs.slice(
    adminJs.indexOf('serviceLockToggle.addEventListener'),
    adminJs.indexOf('serviceLockToggle.addEventListener') + 2000
  );
  assert.match(lockFlow, /if\s*\(\s*\w*[Ll]ocked\w*\s*\)[\s\S]*confirm\(/, 'confirm() phải nằm trong nhánh bật khóa');
});

/* --------------------------------------------------------------------------
   Task 11 — trợ năng, tương phản, đồng bộ thời gian/số, chuyển động, tràn ngang.
   --------------------------------------------------------------------------
   Nhóm này GHIM những hợp đồng số đo được, không chỉ "có vẻ đúng":
     1. Cả 5 cửa sổ phải là hộp thoại cho trình đọc màn hình (role/aria-modal/
        aria-labelledby trỏ đúng tiêu đề) và đóng được bằng Esc.
     2. Tương phản: những cặp chữ-trên-nền-tint dưới 4.5:1 ở theme sáng được
        TÍNH LẠI ngay trong test (pha màu + công thức WCAG) chứ không ghi tay
        "mình đo rồi" — đổi token một cái là test đỏ.
     3. Bộ lọc phải báo trạng thái không chỉ bằng màu (aria-pressed) và mọi màn
        phải đọc CÙNG một mốc thời gian + cùng một cách định dạng số.
   -------------------------------------------------------------------------- */

/* ---- 1a. Ngữ nghĩa hộp thoại của cả 5 cửa sổ ---- */

check('cả 5 cửa sổ đều khai báo hộp thoại cho trình đọc màn hình', () => {
  // Ghim theo bảng: [id overlay, id tiêu đề]. aria-labelledby trỏ sai id là
  // hộp thoại không tên — trình đọc màn hình chỉ đọc "hộp thoại" trống trơn.
  const dialogs = [
    ['modal-log-detail', 'modal-log-title'],
    ['modal-auth-gate', 'modal-auth-title'],
    ['modal-purge-logs', 'modal-purge-title'],
    ['modal-student-activity', 'student-activity-title'],
    ['modal-journey', 'journey-title']
  ];
  const htmlIds = new Set([...indexHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

  for (const [overlayId, titleId] of dialogs) {
    const from = indexHtml.indexOf(`id="${overlayId}"`);
    assert.ok(from !== -1, `index.html mất cửa sổ #${overlayId}`);
    const block = indexHtml.slice(from, indexHtml.indexOf('\n  </div>', from));
    assert.match(
      block,
      /class="modal-card[^"]*"[^>]*role="dialog"/,
      `#${overlayId}: .modal-card phải có role="dialog"`
    );
    assert.match(block, /aria-modal="true"/, `#${overlayId}: thiếu aria-modal="true"`);
    assert.match(
      block,
      new RegExp(`aria-labelledby="${titleId}"`),
      `#${overlayId}: thiếu aria-labelledby="${titleId}"`
    );
    assert.ok(htmlIds.has(titleId), `#${overlayId} trỏ aria-labelledby tới id không tồn tại: ${titleId}`);
  }
});

check('Esc đóng được cả 5 cửa sổ mà không đổi hành vi đóng hiện có', () => {
  // Ghim đủ 5 hàm close: thiếu một là người điều khiển bằng bàn phím bị kẹt
  // trong đúng cửa sổ đó.
  const escStart = adminJs.indexOf('ESC_CLOSABLE_MODALS');
  assert.ok(escStart !== -1, 'admin.js phải khai bảng cửa sổ đóng bằng Esc');
  const escBlock = adminJs.slice(escStart, adminJs.indexOf('// Initialization', escStart));

  assert.match(escBlock, /addEventListener\('keydown'/, 'Phải bắt sự kiện keydown');
  assert.match(escBlock, /event\.key\s*!==\s*'Escape'/, 'Phải lọc đúng phím Esc');
  assert.doesNotMatch(
    escBlock,
    /addEventListener\('keydown'[^)]*keyup/,
    'Esc phải bắt trên keydown'
  );

  for (const closeFn of [
    'closeJourneyModal',
    'closeLogDetailModal',
    'closeStudentActivityModal',
    'closePurgeModal',
    'closeAuthModal'
  ]) {
    assert.ok(escBlock.includes(`${closeFn}()`), `Esc chưa nối tới ${closeFn}()`);
  }

  // Cửa sổ xác thực khi bị chặn cố ý giấu nút đóng; Esc không được phá vỡ điều đó.
  assert.match(
    escBlock,
    /btnCloseAuthModal\.style\.display\s*!==\s*'none'[\s\S]{0,80}closeAuthModal\(\)/,
    'Esc ở modal xác thực chỉ được đóng khi nút đóng đang hiện'
  );
});

/* ---- 1b. Tương phản chữ trên nền tint (đo lại bằng công thức WCAG) ---- */

/** Đọc giá trị một biến CSS trong khối theme (`:root` hoặc `[data-theme="dark"]`). */
function readToken(css, theme, name) {
  // Dùng regex chứ không so chuỗi thẳng: file CSS trong repo dùng CRLF, nên
  // mốc có \n cứng sẽ không khớp và test đỏ vì lý do sai.
  const startRe = theme === 'dark' ? /\[data-theme="dark"\]\s*\{/ : /:root,\s*\[data-theme="light"\]\s*\{/;
  const start = css.search(startRe);
  assert.ok(start !== -1, `admin.css không tìm thấy khối theme ${theme}`);
  const block = css.slice(start, css.indexOf('\n}', start));
  const match = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(match, `admin.css thiếu token ${name} ở theme ${theme}`);
  return match[1].trim();
}

/** Giải mã #RGB / #RRGGBB / rgb() / rgba() / var(--token) thành [r, g, b, a]. */
function parseCssColor(value, css, theme, depth = 0) {
  const raw = String(value).trim();
  const ref = raw.match(/^var\((--[a-z-]+)\)$/i);
  if (ref && depth < 5) return parseCssColor(readToken(css, theme, ref[1]), css, theme, depth + 1);

  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }

  const rgba = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(',').map((p) => parseFloat(p));
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }

  throw new Error(`Không đọc được màu "${raw}" (theme ${theme})`);
}

/** Pha một lớp nửa trong suốt lên nền đục bên dưới. */
function composite(top, bottom) {
  const a = top[3];
  return [
    top[0] * a + bottom[0] * (1 - a),
    top[1] * a + bottom[1] * (1 - a),
    top[2] * a + bottom[2] * (1 - a),
    1
  ];
}

/** Độ sáng tương đối theo WCAG 2.1. */
function relativeLuminance([r, g, b]) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Nền thật của một huy hiệu: tint pha lên card, card pha lên nền trang. */
function tintedBackground(css, theme, tintToken) {
  const page = parseCssColor(readToken(css, theme, '--color-background'), css, theme);
  const card = composite(parseCssColor(readToken(css, theme, '--color-card'), css, theme), page);
  return composite(parseCssColor(readToken(css, theme, tintToken), css, theme), card);
}

check('chữ trên nền tint đạt >= 4.5:1 ở CẢ HAI theme (đo lại bằng công thức WCAG)', () => {
  // Trước khi tách token, các cặp này chỉ đạt ~4.0-4.5:1 ở theme sáng
  // (.journey-stat-value.error ~4.15:1, .journey-event-flag ~4.06:1).
  const pairs = [
    ['--color-success-text', '--tint-success', 'success'],
    ['--color-warning-text', '--tint-warning', 'warning'],
    ['--color-destructive-text', '--tint-danger', 'lỗi']
  ];

  for (const theme of ['light', 'dark']) {
    for (const [textToken, tintToken, label] of pairs) {
      const ratio = contrastRatio(
        parseCssColor(readToken(adminCss, theme, textToken), adminCss, theme),
        tintedBackground(adminCss, theme, tintToken)
      );
      assert.ok(
        ratio >= 4.5,
        `${textToken} trên ${tintToken} ở theme ${theme} chỉ đạt ${ratio.toFixed(2)}:1 (cần >= 4.5:1) — hãy đậm màu chữ hoặc bỏ tint, đừng hạ nền`
      );
      // Không cảnh báo im lặng: in số đo để người đọc thấy biên.
      console.log(`    · theme ${theme} · ${label}: ${ratio.toFixed(2)}:1`);
    }
  }
});

check('không rule nào còn đặt màu chữ gốc lên nền tint', () => {
  // Cấu trúc: mọi rule có nền tint-*-success/warning/danger phải lấy màu chữ
  // ở bản "-text"; nếu không thì một rule mới thêm về sau sẽ lặp lại đúng lỗi
  // đang sửa mà không ai để ý.
  const toneTokens = {
    success: { base: '--color-success', text: '--color-success-text' },
    warning: { base: '--color-warning', text: '--color-warning-text' },
    danger: { base: '--color-destructive', text: '--color-destructive-text' }
  };
  const rules = adminCss.replace(/\/\*[\s\S]*?\*\//g, '').split('}');

  for (const block of rules) {
    const tint = block.match(/background:\s*var\(--tint-(success|warning|danger)\)/);
    if (!tint) continue;
    const { base, text } = toneTokens[tint[1]];
    // `(^|[^-])` để `border-color: var(...)` không bị tính nhầm là màu chữ.
    // Rule chỉ đặt nền mà không đặt màu chữ (ví dụ .state-error) thì kế thừa
    // --text-main vốn đã tương phản tốt, nên chỉ chặn đúng trường hợp nguy hiểm:
    // tự đặt màu chữ tone gốc lên nền tint.
    const usesBaseAsText = new RegExp(`(^|[^-])color:\\s*var\\(${base}\\)`).test(block);
    assert.ok(
      !usesBaseAsText,
      `Còn rule đặt chữ ${base} lên nền tint-${tint[1]}; phải dùng ${text}:\n${block.trim()}\n}`
    );
    assert.ok(
      !usesBaseAsText || block.includes(text),
      `Rule có nền tint-${tint[1]} phải lấy màu chữ từ ${text}`
    );
  }

  // Và ngược lại: các huy hiệu trạng thái vẫn phải còn lớp màu để nhìn nhanh,
  // tức là token "-text" không được thay thế toàn bộ token gốc.
  for (const tone of ['--color-success', '--color-warning', '--color-destructive']) {
    assert.ok(
      adminCss.includes(`${tone}: `),
      `admin.css mất token gốc ${tone} (vẫn cần cho viền/nền đậm, không chỉ cho chữ)`
    );
  }
});

/* ---- 1c. Trạng thái bộ lọc không chỉ bằng màu ---- */

check('pill mốc thời gian báo trạng thái bằng aria-pressed như chip Nhật ký', () => {
  assert.match(
    indexHtml,
    /<div class="time-range-group" id="time-range-group"[^>]*role="group"/,
    'Nhóm pill mốc thời gian phải là role="group" kèm aria-label'
  );

  const group = sliceBetween(indexHtml, 'id="time-range-group"', '</div>');
  const pills = [...group.matchAll(/<button[^>]*class="range-pill[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert.equal(pills.length, 6, `Phải còn 6 pill mốc thời gian, thấy ${pills.length}`);

  let pressed = 0;
  for (const pill of pills) {
    assert.match(pill, /aria-pressed="(true|false)"/, `Pill thiếu aria-pressed: ${pill}`);
    if (pill.includes('aria-pressed="true"')) pressed += 1;
  }
  assert.equal(pressed, 1, 'Chỉ được có đúng một pill aria-pressed="true"');

  // Mốc đang bật trong markup phải khớp .active (mặc định 24h như state).
  const activePill = pills.find((p) => p.includes('aria-pressed="true"'));
  assert.match(activePill, /data-range="24h"/, 'Mốc mặc định 24h phải là pill đang bật');
  assert.match(activePill, /class="range-pill active"/, 'Pill 24h phải mang class .active');

  // JS phải cập nhật lại khi bấm, nếu không aria-pressed sẽ kẹt ở giá trị cũ.
  assert.match(
    adminJs,
    /function syncRangePillStates\(\)/,
    'admin.js phải có hàm syncRangePillStates()'
  );
  const pillHandler = adminJs.slice(
    adminJs.indexOf('dom.rangePills.forEach'),
    adminJs.indexOf('dom.rangePills.forEach') + 600
  );
  assert.match(
    pillHandler,
    /syncRangePillStates\(\)/,
    'Handler bấm pill phải gọi syncRangePillStates() để aria-pressed theo .active'
  );
});

/* ---- 1d. Đồng bộ mốc thời gian và định dạng số giữa các tab ---- */

check('modal Hành trình bám mốc thời gian ở topbar như modal Dấu vết API', () => {
  assert.doesNotMatch(
    adminJs,
    /JOURNEY_TIME_RANGE/,
    'Không được cố định mốc thời gian riêng cho hành trình (lệch với bộ lọc topbar)'
  );
  const openJourney = adminJs.slice(
    adminJs.indexOf('async function openJourney'),
    adminJs.indexOf('async function openJourney') + 2200
  );
  assert.match(
    openJourney,
    /journeyTimeRange\s*=\s*state\.timeRange/,
    'openJourney phải lấy mốc thời gian từ state.timeRange'
  );
  assert.match(
    openJourney,
    /timeRange=\$\{encodeURIComponent\(journeyTimeRange\)\}/,
    'Endpoint hành trình phải gửi mốc đang dùng, và encode để không vỡ URL'
  );
  // Mọi nhãn trong modal phải đọc mốc đã dùng, không đọc lại state lúc vẽ —
  // không thì đổi mốc giữa chừng là nhãn lệch với dữ liệu đang hiện.
  for (const fn of ['renderJourney', 'renderJourneyNotice']) {
    const body = adminJs.slice(adminJs.indexOf(`function ${fn}`), adminJs.indexOf(`function ${fn}`) + 1500);
    assert.doesNotMatch(
      body,
      /labelForTimeRange\(state\.timeRange\)/,
      `${fn} phải dùng journeyTimeRange (mốc đã tải) thay vì state.timeRange`
    );
  }
});

check('không còn .toLocaleString() trần trong admin.js', () => {
  // Một số mà tab này in "1,234" còn tab kia in "1.234" là kiểu lệch locale
  // khó nhận ra nhất. Chỉ được phép gọi trong chính helper formatNumber,
  // nên cắt riêng đoạn đó ra rồi đòi không còn gọi nào nữa.
  const code = adminJs
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const helperStart = code.indexOf('function formatNumber');
  const helperEnd = code.indexOf('function formatPercent');
  const outsideHelper = code.slice(0, helperStart) + code.slice(helperEnd);
  const bare = [...outsideHelper.matchAll(/[^.\w]toLocaleString\(\)/g)];
  assert.equal(
    bare.length,
    0,
    `Còn ${bare.length} chỗ gọi .toLocaleString() trần ngoài helper formatNumber — dùng formatNumber()/formatDateTime()`
  );
  // Ba chỗ dễ sót nhất trong bảng Nhật ký / bảng Sinh viên.
  assert.ok(!code.includes('p.total.toLocaleString()'), 'renderLogs còn dùng toLocaleString trần');
  assert.ok(!code.includes('pagination.total.toLocaleString()'), 'renderVisitedStudents còn dùng toLocaleString trần');
  // Thời gian trong modal chi tiết phải qua helper chung, không phải locale máy.
  assert.match(
    adminJs,
    /dom\.modalLogTime\.textContent\s*=\s*formatDateTime\(/,
    'modal chi tiết nhật ký phải dùng formatDateTime()'
  );
});

check('nhãn nhóm ở Insights dùng heading h3 thay div trơn', () => {
  const start = adminJs.indexOf('function renderDevices');
  const renderDevices = adminJs.slice(start, adminJs.indexOf('\nfunction ', start + 10));
  assert.match(
    renderDevices,
    /<h3 class="breakdown-group-title">Hệ Điều Hành<\/h3>/,
    'Nhóm Hệ Điều Hành phải là h3 (h2 tiêu đề khối -> h3 nhóm con)'
  );
  assert.match(
    renderDevices,
    /<h3 class="breakdown-group-title">Trình Duyệt<\/h3>/,
    'Nhóm Trình Duyệt phải là h3'
  );
  assert.doesNotMatch(
    renderDevices,
    /<div class="breakdown-group-title">/,
    'Không được còn div.breakdown-group-title'
  );
  // h3 có margin mặc định của trình duyệt; phải kẹp lại trong CSS.
  const titleRule = adminCss.slice(
    adminCss.indexOf('.breakdown-group-title {'),
    adminCss.indexOf('.breakdown-group-title {') + 300
  );
  assert.match(titleRule, /margin:\s*0/, '.breakdown-group-title phải kẹp margin về 0');
});

/* ---- 1e. Chuyển động + tràn ngang ---- */

check('prefers-reduced-motion tắt sạch chuyển động và hiệu ứng', () => {
  const start = adminCss.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(start !== -1, 'admin.css thiếu khối @media (prefers-reduced-motion: reduce)');
  const block = adminCss.slice(start, adminCss.indexOf('\n}', adminCss.indexOf('}', start)) + 2);
  assert.match(block, /animation-duration:\s*0\.001ms\s*!important/, 'Phải tắt animation');
  assert.match(block, /transition-duration:\s*0\.001ms\s*!important/, 'Phải tắt transition');
  assert.match(block, /scroll-behavior:\s*auto\s*!important/, 'Phải tắt cuộn mượt');
  // Nút làm mới có vòng quay; nếu không tắt riêng thì vẫn quay dưới reduced-motion.
  assert.ok(adminCss.includes('@keyframes'), 'admin.css có @keyframes — cần đảm bảo reduced-motion tắt được');
});

check('khung bảng cuộn riêng và trục chính bị kẹp (không tràn ngang cả trang)', () => {
  const scrollRule = adminCss.slice(
    adminCss.indexOf('.table-scroll,'),
    adminCss.indexOf('.table-scroll,') + 300
  );
  assert.match(scrollRule, /overflow-x:\s*auto/, 'Khung bảng phải cuộn ngang trong chính nó');
  assert.match(scrollRule, /width:\s*100%/, 'Khung bảng phải giữ width: 100%');

  // min-width: 0 ở .admin-main-wrapper là thứ giữ cả trang không tràn ở 1024px.
  assert.match(
    adminCss,
    /\.admin-main-wrapper\s*\{[^}]*min-width:\s*0/,
    '.admin-main-wrapper phải có min-width: 0 (flex item mặc định min-width:auto làm tràn trang)'
  );
  // Lưới chứa bảng rộng phải kẹp cột bằng minmax(0, 1fr): nếu để `auto`, lưới
  // bị nới theo phần tử rộng nhất và đẩy tràn ngang CẢ TRANG.
  assert.match(
    adminCss,
    /\.insight-stack\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    '.insight-stack phải kẹp cột bằng minmax(0, 1fr) (bảng số dự phòng rộng 900px)'
  );
  // Các lưới tự co (auto-fit + minmax) an toàn ở 375px vì tự xuống 1 cột khi
  // bề rộng khung nhỏ hơn số nhỏ nhất của một ô — chỉ cần không đặt min rộng hơn
  // bề rộng khung ở 375px (khung ~343px sau padding).
  for (const grid of ['.kpi-grid', '.system-metrics-row', '.activity-summary-grid']) {
    const at = adminCss.indexOf(`${grid} {`);
    assert.ok(at !== -1, `admin.css thiếu lưới ${grid}`);
    const rule = adminCss.slice(at, adminCss.indexOf('}', at));
    const min = rule.match(/minmax\((\d+)px/);
    assert.ok(min, `${grid} phải dùng minmax(Npx, 1fr) để tự xuống cột ở màn hẹp`);
    assert.ok(
      Number(min[1]) <= 260,
      `${grid} đặt min ${min[1]}px — lớn hơn bề rộng khung ở 375px nên sẽ tràn ngang`
    );
  }
});

if (failed > 0) {
  console.log(`✗ Admin redesign UI foundation: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Admin redesign UI foundation: toàn bộ ca đạt.');
}
