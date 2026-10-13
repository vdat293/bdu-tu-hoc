/**
 * BDU OPS Admin Dashboard - Standalone Site Logic
 */

// Application State
const state = {
  adminKey: sessionStorage.getItem('bdu_admin_key') || '',
  studentToken: sessionStorage.getItem('bdu_token') || localStorage.getItem('bdu_token') || '',
  adminLabel: sessionStorage.getItem('bdu_admin_label') || '',
  timeRange: '24h',
  autoRefreshMs: 15000,
  activeTab: 'overview',
  logFilters: {
    page: 1,
    limit: 50,
    search: '',
    status: 'all',
    method: 'all',
    route: '',
    mssv: ''
  },
  visitedFilters: {
    page: 1,
    limit: 25,
    search: '',
    filter: 'active',
    sortBy: 'last_login_at',
    sortDir: 'desc'
  },
  charts: {
    preview: null,
    detailed: null,
    cohort: null
  },
  // 4 khối phân tích của tab Insights. Mỗi endpoint được bọc .catch(() => null)
  // nên `null` ở đây có nghĩa "endpoint này lỗi" — khối tương ứng sẽ tự hiện
  // trạng thái lỗi thay vì im lặng (khác với `{}` là "chạy được nhưng rỗng").
  insights: {
    features: null,
    hours: null,
    cohort: null,
    quality: null,
    // `journey` do modal Hành trình (Task 10) ghi vào; khai trước để khớp hợp
    // đồng state.insights trong spec mục 7.1, không phải sửa lại cấu trúc sau.
    journey: null
  },
  refreshTimer: null,
  isPurging: false,
  rankingToggleBusy: false,
  rankingSync: null,
  rankingSyncMutationAt: 0,
  serviceLockBusy: false,
  serviceLock: null,
  serviceLockMutationAt: 0,
  serviceLockDirty: false
};

// DOM References
const dom = {
  sidebar: document.getElementById('admin-sidebar'),
  btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
  navButtons: document.querySelectorAll('.nav-btn'),
  tabPanes: document.querySelectorAll('.tab-pane'),
  pageTitle: document.getElementById('page-title'),
  timeRangeGroup: document.getElementById('time-range-group'),
  rangePills: document.querySelectorAll('.range-pill'),
  selectRefreshRate: document.getElementById('select-refresh-rate'),
  btnManualRefresh: document.getElementById('btn-manual-refresh'),
  btnThemeToggle: document.getElementById('btn-theme-toggle'),
  toastContainer: document.getElementById('admin-toast-container'),

  // Modals
  modalAuthGate: document.getElementById('modal-auth-gate'),
  formAdminAuth: document.getElementById('form-admin-auth'),
  inputAdminUser: document.getElementById('input-admin-user'),
  inputAdminPass: document.getElementById('input-admin-pass'),
  inputAdminKey: document.getElementById('input-admin-key'),
  authErrorMsg: document.getElementById('auth-error-msg'),
  btnCloseAuthModal: document.getElementById('btn-close-auth-modal'),
  btnOpenAuthModal: document.getElementById('btn-open-auth-modal'),
  displayAuthStatus: document.getElementById('display-auth-status'),

  modalLogDetail: document.getElementById('modal-log-detail'),
  modalLogTitle: document.getElementById('modal-log-title'),
  modalLogTime: document.getElementById('modal-log-time'),
  modalLogBody: document.getElementById('modal-log-body'),
  btnCloseLogModal: document.getElementById('btn-close-log-modal'),
  btnModalDismiss: document.getElementById('btn-modal-dismiss'),
  btnFilterThisStudent: document.getElementById('btn-filter-this-student'),

  modalPurgeLogs: document.getElementById('modal-purge-logs'),
  btnOpenPurgeModal: document.getElementById('btn-open-purge-modal'),
  btnClosePurgeModal: document.getElementById('btn-close-purge-modal'),
  btnCancelPurge: document.getElementById('btn-cancel-purge'),
  btnConfirmPurge: document.getElementById('btn-confirm-purge'),
  purgeAlertMsg: document.getElementById('purge-alert-msg'),

  // Student API activity modal
  modalStudentActivity: document.getElementById('modal-student-activity'),
  studentActivityTitle: document.getElementById('student-activity-title'),
  studentActivitySub: document.getElementById('student-activity-sub'),
  studentActivitySummary: document.getElementById('student-activity-summary'),
  studentActivityRoutes: document.getElementById('student-activity-routes'),
  studentActivityDevices: document.getElementById('student-activity-devices'),
  btnCloseStudentActivity: document.getElementById('btn-close-student-activity'),
  btnActivityDismiss: document.getElementById('btn-activity-dismiss'),
  btnActivityFilterLogs: document.getElementById('btn-activity-filter-logs'),

  // KPIs
  kpiTotalRequests: document.getElementById('kpi-total-requests'),
  kpiGrowth: document.getElementById('kpi-growth'),
  kpi2xx: document.getElementById('kpi-2xx'),
  kpi4xx: document.getElementById('kpi-4xx'),
  kpi5xx: document.getElementById('kpi-5xx'),
  kpiUniqueMssv: document.getElementById('kpi-unique-mssv'),
  kpiUniqueUsers: document.getElementById('kpi-unique-users'),
  kpiAvgLatency: document.getElementById('kpi-avg-latency'),
  kpiLatencyStatus: document.getElementById('kpi-latency-status'),
  kpiErrorRate: document.getElementById('kpi-error-rate'),
  kpiErrorStatus: document.getElementById('kpi-error-status'),

  // Previews
  chartTimelinePreview: document.getElementById('chart-timeline-preview'),
  chartTimelineDetailed: document.getElementById('chart-timeline-detailed'),
  devicesSummaryGrid: document.getElementById('devices-summary-grid'),
  osBrowserSummary: document.getElementById('os-browser-summary'),

  // Logs Elements
  inputLogSearch: document.getElementById('input-log-search'),
  btnClearSearch: document.getElementById('btn-clear-search'),
  statusFilterBtns: document.querySelectorAll('[data-status]'),
  methodFilterBtns: document.querySelectorAll('[data-method]'),
  selectLogRoute: document.getElementById('select-log-route'),
  activeMssvTagRow: document.getElementById('active-mssv-tag-row'),
  activeFilterMssv: document.getElementById('active-filter-mssv'),
  btnRemoveMssvFilter: document.getElementById('btn-remove-mssv-filter'),
  logsTableBody: document.getElementById('logs-table-body'),
  logsTotalCount: document.getElementById('logs-total-count'),
  badgeTotalLogs: document.getElementById('badge-total-logs'),
  paginationInfo: document.getElementById('pagination-info'),
  btnPagePrev: document.getElementById('btn-page-prev'),
  btnPageNext: document.getElementById('btn-page-next'),
  selectLogLimit: document.getElementById('select-log-limit'),

  // Visited Students Elements (Bảng students trên VPS)
  badgeActiveStudents: document.getElementById('badge-active-students'),
  kpiVisitedActive: document.getElementById('kpi-visited-active'),
  kpiVisitedToday: document.getElementById('kpi-visited-today'),
  kpiVisited7Days: document.getElementById('kpi-visited-7days'),
  kpiVisitedTotal: document.getElementById('kpi-visited-total'),
  visitedTableBody: document.getElementById('visited-students-table-body'),
  inputVisitedSearch: document.getElementById('input-visited-search'),
  selectVisitedFilter: document.getElementById('select-visited-filter'),
  selectVisitedSort: document.getElementById('select-visited-sort'),
  btnRefreshVisited: document.getElementById('btn-refresh-visited'),
  visitedPaginationInfo: document.getElementById('visited-pagination-info'),
  visitedPageCurrent: document.getElementById('visited-page-current'),
  btnVisitedPrev: document.getElementById('btn-visited-prev'),
  btnVisitedNext: document.getElementById('btn-visited-next'),

  // System Elements
  sysUptime: document.getElementById('sys-uptime'),
  sysPlatform: document.getElementById('sys-platform'),
  sysRam: document.getElementById('sys-ram'),
  sysHeap: document.getElementById('sys-heap'),
  sysWs: document.getElementById('sys-ws'),
  sysRooms: document.getElementById('sys-rooms'),
  sysDbLogs: document.getElementById('sys-db-logs'),
  sysBuffer: document.getElementById('sys-buffer'),

  // Ranking sync toggle
  rankingSyncToggle: document.getElementById('ranking-sync-toggle'),
  rankingSyncState: document.getElementById('ranking-sync-state'),
  rankingSyncStateSub: document.getElementById('ranking-sync-state-sub'),
  rankingSyncLast: document.getElementById('ranking-sync-last'),
  rankingSyncLastSub: document.getElementById('ranking-sync-last-sub'),
  rankingSyncNext: document.getElementById('ranking-sync-next'),
  rankingSyncNextSub: document.getElementById('ranking-sync-next-sub'),

  // Service lock toggle (tab System)
  serviceLockToggle: document.getElementById('service-lock-toggle'),
  serviceLockState: document.getElementById('service-lock-state'),
  serviceLockStateSub: document.getElementById('service-lock-state-sub'),
  serviceLockUpdated: document.getElementById('service-lock-updated'),
  serviceLockUpdatedSub: document.getElementById('service-lock-updated-sub'),
  serviceLockTitle: document.getElementById('service-lock-title'),
  serviceLockMessage: document.getElementById('service-lock-message')
};

let currentSelectedLog = null;
let currentActivityMssv = '';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cssToken(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'unknown';
}

/**
 * Ép về số hữu hạn, NaN/undefined/null → 0.
 * Mọi số từ API vào đều phải đi qua đây trước khi định dạng, nếu không
 * toLocaleString/toFixed sẽ in ra "NaN" thành chữ trên bảng.
 */
function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/* ==========================================================================
   BỘ ICON SVG DÙNG CHUNG (thay emoji)
   --------------------------------------------------------------------------
   Vì sao bỏ emoji: emoji bị render khác nhau trên Windows/macOS/Linux, không
   đổi được màu theo theme, và bị coi là chữ nên dễ vỡ cỡ chữ trên hàng bảng
   dày. Inline SVG 24×24 với stroke="currentColor" thì ăn theo màu chữ của
   thành phần đang chứa nó, sắc nét ở mọi kích thước, và không cần thêm
   dependency ngoài Chart.js đã có.
   Mỗi icon KHÔNG có sẵn class; renderIcon() sẽ chèn class để đổi cỡ.
   ========================================================================== */
const ICONS = {
  crown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"></path><path d="M5 20h14"></path></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1"></rect><rect x="14" y="3" width="7" height="5" rx="1"></rect><rect x="14" y="12" width="7" height="9" rx="1"></rect><rect x="3" y="16" width="7" height="5" rx="1"></rect></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline><polyline points="16 7 22 7 22 13"></polyline></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
  server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="8" rx="2"></rect><rect x="2" y="14" width="20" height="8" rx="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>',
  insights: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"></path></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l2 2"></path><path d="M5 3 3 5"></path><path d="M19 3l2 2"></path></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="M9 12l2 2 4-4"></path></svg>',
  gauge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 14l4-4"></path><path d="M3.5 18a9 9 0 1 1 17 0"></path><circle cx="12" cy="14" r="1.5"></circle></svg>',
  route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="3"></circle><circle cx="18" cy="5" r="3"></circle><path d="M9 19h6a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6"></path></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>',
  education: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10 12 5 2 10l10 5 10-5z"></path><path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5"></path></svg>',
  filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>',
  arrowUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>',
  arrowDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
  emptyBox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8v13H3V8"></path><path d="M1 3h22v5H1z"></path><line x1="10" y1="12" x2="14" y2="12"></line></svg>',
  smartphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>',
  tablet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>',
  monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>',
  bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="8.5" cy="16" r="1"></circle><circle cx="15.5" cy="16" r="1"></circle><path d="M12 8V4"></path><circle cx="12" cy="3" r="1"></circle></svg>'
};

/**
 * Trả về chuỗi SVG kèm class CSS. Nội dung ICONS là chuỗi cố định do mình viết
 * (không chứa dữ liệu người dùng) nên chèn trực tiếp được; mọi dữ liệu động
 * vẫn tiếp tục đi qua escapeHtml.
 */
function renderIcon(name, className = 'svg-icon') {
  const svg = ICONS[name];
  if (!svg) return '';
  return svg.replace('<svg ', `<svg class="${className}" `);
}

