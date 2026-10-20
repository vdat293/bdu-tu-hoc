import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getQuizSets: vi.fn(),
  createQuizSet: vi.fn(),
  deleteQuizSet: vi.fn(),
  getQuizPart: vi.fn(),
  startQuizPart: vi.fn(),
  answerQuizReview: vi.fn(),
  saveQuizPartProgress: vi.fn(),
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
  createQuizSet: mocks.createQuizSet,
  deleteQuizSet: mocks.deleteQuizSet,
  getQuizPart: mocks.getQuizPart,
  startQuizPart: mocks.startQuizPart,
  answerQuizReview: mocks.answerQuizReview,
  saveQuizPartProgress: mocks.saveQuizPartProgress,
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
import QuizSetComposerModal from '../../client/src/features/learning/QuizSetComposerModal.jsx';
import QuizSetPartPage from '../../client/src/features/learning/QuizSetPartPage.jsx';

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

function makePartData(overrides = {}) {
  return {
    set: makeSet({ question_count: 4, part_count: 2, part_sizes: [2, 2] }),
    part: { index: 0, question_count: 2, time_limit_seconds: null },
    questions: [
      { id: 'q1', question: 'Câu hỏi số 1?', options: ['Đáp án A', 'Đáp án B'] },
      { id: 'q2', question: 'Câu hỏi số 2?', options: ['Đáp án C', 'Đáp án D'] }
    ],
    progress: null,
    review: null,
    ...overrides
  };
}

