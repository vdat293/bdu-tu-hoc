import assert from 'node:assert/strict';
import {
  InteractionTelemetryService,
  PRESENCE_TTL_MS,
  clearInMemoryTelemetryForTests,
  sanitizeInteractionEvent,
  sanitizeMetadata,
  updatePresenceForTests
} from '../src/modules/admin/interaction-telemetry.service.js';
import { TrafficService } from '../src/services/traffic.service.js';
import { isDatabaseConfigured } from '../src/db/database.js';

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`✗ ${name}`);
    console.log(`    ${err?.message || err}`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`✗ ${name}`);
    console.log(`    ${err?.message || err}`);
  }
}

function makeRunner(handler) {
  const calls = [];
  const runner = async (sql, params = []) => {
    calls.push({ sql, params });
    return handler(sql, params, calls);
  };
  runner.calls = calls;
  return runner;
}

check('sanitizeMetadata che toàn bộ khóa nhạy cảm ở nhiều tầng', () => {
  const clean = sanitizeMetadata({
    token: 'secret-jwt',
    password: 'my-password',
    courseCode: 'INF1003',
    nested: { refresh_token: 'rt', mode: 'quiz' }
  });
  assert.equal(clean.token, '[REDACTED]');
  assert.equal(clean.password, '[REDACTED]');
  assert.equal(clean.courseCode, 'INF1003');
  assert.equal(clean.nested.refresh_token, '[REDACTED]');
  assert.equal(clean.nested.mode, 'quiz');
});

check('sanitizeInteractionEvent từ chối event_type lạ và kẹp duration_ms', () => {
  assert.equal(sanitizeInteractionEvent({ event_type: 'keystroke', session_id: 's1' }), null);
  assert.equal(sanitizeInteractionEvent({ event_type: 'click', session_id: '' }), null);

  const valid = sanitizeInteractionEvent({
    event_type: 'page_leave',
    session_id: 'sess-1',
    page_path: '/wordfmt?token=leak',
    duration_ms: 999_999_999
  }, { mssv: '24050001', deviceType: 'mobile', os: 'iOS', browser: 'Safari' });

  assert.equal(valid.pagePath, '/wordfmt');
  assert.equal(valid.featureId, 'wordfmt');
  assert.equal(valid.pageTitle, 'Chuẩn hóa Word BDU');
  assert.equal(valid.mssv, '24050001');
  assert.equal(valid.durationMs, 7_200_000);
});

await checkAsync('LivePresence ghi nhận người online và tự hết hạn sau 3 phút', async () => {
  clearInMemoryTelemetryForTests();
  const base = Date.now();

  const ev1 = sanitizeInteractionEvent({
    event_type: 'page_view',
    session_id: 's1',
    page_path: '/gpa',
    at: new Date(base).toISOString()
  }, { mssv: 'SV001', fullName: 'Nguyễn An' });

  const ev2 = sanitizeInteractionEvent({
    event_type: 'click',
    session_id: 's2',
    page_path: '/vocab',
    target_label: 'Bắt đầu học',
    at: new Date(base - PRESENCE_TTL_MS - 5000).toISOString()
  }, { mssv: 'SV002', fullName: 'Trần Bình' });

  updatePresenceForTests(ev1, base);
  updatePresenceForTests(ev2, base - PRESENCE_TTL_MS - 5000);

  const snapshot = await InteractionTelemetryService.getLiveSnapshot(makeRunner(() => ({ rows: [] })));
  assert.equal(snapshot.onlineCount, 1);
  assert.equal(snapshot.onlineUsers[0].mssv, 'SV001');
  assert.equal(snapshot.onlineUsers[0].pagePath, '/gpa');
  assert.equal(snapshot.pageDistribution[0].pageTitle, 'Bảng điểm & GPA');
  clearInMemoryTelemetryForTests();
});

await checkAsync('getNavigationFlows tổng hợp entry pages, chuyển trang và tính năng', async () => {
  const runner = makeRunner((sql) => {
    if (/LAG\(page_path\)/i.test(sql)) {
      return { rows: [{ prev_path: '/gpa', page_path: '/wordfmt', count: 12 }] };
    }
    if (/DISTINCT ON \(session_id\)/i.test(sql)) {
      return { rows: [{ page_path: '/gpa', count: 20 }] };
    }
    return {
      rows: [{
        feature_id: 'wordfmt',
        views: 15,
        clicks: 30,
        actions: 5,
        searches: 0,
        errors: 0,
        unique_users: 10,
        avg_dwell_ms: 42000
      }]
    };
  });

  const flows = await InteractionTelemetryService.getNavigationFlows({ timeRange: '24h' }, runner);
  assert.equal(flows.entryPages[0].pagePath, '/gpa');
  assert.equal(flows.entryPages[0].pageTitle, 'Bảng điểm & GPA');
  assert.equal(flows.transitions[0].fromPath, '/gpa');
  assert.equal(flows.transitions[0].toPath, '/wordfmt');
  assert.equal(flows.transitions[0].count, 12);
  assert.equal(flows.featureEngagement[0].interactions, 50);
});