/* ==========================================================================
   HELPER ĐỊNH DẠNG DÙNG CHUNG (spec mục 4.1: định dạng số thống nhất)
   Phân cách nghìn, phần trăm 1-2 chữ số, thời lượng bằng ms, thời gian
   dd/mm HH:mm. Dùng chung cho mọi tab để cùng một số hiện ra cùng một kiểu.
   ========================================================================== */

/** Số có phân cách nghìn. */
function formatNumber(value, fractionDigits = 0) {
  const number = safeNumber(value);
  return number.toLocaleString('vi-VN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  });
}

/** Phần trăm, mặc định 1 chữ số thập phân (spec: 1-2 chữ số). */
function formatPercent(value, fractionDigits = 1) {
  return `${formatNumber(value, fractionDigits)}%`;
}

/** Thời lượng: ms khi ngắn, giây ở tầng dưới 1 phút, phút khi dài hơn. */
function formatDurationMs(value) {
  const ms = safeNumber(value);
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) {
    const seconds = ms / 1000;
    return `${formatNumber(seconds, seconds < 10 ? 2 : 1)} s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes} phút ${seconds} s`;
}

/** Thời gian chuẩn dd/mm HH:mm (giờ địa phương của trình duyệt). */
function formatDateTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ==========================================================================
   TRẠNG THÁI KHÔNG DỮ LIỆU DÙNG CHUNG (spec mục 4.1)
   Mọi khối dữ liệu phải có đủ 3 trạng thái: đang tải (skeleton), rỗng (lời
   nhắc) và lỗi (kèm nút thử lại) — KHÔNG để khoảng trắng hoặc lỗi câm.
   Các helper nhận id, selector hoặc element để dùng được ở mọi tab.
   ========================================================================== */

/** Chấp nhận "#id", ".class", "id" thuần hoặc sẵn là element. */
function resolveElement(target) {
  if (!target) return null;
  if (typeof target !== 'string') return target;
  const key = target.trim();
  if (key.startsWith('#') || key.startsWith('.')) return document.querySelector(key);
  return document.getElementById(key);
}

/**
 * Trạng thái "đang tải": vạch xám nhấp nháy, giữ chiều cao tối thiểu để nội
 * dung thật thay thế không làm nhảy bố cục.
 */
function renderSkeleton(target, rows = 3) {
  const el = resolveElement(target);
  if (!el) return;
  const safeRows = Math.min(6, Math.max(1, safeNumber(rows) || 3));
  el.innerHTML = `
    <div class="state-block stack-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span class="sr-only">Đang tải dữ liệu...</span>
      ${Array.from({ length: safeRows }, () => '<div class="skeleton-row"><span class="skeleton-bar"></span></div>').join('')}
    </div>
  `;
}

/** Trạng thái "rỗng": nói rõ lý do và (nếu có) gợi ý bước tiếp theo. */
function renderEmpty(target, message = 'Chưa có dữ liệu trong khoảng thời gian này.', options = {}) {
  const el = resolveElement(target);
  if (!el) return;
  el.innerHTML = `
    <div class="state-block state-empty">
      <span class="state-icon" aria-hidden="true">${renderIcon('emptyBox', 'svg-icon svg-icon--lg')}</span>
      <p class="state-title">${escapeHtml(options.title || 'Không có dữ liệu')}</p>
      <p class="state-message">${escapeHtml(message)}</p>
      ${options.hint ? `<p class="state-hint">${escapeHtml(options.hint)}</p>` : ''}
    </div>
  `;
}

/**
 * Trạng thái "lỗi": hiện nguyên nhân và nút thử lại (mặc định nạp lại toàn bộ
 * dashboard). role="alert" để trình đọc màn hình đọc được lỗi, thay vì chỉ báo
 * bằng màu đỏ.
 */
function renderError(target, message = 'Không tải được dữ liệu.', options = {}) {
  const el = resolveElement(target);
  if (!el) return;
  const retry = typeof options.onRetry === 'function' ? options.onRetry : () => fetchAllData();
  el.innerHTML = `
    <div class="state-block state-error" role="alert">
      <span class="state-icon" aria-hidden="true">${renderIcon('alert', 'svg-icon svg-icon--lg')}</span>
      <p class="state-title">${escapeHtml(options.title || 'Không tải được dữ liệu')}</p>
      <p class="state-message">${escapeHtml(message)}</p>
      <button type="button" class="btn-retry">
        ${renderIcon('refresh', 'svg-icon svg-icon--sm')}<span>Thử lại</span>
      </button>
    </div>
  `;
  const retryBtn = el.querySelector('.btn-retry');
  if (retryBtn) retryBtn.addEventListener('click', retry);
}

/* ==========================================================================
   THEME — mặc định SÁNG
   Vì sao fallback là 'light': /admin phải mở ra ở theme sáng. Nếu thuộc tính
   data-theme rỗng hoặc bị xoá thì vẫn về sáng chứ không nhào về tối.
   ========================================================================== */
const DEFAULT_THEME = 'light';

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
}

function renderThemeToggleIcon(theme) {
  if (!dom.btnThemeToggle) return;
  dom.btnThemeToggle.innerHTML = renderIcon(theme === 'dark' ? 'sun' : 'moon');
  dom.btnThemeToggle.setAttribute(
    'aria-label',
    theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'
  );
}

// Notification Toast
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'admin-toast';
  if (type === 'error') toast.style.borderColor = '#ef4444';
  if (type === 'success') toast.style.borderColor = '#10b981';
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// HTTP API Fetch Helper
async function api(path, options = {}) {
  const headers = {
    'Accept': 'application/json',
    ...(options.headers || {})
  };

  if (state.adminKey) {
    headers['x-admin-key'] = state.adminKey;
  }
  if (state.studentToken) {
    headers['Authorization'] = `Bearer ${state.studentToken}`;
  }

  const res = await fetch(path, { ...options, headers });
  
  if (res.status === 401 || res.status === 403) {
    openAuthModal();
    throw new Error('Yêu cầu xác thực khóa quản trị viên.');
  }

  const json = await res.json();
  if (!json.result && json.message) {
    throw new Error(json.message);
  }
  return json.data;
}

// Authentication Modal
function openAuthModal() {
  dom.modalAuthGate.style.display = 'flex';
  if (dom.inputAdminUser) dom.inputAdminUser.focus();
}

function closeAuthModal() {
  dom.modalAuthGate.style.display = 'none';
  dom.authErrorMsg.style.display = 'none';
}

function clearAuthForm() {
  if (dom.inputAdminPass) dom.inputAdminPass.value = '';
  if (dom.inputAdminKey) dom.inputAdminKey.value = '';
}

dom.formAdminAuth.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = dom.inputAdminUser?.value.trim() || '';
  const password = dom.inputAdminPass?.value || '';
  const key = dom.inputAdminKey?.value.trim() || '';

  if (!key && (!username || !password)) {
    dom.authErrorMsg.textContent = 'Nhập MSSV + mật khẩu BDU, hoặc mã khóa kỹ thuật.';
    dom.authErrorMsg.style.display = 'block';
    return;
  }

  try {
    dom.authErrorMsg.style.display = 'none';
    const payload = key ? { key } : { username, password };
    const loginRes = await fetch('/api/admin/dashboard/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const resJson = await loginRes.json();
    if (!resJson.result) {
      throw new Error(resJson.message || 'Đăng nhập quản trị thất bại.');
    }

    if (resJson.token) {
      state.studentToken = resJson.token;
      state.adminKey = '';
      sessionStorage.setItem('bdu_token', resJson.token);
      sessionStorage.removeItem('bdu_admin_key');
    } else {
      state.adminKey = key;
      state.studentToken = '';
      sessionStorage.setItem('bdu_admin_key', key);
      sessionStorage.removeItem('bdu_token');
    }
    state.adminLabel = resJson.name || resJson.mssv || 'Quản trị viên';
    sessionStorage.setItem('bdu_admin_label', state.adminLabel);
    if (resJson.mssv) sessionStorage.setItem('bdu_admin_mssv', resJson.mssv);
    else sessionStorage.removeItem('bdu_admin_mssv');

    await fetchAllData();
    fetchRoutes();
    closeAuthModal();
    clearAuthForm();
    updateAuthDisplay();
    showToast(`Đã xác thực quản trị viên (${state.adminLabel}) thành công!`, 'success');
  } catch (err) {
    dom.authErrorMsg.textContent = err.message || 'Đăng nhập quản trị thất bại.';
    dom.authErrorMsg.style.display = 'block';
  }
});

dom.btnOpenAuthModal.addEventListener('click', () => {
  dom.btnCloseAuthModal.style.display = 'block';
  clearAuthForm();
  if (dom.inputAdminUser && !dom.inputAdminUser.value) {
    dom.inputAdminUser.value = sessionStorage.getItem('bdu_admin_mssv') || '';
  }
  openAuthModal();
});

dom.btnCloseAuthModal.addEventListener('click', closeAuthModal);

function updateAuthDisplay() {
  if (state.adminKey || state.studentToken) {
    // Icon vương miện là SVG nên phải chèn bằng innerHTML chứ không dùng textContent.
    dom.displayAuthStatus.innerHTML = `${renderIcon('crown', 'svg-icon svg-icon--sm')}<span>${escapeHtml(state.adminLabel || 'Quản trị viên')}</span>`;
  } else {
    dom.displayAuthStatus.textContent = 'Chưa xác thực';
  }
}

// Tab Switching
const tabTitles = {
  overview: 'Tổng Quan Lưu Lượng',
  charts: 'Biểu Đồ & Xu Hướng',
  insights: 'Phân Tích Hành Vi Người Dùng',
  logs: 'Nhật Ký Truy Cập Chi Tiết',
  users: 'Sinh Viên Hoạt Động Tích Cực',
  system: 'Sức Khỏe VPS & Hệ Thống'
};

dom.navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetTab = btn.getAttribute('data-tab');
    switchTab(targetTab);
  });
});

function switchTab(tabId) {
  state.activeTab = tabId;
  dom.navButtons.forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === tabId));
  dom.tabPanes.forEach((p) => p.classList.toggle('active', p.id === `pane-${tabId}`));
  dom.pageTitle.textContent = tabTitles[tabId] || 'Admin Dashboard';

  // If mobile, close sidebar
  if (window.innerWidth <= 900) {
    dom.sidebar.classList.remove('open');
  }

  // Load tab-specific data if needed
  if (tabId === 'charts') {
    renderDetailedChart();
  }
}

// Time Range Controls
dom.rangePills.forEach((pill) => {
  pill.addEventListener('click', () => {
    dom.rangePills.forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    state.timeRange = pill.getAttribute('data-range');
    state.logFilters.page = 1;
    fetchAllData();
    fetchRoutes();
  });
});

// Auto-Refresh
dom.selectRefreshRate.addEventListener('change', (e) => {
  state.autoRefreshMs = Number(e.target.value);
  startAutoRefresh();
});

function startAutoRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  if (state.autoRefreshMs > 0) {
    state.refreshTimer = setInterval(() => {
      fetchAllData(true);
    }, state.autoRefreshMs);
  }
}

dom.btnManualRefresh.addEventListener('click', () => {
  fetchAllData();
  fetchRoutes();
  showToast('Đã làm mới dữ liệu!', 'info');
});

// Sidebar Toggle Mobile
dom.btnToggleSidebar.addEventListener('click', () => {
  dom.sidebar.classList.toggle('open');
});

// Theme Toggle
dom.btnThemeToggle.addEventListener('click', () => {
  const current = currentTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  renderThemeToggleIcon(next);
  // Re-render charts with new theme colors
  if (state.charts.preview) state.charts.preview.update();
  if (state.charts.detailed) state.charts.detailed.update();
  // Biểu đồ cohort vẽ lại từ dữ liệu đang có: Chart.js đọc màu lúc vẽ nên
  // update() không đổi được màu trục/nhãn sang bảng màu của theme mới.
  if (state.insights && state.insights.cohort) renderCohort(state.insights.cohort);
});

