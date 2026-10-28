import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCourseGuide: vi.fn(),
  getGuideProgress: vi.fn(),
  saveGuideProgress: vi.fn(),
  getQuizSets: vi.fn(),
  getCoursePosts: vi.fn(),
  createCoursePost: vi.fn(),
  deleteCoursePost: vi.fn(),
  toggleCoursePostLike: vi.fn(),
  getCoursePostComments: vi.fn(),
  addCoursePostComment: vi.fn(),
  getLearningResources: vi.fn(),
  notify: vi.fn(),
  canAccess: false
}));

vi.mock('../../client/src/api/guides.js', () => ({
  getCourseGuide: mocks.getCourseGuide,
  getGuideProgress: mocks.getGuideProgress,
  saveGuideProgress: mocks.saveGuideProgress
}));

vi.mock('../../client/src/api/community.js', () => ({
  getQuizSets: mocks.getQuizSets,
  createQuizSet: vi.fn(),
  deleteQuizSet: vi.fn(),
  getQuizPart: vi.fn(),
  startQuizPart: vi.fn(),
  answerQuizReview: vi.fn(),
  saveQuizPartProgress: vi.fn(),
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

// Controllable local-lesson source: null falls back to the real INF1003 data,
// a set array replaces it (lets one test stage a second lesson / new version).
const guideMocks = vi.hoisted(() => ({ localGuides: null }));

vi.mock('../../client/src/features/learning/guides/GuideLayout.jsx', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    getLocalGuides: (...args) => guideMocks.localGuides ?? mod.getLocalGuides(...args)
  };
});

vi.mock('../../client/src/features/ttcds/useTtcdsCapabilities.jsx', () => ({
  useTtcdsCapabilities: () => ({ data: { can_access: mocks.canAccess } })
}));

vi.mock('../../client/src/components/feedback/ConfirmDialog.jsx', () => ({
  useConfirm: () => [null, async () => true]
}));

import GuideSidebar from '../../client/src/features/learning/guides/GuideSidebar.jsx';
import GuideLessonPage from '../../client/src/features/learning/guides/GuideLessonPage.jsx';
import BlockRenderer from '../../client/src/features/learning/guides/BlockRenderer.jsx';
import CourseLearningPage from '../../client/src/features/learning/CourseLearningPage.jsx';

function makeSteps() {
  return [
    { id: 'buoc-1', title: 'Tạo thư mục và tải b5', where: 'local' },
    { id: 'buoc-2', title: 'Chạy script tạo hạ tầng', where: 'cloudshell' },
    { id: 'buoc-3', title: 'Tải hai key và chuyển vào lab1', where: 'cloudshell' },
    { id: 'buoc-4', title: 'CMD → FE → BE: chép mã nguồn và kết nối', where: 'local' },
    { id: 'buoc-5', title: 'Hoàn tất backend và Docker trên BE', where: 'local' },
    { id: 'buoc-6', title: 'Hoàn tất frontend và Docker trên FE', where: 'local' },
    { id: 'buoc-7', title: 'Dọn dẹp để dừng tính tiền', where: 'cloudshell' }
  ];
}

function renderWithClient(ui, initialEntries = ['/']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.canAccess = false;
  guideMocks.localGuides = null;
});

describe('GuideSidebar', () => {
  it('shows 6/7 progress for a 7-step lesson with 6 done steps', () => {
    const steps = makeSteps();
    const doneMap = Object.fromEntries(
      steps.slice(0, 6).map((s) => [s.id, { done: true, workdir: null }])
    );
    renderWithClient(
      <GuideSidebar lesson={{ id: 'bai-1', title: 'Bài 1 — Dựng web 3 tầng trên AWS' }} steps={steps} doneMap={doneMap} activeStep="buoc-7" />
    );
    expect(screen.getByText('Đã xong 6/7')).toBeInTheDocument();
  });
});

describe('BlockRenderer', () => {
  it('renders a code block with a copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    renderWithClient(
      <BlockRenderer block={{ type: 'code', lang: 'cmd', label: 'Máy local', text: 'echo xin-chao' }} workdir="" />
    );
    const copyBtn = screen.getByRole('button', { name: /sao chép|copy/i });
    expect(copyBtn).toBeInTheDocument();
    fireEvent.click(copyBtn);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('echo xin-chao'));
  });

  it('falls back to a text link when an image fails to load', () => {
    renderWithClient(
      <BlockRenderer
        block={{ type: 'image', src: '/guides/inf1003/khong-ton-tai.png', alt: 'Ảnh minh họa lab', caption: 'Kết quả cần đạt' }}
        workdir=""
      />
    );
    const img = screen.getByRole('img', { name: 'Ảnh minh họa lab' });
    fireEvent.error(img);
    expect(screen.queryByRole('img', { name: 'Ảnh minh họa lab' })).not.toBeInTheDocument();
    const fallback = screen.getByRole('link', { name: /Ảnh minh họa lab/ });
    expect(fallback).toHaveAttribute('href', '/guides/inf1003/khong-ton-tai.png');
  });
});

