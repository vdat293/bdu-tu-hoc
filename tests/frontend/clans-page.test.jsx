import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

import ClubDirectoryPage from '../../client/src/features/clubs/pages/ClubDirectoryPage.jsx';
import ClanJoinQuizModal from '../../client/src/features/clubs/components/ClanJoinQuizModal.jsx';

function renderDirectory(initialPath = '/clans') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/clans" element={<ClubDirectoryPage />} />
          <Route path="/clans/:id" element={<p>Club detail route</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

beforeEach(() => {
  const clans = [
    {
      id: 42,
      name: 'CLB Trí tuệ nhân tạo',
      code: 'CLB_AI',
      tag: '[TTCDS]',
      description: 'Cùng học và làm dự án AI.',
      avatar_url: null,
      level: 7,
      xp: 1850,
      member_count: 0,
      is_joined: false,
      has_pending_request: false
    },
    {
      id: 99,
      name: 'CLB Lập trình Web',
      code: 'CLB_WEB',
      tag: 'WEB',
      description: 'Học React và backend cùng nhau.',
      avatar_url: null,
      level: 4,
      xp: 620,
      member_count: 14,
      is_joined: true,
      my_role: 'member',
      has_pending_request: false
    }
  ];
  clans.can_create_clan = false;
  mocks.getClans.mockResolvedValue(clans);
  mocks.getClanQuiz.mockResolvedValue({ enabled: false, questions: [] });
});

describe('ClubDirectoryPage', () => {
  it('renders cleanly inside .clb-root without legacy global CSS bleed classes', async () => {
    renderDirectory();

    await screen.findByText('CLB Trí tuệ nhân tạo');
    const root = document.querySelector('#tab-clans');
    expect(root).not.toBeNull();
    expect(root).toHaveClass('clb-root');
    expect(root).not.toHaveClass('tab-pane');
    expect(root).not.toHaveClass('club-experience');
    expect(root.querySelector('.glass-panel')).toBeNull();
    expect(root.querySelector('.card')).toBeNull();
  });

  it('uses truthful club metadata, prevents a disallowed create action, and keeps discovery navigable', async () => {
    renderDirectory();

    await screen.findByText('CLB Trí tuệ nhân tạo');
    expect(screen.getByText('[TTCDS]')).toBeInTheDocument();
    expect(screen.queryByText('[[TTCDS]]')).not.toBeInTheDocument();
    expect(screen.getByText('Cấp 7 · 1850 XP')).toBeInTheDocument();
    expect(screen.getByText(/0 thành viên/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Thành lập CLB/i })).toBeDisabled();
    expect(screen.getByText(/Cần danh hiệu #TTCDS/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'CLB Trí tuệ nhân tạo' }));
    expect(await screen.findByText('Club detail route')).toBeInTheDocument();
  });

  it('filters clubs by scope (mine/all) and search keyword', async () => {
    renderDirectory();

    await screen.findByText('CLB Trí tuệ nhân tạo');
    expect(screen.getByText('CLB Lập trình Web')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'CLB của tôi' }));
    expect(screen.queryByText('CLB Trí tuệ nhân tạo')).not.toBeInTheDocument();
    expect(screen.getByText('CLB Lập trình Web')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Khám phá tất cả' }));
    fireEvent.change(screen.getByLabelText('Tìm CLB hoặc nhóm học tập'), { target: { value: 'CLB_AI' } });
    expect(screen.getByText('CLB Trí tuệ nhân tạo')).toBeInTheDocument();
    expect(screen.queryByText('CLB Lập trình Web')).not.toBeInTheDocument();
  });

  it('does not allow a join submission before the quiz configuration finishes loading', () => {
    render(
      <ClanJoinQuizModal
        open
        clanName="CLB Test"
        quiz={undefined}
        isLoading
        isPending={false}
        result={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Đang tải…' })).toBeDisabled();
  });

  it('submits undefined answers when quiz is disabled and requires all answers when enabled', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <ClanJoinQuizModal
        open
        clanName="CLB Test"
        quiz={{ enabled: false, questions: [] }}
        isLoading={false}
        isPending={false}
        result={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }));
    expect(onSubmit).toHaveBeenCalledWith(undefined);

    onSubmit.mockReset();
    rerender(
      <ClanJoinQuizModal
        open
        clanName="CLB Test"
        quiz={{
          enabled: true,
          min_correct: 1,
          questions: [{ id: 'q1', prompt: 'React là gì?', options: ['Thư viện UI', 'CSDL'] }]
        }}
        isLoading={false}
        isPending={false}
        result={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    const submitBtn = screen.getByRole('button', { name: 'Nộp quiz & xin tham gia' });
    expect(submitBtn).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Thư viện UI'));
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);
    expect(onSubmit).toHaveBeenCalledWith([{ questionId: 'q1', selectedIndex: 0 }]);
  });

  it('shows an error alert with retry and blocks submission when quiz fetch fails', () => {
    const onSubmit = vi.fn();
    const onRetry = vi.fn();
    render(
      <ClanJoinQuizModal
        open
        clanName="CLB Test"
        quiz={undefined}
        isLoading={false}
        isError
        error={new Error('Lỗi tải quiz')}
        onRetry={onRetry}
        isPending={false}
        result={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Lỗi tải quiz');
    expect(screen.queryByText(/CLB chưa bật quiz xác minh/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gửi yêu cầu' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('overrides ViewportModal legacy .modal-dialog.glass-panel styles with higher specificity', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const css = fs.readFileSync(path.resolve(dir, '../../client/src/features/clubs/styles/clubs.css'), 'utf8');
    expect(css).toContain('html .clb-modal.modal-dialog.glass-panel');
    expect(css).toContain('body.theme-dark .clb-modal.modal-dialog.glass-panel');
  });
});