// Data Fetching & Rendering
async function fetchAllData(isBackground = false) {
  try {
    const rankingSyncRequestedAt = Date.now();
    const serviceLockRequestedAt = Date.now();
    // Preview "top tính năng" của Tổng quan ưu tiên dữ liệu xếp hạng tính năng
    // (đã gom + có nhãn). Danh sách endpoint thô vẫn lấy song song để làm đường
    // hạ cấp: nếu riêng truy vấn xếp hạng lỗi (p95/delta nặng hơn) thì khối vẫn
    // có gì đó để hiện thay vì trắng trơn.
    const [overview, timeline, endpoints, devices, logsData, visitedData, system, rankingSync, serviceLock, insightFeatures, insightHours, insightCohort, insightQuality] = await Promise.all([
      api(`/api/admin/dashboard/overview?timeRange=${state.timeRange}`),
      api(`/api/admin/dashboard/timeline?timeRange=${state.timeRange}`),
      api(`/api/admin/dashboard/endpoints?timeRange=${state.timeRange}&limit=10`),
      api(`/api/admin/dashboard/devices?timeRange=${state.timeRange}`),
      api(`/api/admin/dashboard/logs?timeRange=${state.timeRange}&page=${state.logFilters.page}&limit=${state.logFilters.limit}&status=${state.logFilters.status}&method=${state.logFilters.method}&route=${encodeURIComponent(state.logFilters.route)}&search=${encodeURIComponent(state.logFilters.search)}&mssv=${encodeURIComponent(state.logFilters.mssv)}`),
      api(`/api/admin/dashboard/visited-students?page=${state.visitedFilters.page}&limit=${state.visitedFilters.limit}&filter=${state.visitedFilters.filter}&sortBy=${state.visitedFilters.sortBy}&sortDir=${state.visitedFilters.sortDir}&search=${encodeURIComponent(state.visitedFilters.search)}`),
      api(`/api/admin/dashboard/system`),
      api(`/api/admin/dashboard/ranking-sync`).catch(() => null),
      api(`/api/admin/dashboard/service-lock`).catch(() => null),
      // 4 endpoint phân tích (Task 6). Mỗi cái bọc .catch(() => null) để MỘT
      // endpoint lỗi — ví dụ truy vấn p95 quá nặng bị timeout — KHÔNG làm hỏng
      // cả dashboard; khối tương ứng tự hiện trạng thái lỗi, các khối khác vẫn vẽ.
      api(`/api/admin/dashboard/insights/features?timeRange=${state.timeRange}`).catch(() => null),
      api(`/api/admin/dashboard/insights/hours?timeRange=${state.timeRange}`).catch(() => null),
      api(`/api/admin/dashboard/insights/cohort?timeRange=${state.timeRange}`).catch(() => null),
      api(`/api/admin/dashboard/insights/quality?timeRange=${state.timeRange}`).catch(() => null)
    ]);

    renderOverview(overview);
    renderTimelineChart(timeline);
    renderOverviewFeaturePreview(insightFeatures, endpoints);
    renderDevices(devices);
    renderLogs(logsData);
    renderVisitedStudents(visitedData);
    renderSystem(system);
    renderRankingSync(rankingSync, rankingSyncRequestedAt);
    renderServiceLock(serviceLock, serviceLockRequestedAt);
    state.insights = {
      ...state.insights,
      features: insightFeatures,
      hours: insightHours,
      cohort: insightCohort,
      quality: insightQuality
    };
    renderInsights();
  } catch (err) {
    if (!isBackground) {
      console.error('[Admin] Lỗi nạp dữ liệu:', err.message);
      // Không để Tổng quan lỗi câm: hai khối bạn nhìn thấy ngay (biểu đồ và
      // preview) phải nói rõ hỏng và cho nút thử lại. Các khối dữ liệu độc lập
      // khác (Insights/logs) tự bọc .catch nên vẫn tự lo trạng thái của chúng.
      renderError('#overview-timeline-state', 'Không tải được biểu đồ lưu lượng.', { title: 'Lỗi biểu đồ lưu lượng' });
      renderError('#endpoints-list-preview', 'Không tải được xếp hạng tính năng.', { title: 'Lỗi xếp hạng tính năng' });
    }
  }
}

// 1. Render Overview KPIs
function renderOverview(data = {}) {
  const total = data.totalRequests || 0;
  const growth = data.requestGrowth || 0;
  const uniqueMssv = data.uniqueMssv || 0;
  const uniqueUsers = data.uniqueUsers || 0;
  const avgLatency = data.avgResponseTime || 0;
  const errorRate = data.errorRate || 0;
  const status = data.statusBreakdown || {};

  // Mọi số đi qua helper định dạng chung (spec mục 4.1) để Tổng quan và các tab
  // khác hiện cùng một kiểu: phân cách nghìn, phần trăm 1 chữ số thập phân.
  dom.kpiTotalRequests.textContent = formatNumber(total);

  if (growth > 0) {
    dom.kpiGrowth.textContent = `▲ +${formatPercent(growth)}`;
    dom.kpiGrowth.className = 'kpi-growth trend-up';
  } else if (growth < 0) {
    dom.kpiGrowth.textContent = `▼ ${formatPercent(growth)}`;
    dom.kpiGrowth.className = 'kpi-growth trend-down';
  } else {
    dom.kpiGrowth.textContent = '■ 0%';
    dom.kpiGrowth.className = 'kpi-growth trend-neutral';
  }

  dom.kpi2xx.textContent = `2xx: ${formatNumber(status['2xx'])}`;
  dom.kpi4xx.textContent = `4xx: ${formatNumber(status['4xx'])}`;
  dom.kpi5xx.textContent = `5xx: ${formatNumber(status['5xx'])}`;

  dom.kpiUniqueMssv.textContent = formatNumber(uniqueMssv);
  dom.kpiUniqueUsers.textContent = `${formatNumber(uniqueUsers)} phiên`;

  dom.kpiAvgLatency.textContent = `${formatNumber(avgLatency)} ms`;
  if (avgLatency < 150) {
    dom.kpiLatencyStatus.textContent = '● Tuyệt vời (<150ms)';
    dom.kpiLatencyStatus.className = 'latency-indicator latency-good';
  } else if (avgLatency < 400) {
    dom.kpiLatencyStatus.textContent = '● Bình thường (<400ms)';
    dom.kpiLatencyStatus.className = 'latency-indicator latency-moderate';
  } else {
    dom.kpiLatencyStatus.textContent = '● Cần tối ưu (>400ms)';
    dom.kpiLatencyStatus.className = 'latency-indicator latency-slow';
  }

  dom.kpiErrorRate.textContent = formatPercent(errorRate);
  if (errorRate <= 2) {
    dom.kpiErrorStatus.textContent = 'Hệ thống ổn định';
    dom.kpiErrorStatus.className = 'error-status-badge trend-up';
  } else if (errorRate <= 5) {
    dom.kpiErrorStatus.textContent = 'Cảnh báo lỗi tăng';
    dom.kpiErrorStatus.className = 'error-status-badge trend-warning';
  } else {
    dom.kpiErrorStatus.textContent = 'Lỗi cao (>5%)';
    dom.kpiErrorStatus.className = 'error-status-badge trend-down';
  }
}

// 2. Render Timeline Charts
let cachedTimeline = [];
function renderTimelineChart(timeline = []) {
  cachedTimeline = timeline;

  // Biểu đồ Chart.js không tự nói được "không có dữ liệu": với mảng rỗng nó chỉ
  // vẽ ra khung trống. Nên thông báo rỗng đặt ở #overview-timeline-state (dưới
  // canvas, không đè lên) để khối không bao giờ im lặng.
  const overviewTimelineState = resolveElement('#overview-timeline-state');
  if (overviewTimelineState) {
    if (timeline.length) {
      overviewTimelineState.innerHTML = '';
    } else {
      renderEmpty(overviewTimelineState, 'Chưa có lưu lượng trong mốc thời gian đang chọn.', {
        hint: 'Đổi mốc thời gian ở thanh trên (ví dụ 7D) hoặc chờ thêm dữ liệu.'
      });
    }
  }

  if (typeof Chart === 'undefined') {
    // Chart.js không nạp được (file thiếu/bị chặn): để khối vẽ trống 300px là lỗi
    // câm. Báo rõ ở đúng khối trạng thái của biểu đồ Tổng quan.
    renderError('#overview-timeline-state', 'Không tải được Chart.js.');
    return;
  }

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#94a3b8' : '#475569';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)';

  const labels = timeline.map((item) => {
    const d = new Date(item.time);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) +
      (timeline.length > 24 ? ` (${d.getDate()}/${d.getMonth() + 1})` : '');
  });

  const totals = timeline.map((i) => i.total);
  const errors = timeline.map((i) => i.error);
  const latencies = timeline.map((i) => i.avgLatency);

  const chartData = {
    labels,
    datasets: [
      {
        label: 'Tổng Yêu Cầu',
        data: totals,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.12)',
        fill: true,
        tension: 0.35,
        yAxisID: 'yReq',
        pointRadius: timeline.length > 24 ? 2 : 4
      },
      {
        label: 'Yêu Cầu Lỗi (4xx/5xx)',
        data: errors,
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.15)',
        fill: true,
        tension: 0.35,
        yAxisID: 'yReq',
        pointRadius: timeline.length > 24 ? 2 : 4
      },
      {
        label: 'Độ Trễ TB (ms)',
        data: latencies,
        borderColor: '#10b981',
        borderDash: [3, 3],
        backgroundColor: 'transparent',
        tension: 0.2,
        yAxisID: 'yLat',
        pointRadius: 2
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top',
        labels: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
      }
    },
    scales: {
      x: { ticks: { color: textColor, maxTicksLimit: 12 }, grid: { color: gridColor } },
      yReq: { position: 'left', beginAtZero: true, ticks: { color: textColor, precision: 0 }, grid: { color: gridColor } },
      yLat: { position: 'right', beginAtZero: true, ticks: { color: textColor, callback: (v) => `${v}ms` }, grid: { drawOnChartArea: false } }
    }
  };

  // Preview Chart
  if (state.charts.preview) {
    state.charts.preview.data = chartData;
    state.charts.preview.options = chartOptions;
    state.charts.preview.update();
  } else if (dom.chartTimelinePreview) {
    state.charts.preview = new Chart(dom.chartTimelinePreview, {
      type: 'line',
      data: chartData,
      options: chartOptions
    });
  }
}

function renderDetailedChart() {
  if (typeof Chart === 'undefined' || !dom.chartTimelineDetailed || cachedTimeline.length === 0) return;
  if (state.charts.detailed) {
    state.charts.detailed.update();
    return;
  }

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#94a3b8' : '#475569';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)';

  const labels = cachedTimeline.map((item) => {
    const d = new Date(item.time);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ` (${d.getDate()}/${d.getMonth() + 1})`;
  });

  state.charts.detailed = new Chart(dom.chartTimelineDetailed, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Tổng Yêu Cầu',
          data: cachedTimeline.map((i) => i.total),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.15)',
          fill: true,
          tension: 0.35,
          yAxisID: 'yReq'
        },
        {
          label: 'Phản Hồi Lỗi',
          data: cachedTimeline.map((i) => i.error),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.15)',
          fill: true,
          tension: 0.35,
          yAxisID: 'yReq'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        yReq: { ticks: { color: textColor }, grid: { color: gridColor } }
      }
    }
  });
}

// 3. Trạng thái "đang tải" của tab Tổng quan
// Vì sao cần: trước đây ô KPI/preview đứng "--" và biểu đồ trống trơn lúc mở
// trang, người dùng không biết là đang tải hay đã hỏng. Skeleton giữ chiều cao
// sẵn nên nội dung thật thay vào không làm nhảy bố cục.
function renderOverviewSkeleton() {
  renderSkeleton('#endpoints-list-preview', 5);
  renderSkeleton('#overview-timeline-state', 3);
}

// 3.1. Preview "top tính năng" của Tổng quan.
// TÁI DÙNG renderFeatureRanking ở chế độ compact (top 5) thay vì dựng renderer
// riêng: cùng nguồn dữ liệu và cùng cách đọc số với tab Phân Tích Hành Vi, nên
// hai nơi không thể lệch nhau.
// Hạ cấp (features lỗi nhưng endpoints còn): hiện danh sách endpoint thô để khối
// không trắng — lỗi thật vẫn hiện nút "Thử lại" khi cả hai đều không có.
function renderOverviewFeaturePreview(features, endpoints = []) {
  if (features) {
    renderFeatureRanking(features, '#endpoints-list-preview', { limit: 5, compact: true });
  } else if (Array.isArray(endpoints) && endpoints.length) {
    // Hạ cấp: dữ liệu vẫn là TUYẾN ĐƯỜNG thô, không phải xếp hạng tính năng, nên
    // phải nói rõ để người dùng không đọc nhầm loại dữ liệu theo tiêu đề khối.
    renderEndpoints(endpoints, {
      note: 'Tạm thời hiển thị top tuyến đường thay cho xếp hạng tính năng (xếp hạng chưa tải được).'
    });
  } else {
    renderError('#endpoints-list-preview', 'Không tải được xếp hạng tính năng.', { title: 'Lỗi xếp hạng tính năng' });
  }
}

