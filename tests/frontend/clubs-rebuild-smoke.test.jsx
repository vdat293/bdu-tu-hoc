import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getClans: vi.fn(),
  getClanQuiz: vi.fn(),
  getCommunityPosts: vi.fn(),
  getClanDocuments: vi.fn(),
  getClanMembers: vi.fn(),
  getClanJoinRequests: vi.fn(),
  joinClan: vi.fn(),
  cancelClanJoinRequest: vi.fn(),
  createClan: vi.fn(),
  updateClanMemberRole: vi.fn(),
  kickClanMember: vi.fn(),
  reviewClanJoinRequest: vi.fn()
}));

vi.mock('../../client/src/api/community.js', () => mocks);
vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { name: 'Sinh viên hiện tại', mssv: '24050001' } }),
  useToasts: () => ({ notify: vi.fn() }),
  useRealtimeRoom: () => {}
}));

import ClubDirectoryPage from '../../client/src/features/clubs/pages/ClubDirectoryPage.jsx';
import ClubDetailPage from '../../client/src/features/clubs/pages/ClubDetailPage.jsx';
import { resolveRoleLabel } from '../../client/src/features/clubs/lib/roles.js';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const club = {
  id: 42,
  name: 'CLB Trí tuệ nhân tạo',
  code: 'CLB_AI',
  tag: '[AI]',
  description: 'Cùng học AI.',
  avatar_url: null,
  level: 3,
  xp: 500,
  member_count: 10,
  is_joined: true,
  my_role: 'member',
  role_labels: {
    leader: { display_name: 'Chủ nhiệm', color: '#b45309' },
    vice_leader: { display_name: 'Phó chủ nhiệm', color: '#2563eb' },
    elder: { display_name: 'Cố vấn', color: '#6d28d9' },
    member: { display_name: 'Thành viên', color: '#475569' },
    recruit: { display_name: 'Tân binh', color: '#78716c' }
  }
};

function setupDefaultMocks(clubData = club) {
  const list = [clubData];
  list.can_create_clan = false;
  mocks.getClans.mockResolvedValue(list);
  mocks.getCommunityPosts.mockResolvedValue({ posts: [], total: 0, offset: 0 });
  mocks.getClanDocuments.mockResolvedValue({ documents: [], total: 0, stats: {} });
  mocks.getClanMembers.mockResolvedValue([
    { mssv: '24050001', full_name: 'Sinh viên hiện tại', role: clubData.my_role || 'member', contribution_points: 20 },
    { mssv: '24050002', full_name: 'Nguyễn Minh Khôi', role: 'member', contribution_points: 10 }
  ]);
  mocks.getClanJoinRequests.mockResolvedValue([]);
  mocks.getClanQuiz.mockResolvedValue({ enabled: false, questions: [] });
}

afterEach(() => {
  cleanup();
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

describe('clubs rebuild smoke', () => {
  it('resolveRoleLabel handles map/array/missing shapes', () => {
    expect(resolveRoleLabel(undefined, 'leader')).toEqual({ name: 'Bang chủ', color: '#b45309' });
    expect(resolveRoleLabel({ member: { display_name: 'TV', color: '#111111' } }, 'member')).toEqual({ name: 'TV', color: '#111111' });
    expect(resolveRoleLabel([{ role_key: 'elder', display_name: 'TL', color: '#222222' }], 'elder')).toEqual({ name: 'TL', color: '#222222' });
  });

  it('renders directory without absolute cover-link hack', async () => {
    const list = [{ ...club, is_joined: false }];
    list.can_create_clan = false;
    mocks.getClans.mockResolvedValue(list);
    mocks.getClanQuiz.mockResolvedValue({ enabled: false, questions: [] });
    render(
      <QueryClientProvider client={makeClient()}>
        <MemoryRouter initialEntries={['/clans']}>
          <Routes><Route path="/clans" element={<ClubDirectoryPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    await screen.findByText('CLB Trí tuệ nhân tạo');
    expect(document.querySelector('.clan-card__cover')).toBeNull();
    expect(screen.getByRole('button', { name: 'CLB Trí tuệ nhân tạo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tham gia' })).toBeInTheDocument();
  });

  it('renders detail inside .clb-root with tabs, keyboard navigation, and sidebar without legacy bleed', async () => {
    setupDefaultMocks(club);
    render(
      <QueryClientProvider client={makeClient()}>
        <MemoryRouter initialEntries={['/clans/42']}>
          <Routes><Route path="/clans/:clanId" element={<ClubDetailPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const feedTab = await screen.findByRole('tab', { name: /Thảo luận/ });
    const docsTab = screen.getByRole('tab', { name: /Tài liệu/ });
    const membersTab = screen.getByRole('tab', { name: /Thành viên/ });
    expect(screen.getByText('Về CLB')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Cài đặt/ })).not.toBeInTheDocument();

    const root = document.querySelector('#tab-clans');
    expect(root).toHaveClass('clb-root');
    expect(root).not.toHaveClass('tab-pane');
    expect(root).not.toHaveClass('club-experience');
    expect(root.querySelector('.glass-panel')).toBeNull();

    fireEvent.keyDown(feedTab, { key: 'ArrowRight' });
    expect(docsTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(docsTab, { key: 'End' });
    expect(membersTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(membersTab, { key: 'Home' });
    expect(feedTab).toHaveAttribute('aria-selected', 'true');
  });

  it('shows human-readable role labels in member dropdown and requires confirmation before transferring leader role', async () => {
    setupDefaultMocks({ ...club, my_role: 'leader', pending_request_count: 1 });
    render(
      <QueryClientProvider client={makeClient()}>
        <MemoryRouter initialEntries={['/clans/42?tab=members']}>
          <Routes><Route path="/clans/:clanId" element={<ClubDetailPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByRole('tab', { name: /Yêu cầu/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Cài đặt/ })).toBeInTheDocument();

    const select = await screen.findByLabelText('Đổi vai trò của Nguyễn Minh Khôi');
    const optionTexts = [...select.querySelectorAll('option')].map((o) => o.textContent);
    expect(optionTexts).toEqual(['Chủ nhiệm', 'Phó chủ nhiệm', 'Cố vấn', 'Thành viên', 'Tân binh']);

    fireEvent.change(select, { target: { value: 'leader' } });
    expect(mocks.updateClanMemberRole).not.toHaveBeenCalled();
    expect(await screen.findByText('Chuyển quyền Bang chủ?')).toBeInTheDocument();
  });

  it('shows non-member gate when the viewer has not joined the club', async () => {
    setupDefaultMocks({ ...club, is_joined: false, my_role: null });
    render(
      <QueryClientProvider client={makeClient()}>
        <MemoryRouter initialEntries={['/clans/42']}>
          <Routes><Route path="/clans/:clanId" element={<ClubDetailPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText('Nội dung dành cho thành viên')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xin tham gia CLB' })).toBeInTheDocument();
  });
});
