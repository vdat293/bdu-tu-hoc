import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { searchTtcdsStudents } from '../../api/ttcds.js';
import { useAuth } from '../../app/providers.jsx';
import { ClubCardSkeleton } from '../clubs/components/Skeleton.jsx';
import '../clubs/clubs.css';
import { TtcdsForbiddenNotice, useTtcdsCapabilities } from './useTtcdsCapabilities.jsx';

const SEARCH_MIN_LENGTH = 2;
const MSSV_MIN_DIGITS = 4;
const SEARCH_DEBOUNCE_MS = 300;

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

  // Quay lại từ hồ sơ sinh viên: khôi phục từ khoá đã tra cứu.
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
      <section className="club-directory-grid" aria-label="Đang tải tra cứu sinh viên">
        {[1, 2, 3].map((item) => <ClubCardSkeleton key={item} />)}
      </section>
    );
  }
  if (caps.isSuccess && !canAccess) return <TtcdsForbiddenNotice />;
  if (caps.isError) {
    return (
      <div className="club-empty" role="alert">
        <h2>Chưa thể tải tra cứu sinh viên</h2>
        <p>{caps.error?.message || 'Vui lòng thử lại sau ít phút.'}</p>
        <button type="button" className="btn btn-secondary" onClick={() => caps.refetch()}>Thử lại</button>
      </div>
    );
  }

  return (
    <section id="tab-ttcds-lookup" className="tab-pane club-experience ttcds-lookup">
      <header className="club-directory-hero ttcds-lookup__hero">
        <div className="club-directory-hero__copy">
          <h1>Tra cứu sinh viên</h1>
          <p>Tìm sinh viên theo tên hoặc MSSV để xem hồ sơ và kết quả học tập.</p>
        </div>
      </header>

      <div className="card glass-panel ttcds-panel ttcds-lookup__panel">
        <div className="ttcds-lookup__search">
          <label className="ttcds-lookup__label" htmlFor="ttcds-lookup-search">Tìm sinh viên</label>
          <div className="ttcds-lookup__field">
            <span className="ttcds-lookup__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.4-3.4" />
              </svg>
            </span>
            <input
              id="ttcds-lookup-search"
              ref={inputRef}
              className="ttcds-lookup__input"
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
                className="ttcds-lookup__clear"
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
          <div className="ttcds-lookup__meta">
            <span className="ttcds-lookup__helper">Tên từ 2 ký tự · MSSV từ 4 số</span>
            {!trimmed && (
              <span className="ttcds-lookup__samples">
                <span>Thử:</span>
                {['nguyen', 'tran', '24050126'].map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    className="ttcds-lookup__sample"
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
          <p className="ttcds-lookup__notice" role="status">
            Nhập thêm {minLength - trimmed.length} ký tự để bắt đầu tra cứu.
          </p>
        )}

        {!idle && (
          <div className="ttcds-lookup__results">
            <div className="ttcds-lookup__results-head">
              <h2>Kết quả tra cứu</h2>
              {!loading && !searchQuery.isError && results.length > 0 && (
                <span className="ttcds-lookup__count">{results.length} sinh viên</span>
              )}
            </div>
            <ul id="ttcds-lookup-results" role="listbox" aria-label="Kết quả tra cứu sinh viên" className="ttcds-lookup__list">
              {loading && [0, 1, 2].map((row) => (
                <li key={row} className="ttcds-lookup__skeleton-row" aria-hidden="true">
                  <span className="ttcds-lookup__skeleton ttcds-lookup__skeleton--avatar" />
                  <span className="ttcds-lookup__skeleton-lines">
                    <span className="ttcds-lookup__skeleton ttcds-lookup__skeleton--name" />
                    <span className="ttcds-lookup__skeleton ttcds-lookup__skeleton--meta" />
                  </span>
                </li>
              ))}
              {!loading && searchQuery.isError && (
                <li className="ttcds-lookup__state">
                  <span className="ttcds-lookup__state-icon" aria-hidden="true">!</span>
                  <span role="alert">{searchQuery.error?.message || 'Không thể tìm kiếm sinh viên.'}</span>
                </li>
              )}
              {showEmpty && (
                <li className="ttcds-lookup__state">
                  <span className="ttcds-lookup__state-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.4-3.4" />
                    </svg>
                  </span>
                  <strong>Không tìm thấy sinh viên phù hợp</strong>
                  <span>Thử tên ngắn hơn hoặc kiểm tra lại MSSV.</span>
                </li>
              )}
              {!loading && results.map((student) => (
                <li key={student.mssv} role="option" aria-selected="false" className="ttcds-lookup__option">
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
                    <span className="ttcds-lookup__avatar" aria-hidden="true">{(student.name || '?').trim().charAt(0).toUpperCase()}</span>
                    <span className="ttcds-lookup__text">
                      <span className="ttcds-lookup__name">{student.name}</span>
                      <span className="ttcds-lookup__line">
                        <span className="ttcds-lookup__mssv">{student.mssv}</span>
                        <span aria-hidden="true">·</span>
                        <span>{student.className}</span>
                      </span>
                    </span>
                    <span className="ttcds-lookup__go" aria-hidden="true">
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