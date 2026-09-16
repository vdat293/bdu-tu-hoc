import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SurveyPage from '../../client/src/features/survey/SurveyPage.jsx';

const mockCourses = [
  { surveyKey: 'course-1', courseName: 'An ninh mạng', courseCode: 'INF0912', lecturer: 'Nguyễn Văn Thành', completed: false },
  { surveyKey: 'course-2', courseName: 'Công nghệ IoT', courseCode: 'INF0992', lecturer: 'Kiều Trường Sơn', completed: false }
];

vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { name: 'Vũ Đạt', mssv: '24050126', idsv: '1' } }),
  useToasts: () => ({ notify: vi.fn() })
}));

vi.mock('../../client/src/api/academics.js', () => ({
  getProfile: vi.fn(() => Promise.resolve({}))
}));

vi.mock('../../client/src/api/tools.js', () => ({
  getSurveyForms: vi.fn(() => Promise.resolve(mockCourses))
}));

vi.mock('../../client/src/features/survey/runner.js', () => ({
  getSurveyRun: vi.fn(() => ({ status: 'idle', logs: [] })),
  subscribeSurvey: vi.fn(() => () => {}),
  startSurvey: vi.fn()
}));

describe('SurveyPage Modals', () => {
  afterEach(() => {
    cleanup();
  });

  it('portals the settings modal into document.body as a ViewportModal', async () => {
    render(<SurveyPage />);

    // Load courses
    const loadBtn = screen.getByRole('button', { name: /Lấy danh sách/i });
    fireEvent.click(loadBtn);

    await waitFor(() => {
      expect(screen.getByText(/2\/2 môn được chọn/i)).toBeInTheDocument();
    });

    // Open settings modal
    const gearBtn = screen.getByLabelText(/Cấu hình chi tiết khảo sát/i);
    fireEvent.click(gearBtn);

    // Modal dialog should be in document.body
    const modalBackdrop = document.querySelector('#modal-survey-advanced-settings.modal-backdrop');
    expect(modalBackdrop).toBeTruthy();
    expect(modalBackdrop.parentElement).toBe(document.body);

    const dialog = modalBackdrop.querySelector('.modal-dialog.survey-settings-modal');
    expect(dialog).toBeTruthy();
    expect(screen.getByText('An ninh mạng')).toBeInTheDocument();

    // Verify ESC closes dialog
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('#modal-survey-advanced-settings.modal-backdrop')).toBeNull();
  });

  it('portals the course picker modal into document.body as a ViewportModal', async () => {
    render(<SurveyPage />);

    const loadBtn = screen.getByRole('button', { name: /Lấy danh sách/i });
    fireEvent.click(loadBtn);

    await waitFor(() => {
      expect(screen.getByText(/2\/2 môn được chọn/i)).toBeInTheDocument();
    });

    // Open course picker modal
    const pickBtn = screen.getByRole('button', { name: /Chọn môn/i });
    fireEvent.click(pickBtn);

    const modalBackdrop = document.querySelector('#modal-survey-course-picker.modal-backdrop');
    expect(modalBackdrop).toBeTruthy();
    expect(modalBackdrop.parentElement).toBe(document.body);
    expect(screen.getByText('An ninh mạng')).toBeInTheDocument();

    // Clicking close button closes the modal
    const closeBtn = modalBackdrop.querySelector('.survey-modal-close');
    fireEvent.click(closeBtn);
    expect(document.querySelector('#modal-survey-course-picker.modal-backdrop')).toBeNull();
  });

  it('updates completed course state live when runner emits completedKeys', async () => {
    let subscriber = null;
    const { subscribeSurvey } = await import('../../client/src/features/survey/runner.js');
    subscribeSurvey.mockImplementation((listener) => {
      subscriber = listener;
      return () => {};
    });

    render(<SurveyPage />);

    const loadBtn = screen.getByRole('button', { name: /Lấy danh sách/i });
    fireEvent.click(loadBtn);

    await waitFor(() => {
      expect(screen.getByText(/2\/2 môn được chọn/i)).toBeInTheDocument();
    });

    // Simulate course-1 completion from runner SSE
    subscriber({
      status: 'running',
      completedKeys: ['course-1'],
      logs: [{ message: 'Hoàn thành An ninh mạng', type: 'success', at: '12:00:00' }]
    });

    // Count should automatically decrement from 2/2 to 1/1 without F5
    await waitFor(() => {
      expect(screen.getByText(/1\/1 môn được chọn/i)).toBeInTheDocument();
    });
  });
});
