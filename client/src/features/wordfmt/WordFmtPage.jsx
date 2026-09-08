import { useEffect, useRef, useState } from 'react';
import { formatDocx } from '../../api/tools.js';
import { useAuth, useToasts } from '../../app/providers.jsx';
import { getToolRun, startToolRun, subscribeToolRun } from '../../services/tool-runs.js';
import '../../styles/wordfmt-status.css';

const WORD_FMT_STAGES = [
  { title: 'Kiểm tra tệp', inProgress: 'Đang kiểm tra tệp DOCX', description: 'Đang ước tính khả năng đọc tệp và mức độ tương thích.' },
  { title: 'Xác định số chương', inProgress: 'Đang xác định số chương', description: 'Đang nhận diện cấu trúc tiêu đề trong tài liệu.' },
  { title: 'Nhận diện bảng & hình', inProgress: 'Đang nhận diện bảng & hình', description: 'Đang rà soát các đối tượng và chú thích có trong tài liệu.' },
  { title: 'Rà soát bìa/front-matter', inProgress: 'Đang rà soát bìa/front-matter', description: 'Đang đối chiếu các tùy chọn phần đầu tài liệu đã chọn.' },
  { title: 'Áp dụng định dạng', inProgress: 'Đang áp dụng định dạng', description: 'Đang xử lý các quy tắc định dạng theo cấu hình hiện tại.' },
  { title: 'Hoàn thiện', inProgress: 'Đang hoàn thiện tài liệu', description: 'Đang chuẩn bị tài liệu đầu ra và các thành phần liên quan.' },
  { title: 'Kiểm tra kết quả', inProgress: 'Đang kiểm tra kết quả', description: 'Đang chờ xác thực cuối cùng trước khi trả tài liệu cho bạn.' }
];

const SAFE_ERROR_MESSAGE = 'Không thể hoàn tất việc định dạng file. Vui lòng kiểm tra file DOCX hoặc kết nối rồi thử lại.';

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function reportWarnings(structure, outputNormalization) {
  const sources = [structure?.warnings, outputNormalization?.warnings];
  return [...new Set(sources.flatMap((warnings) => Array.isArray(warnings) ? warnings : [])
    .filter((warning) => typeof warning === 'string' && warning.trim()))];
}

function requestedOptions(choices) {
  if (!asRecord(choices)) return [];
  return [
    choices.includeCover && 'bìa',
    choices.includeComments && 'nhận xét',
    choices.includeThanks && 'lời cảm ơn',
    choices.onlyExistingCaptions && 'chỉ chú thích Bảng/Hình sẵn có',
    choices.skipProposal && 'giữ nguyên đề cương'
  ].filter(Boolean);
}

