import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getQuizSets: vi.fn(),
  deleteQuizSet: vi.fn(),
  getCoursePosts: vi.fn(),
  createCoursePost: vi.fn(),
  deleteCoursePost: vi.fn(),
  toggleCoursePostLike: vi.fn(),
  getCoursePostComments: vi.fn(),
  addCoursePostComment: vi.fn(),
  getLearningResources: vi.fn(),
  notify: vi.fn(),
  canAccess: true
}));

vi.mock('../../client/src/api/community.js', () => ({
  getQuizSets: mocks.getQuizSets,
  deleteQuizSet: mocks.deleteQuizSet,
  getCoursePosts: mocks.getCoursePosts,
  createCoursePost: mocks.createCoursePost,
  deleteCoursePost: mocks.deleteCoursePost,
  toggleCoursePostLike: mocks.toggleCoursePostLike,
  getCoursePostComments: mocks.getCoursePostComments,
  addCoursePostComment: mocks.addCoursePostComment,
  getLearningResources: mocks.getLearningResources
}));

vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { mssv: '24050001', name: 'Sinh viên kiểm thử' } }),
  useRealtimeRoom: () => {},
  useToasts: () => ({ notify: mocks.notify })
}));

vi.mock('../../client/src/features/ttcds/useTtcdsCapabilities.jsx', () => ({
  useTtcdsCapabilities: () => ({ data: { can_access: mocks.canAccess } })
}));

vi.mock('../../client/src/components/feedback/ConfirmDialog.jsx', () => ({
  useConfirm: () => [null, async () => true]
}));

import QuizSetCard from '../../client/src/features/learning/QuizSetCard.jsx';
import QuizSetSection from '../../client/src/features/learning/QuizSetSection.jsx';
import CourseLearningPage from '../../client/src/features/learning/CourseLearningPage.jsx';

function makeSet(overrides = {}) {
  return {
    id: 7,
    title: 'Ôn tập Chương 1',
    description: 'Tổng hợp câu hỏi chương 1.',
    question_count: 60,
    part_count: 3,
    part_sizes: [20, 20, 20],
    minutes_per_part: 30,
    author: { mssv: '24050002', name: 'Trần Thị B', titles: [], photo_url: null },
    is_mine: false,
    progress: [
      {
        part_index: 0,
        review: { answered: 5, total_count: 20, completed_at: null },
        test: { answered: 0, total_count: 20, best_correct: 8, best_total: 20, attempts: 2, completed_at: '2026-10-01T00:00:00Z' }
      },
      { part_index: 1, review: null, test: null },
      {
        part_index: 2,
        review: { answered: 20, total_count: 20, completed_at: '2026-10-02T00:00:00Z' },
        test: null
      }
    ],
    ...overrides
  };
}

function renderWithClient(ui, initialEntries = ['/']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>
  );
  return { ...view, client };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.canAccess = true;
});

