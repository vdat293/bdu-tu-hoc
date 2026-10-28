import CopyButton from './BlockCopy.jsx';

// Task-6 contract: key-download data lives inline in the block (`block.keys`,
// also accepting `block.items`). The optional `keys` prop is only an override
// slot for a future lab-result parser; bare `{ type: 'key-downloads' }`
// blocks (as shipped in bai-1.js) keep rendering the hint below.
export default function BlockKeyDownloads({ block, keys }) {
  const raw = Array.isArray(keys) ? keys : (block?.keys ?? block?.items ?? []);
  const list = Array.isArray(raw) ? raw.filter((k) => k?.path) : [];
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
