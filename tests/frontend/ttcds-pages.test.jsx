import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTtcdsCapabilities: vi.fn(),
  getTtcdsGroups: vi.fn(),
  createTtcdsGroup: vi.fn(),
  deleteTtcdsGroup: vi.fn(),
  getTtcdsGroupMembers: vi.fn(),
  addTtcdsGroupMember: vi.fn(),
  removeTtcdsGroupMember: vi.fn(),
  getTtcdsStudent: vi.fn()
}));

vi.mock('../../client/src/api/ttcds.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ...mocks };
});
vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { name: 'Thầy TTCDS', mssv: '22050006' } }),
  useToasts: () => ({ notify: vi.fn() })
}));

import TtcdsPage from '../../client/src/features/ttcds/TtcdsPage.jsx';
import TtcdsGroupPage from '../../client/src/features/ttcds/TtcdsGroupPage.jsx';
import TtcdsHubPage from '../../client/src/features/ttcds/TtcdsHubPage.jsx';
import TtcdsStudentPage from '../../client/src/features/ttcds/TtcdsStudentPage.jsx';
import { summarizeTtcdsStudent } from '../../client/src/features/ttcds/TtcdsGroupPage.jsx';
import { navigation, filterNavigation, findRouteMeta } from '../../client/src/app/navigation.js';
import { parseMssvList } from '../../client/src/api/ttcds.js';

