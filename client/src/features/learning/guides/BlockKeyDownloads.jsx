import CopyButton from './BlockCopy.jsx';

export default function BlockKeyDownloads({ keys }) {
  const list = Array.isArray(keys) ? keys.filter((k) => k?.path) : [];
  if (!list.length) {
    return (
      <div className="guide-block-note is-info">
        <p className="guide-block-note-title">Đường dẫn tải key</p>
        <p className="guide-block-note-text">Chạy xong bước 2 và dán dòng kết quả, website sẽ hiện nút copy đường dẫn từng key tại đây.</p>
      </div>
    );
  }
  return (
    <div className="guide-block-keys">
      {list.map((key) => (
        <div key={key.path} className="guide-block-key-card">
          <p className="guide-block-key-label">{key?.label || 'SSH key'}</p>
          <code className="guide-block-key-path">{key.path}</code>
          <div className="guide-block-key-actions">
            <CopyButton text={key.path} label="Copy đường dẫn" />
          </div>
        </div>
      ))}
    </div>
  );
}
