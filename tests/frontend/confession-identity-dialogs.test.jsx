import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
});
