import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuizComposerPanel from '../../client/src/features/learning/QuizComposerPanel.jsx';
import CourseLearningPage from '../../client/src/features/learning/CourseLearningPage.jsx';
import QuizRunner from '../../client/src/features/learning/QuizRunner.jsx';
import CourseQuizPage from '../../client/src/features/learning/CourseQuizPage.jsx';

const feedMocks = vi.hoisted(() => ({
  getCoursePosts: vi.fn(),
  getLearningResources: vi.fn(),
  createCoursePost: vi.fn(),
  deleteCoursePost: vi.fn(),
  toggleCoursePostLike: vi.fn(),
  getCoursePostComments: vi.fn(),
  addCoursePostComment: vi.fn(),
  notify: vi.fn(),
  canAccess: { value: true }
}));

const quizPageMocks = vi.hoisted(() => ({
  getCourseQuiz: vi.fn(),
  startCourseQuiz: vi.fn(),
  answerCourseQuiz: vi.fn(),
  saveCourseQuizProgress: vi.fn(),
  askConfirm: vi.fn()
}));

vi.mock('../../client/src/api/community.js', () => ({
  getCoursePosts: feedMocks.getCoursePosts,
  getLearningResources: feedMocks.getLearningResources,
  createCoursePost: feedMocks.createCoursePost,
  deleteCoursePost: feedMocks.deleteCoursePost,
  toggleCoursePostLike: feedMocks.toggleCoursePostLike,
  getCoursePostComments: feedMocks.getCoursePostComments,
  addCoursePostComment: feedMocks.addCoursePostComment,
  getCourseQuiz: quizPageMocks.getCourseQuiz,
  startCourseQuiz: quizPageMocks.startCourseQuiz,
  answerCourseQuiz: quizPageMocks.answerCourseQuiz,
  saveCourseQuizProgress: quizPageMocks.saveCourseQuizProgress
}));

vi.mock('../../client/src/features/ttcds/useTtcdsCapabilities.jsx', () => ({
  useTtcdsCapabilities: () => ({ data: { can_access: feedMocks.canAccess.value } })
}));

vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { mssv: '24050001', name: 'SV Test' } }),
  useRealtimeRoom: () => {},
  useToasts: () => ({ notify: feedMocks.notify })
}));

vi.mock('../../client/src/components/feedback/ConfirmDialog.jsx', () => ({
  useConfirm: () => [null, quizPageMocks.askConfirm]
}));

const VALID_JSON = JSON.stringify({
  schema: 'bdu-quiz/v1',
  title: 'Quiz mẫu',
  questions: [
    { question: '1 + 1 = ?', options: ['1', '2'], correct: 'B', explanation: '2' }
  ]
});

function Harness({ onValidQuiz, onInvalid = () => {} }) {
  const [text, setText] = useState('');
  return (
    <QuizComposerPanel
      text={text}
      onChangeText={setText}
      onValidQuiz={onValidQuiz}
      onInvalid={onInvalid}
    />
  );
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

it('validates pasted JSON and emits normalized quiz', async () => {
  vi.useFakeTimers();
  const onValidQuiz = vi.fn();
  render(<Harness onValidQuiz={onValidQuiz} />);

  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: VALID_JSON } });
  await act(async () => { vi.advanceTimersByTime(400); });

  expect(onValidQuiz).toHaveBeenCalledWith(expect.objectContaining({
    schema: 'bdu-quiz/v1',
    title: 'Quiz mẫu',
    questions: [expect.objectContaining({ id: 'q1', correct: 'B' })]
  }));
});

it('shows validation errors and does not emit a quiz', async () => {
  vi.useFakeTimers();
  const onValidQuiz = vi.fn();
  const onInvalid = vi.fn();
  render(<Harness onValidQuiz={onValidQuiz} onInvalid={onInvalid} />);

  fireEvent.change(screen.getByLabelText(/dán JSON/i), {
    target: { value: JSON.stringify({ schema: 'bdu-quiz/v1', questions: [{ question: 'x', options: ['a', 'b'], correct: 'D' }] }) }
  });
  await act(async () => { vi.advanceTimersByTime(400); });

  expect(screen.getByText(/Câu 1/)).toBeTruthy();
  expect(onValidQuiz).not.toHaveBeenCalled();
  expect(onInvalid).toHaveBeenCalled();
});

it('rejects files larger than 256KB before reading', async () => {
  const onInvalid = vi.fn();
  render(<Harness onValidQuiz={vi.fn()} onInvalid={onInvalid} />);
  const file = new File(['x'], 'big.json', { type: 'application/json' });
  Object.defineProperty(file, 'size', { value: 262145 });
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [file] } });
  expect(onInvalid).toHaveBeenCalled();
});

