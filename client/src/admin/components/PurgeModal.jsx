import { useEffect, useState } from 'react';
import { AdminApi } from '../api/adminApi.js';
import { Icons } from './Icons.jsx';

export default function PurgeModal({ open, onClose, onPurged, showToast }) {
  const [days, setDays] = useState(14);
  const [scope, setScope] = useState('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setMessage('');
    setBusy(false);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function handleConfirm() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await AdminApi.purgeLogs({ olderThanDays: days, scope });
      const msg = `Đã dọn dẹp ${res?.trafficDeletedCount ?? 0} HTTP logs và ${res?.interactionDeletedCount ?? 0} sự kiện tương tác cũ hơn ${days} ngày.`;
      setMessage(msg);
      showToast?.(msg, 'success');
      onPurged?.();
      setTimeout(() => {
        onClose?.();
      }, 1200);
    } catch (err) {
      setMessage(err.message || 'Lỗi dọn dẹp dữ liệu.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" id="modal-purge-logs" onMouseDown={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-purge-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3 className="modal-title" id="modal-purge-title">
              <Icons.trash size={20} />
              <span>Dọn Dẹp Dữ Liệu Nhật Ký Cũ</span>
            </h3>
            <span className="modal-sub">Giải phóng dung lượng PostgreSQL trên VPS</span>
          </div>
          <button
            type="button"
            className="btn-close-modal"
            id="btn-close-purge-modal"
            onClick={onClose}
            aria-label="Đóng cửa sổ dọn dẹp"
          >
            <Icons.close size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p className="purge-label">Chọn phạm vi dữ liệu cần xóa:</p>
          <div className="purge-scope-row">
            {[
              { id: 'all', label: 'Tất cả (Logs + Tương tác)' },
              { id: 'traffic', label: 'Chỉ HTTP Logs' },
              { id: 'interactions', label: 'Chỉ Sự kiện tương tác' }
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                className={`chip ${scope === item.id ? 'active' : ''}`}
                aria-pressed={scope === item.id}
                onClick={() => setScope(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <p className="purge-label">Xóa các bản ghi cũ hơn:</p>
          <div className="purge-options-list">
            {[
              { value: 7, title: 'Cũ hơn 7 ngày', desc: 'Giữ lại 7 ngày gần nhất' },
              { value: 14, title: 'Cũ hơn 14 ngày (Khuyên dùng)', desc: 'Giữ lại 2 tuần gần nhất' },
              { value: 30, title: 'Cũ hơn 30 ngày', desc: 'Giữ lại 1 tháng gần nhất' }
            ].map((opt) => (
              <label className="purge-radio-option" key={opt.value}>
                <input
                  type="radio"
                  name="purgeRadio"
                  value={opt.value}
                  checked={days === opt.value}
                  onChange={() => setDays(opt.value)}
                />
                <div>
                  <strong>{opt.title}</strong>
                  <span>{opt.desc}</span>
                </div>
              </label>
            ))}
          </div>

          {message ? <div id="purge-alert-msg" className="purge-alert">{message}</div> : null}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-action-outline" onClick={onClose}>
            Hủy
          </button>
          <button type="button" className="btn-action-danger" onClick={handleConfirm} disabled={busy}>
            {busy ? 'Đang dọn dẹp...' : 'Xác Nhận Xóa Dữ Liệu'}
          </button>
        </div>
      </div>
    </div>
  );
}