// 3.2. Danh sách tuyến đường/API thô — đường hạ cấp của preview Tổng quan.
// `options.note` (nếu có) chèn một dòng chú thích ngay trên danh sách để nói rõ
// đây KHÔNG phải xếp hạng tính năng.
function renderEndpoints(endpoints = [], options = {}) {
  const el = resolveElement('#endpoints-list-preview');
  if (!el) return;
  const noteHtml = options.note
    ? `<p class="card-subtitle">${escapeHtml(options.note)}</p>`
    : '';
  if (!endpoints.length) {
    el.innerHTML = `${noteHtml}<div class="text-center-muted">Chưa có dữ liệu API</div>`;
    return;
  }

  const maxCount = Math.max(...endpoints.map((e) => safeNumber(e.count)), 1);
  el.innerHTML = noteHtml + endpoints.slice(0, 7).map((ep) => {
    const count = safeNumber(ep.count);
    const pct = Math.min(100, Math.round((count / maxCount) * 100));
    const method = String(ep.method || '').toUpperCase();
    const methodCls = `method-${cssToken(method)}`;
    return `
      <div class="endpoint-row">
        <div class="endpoint-head">
          <span class="method-tag ${methodCls}">${escapeHtml(method)}</span>
          <span class="endpoint-path" title="${escapeHtml(ep.path)}">${escapeHtml(ep.path)}</span>
          <span class="endpoint-count">${formatNumber(count)} req</span>
        </div>
        <div class="endpoint-bar">
          <div class="endpoint-progress" style="width: ${pct}%"></div>
        </div>
        <div class="endpoint-foot">
          <span>Độ trễ TB ${formatNumber(ep.avgLatency)} ms</span>
          ${safeNumber(ep.errorCount) > 0 ? `<span class="err">${formatNumber(ep.errorCount)} lỗi</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// 4. Render Devices & Platforms
function renderDevices(data = {}) {
  const devices = data.devices || [];
  const os = data.os || [];
  const browsers = data.browsers || [];

  if (dom.devicesSummaryGrid) {
    dom.devicesSummaryGrid.innerHTML = devices.map((d) => {
      const name = String(d.name || '');
      const icon = name === 'mobile' ? '📱' : name === 'tablet' ? '📟' : name === 'bot' ? '🤖' : '💻';
      const label = name === 'mobile' ? 'Mobile' : name === 'tablet' ? 'Tablet' : name === 'bot' ? 'Bot' : 'Desktop';
      return `
        <div class="device-card">
          <span class="icon">${icon}</span>
          <span class="name">${label}</span>
          <span class="val">${safeNumber(d.count).toLocaleString()}</span>
        </div>
      `;
    }).join('');
  }

  if (dom.osBrowserSummary) {
    dom.osBrowserSummary.innerHTML = `
      <div class="breakdown-group">
        <div class="breakdown-group-title">Hệ Điều Hành</div>
        <div class="pills-wrap">
          ${os.map((o) => `<div class="breakdown-chip"><span>${escapeHtml(o.name)}</span><span class="chip-val">${safeNumber(o.count)}</span></div>`).join('')}
        </div>
      </div>
      <div class="breakdown-group" style="margin-top: 10px;">
        <div class="breakdown-group-title">Trình Duyệt</div>
        <div class="pills-wrap">
          ${browsers.map((b) => `<div class="breakdown-chip"><span>${escapeHtml(b.name)}</span><span class="chip-val">${safeNumber(b.count)}</span></div>`).join('')}
        </div>
      </div>
    `;
  }
}

/* ==========================================================================
   TAB INSIGHTS (Task 6) — 4 khối, 4 câu hỏi khác nhau
   --------------------------------------------------------------------------
   Vì sao vẽ tách khỏi phần còn lại: các endpoint phân tích nặng hơn hẳn phần
   giám sát và mỗi cái đã được bọc .catch() nên phải vẽ độc lập — một khối lỗi
   không được làm trắng tab.
   Mọi khối đều có đủ 3 trạng thái chuẩn: renderSkeleton (đang tải), renderEmpty
   (rỗng) và renderError (lỗi) — không để khoảng trắng hay lỗi câm.
   ========================================================================== */

/** Nhãn 7 thứ; khớp với `weekdays` server trả về (Thứ 2 = 0). */
const HEATMAP_WEEKDAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];

/**
 * Số rút gọn để in trong ô heatmap: ô chỉ rộng khoảng 28px nên bốn chữ số sẽ
 * tràn và phá lưới. Số đầy đủ vẫn có ở `title` của ô và ở bảng số dự phòng —
 * đây chỉ là lớp hiển thị thứ hai, không phải nơi đọc giá trị chính.
 */
function compactCount(value) {
  const count = safeNumber(value);
  if (count < 1000) return formatNumber(count);
  if (count < 1000000) return `${formatNumber(count / 1000, 1)}k`;
  return `${formatNumber(count / 1000000, 1)}tr`;
}

/** Trạng thái "đang tải" cho 4 khối Insights, gọi một lần lúc mở trang. */
function renderInsightsSkeleton() {
  renderSkeleton('#feature-ranking', 5);
  renderSkeleton('#hours-heatmap', 4);
  renderSkeleton('#hours-heatmap-table', 1);
  renderSkeleton('#cohort-chart', 4);
  renderSkeleton('#quality-table', 4);
}

/** Vẽ cả 4 khối từ state.insights; khối nào không có dữ liệu thì báo riêng. */
function renderInsights() {
  const { features, hours, cohort, quality } = state.insights;

  if (features) {
    renderFeatureRanking(features);
  } else {
    renderError('#feature-ranking', 'Không tải được xếp hạng tính năng.', { title: 'Lỗi xếp hạng tính năng' });
  }

  if (hours) {
    renderHoursHeatmap(hours);
  } else {
    renderError('#hours-heatmap', 'Không tải được nhiệt đồ khung giờ.', { title: 'Lỗi nhiệt đồ khung giờ' });
    renderError('#hours-heatmap-table', 'Không tải được bảng số theo khung giờ.');
  }

  if (cohort) {
    renderCohort(cohort);
  } else {
    destroyCohortChart();
    renderError('#cohort-chart', 'Không tải được dữ liệu người dùng quay lại.', { title: 'Lỗi dữ liệu quay lại' });
  }

  if (quality) {
    renderQuality(quality);
  } else {
    renderError('#quality-table', 'Không tải được số liệu chất lượng dịch vụ.', { title: 'Lỗi số liệu chất lượng' });
  }
}

/**
 * Khối 1 — "Sinh viên dùng tính năng nào nhiều nhất?".
 * Vì sao bảng chứ không phải biểu đồ tròn: cần so sánh CHÍNH XÁC giữa các nhóm
 * và đọc kèm số người dùng/tỷ lệ lỗi; tròn cắt mất chiều thứ ba.
 */
function renderFeatureRanking(data = {}, target = '#feature-ranking', options = {}) {
  const el = resolveElement(target);
  if (!el) return;
  const items = Array.isArray(data.items) ? data.items : [];
  const totalRequests = safeNumber(data.totalRequests);
  if (!items.length && totalRequests <= 0) {
    renderEmpty(el, 'Chưa có lượt truy cập nào trong mốc thời gian đang chọn.', {
      hint: 'Đổi mốc thời gian ở thanh trên (ví dụ 7D) hoặc chờ thêm dữ liệu.'
    });
    return;
  }

  // Tổng quan chỉ cần "top N" gọn trong panel hẹp; tab Insights cần bảng đầy
  // đủ. Hai chế độ dùng CHUNG một hàm để cách đọc số không bao giờ lệch nhau.
  const limit = Math.floor(safeNumber(options.limit));
  const shownItems = limit > 0 ? items.slice(0, limit) : items;

  if (options.compact === true) {
    const maxRequests = Math.max(...shownItems.map((item) => safeNumber(item.requests)), 1);
    const previewRows = shownItems.map((item, index) => {
      const requests = safeNumber(item.requests);
      const sharePct = totalRequests > 0 ? (requests / totalRequests) * 100 : 0;
      const barPct = Math.min(100, Math.round((requests / maxRequests) * 100));
      const label = String(item.label ?? item.id ?? '');
      return `
        <li class="feature-preview-item">
          <span class="feature-preview-rank">${index + 1}</span>
          <div class="feature-preview-main">
            <div class="feature-preview-head">
              <span class="feature-preview-name" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
              <span class="feature-preview-count text-mono">${formatNumber(requests)} lượt · ${formatPercent(sharePct)}</span>
            </div>
            <div class="rank-bar"><div class="rank-bar-fill" style="width: ${barPct}%"></div></div>
          </div>
        </li>`;
    }).join('');

    el.innerHTML = `
      <ol class="feature-preview-list">${previewRows}</ol>
      <p class="card-subtitle" style="margin-top: 10px;">Tổng ${formatNumber(totalRequests)} lượt trong ${escapeHtml(labelForTimeRange(state.timeRange))}. Xem xếp hạng đầy đủ ở tab Phân Tích Hành Vi.</p>`;
    return;
  }

  // Xu hướng luôn kèm ký hiệu ▲/▼ + số chứ không chỉ đổi màu, để người không
  // phân biệt được màu vẫn đọc được chiều đi (spec mục 4.1).
  const deltaCell = (delta) => {
    if (delta === null || delta === undefined) {
      return '<span class="rank-delta trend-neutral">— chưa có kỳ trước</span>';
    }
    const value = safeNumber(delta);
    if (value > 0) return `<span class="rank-delta trend-up">▲ +${formatNumber(value, 1)}%</span>`;
    if (value < 0) return `<span class="rank-delta trend-down">▼ ${formatNumber(value, 1)}%</span>`;
    return '<span class="rank-delta trend-neutral">■ 0%</span>';
  };

  const rows = shownItems.map((item, index) => {
    const requests = safeNumber(item.requests);
    const sharePct = totalRequests > 0 ? (requests / totalRequests) * 100 : 0;
    const label = String(item.label ?? item.id ?? '');
    return `
      <tr>
        <td class="rank-index">${index + 1}</td>
        <td class="rank-label" title="${escapeHtml(label)}">${escapeHtml(label)}</td>
        <td class="text-mono">${formatNumber(requests)}</td>
        <td class="text-mono">${formatNumber(item.users)}</td>
        <td class="text-mono">${formatPercent(sharePct)}</td>
        <td class="text-mono">${formatPercent(safeNumber(item.errorRate) * 100)}</td>
        <td>${deltaCell(item.deltaPct)}</td>
        <td class="rank-bar-cell">
          <div class="rank-bar"><div class="rank-bar-fill" style="width: ${Math.min(100, Math.round(sharePct * 10) / 10)}%"></div></div>
        </td>
      </tr>`;
  }).join('');

  // Nhóm "Khác" vẫn phải hiện: lưu lượng tới endpoint không thuộc nhóm nào là
  // lưu lượng thật; giấu nó đi sẽ khiến bảng lệch với KPI Tổng Quan.
  const other = data.other || {};
  const otherRequests = safeNumber(other.requests);
  const otherSharePct = totalRequests > 0 ? (otherRequests / totalRequests) * 100 : 0;
  const otherRow = otherRequests > 0
    ? `<tr>
        <td class="rank-index">—</td>
        <td class="rank-label">Khác (không thuộc nhóm nào)</td>
        <td class="text-mono">${formatNumber(otherRequests)}</td>
        <td class="text-mono">${formatNumber(other.users)}</td>
        <td class="text-mono">${formatPercent(otherSharePct)}</td>
        <td class="text-mono">—</td>
        <td><span class="rank-delta trend-neutral">— không theo dõi</span></td>
        <td class="rank-bar-cell">
          <div class="rank-bar"><div class="rank-bar-fill" style="width: ${Math.min(100, Math.round(otherSharePct * 10) / 10)}%"></div></div>
        </td>
      </tr>`
    : '';

  el.innerHTML = `
    <div class="table-scroll">
      <table class="admin-data-table">
        <caption class="sr-only">Xếp hạng tính năng theo số lượt yêu cầu</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Tính năng</th>
            <th scope="col">Lượt</th>
            <th scope="col">Người dùng</th>
            <th scope="col">Tỷ trọng</th>
            <th scope="col">Tỷ lệ lỗi</th>
            <th scope="col">So với kỳ trước</th>
            <th scope="col">Thanh tỷ trọng</th>
          </tr>
        </thead>
        <tbody>${rows}${otherRow}</tbody>
      </table>
    </div>
    <p class="card-subtitle" style="margin-top: 10px;">Tổng ${formatNumber(totalRequests)} lượt trong ${escapeHtml(labelForTimeRange(state.timeRange))}. Cột "Người dùng" đếm MSSV/IP khác nhau gọi vào tính năng đó.</p>`;
}

/**
 * Khối 2 — "sinh viên hoạt động vào khung giờ nào?".
 * Lưới CSS 7×24 (mỗi ô IN SỐ, không chỉ tô màu) cộng thêm bảng số dự phòng:
 * người in đen trắng, copy ra Excel hay không phân biệt màu vẫn đọc được.
 */
function renderHoursHeatmap(data = {}) {
  const el = resolveElement('#hours-heatmap');
  if (!el) return;
  const tableEl = resolveElement('#hours-heatmap-table');

  const weekdays = Array.isArray(data.weekdays) && data.weekdays.length === 7
    ? data.weekdays.map((name) => String(name ?? ''))
    : HEATMAP_WEEKDAYS;
  // Ép ma trận về đúng 7×24: server luôn trả vậy, nhưng nếu thiếu hàng/cột (DB
  // rỗng hoặc endpoint đổi hình dạng) thì lưới vẫn giữ nguyên bố cục, không lệch hàng.
  const matrix = Array.from({ length: 7 }, (_, day) => {
    const row = Array.isArray(data.matrix?.[day]) ? data.matrix[day] : [];
    return Array.from({ length: 24 }, (_, hour) => safeNumber(row[hour]));
  });
  const total = matrix.reduce((sum, row) => sum + row.reduce((rowSum, value) => rowSum + value, 0), 0);

  if (total <= 0) {
    renderEmpty(el, 'Chưa có lượt truy cập nào để dựng nhiệt đồ.', {
      hint: 'Chọn mốc thời gian rộng hơn (7D hoặc 30D) ở thanh trên.'
    });
    if (tableEl) renderEmpty(tableEl, 'Chưa có số liệu theo khung giờ.');
    return;
  }

  const peak = data.peak || {};
  const max = matrix.reduce((rowMax, row) => Math.max(rowMax, ...row), 0);
  const peakDay = safeNumber(peak.weekday);
  const peakHour = safeNumber(peak.hour);
  const weekdayAt = (day) => escapeHtml(weekdays[day] || 'Thứ ?');

  const hourHeader = Array.from(
    { length: 24 },
    (_, hour) => `<span class="heatmap-hour">${hour % 3 === 0 ? hour : ''}</span>`
  ).join('');

  const rows = matrix.map((row, day) => {
    const cells = row.map((count, hour) => {
      // ceil() chia 6 bậc trên giá trị thực (max, max/5, ...) nên ô nhỏ vẫn khác
      // sắc ô bằng 0, còn ô lớn nhất luôn đạt bậc 5.
      const level = max > 0 ? Math.min(5, Math.ceil((count / max) * 5)) : 0;
      const isPeak = count > 0 && day === peakDay && hour === peakHour;
      const tip = `${weekdays[day] || ''} ${String(hour).padStart(2, '0')}:00 — ${formatNumber(count)} lượt`;
      const zeroClass = count === 0 ? ' heatmap-cell--zero' : '';
      const peakClass = isPeak ? ' heatmap-cell--peak' : '';
      return `<div class="heatmap-cell heatmap-lv${level}${zeroClass}${peakClass}" title="${escapeHtml(tip)}">${compactCount(count)}</div>`;
    }).join('');
    return `<span class="heatmap-label">${weekdayAt(day)}</span>${cells}`;
  }).join('');

  const peakText = safeNumber(peak.count) > 0
    ? `${weekdays[peakDay] || ''} lúc ${String(peakHour).padStart(2, '0')}:00 với ${formatNumber(peak.count)} lượt`
    : 'chưa có đỉnh rõ ràng';

  const legend = `
    <div class="heatmap-legend">
      <span class="heatmap-legend-title">Ít hơn</span>
      ${[0, 1, 2, 3, 4, 5].map((lv) => `<span class="heatmap-swatch heatmap-lv${lv}"></span>`).join('')}
      <span class="heatmap-legend-title">Nhiều hơn</span>
    </div>`;

  // role="img" + aria-label gọn: đọc 168 ô bằng trình đọc màn hình sẽ nghe lại cả
  // bảng; dữ liệu đầy đủ vẫn có ở bảng số dự phòng ngay dưới (mở ra bằng
  // bàn phím được).
  el.innerHTML = `
    ${legend}
    <div class="table-scroll">
      <div class="heatmap-grid" role="img" aria-label="${escapeHtml(`Nhiệt đồ lượt truy cập theo 7 ngày và 24 giờ, tổng ${formatNumber(total)} lượt. Khung giờ cao điểm nhất: ${peakText}.`)}">
        <span class="heatmap-label"></span>${hourHeader}
        ${rows}
      </div>
    </div>
    <p class="card-subtitle" style="margin-top: 10px;">Ô viền đậm là khung giờ cao điểm nhất: ${escapeHtml(peakText)}. Số trên 1.000 được viết gọn (1,2k); số đầy đủ nằm ở rê chuột và trong bảng số bên dưới.</p>`;

  if (!tableEl) return;
  const headCells = Array.from({ length: 24 }, (_, hour) => `<th scope="col">${String(hour).padStart(2, '0')}</th>`).join('');
  const bodyRows = matrix.map((row, day) => {
    const rowTotal = row.reduce((sum, value) => sum + value, 0);
    let bestHour = 0;
    row.forEach((value, hour) => {
      if (value > row[bestHour]) bestHour = hour;
    });
    return `
      <tr>
        <th scope="row">${weekdayAt(day)}</th>
        ${row.map((value) => `<td>${formatNumber(value)}</td>`).join('')}
        <td><strong>${formatNumber(rowTotal)}</strong></td>
        <td class="heatmap-peak-hour">${String(bestHour).padStart(2, '0')}:00 (${formatNumber(row[bestHour])})</td>
      </tr>`;
  }).join('');

  tableEl.innerHTML = `
    <table class="admin-data-table heatmap-numbers">
      <caption class="sr-only">Số lượt truy cập theo từng giờ trong tuần — cùng dữ liệu với nhiệt đồ</caption>
      <thead>
        <tr><th scope="col">Thứ</th>${headCells}<th scope="col">Tổng</th><th scope="col">Giờ cao nhất</th></tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
}

/** Bỏ biểu đồ cohort cũ trước khi thay innerHTML (canvas bị tách mà Chart.js
 *  vẫn giữ tham chiếu thì lần vẽ sau sẽ ném lỗi). */
function destroyCohortChart() {
  if (!state.charts.cohort) return;
  state.charts.cohort.destroy();
  state.charts.cohort = null;
}

/**
 * Nhãn ngày của cohort. Server trả chuỗi `YYYY-MM-DD` đã tính theo giờ Việt
 * Nam nên cắt thẳng từ chuỗi; gọi new Date() sẽ lệch một ngày ở máy đặt múi
 * giờ âm.
 */
function formatCohortDay(value) {
  const match = String(value ?? '').match(/^\d{4}-(\d{2})-(\d{2})/);
  if (match) return `${match[2]}/${match[1]}`;
  return formatDateTime(value);
}

/**
 * Khối 3 — "người dùng có quay lại không?". Trả lời bằng dải số (đọc trước) và
 * biểu đồ theo ngày (nhìn sau): dải số trả lời "giữ chân bao nhiêu", biểu đồ
 * trả lời "vào ngày nào".
 */
function renderCohort(data = {}) {
  const el = resolveElement('#cohort-chart');
  if (!el) return;
  const dayBuckets = Array.isArray(data.dayBuckets) ? data.dayBuckets : [];
  if (!dayBuckets.length) {
    destroyCohortChart();
    renderEmpty(el, 'Chưa có dữ liệu hoạt động theo ngày.', {
      hint: 'Cần ít nhất một ngày có sinh viên đăng nhập trong mốc thời gian đang chọn.'
    });
    return;
  }

  const totals = data.totals || {};
  const stickiness = data.stickiness || {};
  const stats = [
    { label: 'Người dùng trong kỳ', value: formatNumber(totals.active) },
    { label: 'Mới', value: formatNumber(totals.new) },
    { label: 'Quay lại', value: formatNumber(totals.returning) },
    { label: 'DAU (hôm nay)', value: formatNumber(stickiness.dau) },
    { label: 'Hoạt động 7 ngày', value: formatNumber(stickiness.wau) },
    { label: 'Tỷ lệ DAU/WAU', value: formatPercent(safeNumber(stickiness.ratio) * 100) },
    { label: 'Quay lại sau 7 ngày', value: formatPercent(safeNumber(data.returnRate7d) * 100) }
  ];

  const statsHtml = stats.map((stat) => `
    <div class="cohort-stat">
      <span class="cohort-stat-label">${escapeHtml(stat.label)}</span>
      <span class="cohort-stat-value">${escapeHtml(stat.value)}</span>
    </div>`).join('');

  // Canvas chỉ tạo một lần: Chart.js đọc DOM lúc vẽ, nên nếu thay canvas mỗi lần
  // tự làm mới (15 giây) thì biểu đồ nhấp nháy và dựng lại từ đầu. Dải số thì rẻ,
  // cứ vẽ lại mỗi lần.
  const canvas = el.querySelector('#cohort-canvas');
  if (canvas) {
    const statsEl = el.querySelector('.cohort-stat-row');
    if (statsEl) statsEl.innerHTML = statsHtml;
  } else {
    el.innerHTML = `
      <div class="cohort-stat-row">${statsHtml}</div>
      <div class="chart-wrapper">
        <canvas id="cohort-canvas" role="img" aria-label="${escapeHtml('Số người dùng hoạt động, mới và quay lại theo từng ngày.')}"></canvas>
      </div>`;
  }

  const target = el.querySelector('#cohort-canvas');
  if (typeof Chart === 'undefined' || !target) return;

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#94a3b8' : '#475569';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)';

  const chartData = {
    labels: dayBuckets.map((bucket) => formatCohortDay(bucket?.date)),
    datasets: [
      {
        label: 'Hoạt động',
        data: dayBuckets.map((bucket) => safeNumber(bucket?.active)),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.12)',
        fill: true,
        tension: 0.35,
        pointRadius: 2
      },
      {
        label: 'Mới',
        data: dayBuckets.map((bucket) => safeNumber(bucket?.new)),
        borderColor: '#10b981',
        backgroundColor: 'transparent',
        tension: 0.3,
        pointRadius: 2
      },
      {
        label: 'Quay lại',
        data: dayBuckets.map((bucket) => safeNumber(bucket?.returning)),
        borderColor: '#f59e0b',
        backgroundColor: 'transparent',
        borderDash: [4, 3],
        tension: 0.3,
        pointRadius: 2
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top',
        labels: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
      }
    },
    scales: {
      x: { ticks: { color: textColor, maxTicksLimit: 14 }, grid: { color: gridColor } },
      y: { beginAtZero: true, ticks: { color: textColor, precision: 0 }, grid: { color: gridColor } }
    }
  };

  // Cùng cách làm như renderTimelineChart: đổi dữ liệu/tuỳ chọn rồi update() nếu
  // biểu đồ đã tồn tại, còn không thì mới tạo mới.
  if (state.charts.cohort) {
    state.charts.cohort.data = chartData;
    state.charts.cohort.options = chartOptions;
    state.charts.cohort.update();
  } else {
    state.charts.cohort = new Chart(target, { type: 'line', data: chartData, options: chartOptions });
  }
}

/**
 * Khối 4 — "tính năng nào chậm hoặc hay lỗi?".
 * Vì sao p95 chứ không phải trung bình: vài request chậm kéo trung bình lệch hẳn,
 * còn p95 nói "95% yêu cầu nhanh hơn con số này" — đúng ý nghĩa khi cảm nhận
 * được độ trễ.
 */
function renderQuality(data = {}) {
  const el = resolveElement('#quality-table');
  if (!el) return;
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) {
    renderEmpty(el, 'Chưa có số liệu chất lượng cho mốc thời gian đang chọn.', {
      hint: 'Độ trễ chỉ được ghi khi có request hoàn tất, nên khoảng thời gian quá ngắn có thể chưa có số.'
    });
    return;
  }

  // Màu nhanh/chậm chỉ là trợ giúp: luôn kèm số và chữ để không phải đoán ngưỡng.
  const latencyCls = (ms) => (ms < 300 ? 'lat-fast' : ms < 800 ? 'lat-med' : 'lat-slow');
  const overall = data.overall || {};
  const overallStats = [
    { label: 'Tổng yêu cầu', value: formatNumber(overall.requests) },
    { label: 'Tỷ lệ lỗi (4xx/5xx)', value: formatPercent(safeNumber(overall.errorRate) * 100) },
    { label: 'Độ trễ trung bình', value: formatDurationMs(overall.avgMs) },
    { label: 'Độ trễ p95', value: formatDurationMs(overall.p95Ms) }
  ];

  const rows = items.map((item) => {
    const p95 = safeNumber(item.p95Ms);
    const label = String(item.label ?? item.id ?? '');
    return `
      <tr>
        <td class="rank-label" title="${escapeHtml(label)}">${escapeHtml(label)}</td>
        <td class="text-mono">${formatNumber(item.requests)}</td>
        <td class="text-mono">${formatPercent(safeNumber(item.errorRate) * 100)}</td>
        <td class="text-mono">${formatDurationMs(item.avgMs)}</td>
        <td class="text-mono"><span class="latency-badge ${latencyCls(p95)}">${formatDurationMs(p95)}</span></td>
      </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="quality-summary">
      ${overallStats.map((stat) => `
        <div class="quality-stat">
          <span class="quality-stat-label">${escapeHtml(stat.label)}</span>
          <span class="quality-stat-value">${escapeHtml(stat.value)}</span>
        </div>`).join('')}
    </div>
    <div class="table-scroll">
      <table class="admin-data-table">
        <caption class="sr-only">Độ trễ và tỷ lệ lỗi theo tính năng</caption>
        <thead>
          <tr>
            <th scope="col">Tính năng</th>
            <th scope="col">Lượt</th>
            <th scope="col">Tỷ lệ lỗi</th>
            <th scope="col">Trung bình</th>
            <th scope="col">p95</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="card-subtitle" style="margin-top: 10px;">Ngưỡng màu tham chiếu: dưới 300 ms là nhanh, 300–800 ms là chấp nhận được, trên 800 ms là chậm.</p>`;
}

// 5. Render Detailed Logs
function renderLogs(logsData = {}) {
  const logs = logsData.logs || [];
  const p = logsData.pagination || { total: 0, page: 1, limit: 50, totalPages: 1 };

  dom.logsTotalCount.textContent = `${p.total.toLocaleString()} bản ghi`;
  dom.badgeTotalLogs.textContent = p.total.toLocaleString();
  dom.paginationInfo.textContent = `Trang ${p.page} / ${p.totalPages} (Tổng ${p.total.toLocaleString()})`;

  dom.btnPagePrev.disabled = p.page <= 1;
  dom.btnPageNext.disabled = p.page >= p.totalPages;

  if (!logs.length) {
    dom.logsTableBody.innerHTML = '<tr><td colspan="9" class="text-center-muted">Không tìm thấy bản ghi log nào phù hợp.</td></tr>';
    return;
  }

  dom.logsTableBody.innerHTML = logs.map((log) => {
    const d = new Date(log.createdAt);
    const clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
    const hasError = log.statusCode >= 400;
    const apiLabel = log.route || log.path.split('?')[0];

    let statClass = 'stat-2xx';
    if (log.statusCode >= 300 && log.statusCode < 400) statClass = 'stat-3xx';
    if (log.statusCode >= 400 && log.statusCode < 500) statClass = 'stat-4xx';
    if (log.statusCode >= 500) statClass = 'stat-5xx';

    let latClass = 'lat-fast';
    if (log.responseTimeMs >= 150 && log.responseTimeMs < 400) latClass = 'lat-med';
    if (log.responseTimeMs >= 400) latClass = 'lat-slow';

    const jsonStr = escapeHtml(JSON.stringify(log));
    const statusCode = safeNumber(log.statusCode);
    const responseTimeMs = safeNumber(log.responseTimeMs);
    const methodClass = `method-${cssToken(log.method)}`;

    return `
      <tr class="${hasError ? 'has-error' : ''}" data-log="${jsonStr}">
        <td>
          <span class="log-clock">${escapeHtml(clock)}</span>
          <span class="log-date">${escapeHtml(dateStr)}</span>
        </td>
        <td><span class="method-tag ${methodClass}">${escapeHtml(log.method)}</span></td>
        <td>
          <span class="route-code" title="${escapeHtml(log.route || '')}">${escapeHtml(apiLabel)}</span>
        </td>
        <td>
          <div class="path-wrap">
            <span class="path-code" title="${escapeHtml(log.path)}">${escapeHtml(log.path)}</span>
            ${log.errorMessage ? `<span class="path-err" title="${escapeHtml(log.errorMessage)}">⚠ ${escapeHtml(log.errorMessage)}</span>` : ''}
          </div>
        </td>
        <td><span class="status-badge ${statClass}">${statusCode}</span></td>
        <td><span class="latency-badge ${latClass}">${responseTimeMs} ms</span></td>
        <td>
          ${log.mssv ? `<span class="mssv-tag" title="${escapeHtml(log.fullName || log.mssv)}">${escapeHtml(log.mssv)}</span>` : '<span style="color: var(--text-muted); font-size: 0.78rem;">Khách</span>'}
        </td>
        <td>
          <span class="client-ip-text">${escapeHtml(log.ipAddress || '127.0.0.1')}</span>
          <span class="client-dev-text">${escapeHtml(log.os || '')} ${log.browser ? `• ${escapeHtml(log.browser)}` : ''}</span>
        </td>
        <td style="text-align: center;">
          <button type="button" class="btn-inspect" title="Xem chi tiết">👁</button>
        </td>
      </tr>
    `;
  }).join('');

  // Row Click Event
  dom.logsTableBody.querySelectorAll('tr[data-log]').forEach((tr) => {
    tr.addEventListener('click', () => {
      try {
        const log = JSON.parse(tr.getAttribute('data-log'));
        openLogDetailModal(log);
      } catch {}
    });
  });
}

// Log Inspector Modal
function openLogDetailModal(log) {
  currentSelectedLog = log;
  dom.modalLogTitle.textContent = `Yêu Cầu #${log.id} • ${log.method} ${log.statusCode}`;
  dom.modalLogTime.textContent = new Date(log.createdAt).toLocaleString();

  const hasQuery = log.query && Object.keys(log.query).length > 0;
  const queryJson = hasQuery ? JSON.stringify(log.query, null, 2) : '';

  dom.modalLogBody.innerHTML = `
    <div class="log-detail-grid">
      <div class="detail-row"><span class="k">Method:</span><span class="method-tag method-${cssToken(log.method)}">${escapeHtml(log.method)}</span></div>
      <div class="detail-row"><span class="k">Status HTTP:</span><span class="status-badge">${safeNumber(log.statusCode)}</span></div>
      <div class="detail-row"><span class="k">Độ trễ:</span><span>${safeNumber(log.responseTimeMs)} ms</span></div>
      <div class="detail-row"><span class="k">Sinh viên:</span><span>${log.mssv ? `${escapeHtml(log.mssv)} (${escapeHtml(log.fullName || 'BDU')})` : 'Chưa đăng nhập'}</span></div>
      <div class="detail-row"><span class="k">IP Client:</span><span>${escapeHtml(log.ipAddress || '127.0.0.1')}</span></div>
      <div class="detail-row"><span class="k">Thiết bị:</span><span>${escapeHtml(log.deviceType)} • ${escapeHtml(log.os)} • ${escapeHtml(log.browser)}</span></div>
    </div>

    <div style="margin-top: 10px;">
      <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted);">API đã gọi (Route pattern):</span>
      <div class="detail-code-box">
        <span>${escapeHtml(log.route || '(không khớp route — có thể 404)')}</span>
        ${log.route ? `<button type="button" class="btn-copy-code" data-copy="${escapeHtml(log.route)}">📋 Chép</button>` : ''}
      </div>
    </div>

    <div style="margin-top: 10px;">
      <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted);">Đường dẫn đầy đủ (Path):</span>
      <div class="detail-code-box">
        <span>${escapeHtml(log.path)}</span>
        <button type="button" class="btn-copy-code" data-copy="${escapeHtml(log.path)}">📋 Chép</button>
      </div>
    </div>

    ${hasQuery ? `
      <div style="margin-top: 10px;">
        <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted);">Tham số truy vấn (đã che token/mật khẩu):</span>
        <pre class="detail-query-box">${escapeHtml(queryJson)}</pre>
      </div>
    ` : ''}

    ${log.errorMessage ? `
      <div style="margin-top: 10px;">
        <span style="font-size: 0.75rem; font-weight: 700; color: #ef4444;">Thông báo lỗi:</span>
        <div class="detail-error-box">${escapeHtml(log.errorMessage)}</div>
      </div>
    ` : ''}

    ${log.referrer ? `
      <div style="margin-top: 10px;">
        <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted);">Nguồn gọi (Referrer):</span>
        <div class="detail-code-box" style="font-size: 0.75rem;">${escapeHtml(log.referrer)}</div>
      </div>
    ` : ''}

    ${log.userAgent ? `
      <div style="margin-top: 10px;">
        <span style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted);">User-Agent:</span>
        <div class="detail-code-box" style="font-size: 0.72rem; line-height: 1.4; display: block;">${escapeHtml(log.userAgent)}</div>
      </div>
    ` : ''}
  `;

  // Copy buttons
  dom.modalLogBody.querySelectorAll('.btn-copy-code').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = btn.getAttribute('data-copy');
      navigator.clipboard?.writeText(val);
      btn.textContent = '✓ Đã chép';
      setTimeout(() => btn.textContent = '📋 Chép', 2000);
    });
  });

  if (log.mssv) {
    dom.btnFilterThisStudent.style.display = 'inline-flex';
    // Giữ icon SVG: nút gốc trong markup đã có sẵn SVG nên chỉ thay phần chữ.
    dom.btnFilterThisStudent.innerHTML =
      `${renderIcon('search', 'svg-icon svg-icon--sm')}<span>Lọc tất cả log của ${escapeHtml(log.mssv)}</span>`;
  } else {
    dom.btnFilterThisStudent.style.display = 'none';
  }

  dom.modalLogDetail.style.display = 'flex';
}