function renderPartPage(initialEntry = '/learning/CSC101/quiz-sets/7/parts/0/review') {
  return renderWithClient(
    <Routes>
      <Route
        path="/learning/:courseCode/quiz-sets/:setId/parts/:partIndex/:mode"
        element={<QuizSetPartPage />}
      />
      <Route path="/learning/:courseCode" element={<div>Không gian môn</div>} />
    </Routes>,
    [initialEntry]
  );
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

describe('QuizSetComposerModal', () => {
  function makeFile(name, questionsCount) {
    const obj = {
      schema: 'bdu-quiz/v1',
      title: `Title ${name}`,
      description: `Desc ${name}`,
      questions: Array.from({ length: questionsCount }, (_, i) => ({
        question: `Q${i + 1} in ${name}`,
        options: ['A', 'B'],
        correct: 'A'
      }))
    };
    return new File([JSON.stringify(obj)], name, { type: 'application/json' });
  }

  function renderModal() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <MemoryRouter initialEntries={['/']}>
        <QueryClientProvider client={client}>
          <QuizSetComposerModal courseCode="CSC101" token="test-token" onClose={vi.fn()} />
        </QueryClientProvider>
      </MemoryRouter>
    );
    return view;
  }

  it('previews 3 parts for 3 files x20 and submits all 60 questions', async () => {
    mocks.createQuizSet.mockResolvedValue({ id: 1 });
    renderModal();
    const input = document.querySelector('input[type="file"]');
    const files = [makeFile('a.json', 20), makeFile('b.json', 20), makeFile('c.json', 20)];
    fireEvent.change(input, { target: { files } });
    await waitFor(() => expect(screen.getByText(/3 phần/)).toBeInTheDocument());
    expect(screen.getByText(/60/)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Tạo bộ đề' });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.createQuizSet).toHaveBeenCalled());
    const payload = mocks.createQuizSet.mock.calls[0][2];
    expect(payload.questions).toHaveLength(60);
    expect(payload.sourceFiles).toHaveLength(3);
    expect(payload.maxQuestionsPerPart).toBe(20);
  });

  it('shows error and disables submit for invalid JSON file', async () => {
    renderModal();
    const input = document.querySelector('input[type="file"]');
    const bad = new File(['{not json'], 'bad.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [bad] } });
    await waitFor(() => expect(screen.getByText(/JSON không hợp lệ/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Tạo bộ đề' })).toBeDisabled();
  });

  it('errors when more than 10 files or file too large', async () => {
    renderModal();
    const input = document.querySelector('input[type="file"]');
    const many = Array.from({ length: 11 }, (_, i) => makeFile(`f${i}.json`, 1));
    fireEvent.change(input, { target: { files: many } });
    await waitFor(() => expect(screen.getByText(/Tối đa 10 file/)).toBeInTheDocument());

    // reset
    cleanup();
    renderModal();
    const input2 = document.querySelector('input[type="file"]');
    const bigContent = 'x'.repeat(257 * 1024);
    const big = new File([bigContent], 'big.json', { type: 'application/json' });
    fireEvent.change(input2, { target: { files: [big] } });
    await waitFor(() => expect(screen.getByText(/vượt quá 256 KB/)).toBeInTheDocument());
  });

  it('updates preview when config changes to 25/45', async () => {
    renderModal();
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [makeFile('a.json', 60)] } });
    await waitFor(() => expect(screen.getByText(/3 phần/)).toBeInTheDocument());

    const maxInput = screen.getByLabelText('Số câu tối đa/phần');
    const minInput = screen.getByLabelText('Số phút/phần');
    fireEvent.change(maxInput, { target: { value: '25' } });
    fireEvent.change(minInput, { target: { value: '45' } });
    await waitFor(() => expect(screen.getByText(/45 phút\/phần/)).toBeInTheDocument());
  });

  it('closes on create success', async () => {
    const onClose = vi.fn();
    mocks.createQuizSet.mockResolvedValue({ id: 2 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={['/']}>
        <QueryClientProvider client={client}>
          <QuizSetComposerModal courseCode="CSC101" token="test-token" onClose={onClose} />
        </QueryClientProvider>
      </MemoryRouter>
    );
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [makeFile('a.json', 5)] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tạo bộ đề' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bộ đề' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('QuizSetPartPage review mode', () => {
  it('loads the review landing with breadcrumb, author, part meta and resume CTA', async () => {
    mocks.getQuizPart.mockResolvedValue(makePartData({
      progress: {
        answered: 1,
        total_count: 2,
        completed_at: null,
        responses: [{ id: 'q1', response: 'Đáp án A', correct: true }]
      }
    }));

    renderPartPage();

    expect(await screen.findByRole('heading', { name: 'Ôn tập Chương 1' })).toBeInTheDocument();
    expect(screen.getByText('CSC101')).toBeInTheDocument();
    expect(screen.getByText('Phần 1 · Ôn tập')).toBeInTheDocument();
    expect(screen.getByText('2 câu')).toBeInTheDocument();
    expect(screen.getByText('Không giới hạn thời gian')).toBeInTheDocument();
    expect(screen.getByText('Đã làm 1/2')).toBeInTheDocument();
    expect(screen.getByText('Trần Thị B')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Làm tiếp' })).toBeInTheDocument();
    expect(mocks.getQuizPart).toHaveBeenCalledWith(
      'test-token',
      'CSC101',
      '7',
      0,
      expect.objectContaining({ mode: 'review' })
    );
  });

  it('starts review, shows immediate feedback, autosaves with mode review and completes', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    mocks.getQuizPart.mockResolvedValue(makePartData());
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: null, restarted: false, completed_at: null });
    mocks.answerQuizReview
      .mockResolvedValueOnce({ correct: true, correct_answer: 'Đáp án A', explanation: 'Giải thích câu 1.' })
      .mockResolvedValueOnce({ correct: false, correct_answer: 'Đáp án D', explanation: 'Giải thích câu 2.' });
    mocks.saveQuizPartProgress.mockImplementation((token, code, setId, partIndex, payload) => Promise.resolve({
      mode: 'review',
      answered: payload.responses.length,
      total_count: 2,
      completed_at: payload.completed ? '2026-10-20T00:00:00Z' : null,
      responses: payload.responses.map((entry) => ({ ...entry, correct: entry.id === 'q1' })),
      correct_count: payload.responses.filter((entry) => entry.id === 'q1').length,
      remaining_seconds: null
    }));

    renderPartPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu ôn tập' }));

    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();
    expect(screen.getByText('Câu 1/2')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.getQuizPart).toHaveBeenCalledTimes(2));
    expect(mocks.startQuizPart).toHaveBeenCalledWith('test-token', 'CSC101', '7', 0, {
      mode: 'review',
      restart: false
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra đáp án' }));

    expect(await screen.findByText('Chính xác!')).toBeInTheDocument();
    expect(screen.getByText('Giải thích câu 1.')).toBeInTheDocument();
    screen.getAllByRole('radio').forEach((option) => expect(option).toBeDisabled());
    expect(mocks.answerQuizReview).toHaveBeenCalledWith('test-token', 'CSC101', '7', 0, {
      mode: 'review',
      questionId: 'q1',
      response: 'Đáp án A'
    });
    await waitFor(() => expect(mocks.saveQuizPartProgress).toHaveBeenCalledWith(
      'test-token',
      'CSC101',
      '7',
      0,
      {
        mode: 'review',
        responses: [{ id: 'q1', response: 'Đáp án A' }],
        completed: false
      }
    ));

    // Review must not offer an early finish while questions remain unanswered.
    expect(screen.queryByRole('button', { name: 'Xem kết quả' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp' }));
    expect(await screen.findByText('Câu hỏi số 2?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án D' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra đáp án' }));
    expect(await screen.findByText('Chưa chính xác.')).toBeInTheDocument();
    const lockedOptions = screen.getAllByRole('radio');
    expect(lockedOptions).toHaveLength(2);
    lockedOptions.forEach((option) => expect(option).toBeDisabled());
    expect(screen.getByText('Đáp án đúng: Đáp án D')).toBeInTheDocument();
    expect(screen.getByText('Giải thích câu 2.')).toBeInTheDocument();

    const finish = await screen.findByRole('button', { name: 'Xem kết quả' });
    fireEvent.click(finish);

    await waitFor(() => expect(mocks.saveQuizPartProgress).toHaveBeenLastCalledWith(
      'test-token',
      'CSC101',
      '7',
      0,
      {
        mode: 'review',
        responses: [
          { id: 'q1', response: 'Đáp án A' },
          { id: 'q2', response: 'Đáp án D' }
        ],
        completed: true
      }
    ));

    expect(await screen.findByText('Đã hoàn thành ôn tập 2/2')).toBeInTheDocument();
    const resultHeading = screen.getByRole('heading', { name: 'Đã hoàn thành ôn tập 2/2' });
    await waitFor(() => expect(resultHeading).toHaveFocus());
    expect(screen.getByText('1/2 câu đúng')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ôn tập lại' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Về môn' })).toBeInTheDocument();
    expect(screen.queryByText(/Cao nhất/)).not.toBeInTheDocument();
  });

  it('resumes at the first unanswered question', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    mocks.getQuizPart.mockResolvedValue(makePartData({
      progress: {
        answered: 1,
        total_count: 2,
        completed_at: null,
        responses: [{ id: 'q1', response: 'Đáp án A', correct: true }]
      }
    }));

    renderPartPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Làm tiếp' }));

    expect(await screen.findByText('Câu hỏi số 2?')).toBeInTheDocument();
    expect(screen.getByText('Câu 2/2')).toBeInTheDocument();
    expect(screen.queryByText('Câu hỏi số 1?')).not.toBeInTheDocument();
  });

  it('shuffles questions/options deterministically and resumes stored responses by id', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    mocks.getQuizPart.mockResolvedValue(makePartData({
      progress: {
        answered: 1,
        total_count: 2,
        completed_at: null,
        responses: [{ id: 'q1', response: 'Đáp án A', correct: true }]
      }
    }));
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: null, restarted: false, completed_at: null });

    renderPartPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Làm tiếp' }));

    // () => 0 reverses both lists: [q1,q2] -> [q2,q1] and options [C,D] -> [D,C].
    expect(await screen.findByText('Câu hỏi số 2?')).toBeInTheDocument();
    expect(screen.queryByText('Câu hỏi số 1?')).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((option) => option.getAttribute('aria-label')))
      .toEqual(['Đáp án D', 'Đáp án C']);
    // q1 is already stored as answered: the resumed question must still be q2
    // at shuffled index 0, proving responses map by id and not by position.
    expect(screen.getByText('Câu 1/2')).toBeInTheDocument();
  });

  it('shows completed review progress on the landing and restarts with restart:true', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const completed = makePartData({
      progress: {
        answered: 2,
        total_count: 2,
        completed_at: '2026-10-19T00:00:00Z',
        responses: [
          { id: 'q1', response: 'Đáp án A', correct: true },
          { id: 'q2', response: 'Đáp án D', correct: false }
        ]
      }
    });
    const reset = makePartData();
    mocks.getQuizPart
      .mockResolvedValueOnce(completed)
      .mockResolvedValueOnce(reset);
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: null, restarted: true, completed_at: null });

    renderPartPage();

    expect(await screen.findByText('Đã làm 2/2')).toBeInTheDocument();
    expect(screen.getByText('Đã hoàn thành')).toBeInTheDocument();
    expect(screen.queryByText(/Cao nhất/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ôn tập lại' }));

    await waitFor(() => expect(mocks.startQuizPart).toHaveBeenCalledWith('test-token', 'CSC101', '7', 0, {
      mode: 'review',
      restart: true
    }));
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();
  });

  it('renders a not-found branch for an invalid mode without querying', async () => {
    renderPartPage('/learning/CSC101/quiz-sets/7/parts/0/bogus');

    expect(await screen.findByText('Không tìm thấy phần của bộ đề này.')).toBeInTheDocument();
    expect(mocks.getQuizPart).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Về môn' }));
    expect(await screen.findByText('Không gian môn')).toBeInTheDocument();
  });

  it('renders the error branch with a back link when the part is missing', async () => {
    mocks.getQuizPart.mockRejectedValue(Object.assign(new Error('Không tìm thấy bộ đề.'), { status: 404 }));

    renderPartPage();

    expect(await screen.findByText('Không tìm thấy phần của bộ đề này.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Về môn' }));
    expect(await screen.findByText('Không gian môn')).toBeInTheDocument();
  });
});

describe('QuizSetPartPage test mode landing', () => {
  it('shows test meta and starts with mode test', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    mocks.getQuizPart.mockResolvedValue(makePartData({
      part: { index: 0, question_count: 2, time_limit_seconds: 1800 },
      progress: {
        answered: 0,
        total_count: 2,
        completed_at: null,
        best_correct: 1,
        best_total: 2,
        attempts: 3,
        responses: []
      }
    }));
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: 1800, restarted: false, completed_at: null });

    renderPartPage('/learning/CSC101/quiz-sets/7/parts/0/test');

    expect(await screen.findByRole('heading', { name: 'Ôn tập Chương 1' })).toBeInTheDocument();
    expect(screen.getByText('Phần 1 · Kiểm tra')).toBeInTheDocument();
    expect(screen.getByText('30 phút')).toBeInTheDocument();
    expect(screen.getByText('Cao nhất 1/2')).toBeInTheDocument();
    expect(screen.getByText('3 lượt')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Làm tiếp' }));

    await waitFor(() => expect(mocks.startQuizPart).toHaveBeenCalledWith('test-token', 'CSC101', '7', 0, {
      mode: 'test',
      restart: false
    }));
    // The interim notice is replaced by the test runner: timer, palette, no feedback.
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();
    expect(screen.getByText('Câu 1/2')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('30:00');
    expect(screen.getByRole('button', { name: 'Câu 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Câu 2' })).toBeInTheDocument();
  });
});

