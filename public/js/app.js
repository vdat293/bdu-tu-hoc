/**
 * BDU TỰ HỌC - Master Frontend Application
 * Handles Auth, Gradebook parsing (BDU format), WordFmt, Auto Survey, Schedule & Learning Hub
 */

const AppState = {
  user: null,
  token: null,
  rawGradeData: null,
  academicRanking: null,
  leaderboard: {
    scope: 'school',
    metric: 'gpa',
    loaded: false,
    loading: false,
    reloadRequested: false
  },
  semesters: [],
  selectedSemester: 'ALL',
  filterStatus: 'ALL',
  searchQuery: '',
  selectedFile: null,
  gpaChart: null,
  distChart: null,
  eventSource: null,
  englishSessionId: null,
  englishEventSource: null,
  englishActivities: []
};

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAuth();
  initLoginCharacters();
  initNavigation();
  initGradeFilters();
  initScheduleTab();
  initLeaderboard();
  initWordFmtTool();
  initSurveyBot();
  initEnglishExerciseBot();
  initModals();
});

// ============================================================================
// THEME & UTILITIES
// ============================================================================
function initTheme() {
  const savedTheme = localStorage.getItem('bdu_theme_product') || 'theme-light';
  document.body.className = savedTheme;
  updateThemeIcons(savedTheme);

  const themeBtn = document.getElementById('btn-theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const newTheme = document.body.classList.contains('theme-dark') ? 'theme-light' : 'theme-dark';
      document.body.className = newTheme;
      localStorage.setItem('bdu_theme_product', newTheme);
      updateThemeIcons(newTheme);
      if (AppState.gpaChart) renderCharts(AppState.semesters);
    });
  }
}

function updateThemeIcons(theme) {
  const sun = document.querySelector('.icon-sun');
  const moon = document.querySelector('.icon-moon');
  if (!sun || !moon) return;
  if (theme === 'theme-light') {
    sun.classList.remove('hidden');
    moon.classList.add('hidden');
  } else {
    sun.classList.add('hidden');
    moon.classList.remove('hidden');
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const mark = document.createElement('span');
  mark.className = 'toast-mark';
  mark.setAttribute('aria-hidden', 'true');
  const content = document.createElement('span');
  content.textContent = message;
  toast.append(mark, content);
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function initLoginCharacters() {
  const wrapper = document.querySelector('.login-wrapper');
  const loginCard = document.querySelector('.login-card');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const togglePassword = document.getElementById('toggle-password');
  if (!wrapper || !loginCard || !usernameInput || !passwordInput) return;

  const updatePasswordMode = () => {
    const shouldLookAway = document.activeElement === passwordInput && passwordInput.type === 'password';
    wrapper.classList.toggle('password-active', shouldLookAway);
  };

  const updateLookFromValue = () => {
    if (wrapper.classList.contains('password-active')) return;
    const progress = Math.min(usernameInput.value.length / 12, 1);
    wrapper.style.setProperty('--look-x', `${-1 + progress * 5}px`);
    wrapper.style.setProperty('--look-y', `${progress * 1.5}px`);
  };

  loginCard.addEventListener('pointermove', (event) => {
    if (wrapper.classList.contains('password-active')) return;
    const bounds = loginCard.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 6;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 4;
    wrapper.style.setProperty('--look-x', `${x.toFixed(2)}px`);
    wrapper.style.setProperty('--look-y', `${y.toFixed(2)}px`);
  });

  usernameInput.addEventListener('input', updateLookFromValue);
  passwordInput.addEventListener('focus', updatePasswordMode);
  passwordInput.addEventListener('input', updatePasswordMode);
  passwordInput.addEventListener('blur', () => setTimeout(updatePasswordMode, 0));
  togglePassword?.addEventListener('click', updatePasswordMode);
}

// ============================================================================
// AUTHENTICATION
// ============================================================================
function initAuth() {
  const loginForm = document.getElementById('login-form');
  const togglePassBtn = document.getElementById('toggle-password');
  const passInput = document.getElementById('password');
  const logoutBtn = document.getElementById('btn-logout');
  const refreshBtn = document.getElementById('btn-refresh');

  if (togglePassBtn && passInput) {
    togglePassBtn.addEventListener('click', () => {
      const isPass = passInput.type === 'password';
      passInput.type = isPass ? 'text' : 'password';
      togglePassBtn.querySelector('.password-show')?.classList.toggle('hidden', isPass);
      togglePassBtn.querySelector('.password-hide')?.classList.toggle('hidden', !isPass);
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value.trim();
      const password = passInput.value;
      const remember = document.getElementById('remember-me').checked;
      const btn = document.getElementById('btn-login');

      setButtonLoading(btn, true);

      try {
        const res = await BduApi.login(username, password);
        AppState.user = {
          name: res.name,
          mssv: res.mssv,
          email: res.email,
          roles: res.roles
        };
        AppState.token = res.token;

        // Tính thời gian hết hạn của token
        const expiresAt = getTokenExpTime(res.token, res.expires_in);

        if (remember) {
          localStorage.setItem('bdu_token', res.token);
          localStorage.setItem('bdu_user', JSON.stringify(AppState.user));
          localStorage.setItem('bdu_token_expires_at', expiresAt.toString());
        } else {
          sessionStorage.setItem('bdu_token', res.token);
          sessionStorage.setItem('bdu_user', JSON.stringify(AppState.user));
          sessionStorage.setItem('bdu_token_expires_at', expiresAt.toString());
        }

        showToast(`Xin chào, ${res.name}!`, 'success');
        switchToDashboard();
        await loadAllDashboardData();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        setButtonLoading(btn, false);
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      handleLogout({ reason: 'Đã đăng xuất tài khoản.', isExpired: false });
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      showToast('Đang làm mới dữ liệu...', 'info');
      await loadAllDashboardData();
      showToast('Đã làm mới dữ liệu thành công!', 'success');
    });
  }

  // Lắng nghe sự kiện hết hạn token từ API client
  window.addEventListener('bdu:session_expired', (e) => {
    const msg = e.detail?.message || 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    handleLogout({ reason: msg, isExpired: true });
  });

  // Kiểm tra phiên đăng nhập đã lưu
  const savedToken = localStorage.getItem('bdu_token') || sessionStorage.getItem('bdu_token');
  const savedUser = localStorage.getItem('bdu_user') || sessionStorage.getItem('bdu_user');
  const savedExp = localStorage.getItem('bdu_token_expires_at') || sessionStorage.getItem('bdu_token_expires_at');

  if (savedToken && savedUser) {
    if (savedExp && Date.now() >= parseInt(savedExp, 10)) {
      handleLogout({ reason: 'Phiên đăng nhập trước đó đã hết hạn. Vui lòng đăng nhập lại.', isExpired: true });
    } else {
      try {
        AppState.token = savedToken;
        AppState.user = JSON.parse(savedUser);
        switchToDashboard();
        loadAllDashboardData();
      } catch (e) {
        handleLogout({ reason: 'Dữ liệu phiên không hợp lệ. Vui lòng đăng nhập lại.', isExpired: true });
      }
    }
  }

  // Định kỳ kiểm tra hết hạn token (mỗi 30 giây và khi quay lại tab)
  setInterval(checkTokenExpiration, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkTokenExpiration();
  });
}

/**
 * Xử lý đăng xuất / kết thúc phiên làm việc
 */
function handleLogout(options = {}) {
  const { reason = 'Đã đăng xuất tài khoản.', isExpired = false } = options;
  if (AppState.englishSessionId) {
    BduApi.closeEnglishSession(AppState.englishSessionId).catch(() => { });
  }
  AppState.englishEventSource?.close();
  AppState.eventSource?.close();
  localStorage.removeItem('bdu_token');
  localStorage.removeItem('bdu_user');
  localStorage.removeItem('bdu_token_expires_at');
  sessionStorage.removeItem('bdu_token');
  sessionStorage.removeItem('bdu_user');
  sessionStorage.removeItem('bdu_token_expires_at');

  AppState.user = null;
  AppState.token = null;
  AppState.semesters = [];
  AppState.rawGradeData = null;
  AppState.academicRanking = null;
  AppState.leaderboard.loaded = false;
  AppState.englishSessionId = null;
  AppState.englishEventSource = null;
  AppState.englishActivities = [];
  AppState.eventSource = null;

  const dashView = document.getElementById('dashboard-view');
  const loginView = document.getElementById('login-view');
  if (dashView) dashView.classList.add('hidden');
  if (loginView) loginView.classList.remove('hidden');

  if (isExpired) {
    showToast(reason || 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.', 'warning');
  } else {
    showToast(reason, 'info');
  }
}

/**
 * Tính toán thời điểm hết hạn của Token (miliseconds timestamp)
 */
function getTokenExpTime(token, expiresInSeconds) {
  if (expiresInSeconds && !isNaN(expiresInSeconds)) {
    return Date.now() + parseInt(expiresInSeconds, 10) * 1000;
  }
  if (typeof token === 'string' && token.includes('.')) {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.exp) {
          return payload.exp * 1000;
        }
      }
    } catch (e) { }
  }
  // Mặc định 24 tiếng nếu không rõ
  return Date.now() + 24 * 60 * 60 * 1000;
}

/**
 * Kiểm tra xem token đã hết hạn chưa và tự động ngắt phiên
 */