export function buildCompletionCards(result, choices) {
  const report = asRecord(result?.report);
  const structure = asRecord(report?.structure);
  const outputNormalization = asRecord(report?.outputNormalization);
  const compliance = asRecord(outputNormalization?.compliance);
  const cards = [];

  const chapterCount = asCount(structure?.chapterCount);
  if (chapterCount !== null) {
    cards.push({
      tone: 'info',
      title: 'Cấu trúc tài liệu',
      description: `Đã nhận diện ${chapterCount} chương trong tài liệu.`
    });
  }

  const captionsRenumbered = asCount(outputNormalization?.captionsRenumbered);
  if (captionsRenumbered !== null) {
    cards.push({
      tone: 'info',
      title: 'Bảng & hình',
      description: captionsRenumbered
        ? `Đã chuẩn hóa ${captionsRenumbered} chú thích Bảng/Hình.`
        : 'Không có chú thích Bảng/Hình nào được chuẩn hóa.'
    });
  }

  const tablesResized = asCount(outputNormalization?.tablesResized);
  if (tablesResized !== null) {
    cards.push({
      tone: 'info',
      title: 'Bảng dữ liệu',
      description: tablesResized
        ? `Đã điều chỉnh ${tablesResized} bảng theo khổ trang.`
        : 'Không có bảng dữ liệu nào được điều chỉnh.'
    });
  }

  const coversAdded = asCount(structure?.coversAdded);
  if (coversAdded !== null) {
    cards.push({
      tone: 'info',
      title: 'Trang bìa',
      description: coversAdded
        ? `Đã thêm ${coversAdded} trang bìa theo cấu trúc tài liệu.`
        : 'Không có trang bìa nào được thêm.'
    });
  }

  if (outputNormalization?.frontMatterReordered === true) {
    cards.push({
      tone: 'info',
      title: 'Phần đầu tài liệu',
      description: 'Đã sắp xếp lại thứ tự phần đầu tài liệu.'
    });
  }

  if (compliance?.proposalSkipped === true) {
    cards.push({
      tone: 'info',
      title: 'Đề cương',
      description: 'Đề cương được giữ nguyên theo tùy chọn đã chọn.'
    });
  }

  const verifiedChecks = [
    compliance?.a4Portrait === true && 'khổ A4',
    compliance?.margins === true && 'lề trang',
    compliance?.headingStructure === true && 'cấu trúc tiêu đề'
  ].filter(Boolean);
  if (verifiedChecks.length) {
    cards.push({
      tone: 'success',
      title: 'Kiểm tra đầu ra',
      description: `Đã xác thực: ${verifiedChecks.join(', ')}.`
    });
  }

  const warnings = reportWarnings(structure, outputNormalization);
  if (warnings.length) {
    cards.push({
      tone: 'warning',
      title: 'Lưu ý cần xem lại',
      description: `Báo cáo đầu ra có ${warnings.length} lưu ý. Hãy mở tài liệu đã tải xuống để kiểm tra các vị trí liên quan.`
    });
  } else if (report && (structure || outputNormalization)) {
    cards.push({
      tone: 'success',
      title: 'Lưu ý',
      description: 'Báo cáo đầu ra không ghi nhận lưu ý cần xem lại.'
    });
  }

  const options = requestedOptions(choices);
  if (options.length) {
    cards.push({
      tone: 'muted',
      title: 'Tùy chọn đã gửi',
      description: options.join(' · ')
    });
  }

  return cards;
}

