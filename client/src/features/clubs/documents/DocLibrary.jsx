import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createCommunityPost } from '../../../api/community.js';
import { useAuth, useToasts } from '../../../app/providers.jsx';
import { useViewportDialog, ViewportModal } from '../../../components/ViewportModal.jsx';
import { ClubDocSkeleton, ClubEmptyState, ClubIcon } from '../components/ClubPrimitives.jsx';
import DocCard from '../components/DocCard.jsx';
import { useDocs } from '../hooks/useClubs.js';
import { safeNumber } from '../lib/format.js';

const TYPE_FILTERS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'drive_folder', label: 'Thư mục' },
  { id: 'drive_file', label: 'Tệp' },
  { id: 'video', label: 'Video' },
  { id: 'link', label: 'Liên kết' }
];

function UploadLinkModal({ open, onClose, clanId }) {
  const auth = useAuth();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const openerRef = useRef(null);
  useViewportDialog(open, onClose, dialogRef, closeRef, openerRef);

  const create = useMutation({
    mutationFn: () => createCommunityPost(auth.token, {
      title: title.trim() || 'Tài liệu CLB',
      content: '',
      scope: 'clan',
      scopeId: clanId,
      category: 'material',
      attachments: [{ url: url.trim(), title: title.trim() || 'Tài liệu CLB' }]
    }),
    onSuccess: () => {
      setTitle('');
      setUrl('');
      client.invalidateQueries({ queryKey: ['clan', auth.user?.mssv, String(clanId), 'documents'] });
      client.invalidateQueries({ queryKey: ['clan', auth.user?.mssv, String(clanId), 'posts'] });
      notify('Đã chia sẻ tài liệu.', 'success');
      onClose();
    },
    onError: (error) => notify(error.message, 'error')
  });

  if (!open) return null;

  return (
    <ViewportModal
      id="modal-club-upload-link"
      title="Chia sẻ tài liệu bằng liên kết"
      onClose={onClose}
      dialogRef={dialogRef}
      className="clb-modal"
    >
      <div className="clb-modal__head">
        <div>
          <span className="clb-eyebrow">TÀI LIỆU MỚI</span>
          <h2>Chia sẻ tài liệu</h2>
        </div>
        <button ref={closeRef} type="button" className="clb-icon-btn" onClick={onClose} aria-label="Đóng hộp thoại">
          <ClubIcon name="close" size={18} />
        </button>
      </div>
      <p className="clb-modal__intro">
        Dán liên kết Google Drive, YouTube hoặc web để chia sẻ tài liệu học tập vào CLB.
      </p>
      <form
        className="clb-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!url.trim()) return notify('Vui lòng dán liên kết tài liệu.', 'warning');
          create.mutate();
        }}
      >
        <label className="clb-field">
          <span>Tiêu đề tài liệu</span>
          <input
            className="clb-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={180}
            placeholder="Ví dụ: Slide ôn thi cuối kỳ"
          />
        </label>
        <label className="clb-field">
          <span>Liên kết (URL) *</span>
          <input
            className="clb-input"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…"
            required
          />
        </label>
        <div className="clb-modal__foot">
          <button type="button" className="clb-btn clb-btn--secondary" onClick={onClose}>Hủy</button>
          <button type="submit" className="clb-btn clb-btn--primary" disabled={create.isPending}>
            {create.isPending ? 'Đang chia sẻ…' : 'Chia sẻ'}
          </button>
        </div>
      </form>
    </ViewportModal>
  );
}

export default function DocLibrary({ clanId, canPost }) {
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [showUpload, setShowUpload] = useState(false);

  const docsQuery = useDocs(clanId, { type, search, enabled: true });
  const rawDocs = useMemo(() => {
    const data = docsQuery.data;
    if (Array.isArray(data?.documents)) return data.documents;
    if (Array.isArray(data)) return data;
    return [];
  }, [docsQuery.data]);

  const docs = useMemo(() => {
    const sorted = [...rawDocs];
    if (sort === 'name') {
      sorted.sort((a, b) => String(a.title || a.name || '').localeCompare(String(b.title || b.name || ''), 'vi'));
    } else {
      sorted.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
    return sorted;
  }, [rawDocs, sort]);

  const stats = docsQuery.data?.stats || {};
  const total = safeNumber(docsQuery.data?.total ?? docs.length);

  return (
    <div className="clb-stack">
      <div className="clb-surface">
        <div className="clb-panel-head">
          <div>
            <h2>Kho tài liệu</h2>
            <p>Tổng hợp các tệp, thư mục và liên kết học tập được chia sẻ trong CLB.</p>
          </div>
          <div className="clb-panel-head__side">
            {docsQuery.isSuccess && <span className="clb-chip">{total} mục</span>}
            {canPost && (
              <button
                type="button"
                className="clb-btn clb-btn--primary clb-btn--sm"
                onClick={() => setShowUpload(true)}
              >
                Chia sẻ tài liệu
              </button>
            )}
          </div>
        </div>

        <div className="clb-toolbar">
          <div className="clb-segmented" role="group" aria-label="Loại tài liệu">
            {TYPE_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={type === item.id ? 'is-active' : ''}
                aria-pressed={type === item.id}
                onClick={() => setType(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="clb-row__actions">
            <label className="clb-sr-only" htmlFor="club-doc-search">Tìm tài liệu</label>
            <input
              id="club-doc-search"
              className="clb-input"
              type="search"
              style={{ width: '210px' }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tên tài liệu hoặc người đăng"
            />
            <label className="clb-sr-only" htmlFor="club-doc-sort">Sắp xếp</label>
            <select
              id="club-doc-sort"
              className="clb-select"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="newest">Mới nhất</option>
              <option value="name">Tên A–Z</option>
            </select>
          </div>
        </div>
      </div>

      {docsQuery.isSuccess && (
        <div className="clb-doc-stats" aria-label="Thống kê tài liệu">
          <div className="clb-doc-stat"><strong>{safeNumber(stats.total_files ?? total)}</strong><span>Tổng mục</span></div>
          <div className="clb-doc-stat"><strong>{safeNumber(stats.folders)}</strong><span>Thư mục</span></div>
          <div className="clb-doc-stat"><strong>{safeNumber(stats.files)}</strong><span>Tệp</span></div>
          <div className="clb-doc-stat"><strong>{safeNumber(stats.videos)}</strong><span>Video</span></div>
        </div>
      )}

      {docsQuery.isLoading ? (
        <div className="clb-doc-grid"><ClubDocSkeleton /><ClubDocSkeleton /><ClubDocSkeleton /></div>
      ) : docsQuery.isError ? (
        <div className="clb-empty" role="alert">
          <h2>Chưa thể tải tài liệu</h2>
          <p>{docsQuery.error?.message}</p>
          <button type="button" className="clb-btn clb-btn--secondary" onClick={() => docsQuery.refetch()}>Thử lại</button>
        </div>
      ) : docs.length === 0 ? (
        <ClubEmptyState
          title="Chưa có tài liệu phù hợp"
          hint="Hãy thử đổi bộ lọc, hoặc chia sẻ liên kết tài liệu đầu tiên cho CLB."
        />
      ) : (
        <div className="clb-doc-grid">
          {docs.map((doc, index) => <DocCard key={doc.id || `${doc.url}-${index}`} doc={doc} />)}
        </div>
      )}

      <UploadLinkModal open={showUpload} onClose={() => setShowUpload(false)} clanId={clanId} />
    </div>
  );
}
