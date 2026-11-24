import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminApp from '../../client/src/admin/AdminApp.jsx';

function okJson(data) {
  return new Response(JSON.stringify({ result: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function renderAdminApp() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 }
    }
  });
  return render(
    <QueryClientProvider client={client}>
      <AdminApp />
    </QueryClientProvider>
  );
}

function stubAdminFetch(overrides = {}) {
  const calls = [];
  const impl = vi.fn(async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body });
    const path = String(url).split('?')[0];

    if (overrides[path]) {
      return overrides[path](url, options);
    }

    if (path === '/api/admin/dashboard/live') {
      return okJson({
        onlineCount: 2,
        ttlSeconds: 180,
        onlineUsers: [
          {
            key: '24050001',
            mssv: '24050001',
            fullName: 'Nguyễn Văn A',
            pagePath: '/gpa',
            pageTitle: 'Bảng điểm & GPA',
            featureId: 'portal',
            featureLabel: 'Cổng sinh viên',
            lastEventType: 'click',
            lastActionLabel: 'Bấm "Xuất CSV"',
            deviceType: 'desktop',
            os: 'Windows',
            browser: 'Chrome',
            enteredPageAt: new Date(Date.now() - 35_000).toISOString(),
            lastSeenAt: new Date().toISOString()
          }
        ],
        pageDistribution: [{ pagePath: '/gpa', pageTitle: 'Bảng điểm & GPA', count: 2 }],
        recentFeed: [
          {
            id: 'ev-1',
            mssv: '24050001',
            fullName: 'Nguyễn Văn A',
            featureLabel: 'Cổng sinh viên',
            actionLabel: 'Bấm "Xuất CSV"',
            createdAt: new Date().toISOString()
          }
        ]
      });
    }

    if (path === '/api/admin/dashboard/interactions/summary') {
      return okJson({
        activeStudents: 12,
        activeVisitors: 15,
        totalSessions: 24,
        pageViews: 88,
        clicks: 140,
        actions: 18,
        searches: 4,
        avgDwellMs: 42000,
        avgSessionDurationMs: 180000,
        pagesPerSession: 3.6,
        growth: { studentsPct: 12.5, sessionsPct: 8.0, interactionsPct: 15.0 },
        timeline: []
      });
    }

    if (path === '/api/admin/dashboard/overview') {
      return okJson({
        totalRequests: 320,
        uniqueMssv: 12,
        uniqueUsers: 15,
        avgResponseTime: 48,
        errorRate: 0.6,
        statusBreakdown: { '2xx': 315, '4xx': 5, '5xx': 0 }
      });
    }

    if (path === '/api/admin/dashboard/interactions/flows') {
      return okJson({
        entryPages: [{ pagePath: '/gpa', pageTitle: 'Bảng điểm & GPA', count: 14, share: 0.6 }],
        transitions: [{ fromPath: '/gpa', fromTitle: 'Bảng điểm & GPA', toPath: '/wordfmt', toTitle: 'Chuẩn hóa Word BDU', count: 9, share: 0.45 }],
        featureEngagement: [{ featureId: 'portal', featureLabel: 'Cổng sinh viên', interactions: 120, uniqueUsers: 12, share: 0.5 }]
      });
    }

    if (path === '/api/admin/dashboard/interactions/elements') {
      return okJson({
        totalCount: 140,
        items: [{ eventType: 'click', eventName: 'ui_click', label: 'Xuất CSV', pagePath: '/gpa', pageTitle: 'Bảng điểm & GPA', count: 42, uniqueUsers: 11, share: 0.3 }]
      });
    }

    if (path === '/api/admin/dashboard/interactions/pages') {
      return okJson({
        items: [{ pagePath: '/gpa', pageTitle: 'Bảng điểm & GPA', featureId: 'portal', featureLabel: 'Cổng sinh viên', views: 55, uniqueUsers: 12, avgDurationMs: 42000, clicks: 40, actions: 5 }]
      });
    }

    if (path === '/api/admin/dashboard/interactions/stream') {
      return okJson({ items: [], pagination: { page: 1, totalPages: 1, total: 0 } });
    }

    if (path === '/api/admin/dashboard/interactions/tools') {
      return okJson({
        timeRange: '24h',
        totals: { visitedUsers: 10, usedUsers: 4, triedUsers: 2, viewedOnlyUsers: 4, conversionRate: 40, totalExecutions: 7 },
        tools: [
          {
            id: 'wordfmt',
            label: 'Chuẩn hóa Word BDU',
            pagePath: '/wordfmt',
            usedDesc: 'Chạy chuẩn hóa hoặc tải file .docx',
            visitedUsers: 6,
            usedUsers: 4,
            triedUsers: 1,
            viewedOnlyUsers: 1,
            conversionRate: 66.7,
            executionCount: 7,
            viewCount: 9,
            avgDwellMs: 52000
          },
          {
            id: 'survey',
            label: 'Auto đánh giá khảo sát',
            pagePath: '/survey',
            usedDesc: 'Bấm chạy auto khảo sát',
            visitedUsers: 4,
            usedUsers: 0,
            triedUsers: 0,
            viewedOnlyUsers: 4,
            conversionRate: 0,
            executionCount: 0,
            viewCount: 4,
            avgDwellMs: 8000
          }
        ],
        users: [
          {
            userKey: '24050001',
            mssv: '24050001',
            fullName: 'Nguyễn Văn A',
            toolId: 'wordfmt',
            toolLabel: 'Chuẩn hóa Word BDU',
            pagePath: '/wordfmt',
            status: 'used',
            statusLabel: 'Đã sử dụng thật',
            executionCount: 2,
            triedCount: 1,
            viewCount: 2,
            totalDwellMs: 52000,
            lastActionLabel: 'Chạy chuẩn hóa file Word',
            lastSeenAt: new Date().toISOString()
          },
          {
            userKey: '24050002',
            mssv: '24050002',
            fullName: 'Trần Thị B',
            toolId: 'survey',
            toolLabel: 'Auto đánh giá khảo sát',
            pagePath: '/survey',
            status: 'viewed_only',
            statusLabel: 'Chỉ vào xem',
            executionCount: 0,
            triedCount: 0,
            viewCount: 1,
            totalDwellMs: 6000,
            lastActionLabel: 'Mở trang Auto đánh giá khảo sát',
            lastSeenAt: new Date().toISOString()
          }
        ]
      });
    }

    if (path === '/api/admin/dashboard/insights/features') {
      return okJson({ totalRequests: 100, items: [], other: { requests: 0, users: 0, share: 0 } });
    }

    if (path === '/api/admin/dashboard/insights/quality') {
      return okJson({ overall: { requests: 320, errorRate: 0.006, avgMs: 48, p95Ms: 120 }, items: [] });
    }

    if (path === '/api/admin/dashboard/interactions/users/24050001/timeline') {
      return okJson({
        mssv: '24050001',
        student: { mssv: '24050001', fullName: 'Nguyễn Văn A', classCode: '24TH01' },
        summary: { totalSessions: 1, pageViews: 2, clicks: 1, actions: 0, errors: 0, totalDwellMs: 42000 },
        sessions: [{
          startAt: '2026-10-15T08:00:00Z',
          endAt: '2026-10-15T08:05:00Z',
          durationMs: 300000,
          eventCount: 2,
          errorCount: 0,
          features: [{ id: 'portal', label: 'Cổng sinh viên' }],
          events: [
            { id: 'ui-1', source: 'ui', at: '2026-10-15T08:00:00Z', eventType: 'page_view', label: 'Mở trang Bảng điểm & GPA', featureLabel: 'Cổng sinh viên', pagePath: '/gpa', isError: false },
            { id: 'ui-2', source: 'ui', at: '2026-10-15T08:01:00Z', eventType: 'click', label: 'Bấm "Xuất CSV"', featureLabel: 'Cổng sinh viên', pagePath: '/gpa', isError: false }
          ]
        }],
        transitions: [{ from: '/gpa', fromTitle: 'Bảng điểm & GPA', to: '/wordfmt', toTitle: 'Chuẩn hóa Word BDU', count: 1 }],
        truncated: false
      });
    }

    if (path === '/api/admin/dashboard/system') {
      return okJson({
        server: { uptimeSeconds: 3600, nodeVersion: 'v22.0.0', platform: 'linux' },
        memory: { rssMb: 120, heapUsedMb: 55, heapTotalMb: 90 },
        realtime: { connected_clients: 4, active_rooms: 2 },
        database: { totalLogs: 500 },
        telemetry: { queueSize: 2, onlineCount: 1 },
        bufferQueueSize: 0
      });
    }

    if (path === '/api/admin/dashboard/ranking-sync') {
      return okJson({ enabled: true, env_enabled: true, effective_enabled: true, sync_hour: 3, next_run_at: null, latest_run: null });
    }

    if (path === '/api/admin/dashboard/service-lock') {
      return okJson({
        catalog: [{ id: 'wordfmt', label: 'Word Formatting' }],
        groups: { wordfmt: { locked: false, title: '', message: '' } },
        updated_at: null,
        updated_by: null
      });
    }

    if (path === '/api/admin/dashboard/vps') {
      return okJson({
        source: 'host-agent',
        collectedAt: new Date().toISOString(),
        snapshotAgeSeconds: 3,
        isStale: false,
        host: { hostname: 'bdu-prod', os: 'Ubuntu 24.04 LTS', kernel: '6.8.0-31-generic', arch: 'x86_64', uptimeSeconds: 86400 },
        cpu: { model: 'Intel Xeon Gold 6133', cores: 2, usagePct: 12.5, loadAvg: [0.12, 0.25, 0.3] },
        memory: { totalMb: 3868, usedMb: 1368, freeMb: 1133, availableMb: 2500, buffersMb: 128, cachedMb: 1669, usedPct: 35.4, swapTotalMb: 1922, swapUsedMb: 48, swapFreeMb: 1874, swapPct: 2.5 },
        disk: {
          root: { filesystem: '/dev/mapper/ubuntu--lv', mount: '/', totalGb: 33, usedGb: 25, availGb: 6.5, usedPct: 80 },
          dataDirs: [{ name: 'backups', sizeMb: 120 }]
        },
        nodeRuntime: {
          pid: 123,
          nodeVersion: 'v22.12.0',
          platform: 'linux',
          rssMb: 98.8,
          heapUsedMb: 55.2,
          heapTotalMb: 80,
          heapLimitMb: 2048,
          heapUsedPctOfLimit: 2.7,
          heapSpaces: [{ name: 'old_space', usedMb: 40, sizeMb: 55 }],
          eventLoopLagMs: 0.4,
          realtime: { connected_clients: 4, active_rooms: 2 },
          queues: { trafficQueueSize: 3, telemetryQueueSize: 5, onlineCount: 2 }
        },
        database: {
          databaseName: 'bdu_hub',
          sizeMb: 480,
          cacheHitRatioPct: 99.5,
          connections: { total: 8, active: 2, idle: 6 },
          topTables: [{ tableName: 'traffic_logs', totalMb: 120, liveRows: 45000, deadRows: 10 }]
        },
        docker: {
          containers: [
            { name: 'bdu-tu-hoc-app', image: 'bdu-tu-hoc-bdu-hub', state: 'running', status: 'Up 2h (healthy)', health: 'healthy', cpuPct: 0.2, memUsedMb: 98.8, memPct: 2.55, netIO: '8MB / 13MB', blockIO: '28MB / 2MB', pids: 23 }
          ],
          storage: [{ type: 'Build Cache', total: 90, active: 0, size: '11.29GB', reclaimable: '3.2GB' }]
        },
        services: { caddy: 'active', docker: 'active', fail2ban: 'active', certDaysRemaining: 90 },
        topProcesses: [{ pid: 9555, command: 'dockerd', memPct: 2.8, cpuPct: 0.3, rssMb: 110 }],
        network: { interface: 'eth0', rxTotalMb: 500, txTotalMb: 700, rxKbps: 12.4, txKbps: 28.1 },
        history: [{ at: new Date().toISOString(), cpuPct: 12.5, ramUsedPct: 35.4, ramUsedMb: 1368, swapUsedMb: 48, load1: 0.12 }],
        alerts: [{ id: 'disk-warning', severity: 'warning', title: 'Ổ đĩa đạt 80% (25/33 GB)', message: 'Còn trống 6.5 GB.' }],
        quickCommands: [{ id: 'disk-df', label: 'Kiểm tra dung lượng đĩa', description: 'Xem SSD', command: 'df -h /' }]
      });
    }

    if (path === '/api/admin/dashboard/vps/flush-buffers') {
      return okJson({ before: { trafficQueueSize: 3, telemetryQueueSize: 5 }, after: { trafficQueueSize: 0, telemetryQueueSize: 0 } });
    }

    return okJson({});
  });

  vi.stubGlobal('fetch', impl);
  return { calls, impl };
}

