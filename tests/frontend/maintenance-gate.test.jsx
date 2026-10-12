import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MaintenanceGate from '../../client/src/app/MaintenanceGate.jsx';

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

function renderGate() {
  return render(<MaintenanceGate><div>NỘI DUNG ỨNG DỤNG</div></MaintenanceGate>);
}

describe('MaintenanceGate', () => {
  it('hiện màn hình bảo trì ngay khi khởi động lúc dịch vụ đang khóa', async () => {
    mocks.fetch.mockReturnValue(jsonResponse({ result: true, data: { locked: true, title: 'T', message: 'M' } }));

    renderGate();

    expect(await screen.findByText('T')).toBeInTheDocument();
    expect(screen.getByText('M')).toBeInTheDocument();
    // Đang khóa thì không được render nội dung ứng dụng phía sau.
    expect(screen.queryByText('NỘI DUNG ỨNG DỤNG')).toBeNull();
  });

  it('render children khi dịch vụ bình thường', async () => {
    mocks.fetch.mockReturnValue(jsonResponse({ result: true, data: { locked: false, title: '', message: '' } }));

    renderGate();

    expect(await screen.findByText('NỘI DUNG ỨNG DỤNG')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // Chỉ kiểm tra một lần khi mount, không có thêm request nền.
    expect(mocks.fetch).toHaveBeenCalledWith('/api/status', expect.anything());
  });

  it('chuyển sang màn hình bảo trì khi nhận event bdu:maintenance lúc đang chạy', async () => {
    mocks.fetch.mockReturnValue(jsonResponse({ result: true, data: { locked: false } }));

    renderGate();
    await screen.findByText('NỘI DUNG ỨNG DỤNG');

    act(() => {
      window.dispatchEvent(new CustomEvent('bdu:maintenance', {
        detail: { title: 'Bảo trì đột xuất', message: 'Vui lòng quay lại sau ít phút.' }
      }));
    });

    expect(await screen.findByText('Bảo trì đột xuất')).toBeInTheDocument();
    expect(screen.getByText('Vui lòng quay lại sau ít phút.')).toBeInTheDocument();
    expect(screen.queryByText('NỘI DUNG ỨNG DỤNG')).toBeNull();
  });

  it('không để response /api/status đến muộn ghi đè trạng thái khóa nhận từ event', async () => {
    // Giữ response mount ở trạng thái chờ để mô phỏng request đến muộn, sau khi
    // event bảo trì đã tới.
    let resolveMount;
    mocks.fetch.mockReturnValueOnce(new Promise((resolve) => { resolveMount = resolve; }));

    renderGate();

    act(() => {
      window.dispatchEvent(new CustomEvent('bdu:maintenance', {
        detail: { title: 'Bảo trì', message: 'Đang khóa' }
      }));
    });
    expect(screen.getByText('Bảo trì')).toBeInTheDocument();

    await act(async () => {
      resolveMount(okResponse({ result: true, data: { locked: false } }));
    });

    // Response cũ (locked:false) không được phép mở khóa màn hình.
    expect(screen.getByText('Bảo trì')).toBeInTheDocument();
    expect(screen.queryByText('NỘI DUNG ỨNG DỤNG')).toBeNull();
  });

  it('tự thoát màn hình khi poll thấy /api/status trả locked:false', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockReturnValue(jsonResponse({ result: true, data: { locked: true, title: 'T', message: 'M' } }));

    renderGate();
    await act(async () => {});
    expect(screen.getByText('T')).toBeInTheDocument();

    // Mở khóa ở server rồi để nhịp poll 30 giây tự phát hiện.
    mocks.fetch.mockReturnValue(jsonResponse({ result: true, data: { locked: false } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    expect(screen.getByText('NỘI DUNG ỨNG DỤNG')).toBeInTheDocument();
    expect(screen.queryByText('T')).toBeNull();
  });

  it('giữ nguyên màn hình bảo trì khi /api/status gặp lỗi', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockReturnValue(jsonResponse({ result: true, data: { locked: true, title: 'T', message: 'M' } }));

    renderGate();
    await act(async () => {});
    expect(screen.getByText('T')).toBeInTheDocument();

    // Mất mạng / endpoint lỗi không được coi là "đã mở khóa".
    mocks.fetch.mockRejectedValue(new Error('mạng lỗi'));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    expect(screen.getByText('T')).toBeInTheDocument();
    expect(screen.queryByText('NỘI DUNG ỨNG DỤNG')).toBeNull();
  });

  it('không poll khi dịch vụ bình thường', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockReturnValue(jsonResponse({ result: true, data: { locked: false } }));

    renderGate();
    await act(async () => {});
    expect(screen.getByText('NỘI DUNG ỨNG DỤNG')).toBeInTheDocument();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
