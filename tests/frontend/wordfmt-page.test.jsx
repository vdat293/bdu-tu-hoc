import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  formatDocx: vi.fn().mockResolvedValue({ downloadUrl: '/api/wordfmt/download/test.docx' })
}));

vi.mock('../../client/src/api/tools.js', () => ({ formatDocx: mocks.formatDocx }));
vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { name: 'Sinh viên Test', mssv: 'TEST0001' } }),
  useToasts: () => ({ notify: vi.fn() })
}));
vi.mock('../../client/src/services/tool-runs.js', () => ({
  getToolRun: () => null,
  startToolRun: (_name, task) => task(),
  subscribeToolRun: () => () => {}
}));

import WordFmtPage from '../../client/src/features/wordfmt/WordFmtPage.jsx';

afterEach(() => cleanup());

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
});
