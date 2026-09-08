import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  formatDocx: vi.fn().mockResolvedValue({ downloadUrl: '/api/wordfmt/download/test.docx' }),
  toolRun: null
}));

vi.mock('../../client/src/api/tools.js', () => ({ formatDocx: mocks.formatDocx }));
vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { name: 'Sinh viên Test', mssv: 'TEST0001' } }),
  useToasts: () => ({ notify: vi.fn() })
}));
vi.mock('../../client/src/services/tool-runs.js', () => ({
  getToolRun: () => mocks.toolRun,
  startToolRun: (_name, task) => task(),
  subscribeToolRun: (_name, listener) => {
    listener(mocks.toolRun);
    return () => {};
  }
}));

import WordFmtPage from '../../client/src/features/wordfmt/WordFmtPage.jsx';

afterEach(() => {
  cleanup();
  mocks.toolRun = null;
});

describe('WordFmtPage', () => {
  it('submits the API field names and a front-matter selection that matches the form', async () => {
    render(<WordFmtPage />);
    const file = new File(['DOCX fixture'], 'mau.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });

    fireEvent.change(document.querySelector('#docx-file-input'), {
      target: { files: [file] }
    });
    fireEvent.change(screen.getByLabelText(/Giảng Viên Hướng Dẫn/i), { target: { value: 'ThS. A' } });
    fireEvent.change(screen.getByLabelText(/Tiêu Đề Bìa/i), { target: { value: 'BÁO CÁO KIỂM THỬ' } });
    fireEvent.click(screen.getByLabelText(/Lời cảm ơn/i));

    fireEvent.click(screen.getByRole('button', { name: /Bắt đầu chuẩn hóa văn bản/i }));

    await waitFor(() => expect(mocks.formatDocx).toHaveBeenCalledTimes(1));
    const [, formData] = mocks.formatDocx.mock.calls[0];
    expect(formData.get('documentTitle')).toBe('BÁO CÁO KIỂM THỬ');
    expect(formData.get('docTitle')).toBeNull();
    expect(formData.get('frontMatter')).toBe('cover,comments');
    expect(formData.get('onlyExistingCaptions')).toBe('true');
  });

  it('locks the required graduation front matter and restores coursework choices', () => {
    render(<WordFmtPage />);
    const comments = screen.getByLabelText(/Nhận xét giảng viên/i);
    fireEvent.click(comments);
    expect(comments).not.toBeChecked();

    fireEvent.change(screen.getByLabelText(/Loại tài liệu/i), { target: { value: 'do_an_tot_nghiep' } });
    expect(screen.getByLabelText(/Tiêu Đề Bìa/i)).toHaveValue('ĐỒ ÁN TỐT NGHIỆP');
    expect(screen.getByLabelText(/Tiêu Đề Bìa/i)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/Hai trang bìa/i)).toBeChecked();
    expect(screen.getByLabelText(/Hai trang bìa/i)).toBeDisabled();
    expect(screen.getByLabelText(/Hai trang nhận xét/i)).toBeChecked();
    expect(screen.getByLabelText(/Hai trang nhận xét/i)).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Loại tài liệu/i), { target: { value: 'tieu_luan' } });
    expect(screen.getByLabelText(/Tiêu Đề Bìa/i)).toHaveValue('TIỂU LUẬN MÔN HỌC');
    expect(screen.getByLabelText(/Nhận xét giảng viên/i)).not.toBeChecked();
    expect(screen.getByLabelText(/Nhận xét giảng viên/i)).not.toBeDisabled();
  });

  it('keeps the success state visible without creating a broken download link', () => {
    mocks.toolRun = { status: 'success', result: { report: { pages: 3 } } };
    render(<WordFmtPage />);

    expect(screen.getByText(/Văn bản đã được chuẩn hóa 100%/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Tải Về File DOCX/i })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/liên kết tải xuống chưa khả dụng/i);
  });

  it('does not expose backend error details in the error card', () => {
    mocks.toolRun = { status: 'error', error: new Error('SECRET backend stderr: stack trace') };
    render(<WordFmtPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(/Không thể hoàn tất việc định dạng file/i);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/SECRET backend stderr/i);
  });

  it('keeps the start control locked and reports an estimated active stage while a run is pending', () => {
    mocks.toolRun = { status: 'running', progress: 52, stageIndex: 2, stageCount: 7 };
    render(<WordFmtPage />);

    expect(screen.getByRole('button', { name: /Đang chuẩn hóa/i })).toBeDisabled();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '52');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText(/Đang nhận diện bảng & hình/i)).toBeInTheDocument();
    expect(document.querySelector('.wf-run')).toBeInTheDocument();
    expect(document.querySelectorAll('.wf-run-stages li')).toHaveLength(7);
    expect(document.querySelector('.wordfmt-progress-box')).toBeNull();
    expect(document.querySelector('.processing-stages')).toBeNull();
  });

  it('shows only concise completion cards derived from known report fields', () => {
    mocks.toolRun = {
      status: 'success',
      summaryChoices: { includeCover: true, onlyExistingCaptions: true },
      result: {
        report: {
          structure: { chapterCount: 2, warnings: ['SECRET diagnostic payload'] },
          outputNormalization: {
            captionsRenumbered: 3,
            compliance: { a4Portrait: true, margins: true }
          },
          arbitraryBackendBlob: { trace: 'SECRET raw trace' }
        }
      }
    };
    render(<WordFmtPage />);

    const summary = screen.getByLabelText(/Tóm tắt kết quả/i);
    expect(summary).toHaveTextContent('Đã nhận diện 2 chương');
    expect(summary).toHaveTextContent('Đã chuẩn hóa 3 chú thích Bảng/Hình');
    expect(summary).toHaveTextContent('Báo cáo đầu ra có 1 lưu ý');
    expect(summary).toHaveTextContent('Tùy chọn đã gửi');
    expect(summary).not.toHaveTextContent(/SECRET diagnostic|SECRET raw trace|arbitraryBackendBlob/i);
    expect(screen.queryByText(/WordFmt Diagnostics/i)).not.toBeInTheDocument();
  });
});
