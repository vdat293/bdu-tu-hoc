import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCourseGuide: vi.fn(),
  getGuideProgress: vi.fn(),
  saveGuideProgress: vi.fn(),
  getLabResult: vi.fn(),
  saveLabResult: vi.fn(),
  resetGuideProgress: vi.fn(),
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
  saveGuideProgress: mocks.saveGuideProgress,
  getLabResult: mocks.getLabResult,
  saveLabResult: mocks.saveLabResult,
  resetGuideProgress: mocks.resetGuideProgress
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

const confirmMocks = vi.hoisted(() => ({ impl: (..._args) => Promise.resolve(true) }));

vi.mock('../../client/src/components/feedback/ConfirmDialog.jsx', () => ({
  useConfirm: () => [null, (...args) => confirmMocks.impl(...args)]
}));

import GuideSidebar from '../../client/src/features/learning/guides/GuideSidebar.jsx';
import GuideLessonPage, { stepClean } from '../../client/src/features/learning/guides/GuideLessonPage.jsx';
import GuideIndexPage from '../../client/src/features/learning/guides/GuideIndexPage.jsx';
import BlockRenderer from '../../client/src/features/learning/guides/BlockRenderer.jsx';
import BlockConnection from '../../client/src/features/learning/guides/BlockConnection.jsx';
import BlockKeyDownloads from '../../client/src/features/learning/guides/BlockKeyDownloads.jsx';
import BlockNote from '../../client/src/features/learning/guides/BlockNote.jsx';
import BlockScript, { toBashOneLiner } from '../../client/src/features/learning/guides/BlockScript.jsx';
import { GUIDE_SCRIPTS } from '../../client/src/features/learning/guides/inf1003/scripts.generated.js';
import { applyScriptRegion, normalizeRegion, regionLabel } from '../../client/src/features/learning/guides/inf1003/regions.js';
import { BAI_1_MACOS_LESSON } from '../../client/src/features/learning/guides/inf1003/bai-1-macos.js';
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
  confirmMocks.impl = (..._args) => Promise.resolve(true);
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

  it('renders a full-size link for images flagged fullSizeLink', () => {
    renderWithClient(
      <BlockRenderer
        block={{ type: 'image', src: '/guides/inf1003/hinh1.png', alt: 'Ảnh CloudShell', fullSizeLink: true }}
        workdir=""
      />
    );
    const link = screen.getByRole('link', { name: /mở ảnh lớn/i });
    expect(link).toHaveAttribute('href', '/guides/inf1003/hinh1.png');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('strips a leading "+ " from troubleshoot titles like the original', () => {
    renderWithClient(
      <BlockRenderer
        block={{ type: 'troubleshoot', title: '+ Gặp vấn đề khi chép file hoặc SSH?', blocks: [] }}
        workdir=""
      />
    );
    expect(screen.getByText('Gặp vấn đề khi chép file hoặc SSH?')).toBeInTheDocument();
    expect(screen.queryByText('+ Gặp vấn đề khi chép file hoặc SSH?')).not.toBeInTheDocument();
  });

  it('gates a localDirectory code block behind the lab result', () => {
    renderWithClient(
      <BlockRenderer
        block={{ type: 'code', lang: 'cmd', label: 'Máy local', text: 'ssh ubuntu@1.2.3.4', localDirectory: true }}
        workdir="C:\lab1"
        lab={null}
        labHref="/learning/INF1003/guides/bai-1/buoc-2"
        workdirHref="/learning/INF1003/guides/bai-1/buoc-1"
      />
    );
    expect(screen.getByText(/chưa có kết quả tạo hạ tầng/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /dán kết quả ở bước 2/i })).toHaveAttribute(
      'href', expect.stringContaining('buoc-2')
    );
    expect(screen.queryByText(/ssh ubuntu/)).not.toBeInTheDocument();
  });

  it('gates a localDirectory code block behind the saved workdir when lab exists', () => {
    renderWithClient(
      <BlockRenderer
        block={{ type: 'code', lang: 'cmd', label: 'Máy local', text: 'ssh ubuntu@1.2.3.4', localDirectory: true }}
        workdir=""
        lab={{ FE_IP: '54.1.2.3' }}
        labHref="/learning/INF1003/guides/bai-1/buoc-2"
        workdirHref="/learning/INF1003/guides/bai-1/buoc-1"
      />
    );
    expect(screen.getByText(/cần đường dẫn thư mục làm việc/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /lưu đường dẫn ở bước 1/i })).toHaveAttribute(
      'href', expect.stringContaining('buoc-1')
    );
  });

  it('substitutes lab vars once lab and workdir are present', () => {
    renderWithClient(
      <BlockRenderer
        block={{ type: 'code', lang: 'bash', label: 'SSH', text: 'ssh ubuntu@{{FE_IP}}', localDirectory: true }}
        workdir="C:\lab1"
        lab={{ FE_IP: '54.1.2.3' }}
        vars={{ FE_IP: '54.1.2.3' }}
      />
    );
    expect(screen.getByText(/54\.1\.2\.3/)).toBeInTheDocument();
    expect(screen.queryByText(/{{FE_IP}}/)).not.toBeInTheDocument();
  });
});