function closeLogDetailModal() {
  dom.modalLogDetail.style.display = 'none';
  currentSelectedLog = null;
}

dom.btnCloseLogModal.addEventListener('click', closeLogDetailModal);
dom.btnModalDismiss.addEventListener('click', closeLogDetailModal);

dom.btnFilterThisStudent.addEventListener('click', () => {
  if (currentSelectedLog?.mssv) {
    filterByMssv(currentSelectedLog.mssv);
    closeLogDetailModal();
  }
});

function filterByMssv(mssv) {
  state.logFilters.mssv = mssv;
  state.logFilters.page = 1;
  dom.activeFilterMssv.textContent = mssv;
  dom.activeMssvTagRow.style.display = 'block';
  switchTab('logs');
  fetchAllData();
  showToast(`Đang lọc nhật ký của ${mssv}`, 'info');
}

dom.btnRemoveMssvFilter.addEventListener('click', () => {
  state.logFilters.mssv = '';
  state.logFilters.page = 1;
  dom.activeMssvTagRow.style.display = 'none';
  fetchAllData();
});

// Student API activity trace modal
function labelForTimeRange(range) {
  return {
    '1h': '1 giờ qua',
    '6h': '6 giờ qua',
    '24h': '24 giờ qua',
    '7d': '7 ngày qua',
    '30d': '30 ngày qua',
    'all': 'Toàn bộ thời gian'
  }[range] || range;
}