it('downloads template as Blob', async () => {
  const createObjectURL = vi.fn(() => 'blob:url');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  render(<Harness onValidQuiz={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /tải file mẫu/i }));
  expect(createObjectURL).toHaveBeenCalled();
  const blob = createObjectURL.mock.calls[0][0];
  expect(blob).toBeInstanceOf(Blob);
  vi.unstubAllGlobals();
});

it('shows preview with correct answer highlighted', async () => {
  vi.useFakeTimers();
  render(<Harness onValidQuiz={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: VALID_JSON } });
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(screen.getByText('1 + 1 = ?')).toBeTruthy();
  expect(screen.getAllByText('2').length).toBeGreaterThan(0);
});

it('calls onInvalid when editing after valid', async () => {
  vi.useFakeTimers();
  const onInvalid = vi.fn();
  render(<Harness onValidQuiz={vi.fn()} onInvalid={onInvalid} />);
  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: VALID_JSON } });
  await act(async () => { vi.advanceTimersByTime(400); });
  onInvalid.mockClear();
  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: VALID_JSON + ' ' } });
  expect(onInvalid).toHaveBeenCalled();
});

it('calls onInvalid when clearing after valid', async () => {
  vi.useFakeTimers();
  const onInvalid = vi.fn();
  render(<Harness onValidQuiz={vi.fn()} onInvalid={onInvalid} />);
  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: VALID_JSON } });
  await act(async () => { vi.advanceTimersByTime(400); });
  onInvalid.mockClear();
  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: '' } });
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(onInvalid).toHaveBeenCalled();
});

it('notifies onInvalid exactly once when editing valid to invalid', async () => {
  vi.useFakeTimers();
  const onInvalid = vi.fn();
  render(<Harness onValidQuiz={vi.fn()} onInvalid={onInvalid} />);
  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: VALID_JSON } });
  await act(async () => { vi.advanceTimersByTime(400); });
  onInvalid.mockClear();
  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: VALID_JSON + 'oops' } });
  // one more keystroke before debounce: should not spuriously notify due to stale valid state
  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: VALID_JSON + 'oopsx' } });
  expect(onInvalid).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(onInvalid).toHaveBeenCalledTimes(1);
});

it('file success path keeps valid state', async () => {
  const onValidQuiz = vi.fn();
  render(<Harness onValidQuiz={onValidQuiz} />);
  const file = new File([VALID_JSON], 'ok.json', { type: 'application/json' });
  const input = document.querySelector('input[type="file"]');
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
    await new Promise((r) => setTimeout(r, 0));
  });
  await new Promise((r) => setTimeout(r, 450));
  expect(onValidQuiz).toHaveBeenCalled();
});