describe('AdminApp React Dashboard', () => {
  beforeEach(() => {
    window.sessionStorage.setItem('bdu_admin_key', 'test-admin-key');
    window.sessionStorage.setItem('bdu_admin_label', 'Admin Test');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens AuthGate when credentials are missing and unlocks after login', async () => {
    window.sessionStorage.clear();
    stubAdminFetch({
      '/api/admin/dashboard/login': async () => new Response(JSON.stringify({
        result: true,
        adminKey: 'secret-key',
        name: 'Quản trị viên Test'
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    });

    renderAdminApp();
    expect(screen.getByRole('dialog', { name: /Xác Thực Quản Trị Viên/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Mã khóa admin/i), { target: { value: 'secret-key' } });
    fireEvent.click(screen.getByRole('button', { name: /Đăng Nhập Quản Trị/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Xác Thực Quản Trị Viên/i })).not.toBeInTheDocument();
    });
    expect(screen.getByText('Quản trị viên Test')).toBeInTheDocument();
  });

  it('renders Overview live pulse, KPIs, and only fetches active tab endpoints', async () => {
    const { calls } = stubAdminFetch();
    renderAdminApp();

    await waitFor(() => {
      expect(screen.getByText(/2 người dùng đang hoạt động/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Bấm "Xuất CSV"/)).toBeInTheDocument();
    expect(screen.getByText(/“Xuất CSV”/)).toBeInTheDocument();

    // Must not eagerly fetch ODP/TTCDS/Logs on Overview tab!
    const urls = calls.map((c) => c.url);
    expect(urls.some((u) => u.includes('/odp-sync'))).toBe(false);
    expect(urls.some((u) => u.includes('/ttcds/permissions'))).toBe(false);
    expect(urls.some((u) => u.includes('/admin/dashboard/logs'))).toBe(false);
  });

  it('opens StudentJourneyDrawer when clicking a student and toggles technical API noise', async () => {
    const { calls } = stubAdminFetch();
    renderAdminApp();

    const studentBtn = await screen.findByRole('button', { name: /Nguyễn Văn A/i });
    fireEvent.click(studentBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(/Mở trang Bảng điểm & GPA/i)).toBeInTheDocument();
    });

    const toggle = screen.getByLabelText(/Hiện thêm API kỹ thuật/i);
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('includeNoise=true'))).toBe(true);
    });

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('asks confirm ONLY when locking a service group and preserves catalog on PUT', async () => {
    const confirmMock = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { calls } = stubAdminFetch({
      '/api/admin/dashboard/service-lock': async (_url, opts) => {
        if (opts.method === 'PUT') {
          return okJson({
            groups: { wordfmt: { locked: true, title: 'Bảo trì', message: '' } },
            updated_at: new Date().toISOString(),
            updated_by: 'ADMIN_KEY'
          });
        }
        return okJson({
          catalog: [{ id: 'wordfmt', label: 'Word Formatting' }],
          groups: { wordfmt: { locked: false, title: '', message: '' } }
        });
      }
    });

    renderAdminApp();
    fireEvent.click(screen.getByRole('button', { name: /Hệ Thống & Vận Hành/i }));

    const toggle = await screen.findByLabelText(/Bật tắt khóa nhóm Word Formatting/i);
    fireEvent.click(toggle);

    expect(confirmMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('/service-lock') && c.method === 'PUT')).toBe(true);
    });
    expect(screen.getByText('Word Formatting')).toBeInTheDocument();
  });

  it('switches to Công Cụ Tự Động tab and distinguishes Đã sử dụng thật vs Chỉ vào xem', async () => {
    stubAdminFetch();
    renderAdminApp();

    fireEvent.click(screen.getByRole('button', { name: /Công Cụ Tự Động/i }));

    await waitFor(() => {
      expect(screen.getByText(/Mức Độ Sử Dụng Từng Công Cụ Tự Động/i)).toBeInTheDocument();
      expect(screen.getByText('Trần Thị B')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Đã sử dụng thật').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Chỉ vào xem').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Chạy chuẩn hóa file Word/i)).toBeInTheDocument();
  });

  it('switches to VPS & Tài Nguyên tab, displays RAM/Disk/Docker metrics and flushes RAM buffers', async () => {
    const { calls } = stubAdminFetch();
    renderAdminApp();

    fireEvent.click(screen.getByRole('button', { name: /VPS & Tài Nguyên/i }));

    await waitFor(() => {
      expect(screen.getByText(/Host Agent VPS/i)).toBeInTheDocument();
      expect(screen.getByText('bdu-tu-hoc-app')).toBeInTheDocument();
    });
    expect(screen.getByText(/Ổ đĩa đạt 80%/i)).toBeInTheDocument();
    expect(screen.getByText('traffic_logs')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Xả Buffer RAM/i }));
    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('/vps/flush-buffers') && c.method === 'POST')).toBe(true);
    });
  });
});
