import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { searchTtcdsStudents } from '../../api/ttcds.js';
import { useAuth } from '../../app/providers.jsx';
import './styles/student-lookup.css';
import { TtcdsForbiddenNotice, useTtcdsCapabilities } from './useTtcdsCapabilities.jsx';

const SEARCH_MIN_LENGTH = 2;
const MSSV_MIN_DIGITS = 4;
const SEARCH_DEBOUNCE_MS = 300;
const SAMPLES = ['nguyen', 'tran', '24050126'];

export function searchMinLength(query) {
  const value = String(query ?? '').trim();
  if (/^\d+$/.test(value)) return MSSV_MIN_DIGITS;
  return SEARCH_MIN_LENGTH;
}

export function normalizeTtcdsSearchResults(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.ket_qua) ? payload.ket_qua
      : Array.isArray(payload?.data) ? payload.data
        : Array.isArray(payload?.items) ? payload.items
          : Array.isArray(payload?.results) ? payload.results
            : [];
  return list.map((raw) => {
    const mssv = raw?.mssv ?? raw?.ma_sinh_vien ?? raw?.ma_sv ?? '';
    if (!String(mssv).trim()) return null;
    const name = raw?.ho_ten ?? raw?.ten_day_du ?? raw?.full_name ?? raw?.ho_va_ten ?? '';
    const className = raw?.ma_lop ?? raw?.ten_lop ?? raw?.lop ?? '';
    return {
      mssv: String(mssv).trim().toUpperCase(),
      name: String(name ?? '').trim() || '—',
      className: String(className ?? '').trim() || '—'
    };
  }).filter(Boolean);
}

