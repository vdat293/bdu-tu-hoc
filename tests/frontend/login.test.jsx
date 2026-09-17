import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../client/src/app/providers.jsx';
import LoginPage from '../../client/src/features/auth/LoginPage.jsx';
import { goToReturnTo } from '../../client/src/features/auth/session.js';

const sessionMock = vi.hoisted(() => ({ actualGoToReturnTo: null }));

vi.mock('../../client/src/features/auth/session.js', async (importOriginal) => {
  const actual = await importOriginal();
  sessionMock.actualGoToReturnTo = actual.goToReturnTo;
  return { ...actual, goToReturnTo: vi.fn(actual.goToReturnTo) };
});

function stubLoginFetch() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: true, token: 'test-token', expires_in: 3600, name: 'Sinh viên Test', mssv: 'TEST0001' }), { status: 200, headers: { 'content-type': 'application/json' } })));
}

async function submitLogin() {
  fireEvent.change(await screen.findByLabelText('Mã Số Sinh Viên (MSSV)'), { target: { value: 'TEST0001' } });
  fireEvent.change(screen.getByLabelText('Mật Khẩu'), { target: { value: 'not-a-real-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
}

function renderLogin(initialEntry, routes) {
  const future = { v7_startTransition: true, v7_relativeSplatPath: true };
  return render(<MemoryRouter future={future} initialEntries={[initialEntry]}><AppProviders><Routes>{routes}</Routes></AppProviders></MemoryRouter>);
}

describe('LoginPage', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.mocked(goToReturnTo).mockImplementation(sessionMock.actualGoToReturnTo);
  });

  it('submits credentials, persists the session and returns to the requested route', async () => {
    stubLoginFetch();
    renderLogin({ pathname: '/login', state: { returnTo: '/schedule?semester=20261' } }, <>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/schedule" element={<div>Schedule route</div>} />
      <Route path="*" element={<Navigate to="/login" />} />
    </>);
    await submitLogin();
    await waitFor(() => expect(screen.getByText('Schedule route')).toBeInTheDocument());
    expect(window.sessionStorage.getItem('bdu_token')).toBeNull();
    expect(window.localStorage.getItem('bdu_token')).toBe('test-token');
    expect(fetch).toHaveBeenCalledWith('/api/login', expect.objectContaining({ method: 'POST' }));
  });

  it('hard-loads /games invite targets instead of rendering the portal 404', async () => {
    const hardNavigate = vi.fn();
    vi.mocked(goToReturnTo).mockImplementation((target, navigate) => sessionMock.actualGoToReturnTo(target, navigate, hardNavigate));
    stubLoginFetch();
    renderLogin({ pathname: '/login', search: '?returnTo=%2Fgames%2Froom%2FEHDY004X%3Frole%3Dplayer' }, <>
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<div>portal-route-missing</div>} />
    </>);
    await submitLogin();
    await waitFor(() => expect(hardNavigate).toHaveBeenCalledWith('/games/room/EHDY004X?role=player'));
    expect(screen.queryByText('portal-route-missing')).not.toBeInTheDocument();
  });

  it('keeps portal returnTo targets on client-side navigation without a full reload', async () => {
    const hardNavigate = vi.fn();
    vi.mocked(goToReturnTo).mockImplementation((target, navigate) => sessionMock.actualGoToReturnTo(target, navigate, hardNavigate));
    stubLoginFetch();
    renderLogin({ pathname: '/login' }, <>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/gpa" element={<div>GPA route</div>} />
      <Route path="*" element={<div>portal-route-missing</div>} />
    </>);
    await submitLogin();
    await waitFor(() => expect(screen.getByText('GPA route')).toBeInTheDocument());
    expect(hardNavigate).not.toHaveBeenCalled();
  });
});
