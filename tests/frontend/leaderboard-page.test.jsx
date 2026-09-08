import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAcademicLeaderboard: vi.fn()
}));

vi.mock('../../client/src/api/academics.js', () => ({
  getAcademicLeaderboard: mocks.getAcademicLeaderboard
}));

vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { name: 'Sinh viên hiện tại', mssv: '24050001' } })
}));

import LeaderboardPage, {
  LEADERBOARD_REFRESH_INTERVAL_MS,
  leaderboardQueryOptions,
  leaderboardRowKey,
  normalizeLeaderboard
} from '../../client/src/features/leaderboard/LeaderboardPage.jsx';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/leaderboard']}>
        <LeaderboardPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  mocks.getAcademicLeaderboard.mockReset();
});

beforeEach(() => {
  mocks.getAcademicLeaderboard.mockResolvedValue({
    scope: 'school',
    metric: 'gpa',
    student_count: 2,
    synced_at: '2026-09-08T01:35:58.000Z',
    students: [
      {
        hang: 1,
        ho_ten: 'Sinh viên dẫn đầu',
        mssv: '24••••02',
        ma_lop: '27TH01',
        gia_tri: 3.8
      },
      {
        hang: 2,
        ho_ten: 'Sinh viên hiện tại',
        mssv: '24050001',
        ma_lop: '27TH01',
        gia_tri: 3.42,
        la_sinh_vien_hien_tai: true
      }
    ]
  });
});

describe('LeaderboardPage', () => {
  it('normalizes the academic ranking API contract instead of treating students as an empty list', () => {
    const normalized = normalizeLeaderboard({
      student_count: 1,
      synced_at: '2026-09-08T01:35:58.000Z',
      students: [{ hang: 1, la_sinh_vien_hien_tai: true }]
    });

    expect(normalized.items).toHaveLength(1);
    expect(normalized.total).toBe(1);
    expect(normalized.myRank).toMatchObject({ hang: 1 });
    expect(normalized.updatedAt).toMatch(/^Cập nhật /);
  });

  it('keeps React row keys unique even when the privacy-masked student codes collide', () => {
    const firstKey = leaderboardRowKey({ hang: 1, mssv: '24••••25' }, 0);
    const secondKey = leaderboardRowKey({ hang: 25, mssv: '24••••25' }, 25);

    expect(firstKey).not.toBe(secondKey);
  });

  it('renders the backend student fields and displays the actual snapshot count', async () => {
    renderPage();

    await screen.findByText('Sinh viên dẫn đầu');
    expect(screen.getByText('2 sinh viên')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getAllByText('27TH01')).toHaveLength(2);
    expect(screen.getByText('3.8')).toBeInTheDocument();
    expect(screen.queryByText(/Chưa có dữ liệu cho khóa này/i)).not.toBeInTheDocument();
  });

  it('shows a retryable error rather than presenting a failed API request as an empty leaderboard', async () => {
    mocks.getAcademicLeaderboard.mockRejectedValueOnce(new Error('Server unavailable'));
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Không thể tải bảng xếp hạng.');
    expect(alert).toHaveTextContent('Dữ liệu chưa được tải. Vui lòng thử lại.');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });

  it('refreshes in the foreground every minute and when the user returns to the tab', () => {
    const options = leaderboardQueryOptions({ token: 'test-token', mssv: '24050001', scope: 'school', metric: 'gpa' });

    expect(options.refetchInterval).toBe(LEADERBOARD_REFRESH_INTERVAL_MS);
    expect(options.refetchInterval).toBe(60 * 1000);
    expect(options.refetchIntervalInBackground).toBe(false);
    expect(options.refetchOnWindowFocus).toBe(true);
    expect(options.refetchOnReconnect).toBe(true);
  });
});
