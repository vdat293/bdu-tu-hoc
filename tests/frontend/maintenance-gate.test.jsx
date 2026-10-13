import { act, cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MaintenanceGate from '../../client/src/app/MaintenanceGate.jsx';

// Đường dẫn tuyệt đối tới mã nguồn client, suy ra từ vị trí file test.
const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/src');

function readClientFile(relativePath) {
  return readFileSync(path.join(CLIENT_DIR, relativePath), 'utf8');
}

// Tầng transport của component dùng fetch thật (đi qua request() của api/http.js),
// nên stub phải trả về một object giống Response: parseResponse chỉ đọc
// headers.get('content-type') và gọi json().
function okResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function jsonResponse(body, options) {
  return Promise.resolve(okResponse(body, options));
}

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.stubGlobal('fetch', mocks.fetch);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.fetch.mockReset();
});

// Server (ServiceLockService.getStatus) luôn chuẩn hoá đủ nhóm, mỗi nhóm một
// entry `{ locked, title, message }`; thiếu nhóm nghĩa là nhóm đó đang mở.
function entryOf(overrides = {}) {
  return { locked: false, title: '', message: '', ...overrides };
}

function statusOf(groups) {
  return jsonResponse({ result: true, data: { groups } });
}

// Gate cần biết trang đang mở thuộc nhóm nào nên test phải có router thật
// (MemoryRouter) thay vì mock useLocation: đường dẫn -> nhóm là hợp đồng
// giữa client và server, test nên đi qua đúng đường đó.
function renderGate(path = '/vocab') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MaintenanceGate><div>NỘI DUNG ỨNG DỤNG</div></MaintenanceGate>
    </MemoryRouter>
  );
}

function dispatchMaintenance(detail) {
  act(() => {
    window.dispatchEvent(new CustomEvent('bdu:maintenance', { detail }));
  });
}

