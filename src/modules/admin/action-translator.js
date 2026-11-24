import {
  FEATURE_GROUPS,
  OTHER_FEATURE,
  featureForPath
} from '../../config/feature-groups.js';

const GROUP_LABELS = new Map(FEATURE_GROUPS.map((group) => [group.id, group.label]));

const NOISE_PREFIXES = [
  '/api/version',
  '/api/health',
  '/api/status',
  '/api/queue-status',
  '/api/service-lock',
  '/api/notifications/unread',
  '/api/notifications/unread-count',
  '/api/identity/catalog',
  '/api/admin/dashboard',
  '/api/telemetry',
  '/api/ttcds/capabilities'
];

const EXACT_PAGE_TITLES = new Map([
  ['/', 'Trang chủ'],
  ['/login', 'Đăng nhập'],
  ['/gpa', 'Bảng điểm & GPA'],
  ['/info', 'Lý lịch sinh viên'],
  ['/schedule', 'Thời khóa biểu'],
  ['/leaderboard', 'Bảng xếp hạng'],
  ['/wordfmt', 'Chuẩn hóa Word BDU'],
  ['/survey', 'Auto đánh giá khảo sát'],
  ['/training-score', 'Auto điểm rèn luyện'],
  ['/english', 'Auto bài tập tiếng Anh'],
  ['/enrollment', 'Đăng ký môn học'],
  ['/learning', 'Kho Tài Liệu'],
  ['/vocab', 'Luyện từ vựng'],
  ['/grammar', 'Luyện ngữ pháp'],
  ['/clans', 'CLB / Nhóm Học Tập'],
  ['/confession', 'BDU Confession'],
  ['/killer-sudoku', 'Killer Sudoku'],
  ['/mystudent', 'Sinh viên của tôi'],
  ['/ttcds', 'Trung tâm Chuyển đổi số'],
  ['/ttcds/lookup', 'Tra cứu sinh viên TTCDS'],
  ['/ttcds/search', 'Tra cứu sinh viên TTCDS'],
  ['/ttcds/tra-cuu', 'Tra cứu sinh viên TTCDS'],
  ['/ttcds/students', 'Tra cứu sinh viên TTCDS'],
  ['/grade-card-gallery', 'Bộ sưu tập Thẻ điểm'],
  ['/games', 'Sảnh Giải trí']
]);

const DYNAMIC_PAGE_RULES = [
  {
    re: /^\/learning\/([^/]+)\/quiz-sets\/([^/]+)\/parts\/([^/]+)\/([^/]+)$/,
    pattern: '/learning/:courseCode/quiz-sets/:setId/parts/:partIndex/:mode',
    title: (m) => `Luyện trắc nghiệm ${decodeSafe(m[1]).toUpperCase()}`
  },
  {
    re: /^\/learning\/([^/]+)\/quiz-sets\/([^/]+)$/,
    pattern: '/learning/:courseCode/quiz-sets/:setId',
    title: (m) => `Bộ câu hỏi ${decodeSafe(m[1]).toUpperCase()}`
  },
  {
    re: /^\/learning\/([^/]+)\/guides\/([^/]+)(?:\/([^/]+))?$/,
    pattern: '/learning/:courseCode/guides/:lessonId',
    title: (m) => `Hướng dẫn thực hành ${decodeSafe(m[1]).toUpperCase()}`
  },
  {
    re: /^\/learning\/([^/]+)$/,
    pattern: '/learning/:courseCode',
    title: (m) => `Môn học ${decodeSafe(m[1]).toUpperCase()}`
  },
  {
    re: /^\/vocab\/set\/([^/]+)\/([^/]+)$/,
    pattern: '/vocab/set/:setId/:mode',
    title: (m) => `Luyện từ vựng (${vocabModeLabel(m[2])})`
  },
  {
    re: /^\/vocab\/set\/([^/]+)$/,
    pattern: '/vocab/set/:setId',
    title: () => 'Bộ từ vựng'
  },
  {
    re: /^\/vocab\/review\/([^/]+)$/,
    pattern: '/vocab/review/:mode',
    title: (m) => `Ôn tập từ vựng (${vocabModeLabel(m[1])})`
  },
  {
    re: /^\/vocab\/([^/]+)$/,
    pattern: '/vocab/:slug',
    title: () => 'Chủ đề từ vựng'
  },
  {
    re: /^\/grammar\/path\/([^/]+)$/,
    pattern: '/grammar/path/:pathId',
    title: () => 'Lộ trình ngữ pháp'
  },
  {
    re: /^\/grammar\/lesson\/([^/]+)$/,
    pattern: '/grammar/lesson/:lessonId',
    title: () => 'Bài học ngữ pháp'
  },
  {
    re: /^\/clans\/([^/]+)$/,
    pattern: '/clans/:clanId',
    title: () => 'Không gian CLB / Nhóm'
  },
  {
    re: /^\/confession\/profile\/([^/]+)$/,
    pattern: '/confession/profile/:mssv',
    title: () => 'Hồ sơ sinh viên (Confession)'
  },
  {
    re: /^\/ttcds\/groups\/([^/]+)$/,
    pattern: '/ttcds/groups/:id',
    title: () => 'Chi tiết nhóm TTCDS'
  },
  {
    re: /^\/ttcds\/students\/([^/]+)$/,
    pattern: '/ttcds/students/:mssv',
    title: () => 'Chi tiết sinh viên TTCDS'
  },
  {
    re: /^\/games\/.+$/,
    pattern: '/games/*',
    title: () => 'Chơi game giải trí'
  }
];

