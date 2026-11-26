import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../client/src/app/providers.jsx';
import UserMenuPopover from '../../client/src/components/layout/UserMenuPopover.jsx';

function setAuthSession() {
  localStorage.setItem('bdu_token', 'test-token');
  localStorage.setItem('bdu_token_expires_at', String(Date.now() + 3600_000));
  localStorage.setItem('bdu_user', JSON.stringify({ name: 'Nguyễn Văn An', mssv: '23050001' }));
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).includes('/api/students/me/presentation')) {
      return new Response(JSON.stringify({
        result: true,
        data: { name: 'Nguyễn Văn An', avatar_url: '' }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).includes('/api/reminders/preferences')) {
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

function renderPopover(onOpenPalette = vi.fn()) {
  const future = { v7_startTransition: true, v7_relativeSplatPath: true };
  return render(
    <MemoryRouter future={future} initialEntries={['/gpa']}>
      <AppProviders>
        <UserMenuPopover onOpenPalette={onOpenPalette} />
        <Routes>
          <Route path="/gpa" element={<div>gpa-page</div>} />
          <Route path="/setting" element={<div>setting-page</div>} />
          <Route path="/info" element={<div>info-page</div>} />
          <Route path="/schedule" element={<div>schedule-page</div>} />
        </Routes>
      </AppProviders>
    </MemoryRouter>
  );
}

describe('UserMenuPopover', () => {
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

  it('opens on greeting click, shows settings + quick utilities (without core UI switcher), and navigates to /setting', async () => {
    renderPopover();

    const trigger = await screen.findByRole('button', { name: /Xin chào Văn An/i });
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog', { name: 'Menu tài khoản' })).toBeInTheDocument();
    expect(screen.getByText('MSSV: 23050001')).toBeInTheDocument();
    expect(screen.queryByText(/Claymorphism/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Neo-Brutalism/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Cài đặt/i }));
    await waitFor(() => expect(screen.getByText('setting-page')).toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: 'Menu tài khoản' })).not.toBeInTheDocument();
  });

  it('supports copy MSSV, quick links, reminder modal, search trigger, and Escape close', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    const onOpenPalette = vi.fn();

    renderPopover(onOpenPalette);
    fireEvent.click(await screen.findByRole('button', { name: /Xin chào Văn An/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Sao chép MSSV' }));
    expect(writeText).toHaveBeenCalledWith('23050001');

    fireEvent.click(screen.getByRole('button', { name: /Tìm nhanh/i }));
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Menu tài khoản' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Xin chào Văn An/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Nhắc lịch học' }));
    expect(await screen.findByRole('dialog', { name: 'Nhận thông báo lịch học' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: /Xin chào Văn An/i }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Menu tài khoản' })).not.toBeInTheDocument();
  });
});
