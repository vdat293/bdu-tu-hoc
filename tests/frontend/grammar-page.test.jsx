import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getGrammarGroups: vi.fn(),
  getGrammarPath: vi.fn(),
  getGrammarLesson: vi.fn(),
  saveGrammarProgress: vi.fn()
}));

vi.mock('../../client/src/api/grammar.js', () => mocks);
vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { mssv: '24050001' } }),
  useToasts: () => ({ notify: vi.fn() })
}));

import GrammarPathsPage from '../../client/src/features/grammar/GrammarPathsPage.jsx';
import GrammarPathPage from '../../client/src/features/grammar/GrammarPathPage.jsx';
import GrammarLessonPage from '../../client/src/features/grammar/GrammarLessonPage.jsx';

const PATH_ID = '61da573d-d8f9-4b4f-acf2-a00de2b760c9';
const LESSON_ID = 'bb0544b5-5988-494f-aaaa-2ccf96f893a0';

const LESSON_PAYLOAD = {
  lesson: {
    id: LESSON_ID,
    path_id: PATH_ID,
    path_name: 'Ngữ pháp cơ bản',
    difficulty: 1,
    name: 'Bài 01 - Động từ to be',
    description: 'Động từ to be am/is/are',
    order: 1,
    question_count: 2,
    exercise_count: 2,
    reading_count: 0
  },
  rules: [{ id: 'r1', title: 'Cấu trúc TO BE', content: '<p>I <strong>am</strong> a student.</p>', order: 1 }],
  exercises: [
    {
      id: 'e1', type: 'multiple_choice', question: 'Chọn đáp án đúng:<br>I __ a student.',
      option_a: 'am', option_b: 'is', option_c: 'are', option_d: 'be',
      correct_answer: 'am', correct_option: 'A', explanation: 'I luôn đi với am.', hint: 'Ngôi thứ nhất', order: 1
    },
    {
      id: 'e2', type: 'fill_blank', question: 'Điền is hoặc are: She __ happy.',
      option_a: '', option_b: '', option_c: '', option_d: '',
      correct_answer: 'is', explanation: 'She số ít nên dùng is.', hint: 'She là số ít', order: 2
    }
  ],
  readings: [],
  progress: null
};

function renderWith(routes, entry) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>{routes}</Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function allRoutes() {
  return (
    <>
      <Route path="/grammar" element={<GrammarPathsPage />} />
      <Route path="/grammar/path/:pathId" element={<GrammarPathPage />} />
      <Route path="/grammar/lesson/:lessonId" element={<GrammarLessonPage />} />
    </>
  );
}

