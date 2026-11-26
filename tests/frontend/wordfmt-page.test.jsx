import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const preview = {
    items: [
      { i: 3, kind: 'p', t: 'TÓM TẮT', role: 'body', region: 'front', suspect: 'Chữ in hoa, ngắn', suggest: 'major_title' },
      { i: 4, kind: 'p', t: 'Nội dung tóm tắt đề tài.', role: 'body', region: 'front' },
      { i: 9, kind: 'p', t: 'CHƯƠNG 1. TỔNG QUAN', role: 'chapter', region: 'body' }
    ],
    paragraphCount: 10,
    summary: { chapterCount: 1, headingCount: 0, suspectCount: 1, forcedCount: 0 }
  };
  return {
    preview,
    formatDocx: vi.fn().mockResolvedValue({ downloadUrl: '/api/wordfmt/download/test.docx' }),
    previewDocxStructure: vi.fn().mockResolvedValue(preview),
    getFormattedDocxPreview: vi.fn().mockResolvedValue(null),
    toolRun: null
  };
});

vi.mock('../../client/src/api/tools.js', () => ({
  formatDocx: mocks.formatDocx,
  previewDocxStructure: mocks.previewDocxStructure,
  getFormattedDocxPreview: mocks.getFormattedDocxPreview,
  downloadWordFmt: vi.fn().mockResolvedValue(new Blob(['docx']))
}));
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

import WordFmtPage, { buildCompletionCards } from '../../client/src/features/wordfmt/WordFmtPage.jsx';

afterEach(() => {
  cleanup();
  mocks.toolRun = null;
});

