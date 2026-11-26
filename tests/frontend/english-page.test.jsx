import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EnglishPage from '../../client/src/features/english/EnglishPage.jsx';
import { loginEnglish, getEnglishActivities } from '../../client/src/api/tools.js';

vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { name: 'Vũ Đạt', mssv: '24050126', idsv: '1' } }),
  useToasts: () => ({ notify: vi.fn() })
}));

vi.mock('../../client/src/api/tools.js', () => ({
  getEnglishActivities: vi.fn(() => Promise.resolve([])),
  getEnglishCourses: vi.fn(() => Promise.resolve([])),
  loginEnglish: vi.fn(),
  startEnglishExercise: vi.fn(),
  startEnglishCourseFinish: vi.fn(),
  stopEnglishExercise: vi.fn(),
  closeEnglishSession: vi.fn(),
  createEventStream: vi.fn(() => () => {})
}));

describe('EnglishPage BDU Impact VFX button & progress', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('blurs the login form, shows ImpactProgress overlay running to 99%, then hits 100% on valid Moodle response', async () => {
    let resolveLogin;
    loginEnglish.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLogin = resolve;
        })
    );
    getEnglishActivities.mockResolvedValue([]);

    const { container } = render(<EnglishPage />);

    const connectBtn = container.querySelector('button#btn-english-connect[data-vfx="impact"]');
    expect(connectBtn).toBeTruthy();
    expect(connectBtn.textContent).toContain('Duyệt khóa học');

    // Trước khi bấm: không hiển thị thanh ImpactProgress
    expect(container.querySelector('#english-connect-progress')).toBeNull();

    // Nhập tài khoản + mật khẩu rồi bấm nút ImpactButton
    fireEvent.change(screen.getByLabelText(/Tài khoản Moodle/i), { target: { value: '24050126' } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu Moodle/i), { target: { value: 'secret123' } });
    fireEvent.click(connectBtn);

    // Khi đang chờ phản hồi từ bdu.vn247.org: làm mờ form, khóa cuộn và hiện overlay ImpactProgress
    await waitFor(() => {
      const formContent = container.querySelector('#english-login-form-content');
      expect(formContent.style.filter).toContain('blur');
      expect(document.body.style.overflow).toBe('hidden');
      const progressEl = container.querySelector('#english-connect-progress[role="progressbar"]');
      expect(progressEl).toBeTruthy();
      const val = Number(progressEl.getAttribute('aria-valuenow'));
      expect(val).toBeGreaterThan(0);
      expect(val).toBeLessThanOrEqual(99);
      const statusEl = container.querySelector('#english-connect-status');
      expect(statusEl).toBeTruthy();
      expect(statusEl.textContent).toContain('Đang đăng nhập, chờ tí');
      expect(container.querySelectorAll('.bdu-vfx-dot').length).toBe(3);
      expect(screen.queryByText(/Đang phản hồi từ bdu\.vn247\.org/i)).toBeNull();
    });

    // Khi server trả kết quả đăng nhập thành công -> lên 100%, mở khóa cuộn rồi mở giao diện khóa học
    resolveLogin({
      sessionId: 'sess-1',
      streamToken: 'tok-1',
      username: '24050126',
      courses: [{ id: 101, fullname: 'General English 1', progress: 50 }]
    });

    await waitFor(() => {
      expect(document.body.style.overflow).not.toBe('hidden');
      expect(screen.getByText(/Đã kết nối: 24050126/i)).toBeInTheDocument();
      expect(screen.getAllByText('General English 1').length).toBeGreaterThan(0);
    });
  });

  it('runs up to 99% and reports the error on the form without hitting 100% when credentials are invalid', async () => {
    let rejectLogin;
    loginEnglish.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectLogin = reject;
        })
    );

    const { container } = render(<EnglishPage />);
    const connectBtn = container.querySelector('button#btn-english-connect[data-vfx="impact"]');

    fireEvent.change(screen.getByLabelText(/Tài khoản Moodle/i), { target: { value: '24050126' } });
    fireEvent.change(screen.getByLabelText(/Mật khẩu Moodle/i), { target: { value: 'wrongpass' } });
    fireEvent.click(connectBtn);

    let progressEl;
    await waitFor(() => {
      progressEl = container.querySelector('#english-connect-progress[role="progressbar"]');
      expect(progressEl).toBeTruthy();
    });

    rejectLogin(new Error('Sai tài khoản hoặc mật khẩu Moodle (bdu.vn247.org).'));

    await waitFor(() => {
      // Đã tắt overlay loading và hiện thông báo lỗi ngay trên form
      expect(container.querySelector('#english-connect-progress')).toBeNull();
      const errBanner = container.querySelector('#english-login-error');
      expect(errBanner).toBeTruthy();
      expect(errBanner.textContent).toContain('Sai tài khoản hoặc mật khẩu Moodle');
    });

    // Thanh tiến trình chỉ dừng ở mốc 99%, không nhảy lên 100%
    expect(Number(progressEl.getAttribute('aria-valuenow'))).toBe(99);
    expect(progressEl.className).not.toContain('is-complete');
  });
});
