import { describe, expect, it, vi } from 'vitest';
import { ApiError, request } from '../../client/src/api/http.js';

describe('frontend HTTP transport', () => {
  it('passes bearer token and abort signal without putting token in query keys', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: true, data: { ok: true } }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(request('/api/grades', { token: 'secret-token', signal: controller.signal })).resolves.toEqual({ result: true, data: { ok: true } });
    expect(fetch).toHaveBeenCalledWith('/api/grades', expect.objectContaining({ signal: controller.signal, headers: expect.any(Headers) }));
    expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer secret-token');
  });

  it('normalizes HTTP errors into status-bearing errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: false, message: 'Không đủ quyền.' }), { status: 403, headers: { 'content-type': 'application/json' } })));
    await expect(request('/api/private')).rejects.toMatchObject({ status: 403, message: 'Không đủ quyền.' });
    expect(ApiError).toBeTypeOf('function');
  });

  // 503 kèm đúng mã MAINTENANCE phải thành MaintenanceError và phát sự kiện
  // 'bdu:maintenance' mang title/message để màn hình bảo trì (Task 7) hiển thị.
  // Từ khi khoá theo nhóm, màn hình bảo trì chỉ chặn trang của đúng nhóm bị khoá,
  // nên cả lỗi lẫn sự kiện phải mang thêm `group` để tầng UI biết đang khoá nhóm nào.
  it('maps 503 with MAINTENANCE code to MaintenanceError and emits bdu:maintenance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: false, code: 'MAINTENANCE', group: 'vocab', title: 'Dịch vụ đang tạm khóa', message: 'Hệ thống đang bảo trì.' }), { status: 503, headers: { 'content-type': 'application/json' } })));
    const listener = vi.fn();
    window.addEventListener('bdu:maintenance', listener);
    try {
      await expect(request('/api/vocab/themes')).rejects.toMatchObject({ name: 'MaintenanceError', status: 503, code: 'MAINTENANCE', group: 'vocab' });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].detail).toMatchObject({ group: 'vocab', title: 'Dịch vụ đang tạm khóa', message: 'Hệ thống đang bảo trì.' });
    } finally {
      window.removeEventListener('bdu:maintenance', listener);
    }
  });

  // Khoá legacy hoặc phản hồi cũ có thể không kèm group: phải giữ nguyên hành vi cũ
  // (group = null) thay vì ném lỗi hay nhét chuỗi "undefined" vào sự kiện.
  it('keeps group null when the MAINTENANCE payload omits it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: false, code: 'MAINTENANCE', message: 'Hệ thống đang bảo trì.' }), { status: 503, headers: { 'content-type': 'application/json' } })));
    const listener = vi.fn();
    window.addEventListener('bdu:maintenance', listener);
    try {
      await expect(request('/api/profile')).rejects.toMatchObject({ name: 'MaintenanceError', status: 503, group: null });
      expect(listener.mock.calls[0][0].detail.group).toBeNull();
    } finally {
      window.removeEventListener('bdu:maintenance', listener);
    }
  });

  // Chốt rằng CHỈ đúng mã MAINTENANCE mới kích hoạt màn hình bảo trì: một 503
  // khác (ví dụ proxy/quá tải) vẫn là ApiError thường và không phát sự kiện.
  it('keeps a 503 without the MAINTENANCE code as a plain ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: false, message: 'Tạm thời không khả dụng.' }), { status: 503, headers: { 'content-type': 'application/json' } })));
    const listener = vi.fn();
    window.addEventListener('bdu:maintenance', listener);
    try {
      await expect(request('/api/profile')).rejects.toMatchObject({ name: 'ApiError', status: 503 });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('bdu:maintenance', listener);
    }
  });
});
