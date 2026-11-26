import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import A4PageSheet, {
  ROLE_OPTIONS,
  ROLE_LABELS,
  OUTLINE_LEVEL,
  QUICK_ROLES,
  effectiveRole,
  isEditableParagraph,
  synthesizePagesFromItems
} from './A4PageSheet.jsx';
import { ImpactButton } from '../../lib/bdu-vfx/index.js';

const ZOOM_STEPS = [0.55, 0.65, 0.75, 0.85, 1, 1.15, 1.3];

export default function DocxReviewWorkspace({
  stage = 'review', // 'review' | 'completed'
  fileName,
  coverInfo,
  preview,
  loading = false,
  error = '',
  dirty = false,
  isSubmitting = false,
  overrides = {},
  notes = {},
  textEdits = {},
  deletedItems = [],
  insertedItems = [],
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onRoleChange,
  onNoteChange,
  onTextChange,
  onSplitOrInsertAfter,
  onInsertParagraph,
  onDeleteParagraph,
  onUndeleteParagraph,
  onRevertTextEdit,
  onRefresh,
  onReset,
  onBack,
  onConfirm,
  // Completed-mode props
  downloadUrl = null,
  downloading = false,
  onDownload,
  completionCards = [],
  onReopenReview
}) {
  const isCompleted = stage === 'completed';
  const [viewMode, setViewMode] = useState(isCompleted ? 'clean' : 'suggesting');
  const [zoom, setZoom] = useState(0.8);
  const [userZoomed, setUserZoomed] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [outlineOpen, setOutlineOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1400 : true));
  const [marginOpen, setMarginOpen] = useState(true);
  const [filter, setFilter] = useState('all');
  const [activeIndex, setActiveIndex] = useState(null);
  const [flashIndex, setFlashIndex] = useState(null);
  const [dismissedSuspects, setDismissedSuspects] = useState(() => new Set());

  const canvasRef = useRef(null);
  const pageNodesRef = useRef(new Map());
  const flashTimerRef = useRef(null);

  useEffect(() => {
    setViewMode(isCompleted ? 'clean' : 'suggesting');
  }, [isCompleted]);

  const items = useMemo(() => preview?.items || [], [preview]);
  const deletedSet = useMemo(() => new Set((deletedItems || []).map(String)), [deletedItems]);

  const itemByIndex = useMemo(() => {
    const map = new Map(items.map((it) => [String(it.i), it]));
    for (const ins of insertedItems || []) {
      map.set(String(ins.id), { i: ins.id, kind: 'p', role: ins.role || 'body', t: ins.text || '', isInserted: true });
    }
    return map;
  }, [items, insertedItems]);

  const pages = useMemo(() => {
    if (preview?.document?.pages?.length) {
      return preview.document.pages;
    }
    if (items.length) {
      return synthesizePagesFromItems(items, coverInfo);
    }
    return [];
  }, [preview, items, coverInfo]);

  const pendingInserts = useMemo(() => {
    if (!insertedItems?.length) return [];
    const serverRendered = new Set();
    for (const pg of pages) {
      for (const b of pg.blocks || []) {
        if (b.sourceIndex !== undefined && b.sourceIndex !== null) {
          serverRendered.add(String(b.sourceIndex));
        }
      }
    }
    return insertedItems.filter((ins) => !serverRendered.has(String(ins.id)) && !deletedSet.has(String(ins.id)));
  }, [insertedItems, pages, deletedSet]);

  const locations = useMemo(() => preview?.document?.locations || {}, [preview]);

  const outline = useMemo(() => {
    if (preview?.document?.outline?.length) {
      return preview.document.outline.map((entry) => {
        if (entry.sourceIndex !== null && entry.sourceIndex !== undefined && entry.sourceIndex in overrides) {
          const nextRole = overrides[entry.sourceIndex];
          if (!OUTLINE_LEVEL[nextRole]) return null;
          return { ...entry, level: OUTLINE_LEVEL[nextRole], isChanged: true };
        }
        return entry;
      }).filter(Boolean);
    }
    return items
      .map((item) => ({ item, role: effectiveRole(item, overrides) }))
      .filter(({ role }) => OUTLINE_LEVEL[role])
      .map(({ item, role }) => ({
        id: `outline-${item.i}`,
        title: item.t,
        level: OUTLINE_LEVEL[role],
        pageIndex: locations[item.i]?.pageIndex ?? 0,
        pageLabel: locations[item.i]?.pageLabel ?? '',
        sourceIndex: item.i,
        isChanged: item.i in overrides
      }));
  }, [preview, items, overrides, locations]);

  const suggestions = useMemo(
    () => items.filter((it) => {
      const k = String(it.i);
      return it.suspect && !(k in overrides) && !(it.i in overrides) && !deletedSet.has(k) && !dismissedSuspects.has(it.i);
    }),
    [items, overrides, deletedSet, dismissedSuspects]
  );

  const changes = useMemo(() => {
    const keys = new Set([
      ...Object.keys(overrides),
      ...Object.keys(notes),
      ...Object.keys(textEdits || {}),
      ...(deletedItems || []).map(String),
      ...(insertedItems || []).filter((ins) => !deletedSet.has(String(ins.id))).map((ins) => String(ins.id))
    ]);
    return [...keys].map((key) => {
      const item = itemByIndex.get(key);
      const isDeleted = deletedSet.has(key);
      const isInserted = key.startsWith('ins_');
      const hasEdit = Object.prototype.hasOwnProperty.call(textEdits || {}, key);
      const editedText = hasEdit ? textEdits[key] : item?.t;
      return {
        key,
        index: /^\d+$/.test(key) ? Number(key) : key,
        item,
        role: overrides[key] ?? overrides[Number(key)],
        note: notes[key] ?? notes[Number(key)],
        hasEdit,
        editedText,
        isDeleted,
        isInserted,
        pageLabel: locations[key]?.pageLabel || ''
      };
    });
  }, [itemByIndex, overrides, notes, textEdits, deletedItems, insertedItems, deletedSet, locations]);

  const filteredQuickList = useMemo(() => {
    if (filter === 'suspect') return suggestions;
    if (filter === 'changed') {
      return changes.map((c) => c.item || { i: c.index, t: `Đoạn #${c.index}`, role: c.role || 'body' });
    }
    if (filter === 'outline') {
      return items.filter((it) => Boolean(OUTLINE_LEVEL[effectiveRole(it, overrides)]));
    }
    return [];
  }, [filter, suggestions, changes, items, overrides]);

  // Track visible page number on scroll
  useEffect(() => {
    const root = canvasRef.current;
    if (!root || !pages.length || typeof window.IntersectionObserver === 'undefined') return undefined;
    const observer = new window.IntersectionObserver(
      (entries) => {
        let best = null;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!best || entry.intersectionRatio > best.intersectionRatio) {
              best = entry;
            }
          }
        }
        if (best) {
          const idx = Number(best.target.getAttribute('data-page-index'));
          if (Number.isInteger(idx)) setCurrentPage(idx + 1);
        }
      },
      { root, threshold: [0.15, 0.4, 0.7] }
    );
    for (const node of pageNodesRef.current.values()) {
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [pages.length, zoom]);

  const setPageRef = useCallback((pageIndex, node) => {
    if (node) pageNodesRef.current.set(pageIndex, node);
    else pageNodesRef.current.delete(pageIndex);
  }, []);

  const scrollElementIntoCanvas = useCallback((targetEl) => {
    if (!targetEl) return;
    const canvas = canvasRef.current;
    if (canvas && canvas.clientHeight > 0) {
      const canvasRect = canvas.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const targetTop = canvas.scrollTop + (targetRect.top - canvasRect.top) - Math.max(80, canvas.clientHeight * 0.28);
      canvas.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
      return;
    }
    targetEl.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, []);

  const triggerFlash = useCallback((idx) => {
    if (idx === null || idx === undefined) return;
    setFlashIndex(idx);
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      setFlashIndex((cur) => (cur === idx ? null : cur));
    }, 1600);
  }, []);

  useEffect(() => () => {
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
  }, []);

  const jumpToParagraphOrPage = useCallback((pageIndex, sourceIndex = null, fallbackTitle = '') => {
    const performScroll = () => {
      if (sourceIndex !== null && sourceIndex !== undefined) {
        setActiveIndex(sourceIndex);
        triggerFlash(sourceIndex);
        const pNode = document.getElementById(`wf-pv-${sourceIndex}`);
        if (pNode) {
          scrollElementIntoCanvas(pNode);
          return;
        }
      }
      // Fallback 1: if source paragraph was folded (e.g. static TOC line), match real heading in outline
      if (fallbackTitle) {
        const cleanTarget = fallbackTitle.replace(/\d+\s*$/, '').trim().toLocaleUpperCase('vi-VN');
        const matchedOutline = outline.find(
          (o) => o.title && o.title.trim().toLocaleUpperCase('vi-VN').includes(cleanTarget)
        );
        if (matchedOutline) {
          if (matchedOutline.sourceIndex !== null && matchedOutline.sourceIndex !== undefined) {
            const matchedNode = document.getElementById(`wf-pv-${matchedOutline.sourceIndex}`);
            if (matchedNode) {
              setActiveIndex(matchedOutline.sourceIndex);
              triggerFlash(matchedOutline.sourceIndex);
              scrollElementIntoCanvas(matchedNode);
              return;
            }
          }
          const matchedPageEl = pageNodesRef.current.get(matchedOutline.pageIndex);
          if (matchedPageEl) {
            scrollElementIntoCanvas(matchedPageEl);
            setCurrentPage(matchedOutline.pageIndex + 1);
            return;
          }
        }
      }
      if (pageIndex !== null && pageIndex !== undefined) {
        const pageEl = pageNodesRef.current.get(pageIndex);
        if (pageEl) {
          scrollElementIntoCanvas(pageEl);
          setCurrentPage(pageIndex + 1);
        }
      }
    };

    if (!isCompleted && viewMode === 'clean' && sourceIndex !== null && sourceIndex !== undefined) {
      setViewMode('suggesting');
      window.setTimeout(performScroll, 30);
    } else {
      performScroll();
    }
  }, [isCompleted, viewMode, outline, scrollElementIntoCanvas, triggerFlash]);

  const selectParagraph = useCallback((nextIdx) => {
    setActiveIndex(nextIdx);
    if (nextIdx !== null) {
      setMarginOpen(true);
    }
  }, []);

  const dismissSuggestion = useCallback((index) => {
    setDismissedSuspects((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, []);

  const fitToCanvas = useCallback(() => {
    const el = canvasRef.current;
    if (!el || !el.clientWidth) return;
    const computed = Math.min(1, Math.max(0.55, +((el.clientWidth - 48) / 794).toFixed(2)));
    setZoom(computed);
  }, []);

  useEffect(() => {
    if (userZoomed) return undefined;
    const timer = window.setTimeout(fitToCanvas, 0);
    window.addEventListener('resize', fitToCanvas);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', fitToCanvas);
    };
  }, [fitToCanvas, outlineOpen, marginOpen, pages.length, userZoomed]);

  const stepZoom = (delta) => {
    setUserZoomed(true);
    setZoom((cur) => {
      const curIdx = ZOOM_STEPS.reduce((best, val, idx) => (
        Math.abs(val - cur) < Math.abs(ZOOM_STEPS[best] - cur) ? idx : best
      ), 3);
      const nextIdx = Math.min(ZOOM_STEPS.length - 1, Math.max(0, curIdx + delta));
      return ZOOM_STEPS[nextIdx];
    });
  };

  // Global Ctrl+Z / Ctrl+Y keyboard shortcuts for Undo/Redo when not typing inside native undoable input
  useEffect(() => {
    if (isCompleted) return undefined;
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey && canUndo) {
        const tag = document.activeElement?.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT') return;
        e.preventDefault();
        onUndo?.();
      } else if ((key === 'y' || (key === 'z' && e.shiftKey)) && canRedo) {
        const tag = document.activeElement?.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT') return;
        e.preventDefault();
        onRedo?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCompleted, canUndo, canRedo, onUndo, onRedo]);

  const handleInsertAndFocus = useCallback((anchorIdx, position = 'after') => {
    const newId = onInsertParagraph?.(anchorIdx, position);
    if (newId) {
      setActiveIndex(newId);
      triggerFlash(newId);
    }
  }, [onInsertParagraph, triggerFlash]);

  const handleSplitAndFocus = useCallback((anchorIdx, beforeText, afterText) => {
    const newId = onSplitOrInsertAfter?.(anchorIdx, beforeText, afterText);
    if (newId) {
      setActiveIndex(newId);
    }
  }, [onSplitOrInsertAfter]);

  const handleDeleteParagraph = useCallback((targetIdx, opts = {}) => {
    onDeleteParagraph?.(targetIdx);
    if (opts.focusPrev) {
      const visibleIds = items.filter((it) => !deletedSet.has(String(it.i)) && it.kind === 'p').map((it) => it.i);
      const pos = visibleIds.findIndex((id) => String(id) === String(targetIdx));
      setActiveIndex(pos > 0 ? visibleIds[pos - 1] : null);
    } else if (String(activeIndex) === String(targetIdx)) {
      setActiveIndex(null);
    }
  }, [onDeleteParagraph, items, deletedSet, activeIndex]);

  const activeKey = activeIndex !== null && activeIndex !== undefined ? String(activeIndex) : null;
  const activeItem = activeKey !== null
    ? (itemByIndex.get(activeKey) || { i: activeIndex, kind: 'p', role: 'body', t: textEdits?.[activeKey] ?? `Đoạn #${activeIndex}` })
    : null;
  const activeEditable = activeItem ? isEditableParagraph(activeItem) : false;

  return (
    <section
      className={`wf-gdoc-workspace glass-panel${isCompleted ? ' is-completed' : ''}`}
      aria-labelledby="wf-preview-title"
    >
      {/* Top Google Docs Chrome & Formatting Bar */}
      <header className="wf-gdoc-topbar">
        <div className="wf-gdoc-docmeta">
          <button
            type="button"
            className="btn btn-ghost wf-gdoc-back"
            onClick={onBack}
            disabled={isSubmitting}
            title="Quay lại bảng thông tin & tùy chọn bìa"
          >
            ← {isCompleted ? 'Cấu hình mới' : 'Thông tin bìa'}
          </button>

          <div className="wf-gdoc-title-wrap">
            <div className="wf-gdoc-title-row">
              <span className="wf-gdoc-doc-icon" aria-hidden="true">W</span>
              <h3 id="wf-preview-title" className="wf-gdoc-title">
                {fileName || 'Khung thiết kế & bản xem trước tài liệu'}
              </h3>
              <span className={`wf-gdoc-mode-pill${isCompleted ? ' is-success' : ''}`}>
                {isCompleted ? '✓ Đã chuẩn hóa 100%' : 'Review thực tế · Chuẩn BDU'}
              </span>
            </div>
            <p className="wf-gdoc-subtitle">
              {isCompleted
                ? 'Văn bản đã được chuẩn hóa 100%! Kiểm tra trực tiếp các trang A4 thành phẩm bên dưới trước khi tải về.'
                : 'Bấm trực tiếp vào bất kỳ đoạn văn / ô bảng nào trên trang A4 để sửa chữ, nhấn Enter để thêm đoạn mới, xóa đoạn hoặc đổi Heading.'}
            </p>
          </div>
        </div>

        <div className="wf-gdoc-primary-actions">
          {!isCompleted ? (
            <>
              {onRefresh ? (
                <button
                  type="button"
                  className={`btn ${dirty ? 'btn-secondary is-dirty-pulse' : 'btn-ghost'}`}
                  onClick={onRefresh}
                  disabled={loading || isSubmitting}
                >
                  {loading ? 'Đang dựng trang…' : dirty ? '↻ Cập nhật trang A4' : '↻ Phân tích lại'}
                </button>
              ) : null}
              {changes.length > 0 && onReset ? (
                <button type="button" className="btn btn-ghost" onClick={onReset} disabled={loading || isSubmitting}>
                  Bỏ chỉnh sửa
                </button>
              ) : null}
              <ImpactButton
                type="button"
                id="btn-confirm-wordfmt"
                tone="primary"
                className="btn btn-primary wf-vfx-topbar-btn"
                onClick={onConfirm}
                disabled={loading || isSubmitting || !preview}
              >
                {isSubmitting ? 'Đang chuẩn hóa…' : 'Xác nhận & Chuẩn hóa DOCX'}
              </ImpactButton>
            </>
          ) : (
            <>
              {onReopenReview ? (
                <button type="button" className="btn btn-secondary" onClick={onReopenReview}>
                  ✎ Chỉnh sửa lại cấu trúc
                </button>
              ) : null}
              {downloadUrl ? (
                <a
                  id="btn-download-docx"
                  href={downloadUrl}
                  onClick={onDownload}
                  aria-busy={downloading}
                  className="btn btn-success"
                  download
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" x2="12" y1="15" y2="3" />
                  </svg>
                  <span>{downloading ? 'Đang tải…' : 'Tải Về File DOCX Đã Chuẩn Hóa'}</span>
                </a>
              ) : (
                <p className="wf-status-download-unavailable" role="status">
                  Tài liệu đã hoàn tất nhưng liên kết tải xuống chưa khả dụng. Vui lòng thử lại.
                </p>
              )}
            </>
          )}
        </div>
      </header>

      {/* Secondary Google Docs Toolbar (Zoom, Page Counter, View Switcher, Quick Style Picker) */}
      <div className="wf-gdoc-subbar" role="toolbar" aria-label="Công cụ trang giấy">
        <div className="wf-gdoc-tool-group">
          <button
            type="button"
            className={`wf-tool-btn${outlineOpen ? ' is-active' : ''}`}
            onClick={() => setOutlineOpen((v) => !v)}
            aria-pressed={outlineOpen}
            title="Ẩn/hiện Mục lục tài liệu bên trái"
          >
            ☰ Mục lục
          </button>

          {!isCompleted ? (
            <>
              <button
                type="button"
                className="wf-tool-btn"
                onClick={onUndo}
                disabled={!canUndo}
                title="Hoàn tác thao tác trước (Ctrl+Z)"
              >
                ↶ Hoàn tác
              </button>
              <button
                type="button"
                className="wf-tool-btn"
                onClick={onRedo}
                disabled={!canRedo}
                title="Làm lại thao tác (Ctrl+Y)"
              >
                ↷
              </button>
            </>
          ) : null}

          <span className="wf-tool-sep" aria-hidden="true" />

          <button type="button" className="wf-tool-btn" onClick={() => stepZoom(-1)} aria-label="Thu nhỏ trang">−</button>
          <button
            type="button"
            className="wf-tool-zoom-readout"
            onClick={() => {
              setUserZoomed(false);
              fitToCanvas();
            }}
            title="Bấm để tự động căn vừa chiều rộng khung giấy"
          >
            {Math.round(zoom * 100)}% · Vừa khung
          </button>
          <button type="button" className="wf-tool-btn" onClick={() => stepZoom(1)} aria-label="Phóng to trang">+</button>

          {pages.length > 0 ? (
            <>
              <span className="wf-tool-sep" aria-hidden="true" />
              <span className="wf-tool-page-indicator" aria-live="polite">
                Trang <strong>{Math.min(currentPage, pages.length)}</strong> / {pages.length}
              </span>
            </>
          ) : null}
        </div>

        {/* Center Quick Paragraph Style Picker & Insert/Delete Actions */}
        {!isCompleted && activeItem && activeEditable ? (
          <div className="wf-gdoc-tool-group wf-gdoc-quick-format">
            <span className="wf-quick-format-tag">Đang sửa:</span>
            <select
              aria-label="Đổi nhanh kiểu đoạn trên thanh công cụ"
              className="wf-toolbar-select"
              value={overrides[activeKey] || overrides[activeIndex] || ''}
              onChange={(e) => onRoleChange?.(activeIndex, e.target.value || null)}
            >
              <option value="">Mặc định ({ROLE_LABELS[activeItem.role] || activeItem.role})</option>
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.short}</option>
              ))}
            </select>
            <button
              type="button"
              className="wf-tool-btn"
              onClick={() => handleInsertAndFocus(activeIndex, 'after')}
              title="Thêm đoạn văn mới bên dưới"
            >
              + Thêm đoạn
            </button>
            <button
              type="button"
              className="wf-tool-btn wf-tool-btn--danger"
              onClick={() => handleDeleteParagraph(activeIndex)}
              title="Xóa đoạn đang chọn"
            >
              🗑 Xóa đoạn
            </button>
          </div>
        ) : (
          <div className="wf-gdoc-stats-inline" aria-label="Thống kê cấu trúc">
            <span><strong>{preview?.summary?.chapterCount ?? 0}</strong> chương</span>
            <span><strong>{preview?.summary?.headingCount ?? 0}</strong> mục con</span>
            {!isCompleted ? (
              <>
                <span className={suggestions.length ? 'is-warning' : ''}>
                  <strong>{suggestions.length}</strong> đề xuất
                </span>
                <span><strong>{changes.length}</strong> chỉnh sửa</span>
              </>
            ) : null}
          </div>
        )}

        <div className="wf-gdoc-tool-group">
          {!isCompleted ? (
            <div className="wf-mode-segmented" role="group" aria-label="Chế độ xem tài liệu">
              <button
                type="button"
                className={`wf-seg-btn${viewMode === 'suggesting' ? ' is-active' : ''}`}
                onClick={() => setViewMode('suggesting')}
              >
                ✎ Đề xuất
              </button>
              <button
                type="button"
                className={`wf-seg-btn${viewMode === 'clean' ? ' is-active' : ''}`}
                onClick={() => setViewMode('clean')}
              >
                👁 Bản in sạch
              </button>
            </div>
          ) : null}

          <button
            type="button"
            className={`wf-tool-btn${marginOpen ? ' is-active' : ''}`}
            onClick={() => setMarginOpen((v) => !v)}
            aria-pressed={marginOpen}
          >
            {isCompleted
              ? '📋 Báo cáo chuẩn'
              : `💬 Nhận xét (${suggestions.length + changes.length})`}
          </button>
        </div>
      </div>

      {error ? <p className="wf-preview-error" role="alert">{error}</p> : null}
      {preview?.renderWarning ? <p className="wf-preview-dirty">{preview.renderWarning}</p> : null}

      {loading && !preview ? (
        <div className="wf-preview-loading" role="status" aria-live="polite">
          <div className="wf-preview-spinner" aria-hidden="true" />
          <div>
            <strong>Đang dựng các trang A4 chuẩn BDU…</strong>
            <p>Hệ thống đang phân trang, dàn khung bìa, mục lục, bảng biểu và công thức toán trong file {fileName || '.docx'}.</p>
          </div>
        </div>
      ) : null}

      {preview ? (
        <div
          className={`wf-gdoc-stage${outlineOpen ? '' : ' is-no-outline'}${marginOpen ? '' : ' is-no-margin'}`}
        >
          {/* Left Pane: Google Docs Document Outline & Quick Filter */}
          {outlineOpen ? (
            <nav className="wf-gdoc-outline" aria-label="Khung tài liệu">
              {!isCompleted ? (
                <div className="wf-preview-filters" role="tablist" aria-label="Lọc đoạn văn">
                  {[
                    ['all', 'Mục lục'],
                    ['suspect', `Đề xuất (${suggestions.length})`],
                    ['changed', `Đã sửa (${changes.length})`]
                  ].map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      role="tab"
                      aria-selected={filter === val}
                      className={`wf-preview-filter${filter === val ? ' is-active' : ''}`}
                      onClick={() => setFilter(val)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <h4 className="wf-pane-heading">Mục lục trang in</h4>
              )}

              {filter === 'all' || isCompleted ? (
                outline.length ? (
                  <ol className="wf-outline-list">
                    {outline.map((entry, idx) => (
                      <li
                        key={`${entry.id}-${idx}`}
                        className={`wf-outline-l${entry.level || 1}${entry.isChanged ? ' is-changed' : ''}`}
                      >
                        <button
                          type="button"
                          onClick={() => jumpToParagraphOrPage(entry.pageIndex, entry.sourceIndex)}
                          title={entry.title}
                        >
                          <span className="wf-outline-text">{entry.title}</span>
                          {entry.pageLabel ? <span className="wf-outline-page">{entry.pageLabel}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="wf-preview-muted">Chưa nhận diện được tiêu đề chương/mục nào.</p>
                )
              ) : (
                <ul className="wf-outline-list">
                  {filteredQuickList.length ? filteredQuickList.map((it) => (
                    <li key={it.i} className="wf-outline-filtered-item">
                      <button
                        type="button"
                        onClick={() => jumpToParagraphOrPage(locations[it.i]?.pageIndex ?? null, it.i)}
                      >
                        <span className="wf-outline-text">{it.t || `Đoạn #${it.i}`}</span>
                        <span className="wf-outline-page">
                          {ROLE_LABELS[effectiveRole(it, overrides)]}
                        </span>
                      </button>
                    </li>
                  )) : (
                    <p className="wf-preview-muted">Không có mục nào trong bộ lọc này.</p>
                  )}
                </ul>
              )}
            </nav>
          ) : null}

          {/* Center Pane: Ruler + Scrollable Paginated A4 Canvas */}
          <div className="wf-gdoc-canvas" ref={canvasRef}>
            <div className="wf-gdoc-ruler" style={{ '--wf-zoom': zoom }} aria-hidden="true">
              <div className="wf-ruler-margin wf-ruler-left" style={{ width: `${(3 / 21) * 100}%` }}>
                <span>3cm</span>
              </div>
              <div className="wf-ruler-printable" style={{ width: `${(16 / 21) * 100}%` }}>
                <span>0</span><span>4</span><span>8</span><span>12</span><span>16cm</span>
              </div>
              <div className="wf-ruler-margin wf-ruler-right" style={{ width: `${(2 / 21) * 100}%` }}>
                <span>2cm</span>
              </div>
            </div>

            <div className="wf-gdoc-pages-stack">
              {pages.map((page) => (
                <A4PageSheet
                  key={page.pageIndex}
                  page={page}
                  pageRef={(node) => setPageRef(page.pageIndex, node)}
                  zoom={zoom}
                  reviewMode={!isCompleted && viewMode === 'suggesting'}
                  overrides={overrides}
                  notes={notes}
                  textEdits={textEdits}
                  deletedSet={deletedSet}
                  pendingInserts={pendingInserts}
                  dismissedSuspects={dismissedSuspects}
                  activeIndex={activeIndex}
                  flashIndex={flashIndex}
                  onSelectParagraph={selectParagraph}
                  onTextChange={onTextChange}
                  onSplitOrInsertAfter={handleSplitAndFocus}
                  onInsertParagraph={handleInsertAndFocus}
                  onDeleteParagraph={handleDeleteParagraph}
                  onRevertTextEdit={onRevertTextEdit}
                  onJumpToPage={jumpToParagraphOrPage}
                />
              ))}
            </div>
          </div>

          {/* Right Pane: Google Docs Margin Suggestions, Active Paragraph Inspector & Comments */}
          {marginOpen ? (
            <aside
              className="wf-gdoc-margin"
              aria-label={isCompleted ? 'Báo cáo chuẩn hóa' : 'Danh sách chỉnh sửa'}
            >
              {isCompleted ? (
                <div id="wordfmt-completion-summary" className="wf-status-summary" aria-label="Tóm tắt kết quả">
                  <h4 className="wf-pane-heading">Kết quả kiểm tra chuẩn BDU</h4>
                  {completionCards.length ? completionCards.map((card) => (
                    <article
                      key={`${card.title}-${card.description}`}
                      className={`wf-status-summary-card wf-status-summary-card--${card.tone}`}
                    >
                      <h4>{card.title}</h4>
                      <p>{card.description}</p>
                    </article>
                  )) : (
                    <article className="wf-status-summary-card wf-status-summary-card--muted">
                      <h4>Tài liệu đầu ra</h4>
                      <p>Tài liệu đã sẵn sàng để tải xuống.</p>
                    </article>
                  )}
                </div>
              ) : (
                <>
                  {/* 1. Active Paragraph Editor Card (Google Docs Comment/Style Popover) */}
                  {activeItem ? (
                    <div className="wf-gdoc-card wf-gdoc-card--active" role="group" aria-label="Chỉnh sửa đoạn">
                      <div className="wf-gdoc-card-head">
                        <span className="wf-gdoc-card-author">✎ Đoạn đang chọn</span>
                        <button
                          type="button"
                          className="wf-card-close"
                          aria-label="Đóng khung đoạn đang chọn"
                          onClick={() => setActiveIndex(null)}
                        >
                          ✕
                        </button>
                      </div>
                      <p className="wf-gdoc-card-quote">“{(activeItem.t || '').slice(0, 110)}”</p>

                      {activeEditable ? (
                        <>
                          <label className="wf-pv-editor-label" htmlFor={`wf-role-${activeItem.i}`}>
                            Đặt kiểu đoạn
                          </label>
                          <select
                            id={`wf-role-${activeItem.i}`}
                            className="form-input"
                            value={overrides[activeItem.i] || ''}
                            onChange={(e) => onRoleChange?.(activeItem.i, e.target.value || null)}
                          >
                            <option value="">Giữ như nhận diện ({ROLE_LABELS[activeItem.role] || activeItem.role})</option>
                            {activeItem.forced ? (
                              <option value="auto">Bỏ kiểu đã đặt trước đây (tự động nhận diện)</option>
                            ) : null}
                            {ROLE_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>

                          <div className="wf-pv-quick">
                            {activeItem.suggest && !(activeItem.i in overrides) ? (
                              <button
                                type="button"
                                className="wf-pv-chip is-suggest"
                                onClick={() => onRoleChange?.(activeItem.i, activeItem.suggest)}
                              >
                                Gợi ý: {ROLE_LABELS[activeItem.suggest]}
                              </button>
                            ) : null}
                            {QUICK_ROLES.map((val) => (
                              <button
                                key={val}
                                type="button"
                                className={`wf-pv-chip${overrides[activeItem.i] === val ? ' is-active' : ''}`}
                                onClick={() => onRoleChange?.(activeItem.i, val)}
                              >
                                {ROLE_LABELS[val]}
                              </button>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="wf-preview-muted">Vùng này được giữ nguyên định dạng gốc nên không đổi kiểu được.</p>
                      )}

                      <label className="wf-pv-editor-label" htmlFor={`wf-note-${activeItem.i}`}>
                        Ghi chú phần muốn sửa
                      </label>
                      <textarea
                        id={`wf-note-${activeItem.i}`}
                        className="form-input wf-pv-note"
                        rows={2}
                        maxLength={1000}
                        placeholder="Nhập nhận xét (sẽ gắn thành Comment trong file Word xuất ra)…"
                        value={notes[activeItem.i] || ''}
                        onChange={(e) => onNoteChange?.(activeItem.i, e.target.value)}
                      />
                    </div>
                  ) : null}

                  {/* 2. Google Docs Auto-Detected Suggestions */}
                  {suggestions.length > 0 ? (
                    <div className="wf-margin-section">
                      <h4 className="wf-pane-heading">Đề xuất cấu trúc ({suggestions.length})</h4>
                      <div className="wf-margin-cards">
                        {suggestions.slice(0, 25).map((sug) => (
                          <article
                            key={sug.i}
                            className={`wf-gdoc-card wf-gdoc-card--suggestion wf-gdoc-card--clickable${activeIndex === sug.i ? ' is-selected-card' : ''}`}
                            onClick={() => jumpToParagraphOrPage(locations[sug.i]?.pageIndex ?? null, sug.i, sug.t)}
                          >
                            <div className="wf-gdoc-card-head">
                              <span className="wf-gdoc-card-author">✨ Đề xuất định dạng</span>
                              <span className="wf-gdoc-card-page">
                                {locations[sug.i]?.pageLabel ? `Tr. ${locations[sug.i].pageLabel}` : 'Đi tới ↗'}
                              </span>
                            </div>
                            <div className="wf-gdoc-card-quote">
                              “{(sug.t || '').slice(0, 85)}”
                            </div>
                            <p className="wf-gdoc-card-desc">
                              {sug.suspect} · Đổi thành <strong>{ROLE_LABELS[sug.suggest] || sug.suggest}</strong>?
                            </p>
                            <div className="wf-gdoc-card-actions">
                              <button
                                type="button"
                                className="wf-suggest-accept"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRoleChange?.(sug.i, sug.suggest);
                                }}
                              >
                                ✓ Chấp nhận
                              </button>
                              <button
                                type="button"
                                className="wf-suggest-dismiss"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  dismissSuggestion(sug.i);
                                }}
                              >
                                ✕ Bỏ qua
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* 3. Applied Role Overrides, Content Edits, Insertions, Deletions & User Comments */}
                  <div className="wf-margin-section">
                    <h4 className="wf-pane-heading">Đã chỉnh &amp; Nhận xét ({changes.length})</h4>
                    {changes.length > 0 ? (
                      <ul className="wf-changes-list">
                        {changes.map(({ key, index, item, role, note, hasEdit, editedText, isDeleted, isInserted, pageLabel }) => (
                          <li
                            key={key}
                            className={`wf-gdoc-card wf-gdoc-card--clickable${String(activeIndex) === key ? ' is-selected-card' : ''}`}
                            onClick={() => !isDeleted && jumpToParagraphOrPage(locations[key]?.pageIndex ?? null, index, editedText || item?.t)}
                          >
                            <div className="wf-gdoc-card-head">
                              <button
                                type="button"
                                className="wf-change-target"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!isDeleted) jumpToParagraphOrPage(locations[key]?.pageIndex ?? null, index, editedText || item?.t);
                                }}
                              >
                                {((editedText ?? item?.t) || `Đoạn #${key}`).slice(0, 68)}
                              </button>
                              {pageLabel ? <span className="wf-gdoc-card-page">Tr. {pageLabel}</span> : null}
                            </div>

                            {isDeleted ? (
                              <p className="wf-change-role">
                                <span>🗑 <strong>Đã xóa đoạn này</strong></span>
                                <button
                                  type="button"
                                  aria-label="Khôi phục đoạn đã xóa"
                                  title="Khôi phục đoạn đã xóa"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onUndeleteParagraph?.(key);
                                  }}
                                >
                                  ↩ Khôi phục
                                </button>
                              </p>
                            ) : null}

                            {isInserted && !isDeleted ? (
                              <p className="wf-change-role">
                                <span>➕ <strong>Đoạn văn thêm mới</strong></span>
                                <button
                                  type="button"
                                  aria-label="Xóa đoạn mới thêm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteParagraph(key);
                                  }}
                                >
                                  ✕
                                </button>
                              </p>
                            ) : null}

                            {hasEdit && !isInserted && !isDeleted ? (
                              <p className="wf-change-role">
                                <span>✎ <strong>Đã sửa nội dung chữ</strong></span>
                                <button
                                  type="button"
                                  aria-label="Khôi phục nội dung gốc"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onRevertTextEdit?.(key);
                                  }}
                                >
                                  ✕
                                </button>
                              </p>
                            ) : null}

                            {role && !isDeleted ? (
                              <p className="wf-change-role">
                                <span>
                                  {ROLE_LABELS[item?.role] || item?.role} → <strong>{ROLE_LABELS[role] || role}</strong>
                                </span>
                                <button
                                  type="button"
                                  aria-label="Bỏ đổi kiểu"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onRoleChange?.(index, null);
                                  }}
                                >
                                  ✕
                                </button>
                              </p>
                            ) : null}

                            {note && !isDeleted ? (
                              <p className="wf-change-note">
                                <span>💬 {note}</span>
                                <button
                                  type="button"
                                  aria-label="Xóa ghi chú"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onNoteChange?.(index, '');
                                  }}
                                >
                                  ✕
                                </button>
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="wf-preview-muted">
                        Bấm trực tiếp vào bất kỳ đoạn văn nào trên tờ giấy A4 để gõ sửa nội dung, nhấn Enter thêm đoạn, xóa đoạn hoặc đổi Heading.
                      </p>
                    )}
                  </div>

                  {dirty ? (
                    <p className="wf-preview-dirty">
                      Bạn vừa đổi cấu trúc tiêu đề. Bấm <strong>“↻ Cập nhật trang A4”</strong> trên thanh công cụ để dựng lại Mục lục &amp; số trang.
                    </p>
                  ) : null}
                </>
              )}
            </aside>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
