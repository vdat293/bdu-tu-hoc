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
const routeGuard = fs.readFileSync(new URL('../scripts/verify-route-order.mjs', import.meta.url), 'utf8');

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

check('endpoint LEGACY lỗi không kẹt 5 khối Insights ở skeleton "Đang tải…"', () => {
  // `Promise.all` all-or-nothing: một endpoint cũ (overview/logs/visited-students/
  // system) chết là không tới renderInsights(), mà skeleton chỉ dựng một lần ở
  // init ⇒ 5 khối đứng im "Đang tải…" vĩnh viễn. Nhánh catch phải tự vẽ lại:
  // khối có dữ liệu thì vẽ, khối không thì ra trạng thái lỗi kèm nút Thử lại.
  const start = adminJs.indexOf('async function fetchAllData(');
  const catchStart = adminJs.indexOf('} catch (err) {', start);
  assert.ok(catchStart !== -1, 'fetchAllData phải có nhánh catch');
  const next = adminJs.indexOf('\nfunction ', catchStart);
  const branch = adminJs.slice(catchStart, next === -1 ? adminJs.length : next);
  assert.match(branch, /renderInsights\(\)/, 'nhánh catch của fetchAllData phải gọi renderInsights()');
  assert.match(branch, /renderDevices\(null\)/, 'khối Thiết bị cũng phải thoát skeleton (null ≠ dữ liệu rỗng)');
  // Vẽ trạng thái lỗi chỉ khi không phải nền tự làm mới: refresh nền lỗi thì giữ
  // dữ liệu đang có, không xoá sạch rồi báo lỗi.
  const guardIdx = branch.indexOf('if (!isBackground) {');
  assert.ok(guardIdx !== -1, 'nhánh catch phải giữ điều kiện if (!isBackground) như hai renderError kia');
  const guarded = branch.slice(guardIdx);
  const insightsIdx = guarded.indexOf('renderInsights()');
  assert.ok(insightsIdx !== -1, 'renderInsights() phải nằm sau if (!isBackground)');
  assert.match(
    // Bỏ chú thích trước khi so phủ định: sau khối catch còn chú thích của hàm kế tiếp.
    guarded.slice(guarded.indexOf('}', insightsIdx)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
    /^[\s}]*$/,
    'sau khối if (!isBackground) không được vẽ thêm gì (refresh nền lỗi thì giữ dữ liệu đang có)'
  );
});

