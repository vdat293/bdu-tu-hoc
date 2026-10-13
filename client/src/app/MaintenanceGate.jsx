import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { request, unwrap } from '../api/http.js';
import { featureForRoute } from './serviceGroups.js';

// Cổng chặn bảo trì THEO NHÓM. Component nằm trong AppLayout, quanh <Outlet/>, nên
// khi nhóm của trang hiện tại đang khoá thì chỉ vùng nội dung bị thay; sidebar và
// topbar vẫn sống để người dùng chuyển sang nhóm khác (đó là điểm của khoá theo
// nhóm: một nhóm bảo trì không được chặn cả portal).
//
// Component chỉ NGHE event 'bdu:maintenance' do tầng HTTP (api/http.js) phát ra,
// không import lớp MaintenanceError: nhờ vậy tầng transport và tầng UI không phụ
// thuộc trực tiếp vào nhau.

const DEFAULT_TITLE = 'Tính năng đang bảo trì';
// Nhắc rõ "các trang khác vẫn dùng được" vì trong giao diện mới, sidebar vẫn bấm
// được; không nói rõ thì người dùng tưởng cả hệ thống sập.
const DEFAULT_MESSAGE = 'Tính năng này đang được bảo trì để nâng cấp. Các trang khác vẫn dùng bình thường, vui lòng quay lại sau ít phút.';
const POLL_INTERVAL_MS = 30_000;

// Server có thể bật khoá mà chưa nhập tiêu đề/nội dung; màn hình vẫn phải đọc
// được nên mới có giá trị mặc định ở đây.
function toView(entry) {
  return {
    title: entry?.title || DEFAULT_TITLE,
    message: entry?.message || DEFAULT_MESSAGE
  };
}

// /api/status trả `{ result:true, data:{ groups: { <id>: { locked, title, message } } } }`.
// Chuẩn hoá về map nhóm -> entry: chỉ tin `locked` khi là boolean, nhóm thiếu entry
// thì coi như đang mở (đúng với normalizeStatusMap phía server: thiếu nhóm = mở).
function normalizeGroups(raw) {
  const result = {};
  for (const [id, value] of Object.entries(raw)) {
    result[id] = {
      locked: value?.locked === true,
      title: typeof value?.title === 'string' ? value.title : '',
      message: typeof value?.message === 'string' ? value.message : ''
    };
  }
  return result;
}