function checkTokenExpiration() {
  if (!AppState.token) return;
  const expStr = localStorage.getItem('bdu_token_expires_at') || sessionStorage.getItem('bdu_token_expires_at');
  if (expStr) {
    const expTime = parseInt(expStr, 10);
    if (!isNaN(expTime) && Date.now() >= expTime) {
      handleLogout({ reason: 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.', isExpired: true });
    }
  }
}

function setButtonLoading(btn, loading) {
  if (!btn) return;
  const text = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');
  btn.disabled = loading;
  if (text) text.classList.toggle('hidden', loading);
  if (loader) loader.classList.toggle('hidden', !loading);
}

function switchToDashboard() {
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('dashboard-view').classList.remove('hidden');

  const name = AppState.user?.name || 'Sinh viên BDU';
  const mssv = AppState.user?.mssv || 'MSSV';
  const avatarInitials = getInitials(name);

  const navName = document.getElementById('nav-user-name');
  const navMssv = document.getElementById('nav-user-mssv');
  const navAvatar = document.getElementById('user-avatar');
  if (navName) navName.textContent = name;
  if (navMssv) navMssv.textContent = `MSSV: ${mssv}`;
  if (navAvatar) navAvatar.textContent = avatarInitials;

  const heroAvatar = document.getElementById('hero-avatar');
  const heroName = document.getElementById('hero-name');
  const heroMssv = document.getElementById('hero-mssv');
  const heroEmail = document.getElementById('hero-email');
  if (heroAvatar) heroAvatar.textContent = avatarInitials;
  if (heroName) heroName.textContent = name;
  if (heroMssv) heroMssv.textContent = mssv;
  if (heroEmail) heroEmail.textContent = AppState.user?.email || `${mssv}@student.bdu.edu.vn`;

}

function getInitials(name) {
  if (!name) return 'SV';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ============================================================================
// NAVIGATION & TABS
// ============================================================================
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const topbarTitle = document.getElementById('topbar-page-title');
  const toggleSidebarBtn = document.getElementById('btn-toggle-sidebar');
  const sidebar = document.querySelector('.sidebar');

  const tabTitles = {
    'tab-grades': 'Bảng Điểm & GPA',
    'tab-profile': 'Lý Lịch Sinh Viên',
    'tab-schedule': 'Thời Khóa Biểu',
    'tab-leaderboard': 'Bảng Xếp Hạng',
    'tab-wordfmt': 'Chuẩn Hóa Word BDU',
    'tab-survey': 'Auto Đánh Giá Khảo Sát',
    'tab-english': 'Auto Bài Tập Tiếng Anh',
    'tab-enrollment': 'Auto Đăng Ký Môn Học',
    'tab-learning': 'Kho Tài Liệu & Video Tự Học'
  };

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.getAttribute('data-tab');
      if (!tabId) return;

      const activateTab = () => {
        navItems.forEach(n => n.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));

        item.classList.add('active');
        const targetPane = document.getElementById(tabId);
        if (targetPane) targetPane.classList.add('active');

        if (topbarTitle && tabTitles[tabId]) {
          topbarTitle.textContent = tabTitles[tabId];
        }

        if (sidebar && window.innerWidth <= 992) {
          sidebar.classList.remove('open');
        }

        if (tabId === 'tab-leaderboard' && !AppState.leaderboard.loaded) {
          loadAcademicLeaderboard();
        }
      };

      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (document.startViewTransition && !reduceMotion) {
        document.startViewTransition(activateTab);
      } else {
        activateTab();
      }
    });
  });

  if (toggleSidebarBtn && sidebar) {
    toggleSidebarBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }
}

// ============================================================================
// DATA LOADING
// ============================================================================
async function loadAllDashboardData() {
  if (!AppState.token) return;

  try {
    // 1. Fetch real grade data from BDU
    const gradeResponse = await BduApi.getGrades(AppState.token);
    AppState.rawGradeData = gradeResponse;
    const raw = (gradeResponse && gradeResponse.data) ? gradeResponse.data : gradeResponse;
    AppState.semesters = (raw && raw.ds_diem_hocky) ? raw.ds_diem_hocky : (Array.isArray(raw) ? raw : []);

    renderStudentOverview();
    populateSemesterDropdown();
    renderCharts(AppState.semesters);
    renderGradeTable();

    // Ranking failures must not block grades, profile, schedule or other tools.
    await loadAcademicRanking();

    // 2. Load Profile & Photo directly from BDU API
    const maSV = AppState.user?.mssv || '';
    const idsv = AppState.user?.idsv || AppState.user?.id_sinh_vien || '';
    const profileRes = await BduApi.getProfile(AppState.token, idsv, maSV);
    renderProfile(profileRes);

    // 3. Load Schedule (Real BDU API)
    const schedule = await BduApi.getSchedule(AppState.token);
    renderSchedule(schedule);

    // 4. Load Learning Hub
    const learning = await BduApi.getLearningResources();
    renderLearningHub(learning);

  } catch (err) {
    console.error('Failed to load dashboard data:', err);
    showToast(err.message, 'error');
  }
}

async function loadAcademicRanking() {
  try {
    AppState.academicRanking = await BduApi.getMyAcademicRanking(AppState.token);
    renderAcademicRanking(AppState.academicRanking);
  } catch (error) {
    AppState.academicRanking = null;
    renderAcademicRanking(null, error.message);
    console.info('Academic ranking is unavailable:', error.message);
  }
}

function renderAcademicRanking(data, unavailableMessage = '') {
  const setHighlightedRank = (elementId, rank) => {
    const caption = document.getElementById(elementId);
    if (!caption) return;
    if (!rank?.hang) {
      caption.textContent = unavailableMessage ? 'Chưa có hạng' : 'Đang cập nhật hạng...';
      caption.removeAttribute('title');
      return;
    }
    caption.textContent = `#${rank.hang} ${rank.pham_vi}`;
    caption.title = `Hạng ${rank.hang}/${rank.tong_sinh_vien} sinh viên ${rank.pham_vi}`;
  };

  const gpaBestRank = data?.xep_hang_noi_bat?.gpa_tich_luy;
  const creditBestRank = data?.xep_hang_noi_bat?.tin_chi_tich_luy;
  const overallBestRank = data?.xep_hang_noi_bat?.tong_hop;
  setHighlightedRank('stat-gpa-10-school-rank', gpaBestRank);
  setHighlightedRank('stat-gpa-school-rank', gpaBestRank);
  setHighlightedRank('stat-credit-school-rank', creditBestRank);

  const overallBadge = document.getElementById('hero-overall-rank-badge');
  if (overallBadge) {
    overallBadge.classList.remove('rank-top-1', 'rank-top-2', 'rank-top-3', 'rank-top-10');
    if (!overallBestRank?.hang) {
      overallBadge.classList.add('hidden');
      overallBadge.removeAttribute('title');
      return;
    }

    const overallScopeLabel = String(overallBestRank.pham_vi || '')
      .toLocaleUpperCase('vi-VN');
    overallBadge.textContent = `#${overallBestRank.hang} · ${overallScopeLabel}`;
    overallBadge.title = `Hạng tổng ${overallBestRank.hang}/${overallBestRank.tong_sinh_vien} sinh viên ${overallBestRank.pham_vi}`;
    overallBadge.classList.remove('hidden');
    if (overallBestRank.hang <= 3) {
      overallBadge.classList.add(`rank-top-${overallBestRank.hang}`);
    } else if (overallBestRank.hang <= 10) {
      overallBadge.classList.add('rank-top-10');
    }
  }
}

function initLeaderboard() {
  document.querySelectorAll('#leaderboard-scope-buttons button').forEach((button) => {
    button.addEventListener('click', () => {
      AppState.leaderboard.scope = button.dataset.scope;
      updateLeaderboardSegments();
      loadAcademicLeaderboard();
    });
  });
  document.querySelectorAll('#leaderboard-metric-buttons button').forEach((button) => {
    button.addEventListener('click', () => {
      AppState.leaderboard.metric = button.dataset.metric;
      updateLeaderboardSegments();
      loadAcademicLeaderboard();
    });
  });
}

function updateLeaderboardSegments() {
  document.querySelectorAll('#leaderboard-scope-buttons button').forEach((button) => {
    button.classList.toggle('active', button.dataset.scope === AppState.leaderboard.scope);
  });
  document.querySelectorAll('#leaderboard-metric-buttons button').forEach((button) => {
    button.classList.toggle('active', button.dataset.metric === AppState.leaderboard.metric);
  });
}

function formatLeaderboardValue(student, metric) {
  return metric === 'credits'
    ? `${Number(student.gia_tri).toLocaleString('vi-VN')} TC`
    : Number(student.gia_tri).toFixed(2);
}

function formatOverallGpa(student) {
  return Number(student.gpa_tich_luy).toFixed(2);
}

function formatOverallCredits(student) {
  return `${Number(student.tin_chi_tich_luy).toLocaleString('vi-VN')} TC`;
}

function updateStickyCurrentRankDetails(student, metric, selectedScope) {
  const stickyRank = document.getElementById('leaderboard-current-rank');
  const stickyPosition = document.getElementById('leaderboard-current-position');
  const stickyName = document.getElementById('leaderboard-current-name');
  const stickyMssv = document.getElementById('leaderboard-current-mssv');
  const stickyGroup = document.getElementById('leaderboard-current-group');
  const stickyValue = document.getElementById('leaderboard-current-value');
  const stickyCredit = document.getElementById('leaderboard-current-credit');
  if (!stickyRank || !student) return;
  const isOverall = metric === 'overall';

  const scopeLabels = {
    class: 'lớp',
    faculty: 'khoa',
    institute: 'viện',
    school: 'toàn trường'
  };
  if (stickyPosition) stickyPosition.textContent = `#${student.hang}`;
  if (stickyName) stickyName.textContent = student.ho_ten || 'Sinh viên BDU';
  if (stickyMssv) stickyMssv.textContent = student.mssv || '--';
  if (stickyGroup) stickyGroup.textContent = student.ma_lop || '--';
  if (stickyValue) {
    stickyValue.textContent = isOverall
      ? formatOverallGpa(student)
      : formatLeaderboardValue(student, metric);
  }
  if (stickyCredit) {
    stickyCredit.textContent = isOverall ? formatOverallCredits(student) : '--';
    stickyCredit.classList.toggle('hidden', !isOverall);
  }
  stickyRank.classList.toggle('is-overall', isOverall);
  stickyRank.classList.remove('is-top-1', 'is-top-2', 'is-top-3');
  if (student.hang <= 3) stickyRank.classList.add(`is-top-${student.hang}`);
  stickyRank.setAttribute(
    'aria-label',
    isOverall
      ? `Bạn, hạng tổng ${student.hang} ${scopeLabels[selectedScope] || ''}, GPA ${formatOverallGpa(student)}, tín chỉ ${formatOverallCredits(student)}`
      : `Bạn, hạng ${student.hang} ${scopeLabels[selectedScope] || ''}, ${metric === 'credits' ? 'tín chỉ' : 'GPA'} ${formatLeaderboardValue(student, metric)}`
  );
}

async function loadAcademicLeaderboard() {
  if (!AppState.token) return;
  if (AppState.leaderboard.loading) {
    AppState.leaderboard.reloadRequested = true;
    return;
  }
  const loading = document.getElementById('leaderboard-loading');
  const empty = document.getElementById('leaderboard-empty');
  const tableWrap = document.getElementById('leaderboard-table-wrap');
  AppState.leaderboard.loading = true;
  loading?.classList.remove('hidden');
  empty?.classList.add('hidden');
  tableWrap?.classList.add('hidden');

  try {
    const data = await BduApi.getAcademicLeaderboard(AppState.token, AppState.leaderboard);
    AppState.leaderboard.loaded = true;
    renderAcademicLeaderboard(data);
  } catch (error) {
    if (loading) loading.classList.add('hidden');
    if (empty) {
      empty.textContent = error.message || 'Chưa thể tải bảng xếp hạng lúc này. Vui lòng thử lại sau.';
      empty.classList.remove('hidden');
    }
  } finally {
    AppState.leaderboard.loading = false;
    if (AppState.leaderboard.reloadRequested) {
      AppState.leaderboard.reloadRequested = false;
      loadAcademicLeaderboard();
    }
  }
}

