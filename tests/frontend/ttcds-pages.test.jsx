import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  getTtcdsStudent: vi.fn(),
  getTtcdsAttendance: vi.fn(),
  searchTtcdsStudents: vi.fn()
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
import { summarizeTtcdsStudent, searchMinLength } from '../../client/src/features/ttcds/TtcdsGroupPage.jsx';
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
  thoi_khoa_bieu: [{ nkhk: 1, ngay_hoc: '2026-09-01', thu: 'Thứ 2', thu_kieu_so: 2, tiet_bat_dau: 1, so_tiet: 2, ma_mon_hoc: 'CS101', ten_mon: 'Nhập môn', phong: 'A101', giang_vien: 'Thầy A' }],
  diem_danh_mon: [{ nkhk: 1, ma_mon_hoc: 'CS101', so_buoi: 4, di_hoc: 3, vang: 1 }],
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
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', mentor: 'Thầy TTCDS', member_count: 2 }]);
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Sinh viên của tôi' })).toBeInTheDocument();
    expect(await screen.findByText('K29 Tân sinh viên')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Mentor' })).toBeInTheDocument();
    expect(screen.getByText('Số SV')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Niên khóa' })).not.toBeInTheDocument();
    expect(screen.getByText('Thầy TTCDS')).toBeInTheDocument();
    expect(screen.getByText('Số nhóm')).toBeInTheDocument();
    expect(screen.getByText('Tổng sinh viên')).toBeInTheDocument();
    const nameLink = screen.getByRole('link', { name: 'K29 Tân sinh viên' });
    expect(nameLink.getAttribute('href')).toBe('/ttcds/groups/g1');
  });

  it('hides every write button for view-level users', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29', member_count: 2 }]);
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    await screen.findByText('K29 Tân sinh viên');
    expect(screen.queryByRole('button', { name: /Tạo nhóm/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Xóa nhóm/ })).not.toBeInTheDocument();
  });

  it('shows the create and delete buttons for create-level users', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29', member_count: 2 }]);
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    await screen.findByText('K29 Tân sinh viên');
    expect(screen.getByRole('button', { name: 'Tạo nhóm mới' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xóa nhóm K29 Tân sinh viên' })).toBeInTheDocument();
  });

  it('asks for confirmation with the group name before deleting', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29', member_count: 2 }]);
    mocks.deleteTtcdsGroup.mockResolvedValue({});
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Xóa nhóm K29 Tân sinh viên' }));
    expect(mocks.deleteTtcdsGroup).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('K29 Tân sinh viên');

    fireEvent.click(screen.getByRole('button', { name: 'Xóa nhóm' }));
    await waitFor(() => expect(mocks.deleteTtcdsGroup).toHaveBeenCalledWith('test-token', 'g1'));
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

  it('group header keeps both actions in one container and hides the mentor prefix when absent', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29' }]);
    mocks.getTtcdsGroupMembers.mockResolvedValue([{ mssv: '24050126' }]);
    mocks.getTtcdsStudent.mockResolvedValue(detailFixture);
    renderAt('/ttcds/groups/g1', '/ttcds/groups/:id', <TtcdsGroupPage />);

    await screen.findByText('K29 Tân sinh viên');
    const actions = document.querySelector('#tab-ttcds-group .club-directory-hero__action');
    expect(actions).not.toBeNull();
    expect(within(actions).getByRole('button', { name: 'Thêm sinh viên' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Tải lại' })).toBeInTheDocument();
    expect(screen.getByText('1 sinh viên')).toBeInTheDocument();
    expect(screen.queryByText(/Mentor:/)).not.toBeInTheDocument();
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

  it('group page lists members in a table with the eight required columns', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', mentor: 'Thầy TTCDS', nien_khoa: 'K29' }]);
    mocks.getTtcdsGroupMembers.mockResolvedValue([{ mssv: '24050126' }]);
    mocks.getTtcdsStudent.mockResolvedValue(detailFixture);
    renderAt('/ttcds/groups/g1', '/ttcds/groups/:id', <TtcdsGroupPage />);

    expect(await screen.findByText(/Mentor:/)).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(table.parentElement).toHaveClass('table-scroll');
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((cell) => cell.textContent)).toEqual(
      ['MSSV', 'Họ tên', 'Lớp', 'GPA tích lũy', 'Chuyên cần kỳ này', 'Rèn luyện', 'Sự kiện', 'Hành động']
    );
    expect(headers.every((cell) => cell.getAttribute('scope') === 'col')).toBe(true);
    const nameLink = screen.getByRole('link', { name: 'Nguyễn Văn A' });
    expect(nameLink.getAttribute('href')).toBe('/ttcds/students/24050126');
    expect(screen.getByRole('link', { name: 'Chi tiết sinh viên Nguyễn Văn A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xóa sinh viên Nguyễn Văn A' })).toBeInTheDocument();
  });

  it('renders the latest snapshot as four ttcds stat tiles without legacy classes', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsStudent.mockResolvedValue(detailFixture);
    renderAt('/ttcds/students/24050126', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    expect(await screen.findByText('Tổng quan kỳ gần nhất')).toBeInTheDocument();
    expect(document.querySelector('.profile-hero-card')).not.toBeNull();
    // Task 6 "phân ô": chip .hero-tags cũ thành lưới ô con có viền.
    expect(document.querySelector('.profile-hero-card .hero-tags')).toBeNull();
    expect(document.querySelector('.profile-hero-card .ttcds-cell-grid')).not.toBeNull();
    expect(document.querySelectorAll('.profile-hero-card .ttcds-cell').length).toBe(5);
    expect(screen.getByText('Lớp')).toBeInTheDocument();
    expect(screen.getByText('Khoa')).toBeInTheDocument();
    expect(screen.getByText('Niên khóa')).toBeInTheDocument();
    expect(screen.getByText('Học kỳ đang học')).toBeInTheDocument();
    expect(screen.getByText('Trạng thái')).toBeInTheDocument();
    expect(screen.getByText('K29A')).toBeInTheDocument();
    expect(screen.getByText('CNTT')).toBeInTheDocument();
    expect(screen.getByText('Đang học')).toBeInTheDocument();
    expect(document.querySelector('.ttcds-student-overview.ttcds-panel')).not.toBeNull();
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument();
    // Lớp riêng của TTCDS thay cho .stats-grid/.stat-card legacy (tránh rule nth-child loang màu).
    expect(document.querySelectorAll('.ttcds-stat').length).toBe(4);
    expect(document.querySelectorAll('[data-testid="ttcds-stat"]').length).toBe(4);
    expect(document.querySelector('.ttcds-student-overview .stats-grid')).toBeNull();
    expect(document.querySelector('.ttcds-student-overview .stat-card')).toBeNull();
    const panel = within(screen.getByRole('tabpanel'));
    expect(panel.getByText('ĐTB tích lũy')).toBeInTheDocument();
    expect(panel.getByText('3.20')).toBeInTheDocument();
    expect(panel.getByText('Chuyên cần')).toBeInTheDocument();
    expect(panel.getByText('90.0%')).toBeInTheDocument();
    expect(panel.getByText('18 có mặt · 2 vắng')).toBeInTheDocument();
    expect(panel.getByText('Rèn luyện')).toBeInTheDocument();
    expect(panel.getByText('85 · Tốt')).toBeInTheDocument();
    expect(panel.getByText('Sự kiện')).toBeInTheDocument();
    expect(panel.getByText('1')).toBeInTheDocument();
    expect(screen.queryByRole('term')).not.toBeInTheDocument();
    expect(screen.queryByRole('definition')).not.toBeInTheDocument();
    // No per-term history tables in the overview tab anymore.
    expect(screen.queryByText('Điểm theo học kỳ')).not.toBeInTheDocument();
    expect(screen.queryByText('Điểm danh theo học kỳ')).not.toBeInTheDocument();
    expect(screen.queryByText('Điểm rèn luyện')).not.toBeInTheDocument();
  });

  it('shows a uniform two-line term caption on all four stat tiles', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    const coded = {
      ...detailFixture,
      gpa_hoc_ky: [{ nkhk: 25262, hoc_ky: 2, nien_khoa: 2025, dtb_tich_luy_he_4: 3.4 }],
      diem_danh: [{ nkhk: 25262, hoc_ky: 2, nien_khoa: 2025, di_hoc: 18, vang: 2 }],
      ren_luyen: [{ nkhk: 25262, hoc_ky: 2, nien_khoa: 2025, diem_ren_luyen: 85, xep_loai: 'Tốt' }],
      su_kien: [{ nkhk: 25262, ten_su_kien: 'Chào tân SV', ngay: '2026-09-05', loai: 'Chào đón' }]
    };
    mocks.getTtcdsStudent.mockResolvedValue(coded);
    renderAt('/ttcds/students/24050126', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    await screen.findByText('Tổng quan kỳ gần nhất');
    const panel = within(screen.getByRole('tabpanel'));
    // Cả 4 ô cùng định dạng: dòng 1 "Học kỳ 2 · 2025-2026", dòng 2 "mã 25262".
    expect(panel.getAllByText('Học kỳ 2 · 2025-2026').length).toBe(4);
    expect(panel.getAllByText('mã 25262').length).toBe(4);
  });

  it('shows the profile cells with the latest term and a status fallback', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    const coded = {
      ...detailFixture,
      gpa_hoc_ky: [{ nkhk: 25262, hoc_ky: 2, nien_khoa: 2025, dtb_tich_luy_he_4: 3.4 }],
      diem_danh: [{ nkhk: 25262, hoc_ky: 2, nien_khoa: 2025, di_hoc: 18, vang: 2 }],
      ren_luyen: [{ nkhk: 25262, hoc_ky: 2, nien_khoa: 2025, diem_ren_luyen: 85, xep_loai: 'Tốt' }],
      su_kien: [{ nkhk: 25262, ten_su_kien: 'Chào tân SV', ngay: '2026-09-05', loai: 'Chào đón' }]
    };
    mocks.getTtcdsStudent.mockResolvedValue(coded);
    renderAt('/ttcds/students/24050126', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    await screen.findByText('Học kỳ đang học');
    const card = document.querySelector('.profile-hero-card');
    expect(card).not.toBeNull();
    expect(within(card).getByText('Học kỳ 2 · 2025-2026')).toBeInTheDocument();
    expect(within(card).getByText('mã 25262')).toBeInTheDocument();
    expect(within(card).getByText('Đang học')).toBeInTheDocument();
  });

  it("shows '—' for missing profile fields", async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsStudent.mockResolvedValue({
      ...detailFixture,
      ho_so: { mssv: '24050126' },
      gpa_hoc_ky: [],
      diem_danh: [],
      ren_luyen: []
    });
    renderAt('/ttcds/students/24050126', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    await screen.findByText('Học kỳ đang học');
    const card = document.querySelector('.profile-hero-card');
    expect(card).not.toBeNull();
    expect(within(card).getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(within(card).getByText('Đang học')).toBeInTheDocument();
  });

  it('wraps every student tab block in its own bordered ttcds-panel', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsStudent.mockResolvedValue(detailFixture);
    renderAt('/ttcds/students/24050126', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    await screen.findByText('Tổng quan kỳ gần nhất');
    expect(screen.getByRole('tabpanel').querySelector('.ttcds-panel')).not.toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Thời khóa biểu' }));
    expect(screen.getByRole('tabpanel').querySelector('.ttcds-panel')).not.toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Bảng điểm chi tiết' }));
    expect(screen.getByRole('tabpanel').querySelector('.ttcds-panel')).not.toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Sự kiện' }));
    expect(screen.getByRole('tabpanel').querySelector('.ttcds-panel')).not.toBeNull();
  });

  it('gives the group list table its own bordered panel', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', mentor: 'Thầy TTCDS', member_count: 2 }]);
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    await screen.findByText('K29 Tân sinh viên');
    expect(document.querySelector('#tab-ttcds .ttcds-panel')).not.toBeNull();
    expect(document.querySelector('#tab-ttcds .ttcds-panel .table-scroll')).not.toBeNull();
  });

  it('gives the group member table its own bordered panel', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29' }]);
    mocks.getTtcdsGroupMembers.mockResolvedValue([{ mssv: '24050126' }]);
    mocks.getTtcdsStudent.mockResolvedValue(detailFixture);
    renderAt('/ttcds/groups/g1', '/ttcds/groups/:id', <TtcdsGroupPage />);

    await screen.findByRole('table');
    expect(document.querySelector('#tab-ttcds-group .ttcds-panel')).not.toBeNull();
    expect(document.querySelector('#tab-ttcds-group .ttcds-panel .table-scroll')).not.toBeNull();
  });

  it("renders '—' for ren luyen when the field is missing", async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsStudent.mockResolvedValue({ ...detailFixture, ren_luyen: [] });
    renderAt('/ttcds/students/24050126', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    expect(await screen.findByText('Tổng quan kỳ gần nhất')).toBeInTheDocument();
    expect(screen.getByText('Rèn luyện')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('names each member delete and detail control after its subject', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29' }]);
    mocks.getTtcdsGroupMembers.mockResolvedValue([{ mssv: '24050126' }]);
    mocks.getTtcdsStudent.mockResolvedValue(detailFixture);
    renderAt('/ttcds/groups/g1', '/ttcds/groups/:id', <TtcdsGroupPage />);

    expect(await screen.findByRole('link', { name: 'Chi tiết sinh viên Nguyễn Văn A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xóa sinh viên Nguyễn Văn A' })).toBeInTheDocument();
  });

  it('asks for confirmation with the student name before removing a member', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29' }]);
    mocks.getTtcdsGroupMembers.mockResolvedValue([{ mssv: '24050126' }]);
    mocks.getTtcdsStudent.mockResolvedValue(detailFixture);
    mocks.removeTtcdsGroupMember.mockResolvedValue({});
    renderAt('/ttcds/groups/g1', '/ttcds/groups/:id', <TtcdsGroupPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Xóa sinh viên Nguyễn Văn A' }));
    expect(mocks.removeTtcdsGroupMember).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Nguyễn Văn A');
    fireEvent.click(screen.getByRole('button', { name: 'Xóa sinh viên' }));
    await waitFor(() => expect(mocks.removeTtcdsGroupMember).toHaveBeenCalledWith('test-token', 'g1', '24050126'));
  });

  it('renders a single sentence when a member summary fails to load', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29' }]);
    mocks.getTtcdsGroupMembers.mockResolvedValue([{ mssv: '24050126' }]);
    mocks.getTtcdsStudent.mockRejectedValue(new Error('boom'));
    renderAt('/ttcds/groups/g1', '/ttcds/groups/:id', <TtcdsGroupPage />);

    expect(await screen.findByText('Chưa tải được tóm tắt.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('— —');
  });

  it('drives the tab widget with arrow keys and a roving tabindex', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsStudent.mockResolvedValue(detailFixture);
    renderAt('/ttcds/students/24050126', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    const overview = await screen.findByRole('tab', { name: 'Tổng quan' });
    const tkb = screen.getByRole('tab', { name: 'Thời khóa biểu' });
    expect(overview).toHaveAttribute('tabindex', '0');
    expect(tkb).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(tkb).toHaveAttribute('aria-selected', 'true');
    expect(tkb).toHaveAttribute('tabindex', '0');
    expect(overview).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(tkb);

    fireEvent.keyDown(tkb, { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Sự kiện' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Sự kiện' }), { key: 'Home' });
    expect(overview).toHaveAttribute('aria-selected', 'true');
  });

  it('wraps the grades table in a scroll container with column scopes', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsStudent.mockResolvedValue(detailFixture);
    renderAt('/ttcds/students/24050126', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    fireEvent.click(await screen.findByRole('tab', { name: 'Bảng điểm chi tiết' }));

    const table = await screen.findByRole('table');
    expect(table.parentElement).toHaveClass('table-scroll');
    const headers = screen.getAllByRole('columnheader');
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.every((cell) => cell.getAttribute('scope') === 'col')).toBe(true);
  });

  it('renders the timetable and events tabs as scrollable tables with column scopes', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsStudent.mockResolvedValue(detailFixture);
    renderAt('/ttcds/students/24050126', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    await screen.findByText('Tổng quan kỳ gần nhất');

    fireEvent.click(screen.getByRole('tab', { name: 'Thời khóa biểu' }));
    const tkbPanel = within(screen.getByRole('tabpanel'));
    expect(tkbPanel.getByLabelText('Học kỳ')).toBeInTheDocument();
    expect(tkbPanel.getByLabelText('Tuần')).toBeInTheDocument();
    expect(tkbPanel.getByRole('button', { name: 'Tuần trước' })).toBeInTheDocument();
    expect(tkbPanel.getByRole('button', { name: 'Tuần sau' })).toBeInTheDocument();
    const headers = tkbPanel.getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual(
      expect.arrayContaining(['Tiết', 'Giờ', expect.stringContaining('Thứ 2')])
    );
    expect(tkbPanel.getByText('Nhập môn')).toBeInTheDocument();
    expect(tkbPanel.getByText(/Có mặt/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Sự kiện' }));
    const eventPanel = within(screen.getByRole('tabpanel'));
    const eventTable = eventPanel.getByRole('table');
    expect(eventTable.parentElement).toHaveClass('table-scroll');
    expect(eventPanel.getByText('Chào tân SV')).toBeInTheDocument();
    const eventHeaders = within(eventTable).getAllByRole('columnheader');
    expect(eventHeaders.every((cell) => cell.getAttribute('scope') === 'col')).toBe(true);
  });

  it('renders overview charts for gpa line, weekly attendance line and term combo', async () => {
    const chartFixture = {
      ...detailFixture,
      gpa_hoc_ky: [
        { nkhk: 24251, dtb_tich_luy_he_10: 7.5, dtb_hk_he_10: 7.5 },
        { nkhk: 24252, dtb_tich_luy_he_10: 8.0, dtb_hk_he_10: 8.2 }
      ],
      diem_danh: [
        { nkhk: 24251, di_hoc: 18, vang: 2 },
        { nkhk: 24252, di_hoc: 20, vang: 0 }
      ]
    };
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsStudent.mockResolvedValue(chartFixture);
    mocks.getTtcdsAttendance.mockResolvedValue({
      tong_so_buoi: 6,
      so_buoi_vang: 1,
      nhat_ky: [
        { ngay: '2026-09-01', buoi: 1, nkhk: 24252, diem_danh: 'Có mặt', co_mat: true },
        { ngay: '2026-09-03', buoi: 2, nkhk: 24252, diem_danh: 'Có mặt', co_mat: true },
        { ngay: '2026-09-08', buoi: 1, nkhk: 24252, diem_danh: 'Có mặt', co_mat: true },
        { ngay: '2026-09-10', buoi: 2, nkhk: 24252, diem_danh: 'Vắng', co_mat: false },
        { ngay: '2026-09-10', buoi: 3, nkhk: 24252, diem_danh: null, co_mat: false },
        { ngay: '2026-06-02', buoi: 1, nkhk: 24251, diem_danh: 'Vắng', co_mat: false },
        { ngay: 'not-a-date', buoi: 1, nkhk: 24252, diem_danh: 'Có mặt', co_mat: true }
      ]
    });
    renderAt('/ttcds/students/24050126', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    expect(await screen.findByText('Điểm trung bình tích lũy')).toBeInTheDocument();
    expect(document.querySelector('#ttcdsGpaLine')).not.toBeNull();
    expect(screen.getByText('Tỷ lệ chuyên cần theo tuần')).toBeInTheDocument();
    expect(document.querySelector('#ttcdsAttendanceWeek')).not.toBeNull();
    expect(screen.getByText(/Chuyên cần & điểm trung bình theo học kỳ/)).toBeInTheDocument();
    expect(document.querySelector('#ttcdsTermCombo')).not.toBeNull();
  });

  it('hides the weekly chart on attendance 404 but keeps stat tiles and gpa', async () => {
    const err = new Error('Không tìm thấy nhật ký điểm danh.');
    err.status = 404;
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsStudent.mockResolvedValue(detailFixture);
    mocks.getTtcdsAttendance.mockRejectedValue(err);
    renderAt('/ttcds/students/24050126', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    expect(await screen.findByText('Tổng quan kỳ gần nhất')).toBeInTheDocument();
    expect(document.querySelector('#ttcdsAttendanceWeek')).toBeNull();
    expect(screen.getByText('Chưa có dữ liệu điểm danh theo tuần')).toBeInTheDocument();
    expect(document.querySelector('#ttcdsGpaLine')).not.toBeNull();
  });

  it('turns a 404 student load into a back link plus a list action', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    const notFound = new Error('Không tìm thấy sinh viên.');
    notFound.status = 404;
    mocks.getTtcdsStudent.mockRejectedValue(notFound);
    renderAt('/ttcds/students/99999999', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Không tìm thấy sinh viên' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Sinh viên của tôi' })).toHaveAttribute('href', '/mystudent');
    expect(screen.getByRole('link', { name: 'Về danh sách' })).toHaveAttribute('href', '/mystudent');
    expect(screen.queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();
  });

  it('keeps a back link and retry on a generic student load error', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsStudent.mockRejectedValue(new Error('Lỗi mạng'));
    renderAt('/ttcds/students/24050126', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Chưa thể tải thông tin sinh viên' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Sinh viên của tôi' })).toHaveAttribute('href', '/mystudent');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
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

  it('keeps the hub reachable by deep link without adding a nav entry', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    renderAt('/ttcds', '/ttcds', <TtcdsHubPage />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Trung tâm Chuyển đổi số' })).toBeInTheDocument();
    // Quyết định: hub giữ làm deep-link, KHÔNG thêm mục nav (sidebar chỉ có "Sinh viên của tôi").
    expect(navigation.find((entry) => entry.path === '/ttcds')).toBeUndefined();
    expect(findRouteMeta('/ttcds').title).toBe('Trung tâm CĐS');
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

  it('suggests students while typing and adds the picked one immediately', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29' }]);
    mocks.getTtcdsGroupMembers.mockResolvedValue([]);
    mocks.searchTtcdsStudents.mockResolvedValue({
      ket_qua: [{ mssv: '24050126', ten_day_du: 'Nguyễn Văn A', ma_lop: 'K29A' }]
    });
    mocks.addTtcdsGroupMember.mockResolvedValue({});
    renderAt('/ttcds/groups/g1', '/ttcds/groups/:id', <TtcdsGroupPage />);

    // Ô thêm SV nằm trong POPUP, chỉ mở khi bấm nút.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm sinh viên' }));

    const input = await screen.findByRole('combobox', { name: /Thêm sinh viên theo tên hoặc MSSV/i });
    fireEvent.change(input, { target: { value: 'nguyen' } });

    // Debounce 300ms rồi mới gọi API.
    await waitFor(() => expect(mocks.searchTtcdsStudents).toHaveBeenCalled(), { timeout: 2000 });
    expect(mocks.searchTtcdsStudents.mock.calls[0][1]).toBe('nguyen');

    const option = await screen.findByRole('option', { selected: true });
    expect(option).toHaveTextContent('Nguyễn Văn A');
    expect(option).toHaveTextContent('24050126');

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mocks.addTtcdsGroupMember).toHaveBeenCalledWith(
      'test-token',
      'g1',
      expect.objectContaining({ mssv: '24050126' })
    ));
  });

  it('waits for 4 digits before searching by MSSV but 2 letters for a name', async () => {
    expect(searchMinLength('nguyen')).toBe(2);
    expect(searchMinLength('24')).toBe(4);
    expect(searchMinLength('240')).toBe(4);
    expect(searchMinLength('2405')).toBe(4);
    expect(searchMinLength('nguyen 24')).toBe(2);

    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29' }]);
    mocks.getTtcdsGroupMembers.mockResolvedValue([]);
    mocks.searchTtcdsStudents.mockResolvedValue({ ket_qua: [] });
    renderAt('/ttcds/groups/g1', '/ttcds/groups/:id', <TtcdsGroupPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Thêm sinh viên' }));
    const input = await screen.findByRole('combobox', { name: /Thêm sinh viên theo tên hoặc MSSV/i });

    fireEvent.change(input, { target: { value: '240' } });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(mocks.searchTtcdsStudents).not.toHaveBeenCalled();
    expect(screen.getByText(/Nhập ít nhất 4 số/)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '2405' } });
    await waitFor(() => expect(mocks.searchTtcdsStudents).toHaveBeenCalled(), { timeout: 2000 });
    expect(mocks.searchTtcdsStudents.mock.calls[0][1]).toBe('2405');
  });

  it('create modal only asks for name plus mentor prefilled with the user name', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([]);
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Tạo nhóm đầu tiên' }));
    const mentorInput = await screen.findByLabelText(/Mentor/i);
    expect(mentorInput).toHaveValue('Thầy TTCDS');
    expect(mentorInput).toHaveAttribute('maxlength', '120');
    fireEvent.change(mentorInput, { target: { value: 'Cô Mentor' } });
    expect(mentorInput).toHaveValue('Cô Mentor');
    expect(screen.queryByLabelText(/Niên khóa/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Mô tả/i)).not.toBeInTheDocument();
  });

  it('forwards the mentor when creating a group', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([]);
    mocks.createTtcdsGroup.mockResolvedValue({ id: 'g2', name: 'K30' });
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Tạo nhóm đầu tiên' }));
    fireEvent.change(await screen.findByLabelText(/Tên nhóm/i), { target: { value: 'K30' } });
    fireEvent.change(screen.getByLabelText(/Mentor/i), { target: { value: 'Cô Mentor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo nhóm' }));
    await waitFor(() => expect(mocks.createTtcdsGroup).toHaveBeenCalledWith(
      'test-token',
      expect.objectContaining({ name: 'K30', mentor: 'Cô Mentor' })
    ));
  });

  it('shows a dash for missing mentor and totals in the summary strip', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([
      { id: 'g1', name: 'Nhóm A', mentor: 'Thầy TTCDS', member_count: 2 },
      { id: 'g2', name: 'Nhóm B', member_count: 3 }
    ]);
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    await screen.findByText('Nhóm A');
    const strip = document.querySelector('.ttcds-stats');
    expect(strip).not.toBeNull();
    expect(document.querySelector('#tab-ttcds .stats-grid')).toBeNull();
    expect(strip.textContent).toContain('Số nhóm');
    expect(strip.textContent).toContain('Tổng sinh viên');
    const values = [...strip.querySelectorAll('.ttcds-stat__value')].map((node) => node.textContent);
    expect(values).toEqual(['2', '5']);
    expect(screen.getByRole('columnheader', { name: 'Số SV' }).style.textAlign).toBe('right');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('does not mark the name field invalid before the first submit', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([]);
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Tạo nhóm đầu tiên' }));
    const nameInput = await screen.findByLabelText(/Tên nhóm/i);
    expect(nameInput).not.toHaveAttribute('aria-invalid');

    fireEvent.submit(nameInput.closest('form'));
    expect(nameInput).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(nameInput, { target: { value: 'K30' } });
    expect(nameInput).not.toHaveAttribute('aria-invalid');
  });

  it('labels the group table actions column and keeps it accessible', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29', member_count: 2 }]);
    renderAt('/mystudent', '/mystudent', <TtcdsPage />);

    await screen.findByText('K29 Tân sinh viên');
    expect(screen.getByRole('columnheader', { name: 'Thao tác' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Tên nhóm' })).toBeInTheDocument();
  });
});
