import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  getTtcdsPermissions: vi.fn(),
  setTtcdsPermission: vi.fn(),
  getTtcdsAudit: vi.fn()
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
import TtcdsHubPage from '../../client/src/features/ttcds/TtcdsHubPage.jsx';
import TtcdsStudentPage from '../../client/src/features/ttcds/TtcdsStudentPage.jsx';
import { summarizeTtcdsStudent } from '../../client/src/features/ttcds/TtcdsGroupPage.jsx';
import { navigation, filterNavigation } from '../../client/src/app/navigation.js';
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
    renderAt('/ttcds/sinh-vien-cua-toi', '/ttcds/sinh-vien-cua-toi', <TtcdsPage />);

    expect(await screen.findByText('Bạn không thuộc Trung tâm Chuyển đổi số.')).toBeInTheDocument();

    const item = navigation.find((entry) => entry.path === '/ttcds');
    expect(item).toBeTruthy();
    expect(filterNavigation(navigation, { can_access: false })).not.toContain(item);
    expect(filterNavigation(navigation, { can_access: true })).toContain(item);
  });

  it('hides the create button for view-level users', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsGroups.mockResolvedValue([{ id: 'g1', name: 'K29 Tân sinh viên', nien_khoa: 'K29', member_count: 2 }]);
    renderAt('/ttcds/sinh-vien-cua-toi', '/ttcds/sinh-vien-cua-toi', <TtcdsPage />);

    await screen.findByText('K29 Tân sinh viên');
    expect(screen.queryByRole('button', { name: /Tạo nhóm/i })).not.toBeInTheDocument();
  });

  it('shows the create button for create-level users', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([]);
    renderAt('/ttcds/sinh-vien-cua-toi', '/ttcds/sinh-vien-cua-toi', <TtcdsPage />);

    expect(await screen.findByRole('button', { name: /Tạo nhóm/i })).toBeInTheDocument();
  });

  it('renders the ren-luyen block from the ren_luyen field', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsStudent.mockResolvedValue(detailFixture);
    renderAt('/ttcds/students/24050126', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    expect(await screen.findByText('Điểm rèn luyện')).toBeInTheDocument();
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText('Tốt')).toBeInTheDocument();
  });

  it("renders '—' when ren_luyen is missing", async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsStudent.mockResolvedValue({ ...detailFixture, ren_luyen: [] });
    renderAt('/ttcds/students/24050126', '/ttcds/students/:mssv', <TtcdsStudentPage />);

    expect(await screen.findByText('Điểm rèn luyện')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('hides the admin section for non-owners (permissions 403)', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    mocks.getTtcdsGroups.mockResolvedValue([]);
    mocks.getTtcdsPermissions.mockRejectedValue(new Error('Chỉ quản trị viên hệ thống mới được thực hiện thao tác này.'));
    renderAt('/ttcds/sinh-vien-cua-toi', '/ttcds/sinh-vien-cua-toi', <TtcdsPage />);

    await screen.findByText('Chưa có nhóm nào');
    await waitFor(() => expect(mocks.getTtcdsPermissions).toHaveBeenCalled());
    expect(screen.queryByText('Quản trị phân quyền')).not.toBeInTheDocument();
  });

  it('shows the admin section with owner context (permissions + audit)', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'create' });
    mocks.getTtcdsGroups.mockResolvedValue([]);
    mocks.getTtcdsPermissions.mockResolvedValue([
      { mssv: '22050006', level: 'create', granted_by: 'SYS', granted_at: '2026-10-15', updated_at: '2026-10-15' }
    ]);
    mocks.getTtcdsAudit.mockResolvedValue([
      { id: 1, actor_mssv: 'SYS', action: 'group.create', target_group_id: null, target_mssv: null, created_at: '2026-10-15' }
    ]);
    renderAt('/ttcds/sinh-vien-cua-toi', '/ttcds/sinh-vien-cua-toi', <TtcdsPage />);

    expect(await screen.findByText('Quản trị phân quyền')).toBeInTheDocument();
    expect(screen.getByText('22050006')).toBeInTheDocument();
    expect(screen.getByText('group.create')).toBeInTheDocument();
  });

  it('hub renders the Sinh vien cua toi service card with the right link', async () => {
    mocks.getTtcdsCapabilities.mockResolvedValue({ can_access: true, level: 'view' });
    renderAt('/ttcds', '/ttcds', <TtcdsHubPage />);

    const link = await screen.findByRole('link', { name: 'Sinh viên của tôi' });
    expect(link.getAttribute('href')).toBe('/ttcds/sinh-vien-cua-toi');
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