function renderAcademicLeaderboard(data) {
  const loading = document.getElementById('leaderboard-loading');
  const empty = document.getElementById('leaderboard-empty');
  const tableWrap = document.getElementById('leaderboard-table-wrap');
  const tableScroll = document.getElementById('leaderboard-table-scroll');
  const tableBody = document.getElementById('leaderboard-table-body');
  const table = document.querySelector('.leaderboard-table');
  const eyebrow = document.getElementById('leaderboard-eyebrow');
  const title = document.getElementById('leaderboard-title');
  const count = document.getElementById('leaderboard-student-count');
  const updatedAt = document.getElementById('leaderboard-updated-at');
  const contextDescription = document.getElementById('leaderboard-context-description');
  const groupHeading = document.getElementById('leaderboard-group-heading');
  const valueHeading = document.querySelector('.leaderboard-value-heading');
  const creditHeading = document.getElementById('leaderboard-credit-heading');
  const stickyRank = document.getElementById('leaderboard-current-rank');
  if (!tableBody) return;

  stickyRank?.classList.add('hidden');
  tableScroll?.classList.remove('has-sticky-current-rank');

  const scopeLabels = {
    class: 'Trong lớp',
    faculty: 'Trong khoa',
    institute: 'Trong viện',
    school: 'Toàn trường'
  };
  const isOverall = data.metric === 'overall';
  const metricLabels = {
    gpa: 'GPA tích lũy',
    credits: 'Tín chỉ tích lũy',
    overall: 'Xếp hạng tổng'
  };
  const metricLabel = metricLabels[data.metric] || metricLabels.gpa;
  const context = data.context || {};
  const contextLabels = {
    class: `Lớp ${context.class_code || '--'}`,
    faculty: `Khoa ${context.faculty_code || '--'}`,
    institute: `Viện ${context.institute_code || '--'}`,
    school: `Toàn trường · Khóa ${data.cohort}`
  };

  if (eyebrow) eyebrow.textContent = `${scopeLabels[data.scope]} · ${metricLabel}`.toUpperCase();
  if (title) title.textContent = `Xếp hạng ${contextLabels[data.scope]}`;
  if (contextDescription) {
    contextDescription.textContent = 'So sánh thành tích học tập theo phạm vi bạn chọn';
  }
  if (count) count.textContent = `${data.student_count} sinh viên`;
  if (updatedAt) {
    updatedAt.textContent = data.synced_at
      ? `Cập nhật ${new Date(data.synced_at).toLocaleString('vi-VN')}`
      : 'Dữ liệu mới nhất';
  }
  if (groupHeading) groupHeading.textContent = 'Lớp';
  if (valueHeading) valueHeading.textContent = isOverall ? 'GPA' : metricLabel;
  if (creditHeading) creditHeading.classList.toggle('hidden', !isOverall);
  table?.classList.toggle('is-overall', isOverall);

  tableBody.innerHTML = '';
  let currentStudent = null;
  for (const student of data.students || []) {
    const row = document.createElement('tr');
    if (student.la_sinh_vien_hien_tai) {
      row.classList.add('is-current-student');
      row.dataset.currentStudent = 'true';
      currentStudent = student;
    }
    if (student.hang <= 3) row.classList.add(`is-top-${student.hang}`);

    const rankCell = document.createElement('td');
    const rankBadge = document.createElement('span');
    rankBadge.className = 'leaderboard-rank-badge';
    rankBadge.textContent = `#${student.hang}`;
    rankCell.appendChild(rankBadge);

    const studentCell = document.createElement('td');
    const identity = document.createElement('div');
    identity.className = 'leaderboard-student-identity';
    const name = document.createElement('strong');
    name.textContent = student.ho_ten || 'Sinh viên BDU';
    const meta = document.createElement('span');
    meta.textContent = student.mssv;
    identity.append(name, meta);
    if (student.la_sinh_vien_hien_tai) {
      const you = document.createElement('em');
      you.textContent = 'Bạn';
      identity.appendChild(you);
    }
    studentCell.appendChild(identity);

    const groupCell = document.createElement('td');
    groupCell.className = 'leaderboard-group-cell';
    groupCell.textContent = student.ma_lop || '--';

    const valueCell = document.createElement('td');
    valueCell.className = 'leaderboard-score-cell';
    valueCell.textContent = isOverall
      ? formatOverallGpa(student)
      : formatLeaderboardValue(student, data.metric);
    row.append(rankCell, studentCell, groupCell, valueCell);
    if (isOverall) {
      const creditCell = document.createElement('td');
      creditCell.className = 'leaderboard-score-cell';
      creditCell.textContent = formatOverallCredits(student);
      row.appendChild(creditCell);
    }
    tableBody.appendChild(row);
  }

  loading?.classList.add('hidden');
  const hasStudents = Boolean(data.students?.length);
  empty?.classList.toggle('hidden', hasStudents);
  tableWrap?.classList.toggle('hidden', !hasStudents);

  if (currentStudent && stickyRank) {
    updateStickyCurrentRankDetails(currentStudent, data.metric, data.scope);
    stickyRank.classList.remove('hidden');
    tableScroll?.classList.add('has-sticky-current-rank');
  }
}

// ============================================================================
// TAB 1: GRADES & GPA PROCESSING (BDU FORMAT)
// ============================================================================
function renderStudentOverview() {
  if (!AppState.semesters || AppState.semesters.length === 0) return;

  // BDU API trả về ds_diem_hocky theo thứ tự từ học kỳ mới nhất (index 0)
  const latestCumulativeSem = AppState.semesters.find(s => s.dtb_tich_luy_he_10 && s.dtb_tich_luy_he_10.toString().trim() !== '')
    || AppState.semesters.find(s => s.so_tin_chi_dat_tich_luy && s.so_tin_chi_dat_tich_luy.toString().trim() !== '')
    || AppState.semesters[0];

  const gpa10 = latestCumulativeSem.dtb_tich_luy_he_10 || latestCumulativeSem.dtb_hk_he10 || '--';
  const gpa4 = latestCumulativeSem.dtb_tich_luy_he_4 || latestCumulativeSem.dtb_hk_he4 || '--';
  const credits = latestCumulativeSem.so_tin_chi_dat_tich_luy || latestCumulativeSem.so_tin_chi_dat_hk || '0';
  const rank = latestCumulativeSem.xep_loai_tkb_hk || latestCumulativeSem.xep_loai_tkb_hk_eg || calculateRank(parseFloat(gpa10), parseFloat(gpa4));

  document.getElementById('stat-gpa-10').textContent = formatScore(gpa10);
  document.getElementById('stat-gpa-4').textContent = formatScore(gpa4);
  document.getElementById('stat-credits').textContent = `${credits} TC`;
  document.getElementById('stat-rank').textContent = rank;
}

function calculateRank(gpa10, gpa4) {
  if (!isNaN(gpa4) && gpa4 > 0) {
    if (gpa4 >= 3.6) return 'Xuất sắc';
    if (gpa4 >= 3.2) return 'Giỏi';
    if (gpa4 >= 2.5) return 'Khá';
    if (gpa4 >= 2.0) return 'Trung bình';
    return 'Yếu';
  }
  if (!isNaN(gpa10) && gpa10 > 0) {
    if (gpa10 >= 9.0) return 'Xuất sắc';
    if (gpa10 >= 8.0) return 'Giỏi';
    if (gpa10 >= 6.5) return 'Khá';
    if (gpa10 >= 5.0) return 'Trung bình';
    return 'Yếu';
  }
  return 'Đang học';
}

function formatScore(val) {
  if (val === undefined || val === null || val === '' || val === '--') return '--';
  const num = parseFloat(val);
  return isNaN(num) ? val : num.toFixed(2);
}

function getGradeLetterClass(letter) {
  if (!letter) return '';
  const l = letter.trim().toUpperCase();
  if (l.startsWith('A')) return 'grade-a';
  if (l.startsWith('B')) return 'grade-b';
  if (l.startsWith('C')) return 'grade-c';
  if (l.startsWith('D')) return 'grade-d';
  if (l.startsWith('F')) return 'grade-f';
  return '';
}

function renderCharts(semesters) {
  if (!semesters || semesters.length === 0) return;

  const isDark = document.body.classList.contains('theme-dark');
  const textColor = isDark ? '#c0b8ae' : '#625f59';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(79, 70, 61, 0.09)';

  // 1. GPA Trend Chart (Reverse to show chronological order: past -> now)
  const chronoSemesters = [...semesters].reverse();
  const labels = chronoSemesters.map(s => {
    let name = s.ten_hoc_ky || `HK ${s.hoc_ky}`;
    return name.replace('Học kỳ', 'HK').replace('Năm học', 'NH');
  });

  const gpa10Values = chronoSemesters.map(s => parseFloat(s.dtb_hk_he10) || parseFloat(s.dtb_tich_luy_he_10) || null);
  const gpa4Values = chronoSemesters.map(s => parseFloat(s.dtb_hk_he4) || parseFloat(s.dtb_tich_luy_he_4) || null);

  const gpaCtx = document.getElementById('gpaTrendChart');
  if (gpaCtx) {
    if (AppState.gpaChart) AppState.gpaChart.destroy();
    AppState.gpaChart = new Chart(gpaCtx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'GPA HK (Thang 10)',
            data: gpa10Values,
            borderColor: '#8c1515',
            backgroundColor: 'rgba(140, 21, 21, 0.08)',
            tension: 0.35,
            fill: true,
            yAxisID: 'y10',
            pointRadius: 4,
            pointHoverRadius: 6
          },
          {
            label: 'GPA HK (Thang 4)',
            data: gpa4Values,
            borderColor: '#9a6700',
            backgroundColor: 'rgba(154, 103, 0, 0.06)',
            tension: 0.35,
            fill: true,
            yAxisID: 'y4',
            pointRadius: 4,
            pointHoverRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } } },
          y10: { type: 'linear', position: 'left', min: 0, max: 10, ticks: { color: '#8c1515' }, grid: { color: gridColor } },
          y4: { type: 'linear', position: 'right', min: 0, max: 4, ticks: { color: '#9a6700' }, grid: { display: false } }
        },
        plugins: {
          legend: { labels: { color: textColor, font: { family: 'Manrope', weight: '600' } } }
        }
      }
    });
  }

  // 2. Count letter grades across all courses
  const counts = { 'A': 0, 'B+': 0, 'B': 0, 'C+': 0, 'C': 0, 'D+': 0, 'D': 0, 'F': 0 };
  let hasLetterData = false;

  semesters.forEach(sem => {
    (sem.ds_diem_mon_hoc || []).forEach(c => {
      const letter = (c.diem_tk_chu || '').trim().toUpperCase();
      if (counts.hasOwnProperty(letter)) {
        counts[letter]++;
        hasLetterData = true;
      }
    });
  });

  const distCtx = document.getElementById('gradeDistChart');
  if (distCtx) {
    if (AppState.distChart) AppState.distChart.destroy();
    AppState.distChart = new Chart(distCtx, {
      type: 'doughnut',
      data: {
        labels: Object.keys(counts),
        datasets: [{
          data: Object.values(counts),
          backgroundColor: [
            '#285943', // A
            '#4f745f', // B+
            '#718477', // B
            '#9b8f7b', // C+
            '#b89a56', // C
            '#b66d4a', // D+
            '#a54532', // D
            '#8c1515'  // F
          ],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: textColor, boxWidth: 10, font: { size: 10 } } }
        },
        cutout: '65%'
      }
    });
  }
}

