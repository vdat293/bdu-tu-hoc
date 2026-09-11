import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getClans: vi.fn(),
  getClanQuiz: vi.fn(),
  joinClan: vi.fn(),
  cancelClanJoinRequest: vi.fn(),
  createClan: vi.fn()
}));

vi.mock('../../client/src/api/community.js', () => mocks);
vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { name: 'Sinh viên hiện tại', mssv: '24050001' } }),
  useToasts: () => ({ notify: vi.fn() })
}));

import ClansPage from '../../client/src/features/clans/ClansPage.jsx';
import ClanJoinQuizModal from '../../client/src/features/clans/ClanJoinQuizModal.jsx';

function renderDirectory() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/clans']}><Routes><Route path="/clans" element={<ClansPage />} /><Route path="/clans/:id" element={<p>Clan detail route</p>} /></Routes></MemoryRouter></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

beforeEach(() => {
  const clans = [{
    id: 42,
    name: 'CLB Trí tuệ nhân tạo',
    tag: '[TTCDS]',
    description: 'Cùng học và làm dự án AI.',
    avatar_url: null,
    level: 7,
    xp: 1850,
    member_count: 0,
    is_joined: false,
    has_pending_request: false
  }];
  clans.can_create_clan = false;
  mocks.getClans.mockResolvedValue(clans);
  mocks.getClanQuiz.mockResolvedValue({ enabled: false, questions: [] });
});

describe('ClansPage', () => {
  it('uses truthful clan metadata, prevents a disallowed create action, and keeps discovery navigable', async () => {
    renderDirectory();

    await screen.findByText('CLB Trí tuệ nhân tạo');
    expect(screen.getByText('[TTCDS]')).toBeInTheDocument();
    expect(screen.queryByText('[[TTCDS]]')).not.toBeInTheDocument();
    expect(screen.getByText('Cấp 7 · 1850 XP')).toBeInTheDocument();
    expect(screen.getByText(/0 thành viên/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Thành lập CLB/i })).toBeDisabled();
    expect(screen.getByText(/Cần danh hiệu #TTCDS/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: /Xem CLB CLB Trí tuệ nhân tạo/i }));
    expect(await screen.findByText('Clan detail route')).toBeInTheDocument();
  });

  it('does not allow a join submission before the quiz configuration finishes loading', () => {
    render(<ClanJoinQuizModal open clanName="CLB Test" quiz={undefined} isLoading isPending={false} result={null} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Đang tải…' })).toBeDisabled();
  });
});