async function openStudentActivity(mssv) {
  currentActivityMssv = mssv;
  dom.studentActivityTitle.textContent = `Dấu Vết API • ${mssv}`;
  dom.studentActivitySub.textContent = labelForTimeRange(state.timeRange);
  dom.studentActivitySummary.innerHTML = '<div class="loading-state">Đang tải dữ liệu...</div>';
  dom.studentActivityRoutes.innerHTML = '<tr><td colspan="6" class="text-center-muted">Đang tải...</td></tr>';
  dom.studentActivityDevices.innerHTML = '';
  dom.modalStudentActivity.style.display = 'flex';

  try {
    const data = await api(`/api/admin/dashboard/users/${encodeURIComponent(mssv)}/activity?timeRange=${state.timeRange}`);
    renderStudentActivity(data);
  } catch (err) {
    dom.studentActivitySummary.innerHTML = `<div class="text-center-muted">${escapeHtml(err.message || 'Không thể tải dấu vết hoạt động.')}</div>`;
    dom.studentActivityRoutes.innerHTML = '<tr><td colspan="6" class="text-center-muted">Không có dữ liệu.</td></tr>';
  }
}

function renderStudentActivity(data = {}) {
  const student = data.student || {};
  const summary = data.summary || {};
  const routes = data.routes || [];
  const devices = data.devices || [];
  const ips = data.ips || [];

  dom.studentActivityTitle.textContent = `Dấu Vết API • ${student.mssv || currentActivityMssv}`;
  dom.studentActivitySub.textContent = [
    student.fullName,
    student.classCode ? `Lớp ${student.classCode}` : null,
    student.lastLoginAt ? `Đăng nhập cuối: ${formatDateTime(student.lastLoginAt)}` : null,
    labelForTimeRange(state.timeRange)
  ].filter(Boolean).join(' • ');

  dom.studentActivitySummary.innerHTML = `
    <div class="activity-stat"><span class="label">Tổng request</span><span class="value">${(summary.totalRequests || 0).toLocaleString()}</span></div>
    <div class="activity-stat"><span class="label">Lỗi (4xx/5xx)</span><span class="value ${summary.errorCount ? 'text-error' : ''}">${(summary.errorCount || 0).toLocaleString()}</span></div>
    <div class="activity-stat"><span class="label">Độ trễ TB</span><span class="value">${summary.avgLatency || 0} ms</span></div>
    <div class="activity-stat"><span class="label">Request đầu</span><span class="value small">${formatDateTime(summary.firstSeen)}</span></div>
    <div class="activity-stat"><span class="label">Request cuối</span><span class="value small">${formatDateTime(summary.lastSeen)}</span></div>
  `;

  dom.studentActivityRoutes.innerHTML = routes.length ? routes.map((row) => `
    <tr>
      <td><span class="route-code" title="${escapeHtml(row.route)}">${escapeHtml(row.route)}</span></td>
      <td><span class="method-tag method-${cssToken(row.method)}">${escapeHtml(row.method)}</span></td>
      <td><strong>${safeNumber(row.count).toLocaleString()}</strong></td>
      <td>${safeNumber(row.errorCount) > 0 ? `<span class="status-badge stat-4xx">${safeNumber(row.errorCount)}</span>` : '0'}</td>
      <td>${formatDateTime(row.lastCalled)}</td>
      <td>${safeNumber(row.avgLatency)} ms</td>
    </tr>
  `).join('') : '<tr><td colspan="6" class="text-center-muted">Chưa có request nào trong khoảng thời gian này.</td></tr>';

  const deviceChips = devices.map((d) => `<span class="activity-chip">${escapeHtml(d.name)}: <strong>${safeNumber(d.count)}</strong></span>`);
  const ipChips = ips.map((ip) => `<span class="activity-chip">${escapeHtml(ip.ip)}: <strong>${safeNumber(ip.count)}</strong></span>`);
  const chips = [...deviceChips, ...ipChips];
  dom.studentActivityDevices.innerHTML = chips.length
    ? chips.join('')
    : '<span class="activity-empty">Không có dữ liệu thiết bị/IP.</span>';
}