function populateSemesterDropdown() {
  const select = document.getElementById('semester-select');
  if (!select) return;
  select.innerHTML = '<option value="ALL">Tất cả các học kỳ</option>';

  AppState.semesters.forEach(sem => {
    const opt = document.createElement('option');
    opt.value = sem.hoc_ky || sem.ten_hoc_ky;
    opt.textContent = sem.ten_hoc_ky || ('Học kỳ ' + sem.hoc_ky);
    select.appendChild(opt);
  });
}

function initGradeFilters() {
  const semSelect = document.getElementById('semester-select');
  const statusSelect = document.getElementById('status-filter');
  const searchInput = document.getElementById('search-subject');
  const exportBtn = document.getElementById('btn-export-csv');
  const printBtn = document.getElementById('btn-print');

  const triggerFilter = () => {
    AppState.selectedSemester = semSelect?.value || 'ALL';
    AppState.filterStatus = statusSelect?.value || 'ALL';
    AppState.searchQuery = (searchInput?.value || '').toLowerCase().trim();
    renderGradeTable();
  };

  if (semSelect) semSelect.addEventListener('change', triggerFilter);
  if (statusSelect) statusSelect.addEventListener('change', triggerFilter);
  if (searchInput) searchInput.addEventListener('input', triggerFilter);

  if (exportBtn) exportBtn.addEventListener('click', exportGradesToCSV);
  if (printBtn) printBtn.addEventListener('click', () => window.print());
}

function renderGradeTable() {
  const container = document.getElementById('semester-groups-container');
  const emptyBox = document.getElementById('table-empty');
  if (!container) return;

  container.innerHTML = '';
  let visibleCourses = 0;
  let visibleCredits = 0;

  AppState.semesters.forEach(sem => {
    const semId = sem.hoc_ky || sem.ten_hoc_ky;
    if (AppState.selectedSemester !== 'ALL' && AppState.selectedSemester !== semId) return;

    let courses = sem.ds_diem_mon_hoc || [];

    // Filter courses
    if (AppState.filterStatus === 'PASS') {
      courses = courses.filter(c => c.ket_qua == 1 || (c.diem_tk_chu && c.diem_tk_chu.toUpperCase() !== 'F'));
    } else if (AppState.filterStatus === 'FAIL') {
      courses = courses.filter(c => c.ket_qua == 0 || (c.diem_tk_chu && c.diem_tk_chu.toUpperCase() === 'F'));
    }

    if (AppState.searchQuery) {
      courses = courses.filter(c => {
        const name = (c.ten_mon || '').toLowerCase();
        const code = (c.ma_mon || '').toLowerCase();
        return name.includes(AppState.searchQuery) || code.includes(AppState.searchQuery);
      });
    }

    if (courses.length === 0 && (AppState.searchQuery || AppState.filterStatus !== 'ALL')) {
      return;
    }

    const semCredits = courses.reduce((sum, c) => sum + (parseInt(c.so_tin_chi) || 0), 0);
    visibleCourses += courses.length;
    visibleCredits += semCredits;

    const semTitle = sem.ten_hoc_ky || `Học kỳ ${sem.hoc_ky}`;
    const semBlock = document.createElement('div');
    semBlock.className = 'semester-block';

    semBlock.innerHTML = `
      <div class="semester-header">
        <div class="sem-title">${semTitle}</div>
        <div class="sem-meta">
          Môn học: <strong>${courses.length}</strong> | 
          Tín chỉ HK: <strong>${sem.so_tin_chi_dat_hk || semCredits}</strong> | 
          GPA HK (10): <strong>${formatScore(sem.dtb_hk_he10)}</strong> | 
          GPA HK (4): <strong>${formatScore(sem.dtb_hk_he4)}</strong>
        </div>
      </div>
      <div class="table-responsive">
        <table class="grade-table">
          <thead>
            <tr>
              <th>Mã Môn</th>
              <th>Tên Môn Học</th>
              <th>Số TC</th>
              <th>Điểm GK</th>
              <th>Điểm Thi</th>
              <th>Điểm TK (10)</th>
              <th>Điểm Hệ 4</th>
              <th>Điểm Chữ</th>
              <th>Kết Quả</th>
            </tr>
          </thead>
          <tbody>
            ${courses.length === 0 ? `
              <tr>
                <td colspan="9" style="text-align:center; color:var(--text-muted); padding:20px;">
                  Chưa có dữ liệu môn học cho học kỳ này.
                </td>
              </tr>
            ` : courses.map(c => {
      const isPass = c.ket_qua == 1 || (c.diem_tk_chu && c.diem_tk_chu.toUpperCase() !== 'F');
      const courseJson = encodeURIComponent(JSON.stringify({ ...c, sem_name: semTitle }));
      return `
                <tr class="course-row" onclick="window.showCourseDetail('${courseJson}')">
                  <td><code>${c.ma_mon || '--'}</code></td>
                  <td class="course-name-cell" title="Bấm để xem chi tiết điểm thành phần">
                    ${c.ten_mon || '--'}
                  </td>
                  <td><strong>${c.so_tin_chi || 0}</strong></td>
                  <td>${c.diem_giua_ky !== undefined && c.diem_giua_ky !== null && c.diem_giua_ky !== '' ? c.diem_giua_ky : '--'}</td>
                  <td>${c.diem_thi !== undefined && c.diem_thi !== null && c.diem_thi !== '' ? c.diem_thi : '--'}</td>
                  <td><strong>${c.diem_tk !== undefined && c.diem_tk !== null && c.diem_tk !== '' ? c.diem_tk : '--'}</strong></td>
                  <td><strong>${c.diem_tk_so !== undefined && c.diem_tk_so !== null && c.diem_tk_so !== '' ? c.diem_tk_so : '--'}</strong></td>
                  <td><span class="grade-pill ${getGradeLetterClass(c.diem_tk_chu)}">${c.diem_tk_chu || '--'}</span></td>
                  <td>${isPass ? '<span class="tag tag-active">Đạt</span>' : '<span class="tag" style="background:rgba(239,68,68,0.2);color:#f87171;">Chưa đạt</span>'}</td>
                </tr>
              `;
    }).join('')}
          </tbody>
        </table>
      </div>
    `;

    container.appendChild(semBlock);
  });

  const countEl = document.getElementById('visible-courses-count');
  const credEl = document.getElementById('visible-credits-count');
  if (countEl) countEl.textContent = visibleCourses.toString();
  if (credEl) credEl.textContent = visibleCredits.toString();

  if (emptyBox) {
    emptyBox.classList.toggle('hidden', visibleCourses > 0);
  }
}

