import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import GradeShareCard, {
  buildGradeCardPayload,
  resolveGradeTier
} from '../../client/src/components/grades/GradeShareCard.jsx';
import GpaPage from '../../client/src/features/gpa/GpaPage.jsx';
import ConfessionPage from '../../client/src/features/confession/ConfessionPage.jsx';
import { getGrades } from '../../client/src/api/academics.js';
import { createCommunityPost, getCommunityPosts } from '../../client/src/api/community.js';

const notifyMock = vi.fn();

vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { mssv: '23012345', name: 'Sinh Viên Test' } }),
  useRealtimeRoom: () => {},
  useRealtimeStatus: () => 'ready',
  useToasts: () => ({ notify: notifyMock })
}));

vi.mock('../../client/src/api/academics.js', () => ({
  getGrades: vi.fn(),
  getMyAcademicRanking: vi.fn(async () => ({})),
  getProfile: vi.fn(async () => ({}))
}));

vi.mock('../../client/src/api/identity.js', () => ({
  getIdentityFrames: vi.fn(async () => ({ frames: [] })),
  getMyIdentityPresentation: vi.fn(async () => ({ avatar_source: 'initials', selected_titles: [], available_titles: [] })),
  updateMyEquippedFrame: vi.fn(),
  updateMyIdentityPresentation: vi.fn(),
  uploadMyAvatar: vi.fn(async () => ({ source: 'override' })),
  deleteMyAvatar: vi.fn(async () => ({}))
}));

vi.mock('../../client/src/api/community.js', () => ({
  addCommunityPostComment: vi.fn(async () => ({})),
  createCommunityPost: vi.fn(async () => ({ id: 999 })),
  deleteCommunityPost: vi.fn(async () => ({})),
  getCommunityPostComments: vi.fn(async () => []),
  getCommunityPosts: vi.fn(async () => ({ posts: [] })),
  toggleCommunityPostLike: vi.fn(async () => ({})),
  updateCommunityPost: vi.fn(async () => ({})),
  uploadCommunityMedia: vi.fn(async () => ({}))
}));

const SEMESTERS = [
  {
    hoc_ky: '20261',
    ten_hoc_ky: 'Học kỳ 1 - Năm học 2026 - 2027',
    dtb_hk_he10: '8.80',
    dtb_hk_he4: '3.80',
    so_tin_chi_dat_tich_luy: '60',
    dtb_tich_luy_he_10: '8.40',
    dtb_tich_luy_he_4: '3.60',
    ds_diem_mon_hoc: [
      { ma_mon: 'INF1003', ten_mon: 'Lập trình Web nâng cao', so_tin_chi: 3, diem_tk: 9.2, diem_tk_so: 4.0, diem_tk_chu: 'A' },
      { ma_mon: 'INF2001', ten_mon: 'Mạng máy tính', so_tin_chi: 3 }
    ]
  }
];

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn()
    }))
  });
  getGrades.mockResolvedValue({ data: { ds_diem_hocky: SEMESTERS } });
});

afterEach(() => {
  cleanup();
});

describe('GradeShareCard & grade tiers', () => {
  it('phân loại đúng 5 thang điểm khác nhau (A, B, C, D, F)', () => {
    expect(resolveGradeTier({ score_10: 9.2, letter: 'A' })).toBe('excellent');
    expect(resolveGradeTier({ score_10: 8.1, letter: 'B+' })).toBe('good');
    expect(resolveGradeTier({ score_10: 6.2, letter: 'C' })).toBe('fair');
    expect(resolveGradeTier({ score_10: 4.5, letter: 'D' })).toBe('average');
    expect(resolveGradeTier({ score_10: 2.5, letter: 'F' })).toBe('fail');
  });

  it('hiển thị lớp giao diện tương ứng với từng thang điểm', () => {
    const tiers = [
      { diem_tk: 9.5, diem_tk_so: 4.0, diem_tk_chu: 'A', expected: 'excellent', label: 'Xuất sắc', watermark: '.gsc-watermark-dragon' },
      { diem_tk: 7.8, diem_tk_so: 3.0, diem_tk_chu: 'B', expected: 'good', label: 'Giỏi', watermark: '.gsc-watermark-phoenix' },
      { diem_tk: 6.5, diem_tk_so: 2.5, diem_tk_chu: 'C+', expected: 'fair', label: 'Khá', watermark: '.gsc-watermark-compass' },
      { diem_tk: 5.0, diem_tk_so: 1.5, diem_tk_chu: 'D+', expected: 'average', label: 'Qua môn', watermark: '.gsc-watermark-seal' },
      { diem_tk: 3.0, diem_tk_so: 0.0, diem_tk_chu: 'F', expected: 'fail', label: 'Chưa đạt', watermark: '.gsc-watermark-ember' }
    ];

    for (const item of tiers) {
      const payload = buildGradeCardPayload({
        ma_mon: 'TEST01',
        ten_mon: `Môn ${item.diem_tk_chu}`,
        so_tin_chi: 3,
        ...item
      }, { semester: 'HK1' });
      const { container, unmount } = render(<GradeShareCard card={payload} />);
      const card = container.querySelector('.grade-share-card');
      expect(card).toHaveClass(`is-tier-${item.expected}`);
      expect(card.getAttribute('data-grade-tier')).toBe(item.expected);
      expect(card.querySelector('.gsc-tier-pill')?.textContent).toContain(item.label);
      expect(card.querySelector(item.watermark)).toBeTruthy();
      expect(card.querySelector('.gsc-corner-filigree')).toBeTruthy();
      unmount();
    }
  });
});