function makeTestPartData(overrides = {}) {
  return makePartData({
    part: { index: 0, question_count: 2, time_limit_seconds: 1800 },
    questions: [
      { id: 'q1', question: 'Câu hỏi số 1?', options: ['Đáp án A', 'Đáp án B'] },
      { id: 'q2', question: 'Câu hỏi số 2?', options: ['Đáp án C', 'Đáp án D'] }
    ],
    ...overrides
  });
}

function renderTestPartPage() {
  return renderPartPage('/learning/CSC101/quiz-sets/7/parts/0/test');
}

function completedTestPartData({ answered = 2, correctCount = 2, bestCorrect = 2, attempts = 1 } = {}) {
  return makeTestPartData({
    progress: {
      answered,
      total_count: 2,
      completed_at: '2026-10-20T00:00:00Z',
      best_correct: bestCorrect,
      best_total: 2,
      attempts,
      responses: answered > 1
        ? [
          { id: 'q1', response: 'Đáp án A', correct: true },
          { id: 'q2', response: 'Đáp án D', correct: correctCount > 1 }
        ]
        : answered > 0
          ? [{ id: 'q1', response: 'Đáp án A', correct: true }]
          : []
    },
    review: [
      { id: 'q1', correct: 'Đáp án A', explanation: 'Giải thích câu 1.' },
      { id: 'q2', correct: 'Đáp án D', explanation: 'Giải thích câu 2.' }
    ]
  });
}

