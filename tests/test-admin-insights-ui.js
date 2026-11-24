/**
 * Test giao diện phân tích hành vi & hành trình người dùng trong Admin React mới.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overviewJsx = fs.readFileSync(path.join(ROOT, 'client/src/admin/pages/OverviewPage.jsx'), 'utf8');
const liveJsx = fs.readFileSync(path.join(ROOT, 'client/src/admin/pages/LiveInteractionsPage.jsx'), 'utf8');
const toolsJsx = fs.readFileSync(path.join(ROOT, 'client/src/admin/pages/AutomationToolsPage.jsx'), 'utf8');
const vpsJsx = fs.readFileSync(path.join(ROOT, 'client/src/admin/pages/VpsMonitorPage.jsx'), 'utf8');
const flowsJsx = fs.readFileSync(path.join(ROOT, 'client/src/admin/pages/FlowsInsightsPage.jsx'), 'utf8');
const logsJsx = fs.readFileSync(path.join(ROOT, 'client/src/admin/pages/LogsQualityPage.jsx'), 'utf8');
const drawerJsx = fs.readFileSync(path.join(ROOT, 'client/src/admin/components/StudentJourneyDrawer.jsx'), 'utf8');
const adminApiJs = fs.readFileSync(path.join(ROOT, 'client/src/admin/api/adminApi.js'), 'utf8');
const adminCss = fs.readFileSync(path.join(ROOT, 'client/src/admin/styles/admin.css'), 'utf8');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`✗ ${name}`);
    console.log(`    ${error?.message || error}`);
  }
}

check('Admin API gọi đủ các endpoint telemetry trực tiếp và insights', () => {
  for (const endpoint of [
    '/api/admin/dashboard/live',
    '/api/admin/dashboard/interactions/summary',
    '/api/admin/dashboard/interactions/pages',
    '/api/admin/dashboard/interactions/elements',
    '/api/admin/dashboard/interactions/flows',
    '/api/admin/dashboard/interactions/stream',
    '/api/admin/dashboard/interactions/tools',
    '/api/admin/dashboard/vps',
    '/api/admin/dashboard/vps/flush-buffers',
    '/api/admin/dashboard/insights/features',
    '/api/admin/dashboard/insights/hours',
    '/api/admin/dashboard/insights/cohort',
    '/api/admin/dashboard/insights/quality'
  ]) {
    assert.ok(adminApiJs.includes(endpoint), `adminApi.js thiếu endpoint ${endpoint}`);
  }
});

check('Overview và LiveInteractions hiển thị trực quan người online, trang và nút bấm', () => {
  assert.match(overviewJsx, /live-pulse-banner/, 'Overview thiếu thanh Live Pulse');
  assert.match(overviewJsx, /Dùng Thật vs Chỉ Vào Xem/, 'Overview thiếu khối Bộ Công Cụ Tự Động');
  assert.match(liveJsx, /Ai Đang Online Trên Website/, 'LiveInteractions thiếu khối Online');
  assert.match(liveJsx, /Người Dùng Bấm Gì Nhiều Nhất/, 'LiveInteractions thiếu khối Top nút bấm');
  assert.match(toolsJsx, /Đã sử dụng thật/, 'AutomationToolsPage thiếu nhãn Đã sử dụng thật');
  assert.match(toolsJsx, /Chỉ bấm vào xem/, 'AutomationToolsPage thiếu nhãn Chỉ bấm vào xem');
  assert.match(vpsJsx, /RAM Máy Chủ/, 'VpsMonitorPage thiếu chỉ số RAM Máy Chủ');
  assert.match(vpsJsx, /Docker Containers/, 'VpsMonitorPage thiếu bảng Docker Containers');
});

check('FlowsInsights giữ heatmap 7x24 có bảng số dự phòng và chú thích 30 ngày', () => {
  assert.match(flowsJsx, /hours-heatmap-table/, 'FlowsInsights thiếu bảng số dự phòng');
  assert.match(flowsJsx, /cappedRangeText\(/, 'FlowsInsights phải dùng cappedRangeText khi all bị thu về 30d');
  assert.match(flowsJsx, /label:\s*'Hoạt động lần đầu trong kỳ'/, 'Cohort phải giữ nhãn chính xác');
  assert.match(adminCss, /\.heatmap-grid\s*\{[^}]*repeat\(24/, 'CSS thiếu lưới heatmap 24 cột');
  for (let lv = 0; lv <= 5; lv += 1) {
    assert.ok(adminCss.includes(`.heatmap-lv${lv}`), `CSS thiếu .heatmap-lv${lv}`);
  }
});

check('LogsQuality giữ bảng độ trễ p95 và tính năng ẩn nhiễu polling', () => {
  assert.match(logsJsx, /p95/, 'LogsQuality thiếu độ trễ p95');
  assert.match(logsJsx, /hideNoise/, 'LogsQuality thiếu bộ lọc ẩn polling nền');
});

check('StudentJourneyDrawer hỗ trợ timeline hợp nhất, lọc nhiễu và cờ truncated', () => {
  assert.match(drawerJsx, /getUserUnifiedTimeline/, 'Drawer phải gọi endpoint timeline hợp nhất');
  assert.match(drawerJsx, /includeNoise/, 'Drawer phải có công tắc hiện/ẩn API kỹ thuật');
  assert.match(drawerJsx, /truncated/, 'Drawer phải tôn trọng cờ truncated');
  assert.match(drawerJsx, /cũ nhất/, 'Thông báo truncated phải nói rõ dữ liệu cũ nhất');
});

if (failed > 0) {
  console.log(`✗ Admin insights UI: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Admin insights UI: toàn bộ ca đạt.');
}
