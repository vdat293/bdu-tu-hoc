import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
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
  createClan: vi.fn()
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
  role_labels: { member: { display_name: 'Thành viên', color: '#475569' } }
};

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
    render(<QueryClientProvider client={makeClient()}><MemoryRouter initialEntries={['/clans']}><Routes><Route path="/clans" element={<ClubDirectoryPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    await screen.findByText('CLB Trí tuệ nhân tạo');
    expect(document.querySelector('.clan-card__cover')).toBeNull();
    expect(screen.getByRole('button', { name: 'CLB Trí tuệ nhân tạo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tham gia' })).toBeInTheDocument();
  });

  it('renders detail with tabs and sidebar', async () => {
    const list = [club];
    list.can_create_clan = false;
    mocks.getClans.mockResolvedValue(list);
    mocks.getCommunityPosts.mockResolvedValue({ posts: [], total: 0, offset: 0 });
    mocks.getClanDocuments.mockResolvedValue({ documents: [], total: 0, stats: {} });
    mocks.getClanMembers.mockResolvedValue([]);
    mocks.getClanJoinRequests.mockResolvedValue([]);
    mocks.getClanQuiz.mockResolvedValue({ enabled: false, questions: [] });
    render(<QueryClientProvider client={makeClient()}><MemoryRouter initialEntries={['/clans/42']}><Routes><Route path="/clans/:clanId" element={<ClubDetailPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    await screen.findByRole('tab', { name: /Thảo luận/ });
    expect(screen.getByRole('tab', { name: /Tài liệu/ })).toBeInTheDocument();
    expect(screen.getByText('Về CLB')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Thành viên/ })).toBeInTheDocument();
  });
});
