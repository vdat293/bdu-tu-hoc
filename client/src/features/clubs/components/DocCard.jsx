import { formatRelativeTime } from '../lib/format.js';

const ICONS = {
  drive_folder: '📁',
  drive_file: '📄',
  video: '▶',
  youtube: '▶',
  drive_video: '▶',
  link: '🔗'
};

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

export default function DocCard({ doc }) {
  const type = docType(doc);
  const target = doc.direct_url || doc.url || '#';
  const isVideo = type === 'video';
  return (
    <article className="club-doc">
      <div className="club-doc__icon" aria-hidden="true">{ICONS[type] || ICONS.link}</div>
      <h3>{doc.title || doc.name || 'Tài liệu CLB'}</h3>
      <p>{typeLabel(type)}{doc.shared_by_name ? ` · ${doc.shared_by_name}` : ''}{doc.created_at ? ` · ${formatRelativeTime(doc.created_at)}` : ''}</p>
      {isVideo && doc.embed_url && (
        <div className="club-video"><iframe src={doc.embed_url} title={doc.title || 'Video tài liệu'} allowFullScreen loading="lazy" /></div>
      )}
      {doc.preview_url && !isVideo && (
        <a className="club-doc__preview" href={target} target="_blank" rel="noopener noreferrer">Xem trước</a>
      )}
      <a href={target} target="_blank" rel="noopener noreferrer">Mở ↗</a>
    </article>
  );
}
