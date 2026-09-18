import { useNavigate } from 'react-router-dom';

/**
 * Cache MSSV → họ tên để render `@FullName` đẹp ngay cả khi response
 * post/comment chưa kèm `mentions` (backend làm song song). Chỉ là bộ nhớ
 * hiển thị phía client, không dùng để phân quyền.
 */
export const MENTION_CACHE_KEY = 'bdu_mention_names';

/** Token `@...` khi render: tối thiểu 2 ký tự, loại trừ email nhờ biên trái. */
const RENDER_MENTION_RE = /(^|[^\w@])@([A-Za-z0-9_.-]{2,32})/g;

export function readMentionNameCache() {
  try {
    const raw = window.localStorage.getItem(MENTION_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function rememberMentionNames(students) {
  if (!Array.isArray(students) || !students.length) return;
  try {
    const cache = readMentionNameCache();
    let changed = false;
    students.forEach((student) => {
      const mssv = String(student?.mssv || '').trim();
      const name = String(student?.full_name || student?.name || '').trim();
      if (mssv && name && cache[mssv] !== name) {
        cache[mssv] = name;
        changed = true;
      }
    });
    if (changed) {
      const keys = Object.keys(cache).slice(-300);
      const trimmed = {};
      keys.forEach((key) => { trimmed[key] = cache[key]; });
      window.localStorage.setItem(MENTION_CACHE_KEY, JSON.stringify(trimmed));
    }
  } catch {
    // Cache chỉ để hiển thị đẹp hơn — bỏ qua mọi lỗi storage.
  }
}

export function lookupMentionName(mssv) {
  const key = String(mssv || '').trim();
  if (!key) return '';
  return String(readMentionNameCache()[key] || '');
}

/**
 * Chip @mention: đã đăng nhập click để mở trang hồ sơ sinh viên được tag
 * ngay trong khu vực Confession (/confession/profile/:mssv).
 */
function MentionChip({ mssv, label }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="cfs-mention"
      data-mssv={mssv}
      title={`${label} (${mssv}) — xem hồ sơ`}
      onClick={() => navigate(`/confession/profile/${encodeURIComponent(mssv)}`)}
    >
      @{label}
    </button>
  );
}

/**
 * Parse `content` thành React nodes, highlight các token `@MSSV`.
 * - Ưu tiên `mentions` kèm theo response (`[{ mssv, full_name }]`): hiện @FullName.
 * - Fallback: tra cache `bdu_mention_names` (lưu khi user chọn từ autocomplete).
 * - Token lạ không tra được vẫn highlight dạng @MSSV để không mất thông tin.
 * - Không dùng dangerouslySetInnerHTML: chỉ split text nodes nên miễn nhiễm XSS.
 * - `interactive=false`: render <span> highlight thuần (dùng cho ngữ cảnh ẩn
 *   danh — không navigate), mặc định là <button> có điều hướng.
 */
export function renderContentWithMentions(content, mentions = [], { interactive = true } = {}) {
  const text = String(content ?? '');
  if (!text) return null;

  const known = new Map();
  (Array.isArray(mentions) ? mentions : []).forEach((item) => {
    const mssv = String(item?.mssv || '').trim();
    if (!mssv || known.has(mssv)) return;
    known.set(mssv, String(item?.full_name || item?.name || '').trim());
  });
  const cache = readMentionNameCache();

  const nodes = [];
  let lastIndex = 0;
  let key = 0;
  const pattern = new RegExp(RENDER_MENTION_RE.source, 'g');
  let match = pattern.exec(text);
  while (match) {
    // Giữ nguyên ký tự biên trái (khoảng trắng / đầu dòng) dưới dạng text.
    const prefix = match[1] || '';
    const rawToken = match[2] || '';
    // Bỏ dấu chấm cuối câu ("chào @12345678.") khỏi MSSV.
    const mssv = rawToken.replace(/[.]+$/, '');
    const tokenStart = match.index + prefix.length;

    if (lastIndex < tokenStart) {
      nodes.push(text.slice(lastIndex, tokenStart));
    }
    if (!mssv || mssv.length < 2) {
      nodes.push(match[0]);
    } else {
      const label = known.get(mssv) || cache[mssv] || mssv;
      if (interactive) {
        nodes.push(<MentionChip key={`mention-${key++}`} mssv={mssv} label={label} />);
      } else {
        nodes.push(
          <span key={`mention-${key++}`} className="cfs-mention is-static" data-mssv={mssv} title={`${label} (${mssv})`}>
            @{label}
          </span>
        );
      }
      const trailing = match[0].slice(prefix.length + 1 + mssv.length);
      if (trailing) nodes.push(trailing);
    }
    lastIndex = match.index + match[0].length;
    match = pattern.exec(text);
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  if (!nodes.length) return text;
  return nodes;
}
