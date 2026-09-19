import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getVocabThemes: vi.fn(),
  getVocabTheme: vi.fn(),
  getVocabSets: vi.fn(),
  getVocabSet: vi.fn(),
  getVocabWords: vi.fn(),
  saveVocabProgress: vi.fn(),
  getVocabReviewSummary: vi.fn(),
  getVocabReviewWords: vi.fn(),
  reviewVocabWord: vi.fn()
}));

vi.mock('../../client/src/api/vocab.js', () => mocks);
vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { mssv: '24050001' } }),
  useToasts: () => ({ notify: vi.fn() })
}));

import VocabThemesPage from '../../client/src/features/vocab/VocabThemesPage.jsx';
import VocabThemePage from '../../client/src/features/vocab/VocabThemePage.jsx';
import VocabSetPage from '../../client/src/features/vocab/VocabSetPage.jsx';
import VocabGamePage from '../../client/src/features/vocab/VocabGamePage.jsx';
import VocabReviewPage from '../../client/src/features/vocab/VocabReviewPage.jsx';

const SET_ID = 'aaaaaaaa-1111-4111-8111-111111111111';

const WORDS = [
  { id: '11111111-1111-4111-8111-111111111111', term: 'apple', pronunciation: '/ˈæpəl/', pos: 'noun', meaning: 'quả táo', example: 'I eat an apple every day.', progress: 'learning' },
  { id: '22222222-2222-4222-8222-222222222222', term: 'book', pronunciation: '', pos: 'noun', meaning: 'quyển sách', example: '', progress: 'learning' },
  { id: '33333333-3333-4333-8333-333333333333', term: 'run', pronunciation: '', pos: 'verb', meaning: 'chạy bộ', example: 'They run fast.', progress: 'learning' },
  { id: '44444444-4444-4444-8444-444444444444', term: 'happy', pronunciation: '', pos: 'adjective', meaning: 'vui vẻ', example: 'She looks happy.', progress: 'learning' }
];

function renderWith(routes, entry) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}><Routes>{routes}</Routes></MemoryRouter>
    </QueryClientProvider>
  );
}

function allRoutes() {
  return (
    <>
      <Route path="/vocab" element={<VocabThemesPage />} />
      <Route path="/vocab/set/:setId" element={<VocabSetPage />} />
      <Route path="/vocab/set/:setId/:mode" element={<VocabGamePage />} />
      <Route path="/vocab/review/:mode" element={<VocabReviewPage />} />
      <Route path="/vocab/:slug" element={<VocabThemePage />} />
    </>
  );
}

beforeEach(() => {
  mocks.getVocabReviewSummary.mockResolvedValue({ due_day: 0, due_week: 0, due_month: 0, mastered: 0, known_total: 0 });
  mocks.getVocabReviewWords.mockResolvedValue([]);
  mocks.reviewVocabWord.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  Object.values(mocks).forEach((m) => m.mockReset());
});

describe('vocab themes page', () => {
  it('renders difficulty cards giong luyentu', async () => {
    mocks.getVocabThemes.mockResolvedValue([
      { slug: 'a1-0-3-0', title: 'A1 (0-3.0)', difficulty: 1, total_sets: 31 },
      { slug: 'c1', title: 'C1', difficulty: 4, total_sets: 66 }
    ]);
    renderWith(allRoutes(), '/vocab');
    expect(await screen.findByText('A1 (0-3.0)')).toBeTruthy();
    expect(screen.getByText('Mỗi ngày một ít, tích luỹ cho tương lai')).toBeTruthy();
    expect(document.querySelector('.section-header-box > div > .section-title')).toBeTruthy();
    expect(screen.getByText('📚 31 bộ từ')).toBeTruthy();
    expect(screen.getByText('1/5')).toBeTruthy();
    expect(screen.getByText('4/5')).toBeTruthy();
  });

  it('shows empty state khi chua crawl', async () => {
    mocks.getVocabThemes.mockResolvedValue([]);
    renderWith(allRoutes(), '/vocab');
    expect(await screen.findByText('Chưa có dữ liệu từ vựng')).toBeTruthy();
  });
});

