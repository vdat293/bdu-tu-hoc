import CopyButton from './BlockCopy.jsx';

// Mirrors the original connectionInfo (assets/app.js): the four addresses the
// site filled into every command, plus the saved working directory.
export default function BlockConnection({ block, connection, workdir }) {
  const source = connection ?? block?.connection ?? {};
  const feIp = source?.feIp ?? source?.FE_IP;
  const beIp = source?.beIp ?? source?.BE_IP;
  const dbEndpoint = source?.dbEndpoint ?? source?.DB_ENDPOINT;
  const rows = [
    feIp ? { label: 'IP máy FE (public)', value: String(feIp) } : null,
    beIp ? { label: 'IP máy BE (private)', value: String(beIp) } : null,
    dbEndpoint ? { label: 'DB endpoint', value: String(dbEndpoint) } : null,
    { label: 'Thư mục làm việc', value: workdir || 'Chưa lưu ở bước 1' }
  ].filter(Boolean);
  return (
    <section className="guide-block-connection">
      <h3 className="guide-block-connection-heading">Thông tin kết nối của bạn</h3>
      <p className="guide-block-connection-desc">Website đã điền những địa chỉ này trực tiếp vào từng lệnh bên dưới. Bạn chỉ cần copy lệnh và chạy đúng máy được ghi trên khung.</p>
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
    </section>
  );
}