describe('QuizSetSection', () => {
  it('renders the header, card title, 3 part rows, review/test CTAs and author', async () => {
    mocks.getQuizSets.mockResolvedValue({ sets: [makeSet()] });
    renderWithClient(<QuizSetSection courseCode="CSC101" canCreate onCreate={vi.fn()} />);

    expect(await screen.findByText('Bộ đề trắc nghiệm')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Tạo bộ đề' })).toBeInTheDocument();
    expect(await screen.findByText('Ôn tập Chương 1')).toBeInTheDocument();
    expect(screen.getByText('60 câu · 3 phần · 30 phút/phần')).toBeInTheDocument();

    expect(screen.getByText('Phần 1')).toBeInTheDocument();
    expect(screen.getByText('Phần 2')).toBeInTheDocument();
    expect(screen.getByText('Phần 3')).toBeInTheDocument();

    expect(screen.getByText('Đã làm 5/20')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Làm tiếp' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ôn tập lại' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Kiểm tra' })).toHaveLength(3);
    expect(screen.getByText('Cao nhất 8/20 · 2 lượt')).toBeInTheDocument();
    expect(screen.getByText('Trần Thị B')).toBeInTheDocument();
  });

  it('hides the create button when the viewer is not TTCDS', async () => {
    mocks.getQuizSets.mockResolvedValue({ sets: [] });
    renderWithClient(<QuizSetSection courseCode="CSC101" canCreate={false} onCreate={vi.fn()} />);

    expect(await screen.findByText('Bộ đề trắc nghiệm')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Tạo bộ đề' })).not.toBeInTheDocument();
    expect(await screen.findByText('Chưa có bộ đề trắc nghiệm nào cho môn này.')).toBeInTheDocument();
  });

  it('calls the create callback from the header button', async () => {
    mocks.getQuizSets.mockResolvedValue({ sets: [] });
    const onCreate = vi.fn();
    renderWithClient(<QuizSetSection courseCode="CSC101" canCreate onCreate={onCreate} />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Tạo bộ đề' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

describe('QuizSetCard', () => {
  it('navigates to the review/test runner routes from part buttons', async () => {
    mocks.getQuizSets.mockResolvedValue({ sets: [] });
    const view = renderWithClient(
      <Routes>
        <Route path="/" element={<QuizSetCard courseCode="CSC101" set={makeSet()} onDelete={vi.fn()} />} />
        <Route
          path="/learning/:courseCode/quiz-sets/:setId/parts/:partIndex/:mode"
          element={<div>Trang làm bài</div>}
        />
      </Routes>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Làm tiếp' }));
    expect(await screen.findByText('Trang làm bài')).toBeInTheDocument();
    expect(view.client).toBeDefined();
  });

  it('shows the delete button only for the author and calls deleteQuizSet', async () => {
    mocks.getQuizSets.mockResolvedValue({ sets: [] });
    mocks.deleteQuizSet.mockResolvedValue({ deleted: true });

    const mine = renderWithClient(
      <QuizSetCard courseCode="CSC101" set={makeSet({ is_mine: true })} onDelete={vi.fn()} />
    );
    expect(await screen.findByRole('button', { name: 'Xóa bộ đề Ôn tập Chương 1' })).toBeInTheDocument();
    mine.unmount();
    cleanup();

    const other = renderWithClient(
      <QuizSetCard courseCode="CSC101" set={makeSet({ is_mine: false })} onDelete={vi.fn()} />
    );
    expect(await other.findByText('Ôn tập Chương 1')).toBeInTheDocument();
    expect(other.queryByRole('button', { name: /Xóa bộ đề/ })).not.toBeInTheDocument();
    other.unmount();
    cleanup();

    // Delete flow through the section (confirm auto-accepted by the mock).
    mocks.getQuizSets.mockResolvedValue({ sets: [makeSet({ is_mine: true })] });
    renderWithClient(<QuizSetSection courseCode="CSC101" canCreate={false} onCreate={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa bộ đề Ôn tập Chương 1' }));
    await waitFor(() => expect(mocks.deleteQuizSet).toHaveBeenCalledWith('test-token', 'CSC101', 7));
  });
});

describe('CourseLearningPage without old quiz-post UI', () => {
  function mockPageAPIs() {
    mocks.getQuizSets.mockResolvedValue({ sets: [] });
    mocks.getLearningResources.mockResolvedValue({ courses: [] });
    mocks.getCoursePosts.mockResolvedValue({
      posts: [
        { id: 1, kind: 'request', title: 'Câu hỏi con trỏ', content: '...', author: { name: 'A' }, like_count: 0, comment_count: 0 },
        { id: 2, kind: 'document', title: 'Slide', content: '', url: 'https://example.com/slide', author: { name: 'B' }, like_count: 0, comment_count: 0 },
        { id: 3, kind: 'video', title: 'Video', content: '', url: 'https://www.youtube.com/watch?v=abc', author: { name: 'C' }, like_count: 0, comment_count: 0 },
        { id: 4, kind: 'link', title: 'Tham khảo', content: '', url: 'https://example.com', author: { name: 'D' }, like_count: 0, comment_count: 0 }
      ]
    });
  }

  function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={['/learning/CSC101']}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/learning/:courseCode" element={<CourseLearningPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    );
  }

  it('shows the quiz-set section and keeps only the 4 legacy kinds', async () => {
    mocks.canAccess = false;
    mockPageAPIs();
    renderPage();

    expect(await screen.findByText('Bộ đề trắc nghiệm')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Tạo bộ đề' })).not.toBeInTheDocument();

    // Old quiz filter tab is gone; the 4 legacy kinds remain.
    expect(screen.queryByRole('tab', { name: /Trắc nghiệm/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Tài liệu/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Luận bàn/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Video/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Tham khảo/ })).toBeInTheDocument();

    // Old hero quiz stat and quiz-post UI are gone; the only "trắc nghiệm"
    // mentions left belong to the new section (heading + empty state).
    // Legacy posts still render.
    expect(await screen.findByText('Câu hỏi con trỏ')).toBeInTheDocument();
    expect(await screen.findByText('Chưa có bộ đề trắc nghiệm nào cho môn này.')).toBeInTheDocument();
    const quizMentions = screen.queryAllByText(/trắc nghiệm/i).map((el) => el.textContent);
    expect(quizMentions).toContain('Bộ đề trắc nghiệm');
    expect(quizMentions).toContain('Chưa có bộ đề trắc nghiệm nào cho môn này.');
    expect(quizMentions).toHaveLength(2);
    expect(screen.queryByText(/Bắt đầu làm bài|Xem kết quả/)).not.toBeInTheDocument();
  });

  it('opens the composer without any quiz pill or panel', async () => {
    mockPageAPIs();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ tài liệu/ }));
    expect(await screen.findByText(/Đang đăng vào:/)).toBeInTheDocument();
    expect(screen.queryByText('Tạo trắc nghiệm')).not.toBeInTheDocument();
    expect(screen.queryByText('Tạo bài trắc nghiệm')).not.toBeInTheDocument();
    expect(screen.getByText(/Luận bàn \/ Hỏi đáp/)).toBeInTheDocument();
  });
});
