import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStudentProfile: vi.fn()
}));

vi.mock('../../client/src/api/students.js', () => ({
  getStudentProfile: mocks.getStudentProfile,
  searchActiveStudents: vi.fn(() => Promise.resolve([]))
}));

vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { name: 'Nguyễn Vũ Đạt', mssv: '24050126' } })
}));

import ConfessionProfilePage from '../../client/src/features/confession/ConfessionProfilePage.jsx';
import { renderContentWithMentions } from '../../client/src/features/confession/renderMentions.jsx';

const profilePayload = {
  mssv: '24050126',
  name: 'Nguyễn Vũ Đạt',
  avatar_url: '',
  equipped_frame_id: null,
  selected_titles: [{ id: 'title:ttcds', label: '#TTCDS', detail: 'Thành viên TTCDS', tone: 'blue' }],
  clans: [{ id: 1, name: 'Ngự Trù Tử', tag: 'NTT', role: 'member' }],
  academic: {
    gpa_10: 8.51,
    gpa_4: 3.63,
    earned_credits: 98,
    classification: 'Xuất sắc',
    rank_gpa: { hang: 1, pham_vi: 'trong viện' },
    rank_credits: { hang: 3, pham_vi: 'toàn trường' }
  }
};

function renderProfile() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/confession/profile/24050126']}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/confession/profile/:mssv" element={<ConfessionProfilePage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ConfessionProfilePage', () => {
  it('hiển thị banner định danh, clan và 4 card học lực kèm thứ hạng', async () => {
    mocks.getStudentProfile.mockResolvedValue(profilePayload);
    renderProfile();

    expect(await screen.findByText('Nguyễn Vũ Đạt')).toBeInTheDocument();
    expect(screen.getByText(/24050126/)).toBeInTheDocument();
    expect(screen.getByText(/Ngự Trù Tử/)).toBeInTheDocument();
    expect(screen.getByText('#TTCDS')).toBeInTheDocument();

    expect(screen.getByText('GPA TÍCH LŨY (10)')).toBeInTheDocument();
    expect(screen.getByText('8.51')).toBeInTheDocument();
    expect(screen.getByText('GPA TÍCH LŨY (4.0)')).toBeInTheDocument();
    expect(screen.getByText('3.63')).toBeInTheDocument();
    expect(screen.getByText('TÍN CHỈ ĐẠT')).toBeInTheDocument();
    expect(screen.getByText('98 TC')).toBeInTheDocument();
    expect(screen.getByText('XẾP LOẠI')).toBeInTheDocument();
    expect(screen.getByText('Xuất sắc')).toBeInTheDocument();

    expect(screen.getAllByText('#1 trong viện')).toHaveLength(2);
    expect(screen.getByText('#3 toàn trường')).toBeInTheDocument();

    expect(mocks.getStudentProfile).toHaveBeenCalledWith('test-token', '24050126', expect.anything());
  });

  it('có nút quay về và hiện thông báo khi không tìm thấy hồ sơ', async () => {
    mocks.getStudentProfile.mockRejectedValue(new Error('Không tìm thấy sinh viên.'));
    renderProfile();

    expect(await screen.findByRole('button', { name: '← Quay về' })).toBeInTheDocument();
    expect(await screen.findByText('Không tìm thấy hồ sơ')).toBeInTheDocument();
  });

  it('render khung anime kèm hiệu ứng cinematic mà không lỗi', async () => {
    mocks.getStudentProfile.mockResolvedValue({
      ...profilePayload,
      equipped_frame_id: 'frame:anime-sukuna',
      clans: []
    });
    renderProfile();

    expect(await screen.findByText('Ngự Trù Tử')).toBeInTheDocument();
    expect(screen.getByText(/MALEVOLENT • DOMAIN SIGNATURE/)).toBeInTheDocument();
    expect(screen.getByText('SIGNATURE')).toBeInTheDocument();
  });

  it('hiển thị -- thay vì 0.00 khi chưa có GPA hệ 10/tín chỉ', async () => {
    mocks.getStudentProfile.mockResolvedValue({
      ...profilePayload,
      academic: { ...profilePayload.academic, gpa_10: null, earned_credits: null }
    });
    renderProfile();

    expect(await screen.findByText('GPA TÍCH LŨY (10)')).toBeInTheDocument();
    expect(screen.getAllByText('--')).toHaveLength(2);
  });

  it('mention chip điều hướng sang /confession/profile/:mssv thay vì trang lý lịch', async () => {
    render(
      <MemoryRouter initialEntries={['/confession']}>
        <Routes>
          <Route
            path="/confession"
            element={(
              <>
                {renderContentWithMentions('chào @24050126', [{ mssv: '24050126', full_name: 'Nguyễn Vũ Đạt' }])}
                <LocationProbe />
              </>
            )}
          />
          <Route path="/confession/profile/:mssv" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: '@Nguyễn Vũ Đạt' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/confession/profile/24050126'));
  });
});
