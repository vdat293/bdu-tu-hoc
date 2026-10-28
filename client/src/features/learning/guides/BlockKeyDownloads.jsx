import CopyButton from './BlockCopy.jsx';

// Mirrors the original keyDownloads cards (assets/app.js): one numbered card
// per host with the exact CloudShell download instructions. Host order is
// fixed FE-then-BE like the original ["FE", "BE"] loop.
export default function BlockKeyDownloads({ block, keys }) {
  const raw = Array.isArray(keys) ? keys : (block?.keys ?? block?.items ?? []);
  const list = (Array.isArray(raw) ? raw : []).filter((key) => key?.path);
  if (!list.length) return null;
  const hosts = ['FE', 'BE'];
  return (
    <div className="guide-block-keys">
      {list.slice(0, 2).map((key, index) => {
        const host = hosts[index] || `HOST${index + 1}`;
        const filename = String(key.path).split('/').pop() || `bdu-key-${host.toLowerCase()}.pem`;
        return (
          <section key={key.path} className="guide-block-key-card">
            <h3 className="guide-block-key-title">{index + 2}. Tải {filename}</h3>
            <p className="guide-block-key-text">Bấm Copy đường dẫn {host} bên dưới. Quay lại hộp Download file trong CloudShell, nhấn vào ô Individual file path (mũi tên 1 trong ảnh hướng dẫn bên dưới) và nhấn Ctrl+V để dán. Sau đó nhấn chuột trái vào nút Download màu cam (mũi tên 2) để tải {filename} về máy.</p>
            <label className="guide-block-key-label" htmlFor={`guide-key-path-${host}`}>
              Đường dẫn cần dán cho key {host}
            </label>
            <input
              id={`guide-key-path-${host}`}
              className="guide-block-key-input"
              type="text"
              readOnly
              value={key.path}
            />
            <div className="guide-block-key-actions">
              <CopyButton text={key.path} label={`Copy đường dẫn ${host}`} />
            </div>
            <p className="guide-block-key-note">
              {index === 0
                ? 'Tải xong file FE, mở lại Actions → Download file để tải key BE ở mục tiếp theo.'
                : 'Tải xong file BE, bạn cần có đủ hai file trong Downloads trước khi chuyển vào lab1.'}
            </p>
          </section>
        );
      })}
    </div>
  );
}