function exportGradesToCSV() {
  if (!AppState.semesters || AppState.semesters.length === 0) {
    showToast('Chưa có dữ liệu bảng điểm để xuất CSV.', 'error');
    return;
  }

  const rows = [
    ['Học Kỳ', 'Mã Môn', 'Tên Môn Học', 'Số Tín Chỉ', 'Điểm GK', 'Điểm Thi', 'Điểm TK (10)', 'Điểm Hệ 4', 'Điểm Chữ', 'Kết Quả']
  ];

  AppState.semesters.forEach(sem => {
    const semId = sem.hoc_ky || sem.ten_hoc_ky;
    if (AppState.selectedSemester !== 'ALL' && AppState.selectedSemester !== semId) return;

    (sem.ds_diem_mon_hoc || []).forEach(c => {
      const isPass = c.ket_qua == 1 || (c.diem_tk_chu && c.diem_tk_chu.toUpperCase() !== 'F');
      rows.push([
        `"${sem.ten_hoc_ky || sem.hoc_ky}"`,
        `"${c.ma_mon || ''}"`,
        `"${c.ten_mon || ''}"`,
        c.so_tin_chi || 0,
        c.diem_giua_ky || '',
        c.diem_thi || '',
        c.diem_tk || '',
        c.diem_tk_so || '',
        c.diem_tk_chu || '',
        isPass ? 'Đạt' : 'Chưa đạt'
      ]);
    });
  });

  const csvContent = '\uFEFF' + rows.map(e => e.join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `BDU_BangDiem_${AppState.user?.mssv || 'SinhVien'}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('Đã xuất file CSV thành công!', 'success');
}

// ============================================================================
// TAB 2: PROFILE RENDERING
// ============================================================================
function renderProfile(profileRes) {
  if (!profileRes) return;

  const raw = profileRes.data || profileRes;
  const profileRecord = raw?.ds_thong_tin_sinh_vien
    || raw?.thong_tin_sinh_vien
    || raw?.student
    || raw?.sinh_vien;
  const p = Array.isArray(raw)
    ? raw[0]
    : (Array.isArray(profileRecord) ? profileRecord[0] : (profileRecord || raw));

  if (!p) return;

  const name = p.ho_ten || p.ho_va_ten || p.ten_day_du || p.ten_sinh_vien || p.name || AppState.user?.name || 'Sinh viên BDU';
  const mssv = p.ma_sinh_vien || p.ma_sv || p.userName || AppState.user?.mssv || '---';
  const dob = p.ngay_sinh || p.ngay_thang_nam_sinh || '--/--/----';
  const gender = p.gioi_tinh || p.ten_gioi_tinh || '---';
  const status = p.ten_tinh_trang || p.tinh_trang_hoc || p.trang_thai_hoc || p.hien_dien_sv || p.trang_thai || 'Đang học';

  const className = p.ten_lop || p.ten_lop_hanh_chinh || p.lop_hanh_chinh || p.lop || p.ma_lop || '---';
  const major = p.ten_chuyen_nganh || p.ten_nganh || p.ten_nganh_dao_tao || p.nganh || '---';
  const faculty = p.ten_khoa || p.ten_khoa_quan_ly || p.khoa || '---';
  const educationLevel = p.ten_bac_dao_tao || p.ten_he_dao_tao || p.he_dao_tao || p.bac_he_dao_tao || p.bac_dao_tao || p.hinh_thuc_hoc || 'Chính quy';
  const cohortYears = p.nien_khoa || p.ten_nien_khoa || p.khoa_hoc || p.nien_khoa_dao_tao || '---';

  const advisorId = p.ma_co_van_hoc_tap || p.ma_cvht || p.tai_khoan_cvht || p.ma_giang_vien || '--';
  const advisorName = p.ten_co_van_hoc_tap
    || p.ho_ten_co_van_hoc_tap
    || p.ten_cvht
    || p.ho_ten_cvht
    || p.ten_giang_vien
    || p.ho_ten_giang_vien
    || 'Chưa cập nhật';
  const photoUrl = profileRes.student_image || p.hinh_anh || p.url_hinh_anh || p.image || p.anh_the || p.avatar || '';

  // 1. Thông tin sinh viên
  const elMssv = document.getElementById('p-mssv');
  const elName = document.getElementById('p-fullname');
  const elDob = document.getElementById('p-dob');
  const elGender = document.getElementById('p-gender');
  const elStatus = document.getElementById('p-status');

  if (elMssv) elMssv.textContent = mssv;
  if (elName) elName.textContent = name;
  if (elDob) elDob.textContent = dob;
  if (elGender) elGender.textContent = gender;
  if (elStatus) elStatus.textContent = status;

  // Avatar / Photo
  const imgEl = document.getElementById('profile-student-photo');
  const avatarPlaceholder = document.getElementById('card-avatar');
  if (photoUrl && imgEl) {
    let fullPhotoUrl = photoUrl;
    if (!fullPhotoUrl.startsWith('http') && !fullPhotoUrl.startsWith('data:')) {
      fullPhotoUrl = (fullPhotoUrl.startsWith('/') ? 'https://sv.bdu.edu.vn' : 'https://sv.bdu.edu.vn/') + fullPhotoUrl;
    }
    imgEl.src = fullPhotoUrl;
    imgEl.onload = () => {
      imgEl.classList.remove('hidden');
      if (avatarPlaceholder) avatarPlaceholder.classList.add('hidden');
      const navAvatar = document.getElementById('user-avatar');
      const heroAvatar = document.getElementById('hero-avatar');
      if (navAvatar) navAvatar.innerHTML = `<img src="${fullPhotoUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
      if (heroAvatar) heroAvatar.innerHTML = `<img src="${fullPhotoUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    };
    imgEl.onerror = () => {
      imgEl.classList.add('hidden');
      if (avatarPlaceholder) {
        avatarPlaceholder.classList.remove('hidden');
        avatarPlaceholder.textContent = getInitials(name);
      }
    };
  } else if (avatarPlaceholder) {
    if (imgEl) imgEl.classList.add('hidden');
    avatarPlaceholder.classList.remove('hidden');
    avatarPlaceholder.textContent = getInitials(name);
  }

  // 2. Thông tin khóa học
  const elClass = document.getElementById('p-class');
  const elMajor = document.getElementById('p-major');
  const elFaculty = document.getElementById('p-faculty');
  const elEdu = document.getElementById('p-education-level');
  const elCohort = document.getElementById('p-cohort-years');

  if (elClass) elClass.textContent = className;
  if (elMajor) elMajor.textContent = major;
  if (elFaculty) elFaculty.textContent = faculty;
  if (elEdu) elEdu.textContent = educationLevel;
  if (elCohort) elCohort.textContent = cohortYears;

  // 3. Cố vấn học tập
  const elAdvId = document.getElementById('p-advisor-id');
  const elAdvName = document.getElementById('p-advisor-name');

  if (elAdvId) elAdvId.textContent = advisorId;
  if (elAdvName) elAdvName.textContent = advisorName;

  const btnMailAdvisor = document.getElementById('btn-mail-advisor');
  if (btnMailAdvisor) {
    const advEmail = p.email_co_van_hoc_tap || p.email_cvht || p.email_giang_vien || (advisorId !== '--' ? `${advisorId}@bdu.edu.vn` : '');
    if (advEmail) {
      btnMailAdvisor.href = `mailto:${advEmail}`;
      btnMailAdvisor.removeAttribute('aria-disabled');
    } else {
      btnMailAdvisor.removeAttribute('href');
      btnMailAdvisor.setAttribute('aria-disabled', 'true');
    }
  }

}

// ============================================================================
// TAB 3: SCHEDULE RENDERING (REAL BDU SCHEDULE & MULTI-SEMESTER SUPPORT)
// ============================================================================
function initScheduleTab() {
  const semSelect = document.getElementById('schedule-semester-select');
  if (semSelect) {
    semSelect.addEventListener('change', async (e) => {
      const selectedHocKy = e.target.value;
      const statusText = document.getElementById('schedule-status-text');
      if (statusText) statusText.textContent = 'Đang tải...';

      try {
        const schedule = await BduApi.getSchedule(AppState.token, selectedHocKy);
        renderSchedule(schedule);
        showToast(`Đã tải TKB: ${semSelect.options[semSelect.selectedIndex]?.text || selectedHocKy}`, 'info');
      } catch (err) {
        console.error('Schedule fetch error:', err);
        showToast(err.message || 'Không thể tải thời khóa biểu học kỳ này.', 'error');
      }
    });
  }
}

function renderSchedule(scheduleData) {
  const container = document.getElementById('schedule-grid');
  const semSelect = document.getElementById('schedule-semester-select');
  const statusText = document.getElementById('schedule-status-text');
  const subtitle = document.getElementById('schedule-subtitle');
  if (!container || !scheduleData) return;

  // 1. Update status badges
  if (statusText) {
    statusText.textContent = scheduleData.isRealData ? 'Cổng BDU · Thời gian thực' : 'Dữ liệu mẫu học tập';
  }

  // 2. Populate semester dropdown if semesters list is available
  if (semSelect && Array.isArray(scheduleData.semesters) && scheduleData.semesters.length > 0) {
    const currentVal = scheduleData.selectedHocKy || semSelect.value;
    semSelect.innerHTML = scheduleData.semesters.map(s => {
      const val = s.hoc_ky || s.ma_hoc_ky || s.id;
      const text = s.ten_hoc_ky || s.ten || `Học kỳ ${val}`;
      const isSelected = String(val) === String(currentVal) ? 'selected' : '';
      return `<option value="${val}" ${isSelected}>${text}</option>`;
    }).join('');

    const selectedOption = semSelect.options[semSelect.selectedIndex];
    if (subtitle && selectedOption) {
      subtitle.textContent = `Lịch học: ${selectedOption.text} (Đồng bộ từ Cổng BDU)`;
    }
  }

  // 3. Extract items list from multiple possible BDU API response structures
  let items = [];
  if (Array.isArray(scheduleData.items)) {
    items = scheduleData.items;
  } else if (scheduleData.schedule) {
    const sch = scheduleData.schedule;
    if (Array.isArray(sch)) {
      items = sch;
    } else if (Array.isArray(sch.ds_thoi_khoa_bieu)) {
      items = sch.ds_thoi_khoa_bieu;
    } else if (Array.isArray(sch.ds_tuan_tkb)) {
      items = sch.ds_tuan_tkb;
    } else if (Array.isArray(sch.ds_lop_hoc_phan)) {
      items = sch.ds_lop_hoc_phan;
    } else if (Array.isArray(sch.data)) {
      items = sch.data;
    }
  }

  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="glass-panel" style="grid-column: 1 / -1; text-align: center; padding: 48px 24px; color: var(--text-muted);">
        <div class="empty-monogram">TKB</div>
        <h4 style="color: var(--text-main); font-size: 16px; margin-bottom: 6px;">Không có lịch học trong học kỳ này</h4>
        <p style="font-size: 13px;">Sinh viên chưa đăng ký học phần hoặc chưa có lịch xếp phòng từ phòng đào tạo.</p>
      </div>
    `;
    return;
  }

  // 4. Render cards
  container.innerHTML = items.map((rawItem, idx) => {
    const day = rawItem.thu || (rawItem.thu_kieu_so ? `Thứ ${rawItem.thu_kieu_so}` : (rawItem.day || `Buổi ${idx + 1}`));
    const courseName = rawItem.ten_mon_hoc || rawItem.ten_mon || rawItem.ten_hp || rawItem.courseName || 'Môn học BDU';
    const courseCode = rawItem.ma_mon_hoc || rawItem.ma_mon || rawItem.ma_hp || rawItem.courseCode || '--';
    const credits = rawItem.so_tin_chi || rawItem.credits || '3';

    let periods = rawItem.periods || '';
    if (!periods) {
      const startPeriod = rawItem.tiet_bat_dau || rawItem.tiet_bd;
      const periodCount = rawItem.so_tiet;
      if (startPeriod && periodCount) {
        const endPeriod = parseInt(startPeriod) + parseInt(periodCount) - 1;
        periods = `Tiết ${startPeriod} - ${endPeriod} (${periodCount} tiết)`;
      } else if (rawItem.tiet_hoc) {
        periods = `Tiết: ${rawItem.tiet_hoc}`;
      } else {
        periods = 'Lịch học tiêu chuẩn';
      }
    }

    const room = rawItem.phong_hoc || rawItem.ten_phong || rawItem.ten_phong_hoc || rawItem.room || 'Phòng học BDU';
    const lecturer = rawItem.ten_giang_vien || rawItem.giang_vien || rawItem.cb_giang_day || rawItem.lecturer || 'Giảng viên khoa';
    const note = rawItem.ghi_chu || rawItem.lop_hoc_phan || '';

    return `
      <div class="schedule-card glass-panel">
        <div>
          <div class="sch-day-badge">
            <span class="sch-day">${day}</span>
          </div>
          <h4 class="sch-name" title="${courseName}">${courseName}</h4>
          <div class="sch-meta">
            <div class="sch-meta-item">
              <strong>${periods}</strong>
            </div>
            <div class="sch-meta-item">
              <span class="sch-room-pill">${room}</span>
            </div>
            <div class="sch-meta-item">
              <span>${lecturer}</span>
            </div>
            ${note ? `
            <div class="sch-meta-item sch-note">
              <span style="font-size: 12px; color: var(--text-muted);">${note}</span>
            </div>` : ''}
          </div>
        </div>
        <div class="sch-footer">
          <span class="sch-code">Mã: <code>${courseCode}</code></span>
          <span class="badge-mini badge-pill-blue">${credits} Tín Chỉ</span>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================================
// TAB 4: WORDFMT INTEGRATION
// ============================================================================
function initWordFmtTool() {
  const dropzone = document.getElementById('docx-dropzone');
  const fileInput = document.getElementById('docx-file-input');
  const fileInfo = document.getElementById('dropzone-file-info');
  const fileName = document.getElementById('selected-file-name');
  const removeBtn = document.getElementById('btn-remove-file');
  const form = document.getElementById('form-wordfmt');
  const btnStart = document.getElementById('btn-start-wordfmt');

  const statusCard = document.getElementById('wordfmt-status-card');
  const successBox = document.getElementById('wordfmt-success-box');
  const progressBox = document.getElementById('wordfmt-progress-box');
  const downloadBtn = document.getElementById('btn-download-docx');
  const diagContainer = document.getElementById('diag-items');

  function createProgressSession() {
    const placeholder = statusCard?.querySelector('.status-placeholder-content');
    const progressFill = document.getElementById('wordfmt-progress-fill');
    const progressPercent = document.getElementById('wordfmt-progress-percent');
    const progressTime = document.getElementById('wordfmt-progress-time');
    const progressTitle = document.getElementById('wordfmt-progress-title');
    const progressDesc = document.getElementById('wordfmt-progress-desc');
    const progressRail = progressBox?.querySelector('.progress-rail');
    const stageItems = [...(progressBox?.querySelectorAll('.processing-stages li') || [])];
    const startedAt = performance.now();
    const timers = [];
    let currentProgress = 3;

    const stages = [
      { value: 12, title: 'Đang kiểm tra tài liệu', desc: 'Xác thực cấu trúc và khả năng tương thích của file DOCX.' },
      { value: 34, title: 'Đang phân tích cấu trúc', desc: 'Nhận diện heading, bảng biểu, hình ảnh và các phần nội dung.' },
      { value: 67, title: 'Đang áp dụng định dạng', desc: 'Chuẩn hóa font chữ, lề trang, mục lục và header/footer.' },
      { value: 88, title: 'Đang xác minh kết quả', desc: 'Kiểm tra tính toàn vẹn trước khi tạo file tải xuống.' }
    ];

    const render = (value, stageIndex, title, desc) => {
      currentProgress = Math.max(currentProgress, value);
      if (progressFill) progressFill.style.width = `${currentProgress}%`;
      if (progressPercent) progressPercent.textContent = `${Math.round(currentProgress)}%`;
      if (progressTitle && title) progressTitle.textContent = title;
      if (progressDesc && desc) progressDesc.textContent = desc;
      progressRail?.setAttribute('aria-valuenow', String(Math.round(currentProgress)));
      stageItems.forEach((item, index) => {
        item.classList.toggle('is-active', index === stageIndex);
        item.classList.toggle('is-complete', index < stageIndex);
      });
    };

    const schedule = (callback, delay) => {
      const timer = setTimeout(callback, delay);
      timers.push({ type: 'timeout', id: timer });
    };

    const clearTimers = () => {
      timers.forEach(timer => {
        if (timer.type === 'interval') clearInterval(timer.id);
        else clearTimeout(timer.id);
      });
      timers.length = 0;
    };

    placeholder?.classList.add('hidden');
    successBox?.classList.add('hidden');
    progressBox?.classList.remove('hidden', 'is-complete', 'is-error');
    statusCard?.classList.add('is-processing');
    stageItems.forEach(item => item.classList.remove('is-active', 'is-complete'));
    render(3, 0, stages[0].title, stages[0].desc);

    schedule(() => render(stages[0].value, 0, stages[0].title, stages[0].desc), 220);
    schedule(() => render(stages[1].value, 1, stages[1].title, stages[1].desc), 760);
    schedule(() => render(stages[2].value, 2, stages[2].title, stages[2].desc), 1450);
    schedule(() => render(stages[3].value, 3, stages[3].title, stages[3].desc), 2250);

    const clockTimer = setInterval(() => {
      const elapsedSeconds = Math.floor((performance.now() - startedAt) / 1000);
      const minutes = Math.floor(elapsedSeconds / 60);
      const seconds = elapsedSeconds % 60;
      if (progressTime) progressTime.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      if (elapsedSeconds >= 3 && currentProgress < 96) {
        render(Math.min(currentProgress + 0.6, 96), 3, 'Đang hoàn thiện file đầu ra', 'Engine đang hoàn tất những kiểm tra cuối cùng.');
      }
    }, 200);
    timers.push({ type: 'interval', id: clockTimer });

    const minimum = new Promise(resolve => schedule(resolve, 3000));

    return {
      minimum,
      async complete() {
        clearTimers();
        render(100, 3, 'Hoàn tất chuẩn hóa', 'Tài liệu đã vượt qua toàn bộ bước kiểm tra.');
        stageItems.forEach(item => item.classList.add('is-complete'));
        progressBox?.classList.add('is-complete');
        await new Promise(resolve => setTimeout(resolve, 480));
        progressBox?.classList.add('hidden');
        statusCard?.classList.remove('is-processing');
      },
      fail(message) {
        clearTimers();
        progressBox?.classList.add('is-error');
        statusCard?.classList.remove('is-processing');
        if (progressTitle) progressTitle.textContent = 'Không thể hoàn tất tài liệu';
        if (progressDesc) progressDesc.textContent = message || 'Vui lòng kiểm tra file và thử lại.';
      }
    };
  }

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', (e) => {
      if (e.target !== removeBtn) fileInput.click();
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        handleFileSelect(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) {
        handleFileSelect(fileInput.files[0]);
      }
    });
  }

  function handleFileSelect(file) {
    if (!file.name.endsWith('.docx')) {
      showToast('Vui lòng chỉ chọn file tài liệu Word (.docx).', 'error');
      return;
    }
    AppState.selectedFile = file;
    fileName.textContent = file.name;
    fileInfo.classList.remove('hidden');
    dropzone.querySelector('.dropzone-content').classList.add('hidden');
  }

  if (removeBtn) {
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      AppState.selectedFile = null;
      fileInput.value = '';
      fileInfo.classList.add('hidden');
      dropzone.querySelector('.dropzone-content').classList.remove('hidden');
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!AppState.selectedFile) {
        showToast('Vui lòng chọn hoặc kéo thả file .docx vào khung trước!', 'error');
        return;
      }

      const instructor = document.getElementById('wf-instructor')?.value.trim() || '';
      const student = document.getElementById('wf-student')?.value.trim() || '';
      const studentId = document.getElementById('wf-student-id')?.value.trim() || '';
      const className = document.getElementById('wf-class-name')?.value.trim() || '';
      const topic = document.getElementById('wf-topic')?.value.trim() || '';
      const docTitle = document.getElementById('wf-doc-title')?.value.trim() || 'TIỂU LUẬN MÔN HỌC';

      const frontSections = [];
      if (document.getElementById('wf-include-cover')?.checked) frontSections.push('cover');
      if (document.getElementById('wf-include-comments')?.checked) frontSections.push('comments');
      if (document.getElementById('wf-include-thanks')?.checked) frontSections.push('thanks');
      const frontMatter = frontSections.join(',');

      const formData = new FormData();
      formData.append('document', AppState.selectedFile);
      formData.append('instructor', instructor);
      formData.append('student', student);
      if (studentId) formData.append('studentId', studentId);
      if (className) formData.append('className', className);
      if (topic) formData.append('topic', topic);
      if (docTitle) formData.append('documentTitle', docTitle);
      if (frontMatter) formData.append('frontMatter', frontMatter);

      setButtonLoading(btnStart, true);
      const progressSession = createProgressSession();

      try {
        const [res] = await Promise.all([
          BduApi.formatDocx(formData),
          progressSession.minimum
        ]);
        await progressSession.complete();
        showToast('Chuẩn hóa văn bản thành công!', 'success');

        successBox.classList.remove('hidden');
        downloadBtn.href = res.downloadUrl;

        if (diagContainer) {
          diagContainer.innerHTML = `
            <div class="diag-line diag-pass">Engine: .NET 10 LTS WordFmt (BDU Profile v1)</div>
            <div class="diag-line diag-pass">Canh lề A4: Top 2cm, Bottom 2cm, Left 3cm, Right 2cm</div>
            <div class="diag-line diag-pass">Phân cấp Headings H1–H4 Times New Roman chuẩn viện</div>
            <div class="diag-line diag-pass">Tự động xây dựng Mục Lục & Header/Footer</div>
            <div class="diag-line diag-info">File size: ${(res.fileSize / 1024).toFixed(1)} KB</div>
          `;
        }
      } catch (err) {
        progressSession.fail(err.message);
        showToast(err.message, 'error');
      } finally {
        setButtonLoading(btnStart, false);
      }
    });
  }
}

// ============================================================================
// TAB 5: AUTO SURVEY BOT (SSE STREAM)
// ============================================================================
function initSurveyBot() {
  const btnStart = document.getElementById('btn-start-survey');
  const btnClear = document.getElementById('btn-clear-terminal');
  const terminal = document.getElementById('survey-terminal');

  if (btnClear && terminal) {
    btnClear.addEventListener('click', () => {
      terminal.innerHTML = '<div class="term-line term-muted"><span class="term-time">[00:00:00]</span> Console đã được xóa.</div>';
    });
  }

  if (btnStart) {
    btnStart.addEventListener('click', () => {
      if (!AppState.token) {
        showToast('Vui lòng đăng nhập trước khi chạy khảo sát.', 'error');
        return;
      }

      const rating = document.querySelector('input[name="survey-rating"]:checked')?.value || '5';
      const mssv = AppState.user?.mssv || '';

      setButtonLoading(btnStart, true);
      addTerminalLog('Khởi chạy tiến trình Auto Survey...', 'info');

      if (AppState.eventSource) {
        AppState.eventSource.close();
      }

      const url = `/api/survey/stream?token=${encodeURIComponent(AppState.token)}&mssv=${encodeURIComponent(mssv)}&ratingLevel=${rating}`;
      AppState.eventSource = new EventSource(url);

      AppState.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'log') {
            addTerminalLog(data.message, data.type);
          } else if (data.type === 'done') {
            addTerminalLog(data.message, 'success');
            showToast('Đã hoàn thành tự động khảo sát!', 'success');
            setButtonLoading(btnStart, false);
            AppState.eventSource.close();
          } else if (data.type === 'error') {
            addTerminalLog(data.message, 'warning');
            showToast(data.message, 'error');
            setButtonLoading(btnStart, false);
            AppState.eventSource.close();
          }
        } catch (e) {
          console.error('SSE parse error:', e);
        }
      };

      AppState.eventSource.onerror = () => {
        addTerminalLog('Kết nối khảo sát đã đóng.', 'muted');
        setButtonLoading(btnStart, false);
        AppState.eventSource.close();
      };
    });
  }
}

function addTerminalLog(message, type = 'info') {
  const terminal = document.getElementById('survey-terminal');
  if (!terminal) return;

  const time = new Date().toLocaleTimeString('vi-VN');
  const line = document.createElement('div');
  line.className = `term-line term-${type}`;
  line.innerHTML = `<span class="term-time">[${time}]</span> ${message}`;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

// ============================================================================
// TAB 6: AUTO ENGLISH EXERCISE BOT
// ============================================================================
function initEnglishExerciseBot() {
  const connectBtn = document.getElementById('btn-english-connect');
  const startBtn = document.getElementById('btn-english-start');
  const stopBtn = document.getElementById('btn-english-stop');
  const clearBtn = document.getElementById('btn-clear-english-terminal');
  const activitySelect = document.getElementById('english-activity');
  const answerForm = document.getElementById('english-answer-form');
  const answerBody = document.getElementById('english-answer-body');

  if (!connectBtn || !startBtn || !stopBtn || !activitySelect) return;

  clearBtn?.addEventListener('click', () => {
    const terminal = document.getElementById('english-terminal');
    if (terminal) terminal.textContent = '';
    appendEnglishLog('Console đã được xóa.', 'muted');
  });

  connectBtn.addEventListener('click', async () => {
    const username = document.getElementById('english-username')?.value.trim();
    const passwordInput = document.getElementById('english-password');
    const password = passwordInput?.value || '';
    const courseId = document.getElementById('english-course-id')?.value.trim() || '281';
    if (!username || !password) {
      showToast('Vui lòng nhập tài khoản và mật khẩu Moodle.', 'error');
      return;
    }

    setButtonLoading(connectBtn, true);
    setEnglishConnectionState('Đang kết nối…', false);
    appendEnglishLog(`Đang đăng nhập Moodle và quét khóa học #${courseId}...`);
    try {
      if (AppState.englishSessionId) {
        await BduApi.closeEnglishSession(AppState.englishSessionId).catch(() => { });
      }
      AppState.englishEventSource?.close();
      const session = await BduApi.loginEnglish({ username, password, courseId });
      AppState.englishSessionId = session.sessionId;
      if (passwordInput) passwordInput.value = '';
      connectEnglishLogStream(session.sessionId);

      const activities = await BduApi.getEnglishActivities(session.sessionId, courseId);
      AppState.englishActivities = activities;
      renderEnglishActivities(activities);
      setEnglishConnectionState(`Đã kết nối · ${activities.length} hoạt động`, true);
      document.getElementById('english-run-settings')?.classList.remove('is-disabled');
      document.getElementById('english-run-settings')?.setAttribute('aria-disabled', 'false');
      showToast(`Đã quét ${activities.length} hoạt động Moodle.`, 'success');
    } catch (error) {
      AppState.englishSessionId = null;
      renderEnglishActivities([]);
      setEnglishConnectionState('Kết nối thất bại', false);
      appendEnglishLog(error.message, 'error');
      showToast(error.message, 'error');
    } finally {
      setButtonLoading(connectBtn, false);
      updateEnglishStartAvailability();
    }
  });

  activitySelect.addEventListener('change', updateEnglishStartAvailability);

  startBtn.addEventListener('click', async () => {
    if (!AppState.englishSessionId) {
      showToast('Vui lòng đăng nhập Moodle trước.', 'error');
      return;
    }
    const option = activitySelect.selectedOptions[0];
    if (!option?.value || option.dataset.type !== 'quiz') {
      showToast('Vui lòng chọn một quiz Moodle được hỗ trợ.', 'error');
      return;
    }
    const autoSubmit = Boolean(document.getElementById('english-auto-submit')?.checked);
    if (autoSubmit) {
      const accepted = window.confirm(
        'TỰ ĐỘNG NỘP BÀI có thể ảnh hưởng điểm và số lượt thi. Bạn xác nhận tạo/tiếp tục lượt làm, điền đáp án và nộp quiz này?'
      );
      if (!accepted) return;
    }

    const delaySeconds = Number(document.getElementById('english-delay')?.value || 0);
    setEnglishRunning(true);
    appendEnglishLog(`Yêu cầu chạy quiz #${option.value}${autoSubmit ? ' và tự động nộp' : ' ở chế độ kiểm tra'}...`);
    try {
      await BduApi.startEnglishExercise(AppState.englishSessionId, {
        cmid: option.value,
        type: option.dataset.type,
        delaySeconds,
        autoSubmit
      });
    } catch (error) {
      setEnglishRunning(false);
      appendEnglishLog(error.message, 'error');
      showToast(error.message, 'error');
    }
  });

  stopBtn.addEventListener('click', async () => {
    if (!AppState.englishSessionId) return;
    stopBtn.disabled = true;
    try {
      const result = await BduApi.stopEnglishExercise(AppState.englishSessionId);
      appendEnglishLog(result.stopped ? 'Đã gửi lệnh dừng tiến trình.' : 'Không có tiến trình đang chạy.', 'warning');
    } catch (error) {
      appendEnglishLog(error.message, 'error');
      showToast(error.message, 'error');
      stopBtn.disabled = false;
    }
  });

  answerForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const questionInput = document.getElementById('english-answer-question');
    const answerInput = document.getElementById('english-answer-value');
    const question = questionInput?.value.trim();
    const answer = answerInput?.value.trim();
    if (!question || !answer) return;
    const submit = answerForm.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await BduApi.saveEnglishAnswer(question, answer);
      answerForm.reset();
      await loadEnglishAnswers();
      showToast('Đã lưu đáp án.', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  answerBody?.addEventListener('click', async event => {
    const button = event.target.closest('[data-delete-english-answer]');
    if (!button || !window.confirm('Xóa đáp án này khỏi ngân hàng cục bộ?')) return;
    button.disabled = true;
    try {
      await BduApi.deleteEnglishAnswer(button.dataset.deleteEnglishAnswer);
      await loadEnglishAnswers();
    } catch (error) {
      showToast(error.message, 'error');
      button.disabled = false;
    }
  });

  loadEnglishAnswers().catch(error => appendEnglishLog(error.message, 'warning'));
}

function connectEnglishLogStream(sessionId) {
  AppState.englishEventSource?.close();
  const source = new EventSource(`/api/english/${encodeURIComponent(sessionId)}/stream`);
  AppState.englishEventSource = source;
  source.onmessage = event => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'log') {
        appendEnglishLog(data.message, data.type, data.timestamp);
      } else if (data.type === 'done') {
        setEnglishRunning(false);
        const result = data.result || {};
        showToast(result.submitted ? 'Đã hoàn thành và nộp quiz.' : 'Đã điền xong; hãy kiểm tra trên Moodle.', 'success');
        loadEnglishAnswers().catch(() => { });
      } else if (data.type === 'stopped') {
        setEnglishRunning(false);
        showToast('Đã dừng tiến trình.', 'info');
      } else if (data.type === 'error') {
        setEnglishRunning(false);
        showToast(data.message || 'Tiến trình gặp lỗi.', 'error');
      }
    } catch (error) {
      console.error('English SSE parse error:', error);
    }
  };
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) {
      appendEnglishLog('Kết nối live log đã đóng.', 'warning');
      setEnglishRunning(false);
    }
  };
}

