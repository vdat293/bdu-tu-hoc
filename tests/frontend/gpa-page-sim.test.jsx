import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import GpaPage from '../../client/src/features/gpa/GpaPage.jsx';
import { getGrades, getMyAcademicRanking } from '../../client/src/api/academics.js';
import { uploadMyAvatar, deleteMyAvatar, getMyIdentityPresentation } from '../../client/src/api/identity.js';

vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { mssv: '23012345', name: 'Sinh Viên Test' } }),
  useToasts: () => ({ notify: vi.fn() })
}));

vi.mock('../../client/src/api/academics.js', () => ({
  getGrades: vi.fn(),
  getMyAcademicRanking: vi.fn(async () => ({})),
  getProfile: vi.fn(async () => ({}))
}));

vi.mock('../../client/src/api/identity.js', () => ({
  getMyIdentityPresentation: vi.fn(async () => ({ avatar_source: 'initials' })),
  uploadMyAvatar: vi.fn(async () => ({ source: 'override' })),
  deleteMyAvatar: vi.fn(async () => ({}))
}));

const SEMESTERS = [
  {
    hoc_ky: '20253',
    ten_hoc_ky: 'Học kỳ 1 - Năm học 2026 - 2027',
    dtb_hk_he10: '',
    dtb_hk_he4: '',
    so_tin_chi_dat_tich_luy: '50',
    dtb_tich_luy_he_10: '8.00',
    dtb_tich_luy_he_4: '3.50',
    ds_diem_mon_hoc: [
      { ma_mon: 'A101', ten_mon: 'Môn đã có điểm', so_tin_chi: 3, diem_tk: 8.0, diem_tk_so: 3.5, diem_tk_chu: 'B+' },
      { ma_mon: 'E101', ten_mon: 'Môn chưa có điểm', so_tin_chi: 3 }
    ]
  }
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/gpa']}>
        <GpaPage />
      </MemoryRouter>
    </QueryClientProvider>,
    { baseElement: document.body }
  );
}

