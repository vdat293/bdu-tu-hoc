import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfessionPage, {
  FORUM_FALLBACK_BURST_ATTEMPTS,
  invalidateForumFallbackQueries,
  isForumCommentsQuery,
  shouldUseForumFallback
} from '../../client/src/features/confession/ConfessionPage.jsx';
import { getCommunityPosts } from '../../client/src/api/community.js';

const realtime = vi.hoisted(() => ({ status: 'ready' }));

vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { name: 'Sinh viên kiểm thử', mssv: 'TEST0001', idsv: '1' } }),
  useRealtimeRoom: () => {},
  useRealtimeStatus: () => realtime.status,
  useToasts: () => ({ notify: vi.fn() })
}));

vi.mock('../../client/src/api/community.js', () => ({
  addCommunityPostComment: vi.fn(),
  createCommunityPost: vi.fn(),
  deleteCommunityPost: vi.fn(),
  getCommunityPostComments: vi.fn(),
  getCommunityPosts: vi.fn(() => Promise.resolve({ posts: [] })),
  toggleCommunityPostLike: vi.fn()
}));

vi.mock('../../client/src/api/identity.js', () => ({
  getMyIdentityPresentation: vi.fn(() => Promise.resolve({ selected_titles: [], available_titles: [], frame_access: {} })),
  updateMyEquippedFrame: vi.fn(),
  updateMyIdentityPresentation: vi.fn()
}));

vi.mock('../../client/src/api/academics.js', () => ({
  getMyAcademicRanking: vi.fn(() => Promise.resolve({})),
  getProfile: vi.fn(() => Promise.resolve({}))
}));

function ForumTree({ client, entry }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={client}><ConfessionPage /></QueryClientProvider>
    </MemoryRouter>
  );
}

function renderForum(entry = '/confession') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<ForumTree client={client} entry={entry} />);
  return { ...view, client, entry };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  realtime.status = 'ready';
});

describe('forum realtime convergence', () => {
  it('uses the backend forum aggregate scope and forwards the selected UI filter', async () => {
    renderForum('/confession?filter=mine');
    await waitFor(() => expect(getCommunityPosts).toHaveBeenCalled());
    expect(getCommunityPosts).toHaveBeenCalledWith('test-token', expect.objectContaining({
      scope: 'forum',
      filter: 'mine',
      limit: 50
    }));
  });

  it('uses a bounded degraded forum fallback cadence and stops it as soon as realtime is ready', async () => {
    vi.useFakeTimers();
    realtime.status = 'unavailable';
    const view = renderForum();
    await act(async () => { await Promise.resolve(); });
    expect(getCommunityPosts).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Cập nhật trực tiếp tạm gián đoạn')).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    realtime.status = 'reconnecting';
    view.rerender(<ForumTree client={view.client} entry={view.entry} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(getCommunityPosts).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000 * (FORUM_FALLBACK_BURST_ATTEMPTS - 1)); });
    expect(getCommunityPosts).toHaveBeenCalledTimes(1 + FORUM_FALLBACK_BURST_ATTEMPTS);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getCommunityPosts).toHaveBeenCalledTimes(2 + FORUM_FALLBACK_BURST_ATTEMPTS);

    realtime.status = 'ready';
    view.rerender(<ForumTree client={view.client} entry={view.entry} />);
    expect(screen.getByText('Cập nhật trực tiếp')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(getCommunityPosts).toHaveBeenCalledTimes(2 + FORUM_FALLBACK_BURST_ATTEMPTS);

    expect(shouldUseForumFallback('ready')).toBe(false);
    expect(shouldUseForumFallback('reconnecting')).toBe(true);
    expect(shouldUseForumFallback('auth-invalid')).toBe(false);
  });

  it('refreshes an open forum comment thread during a websocket outage without touching course comment keys', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } } });
    const forumCommentsFetch = vi.fn().mockResolvedValue([{ id: 'new-comment-from-tab-b' }]);
    const courseCommentsFetch = vi.fn().mockResolvedValue([{ id: 'course-comment' }]);
    const forumObserver = new QueryObserver(client, { queryKey: ['post-comments', '42'], queryFn: forumCommentsFetch });
    const courseObserver = new QueryObserver(client, { queryKey: ['post-comments', 'INF101', '42'], queryFn: courseCommentsFetch });
    const unsubscribeForum = forumObserver.subscribe(() => {});
    const unsubscribeCourse = courseObserver.subscribe(() => {});
    await forumObserver.refetch();
    await courseObserver.refetch();
    forumCommentsFetch.mockClear();
    courseCommentsFetch.mockClear();

    await invalidateForumFallbackQueries(client, ['confession', 'TEST0001', 'all']);
    expect(forumCommentsFetch).toHaveBeenCalledTimes(1);
    expect(courseCommentsFetch).not.toHaveBeenCalled();
    expect(isForumCommentsQuery({ queryKey: ['post-comments', '42'] })).toBe(true);
    expect(isForumCommentsQuery({ queryKey: ['post-comments', 'INF101', '42'] })).toBe(false);
    unsubscribeForum();
    unsubscribeCourse();
    client.clear();
  });
});