describe('course feed quiz integration', () => {
  const FEED_QUIZ_JSON = JSON.stringify({
    schema: 'bdu-quiz/v1',
    title: 'Ôn tập Chương 1 — Cấu trúc dữ liệu',
    description: '10 câu trắc nghiệm nhanh.',
    timeLimitSeconds: 600,
    questions: [
      {
        question: 'Cấu trúc dữ liệu nào hoạt động theo nguyên tắc LIFO?',
        options: ['Hàng đợi', 'Ngăn xếp'],
        correct: 'B',
        explanation: 'Ngăn xếp (stack) là LIFO.'
      }
    ]
  });

  function quizPost(overrides = {}) {
    return {
      id: 101,
      kind: 'quiz',
      title: 'Ôn tập Chương 1',
      content: 'Mô tả ngắn',
      author: { name: 'Thầy TTCDS', mssv: '22050006' },
      like_count: 3,
      comment_count: 1,
      is_liked: false,
      is_mine: false,
      created_at: new Date(Date.now() - 3600_000).toISOString(),
      quiz: { question_count: 10, time_limit_seconds: 600, progress: null },
      ...overrides
    };
  }

  function renderCoursePage(entry = '/learning/INFO1203') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes><Route path="/learning/:courseCode" element={<CourseLearningPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  beforeEach(() => {
    feedMocks.canAccess.value = true;
    for (const key of Object.keys(feedMocks)) {
      if (typeof feedMocks[key] === 'function' && 'mockReset' in feedMocks[key]) feedMocks[key].mockReset();
    }
    feedMocks.getCoursePosts.mockResolvedValue({ posts: [] });
    feedMocks.getLearningResources.mockResolvedValue({
      courses: [{ code: 'INFO1203', display_code: 'INFO1203', name: 'Hệ thống thông minh', is_studying: true, semesters: [] }]
    });
    feedMocks.getCoursePostComments.mockResolvedValue({ comments: [] });
    feedMocks.createCoursePost.mockResolvedValue({ id: 999 });
    feedMocks.deleteCoursePost.mockResolvedValue({});
    feedMocks.toggleCoursePostLike.mockResolvedValue({});
    feedMocks.addCoursePostComment.mockResolvedValue({});
  });

  it('shows the quiz composer pill when ttcds can_access', async () => {
    feedMocks.canAccess.value = true;
    renderCoursePage();
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ tài liệu/ }));
    expect(await screen.findByRole('button', { name: /Tạo trắc nghiệm/ })).toBeTruthy();
  });

  it('hides the quiz composer pill without ttcds access', async () => {
    feedMocks.canAccess.value = false;
    renderCoursePage();
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ tài liệu/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Tạo trắc nghiệm/ })).toBeNull();
  });

  it('shows quiz filter, summary card and resume CTA', async () => {
    feedMocks.getCoursePosts.mockResolvedValue({
      posts: [quizPost({ quiz: { question_count: 10, time_limit_seconds: 600, progress: { answered: 3, correct_count: 2, best_correct: null, best_total: null, attempts: 0, completed_at: null } } })]
    });
    renderCoursePage();
    expect(await screen.findByRole('tab', { name: /Trắc nghiệm/ })).toBeTruthy();
    expect(await screen.findByText('Ôn tập Chương 1')).toBeTruthy();
    expect(screen.getByText(/10 câu/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Làm tiếp/ })).toBeTruthy();
  });

  it('shows result CTA when quiz is completed', async () => {
    feedMocks.getCoursePosts.mockResolvedValue({
      posts: [quizPost({ quiz: { question_count: 10, time_limit_seconds: 600, progress: { answered: 10, correct_count: 8, best_correct: 8, best_total: 10, attempts: 1, completed_at: '2026-10-20T10:00:00.000Z' } } })]
    });
    renderCoursePage();
    expect(await screen.findByRole('button', { name: /Xem kết quả/ })).toBeTruthy();
  });

  it('auto-fills title/description from quiz JSON and submits quiz payload without url', async () => {
    renderCoursePage();
    fireEvent.click(await screen.findByRole('button', { name: /Chia sẻ tài liệu/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Tạo trắc nghiệm/ }));

    const submitBtn = screen.getByRole('button', { name: /Đăng bài trắc nghiệm/ });
    expect(submitBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: FEED_QUIZ_JSON } });
    expect(await screen.findByDisplayValue('Ôn tập Chương 1 — Cấu trúc dữ liệu')).toBeTruthy();
    expect(await screen.findByDisplayValue('10 câu trắc nghiệm nhanh.')).toBeTruthy();

    await screen.findByRole('button', { name: /Đăng bài trắc nghiệm/ });
    const enabledSubmit = screen.getByRole('button', { name: /Đăng bài trắc nghiệm/ });
    expect(enabledSubmit).not.toBeDisabled();
    fireEvent.click(enabledSubmit);

    await act(async () => { await Promise.resolve(); });
    expect(feedMocks.createCoursePost).toHaveBeenCalledWith(
      'test-token', 'INFO1203', expect.objectContaining({ kind: 'quiz' })
    );
    const payload = feedMocks.createCoursePost.mock.calls[0][2];
    expect(payload.quiz.questions[0].id).toBe('q1');
    expect(payload).not.toHaveProperty('url');
  });

  it('search does not match text inside quiz questions', async () => {
    feedMocks.getCoursePosts.mockResolvedValue({ posts: [quizPost()] });
    renderCoursePage();
    expect(await screen.findByText('Ôn tập Chương 1')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Tìm kiếm bài viết/), { target: { value: 'LIFO' } });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('Ôn tập Chương 1')).toBeNull();
  });
});