async function openPrediction() {
  await screen.findByText('Môn chưa có điểm');
  fireEvent.click(screen.getByRole('button', { name: /Dự đoán điểm/ }));
  expect(await screen.findByText('Đây chỉ là tính thử, không phải sửa điểm')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Bắt đầu tính thử' })).toBeDisabled();
  fireEvent.click(screen.getByText('Tôi đã hiểu, đây chỉ là tính thử.'));
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu tính thử' }));
  return {
    gkInput: await screen.findByLabelText('Điểm giữa kỳ tính thử môn Môn chưa có điểm'),
    ckInput: screen.getByLabelText('Điểm thi tính thử môn Môn chưa có điểm')
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Giả lập màn hình điện thoại để bỏ qua biểu đồ Chart.js trong jsdom.
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
  // jsdom không nạp ảnh thật: giả lập Image để popup cắt ảnh nhận kích thước.
  const RealImage = window.Image;
  class MockImage {
    constructor() {
      this.naturalWidth = 800;
      this.naturalHeight = 600;
      this.onload = null;
      this.onerror = null;
    }
    set src(value) {
      this._src = value;
      queueMicrotask(() => this.onload?.());
    }
    get src() {
      return this._src;
    }
  }
  window.Image = MockImage;
  window.__restoreRealImage = () => { window.Image = RealImage; };
  getGrades.mockResolvedValue({ data: { ds_diem_hocky: SEMESTERS } });
});

afterEach(() => {
  window.__restoreRealImage?.();
  cleanup();
});

describe('gpa simulation end-to-end on GpaPage', () => {
  it('mặc định là bảng thường, mở tính thử phải qua hộp thoại', async () => {
    renderPage();
    await screen.findByText('Môn chưa có điểm');
    // Chưa mở: không có ô nhập thử, chỉ có nút mở.
    expect(screen.queryByLabelText(/tính thử môn Môn chưa có điểm/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dự đoán điểm/ })).toBeInTheDocument();

    const { gkInput, ckInput } = await openPrediction();
    fireEvent.change(gkInput, { target: { value: '8' } });
    fireEvent.change(ckInput, { target: { value: '7' } });

    // GPA học kỳ chuyển sang số thử làm số chính.
    await waitFor(() => expect(screen.getByText(/Tính thử học kỳ này:/)).toBeInTheDocument());
    expect(screen.getByText('7.40')).toBeInTheDocument();
    // Dải tổng kết dưới bảng hiện GPA thử.
    const summary = screen.getByLabelText(/Tổng kết Học kỳ 1/);
    expect(summary).toHaveTextContent('7.70');
    expect(summary).toHaveTextContent('(thử)');
    // Nhãn có dấu ":" và cụm tích lũy lấy thẳng số API (không tự tính).
    expect(summary).toHaveTextContent('GPA HK (4):');
    expect(summary).toHaveTextContent('Tín chỉ tích lũy:');
    expect(summary).toHaveTextContent('50');
    expect(summary).toHaveTextContent('3.50');

    // Nút Kết thúc dự đoán trên banner: xóa hết + thu gọn về bình thường.
    const endButtons = screen.getAllByRole('button', { name: 'Kết thúc dự đoán' });
    expect(endButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(endButtons[0]);
    await waitFor(() => expect(screen.queryByLabelText(/tính thử môn Môn chưa có điểm/)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Dự đoán điểm/ })).toBeInTheDocument();
  });

  it('Kết thúc dự đoán về lại bảng thường, mở lại bắt buộc hiện hộp thoại', async () => {
    renderPage();
    await openPrediction();
    const gkInput = screen.getByLabelText('Điểm giữa kỳ tính thử môn Môn chưa có điểm');
    fireEvent.change(gkInput, { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Điểm thi tính thử môn Môn chưa có điểm'), { target: { value: '7' } });
    await screen.findByText('7.40');

    // Nút Kết thúc dự đoán của từng kỳ (nút cuối; nút đầu nằm trên banner).
    const endButtons = screen.getAllByRole('button', { name: 'Kết thúc dự đoán' });
    fireEvent.click(endButtons[endButtons.length - 1]);
    // Về lại bình thường: mất ô nhập, mất số thử, mất banner, nút mở hiện lại.
    await waitFor(() => expect(screen.queryByLabelText(/tính thử môn Môn chưa có điểm/)).not.toBeInTheDocument());
    expect(screen.queryByText('7.40')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kết thúc dự đoán' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dự đoán điểm/ })).toBeInTheDocument();

    // Mở lại từ trạng thái bình thường: bắt buộc hiện hộp thoại lần nữa.
    fireEvent.click(screen.getByRole('button', { name: /Dự đoán điểm/ }));
    expect(await screen.findByText('Đây chỉ là tính thử, không phải sửa điểm')).toBeInTheDocument();
  });

  it('môn đã có điểm tổng kết không hiện ô nhập thử', async () => {
    renderPage();
    await openPrediction();
    expect(screen.queryByLabelText(/tính thử môn Môn đã có điểm/)).not.toBeInTheDocument();
  });

  it('bấm avatar mở popup ảnh đại diện, chọn ảnh mới rồi qua popup căn chỉnh', async () => {
    const { container } = renderPage();
    await screen.findByText('Môn chưa có điểm');

    const avatarButton = screen.getByRole('button', { name: 'Ảnh đại diện' });
    expect(avatarButton).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(avatarButton);

    const manager = await screen.findByRole('dialog', { name: 'Ảnh đại diện' });
    expect(within(manager).getByRole('button', { name: /Tải ảnh từ máy/ })).toBeInTheDocument();
    expect(within(manager).queryByRole('button', { name: /Gỡ ảnh hiện tại/ })).not.toBeInTheDocument();

    fireEvent.click(within(manager).getByRole('button', { name: /Tải ảnh từ máy/ }));

    const fileInput = container.querySelector('#hero-avatar + input[type="file"]');
    expect(fileInput).not.toBeNull();
    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    const cropDialog = await screen.findByRole('dialog', { name: 'Chỉnh ảnh đại diện' });
    expect(uploadMyAvatar).not.toHaveBeenCalled();
    fireEvent.click(within(cropDialog).getByRole('button', { name: 'Chọn ảnh này' }));

    await waitFor(() => expect(uploadMyAvatar).toHaveBeenCalledWith('test-token', file));
  });

  it('popup ảnh đại diện có mục gỡ ảnh khi đang dùng ảnh tự upload', async () => {
    getMyIdentityPresentation.mockResolvedValueOnce({
      avatar_source: 'override',
      avatar_url: '/media/r2/avatars/23012345/abc.webp'
    });
    renderPage();
    await screen.findByText('Môn chưa có điểm');

    fireEvent.click(screen.getByRole('button', { name: 'Ảnh đại diện' }));
    const manager = await screen.findByRole('dialog', { name: 'Ảnh đại diện' });
    fireEvent.click(within(manager).getByRole('button', { name: /Gỡ ảnh hiện tại/ }));

    await waitFor(() => expect(deleteMyAvatar).toHaveBeenCalledWith('test-token'));
  });

  it('huỷ popup căn chỉnh thì không upload ảnh', async () => {
    const { container } = renderPage();
    await screen.findByText('Môn chưa có điểm');
    fireEvent.click(screen.getByRole('button', { name: 'Ảnh đại diện' }));
    fireEvent.click(await screen.findByRole('button', { name: /Tải ảnh từ máy/ }));

    const fileInput = container.querySelector('#hero-avatar + input[type="file"]');
    fireEvent.change(fileInput, {
      target: { files: [new File(['avatar'], 'avatar.png', { type: 'image/png' })] }
    });
    const dialog = await screen.findByRole('dialog', { name: 'Chỉnh ảnh đại diện' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Huỷ' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chỉnh ảnh đại diện' })).not.toBeInTheDocument());
    expect(uploadMyAvatar).not.toHaveBeenCalled();
  });

});