describe('CourseLearningPage guide entry', () => {
  function mockPageAPIs(guide) {
    mocks.getCourseGuide.mockResolvedValue(guide);
    mocks.getQuizSets.mockResolvedValue({ sets: [] });
    mocks.getLearningResources.mockResolvedValue({ courses: [] });
    mocks.getCoursePosts.mockResolvedValue({ posts: [] });
  }

  function renderPage() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <MemoryRouter initialEntries={['/learning/INF1003']}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/learning/:courseCode" element={<CourseLearningPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    );
  }

  it('hides the practice-guide entry when the course has no guide enabled', async () => {
    mockPageAPIs({ enabled: false, lessons: [] });
    renderPage();
    await screen.findByText('Bộ đề trắc nghiệm');
    expect(screen.queryByText('Hướng dẫn thực hành')).not.toBeInTheDocument();
  });

  it('shows the practice-guide entry when the course guide is enabled', async () => {
    mockPageAPIs({ enabled: true, lessons: [{ id: 'bai-1', title: 'Bài 1', progressVersion: 'v', stepIds: ['buoc-1'], doneCount: 0 }] });
    renderPage();
    expect(await screen.findByText('Hướng dẫn thực hành')).toBeInTheDocument();
  });
});

describe('GuideLessonPage progress wiring', () => {
  function mockLessonAPIs(progress) {
    mocks.getCourseGuide.mockResolvedValue({
      enabled: true,
      lessons: [{ id: 'bai-1', title: 'Bài 1 — Dựng web 3 tầng trên AWS', progressVersion: 'cmd-be-first-v4', stepIds: ['buoc-1'], doneCount: 0 }]
    });
    mocks.getGuideProgress.mockResolvedValue(progress || { steps: {}, workdir: null });
  }

  function renderLessonRoutes(initialEntries, client) {
    const queryClient = client || new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/learning/:courseCode/guides/:lessonId/:stepId" element={<GuideLessonPage />} />
            <Route path="/learning/:courseCode/guides" element={<div>Trang danh sách chặng</div>} />
            <Route path="/learning/:courseCode" element={<div>Trang môn học</div>} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    );
  }

  async function openStep1(progress) {
    mockLessonAPIs(progress);
    mocks.saveGuideProgress.mockResolvedValue({ stepId: 'buoc-1', done: true, workdir: '' });
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-1']);
    const checkbox = await screen.findByRole('checkbox', { name: /tôi đã làm xong chặng này/i });
    return checkbox;
  }

  it('ticks done at buoc-1 → saveGuideProgress called with stepId/done and advances to buoc-2', async () => {
    const checkbox = await openStep1();
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    await waitFor(() => expect(mocks.saveGuideProgress).toHaveBeenCalledWith(
      'test-token',
      'INF1003',
      'bai-1',
      expect.objectContaining({ stepId: 'buoc-1', done: true })
    ));
    expect(await screen.findByText('Bước 2/7')).toBeInTheDocument();
  });

  it('does NOT auto-advance when unchecking a done step', async () => {
    const checkbox = await openStep1({ steps: { 'buoc-1': { done: true, workdir: '' } }, workdir: null });
    await waitFor(() => expect(checkbox).toBeChecked());
    mocks.saveGuideProgress.mockResolvedValue({ stepId: 'buoc-1', done: false, workdir: '' });
    fireEvent.click(checkbox);
    await waitFor(() => expect(mocks.saveGuideProgress).toHaveBeenCalledWith(
      'test-token',
      'INF1003',
      'bai-1',
      expect.objectContaining({ stepId: 'buoc-1', done: false })
    ));
    expect(await screen.findByText('Bước 1/7')).toBeInTheDocument();
    expect(screen.queryByText('Bước 2/7')).not.toBeInTheDocument();
  });

  it('rejects invalid workdir "abc" with an inline error and no API call', async () => {
    await openStep1();
    const input = await screen.findByLabelText(/đường dẫn thư mục làm việc/i);
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /lưu thư mục/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(mocks.saveGuideProgress).not.toHaveBeenCalled();
  });

  it('persists a valid workdir once via saveGuideProgress', async () => {
    await openStep1();
    const input = await screen.findByLabelText(/đường dẫn thư mục làm việc/i);
    fireEvent.change(input, { target: { value: 'C:\\lab1' } });
    fireEvent.click(screen.getByRole('button', { name: /lưu thư mục/i }));
    await waitFor(() => expect(mocks.saveGuideProgress).toHaveBeenCalledWith(
      'test-token',
      'INF1003',
      'bai-1',
      expect.objectContaining({ stepId: 'buoc-1', workdir: 'C:\\lab1' })
    ));
  });

  it('remount keeps the server-checked state', async () => {
    mockLessonAPIs({ steps: { 'buoc-1': { done: true, workdir: 'C:\\lab1' } }, workdir: 'C:\\lab1' });
    const first = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-1'], first);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /tôi đã làm xong/i })).toBeChecked());
    unmount();
    const second = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-1'], second);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /tôi đã làm xong/i })).toBeChecked());
    expect(mocks.getGuideProgress).toHaveBeenCalledTimes(2);
  });

  it('redirects a bad lessonId to the course page with a toast', async () => {
    mockLessonAPIs();
    renderLessonRoutes(['/learning/INF1003/guides/bai-khong-co/buoc-1']);
    expect(await screen.findByText('Trang môn học')).toBeInTheDocument();
    expect(mocks.notify).toHaveBeenCalledWith('Môn học chưa có hướng dẫn thực hành.', 'warning');
  });

  it('redirects a bad stepId to the guide index with a toast', async () => {
    mockLessonAPIs();
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-khong-co']);
    expect(await screen.findByText('Trang danh sách chặng')).toBeInTheDocument();
    expect(mocks.notify).toHaveBeenCalledWith('Không tìm thấy chặng hướng dẫn.', 'warning');
  });

  it('rolls back the optimistic check and toasts when POST fails', async () => {
    const checkbox = await openStep1();
    mocks.saveGuideProgress.mockRejectedValueOnce(new Error('Mất kết nối mạng giả lập'));
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).not.toBeChecked());
    expect(mocks.notify).toHaveBeenCalledWith('Mất kết nối mạng giả lập', 'error');
  });

  it('ignores progress cached under a previous progressVersion', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['guide-progress', 'INF1003', 'bai-1', '24050001'], {
      steps: { 'buoc-1': { done: true, workdir: '' } },
      workdir: null
    });
    mockLessonAPIs({ steps: {}, workdir: null });
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-1'], client);
    await waitFor(() => expect(mocks.getGuideProgress).toHaveBeenCalled());
    expect(await screen.findByRole('checkbox', { name: /tôi đã làm xong/i })).not.toBeChecked();
  });

  it('resets a touched workdir draft when switching lesson/version (new serverWorkdir wins)', async () => {
    guideMocks.localGuides = [
      {
        id: 'bai-1',
        title: 'Bài 1',
        progressVersion: 'v1',
        steps: [
          { id: 'buoc-1', title: 'Bước 1', where: 'local', folderInput: true, blocks: [] },
          { id: 'buoc-2', title: 'Bước 2', where: 'cloudshell', blocks: [] }
        ]
      },
      {
        id: 'bai-2',
        title: 'Bài 2',
        progressVersion: 'v2',
        steps: [
          { id: 'buoc-1', title: 'Bước 1', where: 'local', folderInput: true, blocks: [] },
          { id: 'buoc-2', title: 'Bước 2', where: 'cloudshell', blocks: [] }
        ]
      }
    ];
    mockLessonAPIs();
    mocks.getGuideProgress.mockImplementation((_token, _course, lessonId) =>
      Promise.resolve(lessonId === 'bai-2' ? { steps: {}, workdir: 'D:\\lab2' } : { steps: {}, workdir: 'C:\\lab1' })
    );
    function NavProbe({ to, label }) {
      const nav = useNavigate();
      return <button type="button" onClick={() => nav(to)}>{label}</button>;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={['/learning/INF1003/guides/bai-1/buoc-1']}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/learning/:courseCode/guides/:lessonId/:stepId" element={<GuideLessonPage />} />
            <Route path="/learning/:courseCode/guides" element={<div>Trang danh sách chặng</div>} />
            <Route path="/learning/:courseCode" element={<div>Trang môn học</div>} />
          </Routes>
          <NavProbe to="/learning/INF1003/guides/bai-2/buoc-1" label="đi tới bài 2" />
        </QueryClientProvider>
      </MemoryRouter>
    );
    const input = await screen.findByLabelText(/đường dẫn thư mục làm việc/i);
    await waitFor(() => expect(input).toHaveValue('C:\\lab1'));
    fireEvent.change(input, { target: { value: 'C:\\tainted' } });
    expect(input).toHaveValue('C:\\tainted');
    fireEvent.click(screen.getByRole('button', { name: /đi tới bài 2/i }));
    await waitFor(() => expect(screen.getByLabelText(/đường dẫn thư mục làm việc/i)).toHaveValue('D:\\lab2'));
    expect(mocks.saveGuideProgress).not.toHaveBeenCalled();
  });

  it('redirects to the course page on guide 403 instead of hanging on loading', async () => {
    const forbidden = new Error('Không có quyền truy cập môn học.');
    forbidden.status = 403;
    mocks.getCourseGuide.mockRejectedValueOnce(forbidden);
    mocks.getGuideProgress.mockResolvedValue({ steps: {}, workdir: null });
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-1']);
    expect(await screen.findByText('Trang môn học')).toBeInTheDocument();
    expect(screen.queryByText(/đang tải/i)).not.toBeInTheDocument();
    expect(mocks.notify).toHaveBeenCalledWith('Môn học chưa có hướng dẫn thực hành.', 'warning');
  });

  it('shows an error panel with retry on guide load failure instead of hanging on loading', async () => {
    mocks.getCourseGuide.mockRejectedValueOnce(new Error('Mất kết nối mạng giả lập'));
    mocks.getGuideProgress.mockResolvedValue({ steps: {}, workdir: null });
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-1']);
    expect(await screen.findByRole('button', { name: /tải lại/i })).toBeInTheDocument();
    expect(screen.queryByText(/đang tải/i)).not.toBeInTheDocument();
    mocks.getCourseGuide.mockResolvedValue({
      enabled: true,
      lessons: [{ id: 'bai-1', title: 'Bài 1 — Dựng web 3 tầng trên AWS', progressVersion: 'cmd-be-first-v4', stepIds: ['buoc-1'], doneCount: 0 }]
    });
    fireEvent.click(screen.getByRole('button', { name: /tải lại/i }));
    await waitFor(() => expect(mocks.getCourseGuide).toHaveBeenCalledTimes(2));
  });

  it('disables the done checkbox and workdir save while progress is still loading', async () => {
    mockLessonAPIs();
    mocks.getGuideProgress.mockImplementation(() => new Promise(() => {}));
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-1']);
    const checkbox = await screen.findByRole('checkbox', { name: /tôi đã làm xong chặng này/i });
    expect(checkbox).toBeDisabled();
    expect(screen.getByRole('button', { name: /lưu thư mục/i })).toBeDisabled();
    expect(mocks.saveGuideProgress).not.toHaveBeenCalled();
  });
});

