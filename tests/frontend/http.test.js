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
});
