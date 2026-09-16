import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getMyIdentityPresentation: vi.fn()
}));

vi.mock('../../client/src/api/academics.js', () => ({ getProfile: mocks.getProfile }));
vi.mock('../../client/src/api/identity.js', () => ({ getMyIdentityPresentation: mocks.getMyIdentityPresentation }));
vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({
    token: 'test-token',
    user: { name: 'Nguyễn Vũ Đạt', mssv: '24050126', idsv: '-6629997019005451336' }
  }),
  useToasts: () => ({ notify: vi.fn() })
}));

import InfoPage from '../../client/src/features/info/InfoPage.jsx';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('InfoPage profile payload', () => {
  it('reads the nested profile even when the API attaches the photo at the response root', async () => {
    mocks.getProfile.mockResolvedValue({
      result: true,
      data: {
        ten_day_du: 'Nguyễn Vũ Đạt',
        ma_sv: '24050126',
        ngay_sinh: '02/09/2003',
        gioi_tinh: 'Nam',
        lop_hanh_chinh: '27TH03',
        ten_nganh_dao_tao: 'Công nghệ thông tin',
        ten_khoa: 'Khoa Tin học',
        hien_dien_sv: 'Đang học'
      },
      student_image: 'data:image/jpeg;base64,profile'
    });
    mocks.getMyIdentityPresentation.mockResolvedValue({});

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><InfoPage /></QueryClientProvider>);

    expect(await screen.findByText('27TH03')).toBeInTheDocument();
    expect(screen.getByText('Công nghệ thông tin')).toBeInTheDocument();
    expect(screen.getByText('Khoa Tin học')).toBeInTheDocument();
    expect(screen.getByText('Nam')).toBeInTheDocument();
    expect(screen.getByAltText('Ảnh sinh viên')).toHaveAttribute('src', 'data:image/jpeg;base64,profile');
  });
});
