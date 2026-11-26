import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../client/src/app/appearance.jsx';
import { AppProviders } from '../../client/src/app/providers.jsx';
import UiOnboardingTour, { UI_GUIDE_DISMISSED_KEY } from '../../client/src/components/layout/UiOnboardingTour.jsx';
import UserMenuPopover from '../../client/src/components/layout/UserMenuPopover.jsx';
import SettingsPage from '../../client/src/features/settings/SettingsPage.jsx';

function setAuthSession() {
  localStorage.setItem('bdu_token', 'test-token');
  localStorage.setItem('bdu_token_expires_at', String(Date.now() + 3600_000));
  localStorage.setItem('bdu_user', JSON.stringify({ name: 'Nguyễn Văn An', mssv: '23050001' }));
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = String(url);
    if (path.includes('/api/students/me/presentation')) {
      return new Response(JSON.stringify({
        result: true,
        data: { name: 'Nguyễn Văn An', avatar_url: '' }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
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
  }));
}

function TourHarness() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsTick, setSettingsTick] = useState(0);

  return (
    <>
      <UserMenuPopover
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onSettingsNavigate={() => setSettingsTick((n) => n + 1)}
      />
      <Routes>
        <Route path="/gpa" element={<div>gpa-view</div>} />
        <Route path="/setting" element={<SettingsPage />} />
        <Route path="/info" element={<div>info-view</div>} />
      </Routes>
      <UiOnboardingTour
        menuOpen={menuOpen}
        onSetMenuOpen={setMenuOpen}
        settingsClickTick={settingsTick}
      />
    </>
  );
}

function renderTour(initialEntry = '/gpa') {
  const future = { v7_startTransition: true, v7_relativeSplatPath: true };
  return render(
    <MemoryRouter future={future} initialEntries={[initialEntry]}>
      <AppProviders>
        <TourHarness />
      </AppProviders>
    </MemoryRouter>
  );
}

describe('UiOnboardingTour (3-step interactive guide)', () => {
  beforeEach(() => {
    setAuthSession();
    stubFetch();
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

  it('walks through all 3 steps, allows Back/Next, switches UI live on step 3, and persists completion', async () => {
    renderTour('/gpa');

    expect(screen.getByRole('dialog', { name: 'Hướng dẫn đổi giao diện từng bước' })).toBeInTheDocument();
    expect(screen.getByText('BƯỚC 1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mở menu cá nhân' })).toBeInTheDocument();

    // Bước 1 -> Bước 2: mở menu Xin chào
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp theo' }));
    expect(screen.getByText('BƯỚC 2 / 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Chọn mục Cài đặt' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Menu tài khoản' })).toBeInTheDocument();

    // Quay lại -> Bước 1 và đóng menu
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect(screen.getByText('BƯỚC 1 / 3')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Menu tài khoản' })).not.toBeInTheDocument();

    // Tiến tới Bước 2 rồi Bước 3 -> đóng menu, chuyển sang /setting
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp theo' }));
    expect(screen.getByText('BƯỚC 2 / 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp theo' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Cài đặt cá nhân' })).toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: 'Menu tài khoản' })).not.toBeInTheDocument();
    expect(screen.getByText('BƯỚC 3 / 3')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Đổi giao diện lõi' })).toBeInTheDocument();

    // Đổi sang Claymorphism ngay trong lúc mở bước 3
    fireEvent.click(screen.getByRole('radio', { name: /Claymorphism/i }));
    expect(document.documentElement.dataset.uiStyle).toBe('claymorphism');
    expect(localStorage.getItem(STORAGE_KEYS.UI_STYLE)).toBe('claymorphism');

    // Hoàn tất -> ẩn tour & lưu bdu_ui_guide_dismissed
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tất' }));
    expect(screen.queryByRole('dialog', { name: 'Hướng dẫn đổi giao diện từng bước' })).not.toBeInTheDocument();
    expect(localStorage.getItem(UI_GUIDE_DISMISSED_KEY)).toBe('1');
  });

  it('supports direct interaction advancement (clicking greeting + clicking Cài đặt)', async () => {
    renderTour('/gpa');
    expect(screen.getByText('BƯỚC 1 / 3')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /Xin chào Văn An/i }));
    await waitFor(() => expect(screen.getByText('BƯỚC 2 / 3')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Cài đặt/i }));
    await waitFor(() => expect(screen.getByText('BƯỚC 3 / 3')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Cài đặt cá nhân' })).toBeInTheDocument();
  });

  it('dismisses on Skip / Escape and replays from /setting', async () => {
    renderTour('/gpa');
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua' }));
    expect(screen.queryByRole('dialog', { name: 'Hướng dẫn đổi giao diện từng bước' })).not.toBeInTheDocument();
    expect(localStorage.getItem(UI_GUIDE_DISMISSED_KEY)).toBe('1');
    cleanup();

    renderTour('/setting');
    expect(screen.queryByRole('dialog', { name: 'Hướng dẫn đổi giao diện từng bước' })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Xem hướng dẫn từng bước' }));
    expect(screen.getByRole('dialog', { name: 'Hướng dẫn đổi giao diện từng bước' })).toBeInTheDocument();
    expect(screen.getByText('BƯỚC 1 / 3')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Hướng dẫn đổi giao diện từng bước' })).not.toBeInTheDocument();
  });
});