describe('WordFmtPage', () => {
  it('submits the API field names and a front-matter selection after the review step', async () => {
    mocks.formatDocx.mockClear();
    mocks.formatDocx.mockResolvedValue({ downloadUrl: '/api/wordfmt/download/test.docx' });
    mocks.previewDocxStructure.mockResolvedValue(mocks.preview);
    render(<WordFmtPage />);
    const file = new File(['DOCX fixture'], 'mau.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });

    fireEvent.change(document.querySelector('#docx-file-input'), {
      target: { files: [file] }
    });
    expect(screen.queryByText(/Khung thiết kế & bản xem trước tài liệu/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Giảng Viên Hướng Dẫn/i), { target: { value: 'ThS. A' } });
    expect(screen.getByLabelText(/Tên Sinh Viên \/ Nhóm/i)).toHaveValue('');
    expect(screen.getByLabelText(/Mã Số Sinh Viên/i)).toHaveValue('');
    fireEvent.change(screen.getByLabelText(/Tên Sinh Viên \/ Nhóm/i), { target: { value: 'Nguyễn Văn B' } });
    fireEvent.change(screen.getByLabelText(/Tiêu Đề Bìa/i), { target: { value: 'BÁO CÁO KIỂM THỬ' } });
    fireEvent.click(screen.getByLabelText(/Lời cảm ơn/i));

    const startBtn = screen.getByRole('button', { name: /Bắt đầu chuẩn hóa văn bản/i });
    expect(startBtn).toHaveAttribute('data-vfx', 'impact');
    fireEvent.click(startBtn);

    await waitFor(() => expect(mocks.previewDocxStructure).toHaveBeenCalled());
    const confirmBtn = await screen.findByRole('button', { name: /Xác nhận & Chuẩn hóa DOCX/i });
    expect(confirmBtn).toHaveAttribute('data-vfx', 'impact');
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

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

  it('opens the review view on submit and sends manual role corrections and notes', async () => {
    mocks.formatDocx.mockClear();
    mocks.previewDocxStructure.mockClear();
    mocks.formatDocx.mockResolvedValue({ downloadUrl: '/api/wordfmt/download/test.docx' });
    mocks.previewDocxStructure.mockResolvedValue(mocks.preview);
    render(<WordFmtPage />);
    const file = new File(['DOCX fixture'], 'mau.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    fireEvent.change(document.querySelector('#docx-file-input'), { target: { files: [file] } });
    expect(mocks.previewDocxStructure).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Giảng Viên Hướng Dẫn/i), { target: { value: 'ThS. A' } });
    fireEvent.change(screen.getByLabelText(/Tên Sinh Viên \/ Nhóm/i), { target: { value: 'Nguyễn Văn B' } });
    fireEvent.click(screen.getByRole('button', { name: /Bắt đầu chuẩn hóa văn bản/i }));

    await waitFor(() => expect(mocks.previewDocxStructure).toHaveBeenCalledTimes(1));
    const summaryBlock = await screen.findByText('TÓM TẮT', { selector: '.wf-pv-text' });
    expect(screen.getByText(/Có thể là tiêu đề\?/i)).toBeInTheDocument();

    fireEvent.click(summaryBlock.closest('button'));
    fireEvent.click(screen.getByRole('button', { name: /Gợi ý: H1 · Tiêu đề lớn/i }));
    fireEvent.change(screen.getByLabelText(/Ghi chú phần muốn sửa/i), { target: { value: 'Kiểm tra lại đoạn tóm tắt' } });
    expect(screen.getByLabelText(/Danh sách chỉnh sửa/i)).toHaveTextContent('H1 · Tiêu đề lớn');

    fireEvent.click(screen.getByRole('button', { name: /Xác nhận & Chuẩn hóa DOCX/i }));

    await waitFor(() => expect(mocks.formatDocx).toHaveBeenCalledTimes(1));
    const [, formData] = mocks.formatDocx.mock.calls[0];
    expect(JSON.parse(formData.get('roleOverrides'))).toEqual({ 3: 'major_title' });
    expect(JSON.parse(formData.get('paragraphNotes'))).toEqual({ 3: 'Kiểm tra lại đoạn tóm tắt' });
  });

  it('keeps the success state visible without creating a broken download link', () => {
    mocks.toolRun = { status: 'success', result: { report: { pages: 3 } } };
    render(<WordFmtPage />);

    expect(screen.getByText(/Văn bản đã được chuẩn hóa 100%/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Tải Về File DOCX/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tải Về File DOCX/i })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/liên kết tải xuống chưa khả dụng/i);
  });

  it('does not expose backend error details in the error card', () => {
    mocks.toolRun = { status: 'error', error: new Error('SECRET backend stderr: stack trace') };
    render(<WordFmtPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(/Không thể hoàn tất việc định dạng file/i);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/SECRET backend stderr/i);
  });

  it('shows only the focused BDU Impact VFX loading progress stage while a run is pending', () => {
    mocks.toolRun = { status: 'running', progress: 52, stageIndex: 2, stageCount: 7 };
    render(<WordFmtPage />);

    expect(document.querySelector('#form-wordfmt')).toBeNull();
    expect(document.querySelector('.wf-gdoc-workspace')).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '52');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText(/Đang nhận diện bảng & hình/i)).toBeInTheDocument();
    expect(document.querySelector('.wf-vfx-stage')).toBeInTheDocument();
    expect(document.querySelectorAll('.wf-run-stages li')).toHaveLength(0);
    expect(document.querySelector('.wordfmt-progress-box')).toBeNull();
    expect(document.querySelector('.processing-stages')).toBeNull();
  });

  it('shows only the finished progress bar and a single Download ImpactButton on completion while keeping buildCompletionCards safe', () => {
    const safeReport = {
      structure: { chapterCount: 2, warnings: ['SECRET diagnostic payload'] },
      outputNormalization: {
        captionsRenumbered: 3,
        compliance: { a4Portrait: true, margins: true }
      },
      arbitraryBackendBlob: { trace: 'SECRET raw trace' }
    };
    const cards = buildCompletionCards({ report: safeReport }, { includeCover: true, onlyExistingCaptions: true });
    const cardText = cards.map((c) => `${c.title} ${c.description}`).join(' | ');
    expect(cardText).toContain('Đã nhận diện 2 chương');
    expect(cardText).toContain('Đã chuẩn hóa 3 chú thích Bảng/Hình');
    expect(cardText).toContain('Báo cáo đầu ra có 1 lưu ý');
    expect(cardText).not.toMatch(/SECRET diagnostic|SECRET raw trace|arbitraryBackendBlob/i);

    mocks.toolRun = {
      status: 'success',
      summaryChoices: { includeCover: true, onlyExistingCaptions: true },
      result: {
        downloadUrl: '/api/wordfmt/download/BDU_ChuanHoa.docx',
        report: safeReport
      }
    };
    render(<WordFmtPage />);

    expect(document.querySelector('#form-wordfmt')).toBeNull();
    expect(document.querySelector('.wf-gdoc-workspace')).toBeNull();
    expect(screen.queryByLabelText(/Tóm tắt kết quả/i)).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText(/Văn bản đã được chuẩn hóa 100%/i)).toBeInTheDocument();
    const downloadBtn = screen.getByRole('button', { name: /Tải Về File DOCX Đã Chuẩn Hóa/i });
    expect(downloadBtn).toBeInTheDocument();
    expect(downloadBtn).toHaveAttribute('data-vfx', 'impact');
    expect(document.body.textContent).not.toMatch(/SECRET diagnostic|SECRET raw trace|arbitraryBackendBlob/i);
  });

  it('renders the AI skill prompt panel synced with form fields and copies to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<WordFmtPage />);

    fireEvent.change(screen.getByLabelText(/Giảng Viên Hướng Dẫn/i), { target: { value: 'ThS. Nguyễn Hồ Hải' } });
    fireEvent.change(screen.getByLabelText(/Tên Đề Tài/i), { target: { value: 'Website quản lý học tập' } });
    fireEvent.click(screen.getByRole('button', { name: /Xem & tùy chọn/i }));

    const code = screen.getByLabelText(/Nội dung skill cho AI/i);
    expect(code).toHaveTextContent('ThS. Nguyễn Hồ Hải');
    expect(code).toHaveTextContent('ThS. NGUYỄN HỒ HẢI');
    expect(code).toHaveTextContent('Website quản lý học tập');
    expect(code).toHaveTextContent('20 dòng chấm ngang');
    expect(code).toHaveTextContent('NGHIÊM CẤM TUYỆT ĐỐI TỰ VẼ LOGO GIẢ');
    expect(code).toHaveTextContent('.agents/skills/bdu-academic-docx/assets/bdu-cover-logo.png');
    expect(code).toHaveTextContent('https://sv.bdu.io.vn/assets/images/logo-hao-quang-transparent.png');

    const logoDownload = screen.getByRole('link', { name: /Tải Logo chuẩn/i });
    expect(logoDownload).toHaveAttribute('href', '/assets/images/logo-hao-quang-transparent.png');

    fireEvent.click(screen.getByRole('tab', { name: /Agent Skill/i }));
    expect(code).toHaveTextContent('name: bdu-academic-docx');
    expect(code).toHaveTextContent('resolve_bdu_logo');

    fireEvent.click(screen.getByRole('button', { name: /Sao chép Prompt/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('name: bdu-academic-docx');
  });

  it('switches prompt specification accurately when selecting graduation thesis', () => {
    render(<WordFmtPage />);
    fireEvent.change(screen.getByLabelText(/Loại tài liệu/i), { target: { value: 'do_an_tot_nghiep' } });
    fireEvent.click(screen.getByRole('button', { name: /Xem & tùy chọn/i }));

    const code = screen.getByLabelText(/Nội dung skill cho AI/i);
    expect(code).toHaveTextContent('2 trang bìa giống hệt nhau 100%: Bìa chính & Bìa phụ');
    expect(code).toHaveTextContent('NHẬN XÉT CỦA GIẢNG VIÊN HƯỚNG DẪN');
    expect(code).toHaveTextContent('NHẬN XÉT CỦA GIẢNG VIÊN PHẢN BIỆN');
    expect(code).toHaveTextContent('VIỆN TRÍ TUỆ NHÂN TẠO VÀ CHUYỂN ĐỔI SỐ');
    expect(code).toHaveTextContent('public/assets/images/logo-hao-quang-transparent.png');
    expect(code).toHaveTextContent('Giảng viên hướng dẫn:');
    expect(code).not.toHaveTextContent('Người hướng dẫn:');
    expect(code).toHaveTextContent('CHỈ BẮT ĐẦU HIỂN THỊ TỪ LỜI CẢM ƠN TRỞ ĐI');
  });

  it('auto-fills current month/year in cover preview and supports equation & signature roles', async () => {
    const richPreview = {
      items: [
        { i: 2, kind: 'p', t: 'SINH VIÊN THỰC HIỆN', role: 'signature', region: 'front' },
        { i: 5, kind: 'p', t: 'p = 1/(1 + exp(-z))', role: 'equation', region: 'body' }
      ],
      paragraphCount: 6,
      summary: { chapterCount: 1, headingCount: 0, equationCount: 1, suspectCount: 0, forcedCount: 0 }
    };
    mocks.previewDocxStructure.mockResolvedValueOnce(richPreview);
    render(<WordFmtPage />);
    const file = new File(['DOCX fixture'], 'toan.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    fireEvent.change(document.querySelector('#docx-file-input'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText(/Giảng Viên Hướng Dẫn/i), { target: { value: 'ThS. Nguyễn Hồ Hải' } });
    fireEvent.change(screen.getByLabelText(/Tên Sinh Viên \/ Nhóm/i), { target: { value: 'Nguyễn Vũ Đạt' } });
    fireEvent.click(screen.getByRole('button', { name: /Bắt đầu chuẩn hóa văn bản/i }));

    await waitFor(() => expect(mocks.previewDocxStructure).toHaveBeenCalled());
    const coverPreview = await screen.findByLabelText(/Khung trang bìa dự kiến/i);
    const currentYear = String(new Date().getFullYear());
    expect(coverPreview).toHaveTextContent(new RegExp(`Thành phố Hồ Chí Minh, tháng \\d{1,2} năm ${currentYear}`));
    expect(screen.getByText('Khối chữ ký')).toBeInTheDocument();
    expect(screen.getByText('Công thức toán')).toBeInTheDocument();
  });

  it('reflects cover metadata live on the Studio A4 desk and accepts Google Docs margin suggestions', async () => {
    const renderedDocPreview = {
      items: [
        { i: 3, kind: 'p', t: 'TÓM TẮT', role: 'body', region: 'front', suspect: 'Chữ in hoa, ngắn', suggest: 'major_title' },
        { i: 5, kind: 'p', t: 'p = 1/(1 + exp(-z))', role: 'equation', region: 'body' }
      ],
      paragraphCount: 8,
      summary: { chapterCount: 1, headingCount: 1, equationCount: 1, suspectCount: 1, forcedCount: 0 },
      document: {
        pageCount: 2,
        pages: [
          {
            pageIndex: 0,
            pageNumber: 1,
            pageLabel: '',
            isCover: true,
            isDraftCover: true,
            borderStyle: 'twistedLines1',
            draftCover: {
              institution: 'TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG',
              institute: 'VIỆN TRÍ TUỆ NHÂN TẠO VÀ CHUYỂN ĐỔI SỐ',
              faculty: 'KHOA CÔNG NGHỆ THÔNG TIN, ROBOT VÀ TRÍ TUỆ NHÂN TẠO',
              docTitle: 'TIỂU LUẬN MÔN HỌC',
              topic: 'XÂY DỰNG HỆ THỐNG BDU',
              instructor: 'ThS. LÊ VĂN C',
              student: 'SINH VIÊN TEST',
              studentId: 'TEST0001',
              className: '2405SE01',
              coverDate: 'Thành phố Hồ Chí Minh, tháng 11 năm 2026'
            },
            blocks: []
          },
          {
            pageIndex: 1,
            pageNumber: 2,
            pageLabel: '1',
            isCover: false,
            header: { columns: [{ text: 'TIỂU LUẬN MÔN HỌC', align: 'left' }, { text: 'CHƯƠNG 1', align: 'right' }], hasBorder: true },
            footer: { columns: [{ text: 'GVHD: ThS. Lê Văn C', align: 'left' }, { text: '{PAGE}', hasPageField: true, align: 'center' }, { text: 'SVTH: Sinh viên Test', align: 'right' }], hasBorder: true },
            blocks: [
              { blockId: 'b1', sourceIndex: 3, kind: 'p', text: 'TÓM TẮT', role: 'body', suspect: 'Chữ in hoa, ngắn', suggest: 'major_title' },
              {
                blockId: 'b2',
                sourceIndex: 5,
                kind: 'equation',
                text: 'p = 1/(1 + exp(-z))',
                role: 'equation',
                mathAst: { type: 'frac', num: { type: 'tok', kind: 'mn', text: '1' }, den: { type: 'tok', kind: 'mi', text: 'z' } }
              },
              {
                blockId: 'b3',
                kind: 'table',
                bordered: true,
                rows: [
                  { isHeader: true, cells: [{ colspan: 1, rowspan: 1, blocks: [{ kind: 'p', text: 'Cột A' }] }] },
                  { isHeader: false, cells: [{ colspan: 1, rowspan: 1, blocks: [{ kind: 'p', text: 'Giá trị 1' }] }] }
                ]
              }
            ]
          }
        ],
        outline: [{ id: 'o1', title: 'CHƯƠNG 1', level: 1, pageIndex: 1, pageLabel: '1' }],
        locations: { 3: { blockId: 'b1', pageIndex: 1, pageNumber: 2, pageLabel: '1' } }
      }
    };
    mocks.previewDocxStructure.mockResolvedValueOnce(renderedDocPreview);

    render(<WordFmtPage />);

    // Step 1 shows ONLY the clean input form (no side A4 preview card yet)
    expect(screen.queryByLabelText(/Khung trang bìa dự kiến/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Điền tên & MSSV của tôi/i }));
    expect(screen.getByLabelText(/Tên Sinh Viên \/ Nhóm/i)).toHaveValue('Sinh viên Test');
    expect(screen.getByLabelText(/Mã Số Sinh Viên/i)).toHaveValue('TEST0001');
    fireEvent.change(screen.getByLabelText(/Giảng Viên Hướng Dẫn/i), { target: { value: 'ThS. Lê Văn C' } });

    const file = new File(['DOCX fixture'], 'baocao.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    fireEvent.change(document.querySelector('#docx-file-input'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /Bắt đầu chuẩn hóa văn bản/i }));

    await waitFor(() => expect(mocks.previewDocxStructure).toHaveBeenCalled());
    // Cover, real table & typeset stacked fraction equation rendered in Step 2 Google Docs Workspace
    expect(await screen.findByLabelText(/Khung trang bìa dự kiến/i)).toHaveTextContent('ThS. LÊ VĂN C');
    expect(await screen.findByText('Giá trị 1')).toBeInTheDocument();
    expect(document.querySelector('.wf-a4-math .wf-math-frac')).toBeInTheDocument();

    // Accept Google Docs suggestion card in the right margin
    fireEvent.click(screen.getByRole('button', { name: /✓ Chấp nhận/i }));
    expect(screen.getByLabelText(/Danh sách chỉnh sửa/i)).toHaveTextContent('H1 · Tiêu đề lớn');
  });

  it('supports direct Word-like inline text editing, adding/deleting paragraphs, Undo/Redo, and sends paragraphMutations', async () => {
    mocks.formatDocx.mockClear();
    mocks.previewDocxStructure.mockClear();
    mocks.formatDocx.mockResolvedValue({ downloadUrl: '/api/wordfmt/download/test.docx' });
    mocks.previewDocxStructure.mockResolvedValue(mocks.preview);

    render(<WordFmtPage />);
    const file = new File(['DOCX fixture'], 'soan-thao.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    fireEvent.change(document.querySelector('#docx-file-input'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText(/Giảng Viên Hướng Dẫn/i), { target: { value: 'TS. Lê Hoàng Hiệp' } });
    fireEvent.change(screen.getByLabelText(/Tên Sinh Viên \/ Nhóm/i), { target: { value: 'Nguyễn Vũ Đạt' } });
    fireEvent.click(screen.getByRole('button', { name: /Bắt đầu chuẩn hóa văn bản/i }));

    await waitFor(() => expect(mocks.previewDocxStructure).toHaveBeenCalledTimes(1));

    // 1. Click body paragraph #4 to open inline paper editor & edit text
    const bodySpan = await screen.findByText('Nội dung tóm tắt đề tài.', { selector: '.wf-pv-text' });
    fireEvent.click(bodySpan.closest('button'));

    const inlineEditor = await screen.findByLabelText('Sửa nội dung đoạn trên trang giấy');
    expect(inlineEditor).toHaveValue('Nội dung tóm tắt đề tài.');
    fireEvent.change(inlineEditor, { target: { value: 'Nội dung tóm tắt đã chỉnh sửa trực tiếp.' } });

    // 2. Insert a new paragraph directly below via the inline minibar and type into it
    fireEvent.click(screen.getByRole('button', { name: /↵ Thêm đoạn dưới/i }));
    const insertedEditor = await screen.findByLabelText('Sửa nội dung đoạn trên trang giấy');
    expect(insertedEditor).toHaveValue('');
    fireEvent.change(insertedEditor, { target: { value: 'Đoạn văn mới thêm ngay trên trang A4.' } });

    // 3. Delete paragraph #9 ("CHƯƠNG 1. TỔNG QUAN") then test Undo & Redo
    const ch1Span = screen.getByText('CHƯƠNG 1. TỔNG QUAN', { selector: '.wf-pv-text' });
    fireEvent.click(ch1Span.closest('button'));
    fireEvent.click(screen.getByRole('button', { name: /^🗑 Xóa$/i }));
    expect(screen.queryByText('CHƯƠNG 1. TỔNG QUAN', { selector: '.wf-pv-text' })).not.toBeInTheDocument();

    // Undo restores CHƯƠNG 1. TỔNG QUAN; Redo deletes it again
    fireEvent.click(screen.getByRole('button', { name: /↶ Hoàn tác/i }));
    expect(screen.getByText('CHƯƠNG 1. TỔNG QUAN', { selector: '.wf-pv-text' })).toBeInTheDocument();
    fireEvent.click(screen.getByTitle(/Làm lại thao tác/i));
    expect(screen.queryByText('CHƯƠNG 1. TỔNG QUAN', { selector: '.wf-pv-text' })).not.toBeInTheDocument();

    // 4. Confirm & verify FormData carries paragraphMutations
    fireEvent.click(screen.getByRole('button', { name: /Xác nhận & Chuẩn hóa DOCX/i }));
    await waitFor(() => expect(mocks.formatDocx).toHaveBeenCalledTimes(1));

    const [, formData] = mocks.formatDocx.mock.calls[0];
    const mutations = JSON.parse(formData.get('paragraphMutations'));
    expect(mutations.edits['4']).toBe('Nội dung tóm tắt đã chỉnh sửa trực tiếp.');
    expect(mutations.deletes).toEqual(['9']);
    expect(mutations.inserts).toEqual([
      {
        id: 'ins_1',
        afterKey: '4',
        beforeKey: '',
        role: 'body',
        text: 'Đoạn văn mới thêm ngay trên trang A4.'
      }
    ]);
  });
});