check('heatmap và cohort nói rõ khi mốc bị thu về 30 ngày', () => {
  // Backend thu `all` về 30 ngày cho đúng 2 khối này rồi trả `requestedTimeRange`
  // để client biết mốc đã chọn là gì. Không nói ra thì số trên màn hình bị đọc
  // là phủ toàn bộ lịch sử.
  for (const fnName of ['renderHoursHeatmap', 'renderCohort']) {
    assert.match(
      sliceFunction(fnName),
      /cappedRangeText\(/,
      `${fnName} phải gọi cappedRangeText() để báo khi khối bị thu về 30 ngày`
    );
  }
  const helper = sliceFunction('cappedRangeText');
  assert.match(helper, /requestedTimeRange/, 'helper phải đọc requestedTimeRange của endpoint');
  assert.match(helper, /state\.timeRange/, 'thiếu requestedTimeRange thì fallback về mốc đang chọn');
  assert.match(helper, /30 ngày/, 'chú thích phải nói rõ bị thu về 30 ngày');
});

check('series cohort không gọi tắt "Mới" (đếm theo ngày, không phải người mới)', () => {
  // SQL đếm `new` theo NGÀY: một người lần đầu vào hệ thống ngày 5 vẫn được đếm
  // ở mọi ngày họ hoạt động sau đó. Gọi series đó là "Mới" khiến người đọc tưởng
  // mỗi ngày có một lớp người mới thật sự mới.
  const cohort = sliceFunction('renderCohort');
  assert.match(cohort, /label: 'Hoạt động lần đầu trong kỳ'/, 'series per-day phải nói đúng nghĩa số');
  assert.doesNotMatch(cohort, /label: 'Mới'/, 'không được để series per-day mang nhãn "Mới"');
  assert.match(
    cohort,
    /tính lại ở từng ngày/,
    'phải giải thích vì sao series per-day khác số "Mới" ở dải số (số người khác nhau cả kỳ)'
  );
});

check('guard thứ tự route chạy được khi trần, không cần env', () => {
  // Guard này sinh ra để canh chính 5 route insights trong
  // ROUTES_ADDED_AFTER_SPLIT. Nó đọc ENGLISH_ANSWERS_PATH mà không set mặc định
  // thì thiếu env là exit 2 — chết cam đúng lúc cần canh.
  assert.match(
    routeGuard,
    /ENGLISH_ANSWERS_PATH\s*\?\?=/,
    'verify-route-order.mjs phải đặt mặc định cho ENGLISH_ANSWERS_PATH (??=)'
  );
  assert.ok(
    routeGuard.search(/ENGLISH_ANSWERS_PATH\s*\?\?=/) < routeGuard.indexOf('await import('),
    'mặc định phải đặt TRƯỚC vòng import bản gốc'
  );
  assert.match(routeGuard, /from 'node:os'/, 'phải import node:os để dựng đường dẫn mặc định');
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

/* --------------------------------------------------------------------------
   Task 10 — modal Hành trình.
   Ba hợp đồng dễ vỡ nhất của modal này:
     1. markup phải có #modal-journey + #journey-timeline + #journey-transitions
        nằm TRONG modal (thiếu thẻ thì hàm render có chỗ để đổ dữ liệu vào đâu?),
     2. openJourney gọi đúng endpoint insights/users/:mssv/journey và encode MSSV
        — gọi nhầm đường dẫn là mở modal xong không có gì để hiện,
     3. phải tôn trọng cờ `truncated` và nói rõ đã cắt ở mốc nào, tránh người đọc
        tưởng hành trình đầy đủ trong khi server chỉ trả 200 sự kiện gần nhất.
   Rủi ro biên đã nêu ở Review Focus #4: sinh viên không tồn tại (student null),
   không có sự kiện nào (events rỗng) — cả hai phải hiện empty state êm, không
   để khối trống câm.
   -------------------------------------------------------------------------- */

/** Cắt nguyên khối hành trình: từ openJourney() tới openStudentActivity(). */
function sliceJourneySection() {
  const start = adminJs.indexOf('function openJourney(');
  assert.ok(start !== -1, 'admin.js thiếu hàm openJourney()');
  const end = adminJs.indexOf('async function openStudentActivity(', start);
  assert.ok(end !== -1, 'Không tìm thấy mốc cuối khối hành trình trong admin.js');
  return adminJs.slice(start, end);
}

check('markup modal Hành trình có #modal-journey, #journey-timeline, #journey-transitions', () => {
  assert.ok(indexHtml.includes('id="modal-journey"'), 'index.html thiếu modal #modal-journey');
  for (const id of ['journey-timeline', 'journey-transitions']) {
    assert.ok(indexHtml.includes(`id="${id}"`), `index.html thiếu khối #${id}`);
  }
  // Hai khối phải nằm TRONG modal, không phải rơi lại ở tab nào đó: renderJourney()
  // đổ dữ liệu vào chúng và người dùng chỉ thấy được khi modal mở.
  const modalStart = indexHtml.indexOf('id="modal-journey"');
  const modalEnd = indexHtml.indexOf('admin-toast-container', modalStart);
  assert.ok(modalEnd !== -1, 'Không tìm thấy mốc cuối sau modal Hành trình');
  const modal = indexHtml.slice(modalStart, modalEnd);
  for (const id of ['journey-timeline', 'journey-transitions']) {
    assert.ok(modal.includes(`id="${id}"`), `#${id} phải nằm trong modal Hành trình`);
  }
  // Nút đóng là bắt buộc: modal không có lối thoát thì người dùng mắc kẹt.
  assert.ok(indexHtml.includes('id="btn-close-journey"'), 'index.html thiếu nút #btn-close-journey');
});

check('admin.js có gọi endpoint insights/users/:mssv/journey', () => {
  assert.ok(adminJs.includes('insights/users/'), 'admin.js chưa gọi endpoint insights/users/');
  assert.ok(adminJs.includes('journey'), 'admin.js chưa có phần hành trình');
  const journey = sliceJourneySection();
  assert.match(journey, /insights\/users\//, 'openJourney() phải gọi endpoint insights/users/');
  // MSSV là dữ liệu người dùng nhập từ bảng, có thể chứa ký tự lạ; encode trước
  // khi ghép vào đường dẫn để không làm hỏng URL (và không tự dựng HTML).
  assert.match(journey, /encodeURIComponent\(/, 'openJourney() phải encodeURIComponent(mssv)');
});

check('modal Hành trình tôn trọng cờ truncated', () => {
  const journey = sliceJourneySection();
  assert.match(journey, /truncated/, 'admin.js phải đọc cờ truncated của endpoint');
  // HƯỚNG của câu nhắc phải khớp đúng SQL của endpoint:
  // `ORDER BY created_at ASC LIMIT $2` ⇒ 200 dòng trả về là 200 sự kiện CŨ NHẤT,
  // phần thiếu là đuôi MỚI HƠN. Ghi ngược thì người đọc tưởng vừa xem phần cuối
  // hành trình và kết luận sai về người dùng.
  assert.match(
    journey,
    /cũ nhất/,
    'Nhắc khi truncated phải nói rõ danh sách là các sự kiện cũ nhất'
  );
  assert.match(journey, /đầu tiên/, 'Nhắc phải nêu lấy N sự kiện đầu tiên trong khung thời gian');
  // Bỏ comment trước khi so phủ định: chính chú thích giải thích trong admin.js
  // cũng trích nguyên câu sai để giải thích, không phải vì đang vi sai.
  const journeyCode = journey.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(
    journeyCode,
    /sự kiện gần nhất/,
    'Không được nói ngược thành "sự kiện gần nhất": backend đã cắt phần MỚI HƠN'
  );
});

check('chip tính năng của phiên hiện nhãn tiếng Việt, không phải featureId', () => {
  const journey = sliceJourneySection();
  // `sessions[].features` là featureId (vocab, other...); dòng sự kiện hiện
  // featureLabel tiếng Việt. Nếu chip in thẳng id thì cùng một tính năng hiện hai
  // kiểu viết khác nhau trong cùng một khối.
  assert.match(journey, /labels\.get\(id\)\s*\|\|\s*id/, 'Chip tính năng phải map featureId sang featureLabel');
  assert.match(journey, /event\.featureLabel/, 'Phải lấy nhãn từ featureLabel của sự kiện trong phiên');
});

check('journeyClock không in giờ giả cho sự kiện thiếu mốc thời gian', () => {
  const journey = sliceJourneySection();
  // `new Date(null)` là epoch (01/01/1970) nên sẽ in ra một giờ TRÔNG HỢP LỆ
  // (08:00 giờ VN) thay vì "--"; phải chặn null trước khi new Date.
  const clockFn = journey.slice(journey.indexOf('function journeyClock('));
  assert.match(
    clockFn.slice(0, clockFn.indexOf('}')),
    /if\s*\(\s*!value\s*\)\s*return\s*'--'/,
    'journeyClock() phải trả "--" khi value rỗng/null trước khi new Date(value)'
  );
});

check('hành trình render theo phiên, đánh dấu lỗi và hiện nhãn tính năng', () => {
  const journey = sliceJourneySection();
  // Gom theo `sessions` là điểm cốt lõi: mốc 30 phút do backend quyết định, tự
  // chia lại ở client sẽ lệch với số liệu "số phiên" mà endpoint trả về.
  assert.match(journey, /sessions/, 'Hành trình phải nhóm sự kiện theo sessions');
  assert.match(journey, /isError/, 'Phải đánh dấu sự kiện lỗi');
  assert.match(journey, /featureLabel/, 'Mỗi sự kiện phải hiện featureLabel');
});

check('hành trình escape dữ liệu và xử lý student null / events rỗng', () => {
  const journey = sliceJourneySection();
  assert.match(journey, /escapeHtml\(/, 'Mọi dữ liệu chèn DOM ở hành trình phải qua escapeHtml');
  // student: null (tài khoản đã xoá, log còn) và events: [] đều phải ra empty
  // state có lời giải thích, không phải khối trống.
  assert.match(journey, /data\.student/, 'renderJourney() phải đọc student (kể cả khi null)');
  assert.match(journey, /renderEmpty\(/, 'Hành trình phải có trạng thái rỗng qua renderEmpty');
});

check('lớp CSS tuỳ chọn trong hành trình luôn có giá trị thay thế', () => {
  // Đã từng sinh ra class "journey-stat-valueundefined": ô tóm tắt không khai
  // `tone` nối thẳng vào class attribute, làm mất style của chính ô đó. Test
  // tĩnh không render nên phải ghim thẳng quy tắc fallback.
  const journey = sliceJourneySection();
  assert.match(
    journey,
    /class="journey-stat-value\$\{[^}]+\|\|\s*''\}"/,
    'Lớp tuỳ chọn phải có fallback (ví dụ ${stat.tone || \'\'}), không nối thẳng giá trị có thể undefined'
  );
});

if (failed > 0) {
  console.log(`✗ Admin insights UI: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Admin insights UI: toàn bộ ca đạt.');
}
