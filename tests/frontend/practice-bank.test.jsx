import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPracticeBankSummary: vi.fn(),
  getPracticeBankQuestions: vi.fn(),
  answerPracticeQuestion: vi.fn(),
  togglePracticeBookmark: vi.fn(),
  startPracticeMockExam: vi.fn(),
  submitPracticeMockExam: vi.fn(),
  resetPracticeProgress: vi.fn(),
  notify: vi.fn()
}));

vi.mock('../../client/src/api/practice-bank.js', () => ({
  getPracticeBankSummary: mocks.getPracticeBankSummary,
  getPracticeBankQuestions: mocks.getPracticeBankQuestions,
  answerPracticeQuestion: mocks.answerPracticeQuestion,
  togglePracticeBookmark: mocks.togglePracticeBookmark,
  startPracticeMockExam: mocks.startPracticeMockExam,
  submitPracticeMockExam: mocks.submitPracticeMockExam,
  resetPracticeProgress: mocks.resetPracticeProgress
}));

vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { mssv: '24050001', name: 'Sinh viên kiểm thử' } }),
  useToasts: () => ({ notify: mocks.notify })
}));

vi.mock('../../client/src/components/feedback/ConfirmDialog.jsx', () => ({
  useConfirm: () => [null, async () => true]
}));

import PracticeBankEntryCard from '../../client/src/features/learning/practice-bank/PracticeBankEntryCard.jsx';
import PracticeBankPage from '../../client/src/features/learning/practice-bank/PracticeBankPage.jsx';

function makeSummary(overrides = {}) {
  return {
    enabled: true,
    bank: {
      id: '1',
      course_code: 'INF0983',
      title: 'Ngân hàng 300 câu hỏi trắc nghiệm Nhập môn Khoa học Dữ liệu',
      description: 'Ôn tập 6 chương kèm giải thích chi tiết.',
      question_count: 300
    },
    stats: {
      total_questions: 300,
      answered_count: 45,
      correct_count: 36,
      wrong_count: 9,
      bookmarked_count: 4,
      accuracy_percent: 80,
      completion_percent: 15
    },
    chapters: [
      { chapter_index: 1, chapter_title: 'Chương 1: Tổng quan về Khoa học Dữ liệu', total: 50, answered: 20, correct: 18, wrong: 2, bookmarked: 2, accuracy_percent: 90, completion_percent: 40 },
      { chapter_index: 2, chapter_title: 'Chương 2: Cơ sở dữ liệu và Thu thập', total: 50, answered: 15, correct: 10, wrong: 5, bookmarked: 1, accuracy_percent: 67, completion_percent: 30 },
      { chapter_index: 3, chapter_title: 'Chương 3: Tiền xử lý Dữ liệu', total: 50, answered: 10, correct: 8, wrong: 2, bookmarked: 1, accuracy_percent: 80, completion_percent: 20 },
      { chapter_index: 4, chapter_title: 'Chương 4: Mô hình Thuật toán và Học máy', total: 50, answered: 0, correct: 0, wrong: 0, bookmarked: 0, accuracy_percent: 0, completion_percent: 0 },
      { chapter_index: 5, chapter_title: 'Chương 5: Trực quan hóa Dữ liệu', total: 50, answered: 0, correct: 0, wrong: 0, bookmarked: 0, accuracy_percent: 0, completion_percent: 0 },
      { chapter_index: 6, chapter_title: 'Chương 6: Ứng dụng và Đạo đức', total: 50, answered: 0, correct: 0, wrong: 0, bookmarked: 0, accuracy_percent: 0, completion_percent: 0 }
    ],
    recent_exams: [],
    ...overrides
  };
}

function renderWithRouter(ui, initialEntries = ['/']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PracticeBankEntryCard (Claymorphism entry on CourseLearningPage)', () => {
  it('renders nothing when course has no practice bank', async () => {
    mocks.getPracticeBankSummary.mockResolvedValue({ enabled: false });
    const { container } = renderWithRouter(<PracticeBankEntryCard courseCode="INF1003" />);
    await waitFor(() => expect(mocks.getPracticeBankSummary).toHaveBeenCalled());
    expect(container.querySelector('.clay-pb-entry')).toBeNull();
  });

  it('renders Claymorphism summary and navigates to /learning/INF0983/practice', async () => {
    mocks.getPracticeBankSummary.mockResolvedValue(makeSummary());
    renderWithRouter(
      <Routes>
        <Route
          path="/learning/:courseCode"
          element={
            <>
              <PracticeBankEntryCard courseCode="INF0983" />
              <LocationProbe />
            </>
          }
        />
        <Route path="/learning/:courseCode/practice" element={<LocationProbe />} />
      </Routes>,
      ['/learning/INF0983']
    );

    expect(await screen.findByText(/Ngân hàng 300 câu hỏi trắc nghiệm/)).toBeInTheDocument();
    expect(screen.getByText(/45\/300 câu/)).toBeInTheDocument();
    expect(screen.getByText(/80%/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Vào phòng ôn tập/i }));
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/learning/INF0983/practice');
    });
  });
});

