import { useCallback, useEffect, useState } from 'react';
import { request, unwrap } from '../api/http.js';

// Cổng chặn bảo trì toàn cục. Component chỉ NGHE event 'bdu:maintenance' do tầng
// HTTP (api/http.js) phát ra, không import lớp MaintenanceError: nhờ vậy tầng
// transport và tầng UI không phụ thuộc trực tiếp vào nhau.

// Server có thể bật khóa mà chưa nhập tiêu đề/nội dung; màn hình vẫn phải đọc
// được nên mới có giá trị mặc định ở đây.
const DEFAULT_TITLE = 'Hệ thống đang bảo trì';
const DEFAULT_MESSAGE = 'Hệ thống đang được bảo trì để nâng cấp. Vui lòng quay lại sau.';
const POLL_INTERVAL_MS = 30_000;

function toMaintenance(detail) {
  return {
    title: detail?.title || DEFAULT_TITLE,
    message: detail?.message || DEFAULT_MESSAGE
  };
}

export default function MaintenanceGate({ children }) {
  const [maintenance, setMaintenance] = useState(null);
  const locked = maintenance !== null;

  // Gọi /api/status (công khai, không cần token). Lỗi mạng hoặc endpoint lỗi thì
  // giữ nguyên trạng thái đang hiển thị: một lần gọi hỏng không được tự thoát
  // màn hình bảo trì, cũng không được tự khóa giao diện bình thường.
  const checkStatus = useCallback(async () => {
    try {
      const payload = await request('/api/status');
      const status = unwrap(payload, null);
      if (!status) return;
      if (status.locked) setMaintenance(toMaintenance(status));
      else setMaintenance(null);
    } catch {
      // Bỏ qua có chủ đích, xem chú thích ở trên.
    }
  }, []);

  // Bắt đúng trường hợp người dùng mở tab mới trong lúc dịch vụ đang khóa.
  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    const onMaintenance = (event) => setMaintenance(toMaintenance(event.detail));
    window.addEventListener('bdu:maintenance', onMaintenance);
    return () => window.removeEventListener('bdu:maintenance', onMaintenance);
  }, []);

  // Chỉ khi đang khóa mới poll; lúc bình thường không có request nền nào.
  useEffect(() => {
    if (!locked) return undefined;
    const timer = window.setInterval(checkStatus, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [locked, checkStatus]);

  if (!locked) return children;

  // Lớp phủ toàn trang đè mọi route, dùng lại bộ class modal có sẵn của hệ thống
  // (public/css/style.css) nên không phát sinh CSS mới.
  return (
    <div className="modal-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="maintenance-gate-title">
      <div className="modal-dialog">
        <div className="modal-header">
          <h2 className="modal-title" id="maintenance-gate-title">{maintenance.title}</h2>
        </div>
        <div className="modal-body">
          <p>{maintenance.message}</p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={checkStatus}>Thử lại</button>
        </div>
      </div>
    </div>
  );
}