export default function MaintenanceGate({ children }) {
  const location = useLocation();
  // Trang hiện tại thuộc nhóm nào. `null` = ngoài bản đồ nhóm (portal, 404...):
  // những trang đó KHÔNG BAO GIỜ bị bảo trì, nếu không thì khoá nhầm một nhóm sẽ
  // chặn luôn đường đăng nhập và người dùng không thoát ra được.
  const group = featureForRoute(location.pathname);
  const [groups, setGroups] = useState({});
  const [checking, setChecking] = useState(false);
  // Số thứ tự request /api/status. Một response chỉ được ghi trạng thái nếu nó
  // vẫn là request mới nhất: nếu không, response mount đến muộn có thể ghi đè
  // trạng thái khoá vừa nhận từ event và tự mở khoá sai.
  const seqRef = useRef(0);

  // Gọi /api/status (công khai, không cần token) để lấy trạng thái của MỌI nhóm
  // một lần, nhờ đó điều hướng giữa các trang không phải gọi lại. Lỗi mạng hoặc
  // payload hỏng thì giữ nguyên trạng thái đang hiển thị: một lần gọi hỏng không
  // được tự thoát màn hình bảo trì, cũng không được tự khoá giao diện bình thường.
  const checkStatus = useCallback(async () => {
    const id = ++seqRef.current;
    setChecking(true);
    try {
      const payload = await request('/api/status');
      // Có request/event mới hơn xen vào trong lúc chờ ⇒ bỏ qua response cũ này.
      if (id !== seqRef.current) return;
      const status = unwrap(payload, null);
      // Không có map `groups` (server cũ trả `{locked}` phẳng, hoặc body rác) thì
      // bỏ qua, KHÔNG coi là "tất cả nhóm đã mở": tự mở khoá oan khi deploy lệch
      // phiên bản là hậu quả nặng hơn giữ khoá thêm một nhịp poll.
      if (!status || typeof status.groups !== 'object' || status.groups === null) return;
      setGroups(normalizeGroups(status.groups));
    } catch {
      // Bỏ qua có chủ đích, xem chú thích ở trên.
    } finally {
      // Chỉ request mới nhất tắt trạng thái đang kiểm tra, tránh request cũ tắt
      // nhầm nút của request mới.
      if (id === seqRef.current) setChecking(false);
    }
  }, []);

  // Bắt đúng trường hợp người dùng mở tab mới trong lúc dịch vụ đang khoá.
  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    const onMaintenance = (event) => {
      const detail = event?.detail || {};
      // Event có `group` ⇒ khoá đúng nhóm đó. Event KHÔNG có group (server cũ, hoặc
      // 503 không gắn được nhóm) ⇒ gán cho nhóm của trang hiện tại, vì chính trang
      // đang mở vừa dính 503; còn trang ngoài bản đồ nhóm thì bỏ qua, vì các trang
      // đó không bao giờ được bảo trì.
      const target = typeof detail.group === 'string' && detail.group ? detail.group : group;
      if (!target) return;
      // Đẩy seq lên để mọi response /api/status đang bay bị coi là cũ và không
      // thể ghi đè trạng thái khoá vừa nhận từ event.
      seqRef.current += 1;
      setGroups((current) => ({
        ...current,
        [target]: { locked: true, title: detail.title || '', message: detail.message || '' }
      }));
    };
    window.addEventListener('bdu:maintenance', onMaintenance);
    return () => window.removeEventListener('bdu:maintenance', onMaintenance);
  }, [group]);

  const entry = group ? groups[group] : null;
  const locked = entry?.locked === true;

  // Poll /api/status mỗi 30 giây khi route hiện tại thuộc một nhóm (kể cả lúc
  // đang mở): endpoint công khai và rẻ, cần bắt khoá mới do admin bật trong lúc
  // tab idle mà không phát sinh API call nào. Route ngoài bản đồ nhóm (null:
  // portal, 404...) không bao giờ bị khoá nên không poll để tránh request nền.
  // Lỗi mạng hoặc payload hỏng thì giữ nguyên trạng thái đang hiển thị (xem
  // checkStatus); điều hướng đổi pathname thì `group` suy ra lại ngay.
  useEffect(() => {
    if (!group) return undefined;
    const timer = window.setInterval(checkStatus, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [group, checkStatus]);

  if (!locked) return children;

  const view = toView(entry);

  // Màn bảo trì là một thẻ trong luồng của vùng nội dung, không phải overlay
  // `modal-backdrop` (position: fixed) của bản cũ: overlay đó phủ kín viewport nên
  // sidebar/topbar cũng bị che, mất đúng thứ mà khoá theo nhóm cần giữ. Dùng lại
  // class `card glass-panel` + token màu sẵn có nên không phát sinh CSS mới.
  return (
    <section
      className="card glass-panel"
      role="status"
      aria-atomic="true"
      aria-busy={checking}
      aria-labelledby="maintenance-gate-title"
      style={{ maxWidth: '560px', margin: '32px auto', padding: '32px', textAlign: 'center' }}
    >
      {/* Trang trí: ẩn với trình đọc màn hình vì thông tin đã nằm ở tiêu đề. */}
      <svg
        aria-hidden="true"
        focusable="false"
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-amber)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ marginBottom: '12px' }}
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      <h2 id="maintenance-gate-title" style={{ margin: '0 0 10px' }}>{view.title}</h2>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 20px' }}>{view.message}</p>
      <button
        type="button"
        className="btn btn-primary"
        onClick={checkStatus}
        disabled={checking}
        aria-label="Thử lại kiểm tra trạng thái bảo trì"
      >
        {checking ? 'Đang kiểm tra…' : 'Thử lại'}
      </button>
    </section>
  );
}