function getSafeDownloadUrl(result) {
  const candidate = typeof result?.downloadUrl === 'string' ? result.downloadUrl.trim() : '';
  if (!candidate) return null;
  try {
    const url = new URL(candidate, window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const isRelativePath = candidate.startsWith('/') && !candidate.startsWith('//');
    if (url.origin !== window.location.origin && !isRelativePath) return null;
    return candidate;
  } catch {
    return null;
  }
}

export default function WordFmtPage() {
  const auth = useAuth();
  const { notify } = useToasts();
  const inputRef = useRef(null);
  const courseworkOptionsRef = useRef(null);

  const [file, setFile] = useState(null);
  const [documentType, setDocumentType] = useState('tieu_luan');
  const [instructor, setInstructor] = useState('');
  const [student, setStudent] = useState(auth.user?.name || '');
  const [studentId, setStudentId] = useState(auth.user?.mssv || '');
  const [className, setClassName] = useState('');
  const [topic, setTopic] = useState('');
  const [docTitle, setDocTitle] = useState('TIỂU LUẬN MÔN HỌC');
  const [institution, setInstitution] = useState('TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG');
  const [faculty, setFaculty] = useState('KHOA CÔNG NGHỆ THÔNG TIN, ROBOT VÀ TRÍ TUỆ NHÂN TẠO');
  const [course, setCourse] = useState('');
  const [location, setLocation] = useState('Thành phố Hồ Chí Minh');
  const [mode, setMode] = useState('digital_document');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');

  const [includeCover, setIncludeCover] = useState(true);
  const [includeComments, setIncludeComments] = useState(true);
  const [includeThanks, setIncludeThanks] = useState(true);
  // Missing captions are ambiguous in real reports: many tables are layout or
  // use-case forms, so inserting placeholders can visibly alter the document.
  const [onlyExistingCaptions, setOnlyExistingCaptions] = useState(true);
  const [skipProposal, setSkipProposal] = useState(false);

  const [run, setRun] = useState(() => getToolRun('wordfmt') || { status: 'idle', result: null });

  useEffect(() => {
    return subscribeToolRun('wordfmt', (next) => {
      setRun(next || { status: 'idle', result: null });
    });
  }, []);

  useEffect(() => {
    if (run.status === 'success') notify('Chuẩn hóa văn bản thành công!', 'success');
    if (run.status === 'error') notify(SAFE_ERROR_MESSAGE, 'error');
  }, [notify, run.status]);

  const selectFile = (candidate) => {
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith('.docx')) {
      notify('Vui lòng chọn file Word định dạng .docx', 'error');
      return;
    }
    setFile(candidate);
  };

  const changeDocumentType = (nextType) => {
    if (nextType === 'do_an_tot_nghiep') {
      courseworkOptionsRef.current = { docTitle, includeCover, includeComments };
      setDocumentType(nextType);
      setDocTitle('ĐỒ ÁN TỐT NGHIỆP');
      setIncludeCover(true);
      setIncludeComments(true);
      return;
    }

    const previous = courseworkOptionsRef.current;
    setDocumentType(nextType);
    setDocTitle(previous?.docTitle || 'TIỂU LUẬN MÔN HỌC');
    setIncludeCover(previous?.includeCover ?? true);
    setIncludeComments(previous?.includeComments ?? true);
  };

  const submit = (event) => {
    event.preventDefault();
    if (!file) {
      notify('Vui lòng chọn file .docx trước khi bắt đầu.', 'error');
      return;
    }
    if (!instructor.trim()) {
      notify('Vui lòng nhập tên Giảng Viên Hướng Dẫn.', 'error');
      return;
    }
    if (!student.trim()) {
      notify('Vui lòng nhập tên Sinh Viên / Nhóm.', 'error');
      return;
    }

    const studentWords = student.trim().split(/\s+/).filter(Boolean).length;
    const topicWords = topic.trim().split(/\s+/).filter(Boolean).length;

    let warningMsg = '';
    if (studentWords > 6 && topicWords > 40) {
      warningMsg = `Tên sinh viên vượt quá 6 từ (${studentWords} từ) và tên tiểu luận/đề tài vượt quá 40 từ (${topicWords} từ), khi xuất ra bìa có khả năng sẽ bị lỗi định dạng. Bạn vẫn muốn tiếp tục chứ?`;
    } else if (studentWords > 6) {
      warningMsg = `Tên sinh viên vượt quá 6 từ (${studentWords} từ), khi xuất ra bìa có khả năng sẽ bị lỗi định dạng. Bạn vẫn muốn tiếp tục chứ?`;
    } else if (topicWords > 40) {
      warningMsg = `Tên tiểu luận/đề tài vượt quá 40 từ (${topicWords} từ), khi xuất ra bìa có khả năng sẽ bị lỗi định dạng. Bạn vẫn muốn tiếp tục chứ?`;
    }

    if (warningMsg) {
      const proceed = window.confirm(warningMsg);
      if (!proceed) return;
    }

    const body = new FormData();
    body.append('document', file);
    const frontMatter = [
      includeCover && 'cover',
      includeComments && 'comments',
      includeThanks && 'thanks'
    ].filter(Boolean).join(',');

    body.append('documentType', documentType);
    body.append('documentMode', mode);
    body.append('instructor', instructor);
    body.append('student', student);
    if (studentId) body.append('studentId', studentId);
    if (className) body.append('className', className);
    if (topic) body.append('topic', topic);
    if (docTitle) body.append('documentTitle', docTitle);
    if (institution) body.append('institution', institution);
    if (faculty) body.append('faculty', faculty);
    if (course) body.append('course', course);
    if (location) body.append('location', location);
    if (month) body.append('month', month);
    if (year) body.append('year', year);

    body.append('includeCover', includeCover);
    body.append('includeComments', includeComments);
    body.append('includeThanks', includeThanks);
    body.append('frontMatter', frontMatter);
    body.append('onlyExistingCaptions', onlyExistingCaptions);
    body.append('skipProposal', skipProposal);

    startToolRun('wordfmt', () => formatDocx(auth.token, body), {
      stageCount: WORD_FMT_STAGES.length,
      summaryChoices: { includeCover, includeComments, includeThanks, onlyExistingCaptions, skipProposal }
    });
  };

  const isRunning = run.status === 'running';
  const isSuccess = run.status === 'success';
  const isError = run.status === 'error';
  const progress = Math.min(100, Math.max(0, Number.isFinite(run.progress) ? run.progress : 0));
  const stageIndex = Math.min(
    WORD_FMT_STAGES.length - 1,
    Math.max(0, Number.isFinite(run.stageIndex) ? run.stageIndex : 0)
  );
  const activeStage = WORD_FMT_STAGES[stageIndex];
  const downloadUrl = isSuccess ? getSafeDownloadUrl(run.result) : null;
  const completionCards = isSuccess ? buildCompletionCards(run.result, run.summaryChoices) : [];

  return (
    <section id="tab-wordfmt" className="tab-pane active">
      <div className="section-header-box glass-panel">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <div className="header-split">
          <div>
            <h2 className="section-title">Chuẩn Hóa Văn Bản Word (BDU WordFmt)</h2>
            <p className="section-desc">
              Tự động định dạng lề A4, font chữ, Heading H1-H4, mục lục, bảng/hình, bìa chuẩn viện HTTT/BDU
            </p>
          </div>
          <span className="badge-mini badge-pill-emerald">.NET 10 Engine</span>
        </div>
      </div>

      <div className="wordfmt-layout">
        {/* Left: Upload & Config Form */}
        <div className="wordfmt-card glass-panel">
          <form id="form-wordfmt" onSubmit={submit}>
            {/* Dropzone */}
            <div className="form-group">
              <label className="form-label">Chọn hoặc Kéo Thả File Tiểu Luận / Đồ Án (.docx):</label>
              <div
                id="docx-dropzone"
                className="dropzone-box"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  selectFile(e.dataTransfer.files?.[0]);
                }}
                onClick={() => !file && inputRef.current?.click()}
                style={{ cursor: file ? 'default' : 'pointer' }}
              >
                <input
                  ref={inputRef}
                  type="file"
                  id="docx-file-input"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden-file-input"
                  onChange={(e) => selectFile(e.target.files?.[0])}
                  style={{ display: 'none' }}
                />
                {!file ? (
                  <div className="dropzone-content">
                    <h4 className="dropzone-title">Kéo & Thả file .docx vào đây</h4>
                    <p className="dropzone-subtitle">
                      hoặc <span className="text-blue cursor-pointer">Bấm để chọn file từ máy tính</span>
                    </p>
                    <span className="dropzone-hint">Dung lượng tối đa 25MB (.docx)</span>
                  </div>
                ) : (
                  <div id="dropzone-file-info" className="file-info-badge">
                    <span id="selected-file-name" className="file-name">{file.name}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      ({(file.size / 1024).toFixed(1)} KB)
                    </span>
                    <button
                      type="button"
                      id="btn-remove-file"
                      className="btn-remove-file"
                      title="Xóa file"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Form Details */}
            <div className="form-group">
              <label htmlFor="wf-document-type" className="form-label">Loại tài liệu:</label>
              <select
                id="wf-document-type"
                className="form-input"
                value={documentType}
                onChange={(e) => changeDocumentType(e.target.value)}
              >
                <option value="tieu_luan">Tiểu luận môn học</option>
                <option value="do_an_tot_nghiep">Đồ án tốt nghiệp</option>
              </select>
                <p id="wf-document-type-hint" className="dropzone-hint" aria-live="polite">
                  {documentType === 'do_an_tot_nghiep'
                  ? 'Chuẩn hóa đầu đề cương, giữ nguyên khung nội dung và ký duyệt; bổ sung hai trang nhận xét theo mẫu đồ án.'
                  : 'Định dạng tiểu luận theo cấu hình hiện tại.'}
              </p>
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label htmlFor="wf-instructor" className="form-label">
                  Giảng Viên Hướng Dẫn (GVHD): <span className="required">*</span>
                </label>
                <input
                  type="text"
                  id="wf-instructor"
                  className="form-input"
                  placeholder="Nhập họ và tên GVHD (Ví dụ: ThS. Nguyễn Văn A)"
                  value={instructor}
                  onChange={(e) => setInstructor(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="wf-student" className="form-label">
                  Tên Sinh Viên / Nhóm: <span className="required">*</span>
                </label>
                <input
                  type="text"
                  id="wf-student"
                  className="form-input"
                  placeholder="Nhập họ tên sinh viên hoặc tên nhóm"
                  value={student}
                  onChange={(e) => setStudent(e.target.value)}
                  required
                />
                {student.trim().split(/\s+/).filter(Boolean).length > 6 && (
                  <p className="dropzone-hint" style={{ color: '#f59e0b', marginTop: '4px' }}>
                    ⚠️ Tên sinh viên dài hơn 6 từ ({student.trim().split(/\s+/).filter(Boolean).length} từ). Có thể gây lệch bố cục trang bìa.
                  </p>
                )}
              </div>
            </div>

            <details className="form-group wordfmt-cover-options">
              <summary className="form-label" style={{ cursor: 'pointer' }}>Thông tin bìa và chế độ xuất</summary>
              <div className="form-row-2" style={{ marginTop: '12px' }}>
                <div className="form-group">
                  <label htmlFor="wf-institution" className="form-label">Trường:</label>
                  <input
                    type="text"
                    id="wf-institution"
                    className="form-input"
                    value={institution}
                    onChange={(e) => setInstitution(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="wf-faculty" className="form-label">Khoa / Viện:</label>
                  <input
                    type="text"
                    id="wf-faculty"
                    className="form-input"
                    value={faculty}
                    onChange={(e) => setFaculty(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-row-2">
                <div className="form-group">
                  <label htmlFor="wf-course" className="form-label">Tên môn học (nếu cần trên bìa):</label>
                  <input
                    type="text"
                    id="wf-course"
                    className="form-input"
                    placeholder="Để trống nếu bìa không yêu cầu"
                    value={course}
                    onChange={(e) => setCourse(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="wf-location" className="form-label">Địa điểm:</label>
                  <input
                    type="text"
                    id="wf-location"
                    className="form-input"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="wf-document-mode" className="form-label">Chế độ tài liệu:</label>
                <select
                  id="wf-document-mode"
                  className="form-input"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  <option value="digital_document">Tài liệu số</option>
                  <option value="binding_package">
                    {documentType === 'do_an_tot_nghiep'
                      ? 'Bản phục vụ đóng quyển (giữ hai trang bìa)'
                      : 'Bản phục vụ đóng quyển (thêm trang trắng và bản sao bìa)'}
                  </option>
                </select>
                <p id="wf-binding-hint" className="dropzone-hint">
                  {mode === 'binding_package'
                    ? (documentType === 'do_an_tot_nghiep'
                      ? 'Đồ án có hai trang bìa ở cả hai chế độ xuất; không thêm trang trắng hoặc bìa trùng.'
                      : 'Khi chọn bản đóng quyển: in một mặt trên A4, dùng bìa cứng xanh dương và tờ bìa sau cùng màu.')
                    : 'Bản số tiêu chuẩn nộp trực tuyến qua Moodle/Email.'}
                </p>
              </div>
              <div className="form-row-2">
                <div className="form-group">
                  <label htmlFor="wf-month" className="form-label">Tháng trên bìa:</label>
                  <input
                    type="text"
                    id="wf-month"
                    className="form-input"
                    inputMode="numeric"
                    placeholder="Ví dụ: 9"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="wf-year" className="form-label">Năm trên bìa:</label>
                  <input
                    type="text"
                    id="wf-year"
                    className="form-input"
                    inputMode="numeric"
                    placeholder="Ví dụ: 2026"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                  />
                </div>
              </div>
            </details>

            <div className="form-row-2">
              <div className="form-group">
                <label htmlFor="wf-student-id" className="form-label">Mã Số Sinh Viên (MSSV):</label>
                <input
                  type="text"
                  id="wf-student-id"
                  className="form-input"
                  placeholder="Nhập mã số sinh viên (Ví dụ: 2405xxxx)"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="wf-class-name" className="form-label">Lớp Sinh Hoạt:</label>
                <input
                  type="text"
                  id="wf-class-name"
                  className="form-input"
                  placeholder="Nhập mã lớp sinh hoạt (Ví dụ: 2405SE01)"
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                />
              </div>
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label htmlFor="wf-topic" className="form-label">Tên Đề Tài / Báo Cáo:</label>
                <input
                  type="text"
                  id="wf-topic"
                  className="form-input"
                  placeholder="Ví dụ: Xây dựng hệ thống tra cứu điểm BDU"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                />
                {topic.trim().split(/\s+/).filter(Boolean).length > 40 && (
                  <p className="dropzone-hint" style={{ color: '#f59e0b', marginTop: '4px' }}>
                    ⚠️ Tên đề tài dài hơn 40 từ ({topic.trim().split(/\s+/).filter(Boolean).length} từ). Có thể gây lệch bố cục trang bìa.
                  </p>
                )}
              </div>
              <div className="form-group">
                <label htmlFor="wf-doc-title" className="form-label">Tiêu Đề Bìa:</label>
                <input
                  type="text"
                  id="wf-doc-title"
                  className="form-input"
                  placeholder="TIỂU LUẬN MÔN HỌC"
                    value={docTitle}
                    onChange={(e) => setDocTitle(e.target.value)}
                    readOnly={documentType === 'do_an_tot_nghiep'}
                />
              </div>
            </div>

            {/* Front Matter Sections Selector */}
            <div className="form-group">
              <label className="form-label">Tự Động Tạo Các Trang Đầu Tài Liệu (Front-Matter):</label>
              <div className="features-checklist">
                <label className="feature-item">
                  <input
                    type="checkbox"
                    id="wf-include-cover"
                    checked={includeCover}
                    onChange={(e) => setIncludeCover(e.target.checked)}
                    disabled={documentType === 'do_an_tot_nghiep'}
                  />
                  <span id="wf-cover-label">
                    <strong>{documentType === 'do_an_tot_nghiep' ? 'Hai trang bìa:' : 'Trang bìa:'}</strong>{' '}
                    {documentType === 'do_an_tot_nghiep'
                      ? 'Bìa chính và bìa phụ; chỉ thêm bìa còn thiếu.'
                      : 'Khung viền chuẩn BDU, đề tài, GVHD, SVTH, Lớp, MSSV'}
                  </span>
                </label>
                <label className="feature-item">
                  <input
                    type="checkbox"
                    id="wf-include-comments"
                    checked={includeComments}
                    onChange={(e) => setIncludeComments(e.target.checked)}
                    disabled={documentType === 'do_an_tot_nghiep'}
                  />
                  <span id="wf-comments-label">
                    <strong>{documentType === 'do_an_tot_nghiep' ? 'Hai trang nhận xét:' : 'Nhận xét giảng viên:'}</strong>{' '}
                    {documentType === 'do_an_tot_nghiep'
                      ? 'Giảng viên hướng dẫn và giảng viên phản biện, có chỗ ký tên.'
                      : 'Trang có vùng trống để giảng viên ghi nhận xét'}
                  </span>
                </label>
                <label className="feature-item">
                  <input
                    type="checkbox"
                    id="wf-include-thanks"
                    checked={includeThanks}
                    onChange={(e) => setIncludeThanks(e.target.checked)}
                  />
                  <span><strong>Lời cảm ơn:</strong> Trang trình bày học thuật, không thêm khung trang trí</span>
                </label>
                <label className="feature-item">
                  <input type="checkbox" checked disabled />
                  <span><strong>Mục lục & Danh mục Bảng/Hình:</strong> Nếu đã có, thay bằng trường chuẩn do tool tạo; không tự thêm mục mới</span>
                </label>
              </div>
            </div>

            {/* Advanced Formatting Options */}
            <div className="form-group">
              <label className="form-label">Tùy Chọn Định Dạng Nâng Cao:</label>
              <div className="features-checklist">
                <label className="feature-item">
                  <input
                    type="checkbox"
                    id="wf-only-existing-captions"
                    checked={onlyExistingCaptions}
                    onChange={(e) => setOnlyExistingCaptions(e.target.checked)}
                  />
                  <span id="wf-only-existing-captions-label">
                    <strong>Chỉ định dạng Bảng và Hình đã có sẵn:</strong> Khuyến nghị để bảo toàn cấu trúc gốc; không tự chèn caption giữ chỗ vào bảng/hình chưa có caption
                  </span>
                </label>
                <label className="feature-item">
                  <input
                    type="checkbox"
                    id="wf-skip-proposal"
                    checked={skipProposal}
                    onChange={(e) => setSkipProposal(e.target.checked)}
                  />
                  <span id="wf-skip-proposal-label">
                    <strong>Bỏ qua định dạng đề cương:</strong> Xác định vùng đề cương và giữ nguyên hoàn toàn, chỉ định dạng nội dung phía sau
                  </span>
                </label>
              </div>
            </div>

            <button
              type="submit"
              id="btn-start-wordfmt"
              className="btn btn-primary btn-block btn-lg"
              disabled={isRunning}
            >
              <span className="btn-text">{isRunning ? 'Đang chuẩn hóa…' : 'Bắt đầu chuẩn hóa văn bản'}</span>
            </button>
          </form>
        </div>

        {/* Right: Result & Diagnostics */}
        <div className="wf-status-column">
          <div id="wordfmt-status-card" className={`glass-panel wf-status-card${isRunning ? ' wf-status-card--running' : ''}${isError ? ' wf-status-card--error' : ''}`}>
            {!isRunning && !isSuccess && !isError && (
              <div className="wf-status-empty">
                <h3>Sẵn sàng định dạng văn bản</h3>
                <p>Chọn file `.docx` và điền thông tin bên trái để bắt đầu quy trình chuẩn hóa.</p>
              </div>
            )}

            {isRunning && (
              <div id="wordfmt-progress-box" className="wf-run" aria-live="polite">
                <div className="wf-run-scene" aria-hidden="true">
                  <div className="wf-run-orbit wf-run-orbit--one"></div>
                  <div className="wf-run-orbit wf-run-orbit--two"></div>
                  <div className="wf-run-sheet wf-run-sheet--back"></div>
                  <div className="wf-run-sheet wf-run-sheet--middle"></div>
                  <div className="wf-run-sheet wf-run-sheet--front">
                    <img className="wf-run-brand" src="/assets/images/logo-hao-quang-transparent.png" alt="" />
                    <span className="wf-run-line wf-run-line--title"></span>
                    <span className="wf-run-line"></span>
                    <span className="wf-run-line wf-run-line--short"></span>
                    <span className="wf-run-line"></span>
                    <span className="wf-run-line wf-run-line--medium"></span>
                    <span className="wf-run-scan"></span>
                  </div>
                </div>

                <div className="wf-run-content">
                  <p className="wf-run-eyebrow">WordFmt · Tiến độ ước tính</p>
                  <h3 id="wordfmt-progress-title" className="wf-run-title">{activeStage.inProgress}</h3>
                  <p id="wordfmt-progress-desc" className="wf-run-description">
                    {activeStage.description}
                  </p>

                  <div className="wf-run-meter" role="progressbar" aria-label="Tiến độ chuẩn hóa (ước tính)" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>
                    <span id="wordfmt-progress-fill" className="wf-run-meter-fill" style={{ width: `${progress}%` }}></span>
                  </div>
                  <div className="wf-run-meta">
                    <strong id="wordfmt-progress-percent">{progress}% · Tiến độ ước tính</strong>
                    <span id="wordfmt-progress-time">Kết quả sẽ trả sau tối thiểu 10 giây</span>
                  </div>
                </div>

                <ol className="wf-run-stages">
                  {WORD_FMT_STAGES.map((stage, index) => (
                    <li
                      key={stage.title}
                      data-stage={index}
                      className={`${index < stageIndex ? 'wf-run-stage--complete' : ''}${index === stageIndex ? ' wf-run-stage--active' : ''}`}
                      aria-current={index === stageIndex ? 'step' : undefined}
                    >
                      <span>{String(index + 1).padStart(2, '0')}</span>{stage.title}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {isSuccess && (
              <div id="wordfmt-success-box" className="wf-status-success">
                <div className="wf-status-success-header">
                  <div className="wf-status-badge">ĐỊNH DẠNG HOÀN TẤT</div>
                  <h3 className="wf-status-title">Văn bản đã được chuẩn hóa 100%!</h3>
                  <p className="wf-status-description">Các mục dưới đây chỉ hiển thị thông tin được báo cáo từ tài liệu đầu ra.</p>
                </div>

                {downloadUrl ? (
                  <a
                    id="btn-download-docx"
                    href={downloadUrl}
                    className="btn btn-success btn-block btn-lg"
                    download
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" x2="12" y1="15" y2="3" />
                    </svg>
                    <span>Tải Về File DOCX Đã Chuẩn Hóa</span>
                  </a>
                ) : (
                  <p className="wf-status-download-unavailable" role="status">
                    Tài liệu đã hoàn tất nhưng liên kết tải xuống chưa khả dụng. Vui lòng thử lại.
                  </p>
                )}

                <div id="wordfmt-completion-summary" className="wf-status-summary" aria-label="Tóm tắt kết quả">
                  {completionCards.length ? completionCards.map((card) => (
                    <article key={`${card.title}-${card.description}`} className={`wf-status-summary-card wf-status-summary-card--${card.tone}`}>
                      <h4>{card.title}</h4>
                      <p>{card.description}</p>
                    </article>
                  )) : (
                    <article className="wf-status-summary-card wf-status-summary-card--muted">
                      <h4>Tài liệu đầu ra</h4>
                      <p>Tài liệu đã sẵn sàng để tải xuống. Báo cáo không cung cấp thêm chi tiết để hiển thị.</p>
                    </article>
                  )}
                </div>
              </div>
            )}

            {isError && (
              <div id="wordfmt-error-box" className="wf-status-error" role="alert">
                <div className="wf-status-error-icon" aria-hidden="true">!</div>
                <div>
                  <p className="wf-status-eyebrow">WORD_FMT · CẦN THỬ LẠI</p>
                  <h3 className="wf-status-title">Chưa thể hoàn tất chuẩn hóa</h3>
                  <p className="wf-status-error-description">{SAFE_ERROR_MESSAGE}</p>
                  <p className="wf-status-error-hint">File gốc của bạn không bị thay đổi. Kiểm tra lại file DOCX hoặc kết nối rồi bấm bắt đầu để thử lại.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
