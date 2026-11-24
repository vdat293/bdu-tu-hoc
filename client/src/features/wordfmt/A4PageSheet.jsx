import { memo, useEffect, useRef, useState } from 'react';
import { BDU_LOGO_WEB_PATH } from './AiSkillPanel.jsx';

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

export const ROLE_LABELS = {
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

export const OUTLINE_LEVEL = {
  chapter: 1, major_title: 1, front_title: 1, intro_title: 1, part_title: 1, proposal_title: 1,
  heading2: 2, intro_heading: 2, heading3: 3, heading4: 4
};

export const QUICK_ROLES = ['chapter', 'major_title', 'heading2', 'heading3', 'heading4', 'equation', 'body'];
export const LOCKED_ROLES = new Set(['proposal', 'appendix', 'proposal_title', 'cover']);

export function effectiveRole(item, overrides = {}) {
  if (!item) return 'body';
  const idx = item.sourceIndex ?? item.i;
  const key = idx !== undefined && idx !== null ? String(idx) : null;
  const override = key !== null ? (overrides[key] ?? overrides[idx]) : undefined;
  if (override && override !== 'auto') return override;
  if (override === 'auto' && item.forced) return 'auto';
  return item.role || 'body';
}

export function isEditableParagraph(block) {
  const idx = block?.sourceIndex ?? block?.i;
  if (idx === undefined || idx === null) return false;
  if (block.kind !== 'p' && block.kind !== 'equation') return false;
  return !LOCKED_ROLES.has(block.role);
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

export function formatCoverDate(coverInfo = {}) {
  const { month: curMonth, year: curYear } = currentVietnamMonthYear();
  const loc = String(coverInfo.location || 'Thành phố Hồ Chí Minh').trim();
  const resolvedMonth = String(coverInfo.month || '').trim() || curMonth;
  const resolvedYear = String(coverInfo.year || '').trim() || curYear;
  return `${loc}, tháng ${resolvedMonth} năm ${resolvedYear}`;
}

function inferInstitute(institution, faculty) {
  const norm = (s) => String(s || '')
    .normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'D').toUpperCase();
  if (/BINH DUONG/.test(norm(institution)) && /CONG NGHE THONG TIN|ROBOT|TRI TUE NHAN TAO/.test(norm(faculty))) {
    return 'VIỆN TRÍ TUỆ NHÂN TẠO VÀ CHUYỂN ĐỔI SỐ';
  }
  return '';
}

function formatCoverInstructor(raw) {
  const clean = String(raw || '').trim();
  if (!clean) return '………………………………';
  const match = clean.match(/^((?:PGS\.|GS\.|TS\.|ThS\.|Th\.S\.|ThS|TS|CN\.|KTS\.|Thạc sĩ|Tiến sĩ)\s*)+(.*)$/i);
  if (match) return `${match[1].trim()} ${match[2].trim().toUpperCase()}`;
  return clean.toUpperCase();
}

const WingdingsOrnamentSvg = (
  <div className="wf-a4-ornament" aria-hidden="true">
    <svg width="92" height="18" viewBox="0 0 92 18" fill="none">
      <path d="M4 9H30M24 5L31 9L24 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M46 4.5C43 3 38.5 3 35.5 4.8V14.2C38.5 12.6 43 12.6 46 14.2C49 12.6 53.5 12.6 56.5 14.2V4.8C53.5 3 49 3 46 4.5Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M46 4.6V14.1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M88 9H62M68 5L61 9L68 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
);

function renderMathNode(node, key) {
  if (!node) return null;
  switch (node.type) {
    case 'tok': {
      const cls = node.kind === 'mn'
        ? 'wf-math-mn'
        : node.kind === 'mo'
          ? 'wf-math-mo'
          : (node.upright || node.normal || node.kind === 'mtext')
            ? 'wf-math-mtext'
            : 'wf-math-mi';
      return <span key={key} className={cls}>{node.text}</span>;
    }
    case 'row':
      return <span key={key} className="wf-math-row">{(node.items || []).map((child, idx) => renderMathNode(child, idx))}</span>;
    case 'frac':
      return (
        <span key={key} className="wf-math-frac">
          <span className="wf-math-num">{renderMathNode(node.num, 'n')}</span>
          <span className="wf-math-den">{renderMathNode(node.den, 'd')}</span>
        </span>
      );
    case 'rad':
      return (
        <span key={key} className="wf-math-rad">
          {node.deg ? <sup className="wf-math-rad-deg">{renderMathNode(node.deg, 'd')}</sup> : null}
          <span className="wf-math-rad-sign" aria-hidden="true">√</span>
          <span className="wf-math-rad-body">{renderMathNode(node.body, 'b')}</span>
        </span>
      );
    case 'nary':
      return (
        <span key={key} className="wf-math-nary">
          <span className="wf-math-nary-limits">
            {node.sup ? <span className="wf-math-nary-sup">{renderMathNode(node.sup, 'sup')}</span> : null}
            <span className="wf-math-nary-op">{node.chr || '∑'}</span>
            {node.sub ? <span className="wf-math-nary-sub">{renderMathNode(node.sub, 'sub')}</span> : null}
          </span>
          <span className="wf-math-nary-body">{renderMathNode(node.body, 'body')}</span>
        </span>
      );
    case 'sub':
      return (
        <span key={key} className="wf-math-script">
          {renderMathNode(node.base, 'b')}
          <sub className="wf-math-sub">{renderMathNode(node.sub, 's')}</sub>
        </span>
      );
    case 'sup':
      return (
        <span key={key} className="wf-math-script">
          {renderMathNode(node.base, 'b')}
          <sup className="wf-math-sup">{renderMathNode(node.sup, 'p')}</sup>
        </span>
      );
    case 'subsup':
      return (
        <span key={key} className="wf-math-subsup">
          {renderMathNode(node.base, 'b')}
          <span className="wf-math-subsup-stack">
            <sup>{renderMathNode(node.sup, 'p')}</sup>
            <sub>{renderMathNode(node.sub, 's')}</sub>
          </span>
        </span>
      );
    case 'acc':
      return (
        <span key={key} className="wf-math-acc">
          <span className="wf-math-acc-mark" aria-hidden="true">{node.chr}</span>
          <span className="wf-math-acc-body">{renderMathNode(node.body, 'b')}</span>
        </span>
      );
    case 'limLow':
      return (
        <span key={key} className="wf-math-lim">
          <span>{renderMathNode(node.base, 'b')}</span>
          <span className="wf-math-lim-under">{renderMathNode(node.lim, 'l')}</span>
        </span>
      );
    case 'limUpp':
      return (
        <span key={key} className="wf-math-lim">
          <span className="wf-math-lim-over">{renderMathNode(node.lim, 'l')}</span>
          <span>{renderMathNode(node.base, 'b')}</span>
        </span>
      );
    case 'delim': {
      const inner = [];
      (node.args || []).forEach((arg, idx) => {
        if (idx > 0 && node.sep) inner.push(<span key={`sep-${idx}`} className="wf-math-mo">{node.sep}</span>);
        inner.push(renderMathNode(arg, `arg-${idx}`));
      });
      return (
        <span key={key} className="wf-math-delim">
          {node.open ? <span className="wf-math-paren">{node.open}</span> : null}
          <span className="wf-math-delim-body">{inner}</span>
          {node.close ? <span className="wf-math-paren">{node.close}</span> : null}
        </span>
      );
    }
    case 'matrix':
      return (
        <span key={key} className="wf-math-matrix">
          {(node.rows || []).map((row, rIdx) => (
            <span key={rIdx} className="wf-math-mtr">
              {row.map((cell, cIdx) => <span key={cIdx} className="wf-math-mtd">{renderMathNode(cell, cIdx)}</span>)}
            </span>
          ))}
        </span>
      );
    default:
      return null;
  }
}

export function MathFormula({ ast, fallbackText, display = 'block' }) {
  if (!ast) return <span className="wf-a4-math-fallback">{fallbackText}</span>;
  return (
    <span
      role="math"
      aria-label={fallbackText || 'Công thức toán học'}
      className={`wf-a4-math wf-a4-math--${display}`}
    >
      {renderMathNode(ast, 'root')}
    </span>
  );
}

function renderInlineRuns(runs, marker, plainText, baseStyle = {}) {
  if (!Array.isArray(runs) || runs.length === 0) {
    return plainText || '';
  }
  // Single plain text run matching paragraph defaults: emit direct string so
  // exact selector queries (e.g. `.wf-pv-text`) match cleanly.
  if (
    !marker
    && runs.length === 1
    && runs[0].type === 'text'
    && Boolean(runs[0].bold) === Boolean(baseStyle.bold)
    && Boolean(runs[0].italic) === Boolean(baseStyle.italic)
    && !runs[0].underline
    && !runs[0].vertAlign
  ) {
    return runs[0].text;
  }

  return (
    <>
      {marker ? <span className="wf-a4-list-marker">{marker} </span> : null}
      {runs.map((run, idx) => {
        if (run.type === 'br') return <br key={idx} />;
        if (run.type === 'tab') return <span key={idx} className="wf-a4-inline-tab">{'\u00A0\u00A0\u00A0\u00A0'}</span>;
        if (run.type === 'math') return <MathFormula key={idx} ast={run.mathAst} display="inline" />;
        if (run.type === 'image') {
          return run.src ? (
            <img
              key={idx}
              src={run.src}
              alt={run.alt || 'Hình minh họa'}
              className="wf-a4-inline-img"
              style={{ maxWidth: `${Math.min(15.5, run.widthCm || 3.5)}cm` }}
            />
          ) : (
            <span key={idx} className="wf-pv-placeholder">🖼 Hình minh họa ({run.widthCm}×{run.heightCm} cm)</span>
          );
        }
        const style = {};
        if (run.bold && !baseStyle.bold) style.fontWeight = 700;
        if (!run.bold && baseStyle.bold) style.fontWeight = 400;
        if (run.italic && !baseStyle.italic) style.fontStyle = 'italic';
        if (!run.italic && baseStyle.italic) style.fontStyle = 'normal';
        if (run.underline) style.textDecoration = 'underline';
        if (run.vertAlign === 'superscript') return <sup key={idx} style={style}>{run.text}</sup>;
        if (run.vertAlign === 'subscript') return <sub key={idx} style={style}>{run.text}</sub>;
        return Object.keys(style).length ? <span key={idx} style={style}>{run.text}</span> : run.text;
      })}
    </>
  );
}

/**
 * Synthesizes realistic paginated A4 pages on the client when only structural `items`
 * are present (fallback / lightweight unit-test compatibility).
 */
export function synthesizePagesFromItems(items = [], coverInfo = {}) {
  const pages = [];
  let pageCounter = 1;

  if (coverInfo?.includeCover !== false) {
    pages.push(buildDraftCoverPageObj(coverInfo, 0));
  }

  let currentBlocks = [];
  let usedChars = 0;

  const flush = (sectionTitle = '') => {
    const pageIndex = pages.length;
    pages.push({
      pageIndex,
      pageNumber: pageIndex + 1,
      pageLabel: String(pageCounter++),
      numFmt: 'decimal',
      widthCm: 21,
      heightCm: 29.7,
      marginsCm: { top: 2, bottom: 2, left: 3, right: 2 },
      borderStyle: null,
      isCover: false,
      header: {
        columns: [
          { text: coverInfo?.docTitle || 'TIỂU LUẬN MÔN HỌC', align: 'left', sizePt: 13 },
          { text: sectionTitle, align: 'right', sizePt: 13 }
        ],
        hasBorder: true
      },
      footer: {
        columns: [
          { text: `GVHD: ${coverInfo?.instructor || '…'}`, align: 'left', sizePt: 13 },
          { text: '{PAGE}', hasPageField: true, align: 'center', sizePt: 13 },
          { text: `SVTH: ${coverInfo?.student || '…'}`, align: 'right', sizePt: 13 }
        ],
        hasBorder: true
      },
      blocks: currentBlocks
    });
    currentBlocks = [];
    usedChars = 0;
  };

  let currentSectionTitle = '';
  for (const item of items) {
    if (item.role === 'cover') continue;
    const startsNewSection = ['chapter', 'major_title', 'front_title', 'intro_title'].includes(item.role);
    if (startsNewSection && currentBlocks.length > 0) {
      flush(currentSectionTitle);
    }
    if (startsNewSection) currentSectionTitle = item.t || '';

    const block = {
      blockId: `wf-synth-${item.i}`,
      sourceIndex: item.i,
      kind: item.kind === 'table' ? 'table_placeholder' : item.kind === 'image' ? 'image' : item.kind === 'index' ? 'toc_placeholder' : (item.role === 'equation' ? 'equation' : 'p'),
      text: item.t || '',
      rowsCount: item.rows || 0,
      role: item.role || 'body',
      suspect: item.suspect,
      suggest: item.suggest,
      forced: item.forced
    };
    currentBlocks.push(block);
    usedChars += (item.t || '').length + 90;
    if (usedChars > 2400) flush(currentSectionTitle);
  }

  if (currentBlocks.length > 0 || pages.length === 0) {
    flush(currentSectionTitle);
  }
  return pages;
}

export function buildDraftCoverPageObj(coverInfo = {}, pageIndex = 0) {
  const isGrad = coverInfo.documentType === 'do_an_tot_nghiep';
  const institution = (coverInfo.institution || 'TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG').trim();
  const faculty = (coverInfo.faculty || 'KHOA CÔNG NGHỆ THÔNG TIN, ROBOT VÀ TRÍ TUỆ NHÂN TẠO').trim();
  const institute = inferInstitute(institution, faculty);
  const docTitle = (coverInfo.docTitle || (isGrad ? 'ĐỒ ÁN TỐT NGHIỆP' : 'TIỂU LUẬN MÔN HỌC')).trim();
  const topic = (coverInfo.topic || '').trim();
  const coverDate = formatCoverDate(coverInfo);

  return {
    pageIndex,
    pageNumber: pageIndex + 1,
    pageLabel: '',
    isCover: true,
    isDraftCover: true,
    widthCm: 21,
    heightCm: 29.7,
    marginsCm: isGrad ? { top: 2, bottom: 2, left: 2, right: 2 } : { top: 2, bottom: 2, left: 3, right: 2 },
    borderStyle: 'twistedLines1',
    draftCover: {
      institution,
      institute,
      faculty,
      docTitle,
      course: (coverInfo.course || '').trim(),
      topic,
      instructor: formatCoverInstructor(coverInfo.instructor),
      student: (coverInfo.student || '').trim().toUpperCase() || '………………………………',
      studentId: (coverInfo.studentId || '').trim() || '……………………',
      className: (coverInfo.className || '').trim().toUpperCase() || '……………………',
      coverDate
    },
    blocks: []
  };
}

function InlineDocEditor({
  idx,
  value,
  role,
  roleLabel,
  hasTextEdit,
  isInserted,
  pStyle,
  onTextChange,
  onSplitOrInsertAfter,
  onInsertParagraph,
  onDeleteParagraph,
  onRevertTextEdit,
  onClose
}) {
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(26, el.scrollHeight)}px`;
  }, [value, role]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Focus inline editor unless user is already focused inside a form control in the right rail
    const activeTag = document.activeElement?.tagName;
    if (activeTag !== 'SELECT' && activeTag !== 'TEXTAREA' && activeTag !== 'INPUT') {
      el.focus({ preventScroll: true });
      const end = el.value.length;
      try { el.setSelectionRange(end, end); } catch { /* ignore */ }
    }
  }, [idx]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      const before = value.slice(0, start);
      const after = value.slice(end);
      onSplitOrInsertAfter?.(idx, before, after);
      return;
    }
    if (e.key === 'Backspace' && value === '') {
      e.preventDefault();
      onDeleteParagraph?.(idx, { focusPrev: true });
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
    }
  };

  return (
    <div className={`wf-inline-editor-shell wf-pv-${role}`}>
      <div className="wf-inline-minibar" role="toolbar" aria-label="Công cụ đoạn văn trực tiếp">
        <span className="wf-inline-role-pill">
          {isInserted ? '➕ Mới · ' : ''}{roleLabel}
        </span>
        <div className="wf-inline-minibar-btns">
          <button
            type="button"
            className="wf-mini-btn"
            title="Chèn thêm 1 đoạn mới phía trên"
            onClick={(e) => { e.stopPropagation(); onInsertParagraph?.(idx, 'before'); }}
          >
            + Chèn trên
          </button>
          <button
            type="button"
            className="wf-mini-btn"
            title="Chèn thêm 1 đoạn mới phía dưới (hoặc nhấn phím Enter)"
            onClick={(e) => { e.stopPropagation(); onInsertParagraph?.(idx, 'after'); }}
          >
            ↵ Thêm đoạn dưới
          </button>
          {hasTextEdit && !isInserted ? (
            <button
              type="button"
              className="wf-mini-btn"
              title="Khôi phục nội dung chữ ban đầu của đoạn này"
              onClick={(e) => { e.stopPropagation(); onRevertTextEdit?.(idx); }}
            >
              ↩ Chữ gốc
            </button>
          ) : null}
          <button
            type="button"
            className="wf-mini-btn is-danger"
            title="Xóa đoạn văn này khỏi tài liệu"
            onClick={(e) => { e.stopPropagation(); onDeleteParagraph?.(idx); }}
          >
            🗑 Xóa
          </button>
        </div>
      </div>

      <textarea
        ref={textareaRef}
        rows={1}
        aria-label="Sửa nội dung đoạn trên trang giấy"
        className="wf-inline-doc-editor wf-pv-text"
        style={pStyle}
        placeholder="Nhập nội dung đoạn văn (Enter để tách/xuống đoạn mới, Backspace khi trống để xóa)…"
        value={value}
        onChange={(e) => onTextChange?.(idx, e.target.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}

function expandBlocksWithMutations(blocks = [], pendingInserts = [], deletedSet = new Set()) {
  if (!pendingInserts.length && !deletedSet.size) return blocks;

  const beforeMap = new Map();
  const afterMap = new Map();
  for (const ins of pendingInserts) {
    if (deletedSet.has(String(ins.id))) continue;
    if (ins.beforeKey) {
      const k = String(ins.beforeKey);
      if (!beforeMap.has(k)) beforeMap.set(k, []);
      beforeMap.get(k).push(ins);
    } else if (ins.afterKey) {
      const k = String(ins.afterKey);
      if (!afterMap.has(k)) afterMap.set(k, []);
      afterMap.get(k).push(ins);
    }
  }

  const toBlock = (ins) => ({
    blockId: `wf-ins-block-${ins.id}`,
    sourceIndex: ins.id,
    kind: 'p',
    text: ins.text ?? '',
    role: ins.role || 'body',
    isInserted: true
  });

  const result = [];
  const emitWithNeighbors = (block) => {
    const key = block.sourceIndex !== undefined && block.sourceIndex !== null ? String(block.sourceIndex) : null;
    if (key && beforeMap.has(key)) {
      for (const pre of beforeMap.get(key)) emitWithNeighbors(toBlock(pre));
    }
    if (!key || !deletedSet.has(key)) {
      result.push(block);
    }
    if (key && afterMap.has(key)) {
      for (const post of afterMap.get(key)) emitWithNeighbors(toBlock(post));
    }
  };

  for (const b of blocks) {
    emitWithNeighbors(b);
  }
  return result;
}

function renderBlockContent(block, {
  reviewMode,
  overrides,
  notes,
  textEdits,
  deletedSet,
  dismissedSuspects,
  activeIndex,
  flashIndex,
  onSelectParagraph,
  onTextChange,
  onSplitOrInsertAfter,
  onInsertParagraph,
  onDeleteParagraph,
  onRevertTextEdit,
  onJumpToPage
}) {
  if (block.kind === 'ornament') return WingdingsOrnamentSvg;
  if (block.kind === 'spacer') return <div style={{ height: `${block.heightPt || 2}pt` }} aria-hidden="true" />;
  if (block.kind === 'dotted_line') return <div className="wf-a4-dotted-line" aria-hidden="true" />;

  if (block.kind === 'toc') {
    const tocLabel = block.tocType === 'figures'
      ? 'Danh mục hình ảnh'
      : block.tocType === 'tables'
        ? 'Danh mục bảng'
        : 'Mục lục tự động';
    if (!block.entries || block.entries.length === 0) {
      const emptyMsg = block.tocType === 'figures'
        ? 'Chưa có chú thích hình ảnh (Hình x-y: ...) nào được nhận diện trong tài liệu.'
        : block.tocType === 'tables'
          ? 'Chưa có chú thích bảng (Bảng x-y: ...) nào được nhận diện trong tài liệu.'
          : 'Danh mục sẽ tự động cập nhật số trang khi có các mục tương ứng trong tài liệu.';
      return (
        <div className="wf-a4-toc-empty" role="region" aria-label={tocLabel}>
          {emptyMsg}
        </div>
      );
    }
    return (
      <div className={`wf-a4-toc wf-a4-toc--${block.tocType || 'main'}`} role="navigation" aria-label={tocLabel}>
        {block.entries.map((entry, idx) => (
          <button
            key={`${entry.id}-${idx}`}
            type="button"
            className={`wf-a4-toc-row wf-a4-toc-l${entry.level || 1}`}
            onClick={() => onJumpToPage?.(entry.pageIndex, entry.sourceIndex)}
          >
            <span className="wf-a4-toc-title">{entry.title}</span>
            <span className="wf-a4-toc-dots" aria-hidden="true" />
            <span className="wf-a4-toc-page">{entry.pageLabel}</span>
          </button>
        ))}
      </div>
    );
  }

  if (block.kind === 'toc_placeholder') {
    return <div className="wf-pv-placeholder">☰ {block.text}</div>;
  }

  if (block.kind === 'table_placeholder') {
    return <div className="wf-pv-placeholder">▦ Bảng {block.rowsCount ? `(${block.rowsCount} dòng)` : ''}: {block.text}</div>;
  }

  if (block.kind === 'table') {
    return (
      <div className={`wf-a4-table-wrap wf-a4-align-${block.align || 'center'}`}>
        <table
          className={`wf-a4-table${block.bordered ? ' is-bordered' : ' is-borderless'}`}
          style={{ width: block.widthCm ? `${Math.min(100, (block.widthCm / 16) * 100)}%` : '100%' }}
        >
          {block.colWidthsPct?.length ? (
            <colgroup>
              {block.colWidthsPct.map((pct, i) => <col key={i} style={{ width: `${pct}%` }} />)}
            </colgroup>
          ) : null}
          <tbody>
            {block.rows.map((row, rIdx) => (
              <tr key={rIdx} className={row.isHeader ? 'wf-a4-tr-header' : undefined}>
                {row.cells.map((cell, cIdx) => {
                  const CellTag = row.isHeader ? 'th' : 'td';
                  return (
                    <CellTag
                      key={cIdx}
                      colSpan={cell.colspan > 1 ? cell.colspan : undefined}
                      rowSpan={cell.rowspan > 1 ? cell.rowspan : undefined}
                      style={{
                        verticalAlign: cell.vAlign === 'center' ? 'middle' : cell.vAlign === 'bottom' ? 'bottom' : 'top',
                        backgroundColor: cell.shading || undefined
                      }}
                    >
                      {cell.blocks.map((cb, cbIdx) => {
                        const cbKey = cb.sourceIndex !== undefined && cb.sourceIndex !== null ? String(cb.sourceIndex) : null;
                        if (cbKey && deletedSet?.has(cbKey)) return null;
                        const hasCellEdit = Boolean(cbKey && textEdits && Object.prototype.hasOwnProperty.call(textEdits, cbKey));
                        const cellText = hasCellEdit ? textEdits[cbKey] : cb.text;
                        const cellActive = reviewMode && cbKey !== null && String(activeIndex) === cbKey;
                        const cellStyle = {
                          textAlign: cb.align || (row.isHeader ? 'center' : 'left'),
                          fontWeight: cb.bold || row.isHeader ? 700 : 400,
                          fontStyle: cb.italic ? 'italic' : 'normal',
                          fontSize: cb.fontSizePt ? `${cb.fontSizePt}pt` : '13pt'
                        };
                        if (cellActive && cb.kind !== 'image') {
                          return (
                            <textarea
                              key={cbIdx}
                              rows={1}
                              aria-label="Sửa nội dung ô bảng"
                              className="wf-inline-cell-editor"
                              style={cellStyle}
                              value={cellText}
                              onChange={(e) => onTextChange?.(cb.sourceIndex, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  onSelectParagraph?.(null);
                                }
                              }}
                              autoFocus
                            />
                          );
                        }
                        return (
                          <div
                            key={cbIdx}
                            className={`wf-a4-cell-p${reviewMode && cbKey !== null ? ' is-cell-editable' : ''}${hasCellEdit ? ' is-cell-edited' : ''}`}
                            style={cellStyle}
                            onClick={reviewMode && cbKey !== null ? () => onSelectParagraph?.(cb.sourceIndex) : undefined}
                            title={reviewMode && cbKey !== null ? 'Bấm để sửa nội dung ô bảng' : undefined}
                          >
                            {cb.kind === 'image' ? (
                              cb.src ? (
                                <img src={cb.src} alt={cb.alt || ''} style={{ maxWidth: '100%', maxHeight: `${cb.heightCm || 4}cm` }} />
                              ) : (
                                <span className="wf-pv-placeholder">🖼 Hình ảnh</span>
                              )
                            ) : hasCellEdit ? (
                              cellText
                            ) : (
                              renderInlineRuns(cb.runs, cb.marker, cb.text, cb)
                            )}
                          </div>
                        );
                      })}
                    </CellTag>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.kind === 'image') {
    const logoFallback = block.isCoverLogo ? BDU_LOGO_WEB_PATH : null;
    const imgSrc = block.src || logoFallback;
    return (
      <figure
        className="wf-a4-figure"
        style={{
          marginTop: block.beforePt ? `${block.beforePt}pt` : '4pt',
          marginBottom: block.afterPt ? `${block.afterPt}pt` : '6pt',
          textAlign: block.align || 'center'
        }}
      >
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={block.alt || 'Hình ảnh trong tài liệu'}
            style={{
              width: block.isCoverLogo ? '3.5cm' : undefined,
              height: block.isCoverLogo ? '3.5cm' : undefined,
              maxWidth: block.isCoverLogo ? '3.5cm' : `${Math.min(15.5, block.widthCm || 12)}cm`,
              objectFit: 'contain'
            }}
          />
        ) : (
          <span className="wf-pv-placeholder">🖼 Hình ảnh ({block.widthCm || '?'} × {block.heightCm || '?'} cm)</span>
        )}
      </figure>
    );
  }

  if (block.kind === 'tab_pair') {
    return (
      <div
        className="wf-a4-tab-pair"
        style={{
          marginTop: block.beforePt ? `${block.beforePt}pt` : 0,
          marginBottom: block.afterPt ? `${block.afterPt}pt` : 0,
          paddingLeft: `${Math.min(5.2, block.startCm || 2.2)}cm`,
          fontSize: `${block.fontSizePt || 14}pt`
        }}
      >
        <span className="wf-a4-tab-label">{renderInlineRuns(block.labelRuns, '', '', {})}</span>
        <span className="wf-a4-tab-value">{renderInlineRuns(block.valueRuns, '', '', {})}</span>
      </div>
    );
  }

  // Interactive or static paragraph / equation
  const idx = block.sourceIndex;
  const hasIdx = idx !== undefined && idx !== null;
  const keyStr = hasIdx ? String(idx) : null;
  const role = effectiveRole(block, overrides);
  const changed = hasIdx && (keyStr in overrides || idx in overrides);
  const hasTextEdit = Boolean(hasIdx && textEdits && Object.prototype.hasOwnProperty.call(textEdits, keyStr));
  const currentText = hasTextEdit ? textEdits[keyStr] : (block.text ?? '');
  const isInserted = Boolean(block.isInserted || (keyStr && keyStr.startsWith('ins_')));
  const noteText = (hasIdx && (notes?.[keyStr] ?? notes?.[idx])) || block.note || '';
  const isSuspect = Boolean(block.suspect) && !changed && !hasTextEdit && !(hasIdx && (dismissedSuspects?.has(idx) || dismissedSuspects?.has(keyStr)));
  const isActive = hasIdx && String(activeIndex) === keyStr;
  const isFlashing = hasIdx && String(flashIndex) === keyStr;
  const editable = reviewMode && isEditableParagraph(block);

  const pStyle = {};
  if (block.fontSizePt && !changed) {
    pStyle.fontSize = `${block.fontSizePt}pt`;
    pStyle.textAlign = block.align || undefined;
    pStyle.fontWeight = block.bold ? 700 : undefined;
    pStyle.fontStyle = block.italic ? 'italic' : undefined;
    if (block.beforePt) pStyle.marginTop = `${block.beforePt}pt`;
    if (block.afterPt) pStyle.marginBottom = `${block.afterPt}pt`;
    if (block.leftCm) pStyle.paddingLeft = `${Math.max(0, block.leftCm - (block.hangingCm || 0))}cm`;
    if (block.rightCm) pStyle.paddingRight = `${block.rightCm}cm`;
    if (block.firstLineCm) pStyle.textIndent = `${block.firstLineCm}cm`;
  }

  const innerContent = block.kind === 'equation' && !hasTextEdit ? (
    <span className="wf-pv-text wf-a4-equation-wrap">
      {block.mathAst ? <MathFormula ast={block.mathAst} fallbackText={currentText} /> : currentText}
    </span>
  ) : (
    <span className="wf-pv-text" style={pStyle}>
      {hasTextEdit || isInserted
        ? (currentText || <em className="wf-empty-p-placeholder">[Đoạn trống — bấm để nhập hoặc xóa]</em>)
        : renderInlineRuns(block.runs, block.marker, block.text, block)}
    </span>
  );

  if (!reviewMode || !hasIdx) {
    return (
      <div
        id={hasIdx ? `wf-pv-${idx}` : block.blockId}
        className={`wf-pv-block wf-pv-${role}${noteText ? ' has-note' : ''}`}
      >
        <div className="wf-pv-static">{innerContent}</div>
      </div>
    );
  }

  if (isActive && editable) {
    return (
      <div
        id={`wf-pv-${idx}`}
        data-source-index={idx}
        className={`wf-pv-block wf-pv-${role} is-active is-editing${changed || hasTextEdit || isInserted ? ' is-changed' : ''}${isFlashing ? ' is-flash-target' : ''}${noteText ? ' has-note' : ''}`}
      >
        <InlineDocEditor
          idx={idx}
          value={currentText}
          role={role}
          roleLabel={ROLE_LABELS[role] || role}
          hasTextEdit={hasTextEdit}
          isInserted={isInserted}
          pStyle={pStyle}
          onTextChange={onTextChange}
          onSplitOrInsertAfter={onSplitOrInsertAfter}
          onInsertParagraph={onInsertParagraph}
          onDeleteParagraph={onDeleteParagraph}
          onRevertTextEdit={onRevertTextEdit}
          onClose={() => onSelectParagraph?.(null)}
        />
      </div>
    );
  }

  return (
    <div
      id={`wf-pv-${idx}`}
      data-source-index={idx}
      className={`wf-pv-block wf-pv-${role}${changed || hasTextEdit || isInserted ? ' is-changed' : ''}${block.forced && !changed ? ' is-forced' : ''}${isSuspect ? ' is-suspect' : ''}${isActive ? ' is-active' : ''}${isFlashing ? ' is-flash-target' : ''}${noteText ? ' has-note' : ''}`}
    >
      <button
        type="button"
        className="wf-pv-content"
        onClick={() => onSelectParagraph?.(idx)}
        aria-expanded={isActive}
        disabled={!editable && block.kind !== 'p' && block.kind !== 'equation'}
      >
        <span className="wf-pv-badge">
          {isInserted ? '➕ ' : hasTextEdit ? '✎ ' : ''}{ROLE_LABELS[role] || role}
        </span>
        {innerContent}
        {isSuspect ? <span className="wf-pv-hint">Có thể là tiêu đề? · {block.suspect}</span> : null}
      </button>
    </div>
  );
}

const A4PageSheet = memo(function A4PageSheet({
  page,
  pageRef,
  zoom = 1,
  reviewMode = true,
  overrides,
  notes,
  textEdits,
  deletedSet,
  pendingInserts,
  dismissedSuspects,
  activeIndex,
  flashIndex,
  onSelectParagraph,
  onTextChange,
  onSplitOrInsertAfter,
  onInsertParagraph,
  onDeleteParagraph,
  onRevertTextEdit,
  onJumpToPage
}) {
  const margins = page.marginsCm || { top: 2, bottom: 2, left: 3, right: 2 };
  const isTwisted = page.borderStyle === 'twistedLines1';
  const isSingleBorder = page.borderStyle === 'single';
  const visibleBlocks = expandBlocksWithMutations(page.blocks, pendingInserts, deletedSet);

  return (
    <article
      ref={pageRef}
      data-page-index={page.pageIndex}
      aria-label={page.isCover && page.pageIndex === 0 ? 'Khung trang bìa dự kiến' : `Trang ${page.pageNumber}`}
      className={`wf-gdoc-page${page.isCover ? ' is-cover-page' : ''}${isTwisted ? ' has-twisted-border' : ''}${isSingleBorder ? ' has-single-border' : ''}`}
      style={{
        '--wf-zoom': zoom,
        '--wf-pad-top': `${margins.top}cm`,
        '--wf-pad-bottom': `${margins.bottom}cm`,
        '--wf-pad-left': `${margins.left}cm`,
        '--wf-pad-right': `${margins.right}cm`
      }}
    >
      {isTwisted ? (
        <div className="wf-twisted-frame" aria-hidden="true">
          <span className="wf-twisted-corner wf-tc-tl" />
          <span className="wf-twisted-corner wf-tc-tr" />
          <span className="wf-twisted-corner wf-tc-bl" />
          <span className="wf-twisted-corner wf-tc-br" />
        </div>
      ) : null}

      {/* Running Header */}
      {page.header ? (
        <header className={`wf-a4-header${page.header.hasBorder ? ' has-rule' : ''}`}>
          {page.header.columns.map((col, idx) => (
            <span
              key={idx}
              style={{
                textAlign: col.align || 'left',
                fontSize: `${col.sizePt || 13}pt`
              }}
            >
              {col.hasPageField ? page.pageLabel : col.text}
            </span>
          ))}
        </header>
      ) : null}

      {/* Main Printable Body */}
      <div className="wf-a4-body">
        {page.isDraftCover && page.draftCover ? (
          <div className="wf-draft-cover-layout">
            <div className="wf-draft-cover-top">
              <p className="wf-cover-inst">{page.draftCover.institution}</p>
              {page.draftCover.institute ? <p className="wf-cover-inst">{page.draftCover.institute}</p> : null}
              <p className="wf-cover-faculty">{page.draftCover.faculty}</p>
              {WingdingsOrnamentSvg}
              <div className="wf-draft-cover-logo">
                <img src={BDU_LOGO_WEB_PATH} alt="Logo Trường Đại học Bình Dương" />
              </div>
            </div>

            <div className="wf-draft-cover-center">
              <p className="wf-cover-type">{page.draftCover.docTitle}</p>
              {page.draftCover.course ? <p className="wf-cover-course">Học phần: {page.draftCover.course}</p> : null}
              <p className="wf-cover-topic">
                {page.draftCover.topic ? page.draftCover.topic.toLocaleUpperCase('vi-VN') : '[NHẬP TÊN ĐỀ TÀI BÁO CÁO Ở CỘT BÊN TRÁI]'}
              </p>
            </div>

            <div className="wf-draft-cover-meta">
              <div className="wf-a4-tab-pair">
                <span className="wf-a4-tab-label">Giảng viên hướng dẫn:</span>
                <span className="wf-a4-tab-value"><strong>{page.draftCover.instructor}</strong></span>
              </div>
              <div className="wf-a4-tab-pair">
                <span className="wf-a4-tab-label">Sinh viên thực hiện:</span>
                <span className="wf-a4-tab-value"><strong>{page.draftCover.student}</strong></span>
              </div>
              <div className="wf-a4-tab-pair">
                <span className="wf-a4-tab-label">Mã số sinh viên:</span>
                <span className="wf-a4-tab-value"><strong>{page.draftCover.studentId}</strong></span>
              </div>
              <div className="wf-a4-tab-pair">
                <span className="wf-a4-tab-label">Lớp:</span>
                <span className="wf-a4-tab-value"><strong>{page.draftCover.className}</strong></span>
              </div>
            </div>

            <p className="wf-cover-date">{page.draftCover.coverDate}</p>
          </div>
        ) : (
          visibleBlocks.map((block, bIdx) => (
            <div key={block.blockId || block.sourceIndex || bIdx} className="wf-a4-block-slot">
              {renderBlockContent(block, {
                reviewMode,
                overrides,
                notes,
                textEdits,
                deletedSet,
                dismissedSuspects,
                activeIndex,
                flashIndex,
                onSelectParagraph,
                onTextChange,
                onSplitOrInsertAfter,
                onInsertParagraph,
                onDeleteParagraph,
                onRevertTextEdit,
                onJumpToPage
              })}
            </div>
          ))
        )}
      </div>

      {/* Running Footer */}
      {page.footer ? (
        <footer className={`wf-a4-footer${page.footer.hasBorder ? ' has-rule' : ''}`}>
          {page.footer.columns.map((col, idx) => (
            <span
              key={idx}
              style={{
                textAlign: col.align || 'left',
                fontSize: `${col.sizePt || 13}pt`
              }}
            >
              {col.hasPageField ? page.pageLabel : col.text}
            </span>
          ))}
        </footer>
      ) : null}
    </article>
  );
});

export default A4PageSheet;

/**
 * Live Document Desk shown on the right column of Studio while configuring inputs,
 * updating 0ms in real time as the student edits cover fields & front-matter checkboxes.
 */
export function LiveCoverDraftDesk({
  coverInfo,
  includeComments = true,
  includeThanks = true,
  file,
  onOpenFullPreview,
  previewLoading
}) {
  const [activeTab, setActiveTab] = useState('cover');
  const isGrad = coverInfo?.documentType === 'do_an_tot_nghiep';
  const coverSheet = buildDraftCoverPageObj(coverInfo, 0);
  const loc = String(coverInfo?.location || 'Thành phố Hồ Chí Minh').trim();

  return (
    <div className="wf-live-desk glass-panel">
      <div className="wf-live-desk-bar">
        <div className="wf-live-desk-title">
          <span className="wf-live-dot" aria-hidden="true" />
          <div>
            <strong>Bàn giấy xem trước trực tiếp (A4 chuẩn BDU)</strong>
            <p>
              {file
                ? `Đã nạp ${file.name} · Bấm nút bên phải để dựng toàn bộ trang thực tế`
                : 'Mọi thông tin bạn gõ bên trái được phản chiếu tức thì lên trang A4'}
            </p>
          </div>
        </div>

        <div className="wf-live-desk-tabs" role="tablist" aria-label="Trang mẫu xem trước">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'cover'}
            className={`wf-desk-tab${activeTab === 'cover' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('cover')}
          >
            {isGrad ? 'Trang Bìa (×2)' : 'Trang Bìa'}
          </button>
          {(includeComments || isGrad) ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'review'}
              className={`wf-desk-tab${activeTab === 'review' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('review')}
            >
              {isGrad ? 'Nhận xét GV (×2)' : 'Nhận xét GV'}
            </button>
          ) : null}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'body'}
            className={`wf-desk-tab${activeTab === 'body' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('body')}
          >
            Header &amp; Thân bài
          </button>
        </div>

        {file ? (
          <button
            type="button"
            className="btn btn-secondary wf-live-open-btn"
            onClick={onOpenFullPreview}
            disabled={previewLoading}
          >
            {previewLoading ? 'Đang dựng trang…' : 'Mở Review Google Docs →'}
          </button>
        ) : null}
      </div>

      <div className="wf-live-desk-canvas">
        {activeTab === 'cover' ? (
          <A4PageSheet page={coverSheet} zoom={0.72} reviewMode={false} />
        ) : null}

        {activeTab === 'review' ? (
          <article className="wf-gdoc-page" style={{ '--wf-zoom': 0.72, '--wf-pad-top': '2cm', '--wf-pad-bottom': '2cm', '--wf-pad-left': '3cm', '--wf-pad-right': '2cm' }}>
            <div className="wf-a4-body">
              <p style={{ textAlign: 'center', fontWeight: 700, fontSize: '16pt', marginBottom: '24pt' }}>
                {isGrad ? 'NHẬN XÉT CỦA GIẢNG VIÊN HƯỚNG DẪN' : 'NHẬN XÉT CỦA GIẢNG VIÊN'}
              </p>
              {Array.from({ length: 18 }).map((_, idx) => (
                <div key={idx} className="wf-a4-dotted-line" />
              ))}
              <div style={{ marginLeft: 'auto', width: '58%', textAlign: 'center', marginTop: '14pt' }}>
                <p style={{ fontStyle: 'italic', fontSize: '11pt', margin: 0 }}>{loc}, ngày … tháng … năm ……</p>
                <p style={{ fontWeight: 700, fontSize: '13pt', margin: '4pt 0 2pt' }}>GIẢNG VIÊN HƯỚNG DẪN</p>
                <p style={{ fontStyle: 'italic', fontSize: '12pt', margin: 0 }}>(Ký và ghi rõ họ tên)</p>
              </div>
            </div>
          </article>
        ) : null}

        {activeTab === 'body' ? (
          <article className="wf-gdoc-page" style={{ '--wf-zoom': 0.72, '--wf-pad-top': '2cm', '--wf-pad-bottom': '2cm', '--wf-pad-left': '3cm', '--wf-pad-right': '2cm' }}>
            <header className="wf-a4-header has-rule">
              <span>{(coverInfo?.docTitle || (isGrad ? 'ĐỒ ÁN TỐT NGHIỆP' : 'TIỂU LUẬN MÔN HỌC')).toUpperCase()}</span>
              <span style={{ textAlign: 'right' }}>CHƯƠNG 1. TỔNG QUAN ĐỀ TÀI</span>
            </header>
            <div className="wf-a4-body">
              <p style={{ textAlign: 'center', fontWeight: 700, fontSize: '18pt', margin: '12pt 0 24pt' }}>CHƯƠNG 1. TỔNG QUAN ĐỀ TÀI</p>
              <p style={{ fontWeight: 700, fontSize: '16pt', margin: '6pt 0' }}>1.1. Đặt vấn đề và bối cảnh nghiên cứu</p>
              <p style={{ textAlign: 'justify', fontSize: '13pt', lineHeight: 1.2, margin: '6pt 0 0' }}>
                Văn bản thân bài được chuẩn hóa tự động về font Times New Roman cỡ 13pt, căn đều hai bên (Justify), giãn dòng Multiple 1.2, khoảng cách đoạn Before 6pt, After 0pt và bảo toàn các cụm chữ <strong>in đậm</strong> hoặc <em>in nghiêng</em> có chủ đích.
              </p>
              <p style={{ fontWeight: 700, fontStyle: 'italic', fontSize: '14pt', paddingLeft: '1.27cm', margin: '8pt 0 4pt' }}>1.1.1. Mục tiêu cụ thể của hệ thống</p>
              <p style={{ fontStyle: 'italic', fontSize: '13pt', paddingLeft: '2.54cm', margin: '4pt 0 2pt' }}>1.1.1.1. Yêu cầu phi chức năng và hiệu năng</p>
              <p style={{ textAlign: 'center', fontWeight: 700, fontStyle: 'italic', fontSize: '13pt', margin: '14pt 0 6pt' }}>Bảng 1-1: Quy chuẩn lề và phân cấp tiêu đề BDU</p>
              <table className="wf-a4-table is-bordered" style={{ width: '100%' }}>
                <tbody>
                  <tr className="wf-a4-tr-header">
                    <th>Thành phần</th>
                    <th>Cỡ chữ &amp; Kiểu</th>
                    <th>Căn lề / Thụt đầu dòng</th>
                  </tr>
                  <tr>
                    <td>Heading 1 (Chương)</td>
                    <td>18pt · IN HOA · Đậm</td>
                    <td>Căn giữa · Section mới</td>
                  </tr>
                  <tr>
                    <td>Heading 2 / 3 / 4</td>
                    <td>16pt / 14pt / 13pt</td>
                    <td>0 cm / 1.27 cm / 2.54 cm</td>
                  </tr>
                  <tr>
                    <td>Số trang Footer</td>
                    <td>13pt · La Mã &amp; Ả Rập</td>
                    <td>{includeThanks ? 'Hiện từ Lời cảm ơn (i, ii… → 1, 2…)' : 'Hiện từ Mục lục (i, ii… → 1, 2…)'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <footer className="wf-a4-footer has-rule">
              <span>GVHD: {coverInfo?.instructor?.trim() || 'ThS. Nguyễn Văn A'}</span>
              <span style={{ textAlign: 'center' }}>1</span>
              <span style={{ textAlign: 'right' }}>SVTH: {coverInfo?.student?.trim() || 'Sinh viên thực hiện'}</span>
            </footer>
          </article>
        ) : null}
      </div>
    </div>
  );
}