export default function TtcdsLookupPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const caps = useTtcdsCapabilities();
  const canAccess = Boolean(caps.data?.can_access);

  const restoredQuery = typeof location.state?.query === 'string' ? location.state.query : '';
  const [query, setQuery] = useState(restoredQuery);
  const [debounced, setDebounced] = useState(restoredQuery.trim());
  const inputRef = useRef(null);

  const trimmed = query.trim();
  const minLength = searchMinLength(query);
  const idle = trimmed.length < minLength;
  const partialQuery = trimmed.length > 0 && idle;

  useEffect(() => {
    const q = query.trim();
    if (q.length < searchMinLength(q)) {
      setDebounced('');
      return undefined;
    }
    const timer = window.setTimeout(() => setDebounced(q), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const searchQuery = useQuery({
    queryKey: ['ttcds-student-search', debounced],
    queryFn: ({ signal }) => searchTtcdsStudents(auth.token, debounced, { limit: 20, signal, all: true }),
    enabled: Boolean(auth.token && canAccess && debounced && debounced.length >= searchMinLength(debounced)),
    staleTime: 60 * 1000,
    retry: false
  });

  const results = useMemo(() => normalizeTtcdsSearchResults(searchQuery.data), [searchQuery.data]);
  const loading = !idle && (trimmed !== debounced || searchQuery.isFetching);
  const showEmpty = !idle && !loading && !searchQuery.isError && searchQuery.isFetched && results.length === 0;

  if (caps.isLoading) {
    return (
      <section className="slk-root slk-root--narrow" aria-label="Đang tải tra cứu sinh viên">
        <div className="slk-surface">
          <div className="slk-list">
            {[0, 1, 2].map((row) => (
              <div key={row} className="slk-skeleton-row" aria-hidden="true">
                <span className="slk-skeleton slk-skeleton--avatar" />
                <span className="slk-skeleton-lines">
                  <span className="slk-skeleton slk-skeleton--name" />
                  <span className="slk-skeleton slk-skeleton--meta" />
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (caps.isSuccess && !canAccess) return <TtcdsForbiddenNotice />;

  if (caps.isError) {
    return (
      <section className="slk-root slk-root--narrow">
        <div className="slk-state" role="alert">
          <h2>Chưa thể tải tra cứu sinh viên</h2>
          <p>{caps.error?.message || 'Vui lòng thử lại sau ít phút.'}</p>
          <button type="button" className="slk-btn" onClick={() => caps.refetch()}>Thử lại</button>
        </div>
      </section>
    );
  }

  return (
    <section id="tab-ttcds-lookup" className="slk-root slk-root--narrow">
      <header className="slk-header">
        <h1>Tra cứu sinh viên</h1>
        <p>Tìm sinh viên theo họ tên hoặc MSSV để xem hồ sơ, chuyên cần, thời khóa biểu và bảng điểm.</p>
      </header>

      <div className="slk-surface">
        <div className="slk-search-block">
          <label className="slk-search-label" htmlFor="ttcds-lookup-search">Tìm sinh viên</label>
          <div className="slk-search-field">
            <span className="slk-search-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.4-3.4" />
              </svg>
            </span>
            <input
              id="ttcds-lookup-search"
              ref={inputRef}
              className="slk-search-input"
              type="text"
              role="combobox"
              aria-expanded={!idle}
              aria-controls={!idle ? 'ttcds-lookup-results' : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              value={query}
              placeholder="Nhập tên hoặc MSSV…"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query !== '' && (
              <button
                type="button"
                className="slk-search-clear"
                aria-label="Xóa nội dung tìm kiếm"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <div className="slk-search-meta">
            <span>Tên từ 2 ký tự · MSSV từ 4 chữ số</span>
            {!trimmed && (
              <span className="slk-samples">
                <span>Thử:</span>
                {SAMPLES.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    className="slk-sample-chip"
                    onClick={() => setQuery(sample)}
                  >
                    {sample}
                  </button>
                ))}
              </span>
            )}
          </div>
        </div>

        {partialQuery && (
          <p className="slk-notice" role="status">
            Nhập thêm {minLength - trimmed.length} ký tự để bắt đầu tra cứu.
          </p>
        )}

        {!idle && (
          <div className="slk-results">
            <div className="slk-results-head">
              <h2>Kết quả tra cứu</h2>
              {!loading && !searchQuery.isError && results.length > 0 && (
                <span className="slk-count-pill">{results.length} sinh viên</span>
              )}
            </div>

            <ul id="ttcds-lookup-results" role="listbox" aria-label="Kết quả tra cứu sinh viên" className="slk-list">
              {loading && [0, 1, 2].map((row) => (
                <li key={row} className="slk-skeleton-row" aria-hidden="true">
                  <span className="slk-skeleton slk-skeleton--avatar" />
                  <span className="slk-skeleton-lines">
                    <span className="slk-skeleton slk-skeleton--name" />
                    <span className="slk-skeleton slk-skeleton--meta" />
                  </span>
                </li>
              ))}

              {!loading && searchQuery.isError && (
                <li className="slk-state">
                  <strong role="alert">{searchQuery.error?.message || 'Không thể tìm kiếm sinh viên.'}</strong>
                  <button type="button" className="slk-btn" onClick={() => searchQuery.refetch()}>Thử lại</button>
                </li>
              )}

              {showEmpty && (
                <li className="slk-state">
                  <strong>Không tìm thấy sinh viên phù hợp</strong>
                  <span>Thử từ khóa ngắn hơn hoặc kiểm tra lại MSSV.</span>
                </li>
              )}

              {!loading && results.map((student) => (
                <li key={student.mssv} role="option" aria-selected="false" className="slk-option">
                  <button
                    type="button"
                    tabIndex={0}
                    onClick={() => navigate(`/ttcds/students/${student.mssv}`, {
                      state: {
                        from: `${location.pathname}${location.search}`,
                        fromLabel: 'Tra cứu sinh viên',
                        query
                      }
                    })}
                  >
                    <span className="slk-avatar" aria-hidden="true">
                      {(student.name || '?').trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="slk-option__copy">
                      <span className="slk-option__name">{student.name}</span>
                      <span className="slk-option__meta">
                        <span className="slk-mssv">{student.mssv}</span>
                        <span aria-hidden="true">·</span>
                        <span>{student.className}</span>
                      </span>
                    </span>
                    <span className="slk-option__arrow" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
