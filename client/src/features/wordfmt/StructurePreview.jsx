import { useMemo, useState } from 'react';

export const ROLE_OPTIONS = [
  { value: 'chapter', label: 'Heading 1 · Chương (CHƯƠNG n)', short: 'H1 · Chương' },
  { value: 'major_title', label: 'Heading 1 · Tiêu đề lớn, vào mục lục (Tóm tắt, Kết luận…)', short: 'H1 · Tiêu đề lớn' },
  { value: 'front_title', label: 'Tiêu đề trang đầu, không vào mục lục (Lời cảm ơn…)', short: 'Tiêu đề trang đầu' },
  { value: 'heading2', label: 'Heading 2 · Mục 1.1', short: 'H2' },
  { value: 'heading3', label: 'Heading 3 · Mục 1.1.1', short: 'H3' },
  { value: 'heading4', label: 'Heading 4 · Mục 1.1.1.1', short: 'H4' },
  { value: 'intro_title', label: 'Tiêu đề Mở đầu', short: 'Mở đầu' },
  { value: 'body', label: 'Đoạn văn nội dung', short: 'Nội dung' },
  { value: 'equation', label: 'Công thức toán học (căn giữa, 13pt)', short: 'Công thức toán' },
  { value: 'signature', label: 'Khối chữ ký (lệch phải, 13pt)', short: 'Khối chữ ký' },
  { value: 'figure_caption', label: 'Chú thích hình', short: 'Chú thích hình' },
  { value: 'table_caption', label: 'Chú thích bảng', short: 'Chú thích bảng' }
];

const ROLE_LABELS = {
  ...Object.fromEntries(ROLE_OPTIONS.map((option) => [option.value, option.short])),
  part_title: 'Phần nội dung',
  intro_heading: 'Mục mở đầu',
  proposal_title: 'Đề cương',
  proposal: 'Đề cương (giữ nguyên)',
  appendix: 'Phụ lục (giữ nguyên)',
  cover: 'Bìa',
  index: 'Mục lục tự động',
  table: 'Bảng',
  image: 'Hình ảnh',
  auto: 'Tự động'
};

const OUTLINE_LEVEL = {
  chapter: 1, major_title: 1, front_title: 1, intro_title: 1, part_title: 1, proposal_title: 1,
  heading2: 2, intro_heading: 2, heading3: 3, heading4: 4
};

const QUICK_ROLES = ['chapter', 'major_title', 'heading2', 'heading3', 'heading4', 'equation', 'body'];
const LOCKED_ROLES = new Set(['proposal', 'appendix', 'proposal_title']);

export function effectiveRole(item, overrides) {
  const override = overrides[item.i];
  if (override && override !== 'auto') return override;
  if (override === 'auto' && item.forced) return 'auto';
  return item.role;
}

function isEditable(item) {
  return item.kind === 'p' && !LOCKED_ROLES.has(item.role);
}

function currentVietnamMonthYear() {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      month: 'numeric',
      year: 'numeric'
    }).formatToParts(now);
    const month = parts.find((p) => p.type === 'month')?.value;
    const year = parts.find((p) => p.type === 'year')?.value;
    if (month && year) return { month: String(Number(month)), year };
  } catch { /* fallback */ }
  return { month: String(now.getMonth() + 1), year: String(now.getFullYear()) };
}

function formatCoverDate(coverInfo) {
  const { month: curMonth, year: curYear } = currentVietnamMonthYear();
  const loc = String(coverInfo.location || 'Thành phố Hồ Chí Minh').trim();
  const resolvedMonth = String(coverInfo.month || '').trim() || curMonth;
  const resolvedYear = String(coverInfo.year || '').trim() || curYear;
  return `${loc}, tháng ${resolvedMonth} năm ${resolvedYear}`;
}