describe('BlockNote', () => {
  it('rewrites the FE preview URL with the lab FE_IP', () => {
    renderWithClient(
      <BlockNote block={{ type: 'note', title: 'Kiểm tra', text: 'Mở http://FE_IP:3000/ để xem website.' }} feIp="54.1.2.3" />
    );
    expect(screen.getByText(/http:\/\/54\.1\.2\.3:3000\//)).toBeInTheDocument();
    expect(screen.queryByText(/http:\/\/FE_IP:3000\//)).not.toBeInTheDocument();
  });

  it('leaves the FE preview URL untouched without a lab IP', () => {
    renderWithClient(
      <BlockNote block={{ type: 'note', text: 'Mở http://FE_IP:3000/ để xem website.' }} />
    );
    expect(screen.getByText(/http:\/\/FE_IP:3000\//)).toBeInTheDocument();
  });
});

describe('BlockScript', () => {
  it('builds a bash one-liner that round-trips the script', () => {
    const script = GUIDE_SCRIPTS.start;
    const oneLiner = toBashOneLiner(script);
    expect(oneLiner.startsWith('bash -c "')).toBe(true);
    const b64 = oneLiner.match(/printf '%s' '([^']+)'/)[1];
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    expect(decoded).toBe(script);
  });

  it('copies the one-liner (not the raw script) with the original hint and lang', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    renderWithClient(<BlockScript block={{ type: 'script', scriptKey: 'start', previewLines: 10 }} />);
    expect(screen.getByText('AWS CloudShell · Lệnh Linux')).toBeInTheDocument();
    expect(screen.getByText(/copy lấy lệnh 1 dòng/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /sao chép/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe(toBashOneLiner(applyScriptRegion(GUIDE_SCRIPTS.start, 'ap-southeast-1')));
  });

  it('writes the chosen region into the preview and the copied one-liner', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderWithClient(<BlockScript block={{ type: 'script', scriptKey: 'start', previewLines: 10 }} region="ap-northeast-1" />);
    expect(screen.getByText((_, element) => element?.tagName === 'CODE' && element.textContent.includes('AWS_DEFAULT_REGION="ap-northeast-1"'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /sao chép/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe(toBashOneLiner(applyScriptRegion(GUIDE_SCRIPTS.start, 'ap-northeast-1')));
    expect(writeText.mock.calls[0][0]).not.toBe(toBashOneLiner(GUIDE_SCRIPTS.start));
  });
});

describe('BlockKeyDownloads', () => {
  const keys = [
    { label: 'Key FE', path: '/home/cloudshell/bdu-key-fe.pem' },
    { label: 'Key BE', path: '/home/cloudshell/bdu-key-be.pem' }
  ];

  it('renders one original-style card per key with numbered headings', () => {
    renderWithClient(<BlockKeyDownloads block={{ type: 'key-downloads' }} keys={keys} />);
    expect(screen.getByText('2. Tải bdu-key-fe.pem')).toBeInTheDocument();
    expect(screen.getByText('3. Tải bdu-key-be.pem')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy đường dẫn fe/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy đường dẫn be/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue('/home/cloudshell/bdu-key-fe.pem')).toHaveAttribute('readonly');
    expect(screen.getByText(/mở lại actions → download file/i)).toBeInTheDocument();
    expect(screen.getByText(/cần có đủ hai file trong downloads/i)).toBeInTheDocument();
  });
});

describe('BlockConnection', () => {
  it('renders the four original rows including the workdir fallback', () => {
    renderWithClient(
      <BlockConnection
        block={{ type: 'connection' }}
        connection={{ feIp: '54.1.2.3', beIp: '54.4.5.6', dbEndpoint: 'bdu-lab.abc123.rds.amazonaws.com' }}
        workdir=""
      />
    );
    expect(screen.getByText('Thông tin kết nối của bạn')).toBeInTheDocument();
    expect(screen.getByText('54.1.2.3')).toBeInTheDocument();
    expect(screen.getByText('54.4.5.6')).toBeInTheDocument();
    expect(screen.getByText('bdu-lab.abc123.rds.amazonaws.com')).toBeInTheDocument();
    expect(screen.getByText('Chưa lưu ở bước 1')).toBeInTheDocument();
  });

  it('shows the saved workdir when present', () => {
    renderWithClient(
      <BlockConnection
        block={{ type: 'connection' }}
        connection={{ feIp: '54.1.2.3', beIp: '54.4.5.6', dbEndpoint: 'db.rds.amazonaws.com' }}
        workdir="C:\lab1"
      />
    );
    expect(screen.getByText('C:\\lab1')).toBeInTheDocument();
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

describe('GuideLessonPage original-flow wiring', () => {
  const LAB_FIELDS = {
    STATUS: 'READY',
    REGION: 'ap-southeast-1',
    FE_IP: '54.1.2.3',
    BE_IP: '54.4.5.6',
    DB_ENDPOINT: 'bdu-lab.abc123.ap-southeast-1.rds.amazonaws.com',
    FE_KEY_PATH: '/home/cloudshell/bdu-key-fe.pem',
    BE_KEY_PATH: '/home/cloudshell/bdu-key-be.pem',
    token: 'BDU-LAB-V1:dG9rZW4='
  };

  function mockLessonAPIs(progress, labResult = null) {
    mocks.getCourseGuide.mockResolvedValue({
      enabled: true,
      lessons: [{ id: 'bai-1', title: 'Bài 1 — Dựng web 3 tầng trên AWS', progressVersion: 'cmd-be-first-v4', stepIds: ['buoc-1'], doneCount: 0 }]
    });
    mocks.getGuideProgress.mockResolvedValue(progress || { steps: {}, workdir: null });
    mocks.getLabResult.mockResolvedValue(labResult);
    mocks.saveGuideProgress.mockResolvedValue({ stepId: 'buoc-1', done: true, workdir: '' });
  }

  // Stateful stand-in for the server: GET reflects prior POSTs so the
  // optimistic cache update + refetch reconciliation behaves like production.
  function mockProgressStore(initial) {
    const store = JSON.parse(JSON.stringify(initial));
    mocks.getGuideProgress.mockImplementation(async () => ({ steps: { ...store.steps }, workdir: store.workdir }));
    mocks.saveGuideProgress.mockImplementation(async (_token, _course, _lesson, { stepId, done, workdir }) => {
      store.steps[stepId] = { done, workdir: workdir ?? store.steps[stepId]?.workdir ?? '' };
      if (workdir !== undefined) store.workdir = workdir;
      return { stepId, done, workdir: workdir ?? '' };
    });
    return store;
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

  async function openStep(stepId = 'buoc-1', progress, labResult = null) {
    mockLessonAPIs(progress, labResult);
    renderLessonRoutes([`/learning/INF1003/guides/bai-1/${stepId}`]);
    await screen.findByText(/CHẶNG \d\/7/);
  }

  it.each(['windows', 'macos'])('switches %s from the CloudShell help dialog, keeps the folder and remembers the selection', async (platform) => {
    const directory = platform === 'macos' ? '/Users/ban/lab1' : 'C:\\lab1';
    mockLessonAPIs({ steps: { 'buoc-1': { done: true } }, workdir: directory });
    renderLessonRoutes([`/learning/INF1003/guides/bai-1/buoc-2?os=${platform}`]);
    fireEvent.click(await screen.findByRole('button', { name: 'Bạn không mở được CloudShell?' }));
    expect(screen.getByRole('dialog', { name: 'Bạn không mở được CloudShell?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy bỏ' }));
    expect(mocks.saveGuideProgress).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Bạn không mở được CloudShell?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(await screen.findByText('Kết quả AWS CLI trên máy')).toBeInTheDocument();
    expect(screen.queryByText('Đang dùng AWS CLI trên máy của bạn')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Hệ điều hành' })).not.toBeInTheDocument();
    expect(screen.getByText(directory)).toBeInTheDocument();
    expect(screen.getByText(platform === 'macos' ? 'Máy local · Terminal macOS' : 'Máy local · Windows PowerShell')).toBeInTheDocument();
    expect(mocks.saveGuideProgress).toHaveBeenCalledTimes(6);
    expect(mocks.saveGuideProgress.mock.calls.some(call => call[3].stepId === 'buoc-1')).toBe(false);
    expect(screen.queryByText('Kết quả CloudShell')).not.toBeInTheDocument();
    cleanup();
    renderLessonRoutes([`/learning/INF1003/guides/bai-1/buoc-7?os=${platform}`]);
    expect(await screen.findByRole('button', { name: 'Quay lại cách dùng CloudShell' })).toBeInTheDocument();
    expect(screen.getByText('Thư mục lưu hai key:', { exact: false })).toHaveTextContent(directory);
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại cách dùng CloudShell' }));
    expect(await screen.findByRole('button', { name: 'Bạn không mở được CloudShell?' })).toBeInTheDocument();
  });

  it('lets the student pick the AWS region and keeps cleanup on the saved region', async () => {
    mockLessonAPIs({ steps: {}, workdir: null });
    const first = renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-2']);
    const select = await screen.findByRole('combobox', { name: 'Vùng AWS' });
    expect(select).toHaveValue('ap-southeast-1');
    fireEvent.change(select, { target: { value: 'ap-northeast-1' } });
    expect(select).toHaveValue('ap-northeast-1');
    expect(screen.getByText(/Asia Pacific \(Tokyo\) \(ap-northeast-1\)/)).toBeInTheDocument();
    expect(window.localStorage.getItem('bdu:guide-region:24050001:INF1003:bai-1:cmd-be-first-v4')).toBe('ap-northeast-1');
    first.unmount();

    // Cleanup follows the result's region even if the selector holds another one.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
    mockLessonAPIs({ steps: {}, workdir: null }, { ...LAB_FIELDS, REGION: 'ap-southeast-2' });
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-7']);
    fireEvent.click(await screen.findByRole('button', { name: /sao chép/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const b64 = writeText.mock.calls[0][0].match(/printf '%s' '([^']+)'/)[1];
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(b64), (character) => character.charCodeAt(0)));
    expect(decoded).toContain('AWS_DEFAULT_REGION="ap-southeast-2"');
    window.localStorage.removeItem('bdu:guide-region:24050001:INF1003:bai-1:cmd-be-first-v4');
  });

  it.each(['windows', 'macos'])('shows the annotated result and accepts pasted local output on %s', async (platform) => {
    mockLessonAPIs({ steps: {}, workdir: platform === 'macos' ? '/Users/ban/lab1' : 'C:\\lab1' });
    renderLessonRoutes([`/learning/INF1003/guides/bai-1/buoc-2?os=${platform}&setup=local`]);
    const image = await screen.findByRole('img', { name: platform === 'macos' ? /Terminal macOS sau khi tạo hạ tầng/ : /PowerShell Windows sau khi tạo hạ tầng/ });
    expect(image).toHaveAttribute('src', platform === 'macos'
      ? '/guides/inf1003/hinh-copy-ket-qua-local-annotated.png'
      : '/guides/inf1003/hinh-copy-ket-qua-windows-annotated.png');
    const passwordImage = screen.queryByRole('img', { name: /Biểu tượng chìa khóa cạnh Password:/ });
    const mcpPrompt = 'Configure AWS MCP server connection? [Y/n]: No';
    const skillsPrompt = 'Configure AWS skills and the AWS MCP server for your AI coding agent(s)? [y/n/never]: No';
    if (platform === 'macos') {
      expect(passwordImage).toHaveAttribute('src', '/guides/inf1003/macos/hinh-nhap-mat-khau-cai-aws-cli-annotated.png');
      expect(screen.getByText('Nhập mật khẩu mở máy của bạn', { exact: true })).toBeInTheDocument();
      expect(screen.queryByText(mcpPrompt, { exact: true })).not.toBeInTheDocument();
      expect(screen.queryByText(skillsPrompt, { exact: true })).not.toBeInTheDocument();
    } else {
      expect(passwordImage).not.toBeInTheDocument();
      expect(screen.queryByText('Nhập mật khẩu mở máy của bạn', { exact: true })).not.toBeInTheDocument();
      expect(screen.getByText(mcpPrompt, { exact: true })).toBeInTheDocument();
      expect(screen.getByText(skillsPrompt, { exact: true })).toBeInTheDocument();
      expect(screen.getByText(/Không chỉ nhấn Enter vì câu này mặc định là Yes/)).toBeInTheDocument();
    }
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByText(/lab-result\.json/)).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(platform === 'macos' ? 'nhấn Cmd\\+V để dán' : 'nhấn Ctrl\\+V để dán'))).toBeInTheDocument();
    const textarea = screen.getByRole('textbox', { name: /Dán toàn bộ chuỗi/ });
    fireEvent.change(textarea, { target: { value: LAB_FIELDS.token } });
    fireEvent.click(screen.getByRole('button', { name: 'Phân tích & sang bước 3' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Hãy dùng kết quả do AWS CLI trên máy tạo ra.');
    expect(mocks.saveLabResult).not.toHaveBeenCalled();
    const localToken = 'BDU-LAB-V1:' + btoa('STATUS=READY\nKEY_SOURCE=LOCAL\n');
    fireEvent.change(textarea, { target: { value: localToken } });
    mocks.saveLabResult.mockResolvedValue({ ...LAB_FIELDS, KEY_SOURCE: 'LOCAL', token: localToken });
    fireEvent.click(screen.getByRole('button', { name: 'Phân tích & sang bước 3' }));
    await waitFor(() => expect(mocks.saveLabResult).toHaveBeenCalledWith('test-token', 'INF1003', 'bai-1', { token: localToken }));
  });

  it('hides an existing CloudShell result when viewing local instructions', async () => {
    mockLessonAPIs({ steps: {}, workdir: 'C:\\lab1' }, LAB_FIELDS);
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-3?os=windows&setup=local']);
    expect(await screen.findByText(/Chưa có kết quả tạo hạ tầng/)).toBeInTheDocument();
    expect(screen.queryByText('Key đã có sẵn trên máy')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Dán kết quả ở bước 2/ })).toHaveAttribute('href', expect.stringContaining('setup=local'));
  });

  it('has no kicker header: card starts straight at CHẶNG', async () => {
    await openStep('buoc-5', { steps: {}, workdir: 'C:\\lab1' }, LAB_FIELDS);
    expect(await screen.findByText('CHẶNG 5/7')).toBeInTheDocument();
    expect(screen.queryByText(/Bước \d\/7/)).not.toBeInTheDocument();
  });

  it('requiresResult without lab renders only the warn box + link, no blocks or footer', async () => {
    await openStep('buoc-3');
    expect(await screen.findByText(/chưa có kết quả tạo hạ tầng/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /dán kết quả ở bước 2/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('buoc-2'));
    expect(screen.queryByText('2. Tải bdu-key-fe.pem')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tôi đã hoàn thành/i })).not.toBeInTheDocument();
  });

  it('requiresDirectory without workdir renders only the workdir warn, even with lab', async () => {
    await openStep('buoc-4', { steps: {}, workdir: null }, LAB_FIELDS);
    expect(await screen.findByText(/cần đường dẫn thư mục làm việc/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /lưu đường dẫn ở bước 1/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('buoc-1'));
    expect(screen.queryByText('Thông tin kết nối của bạn')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tôi đã hoàn thành/i })).not.toBeInTheDocument();
  });

  it('checks the lab requirement before the workdir requirement', async () => {
    await openStep('buoc-4');
    expect(await screen.findByText(/chưa có kết quả tạo hạ tầng/i)).toBeInTheDocument();
    expect(screen.queryByText(/cần đường dẫn thư mục làm việc/i)).not.toBeInTheDocument();
  });

  it('renders key-download cards once the lab result exists', async () => {
    await openStep('buoc-3', { steps: {}, workdir: null }, LAB_FIELDS);
    expect(await screen.findByText('2. Tải bdu-key-fe.pem')).toBeInTheDocument();
    expect(screen.getByText('3. Tải bdu-key-be.pem')).toBeInTheDocument();
  });

  it('renders the connection section with gated code on buoc-4', async () => {
    await openStep('buoc-4', { steps: {}, workdir: 'C:\\lab1' }, LAB_FIELDS);
    expect(await screen.findByText('Thông tin kết nối của bạn')).toBeInTheDocument();
    expect(screen.getByText('54.1.2.3')).toBeInTheDocument();
    expect(screen.queryByText(/{{FE_IP}}/)).not.toBeInTheDocument();
  });

  it('renders explain / expect / errors sections from step data', async () => {
    await openStep('buoc-2', { steps: {}, workdir: null });
    expect(await screen.findByText('Chuyện gì đang xảy ra')).toBeInTheDocument();
    expect(screen.getByText('Bạn sẽ thấy')).toBeInTheDocument();
    expect(screen.getByText('Gặp vấn đề? Xem cách xử lý lỗi')).toBeInTheDocument();
    expect(screen.getAllByText(/triệu chứng:/i)).toHaveLength(2);
  });

  it('sidebar click is free: no lock toast, navigates anywhere', async () => {
    await openStep('buoc-1');
    fireEvent.click(screen.getByRole('button', { name: /chép mã nguồn và kết nối/i }));
    expect(await screen.findByText(/chưa có kết quả tạo hạ tầng/i)).toBeInTheDocument();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('đi ngược / sidebar bước cũ luôn OK', async () => {
    await openStep('buoc-2', { steps: { 'buoc-1': { done: true, workdir: 'C:\\lab1' } }, workdir: 'C:\\lab1' });
    expect(await screen.findByText('Kết quả CloudShell')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /tạo thư mục và tải b5/i }));
    expect(await screen.findByText('Lưu đường dẫn thư mục của bạn')).toBeInTheDocument();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('normal step footer marks done and goes to the next step', async () => {
    mockLessonAPIs({ steps: {}, workdir: 'C:\\lab1' }, LAB_FIELDS);
    mocks.saveGuideProgress.mockResolvedValue({ stepId: 'buoc-5', done: true, workdir: '' });
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-5']);
    const completeBtn = await screen.findByRole('button', { name: /tôi đã hoàn thành · sang bước 6/i });
    fireEvent.click(completeBtn);
    await waitFor(() => expect(mocks.saveGuideProgress).toHaveBeenCalledWith(
      'test-token',
      'INF1003',
      'bai-1',
      expect.objectContaining({ stepId: 'buoc-5', done: true })
    ));
    expect(await screen.findByText('CHẶNG 6/7')).toBeInTheDocument();
  });

  it('server NOT_CLEAN surfaces the server message and stays', async () => {
    const serverMessage = 'Bước này cần key lab (dòng BDU-LAB-V1:) đã lưu. Hãy dán dòng kết quả ở bước 2 rồi thử lại.';
    const notClean = Object.assign(new Error(serverMessage), { status: 400, code: 'GUIDE_STEP_NOT_CLEAN' });
    mockLessonAPIs({ steps: {}, workdir: 'C:\\lab1' }, LAB_FIELDS);
    mocks.saveGuideProgress.mockRejectedValueOnce(notClean);
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-5']);
    fireEvent.click(await screen.findByRole('button', { name: /tôi đã hoàn thành/i }));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(serverMessage, 'error'));
    expect(await screen.findByText('CHẶNG 5/7')).toBeInTheDocument();
  });

  it('last step shows the completion panel after marking done', async () => {
    mockLessonAPIs({ steps: {}, workdir: null }, LAB_FIELDS);
    mockProgressStore({ steps: {}, workdir: null });
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-7']);
    expect(await screen.findByRole('button', { name: /tôi đã hoàn thành bước cuối/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /tôi đã hoàn thành bước cuối/i }));
    await waitFor(() => expect(mocks.saveGuideProgress).toHaveBeenCalledWith(
      'test-token', 'INF1003', 'bai-1', expect.objectContaining({ stepId: 'buoc-7', done: true })
    ));
    expect(await screen.findByText('Đã hoàn thành bước cuối!')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /về tổng quan/i })).toHaveAttribute(
      'href', expect.stringContaining('/learning/INF1003/guides')
    );
    expect(screen.getByRole('button', { name: /đã hoàn thành bước cuối/i })).toBeDisabled();
  });

  it('all-done last step greets with the full-completion title', async () => {
    const steps = ['buoc-1', 'buoc-2', 'buoc-3', 'buoc-4', 'buoc-5', 'buoc-6', 'buoc-7'];
    await openStep(
      'buoc-7',
      { steps: Object.fromEntries(steps.map((id) => [id, { done: true, workdir: '' }])), workdir: 'C:\\lab1' },
      LAB_FIELDS
    );
    expect(await screen.findByText('Bạn đã hoàn thành bài thực hành!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /đã hoàn thành bước cuối/i })).toBeDisabled();
  });

  it('folder form rejects an invalid workdir inline without POST', async () => {
    await openStep('buoc-1');
    expect(await screen.findByText('Lưu đường dẫn thư mục của bạn')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tôi đã hoàn thành/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/đang dùng/i)).not.toBeInTheDocument();
    const input = screen.getByLabelText(/đường dẫn thư mục làm việc/i);
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /lưu đường dẫn & sang bước 2/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(mocks.saveGuideProgress).not.toHaveBeenCalled();
  });

  it('macOS saves a Unix directory and keeps the OS through next, back and sidebar navigation', async () => {
    mockLessonAPIs({ steps: {}, workdir: null }, LAB_FIELDS);
    mockProgressStore({ steps: {}, workdir: null });
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-1?os=macos']);
    const input = await screen.findByRole('textbox', { name: /đường dẫn thư mục làm việc/i });
    expect(input).toHaveAttribute('placeholder', '/Users/ban/lab1');
    fireEvent.change(input, { target: { value: '/Users/sinh vien/lab1' } });
    fireEvent.click(screen.getByRole('button', { name: /lưu đường dẫn.*sang bước 2/i }));
    await waitFor(() => expect(mocks.saveGuideProgress).toHaveBeenCalledWith(
      'test-token', 'INF1003', 'bai-1',
      { stepId: 'buoc-1', done: true, workdir: '/Users/sinh vien/lab1' }
    ));
    await screen.findByText('CHẶNG 2/7');
    expect(screen.getByText('macOS · Terminal')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /bước trước/i })).toHaveAttribute('href', expect.stringContaining('?os=macos'));
    fireEvent.click(screen.getByRole('button', { name: /Terminal → FE → BE: chép mã nguồn và kết nối/i }));
    await screen.findByText('CHẶNG 4/7');
    expect(screen.getAllByText(/cd -- '\/Users\/sinh vien\/lab1'/)[0]).toHaveTextContent('chmod 400 bdu-key-fe.pem bdu-key-be.pem');
    expect(screen.queryByText(/icacls/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /tôi đã hoàn thành.*sang bước 5/i }));
    await screen.findByText('CHẶNG 5/7');
    expect(screen.getByText('macOS · Terminal')).toBeInTheDocument();
  });

  it('macOS rejects a Windows or relative directory without saving', async () => {
    mockLessonAPIs();
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-1?os=macos']);
    const input = await screen.findByRole('textbox', { name: /đường dẫn thư mục làm việc/i });
    for (const value of ['C:\\lab1', '~/lab1', 'lab1']) {
      fireEvent.change(input, { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: /lưu đường dẫn.*sang bước 2/i }));
      expect(screen.getByRole('alert')).toHaveTextContent('/Users/ban/lab1');
    }
    expect(mocks.saveGuideProgress).not.toHaveBeenCalled();
  });

  it('changing from Windows to macOS requests the Mac directory before showing local commands', async () => {
    mockLessonAPIs({ steps: {}, workdir: 'C:\\lab1' }, LAB_FIELDS);
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-4?os=macos']);
    expect(await screen.findByText(/cần đường dẫn thư mục làm việc/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /lưu đường dẫn ở bước 1/i })).toHaveAttribute('href', expect.stringContaining('?os=macos'));
    expect(screen.queryByText(/chmod 400 bdu-key-fe.pem/)).not.toBeInTheDocument();
  });

  it('folder form prefills the saved workdir and posts done:true once', async () => {
    await openStep('buoc-1', { steps: {}, workdir: 'C:\\lab1' });
    expect(await screen.findByLabelText(/đường dẫn thư mục làm việc/i)).toHaveValue('C:\\lab1');
    fireEvent.click(screen.getByRole('button', { name: /lưu đường dẫn & sang bước 2/i }));
    await waitFor(() => expect(mocks.saveGuideProgress).toHaveBeenCalledWith(
      'test-token',
      'INF1003',
      'bai-1',
      expect.objectContaining({ stepId: 'buoc-1', done: true, workdir: 'C:\\lab1' })
    ));
    expect(await screen.findByText('Kết quả CloudShell')).toBeInTheDocument();
  });

  it('changing the workdir unmarks other steps but keeps buoc-2', async () => {
    await openStep(
      'buoc-1',
      { steps: { 'buoc-2': { done: true, workdir: '' }, 'buoc-3': { done: true, workdir: '' } }, workdir: 'C:\\old' }
    );
    const input = await screen.findByLabelText(/đường dẫn thư mục làm việc/i);
    expect(input).toHaveValue('C:\\old');
    fireEvent.change(input, { target: { value: 'C:\\lab1' } });
    fireEvent.click(screen.getByRole('button', { name: /lưu đường dẫn & sang bước 2/i }));
    await waitFor(() => expect(mocks.saveGuideProgress).toHaveBeenCalledWith(
      'test-token', 'INF1003', 'bai-1', expect.objectContaining({ stepId: 'buoc-3', done: false })
    ));
    const calledStepIds = mocks.saveGuideProgress.mock.calls.map((call) => call[3]?.stepId);
    expect(calledStepIds).toContain('buoc-1');
    expect(calledStepIds).not.toContain('buoc-2');
    expect(await screen.findByText('Kết quả CloudShell')).toBeInTheDocument();
  });

  it('keeping the same workdir only marks buoc-1 without resetting others', async () => {
    await openStep(
      'buoc-1',
      { steps: { 'buoc-2': { done: true, workdir: '' }, 'buoc-3': { done: true, workdir: '' } }, workdir: 'C:\\lab1' }
    );
    await screen.findByLabelText(/đường dẫn thư mục làm việc/i);
    fireEvent.click(screen.getByRole('button', { name: /lưu đường dẫn & sang bước 2/i }));
    await waitFor(() => expect(mocks.saveGuideProgress).toHaveBeenCalledTimes(1));
    expect(mocks.saveGuideProgress).toHaveBeenCalledWith(
      'test-token', 'INF1003', 'bai-1', expect.objectContaining({ stepId: 'buoc-1', done: true })
    );
  });

  it('result form shows the original guide, image and prev link without a summary panel', async () => {
    await openStep('buoc-2', { steps: {}, workdir: null });
    expect(await screen.findByText('Kết quả CloudShell')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /bdu-lab-v1:/i })).toBeInTheDocument();
    expect(screen.getByText(/bôi đen và copy toàn bộ chuỗi/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /phân tích & sang bước 3/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /bước trước/i })).toBeInTheDocument();
    expect(screen.queryByText(/dán lại/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tôi đã hoàn thành/i })).not.toBeInTheDocument();
  });

  it('empty lab token errors inline without POST', async () => {
    await openStep('buoc-2', { steps: {}, workdir: null });
    fireEvent.click(await screen.findByRole('button', { name: /phân tích & sang bước 3/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(mocks.saveLabResult).not.toHaveBeenCalled();
  });

  it('invalid lab token surfaces the server message inline', async () => {
    const serverMessage = 'Không tìm thấy dòng BDU-LAB-V1: trong nội dung đã dán.';
    const invalid = Object.assign(new Error(serverMessage), { status: 400, code: 'GUIDE_LAB_RESULT_INVALID' });
    mocks.saveLabResult.mockRejectedValueOnce(invalid);
    await openStep('buoc-2', { steps: {}, workdir: null });
    fireEvent.change(await screen.findByLabelText(/bdu-lab-v1:/i), { target: { value: 'dòng sai giả lập' } });
    fireEvent.click(screen.getByRole('button', { name: /phân tích & sang bước 3/i }));
    await waitFor(() => expect(mocks.saveLabResult).toHaveBeenCalledWith(
      'test-token', 'INF1003', 'bai-1', expect.objectContaining({ token: 'dòng sai giả lập' })
    ));
    expect(await screen.findByRole('alert')).toHaveTextContent(serverMessage);
  });

  it('valid lab token resets other steps except buoc-1, marks buoc-2 and advances', async () => {
    mocks.saveLabResult.mockResolvedValueOnce(LAB_FIELDS);
    await openStep(
      'buoc-2',
      {
        steps: { 'buoc-1': { done: true, workdir: 'C:\\lab1' }, 'buoc-3': { done: true, workdir: '' }, 'buoc-4': { done: true, workdir: '' } },
        workdir: 'C:\\lab1'
      }
    );
    fireEvent.change(await screen.findByLabelText(/bdu-lab-v1:/i), { target: { value: 'BDU-LAB-V1:dG9rZW4=' } });
    fireEvent.click(screen.getByRole('button', { name: /phân tích & sang bước 3/i }));
    await waitFor(() => expect(mocks.saveLabResult).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.saveGuideProgress).toHaveBeenCalledWith(
      'test-token', 'INF1003', 'bai-1', expect.objectContaining({ stepId: 'buoc-2', done: true })
    ));
    const calledStepIds = mocks.saveGuideProgress.mock.calls.map((call) => call[3]?.stepId);
    expect(calledStepIds).toContain('buoc-3');
    expect(calledStepIds).toContain('buoc-4');
    expect(calledStepIds).not.toContain('buoc-1');
    expect(await screen.findByText('2. Tải bdu-key-fe.pem')).toBeInTheDocument();
  });

  it('re-pasting the same token keeps other steps and still advances', async () => {
    mocks.saveLabResult.mockResolvedValueOnce(LAB_FIELDS);
    await openStep(
      'buoc-2',
      { steps: { 'buoc-1': { done: true, workdir: 'C:\\lab1' }, 'buoc-3': { done: true, workdir: '' } }, workdir: 'C:\\lab1' },
      LAB_FIELDS
    );
    fireEvent.change(await screen.findByLabelText(/bdu-lab-v1:/i), { target: { value: 'BDU-LAB-V1:dG9rZW4=' } });
    fireEvent.click(screen.getByRole('button', { name: /phân tích & sang bước 3/i }));
    await waitFor(() => expect(mocks.saveGuideProgress).toHaveBeenCalledTimes(1));
    expect(mocks.saveGuideProgress).toHaveBeenCalledWith(
      'test-token', 'INF1003', 'bai-1', expect.objectContaining({ stepId: 'buoc-2', done: true })
    );
  });

  it('existing lab result shows the reuse line linking to the next step', async () => {
    await openStep('buoc-2', { steps: {}, workdir: null }, LAB_FIELDS);
    expect(await screen.findByText(/đã có kết quả hợp lệ cho vùng Asia Pacific \(Singapore\) \(ap-southeast-1\)/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /dùng kết quả đã lưu · sang bước 3/i })).toHaveAttribute(
      'href', expect.stringContaining('buoc-3')
    );
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

  it('ignores progress cached under a previous progressVersion', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['guide-progress', 'INF1003', 'bai-1', 'phien-ban-cu', '24050001'], {
      steps: { 'buoc-1': { done: true, workdir: '' } },
      workdir: null
    });
    mockLessonAPIs({ steps: {}, workdir: 'C:\\lab1' });
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-1'], client);
    await waitFor(() => expect(mocks.getGuideProgress).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /lưu đường dẫn & sang bước 2/i })).toBeEnabled();
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
    mocks.getLabResult.mockResolvedValue(null);
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

  it('remount keeps the completed last step (done button disabled + panel)', async () => {
    mockLessonAPIs({ steps: { 'buoc-7': { done: true, workdir: '' } }, workdir: null }, LAB_FIELDS);
    const first = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-7'], first);
    await waitFor(() => expect(screen.getByRole('button', { name: /đã hoàn thành bước cuối/i })).toBeDisabled());
    expect(screen.getByText('Đã hoàn thành bước cuối!')).toBeInTheDocument();
    unmount();
    const second = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderLessonRoutes(['/learning/INF1003/guides/bai-1/buoc-7'], second);
    await waitFor(() => expect(screen.getByRole('button', { name: /đã hoàn thành bước cuối/i })).toBeDisabled());
    expect(mocks.getGuideProgress).toHaveBeenCalledTimes(2);
  });
});

describe('GuideLessonPage block data contract', () => {
  it('copies the macOS quick setup with a direct download URL before any folder or AWS result is saved', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
    const block = BAI_1_MACOS_LESSON.steps[0].blocks.find((item) => item.type === 'code');
    renderWithClient(<BlockRenderer block={block} workdir="" lab={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép lệnh' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      `mkdir -p "$HOME/lab1" && cd "$HOME/lab1" && curl -fL --retry 3 -o b5.zip '${window.location.origin}/guides/inf1003/b5.zip' && unzip -n b5.zip && rm b5.zip && open .`
    ));
    expect(screen.queryByText(/{{SITE_ORIGIN}}/)).not.toBeInTheDocument();
    expect(screen.queryByText(/chưa có kết quả tạo hạ tầng/i)).not.toBeInTheDocument();
  });

  it('copies a safely quoted macOS directory with spaces, apostrophes and shell characters', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderWithClient(
      <BlockRenderer
        block={{ type: 'code', lang: 'zsh', label: 'Terminal', text: 'chmod 400 bdu-key-fe.pem', localDirectory: true }}
        workdir="/Users/O'Brien/$lab 1"
        lab={{ FE_IP: '1.2.3.4' }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép lệnh' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("cd -- '/Users/O'\\''Brien/$lab 1' &&\nchmod 400 bdu-key-fe.pem"));
  });

  it('macOS local commands use Unix permissions and open, while AWS scripts stay shared', () => {
    const blocks = BAI_1_MACOS_LESSON.steps.flatMap((step) => step.blocks.flatMap((block) => [block, ...(block.blocks || [])]));
    const commands = blocks.filter((block) => block.type === 'code').map((block) => block.text).join('\n');
    expect(commands).not.toMatch(/icacls|curl\.exe|%USERDOMAIN%|&& \^|echo\.|start ""/);
    expect(commands).toContain('chmod 400 bdu-key-fe.pem bdu-key-be.pem');
    expect(commands).toContain('open "http://{{FE_IP}}:3000/"');
    expect(blocks.filter((block) => block.type === 'script').map((block) => block.scriptKey)).toEqual(['start', 'clean']);
  });
  it('prepends cd /d with the saved workdir for localDirectory code blocks', () => {
    renderWithClient(
      <BlockRenderer
        block={{ type: 'code', lang: 'cmd', label: 'Máy local', text: 'ssh -i bdu-key-fe.pem ubuntu@1.2.3.4', localDirectory: true }}
        workdir="C:\lab1"
        lab={{ FE_IP: '1.2.3.4' }}
      />
    );
    expect(screen.getByText(/cd \/d/)).toBeInTheDocument();
    expect(screen.getByText(/C:\\lab1/)).toBeInTheDocument();
  });

  it('gates connection and key-downloads blocks without a lab result', () => {
    renderWithClient(<BlockRenderer block={{ type: 'connection' }} workdir="" lab={null} />);
    expect(screen.getByText(/chưa có kết quả tạo hạ tầng/i)).toBeInTheDocument();
    cleanup();
    renderWithClient(<BlockRenderer block={{ type: 'key-downloads' }} workdir="" lab={null} />);
    expect(screen.getByText(/chưa có kết quả tạo hạ tầng/i)).toBeInTheDocument();
  });

  it('renders connection data from the lab connection prop', async () => {
    renderWithClient(
      <BlockRenderer
        block={{ type: 'connection' }}
        workdir=""
        lab={{ FE_IP: '54.1.2.3' }}
        connection={{ feIp: '54.1.2.3', beIp: '54.4.5.6', dbEndpoint: 'bdu-lab.abc123.rds.amazonaws.com' }}
      />
    );
    expect(await screen.findByText('54.1.2.3')).toBeInTheDocument();
  });

  it('renders key-download paths from the lab keys prop', async () => {
    renderWithClient(
      <BlockRenderer
        block={{ type: 'key-downloads' }}
        workdir=""
        lab={{ FE_IP: '54.1.2.3' }}
        keys={[{ label: 'Key FE', path: '/home/cloudshell/bdu-key-fe.pem' }]}
      />
    );
    expect(await screen.findByDisplayValue('/home/cloudshell/bdu-key-fe.pem')).toBeInTheDocument();
  });

  it('substitutes lab vars (FE_IP/BE_IP/DB_ENDPOINT) into code blocks', async () => {
    renderWithClient(
      <BlockRenderer
        block={{ type: 'code', lang: 'bash', label: 'SSH', text: 'ssh -i key.pem ubuntu@{{FE_IP}} && echo {{DB_ENDPOINT}}' }}
        workdir=""
        lab={{ FE_IP: '54.1.2.3' }}
        vars={{ FE_IP: '54.1.2.3', BE_IP: '54.4.5.6', DB_ENDPOINT: 'bdu-lab.abc123.rds.amazonaws.com' }}
      />
    );
    expect(await screen.findByText(/54\.1\.2\.3/)).toBeInTheDocument();
    expect(screen.getByText(/bdu-lab\.abc123\.rds\.amazonaws\.com/)).toBeInTheDocument();
    expect(screen.queryByText(/{{FE_IP}}/)).not.toBeInTheDocument();
  });
});

describe('stepClean', () => {
  it('buoc-1 needs workdir only', () => {
    expect(stepClean({ id: 'buoc-1', folderInput: true }, { hasResult: true, hasWorkdir: false })).toBe(false);
    expect(stepClean({ id: 'buoc-1', folderInput: true }, { hasResult: false, hasWorkdir: true })).toBe(true);
  });

  it('buoc-2 needs a saved lab result only', () => {
    expect(stepClean({ id: 'buoc-2', resultInput: true }, { hasResult: false, hasWorkdir: true })).toBe(false);
    expect(stepClean({ id: 'buoc-2', resultInput: true }, { hasResult: true, hasWorkdir: false })).toBe(true);
  });

  it('buoc-4 needs both result and directory', () => {
    const step = { id: 'buoc-4', requiresResult: true, requiresDirectory: true };
    expect(stepClean(step, { hasResult: true, hasWorkdir: false })).toBe(false);
    expect(stepClean(step, { hasResult: false, hasWorkdir: true })).toBe(false);
    expect(stepClean(step, { hasResult: true, hasWorkdir: true })).toBe(true);
  });

  it('buoc-7 has no requirements', () => {
    expect(stepClean({ id: 'buoc-7' }, { hasResult: false, hasWorkdir: false })).toBe(true);
    expect(stepClean(null, { hasResult: true, hasWorkdir: true })).toBe(false);
  });
});

describe('GuideIndexPage resume', () => {
  function DestinationProbe() {
    const { pathname, search } = useLocation();
    return <p>{pathname}{search}</p>;
  }

  function mockIndexGuide(doneCount) {
    mocks.getCourseGuide.mockResolvedValue({
      enabled: true,
      lessons: [{
        id: 'bai-1',
        title: 'Bài 1 — Dựng web 3 tầng trên AWS',
        progressVersion: 'cmd-be-first-v4',
        stepIds: ['buoc-1', 'buoc-2', 'buoc-3', 'buoc-4', 'buoc-5', 'buoc-6', 'buoc-7'],
        doneCount
      }]
    });
  }

  function renderIndex() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <MemoryRouter initialEntries={['/learning/INF1003/guides']}>
        <QueryClientProvider client={client}>
          <Routes>
            <Route path="/learning/:courseCode/guides" element={<GuideIndexPage />} />
            <Route path="/learning/:courseCode/guides/:lessonId/:stepId" element={<DestinationProbe />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    );
  }

  it('Học tiếp → bước đầu tiên chưa xong (buoc-3 khi doneCount=2)', async () => {
    mockIndexGuide(2);
    renderIndex();
    const link = await screen.findByRole('link', { name: /học tiếp/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('buoc-3'));
  });

  it('Bắt đầu → buoc-1 khi chưa làm gì', async () => {
    mockIndexGuide(0);
    renderIndex();
    const link = await screen.findByRole('link', { name: /bắt đầu/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('buoc-1'));
  });

  it.each(['windows', 'macos'])('Bắt đầu asks for the OS, then opens the chosen %s lesson', async (platform) => {
    mockIndexGuide(0);
    renderIndex();
    fireEvent.click(await screen.findByRole('link', { name: /bắt đầu/i }));
    expect(screen.getByRole('dialog', { name: /hệ điều hành nào/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: platform === 'macos' ? 'macOS · Terminal' : 'Windows · CMD' }));
    expect(await screen.findByText(`/learning/INF1003/guides/bai-1/buoc-1?os=${platform}`)).toBeInTheDocument();
  });

  it('Học tiếp asks for the OS and keeps the first unfinished step', async () => {
    mockIndexGuide(2);
    renderIndex();
    fireEvent.click(await screen.findByRole('link', { name: /học tiếp/i }));
    fireEvent.click(screen.getByRole('button', { name: 'macOS · Terminal' }));
    expect(await screen.findByText('/learning/INF1003/guides/bai-1/buoc-3?os=macos')).toBeInTheDocument();
  });

  it('Escape cancels the OS choice and restores focus without navigation or progress changes', async () => {
    mockIndexGuide(0);
    renderIndex();
    const start = await screen.findByRole('link', { name: /bắt đầu/i });
    start.focus();
    fireEvent.click(start);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(start).toHaveFocus();
    expect(mocks.saveGuideProgress).not.toHaveBeenCalled();
  });

  it('làm xong hết → fallback buoc-1', async () => {
    mockIndexGuide(7);
    renderIndex();
    const link = await screen.findByRole('link', { name: /học tiếp/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('buoc-1'));
  });
});

describe('GuideIndexPage reset', () => {
  const setupKey = `bdu:guide-setup:24050001:INF1003:bai-1:${BAI_1_MACOS_LESSON.progressVersion}`;
  function mockIndexGuide(doneCount) {
    mocks.getCourseGuide.mockResolvedValue({
      enabled: true,
      lessons: [{
        id: 'bai-1',
        title: 'Bài 1 — Dựng web 3 tầng trên AWS',
        progressVersion: 'cmd-be-first-v4',
        stepIds: ['buoc-1', 'buoc-2', 'buoc-3', 'buoc-4', 'buoc-5', 'buoc-6', 'buoc-7'],
        doneCount
      }]
    });
  }

  function StepProbe() {
    const { lessonId, stepId } = useParams();
    const { search } = useLocation();
    return <div>Chặng {lessonId}/{stepId}{search}</div>;
  }

  function renderIndexRoutes(client) {
    const queryClient = client || new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      <MemoryRouter initialEntries={['/learning/INF1003/guides']}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/learning/:courseCode/guides" element={<GuideIndexPage />} />
            <Route path="/learning/:courseCode/guides/:lessonId/:stepId" element={<StepProbe />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    );
    return invalidateSpy;
  }

  it('hủy xác nhận → không gọi API', async () => {
    window.localStorage.setItem(setupKey, 'local');
    mockIndexGuide(2);
    const ask = vi.fn().mockResolvedValue(false);
    confirmMocks.impl = ask;
    renderIndexRoutes();
    fireEvent.click(await screen.findByRole('button', { name: /làm lại từ đầu/i }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(mocks.resetGuideProgress).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(setupKey)).toBe('local');
    expect(screen.getByRole('link', { name: /học tiếp/i })).toBeInTheDocument();
  });

  it.each(['windows', 'macos'])('xác nhận → DELETE đúng URL, xóa lựa chọn AWS CLI và về CloudShell trên %s', async (platform) => {
    window.localStorage.setItem(setupKey, 'local');
    const oldSetupKey = 'bdu:guide-setup:24050001:INF1003:bai-1:previous-version';
    const otherUserKey = 'bdu:guide-setup:another-student:INF1003:bai-1:previous-version';
    window.localStorage.setItem(oldSetupKey, 'local');
    window.localStorage.setItem(otherUserKey, 'local');
    mockIndexGuide(2);
    const ask = vi.fn().mockResolvedValue(true);
    confirmMocks.impl = ask;
    mocks.resetGuideProgress.mockResolvedValue({ reset: true, deletedSteps: 2, deletedResult: 1 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const labKey = ['guide-lab-result', 'INF1003', 'bai-1', BAI_1_MACOS_LESSON.progressVersion, '24050001'];
    client.setQueryData(labKey, { KEY_SOURCE: 'LOCAL', token: 'old-result' });
    const invalidateSpy = renderIndexRoutes(client);
    fireEvent.click(await screen.findByRole('button', { name: /làm lại từ đầu/i }));
    await waitFor(() => expect(mocks.resetGuideProgress).toHaveBeenCalledTimes(1));
    expect(mocks.resetGuideProgress).toHaveBeenCalledWith('test-token', 'INF1003', 'bai-1');
    expect(ask.mock.calls[0][0].message).toMatch(/xóa/i);
    await waitFor(() => expect(
      invalidateSpy.mock.calls.some((call) => JSON.stringify(call[0]?.queryKey?.slice(0, 2)) === JSON.stringify(['course-guide', 'INF1003']))
    ).toBe(true));
    expect(
      invalidateSpy.mock.calls.some((call) => JSON.stringify(call[0]?.queryKey?.slice(0, 3)) === JSON.stringify(['guide-progress', 'INF1003', 'bai-1']))
    ).toBe(true);
    expect(await screen.findByRole('dialog', { name: /hệ điều hành nào/i })).toBeInTheDocument();
    expect(window.localStorage.getItem(setupKey)).toBeNull();
    expect(window.localStorage.getItem(oldSetupKey)).toBeNull();
    expect(window.localStorage.getItem(otherUserKey)).toBe('local');
    expect(client.getQueryData(labKey)).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: platform === 'macos' ? 'macOS · Terminal' : 'Windows · CMD' }));
    expect(await screen.findByText(`Chặng bai-1/buoc-1?os=${platform}&setup=cloudshell`)).toBeInTheDocument();
    expect(mocks.notify).toHaveBeenCalledWith(expect.stringMatching(/bắt đầu lại|đã xóa/i), 'success');
  });

  it('lỗi → toast message server, ở yên trang danh sách', async () => {
    window.localStorage.setItem(setupKey, 'local');
    mockIndexGuide(2);
    confirmMocks.impl = vi.fn().mockResolvedValue(true);
    const serverMessage = 'Không có quyền truy cập môn học.';
    mocks.resetGuideProgress.mockRejectedValueOnce(Object.assign(new Error(serverMessage), { status: 403 }));
    renderIndexRoutes();
    fireEvent.click(await screen.findByRole('button', { name: /làm lại từ đầu/i }));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(serverMessage, 'error'));
    expect(window.localStorage.getItem(setupKey)).toBe('local');
    expect(screen.getByRole('link', { name: /học tiếp/i })).toBeInTheDocument();
  });

  it('vô hiệu hóa nút trong lúc chờ DELETE rồi mở lại sau khi xong', async () => {
    mockIndexGuide(2);
    confirmMocks.impl = vi.fn().mockResolvedValue(true);
    let rejectReset;
    mocks.resetGuideProgress.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectReset = reject; })
    );
    renderIndexRoutes();
    const btn = await screen.findByRole('button', { name: /làm lại từ đầu/i });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.resetGuideProgress).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(btn).toBeDisabled());
    rejectReset(new Error('Lỗi mạng giả lập'));
    await waitFor(() => expect(btn).toBeEnabled());
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith('Lỗi mạng giả lập', 'error'));
    expect(screen.getByRole('link', { name: /học tiếp/i })).toBeInTheDocument();
  });
});
