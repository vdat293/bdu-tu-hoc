import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchActiveStudents } from '../../api/students.js';
import { getInitials } from '../../components/identity/Identity.jsx';
import { rememberMentionNames } from './renderMentions.jsx';

/** Phát hiện `@<query>` ngay trước caret: cho MSSV, tên không dấu, gạch... */
const MENTION_TRIGGER_RE = /@([A-Za-z0-9_.-]{1,32})$/;
const MIN_SEARCH_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 250;

function assignRef(ref, node) {
  if (!ref) return;
  if (typeof ref === 'function') ref(node);
  else if (typeof ref === 'object') ref.current = node;
}

function detectMention(value, caret) {
  const before = String(value ?? '').slice(0, Math.max(0, Number(caret) || 0));
  const match = MENTION_TRIGGER_RE.exec(before);
  if (!match) return null;
  return { query: match[1], start: before.length - match[0].length };
}

/**
 * Bọc một `<input>` / `<textarea>` controlled để gõ `@` tag sinh viên active.
 *
 * Cách dùng:
 * ```jsx
 * <MentionAutocomplete
 *   value={draft.content}
 *   onChange={(next) => setDraft((prev) => ({ ...prev, content: next }))}
 *   token={auth.token}
 *   inputRef={composerRef}
 * >
 *   <textarea id="cfs-post-content" className="fb-content-textarea" rows={4} placeholder="..." />
 * </MentionAutocomplete>
 * ```
 * - `value` / `onChange(nextValue: string)`: hợp đồng chuỗi thuần để dễ bọc
 *   mọi input hiện có (không phải event).
 * - Khi chọn gợi ý, `@query` trước caret được thay bằng `@MSSV `, caret đặt
 *   sau MSSV, focus trả lại ô nhập, map MSSV → họ tên lưu vào localStorage
 *   (`bdu_mention_names`) để render `@FullName` đẹp.
 * - Anonymous mode không bị ảnh hưởng: content vẫn giữ `@MSSV` gửi lên server.
 * - Backend chưa có `/api/students/search` thì `searchActiveStudents` trả []
 *   nên dropdown chỉ không hiện — không vỡ form.
 */