describe('Luồng Khoe điểm từ Bảng điểm lên Confession', () => {
  it('cho phép khoe điểm môn đã có điểm và ẩn nút với môn chưa có điểm', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/gpa']}>
          <GpaPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Môn chưa có điểm -> mở chi tiết không có nút khoe điểm
    const ungradedRow = await screen.findByText('Mạng máy tính');
    fireEvent.click(ungradedRow);
    expect(await screen.findByText('Bảng Điểm Thành Phần Chi Tiết:')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Khoe điểm lên Confession/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));

    // Môn đã có điểm -> mở chi tiết có nút Khoe điểm lên Confession
    fireEvent.click(screen.getByText('Lập trình Web nâng cao'));
    const flexBtn = await screen.findByRole('button', { name: /Khoe điểm lên Confession/i });
    fireEvent.click(flexBtn);

    // Hộp thoại khoe điểm hiện preview thẻ điểm hạng Xuất sắc
    const dialog = await screen.findByRole('dialog', { name: 'Khoe điểm lên Confession' });
    expect(dialog.querySelector('.grade-share-card.is-tier-excellent')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Lời nhắn kèm theo/i), {
      target: { value: 'Qua môn ngon lành luôn!' }
    });
    fireEvent.click(screen.getByLabelText(/Đăng ẩn danh/i));
    fireEvent.click(screen.getByRole('button', { name: 'Đăng lên Confession' }));

    await waitFor(() => {
      expect(createCommunityPost).toHaveBeenCalledTimes(1);
    });
    expect(createCommunityPost).toHaveBeenCalledWith('test-token', {
      title: 'BDU Confession',
      content: 'Qua môn ngon lành luôn!',
      scope: 'school',
      scopeId: null,
      category: 'confession',
      isAnonymous: true,
      attachments: [
        expect.objectContaining({
          type: 'grade_card',
          course_name: 'Lập trình Web nâng cao',
          course_code: 'INF1003',
          score_10: 9.2,
          score_4: 4,
          letter: 'A',
          tier: 'excellent'
        })
      ]
    });
    expect(await screen.findByRole('button', { name: 'Xem trên Confession' })).toBeInTheDocument();
  });

  it('hiển thị thẻ khoe điểm trong bảng tin Confession', async () => {
    getCommunityPosts.mockResolvedValueOnce({
      posts: [
        {
          id: 501,
          title: 'BDU Confession',
          content: 'Khoe nhẹ điểm cuối kỳ!',
          scope: 'school',
          scope_id: null,
          category: 'confession',
          source: 'portal',
          is_anonymous: false,
          is_liked: false,
          is_mine: true,
          like_count: 3,
          comment_count: 0,
          created_at: new Date().toISOString(),
          attachments: [
            {
              type: 'grade_card',
              course_name: 'Trí tuệ nhân tạo',
              course_code: 'AI301',
              semester: 'HK1 2026-2027',
              credits: 3,
              score_10: 9.0,
              score_4: 4.0,
              letter: 'A',
              status: 'passed',
              tier: 'excellent'
            }
          ],
          author: { mssv: '23012345', name: 'Sinh Viên Test', is_anonymous: false }
        }
      ]
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <MemoryRouter initialEntries={['/confession']}>
        <QueryClientProvider client={client}>
          <ConfessionPage />
        </QueryClientProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText('Khoe nhẹ điểm cuối kỳ!')).toBeInTheDocument();
    expect(screen.getByText('Trí tuệ nhân tạo')).toBeInTheDocument();
    expect(screen.getByText('9.00')).toBeInTheDocument();
    expect(container.querySelector('.grade-share-card.is-tier-excellent')).toBeTruthy();
  });
});