function closeStudentActivityModal() {
  dom.modalStudentActivity.style.display = 'none';
}

dom.btnCloseStudentActivity.addEventListener('click', closeStudentActivityModal);
dom.btnActivityDismiss.addEventListener('click', closeStudentActivityModal);
dom.btnActivityFilterLogs.addEventListener('click', () => {
  if (!currentActivityMssv) return;
  closeStudentActivityModal();
  filterByMssv(currentActivityMssv);
});

// Logs Filters Events
let searchTimeout = null;
dom.inputLogSearch.addEventListener('input', (e) => {
  const val = e.target.value;
  dom.btnClearSearch.style.display = val ? 'block' : 'none';
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    state.logFilters.search = val.trim();
    state.logFilters.page = 1;
    fetchAllData();
  }, 400);
});

dom.btnClearSearch.addEventListener('click', () => {
  dom.inputLogSearch.value = '';
  dom.btnClearSearch.style.display = 'none';
  state.logFilters.search = '';
  state.logFilters.page = 1;
  fetchAllData();
});

dom.statusFilterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    dom.statusFilterBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.logFilters.status = btn.getAttribute('data-status');
    state.logFilters.page = 1;
    fetchAllData();
  });
});

dom.methodFilterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    dom.methodFilterBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.logFilters.method = btn.getAttribute('data-method');
    state.logFilters.page = 1;
    fetchAllData();
  });
});

// API route filter (populated from live traffic)
async function fetchRoutes() {
  if (!dom.selectLogRoute) return;
  try {
    const routes = await api(`/api/admin/dashboard/routes?timeRange=${state.timeRange}`);
    const current = state.logFilters.route;
    dom.selectLogRoute.innerHTML = '<option value="">Tất cả API</option>' + routes.map((row) => (
      `<option value="${escapeHtml(row.route)}">${escapeHtml(`${row.method} ${row.route}`)} (${safeNumber(row.count)})</option>`
    )).join('');
    if (current) dom.selectLogRoute.value = current;
  } catch (err) {
    console.error('[Admin] Lỗi nạp danh sách API:', err.message);
  }
}

if (dom.selectLogRoute) {
  dom.selectLogRoute.addEventListener('change', (e) => {
    state.logFilters.route = e.target.value;
    state.logFilters.page = 1;
    fetchAllData();
  });
}

dom.btnPagePrev.addEventListener('click', () => {
  if (state.logFilters.page > 1) {
    state.logFilters.page--;
    fetchAllData();
  }
});

dom.btnPageNext.addEventListener('click', () => {
  state.logFilters.page++;
  fetchAllData();
});

dom.selectLogLimit.addEventListener('change', (e) => {
  state.logFilters.limit = Number(e.target.value);
  state.logFilters.page = 1;
  fetchAllData();
});

// 6. Render Visited Students (Bảng students trên VPS)
function renderVisitedStudents(res = {}) {
  const data = res.data || res || {};
  const stats = data.stats || {};
  const students = data.students || [];
  const pagination = data.pagination || { page: 1, limit: 25, total: 0, totalPages: 1 };

  // Update Stats & Badges
  if (dom.badgeActiveStudents) {
    dom.badgeActiveStudents.textContent = (stats.visitedStudents || 0).toLocaleString();
  }
  if (dom.kpiVisitedActive) {
    dom.kpiVisitedActive.textContent = (stats.visitedStudents || 0).toLocaleString();
  }
  if (dom.kpiVisitedToday) {
    dom.kpiVisitedToday.textContent = (stats.visitedToday || 0).toLocaleString();
  }
  if (dom.kpiVisited7Days) {
    dom.kpiVisited7Days.textContent = (stats.visited7Days || 0).toLocaleString();
  }
  if (dom.kpiVisitedTotal) {
    dom.kpiVisitedTotal.textContent = (stats.totalStudents || 0).toLocaleString();
  }

  // Update Table Body
  if (!dom.visitedTableBody) return;

  if (!students.length) {
    dom.visitedTableBody.innerHTML = '<tr><td colspan="9" class="text-center-muted">Không tìm thấy sinh viên nào phù hợp bộ lọc.</td></tr>';
  } else {
    dom.visitedTableBody.innerHTML = students.map((s, idx) => {
      const stt = (pagination.page - 1) * pagination.limit + idx + 1;
      const firstLogin = s.first_login_at
        ? new Date(s.first_login_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '<span style="color: var(--text-muted);">Chưa có</span>';
      
      const lastLogin = s.last_login_at
        ? new Date(s.last_login_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '<span style="color: var(--text-muted);">Chưa có</span>';

      const classText = s.class_code
        ? escapeHtml(s.class_code)
        : (s.faculty_code
          ? `Khoa ${escapeHtml(s.faculty_code)}`
          : '<span style="color: var(--text-muted);">--</span>');
      const safeMssv = escapeHtml(s.mssv);
      const safeFullName = escapeHtml(s.full_name || 'Sinh viên BDU');
      const reqCount = safeNumber(s.total_requests);

      const statusBadge = s.is_active
        ? '<span class="status-pill status-2xx" style="padding: 2px 8px; font-size: 0.75rem;">🟢 Đã vào web</span>'
        : '<span class="status-pill status-4xx" style="padding: 2px 8px; font-size: 0.75rem; background: rgba(148, 163, 184, 0.15); color: #94a3b8;">⚪ Chưa kích hoạt</span>';

      return `
        <tr>
          <td><span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600;">#${stt}</span></td>
          <td>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="mssv-tag" style="font-weight: 700;">${safeMssv}</span>
            </div>
          </td>
          <td><strong>${safeFullName}</strong></td>
          <td><span style="font-size: 0.8rem; font-weight: 500;">${classText}</span></td>
          <td><span style="font-size: 0.78rem; font-family: var(--font-mono);">${firstLogin}</span></td>
          <td><span style="font-size: 0.78rem; font-family: var(--font-mono); font-weight: 600; color: var(--text-main);">${lastLogin}</span></td>
          <td style="text-align: center;">
            <strong style="color: ${reqCount > 0 ? 'var(--accent-blue)' : 'var(--text-muted)'}; font-size: 0.85rem;">
              ${reqCount.toLocaleString()} req
            </strong>
          </td>
          <td style="text-align: center;">${statusBadge}</td>
          <td style="text-align: right;">
            <button type="button" class="btn-filter-student btn-view-student-logs" data-mssv="${safeMssv}" title="Xem dấu vết API sinh viên này đã gọi">
              🧭 Dấu vết API
            </button>
          </td>
        </tr>
      `;
    }).join('');

    dom.visitedTableBody.querySelectorAll('.btn-view-student-logs').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mssv = btn.getAttribute('data-mssv');
        openStudentActivity(mssv);
      });
    });
  }

  // Update Pagination
  if (dom.visitedPaginationInfo) {
    const startItem = pagination.total > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0;
    const endItem = Math.min(pagination.page * pagination.limit, pagination.total);
    dom.visitedPaginationInfo.textContent = `Hiển thị ${startItem}–${endItem} trên tổng số ${pagination.total.toLocaleString()} sinh viên`;
  }
  if (dom.visitedPageCurrent) {
    dom.visitedPageCurrent.textContent = `${pagination.page} / ${Math.max(1, pagination.totalPages)}`;
  }
  if (dom.btnVisitedPrev) {
    dom.btnVisitedPrev.disabled = pagination.page <= 1;
  }
  if (dom.btnVisitedNext) {
    dom.btnVisitedNext.disabled = pagination.page >= pagination.totalPages;
  }
}

// Dedicated Visited Students Fetcher
async function fetchVisitedStudentsOnly() {
  try {
    const res = await api(`/api/admin/dashboard/visited-students?page=${state.visitedFilters.page}&limit=${state.visitedFilters.limit}&filter=${state.visitedFilters.filter}&sortBy=${state.visitedFilters.sortBy}&sortDir=${state.visitedFilters.sortDir}&search=${encodeURIComponent(state.visitedFilters.search)}`);
    renderVisitedStudents(res);
  } catch (err) {
    console.error('[Admin] Lỗi nạp dữ liệu sinh viên:', err.message);
  }
}

