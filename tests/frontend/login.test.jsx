import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { vi, describe, expect, it } from 'vitest';
import { AppProviders } from '../../client/src/app/providers.jsx';
import LoginPage from '../../client/src/features/auth/LoginPage.jsx';

describe('LoginPage', () => {
  it('submits credentials, persists the session and returns to the requested route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: true, token: 'test-token', expires_in: 3600, name: 'Sinh viên Test', mssv: 'TEST0001' }), { status: 200, headers: { 'content-type': 'application/json' } })));
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[{ pathname: '/login', state: { returnTo: '/schedule?semester=20261' } }]}><AppProviders><Routes><Route path="/login" element={<LoginPage />} /><Route path="/schedule" element={<div>Schedule route</div>} /><Route path="*" element={<Navigate to="/login" />} /></Routes></AppProviders></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText('Mã Số Sinh Viên (MSSV)'), { target: { value: 'TEST0001' } });
    fireEvent.change(screen.getByLabelText('Mật Khẩu'), { target: { value: 'not-a-real-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    await waitFor(() => expect(screen.getByText('Schedule route')).toBeInTheDocument());
    expect(window.sessionStorage.getItem('bdu_token')).toBeNull();
    expect(window.localStorage.getItem('bdu_token')).toBe('test-token');
    expect(fetch).toHaveBeenCalledWith('/api/login', expect.objectContaining({ method: 'POST' }));
  });
});