export default function StructurePreview({
  fileName,
  coverInfo,
  preview,
  loading,
  error,
  dirty,
  isSubmitting,
  overrides,
  notes,
  onRoleChange,
  onNoteChange,
  onRefresh,
  onReset,
  onBack,
  onConfirm
}) {
  const [filter, setFilter] = useState('all');
  const [activeIndex, setActiveIndex] = useState(null);
  const items = useMemo(() => preview?.items || [], [preview]);

  const outline = useMemo(() => items
    .map((item) => ({ item, role: effectiveRole(item, overrides) }))
    .filter(({ role }) => OUTLINE_LEVEL[role]), [items, overrides]);

  const visibleItems = useMemo(() => items.filter((item) => {
    const role = effectiveRole(item, overrides);
    if (filter === 'outline') return Boolean(OUTLINE_LEVEL[role]) || item.suspect;
    if (filter === 'suspect') return Boolean(item.suspect) && !(item.i in overrides);
    if (filter === 'changed') return item.i in overrides || Boolean(notes[item.i]) || item.forced;
    return true;
  }), [filter, items, overrides, notes]);

  const changes = useMemo(() => {
    const byIndex = new Map(items.map((item) => [item.i, item]));
    const indexes = new Set([...Object.keys(overrides), ...Object.keys(notes)].map(Number));
    return [...indexes].sort((a, b) => a - b).map((index) => ({
      index,
      item: byIndex.get(index),
      role: overrides[index],
      note: notes[index]
    }));
  }, [items, overrides, notes]);

  const suspectCount = items.filter((item) => item.suspect && !(item.i in overrides)).length;
  const coverDate = coverInfo ? formatCoverDate(coverInfo) : '';

  const scrollTo = (index) => {
    setActiveIndex(index);
    const node = document.getElementById(`wf-pv-${index}`);
    node?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  };

  return (
    <section className="wf-preview glass-panel" aria-labelledby="wf-preview-title">
      <div className="wf-preview-steps" aria-label="Các bước chuẩn hóa">
        <span className="wf-step is-done">1. Nhập thông tin</span>
        <span className="wf-step-sep" aria-hidden="true">→</span>
        <span className="wf-step is-current">2. Xem trước &amp; chỉnh sửa</span>
        <span className="wf-step-sep" aria-hidden="true">→</span>
        <span className="wf-step">3. Chuẩn hóa &amp; tải về</span>
      </div>

      <header className="wf-preview-header">
        <div>
          <p className="wf-preview-eyebrow">Review trước khi chuẩn hóa</p>
          <h3 id="wf-preview-title" className="wf-preview-title">Khung thiết kế &amp; bản xem trước tài liệu</h3>
          <p className="wf-preview-desc">
            Kiểm tra khung bìa, mục lục và từng đoạn trước khi xuất file. Bấm vào một đoạn để đổi kiểu
            (ví dụ đặt <strong>TÓM TẮT</strong> thành Heading 1) hoặc ghi chú phần muốn sửa.
          </p>
        </div>
        <div className="wf-preview-actions">
          <button type="button" className="btn btn-ghost" onClick={onBack} disabled={isSubmitting}>
            ← Quay lại chỉnh thông tin
          </button>
          <button type="button" className="btn btn-secondary" onClick={onRefresh} disabled={loading || isSubmitting}>
            {loading ? 'Đang phân tích…' : dirty ? 'Cập nhật xem trước' : 'Phân tích lại'}
          </button>
          {changes.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={onReset} disabled={loading || isSubmitting}>
              Bỏ chỉnh sửa
            </button>
          )}
          <button
            type="button"
            id="btn-confirm-wordfmt"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={loading || isSubmitting || !preview}
          >
            {isSubmitting ? 'Đang chuẩn hóa…' : 'Xác nhận & Chuẩn hóa DOCX'}
          </button>
        </div>
      </header>

      {error && <p className="wf-preview-error" role="alert">{error}</p>}

      {loading && !preview && (
        <div className="wf-preview-loading" role="status" aria-live="polite">
          <div className="wf-preview-spinner" aria-hidden="true"></div>
          <div>
            <strong>Đang phân tích cấu trúc tài liệu…</strong>
            <p>Hệ thống đang đọc các chương, mục con, bảng/hình trong file {fileName}.</p>
          </div>
        </div>
      )}

      {preview && (
        <>
          <div className="wf-preview-stats" aria-label="Thống kê cấu trúc">
            <span><strong>{preview.summary?.chapterCount ?? 0}</strong> chương</span>
            <span><strong>{preview.summary?.headingCount ?? 0}</strong> mục con</span>
            <span className={suspectCount ? 'is-warning' : ''}><strong>{suspectCount}</strong> đoạn cần xem lại</span>
            <span><strong>{changes.length}</strong> chỉnh sửa</span>
            {fileName && <span className="wf-preview-file">{fileName}</span>}
          </div>

          <div className="wf-preview-filters" role="tablist" aria-label="Lọc đoạn văn">
            {[
              ['all', 'Tất cả'],
              ['outline', 'Chỉ khung tiêu đề'],
              ['suspect', `Cần xem lại (${suspectCount})`],
              ['changed', `Đã chỉnh (${changes.length})`]
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                className={`wf-preview-filter${filter === value ? ' is-active' : ''}`}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="wf-preview-body">
            <nav className="wf-preview-outline" aria-label="Khung tài liệu">
              <h4>Khung tài liệu</h4>
              {outline.length ? (
                <ol>
                  {outline.map(({ item, role }) => (
                    <li key={item.i} className={`wf-outline-l${OUTLINE_LEVEL[role]}${item.i in overrides ? ' is-changed' : ''}`}>
                      <button type="button" onClick={() => scrollTo(item.i)} title={item.t}>
                        {item.t}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="wf-preview-muted">Chưa nhận diện được tiêu đề nào.</p>
              )}
            </nav>

            <div className="wf-preview-paper-wrap">
              {coverInfo?.includeCover && filter === 'all' && (
                <div className="wf-preview-cover-card" aria-label="Khung trang bìa dự kiến">
                  <div className="wf-preview-cover-inner">
                    <div className="wf-cover-org">
                      {coverInfo.institution && <p className="wf-cover-inst">{coverInfo.institution}</p>}
                      {coverInfo.faculty && <p className="wf-cover-faculty">{coverInfo.faculty}</p>}
                    </div>
                    <div className="wf-cover-main">
                      <p className="wf-cover-type">{coverInfo.docTitle || 'TIỂU LUẬN MÔN HỌC'}</p>
                      {coverInfo.topic && (
                        <>
                          <p className="wf-cover-topic-label">TÊN ĐỀ TÀI:</p>
                          <p className="wf-cover-topic">{coverInfo.topic}</p>
                        </>
                      )}
                    </div>
                    <div className="wf-cover-meta">
                      {coverInfo.course && <p><strong>Học phần:</strong> {coverInfo.course}</p>}
                      {coverInfo.instructor && <p><strong>Giảng viên hướng dẫn:</strong> {coverInfo.instructor}</p>}
                      {coverInfo.student && <p><strong>Sinh viên thực hiện:</strong> {coverInfo.student}</p>}
                      {coverInfo.studentId && <p><strong>MSSV:</strong> {coverInfo.studentId}</p>}
                      {coverInfo.className && <p><strong>Lớp:</strong> {coverInfo.className}</p>}
                    </div>
                    {coverDate && <p className="wf-cover-date">{coverDate}</p>}
                  </div>
                </div>
              )}

              <div className="wf-preview-paper">
                {visibleItems.length === 0 && <p className="wf-preview-muted">Không có đoạn nào trong bộ lọc này.</p>}
                {visibleItems.map((item) => {
                  const role = effectiveRole(item, overrides);
                  const changed = item.i in overrides;
                  const active = activeIndex === item.i;
                  const editable = isEditable(item);
                  return (
                    <div
                      key={item.i}
                      id={`wf-pv-${item.i}`}
                      className={`wf-pv-block wf-pv-${role}${changed ? ' is-changed' : ''}${item.forced && !changed ? ' is-forced' : ''}${item.suspect && !changed ? ' is-suspect' : ''}${active ? ' is-active' : ''}${notes[item.i] ? ' has-note' : ''}`}
                    >
                      <button
                        type="button"
                        className="wf-pv-content"
                        onClick={() => setActiveIndex(active ? null : item.i)}
                        aria-expanded={active}
                        disabled={!editable && item.kind !== 'p'}
                      >
                        <span className="wf-pv-badge">{ROLE_LABELS[role] || role}</span>
                        {item.kind === 'table' && <span className="wf-pv-placeholder">▦ Bảng {item.rows ? `(${item.rows} dòng)` : ''}: {item.t}</span>}
                        {item.kind === 'image' && <span className="wf-pv-placeholder">🖼 Hình ảnh</span>}
                        {item.kind === 'index' && <span className="wf-pv-placeholder">☰ {item.t}</span>}
                        {item.kind === 'p' && <span className="wf-pv-text">{item.t}</span>}
                        {item.suspect && !changed && <span className="wf-pv-hint">Có thể là tiêu đề? · {item.suspect}</span>}
                      </button>

                      {active && item.kind === 'p' && (
                        <div className="wf-pv-editor" role="group" aria-label="Chỉnh sửa đoạn">
                          {editable ? (
                            <>
                              <label className="wf-pv-editor-label" htmlFor={`wf-role-${item.i}`}>Đặt kiểu đoạn</label>
                              <select
                                id={`wf-role-${item.i}`}
                                className="form-input"
                                value={overrides[item.i] || ''}
                                onChange={(event) => onRoleChange(item.i, event.target.value || null)}
                              >
                                <option value="">Giữ như nhận diện ({ROLE_LABELS[item.role] || item.role})</option>
                                {item.forced && <option value="auto">Bỏ kiểu đã đặt trước đây (tự động nhận diện)</option>}
                                {ROLE_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                              <div className="wf-pv-quick">
                                {item.suggest && !changed && (
                                  <button type="button" className="wf-pv-chip is-suggest" onClick={() => onRoleChange(item.i, item.suggest)}>
                                    Gợi ý: {ROLE_LABELS[item.suggest]}
                                  </button>
                                )}
                                {QUICK_ROLES.map((value) => (
                                  <button
                                    key={value}
                                    type="button"
                                    className={`wf-pv-chip${overrides[item.i] === value ? ' is-active' : ''}`}
                                    onClick={() => onRoleChange(item.i, value)}
                                  >
                                    {ROLE_LABELS[value]}
                                  </button>
                                ))}
                              </div>
                            </>
                          ) : (
                            <p className="wf-preview-muted">Vùng này được giữ nguyên khi định dạng nên không đổi kiểu được.</p>
                          )}
                          <label className="wf-pv-editor-label" htmlFor={`wf-note-${item.i}`}>Ghi chú phần muốn sửa</label>
                          <textarea
                            id={`wf-note-${item.i}`}
                            className="form-input wf-pv-note"
                            rows={2}
                            maxLength={1000}
                            placeholder="Ví dụ: kiểm tra lại số liệu, viết lại đoạn này…"
                            value={notes[item.i] || ''}
                            onChange={(event) => onNoteChange(item.i, event.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <aside className="wf-preview-changes" aria-label="Danh sách chỉnh sửa">
              <h4>Danh sách chỉnh sửa</h4>
              {changes.length ? (
                <ul>
                  {changes.map(({ index, item, role, note }) => (
                    <li key={index}>
                      <button type="button" className="wf-change-target" onClick={() => scrollTo(index)}>
                        {(item?.t || `Đoạn #${index}`).slice(0, 70)}
                      </button>
                      {role && (
                        <p className="wf-change-role">
                          {ROLE_LABELS[item?.role] || item?.role} → <strong>{ROLE_LABELS[role] || role}</strong>
                          <button type="button" aria-label="Bỏ đổi kiểu" onClick={() => onRoleChange(index, null)}>✕</button>
                        </p>
                      )}
                      {note && (
                        <p className="wf-change-note">
                          📝 {note}
                          <button type="button" aria-label="Xóa ghi chú" onClick={() => onNoteChange(index, '')}>✕</button>
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="wf-preview-muted">Chưa có chỉnh sửa. Bấm vào bất kỳ đoạn nào ở trang xem trước để đổi Heading hoặc ghi chú.</p>
              )}
              {dirty && (
                <p className="wf-preview-dirty">Có thay đổi làm lệch vùng tài liệu? Bấm “Cập nhật xem trước” để nhận diện lại các đoạn phía sau.</p>
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