describe('MaintenanceGate theo nhóm', () => {
  it('hiện màn hình bảo trì khi trang đang mở thuộc nhóm bị khoá', async () => {
    mocks.fetch.mockReturnValue(statusOf({
      vocab: entryOf({ locked: true, title: 'Từ vựng bảo trì', message: 'Tạm khoá từ vựng.' }),
      grammar: entryOf({ locked: true, title: 'Ngữ pháp bảo trì', message: 'Tạm khoá ngữ pháp.' })
    }));

    renderGate('/vocab');

    expect(await screen.findByText('Từ vựng bảo trì')).toBeInTheDocument();
    // Chỉ hiện thông tin của nhóm của TRANG HIỆN TẠI, không trộn nhóm khác vào.
    expect(screen.getByText('Tạm khoá từ vựng.')).toBeInTheDocument();
    expect(screen.queryByText('Ngữ pháp bảo trì')).toBeNull();
    // Đang khoá thì không được render nội dung ứng dụng phía sau.
    expect(screen.queryByText('NỘI DUNG ỨNG DỤNG')).toBeNull();
  });

  it('render children khi nhóm khác bị khoá', async () => {
    mocks.fetch.mockReturnValue(statusOf({
      vocab: entryOf({ locked: true, title: 'Từ vựng bảo trì', message: 'Tạm khoá từ vựng.' })
    }));

    // /gpa không thuộc nhóm nào trong taxonomy nên không bao giờ bị chặn.
    renderGate('/gpa');

    expect(await screen.findByText('NỘI DUNG ỨNG DỤNG')).toBeInTheDocument();
    expect(screen.queryByText('Từ vựng bảo trì')).toBeNull();
  });

  it('chuyển sang màn hình bảo trì khi nhận event bdu:maintenance của đúng nhóm lúc đang chạy', async () => {
    mocks.fetch.mockReturnValue(statusOf({}));

    renderGate('/vocab');
    await screen.findByText('NỘI DUNG ỨNG DỤNG');

    dispatchMaintenance({ group: 'vocab', title: 'Bảo trì đột xuất', message: 'Vui lòng quay lại sau ít phút.' });

    expect(await screen.findByText('Bảo trì đột xuất')).toBeInTheDocument();
    expect(screen.getByText('Vui lòng quay lại sau ít phút.')).toBeInTheDocument();
    expect(screen.queryByText('NỘI DUNG ỨNG DỤNG')).toBeNull();
  });

  it('event của nhóm khác không chặn trang hiện tại', async () => {
    mocks.fetch.mockReturnValue(statusOf({}));

    renderGate('/gpa');
    await screen.findByText('NỘI DUNG ỨNG DỤNG');

    dispatchMaintenance({ group: 'vocab', title: 'Từ vựng bảo trì', message: 'Tạm khoá từ vựng.' });

    expect(screen.getByText('NỘI DUNG ỨNG DỤNG')).toBeInTheDocument();
    expect(screen.queryByText('Từ vựng bảo trì')).toBeNull();
  });

  it('trang ngoài bản đồ nhóm không bao giờ bị bảo trì dù mọi nhóm đều khoá', async () => {
    // Khóa toàn bộ nhóm: nếu gate lỡ suy sai nhóm thì /login (portal) cũng bị chặn,
    // người dùng không đăng nhập lại được để thoát.
    mocks.fetch.mockReturnValue(statusOf({
      vocab: entryOf({ locked: true, title: 'Vocab', message: 'M' }),
      grammar: entryOf({ locked: true, title: 'Grammar', message: 'M' }),
      community: entryOf({ locked: true, title: 'Community', message: 'M' }),
      clubs: entryOf({ locked: true, title: 'Clubs', message: 'M' })
    }));

    renderGate('/login');
    await screen.findByText('NỘI DUNG ỨNG DỤNG');

    dispatchMaintenance({ group: 'vocab', title: 'Vocab', message: 'M' });

    expect(screen.getByText('NỘI DUNG ỨNG DỤNG')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /bảo trì/i })).toBeNull();
  });

  it('tự thoát màn hình khi poll thấy nhóm của trang đã mở khoá', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockReturnValue(statusOf({
      vocab: entryOf({ locked: true, title: 'Từ vựng bảo trì', message: 'Tạm khoá từ vựng.' })
    }));

    renderGate('/vocab');
    await act(async () => {});
    expect(screen.getByText('Từ vựng bảo trì')).toBeInTheDocument();

    // Mở khoá ở server rồi để nhịp poll 30 giây tự phát hiện.
    mocks.fetch.mockReturnValue(statusOf({ vocab: entryOf({ locked: false }) }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    expect(screen.getByText('NỘI DUNG ỨNG DỤNG')).toBeInTheDocument();
    expect(screen.queryByText('Từ vựng bảo trì')).toBeNull();
  });

  it('giữ nguyên màn hình bảo trì khi /api/status gặp lỗi', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockReturnValue(statusOf({
      vocab: entryOf({ locked: true, title: 'Từ vựng bảo trì', message: 'Tạm khoá từ vựng.' })
    }));

    renderGate('/vocab');
    await act(async () => {});
    expect(screen.getByText('Từ vựng bảo trì')).toBeInTheDocument();

    // Mất mạng / endpoint lỗi không được coi là "đã mở khoá".
    mocks.fetch.mockRejectedValue(new Error('mạng lỗi'));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    expect(screen.getByText('Từ vựng bảo trì')).toBeInTheDocument();
    expect(screen.queryByText('NỘI DUNG ỨNG DỤNG')).toBeNull();
  });

  it('nút "Thử lại" gọi lại /api/status ngay', async () => {
    mocks.fetch.mockReturnValue(statusOf({
      vocab: entryOf({ locked: true, title: 'Từ vựng bảo trì', message: 'Tạm khoá từ vựng.' })
    }));

    renderGate('/vocab');
    await screen.findByText('Từ vựng bảo trì');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    mocks.fetch.mockReturnValueOnce(statusOf({ vocab: entryOf({ locked: false }) }));
    await act(async () => {
      screen.getByRole('button', { name: /Thử lại/i }).click();
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText('NỘI DUNG ỨNG DỤNG')).toBeInTheDocument();
  });

  it('không để response /api/status đến muộn ghi đè trạng thái khoá nhận từ event', async () => {
    // Giữ response mount ở trạng thái chờ để mô phỏng request đến muộn, sau khi
    // event bảo trì đã tới.
    let resolveMount;
    mocks.fetch.mockReturnValueOnce(new Promise((resolve) => { resolveMount = resolve; }));

    renderGate('/vocab');

    dispatchMaintenance({ group: 'vocab', title: 'Bảo trì', message: 'Đang khoá' });
    expect(screen.getByText('Bảo trì')).toBeInTheDocument();

    await act(async () => {
      resolveMount(okResponse({ result: true, data: { groups: { vocab: entryOf({ locked: false }) } } }));
    });

    // Response cũ (locked:false) không được phép mở khoá màn hình.
    expect(screen.getByText('Bảo trì')).toBeInTheDocument();
    expect(screen.queryByText('NỘI DUNG ỨNG DỤNG')).toBeNull();
  });

  it('không poll khi nhóm của trang hiện tại không bị khoá', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockReturnValue(statusOf({ vocab: entryOf({ locked: false }) }));

    renderGate('/vocab');
    await act(async () => {});
    expect(screen.getByText('NỘI DUNG ỨNG DỤNG')).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('giữ nguyên trạng thái khi /api/status trả payload không đúng hợp đồng', async () => {
    vi.useFakeTimers();
    // Server cũ hoặc payload hỏng: không có map `groups` thì KHÔNG được mặc định
    // là "đã mở khoá" (sẽ tự mở bảo trì oan khi deploy lệch phiên bản).
    mocks.fetch.mockReturnValue(jsonResponse({ result: true, data: { locked: true, title: 'T', message: 'M' } }));

    renderGate('/vocab');
    await act(async () => {});
    mocks.fetch.mockReturnValue(jsonResponse({ result: true, data: {} }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    // Payload không có `groups` bị bỏ qua, nhưng poll không chạy vì trang không bị
    // khoá; chỉ assert fetch mount là đủ một lần và children vẫn hiện.
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('NỘI DUNG ỨNG DỤNG')).toBeInTheDocument();
  });
});

// Màn bảo trì phải thay VÙNG NỘI DUNG, giữ sidebar/topbar. Đây là ràng buộc về
// vị trí gắn component nên test trực tiếp trên mã nguồn: nếu ai đó gỡ bọc trong
// AppLayout (quay về bọc ở App.jsx) thì mất sidebar mà không test nào bắt được.
describe('vị trí gắn MaintenanceGate', () => {
  it('AppLayout bọc MaintenanceGate quanh Outlet trong AppErrorBoundary', () => {
    const source = readClientFile('layouts/AppLayout.jsx');

    expect(source).toMatch(/<AppErrorBoundary>[\s\S]*<MaintenanceGate>[\s\S]*<Outlet \/>[\s\S]*<\/MaintenanceGate>[\s\S]*<\/AppErrorBoundary>/);
  });

  it('App.jsx không còn bọc MaintenanceGate toàn cục', () => {
    const source = readClientFile('app/App.jsx');

    expect(source).not.toContain('MaintenanceGate');
  });
});