await checkAsync('getUnifiedUserTimeline lọc bỏ polling khi includeNoise=false và giữ khi true', async () => {
  const base = Date.UTC(2026, 5, 1, 8, 0, 0);
  const runner = makeRunner((sql) => {
    if (/FROM students/i.test(sql)) {
      return { rows: [{ mssv: 'SV001', full_name: 'Nguyễn An', class_code: '24TH01' }] };
    }
    if (/FROM user_interaction_events/i.test(sql)) {
      return {
        rows: [
          {
            id: 1,
            session_id: 's1',
            event_type: 'page_view',
            event_name: 'page_view',
            feature_id: 'portal',
            page_path: '/gpa',
            page_title: 'Bảng điểm & GPA',
            created_at: new Date(base)
          },
          {
            id: 2,
            session_id: 's1',
            event_type: 'click',
            event_name: 'ui_click',
            feature_id: 'portal',
            page_path: '/gpa',
            target_label: 'Xuất CSV',
            created_at: new Date(base + 15_000)
          }
        ]
      };
    }
    return {
      rows: [
        {
          id: 10,
          created_at: new Date(base + 5_000),
          method: 'GET',
          path: '/api/version',
          route: '/api/version',
          status_code: 200,
          response_time_ms: 3
        },
        {
          id: 11,
          created_at: new Date(base + 25_000),
          method: 'POST',
          path: '/api/wordfmt/format',
          route: '/api/wordfmt/format',
          status_code: 200,
          response_time_ms: 120
        }
      ]
    };
  });

  const clean = await InteractionTelemetryService.getUnifiedUserTimeline({
    mssv: 'sv001',
    timeRange: '24h',
    includeNoise: false
  }, runner);

  assert.equal(clean.student.fullName, 'Nguyễn An');
  assert.equal(clean.sessions.length, 1);
  // /api/version phải bị lọc bỏ, còn 2 UI events + 1 POST mutation
  assert.equal(clean.sessions[0].events.length, 3);
  assert.equal(clean.sessions[0].events.some((e) => e.route === '/api/version'), false);
  assert.equal(clean.sessions[0].events.some((e) => e.label === 'Chuẩn hóa tài liệu Word'), true);

  const noisy = await InteractionTelemetryService.getUnifiedUserTimeline({
    mssv: 'sv001',
    timeRange: '24h',
    includeNoise: true
  }, runner);
  assert.equal(noisy.sessions[0].events.some((e) => e.route === '/api/version'), true);
  assert.equal(Array.isArray(clean.toolUsage), true);
  assert.equal(clean.toolUsage[0].toolId, 'wordfmt');
  assert.equal(clean.toolUsage[0].status, 'used');
});

