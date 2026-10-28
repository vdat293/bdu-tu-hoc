export default function BlockDownload({ block }) {
  if (!block?.href) return null;
  return (
    <div className="guide-block-download">
      <span className="guide-block-download-icon" aria-hidden="true">📦</span>
      <div className="guide-block-download-text">
        <p className="guide-block-download-label">{block?.label || 'Tải tệp đính kèm'}</p>
        <p className="guide-block-download-hint">Nhấn để tải về máy và làm theo từng chặng bên dưới.</p>
      </div>
      <a className="btn btn-primary btn-sm" href={block.href} download={block?.filename || true}>
        {block?.label || 'Tải xuống'}
      </a>
    </div>
  );
}