describe('PracticeBankPage (Hub, Practice Runner, Mock Exam)', () => {
  it('displays 6 chapters, enters chapter practice, answers a question with explanation, and toggles bookmark', async () => {
    mocks.getPracticeBankSummary.mockResolvedValue(makeSummary());
    mocks.getPracticeBankQuestions.mockResolvedValue({
      bank: { id: '1', course_code: 'INF0983', title: 'KHDL', question_count: 300 },
      questions: [
        {
          id: '101',
          external_id: 1,
          chapter_index: 1,
          chapter_title: 'Chương 1: Tổng quan về Khoa học Dữ liệu',
          question_text: 'Khoa học dữ liệu gồm những trụ cột nào?',
          options: {
            A: 'Phương án A',
            B: 'Phương án B',
            C: 'Phương án C',
            D: 'Toán & Thống kê, Khoa học máy tính, Kiến thức chuyên ngành'
          },
          correct_answer: null,
          explanation: null,
          progress: { selected_answer: null, is_correct: null, is_bookmarked: false, attempts: 0, wrong_count: 0 }
        }
      ]
    });
    mocks.answerPracticeQuestion.mockResolvedValue({
      question_id: '101',
      external_id: 1,
      selected_answer: 'D',
      is_correct: true,
      correct_answer: 'D',
      explanation: 'Theo biểu đồ Venn của Drew Conway.',
      attempts: 1,
      wrong_count: 0,
      is_bookmarked: false
    });
    mocks.togglePracticeBookmark.mockResolvedValue({
      question_id: '101',
      is_bookmarked: true
    });

    renderWithRouter(
      <Routes>
        <Route path="/learning/:courseCode/practice" element={<PracticeBankPage />} />
      </Routes>,
      ['/learning/INF0983/practice']
    );

    expect(await screen.findByText(/Ôn tập theo chương \(6 chương\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ôn chương 1/i }));

    expect(await screen.findByText('Khoa học dữ liệu gồm những trụ cột nào?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /D.*Toán & Thống kê/ }));

    expect(await screen.findByText(/Chính xác! Đáp án đúng là D/)).toBeInTheDocument();
    expect(screen.getByText('Theo biểu đồ Venn của Drew Conway.')).toBeInTheDocument();

    // Sau khi đã chọn đáp án ở chế độ ôn tập, bàn phím (1-4 / A-D) và click không được phép chọn lại
    expect(mocks.answerPracticeQuestion).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('radio', { name: /A.*Phương án A/ })).toBeDisabled();
    fireEvent.keyDown(window, { key: '1' });
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: 'c' });
    fireEvent.click(screen.getByRole('radio', { name: /A.*Phương án A/ }));
    expect(mocks.answerPracticeQuestion).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Đánh dấu/ }));
    await waitFor(() => expect(mocks.togglePracticeBookmark).toHaveBeenCalledWith('test-token', 'INF0983', '101', true));
  });

  it('ignores Ctrl+C / Cmd+C and locks answer after selecting C via keyboard in practice mode', async () => {
    mocks.getPracticeBankSummary.mockResolvedValue(makeSummary());
    mocks.getPracticeBankQuestions.mockResolvedValue({
      bank: { id: '1', course_code: 'INF0983', title: 'KHDL', question_count: 300 },
      questions: [
        {
          id: '101',
          external_id: 1,
          chapter_index: 1,
          chapter_title: 'Chương 1',
          question_text: 'Câu hỏi kiểm tra phím tắt?',
          options: { A: 'Đáp A', B: 'Đáp B', C: 'Đáp C', D: 'Đáp D' },
          correct_answer: null,
          explanation: null,
          progress: { selected_answer: null, is_correct: null, is_bookmarked: false, attempts: 0, wrong_count: 0 }
        }
      ]
    });
    mocks.answerPracticeQuestion.mockResolvedValue({
      question_id: '101',
      external_id: 1,
      selected_answer: 'C',
      is_correct: false,
      correct_answer: 'A',
      explanation: 'Đáp án đúng là A.',
      attempts: 1,
      wrong_count: 1,
      is_bookmarked: false
    });

    renderWithRouter(
      <Routes>
        <Route path="/learning/:courseCode/practice" element={<PracticeBankPage />} />
      </Routes>,
      ['/learning/INF0983/practice']
    );

    expect(await screen.findByText(/Ôn tập theo chương \(6 chương\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ôn chương 1/i }));
    expect(await screen.findByText('Câu hỏi kiểm tra phím tắt?')).toBeInTheDocument();

    // Ctrl+C / Cmd+C để copy không được kích hoạt chọn đáp án C
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'c', metaKey: true });
    expect(mocks.answerPracticeQuestion).not.toHaveBeenCalled();

    // Chọn C bằng phím tắt -> khóa không cho đổi sang đáp án khác bằng phím số hoặc chữ
    fireEvent.keyDown(window, { key: 'c' });
    expect(await screen.findByText(/Bạn chọn C — Đáp án đúng là A/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: '1' });
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: '2' });
    fireEvent.keyDown(window, { key: 'd' });
    expect(mocks.answerPracticeQuestion).toHaveBeenCalledTimes(1);
  });

  it('starts and submits a mock exam and renders chapter breakdown summary', async () => {
    mocks.getPracticeBankSummary.mockResolvedValue(makeSummary());
    mocks.startPracticeMockExam.mockResolvedValue({
      bank_id: '1',
      course_code: 'INF0983',
      chapter_index: null,
      total_questions: 2,
      time_limit_seconds: 900,
      questions: [
        {
          id: '101',
          external_id: 1,
          chapter_index: 1,
          chapter_title: 'Chương 1',
          question_text: 'Câu thi thử 1?',
          options: { A: 'Đáp A', B: 'Đáp B', C: 'Đáp C', D: 'Đáp D' }
        },
        {
          id: '102',
          external_id: 51,
          chapter_index: 2,
          chapter_title: 'Chương 2',
          question_text: 'Câu thi thử 2?',
          options: { A: 'Đáp A2', B: 'Đáp B2', C: 'Đáp C2', D: 'Đáp D2' }
        }
      ]
    });
    mocks.submitPracticeMockExam.mockResolvedValue({
      attempt_id: '55',
      total_questions: 2,
      correct_count: 1,
      wrong_count: 1,
      skipped_count: 0,
      score_percent: 50,
      duration_seconds: 42,
      chapter_breakdown: [
        { chapter_index: 1, chapter_title: 'Chương 1', total: 1, correct: 1, wrong: 0, skipped: 0, accuracy_percent: 100 },
        { chapter_index: 2, chapter_title: 'Chương 2', total: 1, correct: 0, wrong: 1, skipped: 0, accuracy_percent: 0 }
      ],
      results: [
        {
          question_id: '101',
          external_id: 1,
          chapter_index: 1,
          chapter_title: 'Chương 1',
          question_text: 'Câu thi thử 1?',
          options: { A: 'Đáp A', B: 'Đáp B', C: 'Đáp C', D: 'Đáp D' },
          selected_answer: 'A',
          correct_answer: 'A',
          is_correct: true,
          explanation: 'Giải thích câu 1'
        },
        {
          question_id: '102',
          external_id: 51,
          chapter_index: 2,
          chapter_title: 'Chương 2',
          question_text: 'Câu thi thử 2?',
          options: { A: 'Đáp A2', B: 'Đáp B2', C: 'Đáp C2', D: 'Đáp D2' },
          selected_answer: 'B',
          correct_answer: 'C',
          is_correct: false,
          explanation: 'Giải thích câu 2'
        }
      ]
    });

    renderWithRouter(
      <Routes>
        <Route path="/learning/:courseCode/practice" element={<PracticeBankPage />} />
      </Routes>,
      ['/learning/INF0983/practice']
    );

    expect(await screen.findByText(/Thi thử tổng hợp/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '50 câu · 25p' })).toHaveClass('is-active');
    fireEvent.click(screen.getByRole('button', { name: /Bắt đầu thi 50 câu · 25p/i }));
    await waitFor(() => {
      expect(mocks.startPracticeMockExam).toHaveBeenCalledWith('test-token', 'INF0983', { count: 50, chapters: undefined });
    });

    expect(await screen.findByText('Câu thi thử 1?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /A.*Đáp A/ }));
    fireEvent.click(screen.getByRole('button', { name: /Câu tiếp/i }));
    expect(await screen.findByText('Câu thi thử 2?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /B.*Đáp B2/ }));

    fireEvent.click(screen.getAllByRole('button', { name: /Nộp bài thi/i })[0]);

    expect(await screen.findByText(/Hoàn thành bài thi thử/)).toBeInTheDocument();
    expect(screen.getByText(/Đạt 50%/)).toBeInTheDocument();
    expect(screen.getByText(/Phân tích theo từng chương/)).toBeInTheDocument();
    expect(screen.getByText('Giải thích câu 2')).toBeInTheDocument();
  });
});