function renderEnglishActivities(activities) {
  const select = document.getElementById('english-activity');
  if (!select) return;
  select.textContent = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = activities.length ? 'Chọn một quiz để chạy' : 'Không tìm thấy hoạt động';
  select.appendChild(placeholder);
  activities.forEach(activity => {
    const option = document.createElement('option');
    option.value = activity.cmid;
    option.dataset.type = activity.type;
    option.textContent = `[${activity.type.toUpperCase()}] ${activity.title}`;
    if (activity.type !== 'quiz') {
      option.disabled = true;
      option.textContent += ' — chưa hỗ trợ tự động';
    }
    select.appendChild(option);
  });
  select.disabled = !activities.some(activity => activity.type === 'quiz');
  updateEnglishStartAvailability();
}

function updateEnglishStartAvailability() {
  const start = document.getElementById('btn-english-start');
  const select = document.getElementById('english-activity');
  const settings = document.getElementById('english-run-settings');
  if (!start || !select) return;
  const isRunning = settings?.dataset.running === 'true';
  const selected = select.selectedOptions[0];
  start.disabled = isRunning || !AppState.englishSessionId || !selected?.value || selected.dataset.type !== 'quiz';
}

function setEnglishRunning(running) {
  const start = document.getElementById('btn-english-start');
  const stop = document.getElementById('btn-english-stop');
  const connect = document.getElementById('btn-english-connect');
  const select = document.getElementById('english-activity');
  const settings = document.getElementById('english-run-settings');
  if (settings) settings.dataset.running = String(running);
  if (start) setButtonLoading(start, running);
  if (stop) stop.disabled = !running;
  if (connect) connect.disabled = running;
  if (select) select.disabled = running || !AppState.englishActivities.some(activity => activity.type === 'quiz');
  updateEnglishStartAvailability();
}