describe('quiz runner', () => {
  async function flush() {
    await act(async () => { await Promise.resolve(); });
  }

  function runner(overrides = {}) {
    const props = {
      questions: [
        { id: 'q1', question: '1 + 1 = ?', options: ['1', '2'] },
        { id: 'q2', question: '2 + 2 = ?', options: ['3', '4'] }
      ],
      initialProgress: null,
      remainingSeconds: 600,
      onCheckAnswer: vi.fn().mockResolvedValue({
        correct: true,
        correct_option: 'B',
        explanation: '2',
        remaining_seconds: 590
      }),
      onSaveProgress: vi.fn().mockResolvedValue({ answered: 1 }),
      onComplete: vi.fn(),
      onExit: vi.fn(),
      ...overrides
    };
    return { props, ...render(<QuizRunner {...props} />) };
  }

  it('checks an answer, locks it, and saves progress', async () => {
    const onCheckAnswer = vi.fn().mockResolvedValue({
      correct: true, correct_option: 'B', explanation: '2', remaining_seconds: 590
    });
    const onSaveProgress = vi.fn().mockResolvedValue({ answered: 1 });
    const onComplete = vi.fn();

    render(<QuizRunner
      questions={[
        { id: 'q1', question: '1 + 1 = ?', options: ['1', '2'] },
        { id: 'q2', question: '2 + 2 = ?', options: ['3', '4'] }
      ]}
      initialProgress={null}
      remainingSeconds={600}
      onCheckAnswer={onCheckAnswer}
      onSaveProgress={onSaveProgress}
      onComplete={onComplete}
      onExit={() => {}}
    />);

    fireEvent.click(screen.getByRole('radio', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: /Kiểm tra đáp án/ }));
    await flush();

    expect(onCheckAnswer).toHaveBeenCalledWith('q1', 'B');
    expect(screen.getByText('Chính xác!')).toBeTruthy();
    expect(screen.getByRole('radio', { name: '1' })).toBeDisabled();
    expect(onSaveProgress).toHaveBeenCalledWith({
      responses: [{ id: 'q1', response: 'B' }],
      completed: false
    });
  });

  it('marks the wrong choice, shows the correct answer and explanation', async () => {
    const onCheckAnswer = vi.fn().mockResolvedValue({
      correct: false, correct_option: 'B', explanation: '2 là đáp án đúng.', remaining_seconds: 580
    });
    runner({ onCheckAnswer });

    fireEvent.click(screen.getByRole('radio', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: /Kiểm tra đáp án/ }));
    await flush();

    expect(screen.getByText('Chưa chính xác.')).toBeTruthy();
    expect(screen.getByText(/Đáp án đúng: B/)).toBeTruthy();
    expect(screen.getByText('2 là đáp án đúng.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: '1' })).toHaveClass('is-wrong');
    expect(screen.getByRole('radio', { name: '2' })).toHaveClass('is-correct');
    const feedback = screen.getByRole('status');
    expect(feedback.getAttribute('aria-live')).toBe('polite');
  });

  it('resumes at the first unanswered question', () => {
    runner({
      initialProgress: { responses: [{ id: 'q1', response: 'B', correct: true }] }
    });

    expect(screen.getByText('2 + 2 = ?')).toBeTruthy();
    expect(screen.queryByText('1 + 1 = ?')).toBeNull();
    expect(screen.getByText(/Câu 2\/2/)).toBeTruthy();
  });

  it('offers Hoàn tất bài làm when every question was already answered', async () => {
    const onSaveProgress = vi.fn().mockResolvedValue({ answered: 2, completed_at: '2026-10-20T10:00:00.000Z' });
    const onComplete = vi.fn();
    runner({
      onSaveProgress,
      onComplete,
      initialProgress: {
        responses: [
          { id: 'q1', response: 'B', correct: true },
          { id: 'q2', response: 'B', correct: true }
        ]
      }
    });

    expect(screen.queryByText('1 + 1 = ?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Hoàn tất bài làm/ }));
    await flush();

    expect(onSaveProgress).toHaveBeenCalledWith({
      responses: [
        { id: 'q1', response: 'B' },
        { id: 'q2', response: 'B' }
      ],
      completed: true
    });
    expect(onComplete).toHaveBeenCalledWith({ answered: 2, completed_at: '2026-10-20T10:00:00.000Z' });
  });

  it('finishes from the last question with completed:true', async () => {
    const onSaveProgress = vi.fn().mockResolvedValue({ answered: 2, correct_count: 2 });
    const onComplete = vi.fn();
    runner({ onSaveProgress, onComplete });

    fireEvent.click(screen.getByRole('radio', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: /Kiểm tra đáp án/ }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp' }));
    expect(screen.getByText('2 + 2 = ?')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: '4' }));
    fireEvent.click(screen.getByRole('button', { name: /Kiểm tra đáp án/ }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Xem kết quả' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await flush();

    expect(onSaveProgress).toHaveBeenLastCalledWith({
      responses: [
        { id: 'q1', response: 'B' },
        { id: 'q2', response: 'B' }
      ],
      completed: true
    });
    expect(onComplete).toHaveBeenCalledWith({ answered: 2, correct_count: 2 });
  });

  it('asks for confirmation before an early submit with unanswered questions', async () => {
    const onSaveProgress = vi.fn().mockResolvedValue({ answered: 1 });
    const onComplete = vi.fn();
    runner({ onSaveProgress, onComplete });

    fireEvent.click(screen.getByRole('radio', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: /Kiểm tra đáp án/ }));
    await flush();

    fireEvent.click(screen.getByRole('button', { name: 'Xem kết quả' }));
    expect(screen.getByText(/Còn 1 câu chưa làm, các câu đó sẽ tính sai\. Nộp bài\?/)).toBeTruthy();
    expect(onSaveProgress).not.toHaveBeenCalledWith(expect.objectContaining({ completed: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục làm' }));
    expect(screen.queryByText(/Còn 1 câu chưa làm/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Xem kết quả' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bài' }));
    await flush();

    expect(onSaveProgress).toHaveBeenCalledWith({
      responses: [{ id: 'q1', response: 'B' }],
      completed: true
    });
    expect(onComplete).toHaveBeenCalled();
  });

  it('traps interactions in the confirm dialog, restores focus, and never drops an answer', async () => {
    const onCheckAnswer = vi.fn().mockResolvedValue({
      correct: true, correct_option: 'B', explanation: '2', remaining_seconds: 590
    });
    const onSaveProgress = vi.fn().mockResolvedValue({ answered: 1 });
    const onComplete = vi.fn();
    runner({ onCheckAnswer, onSaveProgress, onComplete });

    fireEvent.click(screen.getByRole('radio', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: /Kiểm tra đáp án/ }));
    await flush();

    const trigger = screen.getByRole('button', { name: 'Xem kết quả' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('alertdialog', { name: 'Nộp bài?' });
    expect(dialog).toHaveFocus();
    expect(dialog.getAttribute('aria-describedby')).toBe('quiz-runner-confirm-count');
    expect(document.getElementById('quiz-runner-confirm-count').textContent)
      .toMatch(/Còn 1 câu chưa làm, các câu đó sẽ tính sai\. Nộp bài\?/);
    expect(screen.getByRole('button', { name: 'Câu tiếp' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xem kết quả' })).toBeDisabled();

    // No next question or answer can slip in behind the modal confirmation.
    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp' }));
    expect(screen.queryByText('2 + 2 = ?')).toBeNull();
    expect(onCheckAnswer).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục làm' }));
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bài' }));
    await flush();

    expect(onSaveProgress).toHaveBeenCalledTimes(2);
    expect(onSaveProgress).toHaveBeenLastCalledWith({
      responses: [{ id: 'q1', response: 'B' }],
      completed: true
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('falls back to an empty time-up finalize when manual submit gets QUIZ_TIME_UP', async () => {
    const onCheckAnswer = vi.fn().mockResolvedValue({
      correct: true, correct_option: 'B', explanation: '2', remaining_seconds: 590
    });
    const onSaveProgress = vi.fn()
      .mockResolvedValueOnce({ answered: 1 })
      .mockRejectedValueOnce(Object.assign(new Error('Hết giờ'), { code: 'QUIZ_TIME_UP' }))
      .mockResolvedValueOnce({ answered: 1, expired: true });
    const onComplete = vi.fn();
    runner({ onCheckAnswer, onSaveProgress, onComplete });

    fireEvent.click(screen.getByRole('radio', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: /Kiểm tra đáp án/ }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Xem kết quả' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bài' }));
    await flush();
    await flush();

    expect(onSaveProgress).toHaveBeenNthCalledWith(1, {
      responses: [{ id: 'q1', response: 'B' }],
      completed: false
    });
    expect(onSaveProgress).toHaveBeenNthCalledWith(2, {
      responses: [{ id: 'q1', response: 'B' }],
      completed: true
    });
    expect(onSaveProgress).toHaveBeenNthCalledWith(3, {
      responses: [],
      completed: true
    });
    expect(onComplete).toHaveBeenCalledWith({ answered: 1, expired: true });
    expect(screen.getByText('Đã hết thời gian làm bài.')).toBeTruthy();
  });

  it('hands an autosave QUIZ_TIME_UP rejection to the empty finalize path', async () => {
    const onCheckAnswer = vi.fn().mockResolvedValue({
      correct: true, correct_option: 'B', explanation: '2', remaining_seconds: 590
    });
    const onSaveProgress = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Hết giờ'), { code: 'QUIZ_TIME_UP' }))
      .mockResolvedValueOnce({ answered: 0, expired: true });
    const onComplete = vi.fn();
    runner({ onCheckAnswer, onSaveProgress, onComplete });

    fireEvent.click(screen.getByRole('radio', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: /Kiểm tra đáp án/ }));
    await flush();
    await flush();

    expect(onSaveProgress).toHaveBeenNthCalledWith(1, {
      responses: [{ id: 'q1', response: 'B' }],
      completed: false
    });
    expect(onSaveProgress).toHaveBeenNthCalledWith(2, {
      responses: [],
      completed: true
    });
    expect(onComplete).toHaveBeenCalledWith({ answered: 0, expired: true });
    expect(screen.queryByText(/Chưa lưu được tiến độ/)).toBeNull();
    expect(screen.getByText('Đã hết thời gian làm bài.')).toBeTruthy();
  });

  it('does not resend a completed save when onComplete throws', async () => {
    const onSaveProgress = vi.fn().mockResolvedValue({ answered: 1 });
    const onComplete = vi.fn(() => { throw new Error('navigation failed'); });
    runner({ onSaveProgress, onComplete });

    fireEvent.click(screen.getByRole('radio', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: /Kiểm tra đáp án/ }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Xem kết quả' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bài' }));
    await flush();

    expect(onSaveProgress).toHaveBeenCalledTimes(2);
    expect(onSaveProgress).toHaveBeenLastCalledWith({
      responses: [{ id: 'q1', response: 'B' }],
      completed: true
    });
    expect(screen.queryByText(/Chưa nộp được bài/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Thử lưu kết quả lại/ })).toBeNull();
  });

  it('calls onExit from the back action', () => {
    const onExit = vi.fn();
    runner({ onExit });

    fireEvent.click(screen.getByRole('button', { name: /Quay lại/ }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('finalizes with no new responses and calls onComplete when time runs out', async () => {
    vi.useFakeTimers();
    const onCheckAnswer = vi.fn();
    const onSaveProgress = vi.fn().mockResolvedValue({ answered: 0, completed_at: '2026-10-20T10:00:00.000Z' });
    const onComplete = vi.fn();
    runner({ remainingSeconds: 1, onCheckAnswer, onSaveProgress, onComplete });

    expect(screen.getByText('00:01')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1000); });
    await flush();

    expect(onSaveProgress).toHaveBeenCalledWith({ responses: [], completed: true });
    expect(onComplete).toHaveBeenCalled();
    expect(onCheckAnswer).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Kiểm tra đáp án/ })).toBeNull();
  });

  it('shows a retry action when finalizing after time up fails', async () => {
    vi.useFakeTimers();
    const onSaveProgress = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ answered: 0 });
    const onComplete = vi.fn();
    runner({ remainingSeconds: 1, onSaveProgress, onComplete });

    await act(async () => { vi.advanceTimersByTime(1000); });
    await flush();

    const retry = screen.getByRole('button', { name: /Thử lưu kết quả lại/ });
    fireEvent.click(retry);
    await flush();

    expect(onSaveProgress).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenCalled();
  });

  it('keeps working after an autosave failure and shows a banner', async () => {
    const onSaveProgress = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ answered: 1 });
    runner({ onSaveProgress });

    fireEvent.click(screen.getByRole('radio', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: /Kiểm tra đáp án/ }));
    await flush();

    expect(screen.getByText(/Chưa lưu được tiến độ, sẽ thử lại/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp' }));
    expect(screen.getByText('2 + 2 = ?')).toBeTruthy();
  });

  it('renders question markup as text, never as HTML', () => {
    const { container } = render(<QuizRunner
      questions={[{ id: 'q1', question: 'Chọn <script>alert(1)</script>', options: ['An toàn', 'Nguy hiểm'] }]}
      initialProgress={null}
      remainingSeconds={null}
      onCheckAnswer={vi.fn()}
      onSaveProgress={vi.fn()}
      onComplete={vi.fn()}
      onExit={() => {}}
    />);

    expect(screen.getByText('Chọn <script>alert(1)</script>')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
  });
});

describe('quiz page and result', () => {
  const QUESTIONS = [
    { id: 'q1', question: '1 + 1 = ?', options: ['1', '2'] },
    { id: 'q2', question: '2 + 2 = ?', options: ['3', '4'] }
  ];

  function pagePayload(quizOverrides = {}) {
    return {
      course: { code: 'INFO1203', display_code: 'INFO1203', name: 'Hệ thống thông minh' },
      post: {
        id: 101,
        title: 'Ôn tập Chương 1',
        content: 'Mô tả ngắn',
        author: { name: 'Thầy TTCDS', mssv: '22050006' }
      },
      quiz: {
        question_count: 2,
        time_limit_seconds: 600,
        questions: QUESTIONS,
        progress: null,
        remaining_seconds: 600,
        expired: false,
        review: null,
        ...quizOverrides
      }
    };
  }

  function inProgress(overrides = {}) {
    return {
      started_at: '2026-10-20T10:00:00.000Z',
      answered: 1,
      correct_count: 1,
      total_count: 1,
      best_correct: null,
      best_total: null,
      attempts: 0,
      completed_at: null,
      responses: [{ id: 'q1', response: 'B', correct: true }],
      ...overrides
    };
  }

  function completed(overrides = {}) {
    return {
      started_at: '2026-10-20T10:00:00.000Z',
      answered: 1,
      correct_count: 1,
      total_count: 2,
      best_correct: 1,
      best_total: 2,
      attempts: 1,
      completed_at: '2026-10-20T10:05:00.000Z',
      responses: [{ id: 'q1', response: 'B', correct: true }],
      ...overrides
    };
  }

  function completedReview() {
    return [
      { id: 'q1', correct: 'B', explanation: 'Vì 1 + 1 = 2.' },
      { id: 'q2', correct: 'B', explanation: 'Vì 2 + 2 = 4.' }
    ];
  }

  function renderQuizPage(entry = '/learning/INFO1203/quiz/101') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/learning/:courseCode/quiz/:postId" element={<CourseQuizPage />} />
            <Route path="/learning/:courseCode" element={<div>Không gian môn học</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  async function flush() {
    await act(async () => { await Promise.resolve(); });
  }

  beforeEach(() => {
    for (const key of ['getCourseQuiz', 'startCourseQuiz', 'answerCourseQuiz', 'saveCourseQuizProgress']) {
      quizPageMocks[key].mockReset();
    }
    quizPageMocks.askConfirm.mockReset();
    quizPageMocks.askConfirm.mockResolvedValue(true);
    quizPageMocks.startCourseQuiz.mockResolvedValue({
      started_at: '2026-10-20T10:00:00.000Z',
      remaining_seconds: 600,
      expired: false,
      restarted: false,
      completed_at: null
    });
  });

  it('shows the landing breadcrumb and starts the quiz into the runner', async () => {
    quizPageMocks.getCourseQuiz.mockResolvedValue(pagePayload());
    renderQuizPage();

    expect(await screen.findByText('Ôn tập Chương 1')).toBeTruthy();
    expect(screen.getByText(/Kho Tài Liệu/)).toBeTruthy();
    expect(screen.getByText('Trắc nghiệm')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Bắt đầu làm bài/ }));
    expect(await screen.findByText('1 + 1 = ?')).toBeTruthy();
    expect(quizPageMocks.startCourseQuiz).toHaveBeenCalledWith('test-token', 'INFO1203', '101', { restart: false });
  });

  it('shows the result with score, best, attempts and review', async () => {
    quizPageMocks.getCourseQuiz.mockResolvedValue(pagePayload({
      progress: completed(),
      review: completedReview(),
      remaining_seconds: 0
    }));
    renderQuizPage();

    expect(await screen.findByText('1/2')).toBeTruthy();
    expect(screen.getByText(/Cao nhất 1\/2/)).toBeTruthy();
    expect(screen.getByText(/1 lượt làm/)).toBeTruthy();
    expect(screen.getByText('Vì 1 + 1 = 2.')).toBeTruthy();
    expect(screen.getByText('2 + 2 = ?')).toBeTruthy();
    expect(screen.getByText('Chưa trả lời')).toBeTruthy();
    expect(screen.getAllByText(/Đáp án đúng: B/)).toHaveLength(2);
  });

  it('shows resume actions for an in-progress quiz', async () => {
    quizPageMocks.getCourseQuiz.mockResolvedValue(pagePayload({
      progress: inProgress(),
      remaining_seconds: 540
    }));
    renderQuizPage();

    expect(await screen.findByText(/Đã làm 1\/2/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Làm tiếp/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Làm lại từ đầu/ })).toBeTruthy();
  });

  it('restart calls start with restart:true and remounts the runner', async () => {
    const reset = {
      started_at: '2026-10-20T11:00:00.000Z',
      answered: 0,
      correct_count: 0,
      total_count: 0,
      best_correct: null,
      best_total: null,
      attempts: 0,
      completed_at: null,
      responses: []
    };
    quizPageMocks.getCourseQuiz
      .mockResolvedValueOnce(pagePayload({ progress: inProgress(), remaining_seconds: 540 }))
      .mockResolvedValue(pagePayload({ progress: reset, remaining_seconds: 600 }));
    quizPageMocks.startCourseQuiz.mockResolvedValue({
      started_at: '2026-10-20T11:00:00.000Z',
      remaining_seconds: 600,
      expired: false,
      restarted: true,
      completed_at: null
    });
    renderQuizPage();

    fireEvent.click(await screen.findByRole('button', { name: /Làm lại từ đầu/ }));
    expect(await screen.findByText('1 + 1 = ?')).toBeTruthy();
    expect(quizPageMocks.askConfirm).toHaveBeenCalled();
    expect(quizPageMocks.startCourseQuiz).toHaveBeenCalledWith('test-token', 'INFO1203', '101', { restart: true });
  });

  it('navigates back to the course space', async () => {
    quizPageMocks.getCourseQuiz.mockResolvedValue(pagePayload());
    renderQuizPage();

    fireEvent.click(await screen.findByRole('button', { name: /Về không gian môn/ }));
    expect(await screen.findByText('Không gian môn học')).toBeTruthy();
  });

  it('shows an error with a back action on 404', async () => {
    quizPageMocks.getCourseQuiz.mockRejectedValue(
      Object.assign(new Error('Không tìm thấy bài trắc nghiệm trong môn học này.'), { status: 404 })
    );
    renderQuizPage();

    expect(await screen.findByText(/Không tìm thấy bài trắc nghiệm/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Về không gian môn/ }));
    expect(await screen.findByText('Không gian môn học')).toBeTruthy();
  });

  it('visibilitychange refetches and switches to the result when completed', async () => {
    quizPageMocks.getCourseQuiz
      .mockResolvedValueOnce(pagePayload({ progress: inProgress(), remaining_seconds: 540 }))
      .mockResolvedValue(pagePayload({ progress: completed(), review: completedReview(), remaining_seconds: 0 }));
    renderQuizPage();

    expect(await screen.findByRole('button', { name: /Làm tiếp/ })).toBeTruthy();
    expect(quizPageMocks.getCourseQuiz).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event('visibilitychange'));
    expect(await screen.findByText('1/2')).toBeTruthy();
    expect(quizPageMocks.getCourseQuiz).toHaveBeenCalledTimes(2);
  });

  it('runs the full flow from start to result through the runner', async () => {
    const fresh = {
      started_at: '2026-10-20T10:00:00.000Z',
      answered: 0,
      correct_count: 0,
      total_count: 0,
      best_correct: null,
      best_total: null,
      attempts: 0,
      completed_at: null,
      responses: []
    };
    quizPageMocks.getCourseQuiz
      .mockResolvedValueOnce(pagePayload())
      .mockResolvedValueOnce(pagePayload({ progress: fresh, remaining_seconds: 600 }))
      .mockResolvedValue(pagePayload({ progress: completed(), review: completedReview(), remaining_seconds: 0 }));
    quizPageMocks.answerCourseQuiz.mockResolvedValue({
      correct: true,
      correct_option: 'B',
      explanation: 'Chính xác.',
      remaining_seconds: 590
    });
    quizPageMocks.saveCourseQuizProgress.mockResolvedValue({ answered: 1, correct_count: 1 });
    renderQuizPage();

    fireEvent.click(await screen.findByRole('button', { name: /Bắt đầu làm bài/ }));
    await screen.findByText('1 + 1 = ?');

    fireEvent.click(screen.getByRole('radio', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: /Kiểm tra đáp án/ }));
    await screen.findByText('Chính xác!');
    fireEvent.click(screen.getByRole('button', { name: 'Câu tiếp' }));

    fireEvent.click(screen.getByRole('radio', { name: '4' }));
    fireEvent.click(screen.getByRole('button', { name: /Kiểm tra đáp án/ }));
    await screen.findByText('Chính xác!');
    fireEvent.click(screen.getByRole('button', { name: 'Xem kết quả' }));

    expect(await screen.findByText('1/2')).toBeTruthy();
    expect(quizPageMocks.answerCourseQuiz).toHaveBeenCalledWith(
      'test-token', 'INFO1203', '101', { questionId: 'q1', response: 'B' }
    );
    expect(quizPageMocks.saveCourseQuizProgress).toHaveBeenLastCalledWith(
      'test-token', 'INFO1203', '101', expect.objectContaining({ completed: true })
    );
  });
});