beforeEach(() => {
  mocks.saveGrammarProgress.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

describe('grammar paths page', () => {
  it('render nhom lo trinh voi do kho va ten lo trinh', async () => {
    mocks.getGrammarGroups.mockResolvedValue([
      {
        id: 'g1', name: 'Ngữ pháp cơ bản', order: 1,
        paths: [
          { id: PATH_ID, name: 'Ngữ pháp cơ bản', difficulty: 1, banner_label: 'CƠ BẢN', badge_label: 'NGỮ PHÁP', lesson_count: 30, question_count: 1080, completed_lessons: 2 },
          { id: 'p2', name: 'Grammar In Use', difficulty: 2, banner_label: 'GRAMMAR', badge_label: 'IN USE', lesson_count: 115, question_count: 3031, completed_lessons: 0 }
        ]
      },
      {
        id: 'g2', name: 'Ngữ pháp Toeic', order: 3,
        paths: [{ id: 'p3', name: 'Toeic cơ bản', difficulty: 2, banner_label: 'TOEIC', badge_label: 'CƠ BẢN', lesson_count: 20, question_count: 1100, completed_lessons: 0 }]
      }
    ]);
    renderWith(allRoutes(), '/grammar');
    expect(await screen.findByText('Grammar In Use')).toBeTruthy();
    expect(document.querySelector('.section-header-box > div > .section-title')).toBeTruthy();
    expect(screen.getAllByText('CƠ BẢN').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('IN USE')).toBeTruthy();
    expect(screen.getByText('📚 30 bài · 1.080 câu')).toBeTruthy();
    expect(screen.getByText('✓ Đã học 2/30 bài')).toBeTruthy();
    expect(screen.getByText('1/5')).toBeTruthy();
    expect(screen.getByText('2 lộ trình')).toBeTruthy();
  });

  it('hien empty state khi chua import', async () => {
    mocks.getGrammarGroups.mockResolvedValue([]);
    renderWith(allRoutes(), '/grammar');
    expect(await screen.findByText('Chưa có dữ liệu ngữ pháp')).toBeTruthy();
  });
});

describe('grammar path page', () => {
  it('hien thi tien do lo trinh va trang thai tung bai', async () => {
    mocks.getGrammarPath.mockResolvedValue({
      path: {
        id: PATH_ID, name: 'Ngữ pháp cơ bản', group_name: 'Ngữ pháp cơ bản',
        difficulty: 1, lesson_count: 2, question_count: 72, estimated_minutes: 30
      },
      lessons: [
        { id: LESSON_ID, name: 'Bài 01 - Động từ to be', order: 1, question_count: 36, completed: false, in_progress: true, progress_percent: 3, answered: 1, accuracy: 100, attempts: 0 },
        { id: 'l2', name: 'Bài 02 - There is / There are', order: 2, question_count: 36, completed: true, in_progress: false, progress_percent: 100, answered: 36, accuracy: 92, attempts: 1 }
      ],
      summary: { lesson_count: 2, completed_lessons: 1, total_questions: 72 }
    });
    renderWith(allRoutes(), `/grammar/path/${PATH_ID}`);
    expect(await screen.findByText('Đang học 3%')).toBeTruthy();
    expect(screen.getByText('✓ Đã học')).toBeTruthy();
    expect(screen.getByText('Độ chính xác: 92%')).toBeTruthy();
    expect(screen.getByText('✓ 1/2 bài đã học')).toBeTruthy();
    expect(screen.getByText('⏱ ~30 phút')).toBeTruthy();
  });
});

describe('grammar lesson page', () => {
  it('luong ly thuyet -> lam bai -> ket qua', async () => {
    mocks.getGrammarLesson.mockResolvedValue(LESSON_PAYLOAD);
    renderWith(allRoutes(), `/grammar/lesson/${LESSON_ID}`);

    expect(await screen.findByText('Bài 01 - Động từ to be: Lý thuyết')).toBeTruthy();
    expect(screen.getByText('Cấu trúc TO BE')).toBeTruthy();
    expect(document.querySelector('.gr-rule-content')?.textContent).toContain('I am a student.');

    fireEvent.click(screen.getByRole('button', { name: /Làm bài tập/ }));
    expect(await screen.findByText('Câu 1/2')).toBeTruthy();
    expect(document.querySelector('.gr-question br')).toBeTruthy();

    fireEvent.click(screen.getByText('am'));
    expect(await screen.findByText('✓ Chính xác!')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Câu tiếp/ }));

    const input = await screen.findByLabelText('Đáp án');
    fireEvent.change(input, { target: { value: 'is' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trả lời' }));
    expect(await screen.findByText('✓ Chính xác!')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' }));

    expect(await screen.findByText('Hoàn thành bài học!')).toBeTruthy();
    expect(screen.getByText('2/2 câu đúng · 100%')).toBeTruthy();
    expect(mocks.saveGrammarProgress).toHaveBeenCalledWith('test-token', LESSON_ID, expect.objectContaining({ completed: true, correct: 2, total: 2 }));
  });

  it('tra loi sai hien dap an dung va giai thich', async () => {
    mocks.getGrammarLesson.mockResolvedValue(LESSON_PAYLOAD);
    renderWith(allRoutes(), `/grammar/lesson/${LESSON_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: /Làm bài tập/ }));
    fireEvent.click(await screen.findByText('are'));
    expect(await screen.findByText('✗ Chưa đúng')).toBeTruthy();
    expect(screen.getByText('I luôn đi với am.')).toBeTruthy();
    const correctOptions = document.querySelectorAll('.gr-option.is-correct');
    expect(correctOptions.length).toBe(1);
    expect(correctOptions[0].textContent).toContain('am');
  });

  it('dien tu: chap nhan moi dap an trong nhom do|finish|complete', async () => {
    mocks.getGrammarLesson.mockResolvedValue({
      lesson: { ...LESSON_PAYLOAD.lesson, question_count: 1, exercise_count: 1 },
      rules: [],
      exercises: [{
        id: 'e4', type: 'fill_blank', question: 'Điền từ thích hợp: I __ my homework every evening.',
        option_a: '', option_b: '', option_c: '', option_d: '',
        correct_answer: 'do|finish|complete', explanation: 'Thì hiện tại đơn.', hint: 'Động từ chỉ làm bài', order: 1
      }],
      readings: [],
      progress: null
    });
    renderWith(allRoutes(), `/grammar/lesson/${LESSON_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: /Làm bài tập/ }));
    const input = await screen.findByLabelText('Đáp án');
    fireEvent.change(input, { target: { value: 'finish' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trả lời' }));
    expect(await screen.findByText('✓ Chính xác!')).toBeTruthy();
  });

  it('dien tu sai thi hien day du cac dap an duoc chap nhan', async () => {
    mocks.getGrammarLesson.mockResolvedValue({
      lesson: { ...LESSON_PAYLOAD.lesson, question_count: 1, exercise_count: 1 },
      rules: [],
      exercises: [{
        id: 'e5', type: 'fill_blank', question: 'Điền từ thích hợp: I __ my homework every evening.',
        option_a: '', option_b: '', option_c: '', option_d: '',
        correct_answer: 'do|finish|complete', explanation: 'Thì hiện tại đơn.', hint: 'Động từ chỉ làm bài', order: 1
      }],
      readings: [],
      progress: null
    });
    renderWith(allRoutes(), `/grammar/lesson/${LESSON_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: /Làm bài tập/ }));
    const input = await screen.findByLabelText('Đáp án');
    fireEvent.change(input, { target: { value: 'doing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Trả lời' }));
    expect(await screen.findByText('✗ Chưa đúng')).toBeTruthy();
    expect(screen.getByText('do / finish / complete')).toBeTruthy();
  });

  it('sap xep tu: bam chip theo thu tu va kiem tra', async () => {
    mocks.getGrammarLesson.mockResolvedValue({
      lesson: { ...LESSON_PAYLOAD.lesson, question_count: 1, exercise_count: 1 },
      rules: [],
      exercises: [{
        id: 'e3', type: 'arrange_words', question: 'Sắp xếp: a / I / am / student',
        option_a: 'a / I / am / student', option_b: '', option_c: '', option_d: '',
        correct_answer: 'I am a student', explanation: 'Chủ ngữ + to be + bổ ngữ.', hint: '', order: 1
      }],
      readings: [],
      progress: null
    });
    renderWith(allRoutes(), `/grammar/lesson/${LESSON_ID}`);
    fireEvent.click(await screen.findByRole('button', { name: /Làm bài tập/ }));
    for (const word of ['I', 'am', 'a', 'student']) {
      fireEvent.click(screen.getByRole('button', { name: word }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }));
    expect(await screen.findByText('✓ Chính xác!')).toBeTruthy();
  });
});