describe('vocab theme page', () => {
  beforeEach(() => {
    mocks.getVocabTheme.mockResolvedValue({
      slug: 'sach-destination-b1', title: 'Sách Destination B1', difficulty: 2,
      total_sets: 14, total_words: 906, known_words: 90
    });
    mocks.getVocabSet.mockResolvedValue({
      id: SET_ID, theme_slug: 'sach-destination-b1', theme_title: 'Sách Destination B1',
      name: '1. Lời chào hỏi', vocab_count: 20, crawled: 20, known_count: 10
    });
    mocks.getVocabWords.mockResolvedValue({
      set: { id: SET_ID, name: '1. Lời chào hỏi', theme_title: 'Sách Destination B1', vocab_count: 20, crawled: 20 },
      words: WORDS
    });
    mocks.getVocabSets.mockResolvedValue([
      { id: SET_ID, name: '1. Lời chào hỏi', order: 1, vocab_count: 20, crawled: 20, known_count: 10 },
      { id: 'bbbbbbbb-2222-4222-8222-222222222222', name: '2. Gia đình', order: 2, vocab_count: 25, crawled: 25, known_count: 0 }
    ]);
  });

  it('hien thi tien do theme va luoi cac bo tu', async () => {
    renderWith(allRoutes(), '/vocab/sach-destination-b1');
    expect(await screen.findByText('Sách Destination B1')).toBeTruthy();
    expect(screen.getByText('📚 14 bộ từ')).toBeTruthy();
    expect(screen.getByText('🔤 906 từ vựng')).toBeTruthy();
    expect(screen.getByText('✓ 10% hoàn thành')).toBeTruthy();
    expect(screen.getByText(/Tiến độ:/)).toBeTruthy();
    expect(screen.getByText('Các bộ từ')).toBeTruthy();
    expect(screen.getByText('#1')).toBeTruthy();
    expect(screen.getByText('10/20 từ')).toBeTruthy();
    expect(screen.getByText('0/25 từ')).toBeTruthy();
  });

  it('click bo tu mo trang unit', async () => {
    renderWith(allRoutes(), '/vocab/sach-destination-b1');
    fireEvent.click(await screen.findByLabelText('Học bộ từ 1. Lời chào hỏi'));
    expect(await screen.findByText('Chọn chế độ học')).toBeTruthy();
  });
});

