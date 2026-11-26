import { formatRelativeTime } from '../lib/format.js';
import { ClubIcon } from './ClubPrimitives.jsx';

function docType(doc) {
  const raw = String(doc.type || doc.kind || doc.source || '').toLowerCase();
  if (raw.includes('folder')) return 'drive_folder';
  if (raw.includes('youtube') || raw === 'video' || raw.includes('drive_video')) return 'video';
  if (raw.includes('drive') || raw.includes('file')) return 'drive_file';
  return 'link';
}

function typeLabel(type) {
  if (type === 'drive_folder') return 'Thư mục Drive';
  if (type === 'drive_file') return 'Tệp Drive';
  if (type === 'video') return 'Video';
  return 'Liên kết';
}

function iconNameFor(type) {
  if (type === 'drive_folder') return 'folder';
  if (type === 'drive_file') return 'file';
  if (type === 'video') return 'video';
  return 'link';
}

export default function DocCard({ doc }) {
  const type = docType(doc);
  const target = doc.direct_url || doc.url || '#';
  const isVideo = type === 'video';

  return (
    <article className="clb-doc">
      <div className="clb-doc__icon">
        <ClubIcon name={iconNameFor(type)} size={17} />
      </div>
      <h3>{doc.title || doc.name || 'Tài liệu CLB'}</h3>
      <p>
        {typeLabel(type)}
        {doc.shared_by_name ? ` · ${doc.shared_by_name}` : ''}
        {doc.created_at ? ` · ${formatRelativeTime(doc.created_at)}` : ''}
      </p>
      {isVideo && doc.embed_url && (
        <div className="clb-video">
          <iframe src={doc.embed_url} title={doc.title || 'Video tài liệu'} allowFullScreen loading="lazy" />
        </div>
      )}
      <div className="clb-doc__links">
        {doc.preview_url && !isVideo && (
          <a className="clb-link-btn clb-link-btn--muted" href={target} target="_blank" rel="noopener noreferrer">
            Xem trước
          </a>
        )}
        <a className="clb-link-btn" href={target} target="_blank" rel="noopener noreferrer">
          Mở ↗
        </a>
      </div>
    </article>
  );
}
