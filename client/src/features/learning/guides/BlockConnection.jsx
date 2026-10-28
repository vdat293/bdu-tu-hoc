import CopyButton from './BlockCopy.jsx';

export default function BlockConnection({ connection }) {
  const rows = [
    connection?.feIp ? { label: 'Frontend (FE)', value: String(connection.feIp) } : null,
    connection?.beIp ? { label: 'Backend (BE)', value: String(connection.beIp) } : null,
    connection?.dbEndpoint ? { label: 'Database (RDS)', value: String(connection.dbEndpoint) } : null
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
