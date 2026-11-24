import { useEffect, useState } from 'react';
import { formatDateTime, formatLatencyMs, safeNumber } from '../utils/format.js';
import { Icons } from './Icons.jsx';

export default function LogDetailModal({ log, onClose, onInspectStudent }) {
  const [copiedField, setCopiedField] = useState('');

  useEffect(() => {
    if (!log) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [log, onClose]);

  if (!log) return null;

  const hasQuery = log.query && typeof log.query === 'object' && Object.keys(log.query).length > 0;
  const queryJson = hasQuery ? JSON.stringify(log.query, null, 2) : '';
  const statusCode = safeNumber(log.statusCode);
  const methodLower = String(log.method || 'GET').toLowerCase();

  function copyValue(field, value) {
    if (!value) return;
    navigator.clipboard?.writeText?.(value);
    setCopiedField(field);
    setTimeout(() => {
      setCopiedField((cur) => (cur === field ? '' : cur));
    }, 1800);
  }

  return (
    <div className="modal-overlay" id="modal-log-detail" onMouseDown={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-log-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3 className="modal-title" id="modal-log-title">
              Yêu Cầu #{log.id} · {log.method} {statusCode}
            </h3>
            <span className="modal-sub" id="modal-log-time">
              {formatDateTime(log.createdAt)} {log.actionLabel ? `· ${log.actionLabel}` : ''}
            </span>
          </div>
          <button
            type="button"
            className="btn-close-modal"
            id="btn-close-log-modal"
            onClick={onClose}
            aria-label="Đóng cửa sổ chi tiết nhật ký"
          >
            <Icons.close size={18} />
          </button>
        </div>

        <div className="modal-body" id="modal-log-body">
          <div className="log-detail-grid">
            <div className="detail-row">
              <span className="k">Method:</span>
              <span className={`method-tag method-${methodLower}`}>{log.method}</span>
            </div>
            <div className="detail-row">
              <span className="k">Status HTTP:</span>
              <span className="status-badge">{statusCode}</span>
            </div>
            <div className="detail-row">
              <span className="k">Độ trễ:</span>
              <span>{formatLatencyMs(log.responseTimeMs)}</span>
            </div>
            <div className="detail-row">
              <span className="k">Sinh viên:</span>
              <span>{log.mssv ? `${log.mssv} (${log.fullName || 'BDU'})` : 'Chưa đăng nhập'}</span>
            </div>
            <div className="detail-row">
              <span className="k">IP Client:</span>
              <span>{log.ipAddress || '127.0.0.1'}</span>
            </div>
            <div className="detail-row">
              <span className="k">Thiết bị:</span>
              <span>{[log.deviceType, log.os, log.browser].filter(Boolean).join(' · ')}</span>
            </div>
          </div>

          <div className="detail-block">
            <span className="detail-block-label">API đã gọi (Route pattern):</span>
            <div className="detail-code-box">
              <span>{log.route || '(không khớp route — có thể 404)'}</span>
              {log.route ? (
                <button
                  type="button"
                  className="btn-copy-code"
                  onClick={() => copyValue('route', log.route)}
                >
                  {copiedField === 'route' ? <Icons.check size={14} /> : <Icons.copy size={14} />}
                  <span>{copiedField === 'route' ? 'Đã chép' : 'Chép'}</span>
                </button>
              ) : null}
            </div>
          </div>

          <div className="detail-block">
            <span className="detail-block-label">Đường dẫn đầy đủ (Path):</span>
            <div className="detail-code-box">
              <span>{log.path}</span>
              <button
                type="button"
                className="btn-copy-code"
                onClick={() => copyValue('path', log.path)}
              >
                {copiedField === 'path' ? <Icons.check size={14} /> : <Icons.copy size={14} />}
                <span>{copiedField === 'path' ? 'Đã chép' : 'Chép'}</span>
              </button>
            </div>
          </div>

          {hasQuery ? (
            <div className="detail-block">
              <span className="detail-block-label">Tham số truy vấn (đã che token/mật khẩu):</span>
              <pre className="detail-query-box">{queryJson}</pre>
            </div>
          ) : null}

          {log.errorMessage ? (
            <div className="detail-block">
              <span className="detail-block-label detail-block-label--error">Thông báo lỗi:</span>
              <div className="detail-error-box">{log.errorMessage}</div>
            </div>
          ) : null}

          {log.referrer ? (
            <div className="detail-block">
              <span className="detail-block-label">Nguồn gọi (Referrer):</span>
              <div className="detail-code-box">{log.referrer}</div>
            </div>
          ) : null}

          {log.userAgent ? (
            <div className="detail-block">
              <span className="detail-block-label">User-Agent:</span>
              <div className="detail-code-box">{log.userAgent}</div>
            </div>
          ) : null}
        </div>

        <div className="modal-footer">
          {log.mssv ? (
            <button
              type="button"
              className="btn-action-outline"
              onClick={() => {
                onClose?.();
                onInspectStudent?.(log.mssv);
              }}
            >
              <Icons.route size={16} />
              <span>Xem hành trình của {log.mssv}</span>
            </button>
          ) : <span />}
          <button type="button" className="btn-action-primary" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