function renderAt(path, route, element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

const detailFixture = {
  ho_so: { mssv: '24050126', ten_day_du: 'Nguyễn Văn A', ma_lop: 'K29A', ten_khoa: 'CNTT', nien_khoa: 'K29' },
  gpa_hoc_ky: [{ nkhk: 1, dtb_hk_he_4: 3.2, dtb_tich_luy_he_4: 3.2, so_tin_chi_dat_hk: 15, xep_loai_hoc_ki: 'Khá' }],
  diem_danh: [{ nkhk: 1, di_hoc: 18, vang: 2 }],
  bang_diem: [{ nkhk: 1, ma_mon_hoc: 'CS101', ten_mon: 'Nhập môn', so_tin_chi: 3, diem: 8.5, diem_he_4: 3.5, diem_chu: 'B+' }],
  thoi_khoa_bieu: [{ nkhk: 1, ngay_hoc: '2026-09-01', thu: 'Thứ 2', tiet_bat_dau: 1, ten_mon: 'Nhập môn', phong: 'A101' }],
  su_kien: [{ nkhk: 1, ten_su_kien: 'Chào tân SV', ngay: '2026-09-05', loai: 'Chào đón' }],
  ren_luyen: [{ nkhk: 1, diem_ren_luyen: 85, xep_loai: 'Tốt' }]
};

describe('TTCDS frontend', () => {
  it('shows a 403 notice without access and hides the nav item', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: false, level: null });
    mocks.getTtcdsGroups.mockResolvedValue([]);
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    expect(await screen.findByText('Bạn không thuộc Trung tâm Chuyển đổi số.')).toBeInTheDocument();

    const item = navigation.find((entry) => entry.path === '/mystudent');
    expect(item).toBeTruthy();
    expect(item.label).toBe('Sinh viên của tôi');
    expect(filterNavigation(navigation, { can_access: false })).not.toContain(item);
    expect(filterNavigation(navigation, { can_access: true })).toContain(item);
  });

  it('titles the /mystudent route as Sinh vien cua toi', () => {
    expect(findRouteMeta('/mystudent').title).toBe('Sinh viên của tôi');
  });

  it('renders the service h1 and a compact group table', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29', member_count: 2 }]);
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Sinh viên của tôi' })).toBeInTheDocument();
    expect(await screen.findByText('K29 Tân sinh viên')).toBeInTheDocument();
    expect(screen.getByText('Niên khóa')).toBeInTheDocument();
    expect(screen.getByText('Số SV')).toBeInTheDocument();
    const nameLink = screen.getByRole('link', { name: 'K29 Tân sinh viên' });
    expect(nameLink.getAttribute('href')).toBe('/ttcds/groups/g1');
  });

  it('hides every write button for view-level users', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29', member_count: 2 }]);
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    await screen.findByText('K29 Tân sinh viên');
    expect(screen.queryByRole('button', { name: /Tạo nhóm/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xóa' })).not.toBeInTheDocument();
  });

  it('shows the create and delete buttons for create-level users', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29', member_count: 2 }]);
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    await screen.findByText('K29 Tân sinh viên');
    expect(screen.getByRole('button', { name: 'Tạo nhóm mới' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xóa' })).toBeInTheDocument();
  });

  it('shows a centered create CTA on empty for create-level users', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([]);
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    expect(await screen.findByText('Chưa có nhóm nào')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tạo nhóm đầu tiên' })).toBeInTheDocument();
  });

  it('shows guidance text without any button on empty for view-level users', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsGroups.mockResolvedValue([]);
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    expect(await screen.findByText('Chưa có nhóm nào')).toBeInTheDocument();
    expect(screen.getByText('Nhờ quản trị viên tạo nhóm và giao sinh viên cho bạn.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('group page shows an add-first-student CTA on empty for create-level users', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29' }]);
    mocks.getTtcdsGroupMembers.mockResolvedValue([]);
    renderAt('/ttcds/groups/g1', '/ttcds/groups/:id', <TtcdsGroupPage />);

    expect(await screen.findByText('Nhóm chưa có sinh viên')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thêm sinh viên đầu tiên' })).toBeInTheDocument();
  });

  it('group page shows waiting text without buttons on empty for view-level users', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29' }]);
    mocks.getTtcdsGroupMembers.mockResolvedValue([]);
    renderAt('/ttcds/groups/g1', '/ttcds/groups/:id', <TtcdsGroupPage />);

    expect(await screen.findByText('Nhóm chưa có sinh viên')).toBeInTheDocument();
    expect(screen.getByText('Nhờ quản trị viên giao sinh viên vào nhóm này.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thêm sinh viên đầu tiên' })).not.toBeInTheDocument();
  });

  it('renders the snapshot card with the latest 4 numbers', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsStudent.mockResolvedValue(detailFixture);
    renderAt('/ttcds/students/24050126', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    expect(await screen.findByText('Tổng quan kỳ gần nhất')).toBeInTheDocument();
    expect(screen.getByText('3.20 · Học kỳ 1')).toBeInTheDocument();
    expect(screen.getByText('18 có mặt · 2 vắng · 90.0% · Học kỳ 1')).toBeInTheDocument();
    expect(screen.getByText('85 · Tốt · kỳ 1')).toBeInTheDocument();
    expect(screen.getByText('1 sự kiện · kỳ 1')).toBeInTheDocument();
    // No per-term history tables in the overview tab anymore.
    expect(screen.queryByText('Điểm theo học kỳ')).not.toBeInTheDocument();
    expect(screen.queryByText('Điểm danh theo học kỳ')).not.toBeInTheDocument();
    expect(screen.queryByText('Điểm rèn luyện')).not.toBeInTheDocument();
  });

  it("renders '—' for ren luyen when the field is missing", async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsStudent.mockResolvedValue({ ...detailFixture, ren_luyen: [] });
    renderAt('/ttcds/students/24050126', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    expect(await screen.findByText('Tổng quan kỳ gần nhất')).toBeInTheDocument();
    expect(screen.getByText('Rèn luyện')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('service page has no admin section anymore', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([]);
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    await screen.findByText('Chưa có nhóm nào');
    expect(screen.queryByText('Quản trị phân quyền')).not.toBeInTheDocument();
  });

  it('hub renders the Sinh vien cua toi service card with the /mystudent link', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    renderAt('/ttcds', '/ttcds', <TtcdsHubPage />);

    const link = await screen.findByRole('link', { name: 'Sinh viên của tôi' });
    expect(link.getAttribute('href')).toBe('/mystudent');
    expect(screen.getByText('Sắp ra mắt')).toBeInTheDocument();
  });

  it('hub shows a 403 notice without access', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: false, level: null });
    renderAt('/ttcds', '/ttcds', <TtcdsHubPage />);

    expect(await screen.findByText('Bạn không thuộc Trung tâm Chuyển đổi số.')).toBeInTheDocument();
  });

  it('parses a pasted MSSV list on commas, spaces and semicolons', () => {
    expect(parseMssvList(' 24050126,24050006; 22050006\n24050127 ')).toEqual(
      ['24050126', '24050006', '22050006', '24050127']
    );
  });

  it('counts 0 term events when the student has no term (label says current term)', () => {
    expect(summarizeTtcdsStudent({
      ...detailFixture,
      gpa_hoc_ky: [],
      diem_danh: [],
      su_kien: [
        { nkhk: 1, ten_su_kien: 'A' },
        { nkhk: 2, ten_su_kien: 'B' }
      ]
    }).eventCount).toBe(0);
  });
});
