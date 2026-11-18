import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCommunityPosts: vi.fn(),
  getMyIdentityPresentation: vi.fn(),
  getIdentityFrames: vi.fn(() => Promise.resolve({ frames: [] })),
  getProfile: vi.fn(),
  getMyAcademicRanking: vi.fn(() => Promise.resolve({}))
}));

vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', status: 'authenticated', user: { name: 'Sinh viên kiểm thử', mssv: 'TEST0001', idsv: '1' } }),
  useRealtimeRoom: () => {},
  useRealtimeStatus: () => 'ready',
  useToasts: () => ({ notify: vi.fn() })
}));

vi.mock('../../client/src/api/community.js', () => ({
  addCommunityPostComment: vi.fn(),
  createCommunityPost: vi.fn(),
  deleteCommunityPost: vi.fn(),
  getCommunityPostComments: vi.fn(() => Promise.resolve([])),
  getCommunityPosts: mocks.getCommunityPosts,
  toggleCommunityPostLike: vi.fn(),
  updateCommunityPost: vi.fn()
}));

vi.mock('../../client/src/api/identity.js', () => ({
  getIdentityFrames: mocks.getIdentityFrames,
  getMyIdentityPresentation: mocks.getMyIdentityPresentation,
  updateMyEquippedFrame: vi.fn(),
  updateMyIdentityPresentation: vi.fn()
}));

vi.mock('../../client/src/api/academics.js', () => ({
  getMyAcademicRanking: mocks.getMyAcademicRanking,
  getProfile: mocks.getProfile
}));

import ConfessionPage from '../../client/src/features/confession/ConfessionPage.jsx';

const post = {
  id: 21,
  content: 'Bài viết đã tải xong',
  scope: 'school',
  category: 'confession',
  source: 'portal',
  is_anonymous: false,
  is_liked: false,
  is_mine: false,
  like_count: 0,
  comment_count: 0,
  created_at: new Date().toISOString(),
  attachments: [],
  author: { mssv: 'TEST0001', name: 'Sinh viên kiểm thử', is_anonymous: false }
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/confession']}>
      <QueryClientProvider client={client}>
        <ConfessionPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function resolveIdentity() {
  mocks.getMyIdentityPresentation.mockResolvedValue({
    name: 'Sinh viên kiểm thử',
    selected_titles: [],
    available_titles: [],
    frame_access: {}
  });
  mocks.getProfile.mockResolvedValue({});
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Confession loading lần đầu', () => {
  it('giữ skeleton toàn trang tới khi presentation, profile và feed cùng sẵn sàng', async () => {
    const feed = deferred();
    const presentation = deferred();
    const profile = deferred();
    mocks.getCommunityPosts.mockReturnValue(feed.promise);
    mocks.getMyIdentityPresentation.mockReturnValue(presentation.promise);
    mocks.getProfile.mockReturnValue(profile.promise);

    const { container } = renderPage();

    expect(screen.getByText('Đang tải BDU Confession…')).toBeInTheDocument();
    expect(container.querySelectorAll('.skeleton-forum-post')).toHaveLength(3);
    expect(container.querySelectorAll('.confession-skeleton-hero')).toHaveLength(1);
    expect(container.querySelectorAll('.confession-skeleton-widget')).toHaveLength(2);
    expect(screen.queryByText(post.content)).not.toBeInTheDocument();

    // Feed về trước cũng chưa đủ: còn danh tính/ảnh đại diện nên vẫn giữ skeleton.
    feed.resolve({ posts: [post] });
    await Promise.resolve();
    expect(screen.getByText('Đang tải BDU Confession…')).toBeInTheDocument();

    presentation.resolve({ name: 'Sinh viên kiểm thử', selected_titles: [], available_titles: [], frame_access: {} });
    profile.resolve({});

    expect(await screen.findByText(post.content)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Đang tải BDU Confession…')).not.toBeInTheDocument());
    expect(container.querySelectorAll('.confession-skeleton-widget')).toHaveLength(0);
  });

  it('không chặn lại toàn trang khi đổi filter sau lần tải đầu', async () => {
    const initialFeed = deferred();
    resolveIdentity();
    mocks.getCommunityPosts.mockImplementation((token, options) => (
      options.filter === 'all' ? initialFeed.promise : new Promise(() => {})
    ));

    const { container } = renderPage();
    initialFeed.resolve({ posts: [post] });
    await screen.findByText(post.content);

    fireEvent.click(screen.getByRole('button', { name: 'Bài của tôi' }));

    await waitFor(() => expect(mocks.getCommunityPosts).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Đang tải BDU Confession…')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.skeleton-forum-post')).toHaveLength(3);
  });

  it('feed lỗi vẫn thoát skeleton để hiện trạng thái rỗng', async () => {
    resolveIdentity();
    mocks.getCommunityPosts.mockRejectedValue(new Error('feed hỏng'));

    renderPage();

    expect(await screen.findByText('Chưa có bài viết nào')).toBeInTheDocument();
    expect(screen.queryByText('Đang tải BDU Confession…')).not.toBeInTheDocument();
  });
});