function setEnglishConnectionState(label, connected) {
  const status = document.getElementById('english-connection-status');
  if (!status) return;
  status.textContent = label;
  status.classList.toggle('is-online', connected);
  status.classList.toggle('is-offline', !connected);
}

function appendEnglishLog(message, type = 'info', timestamp = null) {
  const terminal = document.getElementById('english-terminal');
  if (!terminal) return;
  const line = document.createElement('div');
  line.className = `term-line term-${type}`;
  const time = document.createElement('span');
  time.className = 'term-time';
  time.textContent = `[${timestamp || new Date().toLocaleTimeString('vi-VN')}]`;
  line.append(time, document.createTextNode(` ${String(message)}`));
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

async function loadEnglishAnswers() {
  const answers = await BduApi.getEnglishAnswers();
  const count = document.getElementById('english-answer-count');
  const body = document.getElementById('english-answer-body');
  if (count) count.textContent = `${answers.length} đáp án`;
  if (!body) return;
  body.textContent = '';
  if (!answers.length) {
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 4;
    cell.className = 'english-empty';
    cell.textContent = 'Chưa có đáp án. Hãy thêm thủ công để bắt đầu hoặc để bot học từ trang review.';
    return;
  }
  answers.slice().reverse().forEach(answer => {
    const row = body.insertRow();
    row.insertCell().textContent = answer.question;
    row.insertCell().textContent = answer.correctAnswer;
    row.insertCell().textContent = answer.source === 'moodle-review' ? 'Review Moodle' : 'Thủ công';
    const action = row.insertCell();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'english-delete-answer';
    button.dataset.deleteEnglishAnswer = answer.id;
    button.textContent = 'Xóa';
    action.appendChild(button);
  });
}

// ============================================================================
// TAB 8: LEARNING HUB RENDERING
// ============================================================================
function renderLearningHub(learning) {
  const docsContainer = document.getElementById('learning-docs-grid');
  const videosContainer = document.getElementById('learning-videos-grid');

  if (docsContainer && Array.isArray(learning.documents)) {
    docsContainer.innerHTML = learning.documents.map(doc => `
      <div class="doc-card glass-panel">
        <div>
          <span class="doc-format-badge badge-${doc.format.toLowerCase()}">${doc.format}</span>
          <h4 class="doc-title">${doc.title}</h4>
          <div class="doc-course">Môn: <strong>${doc.course}</strong></div>
        </div>
        <div class="doc-footer">
          <span>Dung lượng: ${doc.size}</span>
          <a href="${doc.downloadUrl}" class="btn-action-sm" onclick="alert('File mẫu: ${doc.title}'); return false;">
            <span>Tải về (${doc.downloads})</span>
          </a>
        </div>
      </div>
    `).join('');
  }

  if (videosContainer && Array.isArray(learning.videos)) {
    videosContainer.innerHTML = learning.videos.map(vid => `
      <div class="video-card glass-panel">
        <div class="video-thumb-wrapper">
          <img src="${vid.thumbnail}" alt="${vid.title}" class="video-thumb">
          <span class="video-duration">▶ ${vid.duration}</span>
        </div>
        <div class="video-body">
          <div>
            <h4 class="video-title">${vid.title}</h4>
            <p class="video-desc">${vid.description}</p>
          </div>
          <div class="video-lecturer">Giảng viên: ${vid.lecturer} (${vid.source})</div>
        </div>
      </div>
    `).join('');
  }
}

// ============================================================================
// MODAL DETAILS
// ============================================================================
function initModals() {
  const modal = document.getElementById('detail-modal');
  const closeBtn = document.getElementById('modal-close');
  const dismissBtn = document.getElementById('modal-btn-dismiss');

  const closeModal = () => modal.classList.add('hidden');

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (dismissBtn) dismissBtn.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });
}