export default function MentionAutocomplete({
  value,
  onChange,
  token,
  inputRef = null,
  onSelect = null,
  dropUp = false,
  children
}) {
  const listId = useId();
  const innerRef = useRef(null);
  const activeItemRef = useRef(null);
  const [mention, setMention] = useState(null);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [open, setOpen] = useState(false);

  const resolveNode = () => inputRef?.current || innerRef.current || null;

  const syncFromNode = (node) => {
    if (!node) {
      setMention(null);
      setOpen(false);
      return;
    }
    const found = detectMention(node.value, node.selectionStart);
    setMention(found);
    setActiveIndex(0);
    setOpen(Boolean(found && found.query.length >= 1));
  };

  useEffect(() => {
    if (!mention || mention.query.length < MIN_SEARCH_LENGTH) {
      setDebouncedQuery('');
      return undefined;
    }
    const timer = window.setTimeout(() => setDebouncedQuery(mention.query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [mention]);

  const searchQuery = useQuery({
    queryKey: ['student-search', debouncedQuery],
    queryFn: ({ signal }) => searchActiveStudents(token, debouncedQuery, { limit: 8, signal }),
    enabled: debouncedQuery.length >= MIN_SEARCH_LENGTH,
    staleTime: 60 * 1000,
    retry: false
  });
  const results = Array.isArray(searchQuery.data) ? searchQuery.data : [];

  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery]);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, results.length]);

  const close = () => {
    setOpen(false);
    setMention(null);
  };

  const pick = (student) => {
    if (!student?.mssv) return;
    const node = resolveNode();
    const current = String(value ?? '');
    const caret = node && typeof node.selectionStart === 'number' ? node.selectionStart : current.length;
    const found = detectMention(current, caret) || mention;
    if (!found) return;
    const insert = `@${student.mssv} `;
    onChange(`${current.slice(0, found.start)}${insert}${current.slice(caret)}`);
    rememberMentionNames([student]);
    if (typeof onSelect === 'function') onSelect(student);
    close();
    window.setTimeout(() => {
      const target = resolveNode();
      if (!target) return;
      try {
        target.focus();
        const pos = found.start + insert.length;
        target.setSelectionRange(pos, pos);
      } catch {
        // Ô nhập không hỗ trợ selection (hiếm) — vẫn giữ focus là đủ.
      }
    }, 0);
  };

  const handleChange = (event) => {
    onChange(event.target.value);
    syncFromNode(event.target);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
      return;
    }
    if (!open || !results.length) {
      children?.props?.onKeyDown?.(event);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      const picked = results[Math.min(activeIndex, results.length - 1)];
      if (picked) {
        // Chặn submit form (comment) / xuống dòng (composer) để chốt mention.
        event.preventDefault();
        pick(picked);
      }
    } else {
      children?.props?.onKeyDown?.(event);
    }
  };

  const showHint = open && mention && mention.query.length < MIN_SEARCH_LENGTH;
  const showList = open && (showHint || searchQuery.isFetching || results.length > 0 || (debouncedQuery && searchQuery.isFetched));

  return (
    <span className={`cfs-mention-wrap${dropUp ? ' is-drop-up' : ''}`}>
      {cloneElement(children, {
        ref: (node) => {
          assignRef(inputRef, node);
          assignRef(innerRef, node);
          assignRef(children?.ref, node);
        },
        value,
        onChange: handleChange,
        onKeyDown: handleKeyDown,
        onKeyUp: (event) => {
          if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) syncFromNode(event.target);
          children?.props?.onKeyUp?.(event);
        },
        onClick: (event) => {
          syncFromNode(event.target);
          children?.props?.onClick?.(event);
        },
        onBlur: (event) => {
          // Delay để click chọn gợi ý (đã preventDefault mousedown) kịp chạy.
          window.setTimeout(() => {
            setOpen(false);
          }, 150);
          children?.props?.onBlur?.(event);
        },
        autoComplete: 'off',
        autoCapitalize: 'off',
        autoCorrect: 'off',
        spellCheck: false,
        'aria-expanded': Boolean(showList),
        'aria-controls': showList ? listId : undefined,
        'aria-autocomplete': 'list'
      })}
      {showList && (
        <ul id={listId} role="listbox" aria-label="Gợi ý tag sinh viên" className="cfs-mention-list">
          {showHint && (
            <li className="cfs-mention-empty" aria-disabled="true">
              Gõ thêm ký tự sau @ để tìm sinh viên…
            </li>
          )}
          {!showHint && searchQuery.isFetching && results.length === 0 && (
            <li className="cfs-mention-empty" aria-disabled="true">
              Đang tìm kiếm…
            </li>
          )}
          {!showHint && !searchQuery.isFetching && debouncedQuery && results.length === 0 && (
            <li className="cfs-mention-empty" aria-disabled="true">
              Không tìm thấy sinh viên phù hợp.
            </li>
          )}
          {results.map((student, index) => {
            const isActive = index === activeIndex;
            return (
              <li key={student.mssv} role="option" aria-selected={isActive} id={`${listId}-opt-${index}`}>
                <button
                  ref={isActive ? activeItemRef : null}
                  type="button"
                  tabIndex={-1}
                  className={`cfs-mention-item${isActive ? ' is-active' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(student)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="cfs-mention-avatar" aria-hidden="true">
                    {getInitials(student.full_name)}
                  </span>
                  <span className="cfs-mention-meta">
                    <strong className="cfs-mention-name">{student.full_name}</strong>
                    <small className="cfs-mention-mssv">{student.mssv}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </span>
  );
}
