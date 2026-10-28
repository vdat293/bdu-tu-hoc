import CopyButton from './BlockCopy.jsx';

// Task-6 contract: connection data lives inline in the block
// (`block.connection`, falling back to the block itself so flat payloads like
// `{ type: 'connection', feIp }` also render). The optional `connection` prop
// is only an override slot for a future lab-result parser; bai-1.js ships bare
// `{ type: 'connection' }` blocks, which keep rendering the hint below.
export default function BlockConnection({ block, connection }) {
  const source = connection ?? block?.connection ?? block ?? {};
  const rows = [
    source?.feIp ? { label: 'Frontend (FE)', value: String(source.feIp) } : null,
    source?.beIp ? { label: 'Backend (BE)', value: String(source.beIp) } : null,
    source?.dbEndpoint ? { label: 'Database (RDS)', value: String(source.dbEndpoint) } : null
  ].filter(Boolean);
  if (!rows.length) {
    return (
      <div className="guide-block-note is-info">
        <p className="guide-block-note-title">Thông tin kết nối</p>
        <p className="guide-block-note-text">Chạy xong bước 2 và dán dòng kết quả, website sẽ hiện địa chỉ máy FE/BE tại đây.</p>
      </div>
    );
  }
  return (
    <div className="guide-block-connection">
      <p className="guide-block-connection-title">Thông tin kết nối hạ tầng của bạn</p>
      <dl className="guide-block-connection-list">
        {rows.map((row) => (
          <div key={row.label} className="guide-block-connection-row">
            <dt>{row.label}</dt>
            <dd>
              <code>{row.value}</code>
              <CopyButton text={row.value} label="Sao chép" />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
