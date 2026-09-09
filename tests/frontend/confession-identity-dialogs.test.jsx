import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEquippedFrame } from '../../client/src/components/identity/Identity.jsx';
import { useFrameCinematic } from '../../client/src/components/identity/useFrameCinematic.js';
import ConfessionPage from '../../client/src/features/confession/ConfessionPage.jsx';

const presentation = {
  name: 'Sinh viên kiểm thử',
  avatar_url: '',
  max_titles: 2,
  selected_title_ids: ['title:ttcds'],
  selected_titles: [{ id: 'title:ttcds', label: 'TTCDS', detail: 'Thành viên đội chuyển đổi số', tone: 'blue' }],
  available_titles: [
    { id: 'title:ttcds', label: 'TTCDS', detail: 'Thành viên đội chuyển đổi số', tone: 'blue' },
    { id: 'title:hoc-than', label: 'Học thần', detail: 'Danh hiệu học tập', tone: 'gold' }
  ],
  equipped_frame_id: null,
  frame_access: { all: false, keys: ['anime-gojo'] }
};

vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { name: 'Sinh viên kiểm thử', mssv: 'TEST0001', idsv: '1' } }),
  useRealtimeRoom: () => {},
  useRealtimeStatus: () => 'ready',
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
  getMyIdentityPresentation: vi.fn(() => Promise.resolve(presentation)),
  updateMyEquippedFrame: vi.fn(),
  updateMyIdentityPresentation: vi.fn()
}));

vi.mock('../../client/src/api/academics.js', () => ({
  getMyAcademicRanking: vi.fn(() => Promise.resolve({})),
  getProfile: vi.fn(() => Promise.resolve({}))
}));

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

function CinematicHarness({ frame }) {
  const avatarRef = useRef(null);
  const bannerRef = useRef(null);
  const announcementRef = useRef(null);
  const particleFieldRef = useRef(null);
  useFrameCinematic({ frame, avatarRef, bannerRef, announcementRef, particleFieldRef });
  return (
    <div ref={bannerRef}>
      <div ref={avatarRef}>
        <div ref={particleFieldRef} />
      </div>
      <div ref={announcementRef} />
    </div>
  );
}

afterEach(() => cleanup());

describe('Confession identity dialogs', () => {
  it('portals the title picker, keeps selection controls visible, and restores the opener after Escape', async () => {
    renderPage();
    const opener = await screen.findByRole('button', { name: 'Chọn danh hiệu' });
    await screen.findAllByText('TTCDS');
    fireEvent.click(opener);

    const dialog = await screen.findByRole('dialog', { name: 'Chọn danh hiệu hiển thị' });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(screen.getByRole('button', { name: 'Bỏ chọn tất cả' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /TTCDS/ })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn tất cả' }));
    expect(screen.getByRole('checkbox', { name: /TTCDS/ })).not.toBeChecked();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chọn danh hiệu hiển thị' })).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('portals the frame picker and exposes an unambiguous equipped state', async () => {
    renderPage();
    const opener = await screen.findByRole('button', { name: 'Mở bộ sưu tập khung vinh danh' });
    fireEvent.click(opener);

    const dialog = await screen.findByRole('dialog', { name: /Bộ Sưu Tập Khung Avatar Vinh Danh/ });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(screen.getByText('Đang trang bị')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đang dùng tự động' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Đang dùng tự động' })).not.toHaveAttribute('aria-pressed');
    expect(screen.getByRole('button', { name: 'Trang bị' })).not.toHaveAttribute('aria-pressed');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Bộ Sưu Tập Khung Avatar Vinh Danh/ })).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('portals the confession composer, locks body scroll, and restores its opener', async () => {
    renderPage();
    const opener = await screen.findByRole('button', { name: 'Tạo bài viết hoặc confession mới' });
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Tạo bài viết' });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tạo bài viết' })).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe('');
    expect(opener).toHaveFocus();
  });

  it('cleans up the intro-only cinematic state and replays it when the frame changes', () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<CinematicHarness frame={getEquippedFrame('anime-gojo')} />);
      const avatar = container.firstElementChild?.firstElementChild;
      expect(avatar).toHaveClass('frame-intro-burst', 'frame-effect-gojo-limitless-awaken');
      expect(avatar).not.toHaveClass('frame-cinematic-complete');

      act(() => vi.advanceTimersByTime(2800));
      expect(avatar).not.toHaveClass('frame-intro-burst', 'frame-cinematic-complete', 'frame-effect-gojo-limitless-awaken');

      rerender(<CinematicHarness frame={getEquippedFrame('anime-itachi')} />);
      expect(avatar).toHaveClass('frame-intro-burst', 'frame-effect-itachi-crow-genjutsu');
      expect(avatar).not.toHaveClass('frame-cinematic-complete');
    } finally {
      vi.useRealTimers();
    }
  });
});