// Visited Students Event Listeners
let searchVisitedDebounce = null;
if (dom.inputVisitedSearch) {
  dom.inputVisitedSearch.addEventListener('input', (e) => {
    clearTimeout(searchVisitedDebounce);
    searchVisitedDebounce = setTimeout(() => {
      state.visitedFilters.search = e.target.value.trim();
      state.visitedFilters.page = 1;
      fetchVisitedStudentsOnly();
    }, 350);
  });
}

if (dom.selectVisitedFilter) {
  dom.selectVisitedFilter.addEventListener('change', (e) => {
    state.visitedFilters.filter = e.target.value;
    state.visitedFilters.page = 1;
    fetchVisitedStudentsOnly();
  });
}

if (dom.selectVisitedSort) {
  dom.selectVisitedSort.addEventListener('change', (e) => {
    const [sortBy, sortDir] = e.target.value.split(':');
    state.visitedFilters.sortBy = sortBy || 'last_login_at';
    state.visitedFilters.sortDir = sortDir || 'desc';
    state.visitedFilters.page = 1;
    fetchVisitedStudentsOnly();
  });
}

if (dom.btnRefreshVisited) {
  dom.btnRefreshVisited.addEventListener('click', () => {
    fetchVisitedStudentsOnly();
    showToast('Đã làm mới danh sách sinh viên', 'info');
  });
}

if (dom.btnVisitedPrev) {
  dom.btnVisitedPrev.addEventListener('click', () => {
    if (state.visitedFilters.page > 1) {
      state.visitedFilters.page -= 1;
      fetchVisitedStudentsOnly();
    }
  });
}

if (dom.btnVisitedNext) {
  dom.btnVisitedNext.addEventListener('click', () => {
    state.visitedFilters.page += 1;
    fetchVisitedStudentsOnly();
  });
}

// 7. Render VPS System Health
function renderSystem(system = {}) {
  const s = system.server || {};
  const mem = system.memory || {};
  const rt = system.realtime || {};
  const db = system.database || {};

  const uptimeSec = s.uptimeSeconds || 0;
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  const uptimeStr = days > 0 ? `${days}d ${hours}h ${mins}m` : `${hours}h ${mins}m ${uptimeSec % 60}s`;

  dom.sysUptime.textContent = uptimeStr;
  dom.sysPlatform.textContent = `Node ${s.nodeVersion || '--'} • ${s.platform || 'linux'}`;

  dom.sysRam.textContent = `${mem.rssMb || 0} MB`;
  dom.sysHeap.textContent = `Heap: ${mem.heapUsedMb || 0} / ${mem.heapTotalMb || 0} MB`;

  dom.sysWs.textContent = `● ${rt.connected_clients || 0} sockets`;
  dom.sysRooms.textContent = `${rt.active_rooms || 0} phòng hoạt động`;

  dom.sysDbLogs.textContent = `${(db.totalLogs || 0).toLocaleString()} logs`;
  dom.sysBuffer.textContent = `Bộ đệm RAM: ${system.bufferQueueSize || 0} items`;
}

// Ranking sync toggle (tab System)
function renderRankingSync(data, requestedAt = Date.now()) {
  if (!dom.rankingSyncToggle || !data || state.rankingToggleBusy) return;
  // Bỏ qua payload cũ nếu admin vừa bấm công tắc sau khi request được gửi.
  if (requestedAt < state.rankingSyncMutationAt) return;
  state.rankingSync = data;

  const envEnabled = data.env_enabled !== false;
  const enabled = Boolean(data.effective_enabled) && envEnabled;
  const hour = String(data.sync_hour ?? 3).padStart(2, '0');

  dom.rankingSyncToggle.checked = enabled;
  dom.rankingSyncToggle.disabled = !envEnabled;
  if (dom.rankingSyncNextSub) dom.rankingSyncNextSub.textContent = `${hour}:00 Asia/Ho_Chi_Minh`;

  dom.rankingSyncState.textContent = enabled ? '● Đang bật' : '● Đang tắt';
  dom.rankingSyncState.className = enabled ? 'sys-val text-green' : 'sys-val';
  dom.rankingSyncStateSub.textContent = envEnabled
    ? (data.enabled ? 'Theo cấu hình /admin' : 'Đã tắt từ /admin')
    : 'Bị khoá bởi RANKING_SYNC_ENABLED trên server';

  const latest = data.latest_run;
  if (latest && latest.completed_at) {
    dom.rankingSyncLast.textContent = formatDateTime(latest.completed_at);
    dom.rankingSyncLastSub.textContent = latest.status === 'succeeded'
      ? `${(latest.student_count || 0).toLocaleString()} sinh viên`
      : `Lần cuối: ${latest.status}`;
  } else {
    dom.rankingSyncLast.textContent = '--';
    dom.rankingSyncLastSub.textContent = 'Chưa có lần đồng bộ nào';
  }

  if (enabled && data.next_run_at) {
    dom.rankingSyncNext.textContent = formatDateTime(data.next_run_at);
  } else {
    dom.rankingSyncNext.textContent = 'Tạm dừng';
  }
}

if (dom.rankingSyncToggle) {
  dom.rankingSyncToggle.addEventListener('change', async () => {
    const enabled = dom.rankingSyncToggle.checked;
    const hour = String(state.rankingSync?.sync_hour ?? 3).padStart(2, '0');
    state.rankingToggleBusy = true;
    dom.rankingSyncToggle.disabled = true;
    try {
      const data = await api('/api/admin/dashboard/ranking-sync', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
      state.rankingSyncMutationAt = Date.now();
      state.rankingToggleBusy = false;
      renderRankingSync(data, state.rankingSyncMutationAt);
      showToast(
        enabled
          ? `Đã bật: đồng bộ sẽ chạy vào ${hour}:00 kế tiếp.`
          : `Đã tắt: các lần chạy ${hour}:00 sẽ bị bỏ qua.`,
        'success'
      );
    } catch (err) {
      state.rankingToggleBusy = false;
      dom.rankingSyncToggle.checked = !enabled;
      showToast(err.message || 'Không lưu được cấu hình đồng bộ.', 'error');
    } finally {
      dom.rankingSyncToggle.disabled = state.rankingSync?.env_enabled === false;
    }
  });
}

// Service lock toggle (tab System)
function renderServiceLock(data, requestedAt = Date.now()) {
  if (!dom.serviceLockToggle || !data || state.serviceLockBusy) return;
  // Bỏ qua payload cũ nếu admin vừa bấm công tắc sau khi request được gửi.
  if (requestedAt < state.serviceLockMutationAt) return;
  state.serviceLock = data;

  const locked = Boolean(data.locked);
  dom.serviceLockToggle.checked = locked;

  dom.serviceLockState.textContent = locked ? '● Đang khóa' : '● Đang mở';
  dom.serviceLockState.className = locked ? 'sys-val text-red' : 'sys-val text-green';
  if (dom.serviceLockStateSub) {
    dom.serviceLockStateSub.textContent = locked
      ? 'Người dùng đang thấy màn hình bảo trì'
      : 'Dịch vụ hoạt động bình thường';
  }

  // Chỉ nạp lại ô nhập khi admin chưa gõ gì kể từ lần lưu trước, để auto-refresh
  // (mỗi 15 giây) không ghi đè nội dung admin vừa nhập mà chưa kịp lưu.
  if (!state.serviceLockDirty) {
    if (dom.serviceLockTitle) dom.serviceLockTitle.value = data.title || '';
    if (dom.serviceLockMessage) dom.serviceLockMessage.value = data.message || '';
  }

  if (dom.serviceLockUpdated) {
    dom.serviceLockUpdated.textContent = data.updated_at ? formatDateTime(data.updated_at) : '--';
  }
  if (dom.serviceLockUpdatedSub) {
    dom.serviceLockUpdatedSub.textContent = data.updated_by
      ? `Bởi ${data.updated_by}`
      : 'Chưa từng thay đổi';
  }
}

// Đánh dấu "đang sửa" để auto-refresh không ghi đè nội dung chưa lưu.
if (dom.serviceLockTitle) {
  dom.serviceLockTitle.addEventListener('input', () => { state.serviceLockDirty = true; });
}
if (dom.serviceLockMessage) {
  dom.serviceLockMessage.addEventListener('input', () => { state.serviceLockDirty = true; });
}

if (dom.serviceLockToggle) {
  dom.serviceLockToggle.addEventListener('change', async () => {
    const locked = dom.serviceLockToggle.checked;

    // Chỉ hỏi xác nhận khi BẬT khóa: khóa dịch vụ sẽ đá toàn bộ người dùng đang
    // online sang màn hình bảo trì, còn mở khóa thì an toàn nên không cần hỏi.
    if (locked) {
      const ok = window.confirm(
        'Khóa dịch vụ sẽ đưa toàn bộ người dùng đang truy cập sang màn hình bảo trì. Tiếp tục?'
      );
      if (!ok) {
        dom.serviceLockToggle.checked = false;
        return;
      }
    }

    // Ô nhập trống gửi '' (KHÔNG phải null) để API hiểu là dùng nội dung mặc định;
    // gửi null sẽ bị 400.
    const title = dom.serviceLockTitle ? dom.serviceLockTitle.value.trim() : '';
    const message = dom.serviceLockMessage ? dom.serviceLockMessage.value.trim() : '';

    state.serviceLockBusy = true;
    dom.serviceLockToggle.disabled = true;
    try {
      const data = await api('/api/admin/dashboard/service-lock', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locked, title, message })
      });
      state.serviceLockMutationAt = Date.now();
      state.serviceLockBusy = false;
      state.serviceLockDirty = false;
      renderServiceLock(data, state.serviceLockMutationAt);
      showToast(locked ? 'Đã khóa dịch vụ để bảo trì.' : 'Đã mở khóa dịch vụ.', 'success');
    } catch (err) {
      state.serviceLockBusy = false;
      dom.serviceLockToggle.checked = !locked;
      showToast(err.message || 'Không lưu được trạng thái khóa dịch vụ.', 'error');
    } finally {
      dom.serviceLockToggle.disabled = false;
    }
  });
}

// Purge Logs Modal
dom.btnOpenPurgeModal.addEventListener('click', () => {
  dom.purgeAlertMsg.style.display = 'none';
  dom.modalPurgeLogs.style.display = 'flex';
});

function closePurgeModal() {
  dom.modalPurgeLogs.style.display = 'none';
}

dom.btnClosePurgeModal.addEventListener('click', closePurgeModal);
dom.btnCancelPurge.addEventListener('click', closePurgeModal);

dom.btnConfirmPurge.addEventListener('click', async () => {
  const selectedDays = Number(document.querySelector('input[name="purgeRadio"]:checked')?.value || 14);
  try {
    dom.btnConfirmPurge.disabled = true;
    dom.btnConfirmPurge.textContent = 'Đang dọn dẹp...';

    const res = await api('/api/admin/dashboard/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ olderThanDays: selectedDays })
    });

    dom.purgeAlertMsg.textContent = res?.message || `Đã dọn dẹp log cũ hơn ${selectedDays} ngày.`;
    dom.purgeAlertMsg.style.display = 'block';
    showToast(dom.purgeAlertMsg.textContent, 'success');

    setTimeout(() => {
      closePurgeModal();
      dom.btnConfirmPurge.disabled = false;
      dom.btnConfirmPurge.textContent = 'Xác Nhận Xóa Log';
      fetchAllData();
    }, 2000);
  } catch (err) {
    dom.purgeAlertMsg.textContent = err.message || 'Lỗi dọn dẹp log.';
    dom.purgeAlertMsg.style.display = 'block';
    dom.btnConfirmPurge.disabled = false;
    dom.btnConfirmPurge.textContent = 'Xác Nhận Xóa Log';
  }
});

// Initialization
async function init() {
  updateAuthDisplay();
  // Icon của nút đổi theme phải khớp theme đang bật, nếu không lần đầu mở trang
  // sẽ hiện mặt trăng trong khi nền đang sáng (mâu thuẫn với chính nút đó).
  renderThemeToggleIcon(currentTheme());
  // Tab Tổng quan và tab Insights phải có trạng thái "đang tải" ngay từ đầu,
  // không để KPI đứng "--" hay khối trống trơn trong lúc chờ dữ liệu.
  renderOverviewSkeleton();
  renderInsightsSkeleton();
  startAutoRefresh();
  await fetchAllData();
  fetchRoutes();
}

init();