describe('GuideLessonPage block data contract', () => {
  it('prepends cd /d with the saved workdir for localDirectory code blocks', () => {
    renderWithClient(
      <BlockRenderer
        block={{ type: 'code', lang: 'cmd', label: 'Máy local', text: 'ssh -i bdu-key-fe.pem ubuntu@1.2.3.4', localDirectory: true }}
        workdir="C:\lab1"
      />
    );
    expect(screen.getByText(/cd \/d/)).toBeInTheDocument();
    expect(screen.getByText(/C:\\lab1/)).toBeInTheDocument();
  });

  it('leaves localDirectory code blocks untouched when no workdir is saved', () => {
    renderWithClient(
      <BlockRenderer
        block={{ type: 'code', lang: 'cmd', label: 'Máy local', text: 'ssh -i bdu-key-fe.pem ubuntu@1.2.3.4', localDirectory: true }}
        workdir=""
      />
    );
    expect(screen.queryByText(/cd \/d/)).not.toBeInTheDocument();
  });

  it('renders connection data carried inline in the block', () => {
    renderWithClient(<BlockRenderer block={{ type: 'connection', feIp: '54.1.2.3' }} workdir="" />);
    expect(screen.getByText('54.1.2.3')).toBeInTheDocument();
  });

  it('renders key-download paths carried inline in the block', () => {
    renderWithClient(
      <BlockRenderer
        block={{ type: 'key-downloads', keys: [{ path: '/home/cloudshell/bdu-key-fe.pem', label: 'Key FE' }] }}
        workdir=""
      />
    );
    expect(screen.getByText('/home/cloudshell/bdu-key-fe.pem')).toBeInTheDocument();
  });
});