describe('QuizSetPartPage test mode runner', () => {
  it('selects and changes answers with no feedback and no correctness leak', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    mocks.getQuizPart.mockResolvedValue(makeTestPartData());
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: 1800, restarted: false, completed_at: null });
    mocks.saveQuizPartProgress.mockResolvedValue({ answered: 1, total_count: 2, completed_at: null });

    renderTestPartPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu kiểm tra' }));
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án A' }));
    expect(screen.getByRole('radio', { name: 'Đáp án A' })).toHaveAttribute('aria-checked', 'true');

    // No immediate feedback and no answer key leak before completion.
    expect(screen.queryByText('Chính xác!')).not.toBeInTheDocument();
    expect(screen.queryByText('Chưa chính xác.')).not.toBeInTheDocument();
    expect(screen.queryByText('Đáp án đúng: Đáp án A')).not.toBeInTheDocument();
    expect(screen.queryByText('Giải thích câu 1.')).not.toBeInTheDocument();

    // The selection can still be changed before submit.
    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án B' }));
    expect(screen.getByRole('radio', { name: 'Đáp án B' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('Đáp án đúng: Đáp án B')).not.toBeInTheDocument();
  });

  it('navigates prev/next, marks the palette answered and autosaves the latest answers', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    mocks.getQuizPart.mockResolvedValue(makeTestPartData());
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: 1800, restarted: false, completed_at: null });
    mocks.saveQuizPartProgress.mockResolvedValue({ answered: 1, total_count: 2, completed_at: null });

    renderTestPartPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu kiểm tra' }));
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Câu trước' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án A' }));
    // Change before navigating: only the latest answer may be autosaved.
    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp' }));

    expect(await screen.findByText('Câu hỏi số 2?')).toBeInTheDocument();
    await waitFor(() => expect(mocks.saveQuizPartProgress).toHaveBeenCalledWith(
      'test-token',
      'CSC101',
      '7',
      0,
      { mode: 'test', responses: [{ id: 'q1', response: 'Đáp án B' }], completed: false }
    ));
    // Autosaved payloads never carry a correctness flag before completion.
    for (const call of mocks.saveQuizPartProgress.mock.calls) {
      expect(call[4].mode).toBe('test');
      for (const entry of call[4].responses) expect(entry).not.toHaveProperty('correct');
    }

    expect(screen.getByRole('button', { name: 'Câu 1' }).className).toMatch(/is-answered/);
    expect(screen.getByRole('button', { name: 'Câu 2' }).className).toMatch(/is-current/);
    expect(screen.getByRole('button', { name: 'Câu tiếp' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Câu 1' }));
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Đáp án B' })).toHaveAttribute('aria-checked', 'true');
  });

  it('disables empty submit, confirms a partial submit and shows score/best/attempts/review', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    let partData = makeTestPartData();
    mocks.getQuizPart.mockImplementation(() => Promise.resolve(partData));
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: 1800, restarted: false, completed_at: null });
    mocks.saveQuizPartProgress.mockImplementation((token, code, setId, partIndex, payload) => Promise.resolve({
      answered: payload.responses.length,
      total_count: 2,
      completed_at: payload.completed ? '2026-10-20T00:00:00Z' : null,
      best_correct: payload.completed ? 1 : null,
      best_total: payload.completed ? 2 : null,
      attempts: payload.completed ? 1 : 0,
      correct_count: payload.completed ? 1 : undefined,
      responses: payload.responses.map((entry) => ({ ...entry, correct: entry.id === 'q1' }))
    }));

    renderTestPartPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu kiểm tra' }));
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Nộp bài' })).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án A' }));
    const submit = await screen.findByRole('button', { name: 'Nộp bài' });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    const dialog = await screen.findByRole('alertdialog', { name: 'Nộp bài?' });
    expect(within(dialog).getByText(/Còn 1 câu chưa làm/)).toBeInTheDocument();
    partData = completedTestPartData({ answered: 1, correctCount: 1, bestCorrect: 1, attempts: 1 });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Nộp bài' }));

    await waitFor(() => expect(mocks.saveQuizPartProgress).toHaveBeenCalledWith(
      'test-token',
      'CSC101',
      '7',
      0,
      { mode: 'test', responses: [{ id: 'q1', response: 'Đáp án A' }], completed: true }
    ));

    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(screen.getByText('1/2 câu đúng')).toBeInTheDocument();
    expect(screen.getByText('Cao nhất 1/2')).toBeInTheDocument();
    expect(screen.getByText('1 lượt làm')).toBeInTheDocument();
    expect(screen.getByText('Đáp án đúng: Đáp án A')).toBeInTheDocument();
    expect(screen.getByText('Giải thích câu 1.')).toBeInTheDocument();
    expect(screen.getByText('Chưa trả lời')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Làm lại' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Về môn' })).toBeInTheDocument();
  });

  it('submits all answers directly and shows the full score', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    let partData = makeTestPartData();
    mocks.getQuizPart.mockImplementation(() => Promise.resolve(partData));
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: 1800, restarted: false, completed_at: null });
    mocks.saveQuizPartProgress.mockImplementation((token, code, setId, partIndex, payload) => Promise.resolve({
      answered: payload.responses.length,
      total_count: 2,
      completed_at: payload.completed ? '2026-10-20T00:00:00Z' : null,
      best_correct: payload.completed ? 2 : null,
      best_total: payload.completed ? 2 : null,
      attempts: payload.completed ? 1 : 0,
      correct_count: payload.completed ? 2 : undefined,
      responses: payload.responses.map((entry) => ({ ...entry, correct: true }))
    }));

    renderTestPartPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu kiểm tra' }));
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp' }));
    expect(await screen.findByText('Câu hỏi số 2?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án D' }));

    partData = completedTestPartData();
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bài' }));

    await waitFor(() => expect(mocks.saveQuizPartProgress).toHaveBeenCalledWith(
      'test-token',
      'CSC101',
      '7',
      0,
      {
        mode: 'test',
        responses: [
          { id: 'q1', response: 'Đáp án A' },
          { id: 'q2', response: 'Đáp án D' }
        ],
        completed: true
      }
    ));

    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(screen.getByText('2/2 câu đúng')).toBeInTheDocument();
    expect(screen.getByText('Cao nhất 2/2')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('disables the breadcrumb and footer exit while a finalize is in flight', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    mocks.getQuizPart.mockResolvedValue(makeTestPartData());
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: 1800, restarted: false, completed_at: null });
    let releaseSave = null;
    mocks.saveQuizPartProgress.mockImplementation((token, code, setId, partIndex, payload) => {
      if (payload?.completed) {
        // Finalization never resolves until the test releases it: the runner
        // stays locked ('finishing') in the meantime.
        return new Promise((resolve) => { releaseSave = resolve; });
      }
      return Promise.resolve({ answered: 1, total_count: 2, completed_at: null });
    });

    renderTestPartPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu kiểm tra' }));
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp' }));
    expect(await screen.findByText('Câu hỏi số 2?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án D' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bài' }));

    await waitFor(() => expect(mocks.saveQuizPartProgress).toHaveBeenCalledWith(
      'test-token', 'CSC101', '7', 0,
      expect.objectContaining({ completed: true })
    ));

    // Both exit paths stay inert until the result has mounted.
    expect(screen.getByText('Kho Tài Liệu')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Đang nộp...' })).toBeInTheDocument();
    // Clicking the disabled exit must not leave the runner or refetch.
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect(screen.getByText('Câu hỏi số 2?')).toBeInTheDocument();

    releaseSave({
      answered: 2, total_count: 2, completed_at: '2026-10-20T00:00:00Z',
      best_correct: 2, best_total: 2, attempts: 1, correct_count: 2,
      responses: [
        { id: 'q1', response: 'Đáp án A' }, { id: 'q2', response: 'Đáp án D' }
      ]
    });

    expect(await screen.findByText('100%')).toBeInTheDocument();
    // Exits are re-enabled once the result is mounted.
    expect(screen.getByText('Kho Tài Liệu')).toBeEnabled();
  });

  it('auto-submits an empty payload on timeout and retries after a save failure', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    let partData = makeTestPartData();
    let timeoutSaveFailed = false;
    mocks.getQuizPart.mockImplementation(() => Promise.resolve(partData));
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: 1, restarted: false, completed_at: null });
    mocks.saveQuizPartProgress.mockImplementation((token, code, setId, partIndex, payload) => {
      // Only the first timeout finalize fails; autosaves and the retry succeed.
      if (payload?.completed && !timeoutSaveFailed) {
        timeoutSaveFailed = true;
        return Promise.reject(new Error('Lỗi mạng.'));
      }
      return Promise.resolve({
        answered: payload?.completed ? 0 : payload.responses.length,
        total_count: 2,
        completed_at: payload?.completed ? '2026-10-20T00:00:00Z' : null,
        best_correct: payload?.completed ? 0 : null,
        best_total: payload?.completed ? 2 : null,
        attempts: payload?.completed ? 1 : 0,
        correct_count: payload?.completed ? 0 : undefined,
        responses: payload?.completed ? [] : payload.responses
      });
    });

    renderTestPartPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu kiểm tra' }));
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án A' }));

    // The deadline discards in-flight selections: the timeout payload is empty.
    await waitFor(() => {
      const completedCalls = mocks.saveQuizPartProgress.mock.calls.filter((call) => call[4]?.completed === true);
      expect(completedCalls).toHaveLength(1);
      expect(completedCalls[0][4]).toEqual({ mode: 'test', responses: [], completed: true });
    }, { timeout: 5000 });

    expect(await screen.findByText('Đã hết thời gian làm bài.')).toBeInTheDocument();
    expect(await screen.findByText('Chưa lưu được kết quả. Vui lòng thử lại.')).toBeInTheDocument();

    partData = completedTestPartData({ answered: 0, correctCount: 0, bestCorrect: 0, attempts: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Thử lưu kết quả lại' }));

    await waitFor(() => {
      const completedCalls = mocks.saveQuizPartProgress.mock.calls.filter((call) => call[4]?.completed === true);
      expect(completedCalls).toHaveLength(2);
    }, { timeout: 5000 });
    expect(await screen.findByText('0/2 câu đúng')).toBeInTheDocument();
  });

  it('resumes an in-progress test at the first unanswered question', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    mocks.getQuizPart.mockResolvedValue(makeTestPartData({
      progress: {
        answered: 1,
        total_count: 2,
        completed_at: null,
        best_correct: null,
        best_total: null,
        attempts: 0,
        responses: [{ id: 'q1', response: 'Đáp án A' }]
      }
    }));
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: 1700, restarted: false, completed_at: null });
    mocks.saveQuizPartProgress.mockResolvedValue({ answered: 1, total_count: 2, completed_at: null });

    renderTestPartPage();
    expect(await screen.findByRole('button', { name: 'Làm tiếp' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Làm tiếp' }));

    expect(await screen.findByText('Câu hỏi số 2?')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('28:20');
    fireEvent.click(screen.getByRole('button', { name: 'Câu 1' }));
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Đáp án A' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('Đáp án đúng: Đáp án A')).not.toBeInTheDocument();
  });

  it('restarts a completed test with restart:true and opens a fresh runner', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const completed = completedTestPartData({ answered: 2, correctCount: 2, bestCorrect: 2, attempts: 2 });
    mocks.getQuizPart
      .mockResolvedValueOnce(completed)
      .mockResolvedValue(makeTestPartData());
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: 1800, restarted: true, completed_at: null });
    mocks.saveQuizPartProgress.mockResolvedValue({ answered: 0, total_count: 2, completed_at: null });

    renderTestPartPage();
    expect(await screen.findByText('Cao nhất 2/2')).toBeInTheDocument();
    expect(screen.getByText('2 lượt')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Làm lại' }));

    await waitFor(() => expect(mocks.startQuizPart).toHaveBeenCalledWith('test-token', 'CSC101', '7', 0, {
      mode: 'test',
      restart: true
    }));
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Đáp án A' })).toHaveAttribute('aria-checked', 'false');
  });

  it('renders the error branch with a back link when the test part is missing', async () => {
    mocks.getQuizPart.mockRejectedValue(Object.assign(new Error('Không tìm thấy bộ đề.'), { status: 404 }));

    renderTestPartPage();

    expect(await screen.findByText('Không tìm thấy phần của bộ đề này.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Về môn' }));
    expect(await screen.findByText('Không gian môn')).toBeInTheDocument();
  });

  it('flushes the latest selection on unmount before the debounce fires', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    mocks.getQuizPart.mockResolvedValue(makeTestPartData());
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: 1800, restarted: false, completed_at: null });
    mocks.saveQuizPartProgress.mockResolvedValue({ answered: 1, total_count: 2, completed_at: null });

    renderTestPartPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu kiểm tra' }));
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án A' }));
    // Leave via the breadcrumb before the 500 ms debounce fires: the unmount
    // cleanup must persist the latest selection instead of dropping it.
    fireEvent.click(screen.getByText('Kho Tài Liệu'));

    expect(await screen.findByText('Không gian môn')).toBeInTheDocument();
    expect(mocks.saveQuizPartProgress).toHaveBeenCalledTimes(1);
    expect(mocks.saveQuizPartProgress).toHaveBeenCalledWith(
      'test-token',
      'CSC101',
      '7',
      0,
      { mode: 'test', responses: [{ id: 'q1', response: 'Đáp án A' }], completed: false }
    );
  });

  it('waits for the flushed save before exiting so the landing refetch is fresh', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    mocks.getQuizPart.mockResolvedValue(makeTestPartData());
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: 1800, restarted: false, completed_at: null });
    let resolveSave = null;
    mocks.saveQuizPartProgress.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));

    renderTestPartPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu kiểm tra' }));
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();
    const callsBeforeExit = mocks.getQuizPart.mock.calls.length;

    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));

    // The save is still in flight: no exit refetch yet, still in the runner.
    expect(mocks.saveQuizPartProgress).toHaveBeenCalledWith(
      'test-token',
      'CSC101',
      '7',
      0,
      { mode: 'test', responses: [{ id: 'q1', response: 'Đáp án A' }], completed: false }
    );
    expect(mocks.getQuizPart.mock.calls.length).toBe(callsBeforeExit);
    expect(screen.getByText('Câu hỏi số 1?')).toBeInTheDocument();

    resolveSave({ answered: 1, total_count: 2, completed_at: null });
    await waitFor(() => expect(mocks.getQuizPart.mock.calls.length).toBe(callsBeforeExit + 1));
    expect(await screen.findByRole('button', { name: 'Bắt đầu kiểm tra' })).toBeInTheDocument();
  });

  it('retries a failed autosave on exit instead of dropping it', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    mocks.getQuizPart.mockResolvedValue(makeTestPartData());
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: 1800, restarted: false, completed_at: null });
    mocks.saveQuizPartProgress.mockRejectedValue(new Error('Lỗi mạng.'));

    renderTestPartPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu kiểm tra' }));
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án A' }));
    // The debounced autosave fails but the selection stays dirty for retry.
    expect(await screen.findByText('Chưa lưu được tiến độ, sẽ thử lại.', {}, { timeout: 3000 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quay lại' }));
    await waitFor(() => expect(mocks.saveQuizPartProgress).toHaveBeenCalledTimes(2));
    expect(mocks.saveQuizPartProgress.mock.calls[1][4]).toEqual(
      { mode: 'test', responses: [{ id: 'q1', response: 'Đáp án A' }], completed: false }
    );
    // Exit still proceeds; the landing shows the last committed state.
    expect(await screen.findByRole('button', { name: 'Bắt đầu kiểm tra' })).toBeInTheDocument();
  });

  it('falls back to an empty finalize when the server reports QUIZ_TIME_UP mid-submit', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    let partData = makeTestPartData();
    mocks.getQuizPart.mockImplementation(() => Promise.resolve(partData));
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: 1800, restarted: false, completed_at: null });
    mocks.saveQuizPartProgress.mockImplementation((token, code, setId, partIndex, payload) => {
      // The local timer was stale: the full submit is rejected after the deadline.
      if (payload?.completed && payload.responses.length > 0) {
        return Promise.reject(Object.assign(new Error('Đã hết giờ làm bài.'), { code: 'QUIZ_TIME_UP' }));
      }
      return Promise.resolve({
        answered: 0,
        total_count: 2,
        completed_at: payload?.completed ? '2026-10-20T00:00:00Z' : null,
        best_correct: payload?.completed ? 0 : null,
        best_total: payload?.completed ? 2 : null,
        attempts: payload?.completed ? 1 : 0,
        correct_count: payload?.completed ? 0 : undefined,
        responses: []
      });
    });

    renderTestPartPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu kiểm tra' }));
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp' }));
    expect(await screen.findByText('Câu hỏi số 2?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Đáp án D' }));

    partData = completedTestPartData({ answered: 0, correctCount: 0, bestCorrect: 0, attempts: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bài' }));

    await waitFor(() => {
      const completedCalls = mocks.saveQuizPartProgress.mock.calls.filter((call) => call[4]?.completed === true);
      expect(completedCalls).toHaveLength(2);
      expect(completedCalls[0][4]).toEqual({
        mode: 'test',
        responses: [
          { id: 'q1', response: 'Đáp án A' },
          { id: 'q2', response: 'Đáp án D' }
        ],
        completed: true
      });
      expect(completedCalls[1][4]).toEqual({ mode: 'test', responses: [], completed: true });
    }, { timeout: 5000 });
    expect(await screen.findByText('0/2 câu đúng')).toBeInTheDocument();
  });

  it('falls back to the part time limit when start omits remaining seconds', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    mocks.getQuizPart.mockResolvedValue(makeTestPartData());
    // No remaining_seconds in the start response: the runner counts down from
    // the part time limit instead of rendering without a timer.
    mocks.startQuizPart.mockResolvedValue({ restarted: false, completed_at: null });
    mocks.saveQuizPartProgress.mockResolvedValue({ answered: 0, total_count: 2, completed_at: null });

    renderTestPartPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu kiểm tra' }));
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('30:00');
  });

  it('shows continue for a started test with no answers yet', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    mocks.getQuizPart.mockResolvedValue(makeTestPartData({
      progress: {
        answered: 0,
        total_count: 2,
        completed_at: null,
        best_correct: null,
        best_total: null,
        attempts: 0,
        responses: []
      }
    }));
    mocks.startQuizPart.mockResolvedValue({ remaining_seconds: 1790, restarted: false, completed_at: null });
    mocks.saveQuizPartProgress.mockResolvedValue({ answered: 0, total_count: 2, completed_at: null });

    renderTestPartPage();
    // The attempt (and its timer) is already running: resume, don't restart.
    expect(await screen.findByRole('button', { name: 'Làm tiếp' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Làm tiếp' }));

    await waitFor(() => expect(mocks.startQuizPart).toHaveBeenCalledWith('test-token', 'CSC101', '7', 0, {
      mode: 'test',
      restart: false
    }));
    expect(await screen.findByText('Câu hỏi số 1?')).toBeInTheDocument();
  });
});