function decodeSafe(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

function vocabModeLabel(mode) {
  const m = String(mode || '').toLowerCase();
  if (m === 'flashcard') return 'Thẻ nhớ';
  if (m === 'quiz') return 'Trắc nghiệm';
  if (m === 'typing') return 'Gõ từ';
  if (m === 'match' || m === 'matching') return 'Ghép cặp';
  return m || 'Luyện tập';
}

export function normalizePagePath(rawPath) {
  let clean = String(rawPath || '/').split(/[?#]/, 1)[0].trim();
  if (!clean.startsWith('/')) clean = `/${clean}`;
  if (clean.length > 1) clean = clean.replace(/\/+$/, '');
  return clean || '/';
}

export function normalizePagePattern(rawPath) {
  const path = normalizePagePath(rawPath);
  if (EXACT_PAGE_TITLES.has(path)) return path;
  for (const rule of DYNAMIC_PAGE_RULES) {
    if (rule.re.test(path)) return rule.pattern;
  }
  return path;
}

export function featureLabelForId(featureId) {
  if (!featureId || featureId === OTHER_FEATURE.id) return OTHER_FEATURE.label;
  return GROUP_LABELS.get(featureId) || featureId;
}

export function describePage(rawPath) {
  const path = normalizePagePath(rawPath);
  const group = featureForPath(path);
  let pattern = path;
  let title = EXACT_PAGE_TITLES.get(path) || '';

  if (!title) {
    for (const rule of DYNAMIC_PAGE_RULES) {
      const match = path.match(rule.re);
      if (match) {
        pattern = rule.pattern;
        title = rule.title(match);
        break;
      }
    }
  }

  if (!title) {
    title = group.id !== OTHER_FEATURE.id ? group.label : `Trang ${path}`;
  }

  return {
    path,
    pattern,
    title,
    featureId: group.id,
    featureLabel: group.label
  };
}

export function isNoiseRequest(routeOrPath) {
  const clean = normalizePagePath(routeOrPath);
  return NOISE_PREFIXES.some(
    (prefix) => clean === prefix || clean.startsWith(`${prefix}/`)
  );
}

const API_TRANSLATION_RULES = [
  { method: 'POST', prefix: '/api/login', label: 'Đăng nhập cổng sinh viên', category: 'auth' },
  { method: 'POST', prefix: '/api/profile', label: 'Tải lý lịch sinh viên', category: 'portal' },
  { method: 'GET', prefix: '/api/profile', label: 'Tải lý lịch sinh viên', category: 'portal' },
  { method: 'POST', prefix: '/api/grades', label: 'Tải bảng điểm & GPA', category: 'portal' },
  { method: 'GET', prefix: '/api/grades', label: 'Tải bảng điểm & GPA', category: 'portal' },
  { method: 'POST', prefix: '/api/schedule', label: 'Tải thời khóa biểu', category: 'portal' },
  { method: 'GET', prefix: '/api/schedule', label: 'Tải thời khóa biểu', category: 'portal' },
  { method: 'GET', prefix: '/api/rankings', label: 'Xem bảng xếp hạng GPA', category: 'portal' },
  { method: 'POST', prefix: '/api/wordfmt/format', label: 'Chuẩn hóa tài liệu Word', category: 'tool' },
  { method: 'POST', prefix: '/api/wordfmt/preview', label: 'Xem trước cấu trúc Word', category: 'tool' },
  { method: 'GET', prefix: '/api/wordfmt/download', label: 'Tải file Word đã chuẩn hóa', category: 'tool' },
  { method: 'GET', prefix: '/api/wordfmt', label: 'Xem tài liệu Word', category: 'tool' },
  { method: 'POST', prefix: '/api/survey', label: 'Chạy auto đánh giá khảo sát', category: 'tool' },
  { method: 'GET', prefix: '/api/survey', label: 'Xem trạng thái/danh sách khảo sát', category: 'tool' },
  { method: 'POST', prefix: '/api/training-score/submit', label: 'Gửi chấm điểm rèn luyện', category: 'tool' },
  { method: 'POST', prefix: '/api/training-score/cds-sync', label: 'Đồng bộ điểm rèn luyện CDS', category: 'tool' },
  { method: 'GET', prefix: '/api/training-score', label: 'Xem phiếu điểm rèn luyện', category: 'tool' },
  { method: 'POST', prefix: '/api/enrollment', label: 'Thao tác auto đăng ký môn học', category: 'tool' },
  { method: 'GET', prefix: '/api/enrollment', label: 'Xem dữ liệu đăng ký môn học', category: 'tool' },
  { method: 'POST', prefix: '/api/english', label: 'Làm bài tập tiếng Anh Moodle', category: 'tool' },
  { method: 'GET', prefix: '/api/english', label: 'Xem tiến độ/bài tập tiếng Anh', category: 'tool' },
  { method: 'GET', prefix: '/api/learning', label: 'Xem tài liệu / trắc nghiệm môn học', category: 'learning' },
  { method: 'POST', prefix: '/api/learning', label: 'Nộp bài hoặc tương tác học liệu', category: 'learning' },
  { method: 'DELETE', prefix: '/api/learning', label: 'Đặt lại tiến độ bài học', category: 'learning' },
  { method: 'POST', prefix: '/api/vocab', label: 'Lưu tiến độ luyện từ vựng', category: 'learning' },
  { method: 'GET', prefix: '/api/vocab', label: 'Tải bộ từ vựng', category: 'learning' },
  { method: 'POST', prefix: '/api/grammar', label: 'Nộp bài luyện ngữ pháp', category: 'learning' },
  { method: 'GET', prefix: '/api/grammar', label: 'Tải bài học ngữ pháp', category: 'learning' },
  { method: 'POST', prefix: '/api/community/posts', label: 'Đăng hoặc tương tác Confession', category: 'community' },
  { method: 'DELETE', prefix: '/api/community/posts', label: 'Xóa bài/bình luận Confession', category: 'community' },
  { method: 'PATCH', prefix: '/api/community/posts', label: 'Chỉnh sửa bài Confession', category: 'community' },
  { method: 'PUT', prefix: '/api/community/posts', label: 'Cập nhật bài Confession', category: 'community' },
  { method: 'GET', prefix: '/api/community/posts', label: 'Tải bảng tin Confession', category: 'community' },
  { method: 'POST', prefix: '/api/community/media', label: 'Tải ảnh lên Confession', category: 'community' },
  { method: 'POST', prefix: '/api/community/clans', label: 'Tương tác CLB / Nhóm học tập', category: 'clubs' },
  { method: 'PUT', prefix: '/api/community/clans', label: 'Cập nhật CLB / Nhóm học tập', category: 'clubs' },
  { method: 'PATCH', prefix: '/api/community/clans', label: 'Cập nhật thành viên CLB', category: 'clubs' },
  { method: 'DELETE', prefix: '/api/community/clans', label: 'Xóa nội dung CLB / Nhóm', category: 'clubs' },
  { method: 'GET', prefix: '/api/community/clans', label: 'Xem thông tin CLB / Nhóm', category: 'clubs' },
  { method: 'POST', prefix: '/api/community/polls', label: 'Bỏ phiếu hoặc tạo bình chọn CLB', category: 'clubs' },
  { method: 'GET', prefix: '/api/community/polls', label: 'Xem bình chọn CLB', category: 'clubs' },
  { method: 'POST', prefix: '/api/entertainment', label: 'Thao tác phòng game Giải trí', category: 'games' },
  { method: 'GET', prefix: '/api/entertainment', label: 'Xem phòng game Giải trí', category: 'games' },
  { method: 'POST', prefix: '/api/games/killer-sudoku', label: 'Lưu tiến độ Killer Sudoku', category: 'ttcds' },
  { method: 'GET', prefix: '/api/games/killer-sudoku', label: 'Tải ván Killer Sudoku', category: 'ttcds' },
  { method: 'GET', prefix: '/api/ttcds', label: 'Tra cứu dữ liệu TTCDS', category: 'ttcds' },
  { method: 'POST', prefix: '/api/ttcds', label: 'Cập nhật dữ liệu TTCDS', category: 'ttcds' },
  { method: 'PUT', prefix: '/api/ttcds', label: 'Phân quyền hoặc cập nhật TTCDS', category: 'ttcds' },
  { method: 'DELETE', prefix: '/api/ttcds', label: 'Xóa dữ liệu TTCDS', category: 'ttcds' },
  { method: 'GET', prefix: '/api/notifications', label: 'Xem danh sách thông báo', category: 'other' },
  { method: 'POST', prefix: '/api/notifications', label: 'Đánh dấu hoặc cài đặt thông báo', category: 'other' },
  { method: 'GET', prefix: '/api/reminders', label: 'Xem cài đặt nhắc lịch học', category: 'other' },
  { method: 'POST', prefix: '/api/reminders', label: 'Cập nhật nhắc lịch / liên kết Discord', category: 'other' },
  { method: 'DELETE', prefix: '/api/reminders', label: 'Hủy nhắc lịch / ngắt Discord', category: 'other' },
  { method: 'GET', prefix: '/api/identity', label: 'Xem danh hiệu & khung avatar', category: 'other' },
  { method: 'POST', prefix: '/api/identity', label: 'Đổi danh hiệu / khung / avatar', category: 'other' },
  { method: 'PUT', prefix: '/api/identity', label: 'Cập nhật danh hiệu / khung avatar', category: 'other' },
  { method: 'GET', prefix: '/api/tool-runs', label: 'Xem lịch sử chạy công cụ', category: 'tool' }
];

export function describeApiAction(method = 'GET', routeOrPath = '/') {
  const upperMethod = String(method || 'GET').toUpperCase();
  const clean = normalizePagePath(routeOrPath);
  const group = featureForPath(clean);
  const noise = isNoiseRequest(clean);

  if (noise) {
    return {
      label: 'Kiểm tra nền hệ thống (polling)',
      category: 'noise',
      isNoise: true,
      featureId: group.id,
      featureLabel: group.label
    };
  }

  for (const rule of API_TRANSLATION_RULES) {
    if (rule.method !== upperMethod) continue;
    if (clean === rule.prefix || clean.startsWith(`${rule.prefix}/`)) {
      return {
        label: rule.label,
        category: rule.category,
        isNoise: false,
        featureId: group.id,
        featureLabel: group.label
      };
    }
  }

  // Cụ thể hơn cho bình luận/react nếu chưa khớp ở trên
  if (clean.includes('/comments')) {
    return {
      label: upperMethod === 'GET' ? 'Xem bình luận' : 'Gửi bình luận',
      category: group.id,
      isNoise: false,
      featureId: group.id,
      featureLabel: group.label
    };
  }
  if (clean.includes('/reactions')) {
    return {
      label: 'Thả cảm xúc bài viết',
      category: group.id,
      isNoise: false,
      featureId: group.id,
      featureLabel: group.label
    };
  }

  return {
    label: group.id !== OTHER_FEATURE.id
      ? `${group.label} (${upperMethod})`
      : `${upperMethod} ${clean}`,
    category: group.id,
    isNoise: false,
    featureId: group.id,
    featureLabel: group.label
  };
}

export function formatShortDurationVi(durationMs) {
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms <= 0) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} giây`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min} phút ${rem} giây` : `${min} phút`;
}

export function describeInteractionEvent(event = {}) {
  const type = String(event.eventType || event.event_type || 'action');
  const pageTitle = event.pageTitle || event.page_title || describePage(event.pagePath || event.page_path || '/').title;
  const targetLabel = String(event.targetLabel || event.target_label || '').trim();
  const durationText = formatShortDurationVi(event.durationMs ?? event.duration_ms);

  switch (type) {
    case 'page_view':
      return `Mở trang ${pageTitle}`;
    case 'page_leave':
      return durationText ? `Rời trang ${pageTitle} (xem ${durationText})` : `Rời trang ${pageTitle}`;
    case 'click':
      return targetLabel ? `Bấm "${targetLabel}"` : `Nhấp chuột trên ${pageTitle}`;
    case 'search':
      return targetLabel ? `Tìm kiếm "${targetLabel}"` : `Tìm kiếm trong ${pageTitle}`;
    case 'error':
      return targetLabel ? `Gặp lỗi: ${targetLabel}` : `Gặp lỗi trên ${pageTitle}`;
    case 'action':
    default:
      return targetLabel || event.eventName || event.event_name || `Tương tác trên ${pageTitle}`;
  }
}

export const AUTOMATION_TOOLS = [
  {
    id: 'wordfmt',
    label: 'Chuẩn hóa Word BDU',
    pagePath: '/wordfmt',
    usedDesc: 'Chạy chuẩn hóa hoặc tải file .docx',
    triedDesc: 'Upload & xem trước cấu trúc'
  },
  {
    id: 'survey',
    label: 'Auto đánh giá khảo sát',
    pagePath: '/survey',
    usedDesc: 'Bấm chạy auto khảo sát',
    triedDesc: ''
  },
  {
    id: 'training',
    label: 'Auto điểm rèn luyện',
    pagePath: '/training-score',
    usedDesc: 'Gửi lưu điểm rèn luyện',
    triedDesc: 'Đồng bộ tiêu chí 6.16 từ CDS'
  },
  {
    id: 'english',
    label: 'Auto bài tập tiếng Anh',
    pagePath: '/english',
    usedDesc: 'Chạy auto làm bài / hoàn thành khóa',
    triedDesc: 'Đăng nhập Moodle xem khóa học'
  },
  {
    id: 'enrollment',
    label: 'Auto đăng ký môn học',
    pagePath: '/enrollment',
    usedDesc: 'Kích hoạt auto ĐKMH hoặc rút môn',
    triedDesc: 'Lưu danh sách lớp ưu tiên'
  }
];

export const AUTOMATION_TOOL_IDS = new Set(AUTOMATION_TOOLS.map((t) => t.id));

export const AUTOMATION_STATUS_LABELS = {
  used: 'Đã sử dụng thật',
  tried: 'Mới chuẩn bị / thử',
  viewed_only: 'Chỉ vào xem'
};

const UI_USED_EVENTS = {
  wordfmt: new Set(['wordfmt_format', 'wordfmt_download']),
  survey: new Set(['survey_run']),
  training: new Set(['training_score_submit']),
  english: new Set(['english_auto_finish', 'english_single_quiz']),
  enrollment: new Set(['enrollment_start', 'enrollment_withdraw'])
};

const UI_TRIED_EVENTS = {
  wordfmt: new Set(['wordfmt_preview']),
  training: new Set(['training_score_cds_sync']),
  english: new Set(['english_login']),
  enrollment: new Set(['enrollment_save_priority'])
};

export function classifyAutomationUiEvent(ev = {}) {
  const pageInfo = describePage(ev.pagePath || ev.page_path || '/');
  const rawFeature = ev.featureId || ev.feature_id;
  const toolId = AUTOMATION_TOOL_IDS.has(rawFeature)
    ? rawFeature
    : (AUTOMATION_TOOL_IDS.has(pageInfo.featureId) ? pageInfo.featureId : null);

  if (!toolId) return null;

  const eventType = String(ev.eventType || ev.event_type || '');
  const eventName = String(ev.eventName || ev.event_name || '');
  const actionLabel = describeInteractionEvent(ev);

  if (eventType === 'action') {
    if (UI_USED_EVENTS[toolId]?.has(eventName)) {
      return { toolId, tier: 'used', actionLabel };
    }
    if (UI_TRIED_EVENTS[toolId]?.has(eventName)) {
      return { toolId, tier: 'tried', actionLabel };
    }
  }

  return { toolId, tier: 'view', actionLabel };
}

export function classifyAutomationApiRequest(method = 'GET', routeOrPath = '/', statusCode = 200) {
  const m = String(method || 'GET').toUpperCase();
  const path = normalizePagePath(routeOrPath);
  if (isNoiseRequest(path)) return null;

  const ok = Number(statusCode ?? 200) < 400;
  let toolId = null;
  let tier = 'view';

  if (path === '/api/wordfmt' || path.startsWith('/api/wordfmt/')) {
    toolId = 'wordfmt';
    if ((m === 'POST' && path === '/api/wordfmt/format') || (m === 'GET' && path.startsWith('/api/wordfmt/download'))) {
      tier = ok ? 'used' : 'tried';
    } else if (m === 'POST' && path === '/api/wordfmt/preview') {
      tier = 'tried';
    }
  } else if (path === '/api/survey' || path.startsWith('/api/survey/') || path === '/api/tool-runs' || path.startsWith('/api/tool-runs/')) {
    toolId = 'survey';
    if ((m === 'POST' && path === '/api/survey/runs') || (m === 'GET' && path === '/api/survey/stream')) {
      tier = ok ? 'used' : 'tried';
    }
  } else if (path === '/api/training-score' || path.startsWith('/api/training-score/')) {
    toolId = 'training';
    if (m === 'POST' && path === '/api/training-score/submit') {
      tier = ok ? 'used' : 'tried';
    } else if (m === 'POST' && path === '/api/training-score/cds-sync') {
      tier = 'tried';
    }
  } else if (path === '/api/english' || path.startsWith('/api/english/')) {
    toolId = 'english';
    if (m === 'POST' && /^\/api\/english\/[^/]+\/(?:start|finish-course)$/.test(path)) {
      tier = ok ? 'used' : 'tried';
    } else if (m === 'POST' && path === '/api/english/login') {
      tier = 'tried';
    }
  } else if (path === '/api/enrollment' || path.startsWith('/api/enrollment/')) {
    toolId = 'enrollment';
    if (m === 'POST' && (path === '/api/enrollment/runs' || path === '/api/enrollment/withdraw')) {
      tier = ok ? 'used' : 'tried';
    } else if (m === 'PUT' && path === '/api/enrollment/priority') {
      tier = 'tried';
    }
  }

  if (!toolId) return null;
  return {
    toolId,
    tier,
    actionLabel: describeApiAction(m, path).label
  };
}