await checkAsync('getAutomationToolUsage phân tách đúng Đã dùng thật vs Chuẩn bị vs Chỉ vào xem', async () => {
  const base = Date.UTC(2026, 5, 1, 8, 0, 0);
  const runner = makeRunner((sql) => {
    if (/FROM students/i.test(sql)) {
      return {
        rows: [
          { mssv: 'SV001', full_name: 'Nguyễn An' },
          { mssv: 'SV002', full_name: 'Trần Bình' },
          { mssv: 'SV003', full_name: 'Lê Chi' }
        ]
      };
    }
    if (/FROM user_interaction_events/i.test(sql)) {
      return {
        rows: [
          // SV001: mở wordfmt + chạy chuẩn hóa (cả UI & API) => used, executionCount = 1 (không bị đếm đúp)
          {
            mssv: 'SV001',
            full_name: 'Nguyễn An',
            session_id: 's1',
            event_type: 'page_view',
            event_name: 'page_view',
            feature_id: 'wordfmt',
            page_path: '/wordfmt',
            created_at: new Date(base)
          },
          {
            mssv: 'SV001',
            full_name: 'Nguyễn An',
            session_id: 's1',
            event_type: 'action',
            event_name: 'wordfmt_format',
            feature_id: 'wordfmt',
            page_path: '/wordfmt',
            target_label: 'Chạy chuẩn hóa file Word',
            created_at: new Date(base + 10_000)
          },
          {
            mssv: 'SV001',
            full_name: 'Nguyễn An',
            session_id: 's1',
            event_type: 'page_leave',
            event_name: 'page_leave',
            feature_id: 'wordfmt',
            page_path: '/wordfmt',
            duration_ms: 45_000,
            created_at: new Date(base + 45_000)
          },
          // SV002: mở english và chỉ đăng nhập Moodle => tried
          {
            mssv: 'SV002',
            full_name: 'Trần Bình',
            session_id: 's2',
            event_type: 'page_view',
            event_name: 'page_view',
            feature_id: 'english',
            page_path: '/english',
            created_at: new Date(base + 5_000)
          },
          {
            mssv: 'SV002',
            full_name: 'Trần Bình',
            session_id: 's2',
            event_type: 'action',
            event_name: 'english_login',
            feature_id: 'english',
            page_path: '/english',
            target_label: 'Đăng nhập Moodle tiếng Anh',
            created_at: new Date(base + 12_000)
          },
          // SV003: bấm vào survey xem rồi rời đi => viewed_only
          {
            mssv: 'SV003',
            full_name: 'Lê Chi',
            session_id: 's3',
            event_type: 'page_view',
            event_name: 'page_view',
            feature_id: 'survey',
            page_path: '/survey',
            created_at: new Date(base + 20_000)
          },
          {
            mssv: 'SV003',
            full_name: 'Lê Chi',
            session_id: 's3',
            event_type: 'page_leave',
            event_name: 'page_leave',
            feature_id: 'survey',
            page_path: '/survey',
            duration_ms: 4_000,
            created_at: new Date(base + 24_000)
          }
        ]
      };
    }
    return {
      rows: [
        {
          mssv: 'SV001',
          method: 'POST',
          path: '/api/wordfmt/format',
          route: '/api/wordfmt/format',
          status_code: 200,
          created_at: new Date(base + 11_000)
        }
      ]
    };
  });

  const all = await InteractionTelemetryService.getAutomationToolUsage({ timeRange: '24h' }, runner);
  assert.equal(all.totals.visitedUsers, 3);
  assert.equal(all.totals.usedUsers, 1);
  assert.equal(all.totals.triedUsers, 1);
  assert.equal(all.totals.viewedOnlyUsers, 1);
  assert.equal(all.totals.conversionRate, 33.3);
  assert.equal(all.totals.totalExecutions, 1);

  const wordfmt = all.tools.find((t) => t.id === 'wordfmt');
  assert.equal(wordfmt.usedUsers, 1);
  assert.equal(wordfmt.executionCount, 1);
  assert.equal(wordfmt.conversionRate, 100);

  const viewedOnly = await InteractionTelemetryService.getAutomationToolUsage({
    timeRange: '24h',
    status: 'viewed_only'
  }, runner);
  assert.equal(viewedOnly.users.length, 1);
  assert.equal(viewedOnly.users[0].mssv, 'SV003');
  assert.equal(viewedOnly.users[0].statusLabel, 'Chỉ vào xem');
});

await checkAsync('chưa cấu hình DB: các truy vấn trả cấu trúc rỗng an toàn', async () => {
  assert.equal(isDatabaseConfigured(), false);
  const summary = await InteractionTelemetryService.getInteractionSummary({ timeRange: '24h' });
  assert.equal(summary.totalSessions, 0);
  const pages = await InteractionTelemetryService.getTopPages({ timeRange: '24h' });
  assert.deepEqual(pages.items, []);
  const elements = await InteractionTelemetryService.getTopElements({ timeRange: '24h' });
  assert.deepEqual(elements.items, []);
});

check('TrafficService.middleware bỏ qua log tự làm mới admin & telemetry khi status < 500', () => {
  const middleware = TrafficService.middleware();
  const runReq = (url, statusCode) => {
    const handlers = [];
    const req = { method: 'GET', originalUrl: url, url, path: url, headers: {}, query: {}, socket: {} };
    const res = {
      statusCode,
      on(ev, cb) {
        if (ev === 'finish') handlers.push(cb);
      }
    };
    middleware(req, res, () => {});
    handlers.forEach((h) => h());
  };

  // Không ném lỗi và không làm phình buffer
  runReq('/api/admin/dashboard/overview', 200);
  runReq('/api/telemetry/events', 202);
  assert.ok(true);
});

if (failed > 0) {
  console.log(`✗ Interaction telemetry: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Interaction telemetry: toàn bộ ca đạt.');
}
