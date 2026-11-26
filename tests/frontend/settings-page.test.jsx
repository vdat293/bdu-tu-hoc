import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../client/src/app/appearance.jsx';
import { AppProviders } from '../../client/src/app/providers.jsx';
import SettingsPage from '../../client/src/features/settings/SettingsPage.jsx';

function setAuthSession() {
  localStorage.setItem('bdu_token', 'test-token');
  localStorage.setItem('bdu_token_expires_at', String(Date.now() + 3600_000));
  localStorage.setItem('bdu_user', JSON.stringify({ name: 'Trần Minh Khôi', mssv: '23050099' }));
}

function createFetchMock() {
  return vi.fn(async (url) => {
    const path = String(url);
    if (path.includes('/api/reminders/preferences')) {
      return new Response(JSON.stringify({
        result: true,
        data: { consented: false, discord_linked: false }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ result: true, data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  });
}

function renderSettings(initialEntry = '/setting') {
  const future = { v7_startTransition: true, v7_relativeSplatPath: true };
  return render(
    <MemoryRouter future={future} initialEntries={[initialEntry]}>
      <AppProviders>
        <Routes>
          <Route path="/setting" element={<SettingsPage />} />
          <Route path="/settings" element={<Navigate to="/setting" replace />} />
          <Route path="/info" element={<div>info-route</div>} />
        </Routes>
      </AppProviders>
    </MemoryRouter>
  );
}

describe('SettingsPage (/setting)', () => {
  beforeEach(() => {
    setAuthSession();
    vi.stubGlobal('fetch', createFetchMock());
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.body.className = '';
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.uiStyle;
    delete document.documentElement.dataset.vfx;
    vi.restoreAllMocks();
  });

  it('redirects /settings to /setting, switches UI style/theme/VFX, and omits avatar/frame/title customization', async () => {
    renderSettings('/settings');
    expect(await screen.findByRole('heading', { name: 'Cài đặt cá nhân' })).toBeInTheDocument();
    expect(screen.queryByText(/Ảnh đại diện, Khung & Danh hiệu/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Mẹo quay lại đổi giao diện:/i)).toBeInTheDocument();

    const clayRadio = screen.getByRole('radio', { name: /Claymorphism/i });
    fireEvent.click(clayRadio);
    expect(document.documentElement.dataset.uiStyle).toBe('claymorphism');
    expect(localStorage.getItem(STORAGE_KEYS.UI_STYLE)).toBe('claymorphism');

    fireEvent.click(screen.getByRole('button', { name: /Tối/i }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(STORAGE_KEYS.THEME)).toBe('dark');

    const vfxSwitch = screen.getByRole('switch', { name: /Hiệu ứng nhấn nút/i });
    fireEvent.click(vfxSwitch);
    expect(document.documentElement.dataset.vfx).toBe('off');
    expect(localStorage.getItem(STORAGE_KEYS.VFX)).toBe('false');
  });

  it('opens ReminderSettings modal', async () => {
    renderSettings('/setting');
    expect(await screen.findByRole('heading', { name: 'Cài đặt cá nhân' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cấu hình nhắc lịch học' }));
    expect(await screen.findByRole('dialog', { name: 'Nhận thông báo lịch học' })).toBeInTheDocument();
  });
});