describe('vocab set page', () => {
  let progressed;
  beforeEach(() => {
    progressed = {};
    mocks.getVocabSet.mockResolvedValue({
      id: SET_ID, theme_slug: 'a1-0-3-0', theme_title: 'A1 (0-3.0)',
      name: 'Part 1', vocab_count: 100, crawled: 100, known_count: 0
    });
    mocks.getVocabSets.mockResolvedValue([{ id: SET_ID, name: 'Part 1', vocab_count: 100, crawled: 100, known_count: 0 }]);
    mocks.getVocabWords.mockImplementation(async (_token, _setId, { status } = {}) => {
      let list = WORDS.map((w) => (progressed[w.id] ? { ...w, progress: progressed[w.id] } : w));
      if (status === 'unlearned') list = list.filter((w) => w.progress !== 'known');
      if (status === 'known') list = list.filter((w) => w.progress === 'known');
      return {
        set: { id: SET_ID, name: 'Part 1', theme_title: 'A1 (0-3.0)', vocab_count: 100, crawled: 100 },
        words: list
      };
    });
    mocks.saveVocabProgress.mockImplementation(async (_token, wordId, status) => {
      progressed[wordId] = status;
      return { ok: true };
    });
  });

  it('4 game modes, khong co Listening/Dac biet, khong nhoi game inline', async () => {
    renderWith(allRoutes(), `/vocab/set/${SET_ID}`);
    expect((await screen.findAllByText('Flashcard')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Quiz').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Typing').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Ghép cặp').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Listening')).toBeNull();
    expect(screen.queryByText('Đặc biệt')).toBeNull();
    expect(screen.queryByText(/nghĩa là gì/)).toBeNull();
    expect((await screen.findAllByText('apple')).length).toBeGreaterThanOrEqual(1);
  });

  it('click Quiz mo modal chon 3 che do', async () => {
    renderWith(allRoutes(), `/vocab/set/${SET_ID}`);
    await screen.findByText('apple');
    fireEvent.click(screen.getByLabelText('Học bằng Quiz'));
    expect(await screen.findByText('Chọn chế độ Quiz')).toBeTruthy();
    expect(screen.getByText('Từ -> Nghĩa')).toBeTruthy();
    expect(screen.getByText('Ngữ cảnh')).toBeTruthy();
    expect(screen.getByText('Nghĩa -> Từ')).toBeTruthy();
  });

  it('chon Tu -> Nghia thi sang trang game quiz', async () => {
    renderWith(allRoutes(), `/vocab/set/${SET_ID}`);
    await screen.findByText('apple');
    fireEvent.click(screen.getByLabelText('Học bằng Quiz'));
    fireEvent.click(await screen.findByText('Từ -> Nghĩa'));
    expect(await screen.findByText('Câu 1 / 4')).toBeTruthy();
    expect(screen.getByText('Sử dụng phím số 1~4 để chọn nhanh đáp án')).toBeTruthy();
  });

  it('filter Chua thuoc: danh dau da thuoc giu nguyen dong, khong refetch', async () => {
    renderWith(allRoutes(), `/vocab/set/${SET_ID}`);
    await screen.findByText('apple');
    // lọc chưa thuộc bằng select ở toolbar
    const filter = screen.getByLabelText('Lọc theo trạng thái thuộc');
    fireEvent.change(filter, { target: { value: 'unlearned' } });
    await screen.findByText('apple');
    const callsBefore = mocks.getVocabWords.mock.calls.length;

    fireEvent.click(screen.getByLabelText('apple: chưa thuộc, nhấn để đánh dấu đã thuộc'));
    await waitFor(() => expect(mocks.saveVocabProgress).toHaveBeenCalledWith('test-token', WORDS[0].id, 'known'));

    // dòng vẫn còn với trạng thái mới, KHÔNG refetch danh sách từ
    expect(await screen.findByLabelText('apple: đã thuộc, nhấn để chuyển về chưa thuộc')).toBeTruthy();
    expect(screen.queryByText('Đã chuyển')).toBeNull();
    expect(screen.queryByText('Hoàn tác')).toBeNull();
    expect(mocks.getVocabWords.mock.calls.length).toBe(callsBefore);
  });

  it('click vao tu mo modal chi tiet dang portal', async () => {
    renderWith(allRoutes(), `/vocab/set/${SET_ID}`);
    const terms = await screen.findAllByText('apple');
    fireEvent.click(terms[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.closest('.dashboard-body')).toBeNull();
    expect(within(dialog).getByText('NGHĨA')).toBeTruthy();
    expect(within(dialog).getByText('VÍ DỤ')).toBeTruthy();
    expect(within(dialog).getByText('📙 Thêm vào từ đã thuộc')).toBeTruthy();
    // đóng bằng Escape
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('vocab game page', () => {
  beforeEach(() => {
    mocks.getVocabWords.mockResolvedValue({ set: { id: SET_ID, name: 'Part 1' }, words: WORDS });
    mocks.saveVocabProgress.mockResolvedValue({ ok: true });
  });

  it('bao loi khi mode khong ton tai', async () => {
    renderWith(allRoutes(), `/vocab/set/${SET_ID}/listening`);
    expect(await screen.findByText('Chế độ học không tồn tại')).toBeTruthy();
  });

  it('flashcard luu ca 2 nut Chua thuoc/Da thuoc', async () => {
    renderWith(allRoutes(), `/vocab/set/${SET_ID}/flashcard`);
    expect(await screen.findByText('Chơi lại')).toBeTruthy();
    expect(screen.getByText('Thoát')).toBeTruthy();
    fireEvent.click(screen.getByText('✕ Quên'));
    await waitFor(() => expect(mocks.saveVocabProgress).toHaveBeenCalledWith('test-token', expect.any(String), 'learning'));
    fireEvent.click(await screen.findByText('✓ Thuộc'));
    await waitFor(() => expect(mocks.saveVocabProgress).toHaveBeenCalledWith('test-token', expect.any(String), 'known'));
  });

  it('quiz hien 4 dap an danh so 1-4', async () => {
    renderWith(allRoutes(), `/vocab/set/${SET_ID}/quiz?quiz=word-meaning`);
    expect(await screen.findByText('Câu 1 / 4')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('~0 GAME', { exact: false })).toBeTruthy();
  });

  it('match hien vong choi va tim', async () => {
    renderWith(allRoutes(), `/vocab/set/${SET_ID}/match`);
    expect(await screen.findByText(/VÒNG 1\//)).toBeTruthy();
    expect(screen.getByText('Đã ghép:')).toBeTruthy();
  });
});

describe('vocab review', () => {
  beforeEach(() => {
    mocks.getVocabThemes.mockResolvedValue([
      { slug: 'a1-0-3-0', title: 'A1 (0-3.0)', difficulty: 1, total_sets: 31 }
    ]);
  });

  it('giu du 4 card game va them card on tap', async () => {
    mocks.getVocabReviewSummary.mockResolvedValue({ due_day: 2, due_week: 5, due_month: 9, mastered: 1, known_total: 12 });
    renderWith(allRoutes(), '/vocab');
    expect(await screen.findByLabelText('Ôn tập bằng Flashcard')).toBeTruthy();
    expect(screen.getByLabelText('Ôn tập bằng Quiz')).toBeTruthy();
    expect(screen.getByLabelText('Ôn tập bằng Typing')).toBeTruthy();
    expect(screen.getByLabelText('Ôn tập bằng Ghép cặp')).toBeTruthy();
    const reviewCard = await screen.findByLabelText('Ôn tập từ vựng');
    fireEvent.click(reviewCard);
    expect(await screen.findByText('Chọn phạm vi ôn tập')).toBeTruthy();
    expect(screen.getByText('Ôn từ hôm qua')).toBeTruthy();
    expect(screen.getByText('Ôn từ tuần qua')).toBeTruthy();
    expect(screen.getByText('Ôn tập toàn bộ')).toBeTruthy();
    expect(screen.getByText('2 từ · từ đến hạn ôn hôm nay')).toBeTruthy();
    expect(screen.getByText('11 từ · theo tháng hoặc tất cả từ chưa thành thạo')).toBeTruthy();
  });

  it('card game tren /vocab hoi pham vi roi vao thang game', async () => {
    mocks.getVocabReviewSummary.mockResolvedValue({ due_day: 2, due_week: 5, due_month: 9, mastered: 1, known_total: 12 });
    mocks.getVocabReviewWords.mockResolvedValue(WORDS);
    renderWith(allRoutes(), '/vocab');
    fireEvent.click(await screen.findByLabelText('Ôn tập bằng Quiz'));
    expect(await screen.findByText('Chọn phạm vi ôn tập')).toBeTruthy();
    fireEvent.click(screen.getByText('Ôn từ tuần qua'));
    expect(await screen.findByText('Câu 1 / 4')).toBeTruthy();
  });

  it('card on tap tu dong vao che do typing', async () => {
    mocks.getVocabReviewSummary.mockResolvedValue({ due_day: 2, due_week: 5, due_month: 9, mastered: 1, known_total: 12 });
    mocks.getVocabReviewWords.mockResolvedValue(WORDS);
    renderWith(allRoutes(), '/vocab');
    fireEvent.click(await screen.findByLabelText('Ôn tập từ vựng'));
    fireEvent.click(await screen.findByText('Ôn từ hôm qua'));
    expect(await screen.findByText('Chưa có gợi ý')).toBeTruthy();
    expect(screen.getByText(/Ôn tập · Từ hôm qua/)).toBeTruthy();
    expect(mocks.getVocabReviewWords).toHaveBeenCalledWith('test-token', expect.objectContaining({ bucket: 'day' }));
  });

  it('an card on tap khi chua co tu thuoc', async () => {
    renderWith(allRoutes(), '/vocab');
    await screen.findByText('A1 (0-3.0)');
    expect(screen.queryByLabelText('Ôn tập từ vựng')).toBeNull();
  });

  it('flashcard on tap ghi ket qua pass/fail qua API review', async () => {
    mocks.getVocabReviewWords.mockResolvedValue(WORDS);
    renderWith(allRoutes(), '/vocab/review/flashcard?bucket=day');
    expect(await screen.findByText('Chơi lại')).toBeTruthy();
    fireEvent.click(screen.getByText('✕ Quên'));
    await waitFor(() => expect(mocks.reviewVocabWord).toHaveBeenCalledWith('test-token', expect.any(String), 'fail'));
    fireEvent.click(await screen.findByText('✓ Thuộc'));
    await waitFor(() => expect(mocks.reviewVocabWord).toHaveBeenCalledWith('test-token', expect.any(String), 'pass'));
  });

  it('bao trong khi khung on tap khong co tu', async () => {
    renderWith(allRoutes(), '/vocab/review/quiz?bucket=week');
    expect(await screen.findByText('Không có từ nào đến hạn')).toBeTruthy();
  });
});
