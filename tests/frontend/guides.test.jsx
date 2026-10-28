import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCourseGuide: vi.fn(),
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
  getGuideProgress: vi.fn(),
  saveGuideProgress: vi.fn()
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

vi.mock('../../client/src/features/ttcds/useTtcdsCapabilities.jsx', () => ({
  useTtcdsCapabilities: () => ({ data: { can_access: mocks.canAccess } })
}));

vi.mock('../../client/src/components/feedback/ConfirmDialog.jsx', () => ({
  useConfirm: () => [null, async () => true]
}));

import GuideSidebar from '../../client/src/features/learning/guides/GuideSidebar.jsx';
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