window.showCourseDetail = function (encodedData) {
  try {
    const course = JSON.parse(decodeURIComponent(encodedData));
    const modal = document.getElementById('detail-modal');
    if (!modal) return;

    document.getElementById('modal-course-name').textContent = course.ten_mon || 'Chi Tiết Môn Học';
    document.getElementById('modal-course-code').textContent = course.ma_mon || '--';
    document.getElementById('modal-credits').textContent = course.so_tin_chi || '0';
    document.getElementById('modal-tk-10').textContent = course.diem_tk !== undefined && course.diem_tk !== null && course.diem_tk !== '' ? course.diem_tk : '--';
    document.getElementById('modal-tk-4').textContent = course.diem_tk_so !== undefined && course.diem_tk_so !== null && course.diem_tk_so !== '' ? course.diem_tk_so : '--';

    const letterEl = document.getElementById('modal-letter');
    letterEl.textContent = course.diem_tk_chu || '--';
    letterEl.className = `grade-pill ${getGradeLetterClass(course.diem_tk_chu)}`;

    const tbody = document.getElementById('modal-components-body');
    if (tbody) {
      const components = extractComponentDetailList(course);
      if (components.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="4" style="text-align:center; color:var(--text-muted); padding:20px;">
              Không có dữ liệu điểm thành phần chi tiết cho môn học này.
            </td>
          </tr>
        `;
      } else {
        tbody.innerHTML = components.map(comp => `
          <tr>
            <td><strong>${comp.name}</strong></td>
            <td style="font-family: var(--font-mono);">${comp.weight}</td>
            <td style="font-family: var(--font-mono); color: #38bdf8; font-weight: 700;">${comp.score}</td>
            <td style="color: var(--text-muted);">${comp.note}</td>
          </tr>
        `).join('');
      }
    }

    modal.classList.remove('hidden');
  } catch (err) {
    console.error('Show detail error:', err);
  }
};

/**
 * Trích xuất và gán điểm thành phần chi tiết cho môn học
 */
function extractComponentDetailList(course) {
  const rawComponents = Array.isArray(course.ds_diem_thanh_phan) ? course.ds_diem_thanh_phan : [];

  const getDirectScore = (item) => {
    if (!item || typeof item !== 'object') return null;
    const candidateKeys = [
      'diem', 'diem_thanh_phan', 'diem_tp', 'diem_so', 'gia_tri', 'so_diem',
      'diem_danh_gia', 'diem_thi', 'diem_giua_ky', 'diem_ck', 'diem_gk',
      'diem_qt', 'diem_chua_lam_tron', 'diem_tk', 'point', 'score', 'mark', 'value'
    ];
    for (const key of candidateKeys) {
      const val = item[key];
      if (val !== undefined && val !== null && String(val).trim() !== '' && String(val).trim() !== '--') {
        return val;
      }
    }
    return null;
  };

  const getWeight = (item) => {
    if (!item || typeof item !== 'object') return '--';
    const candidateKeys = ['trong_so', 'ty_le', 'ty_le_phan_tram', 'trong_so_phan_tram', 'phan_tram', 'weight'];
    for (const key of candidateKeys) {
      const val = item[key];
      if (val !== undefined && val !== null && String(val).trim() !== '' && String(val).trim() !== '--') {
        const str = String(val).trim();
        return str.endsWith('%') ? str : `${str}%`;
      }
    }
    return '--';
  };

  if (rawComponents.length > 0) {
    return rawComponents.map((comp, idx) => {
      const name = comp.ten_thanh_phan || comp.ten_tp || comp.loai_diem || comp.ten_thanh_phan_danh_gia || `Thành phần ${idx + 1}`;
      const weight = getWeight(comp);
      let score = getDirectScore(comp);
      let note = comp.ghi_chu || comp.note || comp.ten_hinh_thuc_danh_gia || comp.hinh_thuc_danh_gia || '';

      // Tự động ánh xạ điểm từ môn học nếu đối tượng thành phần chưa có điểm trực tiếp
      if (score === null || score === undefined) {
        const lowerName = name.toLowerCase();

        const isMidterm = lowerName.includes('giữa') || lowerName.includes('giua') || lowerName.includes('gk') ||
          lowerName.includes('quá trình') || lowerName.includes('qua trinh') || lowerName.includes('qt') ||
          lowerName.includes('thường kỳ') || lowerName.includes('chuyên cần') || lowerName.includes('tiểu luận') ||
          lowerName.includes('bài tập');

        const isFinal = lowerName.includes('cuối') || lowerName.includes('cuoi') || lowerName.includes('ck') ||
          lowerName.includes('thi') || lowerName.includes('kết thúc') || lowerName.includes('ket thuc') ||
          lowerName.includes('đồ án') || lowerName.includes('bảo vệ');

        if (isMidterm) {
          score = getDirectScore({ diem: course.diem_giua_ky ?? course.diem_gk ?? course.diem_qt });
          if (!note && score !== null) note = 'Điểm đánh giá giữa kỳ';
        } else if (isFinal) {
          score = getDirectScore({ diem: course.diem_thi ?? course.diem_ck ?? course.diem_cuoi_ky });
          if (!note && score !== null) note = 'Điểm thi kết thúc học phần';
        } else if (rawComponents.length === 2) {
          if (idx === 0) {
            score = getDirectScore({ diem: course.diem_giua_ky ?? course.diem_gk ?? course.diem_qt });
            if (!note && score !== null) note = 'Điểm đánh giá giữa kỳ';
          } else if (idx === 1) {
            score = getDirectScore({ diem: course.diem_thi ?? course.diem_ck ?? course.diem_cuoi_ky });
            if (!note && score !== null) note = 'Điểm thi kết thúc học phần';
          }
        }
      }

      return {
        name,
        weight,
        score: score !== null && score !== undefined ? score : '--',
        note: note || '--'
      };
    });
  }

  // Phương án dự phòng nếu ds_diem_thanh_phan trống nhưng môn học có điểm GK / Thi
  const list = [];
  const hasGK = course.diem_giua_ky !== undefined && course.diem_giua_ky !== null && String(course.diem_giua_ky).trim() !== '' && String(course.diem_giua_ky).trim() !== '--';
  const hasThi = course.diem_thi !== undefined && course.diem_thi !== null && String(course.diem_thi).trim() !== '' && String(course.diem_thi).trim() !== '--';
  const hasTK = course.diem_tk !== undefined && course.diem_tk !== null && String(course.diem_tk).trim() !== '' && String(course.diem_tk).trim() !== '--';

  if (hasGK) {
    list.push({
      name: 'Điểm Quá Trình / Giữa Kỳ',
      weight: '40% - 50%',
      score: course.diem_giua_ky,
      note: 'Điểm đánh giá quá trình'
    });
  }
  if (hasThi) {
    list.push({
      name: 'Điểm Thi Kết Thúc Học Phần',
      weight: '50% - 60%',
      score: course.diem_thi,
      note: 'Điểm thi cuối kỳ'
    });
  }
  if (hasTK && list.length === 0) {
    list.push({
      name: 'Điểm Tổng Kết Học Phần',
      weight: '100%',
      score: course.diem_tk,
      note: `Thang 10 (Hệ 4: ${course.diem_tk_so || '--'} - Điểm: ${course.diem_tk_chu || '--'})`
    });
  }

  return list;
}
