/**
 * BDU TỰ HỌC - Master Frontend Application
 * Handles Auth, Gradebook parsing (BDU format), WordFmt, Auto Survey, Schedule & Learning Hub
 */

const AppState = {
  user: null,
  token: null,
  rawGradeData: null,
  academicRanking: null,
  identityPresentation: null,
  titleSelectionDraft: [],
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
  englishActivities: [],
  learning: {
    courses: [],
    activeCourse: null,
    posts: [],
    lastTrigger: null,
    lastComposerTrigger: null
  }
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
  initLearningHub();
  initModals();
  initClansModule();
  initConfessionModule();
  initTitleCustomizer();
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

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderIdentityTitleBadges(titles, extraClass = '') {
  if (!Array.isArray(titles) || !titles.length) return '';
  const allowedTones = new Set(['member', 'gold', 'silver', 'bronze', 'blue', 'emerald', 'violet']);
  const allowedRarities = new Set(['rare', 'epic', 'legendary', 'vip']);
  return `
    <span class="identity-title-badges ${escapeHtml(extraClass)}">
      ${titles.slice(0, 3).map((title) => {
        const tone = allowedTones.has(title?.tone) ? title.tone : 'member';
        const rarity = allowedRarities.has(title?.rarity) ? ` rarity-${title.rarity}` : '';
        return `<span class="identity-title-badge tone-${tone}${rarity}" title="${escapeHtml(title?.detail || title?.label || '')}">${escapeHtml(title?.label || '')}</span>`;
      }).join('')}
    </span>
  `;
}

function renderIdentityAvatar(author, fallbackName = 'Sinh viên BDU') {
  const name = author?.name || fallbackName;
  const isCurrentUser = Boolean(AppState.user?.mssv && author?.mssv === AppState.user.mssv);
  const photoUrl = author?.photo_url
    || (isCurrentUser ? (AppState.user?.photoUrl || localStorage.getItem('bdu_user_photo')) : '');
  if (photoUrl) {
    return `<img src="${escapeHtml(photoUrl)}" alt="Ảnh của ${escapeHtml(name)}" loading="lazy">`;
  }
  return escapeHtml((String(name).trim().charAt(0) || 'S').toUpperCase());
}

function initTitleCustomizer() {
  const modal = document.getElementById('modal-title-customizer');
  document.getElementById('btn-title-customizer')?.addEventListener('click', openTitleCustomizer);
  document.getElementById('btn-close-title-customizer')?.addEventListener('click', closeTitleCustomizer);
  document.getElementById('btn-cancel-title-customizer')?.addEventListener('click', closeTitleCustomizer);
  document.getElementById('btn-save-title-customizer')?.addEventListener('click', saveTitleCustomizer);
  document.getElementById('title-customizer-list')?.addEventListener('change', handleTitleSelectionChange);
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) closeTitleCustomizer();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      closeTitleCustomizer();
    }
  });
}

async function openTitleCustomizer() {
  const modal = document.getElementById('modal-title-customizer');
  if (!modal || !AppState.token) return;
  if (!AppState.identityPresentation) {
    try {
      AppState.identityPresentation = await BduApi.getMyIdentityPresentation(AppState.token);
    } catch (error) {
      showToast(error.message || 'Không thể tải danh hiệu.', 'error');
      return;
    }
  }
  AppState.titleSelectionDraft = [...(AppState.identityPresentation.selected_title_ids || [])];
  renderTitleCustomizerOptions();
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-lock');
  requestAnimationFrame(() => modal.querySelector('input[type="checkbox"]')?.focus());
}

function closeTitleCustomizer() {
  const modal = document.getElementById('modal-title-customizer');
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-lock');
  document.getElementById('btn-title-customizer')?.focus();
}

function renderTitleCustomizerOptions() {
  const list = document.getElementById('title-customizer-list');
  const presentation = AppState.identityPresentation;
  if (!list || !presentation) return;
  const selected = new Set(AppState.titleSelectionDraft);
  const ownedTitles = (presentation.available_titles || []).map((title) => `
    <label class="identity-title-option ${selected.has(title.id) ? 'is-selected' : ''}">
      <input type="checkbox" value="${escapeHtml(title.id)}" ${selected.has(title.id) ? 'checked' : ''}>
      <span class="identity-title-option-copy">
        ${renderIdentityTitleBadges([title])}
        <small>${escapeHtml(title.detail || '')}</small>
        ${title.category === 'achievement'
          ? `<small class="identity-title-proof">✓ Đã mở khóa${title.unlocked_at ? ` · ${escapeHtml(formatAchievementUnlockDate(title.unlocked_at))}` : ''}${formatAchievementEvidence(title.evidence) ? ` · ${escapeHtml(formatAchievementEvidence(title.evidence))}` : ''}</small>`
          : ''}
      </span>
      <span class="identity-title-check" aria-hidden="true">✓</span>
    </label>
  `).join('');
  const lockedAchievements = (presentation.achievement_catalog || []).filter((item) => !item.is_unlocked);
  const lockedTitles = lockedAchievements.length ? `
    <div class="identity-title-locked-heading">
      <span>CHƯA MỞ KHÓA</span>
      <small>Hoàn thành điều kiện để sở hữu</small>
    </div>
    ${lockedAchievements.map((title) => `
      <div class="identity-title-option is-locked" aria-disabled="true">
        <span class="identity-title-lock" aria-hidden="true">🔒</span>
        <span class="identity-title-option-copy">
          ${renderIdentityTitleBadges([title])}
          <small>${escapeHtml(title.detail || '')}</small>
        </span>
      </div>
    `).join('')}
  ` : '';
  list.innerHTML = ownedTitles || lockedTitles
    ? `${ownedTitles}${lockedTitles}`
    : '<p class="learning-comments-state">Bạn chưa có danh hiệu khả dụng.</p>';
  updateTitleSelectionCount();
}

function formatAchievementUnlockDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatAchievementEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return '';
  if (Array.isArray(evidence.deltas) && evidence.deltas.length) {
    return `Delta ${evidence.deltas.map((item) => {
      const delta = Number(item.delta_gpa_4);
      return Number.isFinite(delta) ? `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}` : '';
    }).filter(Boolean).join(' → ')}`;
  }
  if (Number.isFinite(Number(evidence.qualifying_count))) {
    return `${Number(evidence.qualifying_count)} kỳ đạt chuẩn`;
  }
  if (Number.isFinite(Number(evidence.semester_count))) {
    return `${Number(evidence.semester_count)} kỳ giữ chuẩn`;
  }
  return '';
}

function handleTitleSelectionChange(event) {
  const checkbox = event.target.closest('input[type="checkbox"]');
  if (!checkbox) return;
  const checked = [...document.querySelectorAll('#title-customizer-list input[type="checkbox"]:checked')];
  const maxTitles = Number(AppState.identityPresentation?.max_titles || 3);
  if (checked.length > maxTitles) {
    checkbox.checked = false;
    showToast(`Bạn chỉ có thể chọn tối đa ${maxTitles} danh hiệu.`, 'warning');
  }
  AppState.titleSelectionDraft = [...document.querySelectorAll('#title-customizer-list input[type="checkbox"]:checked')]
    .map((input) => input.value);
  document.querySelectorAll('.identity-title-option').forEach((option) => {
    option.classList.toggle('is-selected', Boolean(option.querySelector('input')?.checked));
  });
  updateTitleSelectionCount();
}

function updateTitleSelectionCount() {
  const count = document.getElementById('title-selection-count');
  if (!count) return;
  const maxTitles = Number(AppState.identityPresentation?.max_titles || 3);
  count.textContent = `${AppState.titleSelectionDraft.length}/${maxTitles} đã chọn`;
}

async function saveTitleCustomizer() {
  const button = document.getElementById('btn-save-title-customizer');
  if (!button || !AppState.token) return;
  button.disabled = true;
  try {
    AppState.identityPresentation = await BduApi.updateMyIdentityPresentation(
      AppState.token,
      AppState.titleSelectionDraft
    );
    updateIdentityPresentationUI();
    applyCurrentUserPresentationToFeeds();
    closeTitleCustomizer();
    showToast('Đã cập nhật danh hiệu hiển thị.', 'success');
  } catch (error) {
    showToast(error.message || 'Không thể cập nhật danh hiệu.', 'error');
  } finally {
    button.disabled = false;
  }
}

function updateIdentityPresentationUI() {
  const presentation = AppState.identityPresentation;
  if (!presentation) return;
  const badges = renderIdentityTitleBadges(presentation.selected_titles || []);
  const heroTitles = document.getElementById('cfs-hero-titles');
  const widgetTitles = document.getElementById('widget-user-titles');
  if (heroTitles) heroTitles.innerHTML = badges;
  if (widgetTitles) widgetTitles.innerHTML = badges || '<span class="identity-title-empty">Chưa hiển thị danh hiệu</span>';
}

function applyCurrentUserPresentationToFeeds() {
  const presentation = AppState.identityPresentation;
  const mssv = AppState.user?.mssv;
  if (!presentation || !mssv) return;
  [AppState.learning.posts, AppState.confession?.posts, AppState.clans?.posts].forEach((posts) => {
    (posts || []).forEach((post) => {
      if (post.author?.mssv === mssv) {
        post.author.photo_url = presentation.avatar_url || post.author.photo_url;
        post.author.titles = presentation.selected_titles || [];
      }
    });
  });
  if (AppState.learning.activeCourse) renderLearningCoursePosts();
  if (document.getElementById('tab-confession')?.classList.contains('active')) renderForumFeed();
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
  AppState.learning.courses = [];
  AppState.learning.activeCourse = null;
  AppState.learning.posts = [];

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
    'tab-learning': 'Kho Tài Liệu',
    'tab-clans': 'CLB & Nhóm Học Tập',
    'tab-confession': 'BDU Confession & Diễn Đàn'
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

        if (tabId === 'tab-clans') {
          loadClansDirectory();
        }

        if (tabId === 'tab-confession') {
          loadConfessions();
          setTimeout(() => {
            if (typeof window.triggerFrameIntroAnimation === 'function') {
              window.triggerFrameIntroAnimation();
            }
          }, 150);
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
    try {
      AppState.identityPresentation = await BduApi.getMyIdentityPresentation(AppState.token);
      updateIdentityPresentationUI();
    } catch (presentationError) {
      AppState.identityPresentation = null;
      console.info('Chưa tải được danh hiệu hiển thị:', presentationError.message);
    }

    // 3. Load Schedule (Real BDU API)
    const schedule = await BduApi.getSchedule(AppState.token);
    renderSchedule(schedule);

    // 4. Load Learning Hub
    const learning = await BduApi.getLearningResources(AppState.token);
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
    updateForumUserWidgets();
  } catch (error) {
    AppState.academicRanking = null;
    renderAcademicRanking(null, error.message);
    updateForumUserWidgets();
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

  updateMiniHallOfFame(data.students);
}

function updateMiniHallOfFame(students) {
  const container = document.getElementById('widget-top-students-list');
  if (!container) return;

  const topStudents = Array.isArray(students) ? students.filter(s => s.hang <= 3).slice(0, 3) : [];
  if (topStudents.length === 0) {
    container.innerHTML = `
      <div class="mini-rank-empty" style="text-align: center; padding: 16px 8px; color: var(--text-muted); font-size: 13px;">
        Chưa có dữ liệu vinh danh
      </div>
    `;
    return;
  }

  const badgeClasses = { 1: 'rank-badge-gold', 2: 'rank-badge-silver', 3: 'rank-badge-bronze' };
  container.innerHTML = topStudents.map(s => {
    const badgeClass = badgeClasses[s.hang] || 'rank-badge-bronze';
    const scoreVal = s.gpa_tich_luy !== undefined ? `GPA ${s.gpa_tich_luy}` : (s.tin_chi_tich_luy !== undefined ? `${s.tin_chi_tich_luy} TC` : (s.gia_tri !== undefined ? `${s.gia_tri}` : ''));
    const metaParts = [s.ma_lop || s.lop, scoreVal].filter(Boolean).join(' • ');

    return `
      <div class="mini-rank-item">
        <span class="rank-pos pos-${s.hang}">${s.hang}</span>
        <div class="rank-user-info">
          <strong>${escapeHtml(s.ho_ten || 'Sinh viên BDU')}</strong>
          <small>${escapeHtml(metaParts || s.mssv || '')}</small>
        </div>
        <span class="${badgeClass}">Top ${s.hang}</span>
      </div>
    `;
  }).join('');
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
    if (AppState.user) {
      AppState.user.photoUrl = fullPhotoUrl;
    }
    try {
      localStorage.setItem('bdu_user_photo', fullPhotoUrl);
    } catch(e) {}
    if (typeof updateForumUserWidgets === 'function') {
      updateForumUserWidgets();
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
    if (scheduleData.isSessionExpired) {
      statusText.textContent = 'Phiên hết hạn';
    } else {
      statusText.textContent = scheduleData.isRealData ? 'Cổng BDU · Thời gian thực' : 'Chưa có dữ liệu';
    }
  }

  // 2. Populate semester dropdown if semesters list is available
  if (semSelect) {
    if (Array.isArray(scheduleData.semesters) && scheduleData.semesters.length > 0) {
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
    } else {
      semSelect.innerHTML = '<option value="">-- Chưa có dữ liệu học kỳ --</option>';
      if (subtitle) {
        subtitle.textContent = scheduleData.isSessionExpired
          ? 'Phiên đăng nhập Cổng BDU đã hết hạn'
          : 'Thời khóa biểu chưa có lịch học';
      }
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
    const emptyTitle = scheduleData.isSessionExpired
      ? 'Phiên đăng nhập BDU đã hết hạn'
      : 'Không có lịch học trong học kỳ này';
    const emptyDesc = scheduleData.isSessionExpired
      ? 'Mã xác thực (Token) cổng sv.bdu.edu.vn đã hết hiệu lực. Vui lòng đăng nhập lại để làm mới phiên và tải thời khóa biểu.'
      : 'Sinh viên chưa đăng ký học phần hoặc chưa có lịch xếp phòng từ phòng đào tạo.';

    container.innerHTML = `
      <div class="glass-panel" style="grid-column: 1 / -1; text-align: center; padding: 48px 24px; color: var(--text-muted);">
        <div class="empty-monogram">TKB</div>
        <h4 style="color: var(--text-main); font-size: 16px; margin-bottom: 6px;">${emptyTitle}</h4>
        <p style="font-size: 13px;">${emptyDesc}</p>
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
function initLearningHub() {
  const searchInput = document.getElementById('learning-course-search');
  const statusFilter = document.getElementById('learning-status-filter');
  const grid = document.getElementById('learning-courses-grid');
  const backButton = document.getElementById('btn-learning-back');
  const requestButton = document.getElementById('btn-learning-request');
  const shareButton = document.getElementById('btn-learning-share');
  const closeComposerButton = document.getElementById('btn-learning-close-composer');
  const composerModal = document.getElementById('learning-composer-modal');
  const postKind = document.getElementById('learning-post-kind');
  const postForm = document.getElementById('learning-post-form');
  const courseFeed = document.getElementById('learning-course-feed');

  searchInput?.addEventListener('input', renderLearningCourseDirectory);
  statusFilter?.addEventListener('change', renderLearningCourseDirectory);

  grid?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-learning-action]');
    if (!button) return;
    const code = button.dataset.courseCode;
    const action = button.dataset.learningAction;
    AppState.learning.lastTrigger = button;
    openLearningCourse(code, action === 'request' ? 'request' : action === 'share' ? 'document' : null);
  });

  backButton?.addEventListener('click', closeLearningCourse);
  requestButton?.addEventListener('click', () => openLearningComposer('request'));
  shareButton?.addEventListener('click', () => openLearningComposer('document'));
  closeComposerButton?.addEventListener('click', closeLearningComposer);
  composerModal?.addEventListener('click', (event) => {
    if (event.target === composerModal) closeLearningComposer();
  });
  document.addEventListener('keydown', handleLearningComposerKeydown);
  postKind?.addEventListener('change', updateLearningComposerForKind);
  postForm?.addEventListener('submit', submitLearningPost);
  courseFeed?.addEventListener('click', handleLearningPostClick);
  courseFeed?.addEventListener('submit', handleLearningCommentSubmit);
}

function renderLearningHub(learning) {
  AppState.learning.courses = Array.isArray(learning?.courses) ? learning.courses : [];
  AppState.learning.activeCourse = null;
  AppState.learning.posts = [];
  closeLearningCourse();
  renderLearningCourseDirectory();
}

function renderLearningCourseDirectory() {
  const grid = document.getElementById('learning-courses-grid');
  const summary = document.getElementById('learning-course-summary');
  if (!grid) return;

  const query = (document.getElementById('learning-course-search')?.value || '').trim().toLowerCase();
  const filter = document.getElementById('learning-status-filter')?.value || 'all';
  const courses = AppState.learning.courses.filter((course) => {
    return !query
      || String(course.name || '').toLowerCase().includes(query)
      || String(course.display_code || course.code || '').toLowerCase().includes(query);
  });

  const studyingCount = AppState.learning.courses.filter((course) => course.is_studying).length;
  if (summary) {
    const semesterCount = new Set(
      AppState.learning.courses.flatMap((course) => getLearningCourseSemesters(course).map((semester) => semester.code))
    ).size;
    summary.textContent = `${semesterCount} học kỳ · ${AppState.learning.courses.length} môn · ${studyingCount} môn đang học`;
  }

  if (!courses.length) {
    grid.innerHTML = `
      <div class="learning-empty glass-panel">
        <h3>${AppState.learning.courses.length ? 'Không tìm thấy môn phù hợp' : 'BDU chưa trả về học phần nào'}</h3>
        <p>${AppState.learning.courses.length ? 'Hãy thử đổi từ khóa hoặc bộ lọc.' : 'Hệ thống không tạo dữ liệu mẫu. Danh sách sẽ xuất hiện khi API BDU có mã và tên môn.'}</p>
      </div>
    `;
    return;
  }

  const semesterGroups = new Map();
  courses.forEach((course) => {
    getLearningCourseSemesters(course).forEach((semester) => {
      const matchesStatus = filter === 'all'
        || (filter === 'studying' && !semester.hasFinalGrade)
        || (filter === 'graded' && semester.hasFinalGrade);
      if (!matchesStatus) return;
      if (!semesterGroups.has(semester.code)) {
        semesterGroups.set(semester.code, { ...semester, courses: [] });
      }
      semesterGroups.get(semester.code).courses.push({ course, semester });
    });
  });

  const groups = [...semesterGroups.values()].sort(compareLearningSemesters);
  if (!groups.length) {
    grid.innerHTML = `
      <div class="learning-empty glass-panel">
        <h3>Không tìm thấy môn phù hợp</h3>
        <p>Hãy thử đổi từ khóa hoặc bộ lọc.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = groups.map((group, groupIndex) => {
    const shouldOpen = groupIndex === 0 || Boolean(query);
    const courseCards = group.courses
      .sort((a, b) => String(a.course.name || '').localeCompare(String(b.course.name || ''), 'vi'))
      .map(({ course, semester }) => renderLearningCourseCard(course, semester))
      .join('');
    return `
      <details class="learning-semester-group glass-panel" ${shouldOpen ? 'open' : ''}>
        <summary class="learning-semester-heading">
          <span class="learning-semester-heading-copy">
            <span class="learning-semester-kicker">HỌC KỲ</span>
            <strong>${escapeHtml(group.name || group.code)}</strong>
          </span>
          <span class="learning-semester-meta">
            <span>${group.courses.length} môn</span>
            <span class="learning-semester-chevron" aria-hidden="true"></span>
          </span>
        </summary>
        <div class="learning-courses-grid">${courseCards}</div>
      </details>
    `;
  }).join('');
}

function getLearningCourseSemesters(course) {
  if (Array.isArray(course.semesters) && course.semesters.length) {
    return course.semesters.map((semester) => ({
      code: String(semester.code || semester.name || 'other'),
      name: String(semester.name || semester.code || 'Học kỳ khác'),
      hasFinalGrade: Boolean(semester.has_final_grade)
    }));
  }

  const codes = Array.isArray(course.semester_codes) ? course.semester_codes : [];
  const names = Array.isArray(course.semester_names) ? course.semester_names : [];
  const count = Math.max(codes.length, names.length, 1);
  return Array.from({ length: count }, (_, index) => ({
    code: String(codes[index] || names[index] || 'other'),
    name: String(names[index] || codes[index] || 'Học kỳ khác'),
    hasFinalGrade: Boolean(course.has_final_grade && !course.is_studying)
  }));
}

function compareLearningSemesters(a, b) {
  return String(b.code || '').localeCompare(String(a.code || ''), 'vi', {
    numeric: true,
    sensitivity: 'base'
  });
}

function renderLearningCourseCard(course, semester) {
  const code = escapeHtml(course.code);
  const displayCode = escapeHtml(course.display_code || course.code);
  const courseName = escapeHtml(course.name);
  const hasFinalGrade = semester.hasFinalGrade;
  const status = hasFinalGrade ? 'Đã có điểm' : 'Đang học';
  const resourceCount = Number(course.resource_count || 0);
  const postCount = Number(course.post_count ?? (resourceCount + Number(course.request_count || 0)));

  return `
    <article class="learning-course-card">
      <button class="learning-course-main" type="button" data-learning-action="open" data-course-code="${code}" aria-label="Xem môn ${courseName}">
        <span class="learning-course-card-top">
          <span class="learning-course-code">${displayCode}</span>
          <span class="learning-status ${hasFinalGrade ? 'is-graded' : 'is-studying'}">${status}</span>
        </span>
        <span class="learning-course-name">${courseName}</span>
      </button>
      <div class="learning-course-stats" aria-label="Thống kê nội dung">
        <span><strong>${resourceCount}</strong> tài liệu</span>
        <span><strong>${postCount}</strong> bài viết</span>
      </div>
      <div class="learning-course-card-actions">
        <button class="btn btn-secondary" type="button" data-learning-action="request" data-course-code="${code}" aria-haspopup="dialog">Luận bàn</button>
        <button class="learning-open-action" type="button" data-learning-action="open" data-course-code="${code}">Xem môn học <span aria-hidden="true">→</span></button>
      </div>
    </article>
  `;
}

async function openLearningCourse(courseCode, composerKind = null) {
  const course = AppState.learning.courses.find((item) => item.code === courseCode);
  if (!course || !AppState.token) return;

  AppState.learning.activeCourse = course;
  document.getElementById('learning-course-directory')?.classList.add('hidden');
  document.getElementById('learning-course-space')?.classList.remove('hidden');
  document.getElementById('learning-active-code').textContent = course.display_code || course.code;
  document.getElementById('learning-active-name').textContent = course.name;

  if (composerKind) {
    const courseAction = document.getElementById(
      composerKind === 'request' ? 'btn-learning-request' : 'btn-learning-share'
    );
    openLearningComposer(composerKind, courseAction);
  }

  const feed = document.getElementById('learning-course-feed');
  if (feed) feed.innerHTML = '<div class="learning-empty glass-panel"><p>Đang tải nội dung thật từ cơ sở dữ liệu...</p></div>';

  try {
    const data = await BduApi.getCourseLearningPosts(AppState.token, course.code);
    AppState.learning.posts = Array.isArray(data?.posts) ? data.posts : [];
    renderLearningCoursePosts();
  } catch (error) {
    if (feed) feed.innerHTML = `<div class="learning-empty glass-panel"><h3>Không thể tải môn học</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function closeLearningCourse() {
  document.getElementById('learning-course-directory')?.classList.remove('hidden');
  document.getElementById('learning-course-space')?.classList.add('hidden');
  closeLearningComposer();
  if (AppState.learning.activeCourse && AppState.learning.lastTrigger?.isConnected) {
    AppState.learning.lastTrigger.focus();
  }
  AppState.learning.activeCourse = null;
}

function openLearningComposer(kind, trigger = null) {
  const modal = document.getElementById('learning-composer-modal');
  const form = document.getElementById('learning-post-form');
  const kindSelect = document.getElementById('learning-post-kind');
  if (!modal || !form || !kindSelect) return;
  AppState.learning.lastComposerTrigger = trigger || (
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  );
  kindSelect.value = kind;
  const anonymousInput = document.getElementById('learning-post-anonymous');
  if (anonymousInput) anonymousInput.checked = false;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('learning-composer-open');
  updateLearningComposerForKind();
  requestAnimationFrame(() => document.getElementById('learning-post-title')?.focus());
}

function closeLearningComposer() {
  const modal = document.getElementById('learning-composer-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('learning-composer-open');
  if (AppState.learning.lastComposerTrigger?.isConnected) {
    AppState.learning.lastComposerTrigger.focus();
  }
  AppState.learning.lastComposerTrigger = null;
}

function handleLearningComposerKeydown(event) {
  const modal = document.getElementById('learning-composer-modal');
  if (!modal || modal.classList.contains('hidden')) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeLearningComposer();
    return;
  }

  if (event.key !== 'Tab') return;
  const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function updateLearningComposerForKind() {
  const kind = document.getElementById('learning-post-kind')?.value || 'request';
  const title = document.getElementById('learning-composer-title');
  const context = document.getElementById('learning-composer-context');
  const content = document.getElementById('learning-post-content');
  const url = document.getElementById('learning-post-url');
  const anonymousOption = document.getElementById('learning-anonymous-option');
  const anonymousInput = document.getElementById('learning-post-anonymous');
  const course = AppState.learning.activeCourse;
  if (title) title.textContent = kind === 'request' ? 'Mở cuộc luận bàn' : 'Chia sẻ tài liệu';
  if (context) {
    context.textContent = course
      ? `${course.display_code || course.code} · ${course.name}`
      : 'Chia sẻ cùng sinh viên học chung mã môn.';
  }
  if (content) {
    content.placeholder = kind === 'request'
      ? 'Nêu câu hỏi hoặc chủ đề bạn muốn cùng thảo luận...'
      : 'Giới thiệu ngắn về tài liệu để mọi người dễ tìm và sử dụng...';
  }
  if (url) {
    url.required = kind !== 'request';
    url.placeholder = kind === 'request'
      ? 'Link YouTube, Google Drive hoặc GitHub (tùy chọn)'
      : 'Link YouTube, Google Drive hoặc GitHub (bắt buộc)';
  }
  if (anonymousOption && anonymousInput) {
    const canBeAnonymous = kind === 'request';
    anonymousOption.classList.toggle('hidden', !canBeAnonymous);
    anonymousInput.disabled = !canBeAnonymous;
    if (!canBeAnonymous) anonymousInput.checked = false;
  }
}

async function submitLearningPost(event) {
  event.preventDefault();
  const postForm = event.currentTarget;
  const course = AppState.learning.activeCourse;
  const submitButton = document.getElementById('btn-learning-submit');
  if (!course || !AppState.token || !postForm) return;

  const payload = {
    kind: document.getElementById('learning-post-kind')?.value,
    title: document.getElementById('learning-post-title')?.value.trim(),
    content: document.getElementById('learning-post-content')?.value.trim(),
    url: document.getElementById('learning-post-url')?.value.trim(),
    isAnonymous: Boolean(document.getElementById('learning-post-anonymous')?.checked)
  };

  if (payload.url && !getSupportedResourceSource(payload.url)) {
    showToast('Chỉ hỗ trợ link YouTube, Google Drive hoặc GitHub.', 'warning');
    document.getElementById('learning-post-url')?.focus();
    return;
  }

  submitButton.disabled = true;
  try {
    const createdPost = await BduApi.createCourseLearningPost(AppState.token, course.code, payload);
    if (createdPost) {
      AppState.learning.posts = [
        createdPost,
        ...AppState.learning.posts.filter((post) => post.id !== createdPost.id)
      ];
      renderLearningCoursePosts();
    }
    postForm.reset();
    closeLearningComposer();
    showToast('Đã đăng vào không gian môn học.', 'success');

    try {
      const refreshed = await BduApi.getLearningResources(AppState.token);
      AppState.learning.courses = Array.isArray(refreshed?.courses) ? refreshed.courses : [];
      renderLearningCourseDirectory();
    } catch (refreshError) {
      console.warn('Không thể làm mới thống kê kho tài liệu:', refreshError);
      showToast('Bài đã đăng; số liệu tổng hợp sẽ cập nhật ở lần tải tiếp theo.', 'warning');
    }
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    submitButton.disabled = false;
  }
}

function getSupportedResourceSource(rawUrl) {
  let hostname = '';
  try {
    const parsedUrl = new URL(String(rawUrl || '').trim());
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null;
    hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }

  if (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
    return 'youtube';
  }
  if (hostname === 'drive.google.com') return 'drive';
  if (hostname === 'github.com' || hostname.endsWith('.github.com') || hostname === 'raw.githubusercontent.com') {
    return 'github';
  }
  return null;
}

function renderLearningSourceLogo(source) {
  if (source === 'youtube') {
    return `
      <svg class="learning-logo-youtube" viewBox="0 0 34 24" role="img" aria-label="YouTube">
        <rect width="34" height="24" rx="6" fill="#ff0033"></rect>
        <path d="M14 7.2 23 12l-9 4.8z" fill="#fff"></path>
      </svg>
    `;
  }
  if (source === 'drive') {
    return `
      <svg class="learning-logo-drive" viewBox="0 0 87.3 78" role="img" aria-label="Google Drive">
        <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"></path>
        <path d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44C.4 49.9 0 51.45 0 53h27.5z" fill="#00ac47"></path>
        <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l9.25-16c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" fill="#ea4335"></path>
        <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"></path>
        <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"></path>
        <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"></path>
      </svg>
    `;
  }
  if (source === 'github') {
    return `
      <svg class="learning-logo-github" viewBox="0 0 24 24" role="img" aria-label="GitHub" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7.4A5.8 5.8 0 0 0 19.3 3 5.4 5.4 0 0 0 19.1 0S17.9-.4 15 1.5a13.4 13.4 0 0 0-6 0C6.1-.4 4.9 0 4.9 0A5.4 5.4 0 0 0 4.7 3a5.8 5.8 0 0 0-1.5 4.1c0 5.8 3.5 7 6.8 7.4A4.8 4.8 0 0 0 9 18v4"></path>
        <path d="M9 19c-3 .9-3-1.5-4.2-2"></path>
      </svg>
    `;
  }
  return '';
}

function getLearningAttachmentMeta(attachment) {
  const type = String(attachment?.type || '').toLowerCase();
  const rawUrl = attachment?.direct_url || attachment?.url || '';
  const detectedSource = getSupportedResourceSource(rawUrl);

  const isYoutube = type === 'youtube' || detectedSource === 'youtube';
  if (isYoutube) {
    return {
      source: 'youtube',
      detail: 'Video YouTube',
      action: 'Xem trên YouTube ↗'
    };
  }

  const isGoogleDrive = type.startsWith('drive_') || detectedSource === 'drive';
  if (isGoogleDrive) {
    const detail = type === 'drive_folder'
      ? 'Thư mục Google Drive'
      : type === 'drive_video'
        ? 'Video trên Google Drive'
        : 'Tệp Google Drive';
    return {
      source: 'drive',
      detail,
      action: 'Mở Google Drive ↗'
    };
  }

  if (detectedSource === 'github') {
    return {
      source: 'github',
      detail: 'Mã nguồn / tài liệu GitHub',
      action: 'Mở trên GitHub ↗'
    };
  }

  return {
    source: 'unsupported',
    detail: 'Nguồn không còn được hỗ trợ',
    action: 'Liên kết không hỗ trợ'
  };
}

function renderLearningCoursePosts() {
  const feed = document.getElementById('learning-course-feed');
  const count = document.getElementById('learning-post-count');
  if (!feed) return;
  const posts = AppState.learning.posts;
  if (count) count.textContent = `${posts.length} nội dung`;

  if (!posts.length) {
    feed.innerHTML = `
      <div class="learning-empty glass-panel">
        <h3>Chưa có nội dung cho môn này</h3>
        <p>Bạn có thể là người đầu tiên mở luận bàn hoặc chia sẻ tài liệu.</p>
      </div>
    `;
    return;
  }

  const kindLabels = {
    request: 'LUẬN BÀN',
    document: 'TÀI LIỆU',
    video: 'VIDEO',
    link: 'LIÊN KẾT'
  };
  feed.innerHTML = posts.map((post) => {
    const attachments = Array.isArray(post.attachments) ? post.attachments : [];
    const postId = escapeHtml(post.id);
    const isLiked = Boolean(post.is_liked);
    const isAnonymous = Boolean(post.is_anonymous || post.author?.is_anonymous);
    const authorName = isAnonymous ? 'Sinh viên giấu tên' : (post.author?.name || post.author?.mssv || 'Sinh viên BDU');
    const authorTitles = isAnonymous
      ? [{ label: 'Ẩn danh', detail: 'Danh tính người đăng được bảo vệ', tone: 'member' }]
      : post.author?.titles;
    return `
      <article class="learning-post-card glass-panel" data-learning-post-id="${postId}">
        <header class="learning-post-header">
          <div class="learning-post-author">
            <div class="learning-post-avatar ${isAnonymous ? 'is-anonymous' : ''}">${isAnonymous ? '?' : renderIdentityAvatar(post.author, authorName)}</div>
            <div class="learning-post-author-copy">
              <div class="learning-post-author-line">
                <strong>${escapeHtml(authorName)}</strong>
                ${renderIdentityTitleBadges(authorTitles, 'identity-title-inline')}
              </div>
              <span>${escapeHtml(formatLearningPostTime(post.created_at))}</span>
            </div>
          </div>
          <span class="learning-post-meta-right">
            <span class="learning-post-kind kind-${escapeHtml(post.kind)}">${kindLabels[post.kind] || 'NỘI DUNG'}</span>
            ${post.is_mine ? `<button class="learning-post-delete" type="button" data-learning-delete="${postId}" aria-label="Xóa bài viết ${escapeHtml(post.title)}">Xóa</button>` : ''}
          </span>
        </header>
        <h4>${escapeHtml(post.title)}</h4>
        ${post.content ? `<p>${escapeHtml(post.content)}</p>` : ''}
        ${attachments.map((attachment) => {
          const meta = getLearningAttachmentMeta(attachment);
          return `
            <a class="learning-attachment source-${meta.source}" href="${escapeHtml(attachment.direct_url || attachment.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(meta.action)}: ${escapeHtml(attachment.title || 'Tài liệu')}">
              <span class="learning-attachment-main">
                <span class="learning-source-logo source-${meta.source}" aria-hidden="true">${renderLearningSourceLogo(meta.source)}</span>
                <span class="learning-attachment-copy">
                  <span class="learning-attachment-title">${escapeHtml(attachment.title || 'Mở tài liệu')}</span>
                  <small>${escapeHtml(meta.detail)}</small>
                </span>
              </span>
              <strong>${escapeHtml(meta.action)}</strong>
            </a>
          `;
        }).join('')}
        <div class="learning-post-engagement">
          <button class="learning-engagement-btn ${isLiked ? 'is-liked' : ''}" type="button" data-learning-like="${postId}" aria-pressed="${isLiked}">
            <span class="learning-engagement-icon" aria-hidden="true">${isLiked ? '♥' : '♡'}</span>
            <span>Thích</span>
            <strong data-learning-like-count>${Number(post.like_count || 0)}</strong>
          </button>
          <button class="learning-engagement-btn" type="button" data-learning-comments-toggle="${postId}" aria-expanded="false">
            <span class="learning-engagement-icon" aria-hidden="true">○</span>
            <span>Bình luận</span>
            <strong data-learning-comment-count>${Number(post.comment_count || 0)}</strong>
          </button>
        </div>
        <section class="learning-comments hidden" data-learning-comments-section="${postId}" aria-label="Bình luận bài viết">
          <form class="learning-comment-form" data-learning-comment-form="${postId}">
            <div class="learning-reply-context hidden" data-learning-reply-context>
              <span></span>
              <button type="button" data-learning-cancel-reply>Hủy</button>
            </div>
            <div class="learning-comment-composer">
              <input class="form-input" type="text" maxlength="2000" required placeholder="Viết bình luận hoặc câu trả lời..." aria-label="Nội dung bình luận">
              <button class="btn btn-primary" type="submit">Gửi</button>
            </div>
          </form>
          <div class="learning-comments-list" data-learning-comments-list="${postId}"></div>
        </section>
      </article>
    `;
  }).join('');
}

async function handleLearningPostClick(event) {
  const course = AppState.learning.activeCourse;
  if (!course || !AppState.token) return;

  const likeButton = event.target.closest('[data-learning-like]');
  if (likeButton) {
    const postId = likeButton.dataset.learningLike;
    likeButton.disabled = true;
    try {
      const result = await BduApi.toggleCourseLearningPostLike(AppState.token, course.code, postId);
      likeButton.classList.toggle('is-liked', result.liked);
      likeButton.setAttribute('aria-pressed', String(Boolean(result.liked)));
      const icon = likeButton.querySelector('.learning-engagement-icon');
      if (icon) icon.textContent = result.liked ? '♥' : '♡';
      const count = likeButton.querySelector('[data-learning-like-count]');
      if (count) count.textContent = result.like_count;
      const post = AppState.learning.posts.find((item) => String(item.id) === String(postId));
      if (post) {
        post.is_liked = result.liked;
        post.like_count = result.like_count;
      }
    } catch (error) {
      showToast(error.message || 'Không thể cập nhật lượt thích.', 'error');
    } finally {
      likeButton.disabled = false;
    }
    return;
  }

  const commentsButton = event.target.closest('[data-learning-comments-toggle]');
  if (commentsButton) {
    const postId = commentsButton.dataset.learningCommentsToggle;
    const card = commentsButton.closest('[data-learning-post-id]');
    const section = card?.querySelector('[data-learning-comments-section]');
    if (!section) return;
    const willOpen = section.classList.contains('hidden');
    section.classList.toggle('hidden', !willOpen);
    commentsButton.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
      await loadLearningPostComments(postId, card);
      card.querySelector('.learning-comment-form input')?.focus();
    }
    return;
  }

  const replyButton = event.target.closest('[data-learning-reply]');
  if (replyButton) {
    const card = replyButton.closest('[data-learning-post-id]');
    const form = card?.querySelector('.learning-comment-form');
    const context = form?.querySelector('[data-learning-reply-context]');
    if (!form || !context) return;
    form.dataset.parentId = replyButton.dataset.learningReply;
    context.querySelector('span').textContent = `Đang trả lời ${replyButton.dataset.commentAuthor || 'bình luận'}`;
    context.classList.remove('hidden');
    form.querySelector('input')?.focus();
    return;
  }

  const cancelReplyButton = event.target.closest('[data-learning-cancel-reply]');
  if (cancelReplyButton) {
    resetLearningReplyComposer(cancelReplyButton.closest('.learning-comment-form'));
    return;
  }

  const deleteButton = event.target.closest('[data-learning-delete]');
  if (deleteButton) {
    const postId = deleteButton.dataset.learningDelete;
    const card = deleteButton.closest('[data-learning-post-id]');
    const postTitle = card?.querySelector('h4')?.textContent?.trim();
    const confirmed = await requestDeletePostConfirmation(postTitle, deleteButton);
    if (!confirmed) return;
    try {
      await BduApi.deleteCourseLearningPost(AppState.token, course.code, postId);
      AppState.learning.posts = AppState.learning.posts.filter((post) => String(post.id) !== String(postId));
      renderLearningCoursePosts();
      closeDeletePostModal();
      showToast('Đã xóa bài viết và các tương tác liên quan.', 'success');
      const refreshed = await BduApi.getLearningResources(AppState.token);
      AppState.learning.courses = Array.isArray(refreshed?.courses) ? refreshed.courses : [];
      renderLearningCourseDirectory();
    } catch (error) {
      closeDeletePostModal();
      showToast(error.message || 'Không thể xóa bài viết.', 'error');
    }
  }
}

async function handleLearningCommentSubmit(event) {
  const form = event.target.closest('[data-learning-comment-form]');
  if (!form) return;
  event.preventDefault();
  const course = AppState.learning.activeCourse;
  const postId = form.dataset.learningCommentForm;
  const input = form.querySelector('input');
  const submitButton = form.querySelector('button[type="submit"]');
  const content = input?.value.trim();
  if (!course || !AppState.token || !content || !submitButton) return;

  submitButton.disabled = true;
  try {
    await BduApi.addCourseLearningPostComment(AppState.token, course.code, postId, {
      content,
      parentId: form.dataset.parentId || null
    });
    input.value = '';
    resetLearningReplyComposer(form);
    const post = AppState.learning.posts.find((item) => String(item.id) === String(postId));
    if (post) post.comment_count = Number(post.comment_count || 0) + 1;
    const card = form.closest('[data-learning-post-id]');
    card?.querySelectorAll('[data-learning-comment-count]').forEach((count) => {
      count.textContent = Number(count.textContent || 0) + 1;
    });
    await loadLearningPostComments(postId, card);
  } catch (error) {
    showToast(error.message || 'Không thể gửi bình luận.', 'error');
  } finally {
    submitButton.disabled = false;
  }
}

function resetLearningReplyComposer(form) {
  if (!form) return;
  delete form.dataset.parentId;
  form.querySelector('[data-learning-reply-context]')?.classList.add('hidden');
  const input = form.querySelector('input');
  if (input) input.placeholder = 'Viết bình luận hoặc câu trả lời...';
}

async function loadLearningPostComments(postId, card) {
  const course = AppState.learning.activeCourse;
  const list = card?.querySelector('[data-learning-comments-list]');
  if (!course || !list) return;
  list.innerHTML = '<p class="learning-comments-state">Đang tải bình luận...</p>';
  try {
    const comments = await BduApi.getCourseLearningPostComments(AppState.token, course.code, postId);
    list.innerHTML = comments.length
      ? renderLearningCommentsTree(comments)
      : '<p class="learning-comments-state">Chưa có bình luận. Hãy là người đầu tiên trả lời.</p>';
  } catch (error) {
    list.innerHTML = `<p class="learning-comments-state is-error">${escapeHtml(error.message || 'Không thể tải bình luận.')}</p>`;
  }
}

function renderLearningCommentsTree(comments) {
  const commentIds = new Set(comments.map((comment) => String(comment.id)));
  const children = new Map();
  comments.forEach((comment) => {
    const parentKey = comment.parent_id && commentIds.has(String(comment.parent_id))
      ? String(comment.parent_id)
      : 'root';
    if (!children.has(parentKey)) children.set(parentKey, []);
    children.get(parentKey).push(comment);
  });

  const renderBranch = (comment, depth = 0) => {
    const id = escapeHtml(comment.id);
    const authorName = comment.author?.name || comment.author?.mssv || 'Sinh viên BDU';
    const safeAuthor = escapeHtml(authorName);
    const replies = children.get(String(comment.id)) || [];
    return `
      <article class="learning-comment ${depth ? 'is-reply' : ''}" style="--comment-depth: ${Math.min(depth, 2)}">
        <div class="learning-comment-layout">
          <div class="learning-comment-avatar">${renderIdentityAvatar(comment.author, authorName)}</div>
          <div class="learning-comment-copy">
            <div class="learning-comment-head">
              <span class="learning-comment-author-line">
                <strong>${safeAuthor}</strong>
                ${renderIdentityTitleBadges(comment.author?.titles, 'identity-title-comment')}
              </span>
              <span>${escapeHtml(formatLearningPostTime(comment.created_at))}</span>
            </div>
            <p>${escapeHtml(comment.content)}</p>
            <button type="button" data-learning-reply="${id}" data-comment-author="${safeAuthor}">Trả lời</button>
          </div>
        </div>
      </article>
      ${replies.map((reply) => renderBranch(reply, depth + 1)).join('')}
    `;
  };

  return (children.get('root') || []).map((comment) => renderBranch(comment)).join('');
}

function formatLearningPostTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

// ============================================================================
// CLB & NHÓM HỌC TẬP (CLAN & GUILD MODULE)
// ============================================================================
AppState.clans = {
  list: [],
  activeFilter: 'all',
  currentClan: null,
  posts: [],
  feedFilter: 'all',
  composerMode: 'discussion',
  documents: [],
  docFilter: 'all',
  docSearch: ''
};

function initClansModule() {
  const filterAllBtn = document.getElementById('filter-clans-all');
  const filterMineBtn = document.getElementById('filter-clans-mine');
  const searchInput = document.getElementById('clan-search-input');

  const modalCreate = document.getElementById('modal-create-clan');
  const openCreateBtn = document.getElementById('btn-open-create-clan');
  const closeCreateBtn = document.getElementById('btn-close-create-clan');
  const cancelCreateBtn = document.getElementById('btn-cancel-create-clan');
  const confirmCreateBtn = document.getElementById('btn-confirm-create-clan');

  const backToClansBtn = document.getElementById('btn-back-to-clans');
  const submitClanPostBtn = document.getElementById('btn-submit-clan-post');
  const documentShareModal = document.getElementById('modal-clan-document-share');
  const documentShareForm = document.getElementById('clan-document-share-form');

  // Filter tabs danh bạ CLB
  if (filterAllBtn) {
    filterAllBtn.addEventListener('click', () => {
      filterAllBtn.classList.add('active');
      if (filterMineBtn) filterMineBtn.classList.remove('active');
      AppState.clans.activeFilter = 'all';
      renderClansGrid();
    });
  }

  if (filterMineBtn) {
    filterMineBtn.addEventListener('click', () => {
      filterMineBtn.classList.add('active');
      if (filterAllBtn) filterAllBtn.classList.remove('active');
      AppState.clans.activeFilter = 'mine';
      renderClansGrid();
    });
  }

  // Search input danh bạ CLB
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderClansGrid();
    });
  }

  // Modal Create Clan
  const openModal = () => modalCreate && modalCreate.classList.remove('hidden');
  const closeModal = () => modalCreate && modalCreate.classList.add('hidden');

  if (openCreateBtn) openCreateBtn.addEventListener('click', openModal);
  if (closeCreateBtn) closeCreateBtn.addEventListener('click', closeModal);
  if (cancelCreateBtn) cancelCreateBtn.addEventListener('click', closeModal);

  if (confirmCreateBtn) {
    confirmCreateBtn.addEventListener('click', handleCreateNewClan);
  }

  // Back to Clans directory
  if (backToClansBtn) {
    backToClansBtn.addEventListener('click', () => {
      document.getElementById('clan-channel-view')?.classList.add('hidden');
      document.getElementById('clan-main-view')?.classList.remove('hidden');
      AppState.clans.currentClan = null;
    });
  }

  // Clan Post/Poll Popup Modal Controls (Facebook Modal Style)
  const modalClanComposer = document.getElementById('modal-clan-post-composer');
  const closeClanModalBtn = document.getElementById('btn-close-clan-composer-modal');
  const quickTrigger = document.getElementById('clan-quick-composer-trigger');
  const openPostModalBtn = document.getElementById('btn-clan-open-post-modal');
  const openPollModalBtn = document.getElementById('btn-clan-open-poll-modal');
  const modalTabPostBtn = document.getElementById('modal-tab-mode-post');
  const modalTabPollBtn = document.getElementById('modal-tab-mode-poll');
  const addPollOptBtn = document.getElementById('btn-add-poll-option');

  const switchClanModalMode = (mode) => {
    AppState.clans.composerMode = mode;
    const isPoll = mode === 'poll';
    const pollSection = document.getElementById('clan-poll-builder-section');
    const headerTitle = document.getElementById('clan-modal-header-title');
    const titleInput = document.getElementById('clan-post-title');
    const contentTextarea = document.getElementById('clan-post-content');
    const submitText = document.getElementById('btn-submit-clan-post-text');

    modalTabPostBtn?.classList.toggle('active', !isPoll);
    modalTabPollBtn?.classList.toggle('active', isPoll);

    if (isPoll) {
      pollSection?.classList.remove('hidden');
      if (headerTitle) headerTitle.textContent = 'Tạo cuộc bình chọn trong nhóm';
      if (titleInput) titleInput.placeholder = 'Chủ đề / Câu hỏi bình chọn...';
      if (contentTextarea) contentTextarea.placeholder = 'Thêm chi tiết hoặc lưu ý cho cuộc biểu quyết này (tùy chọn)...';
      if (submitText) submitText.textContent = 'Tạo Bình Chọn';
    } else {
      pollSection?.classList.add('hidden');
      if (headerTitle) headerTitle.textContent = 'Tạo bài viết trong nhóm';
      if (titleInput) titleInput.placeholder = 'Tiêu đề bài viết...';
      if (contentTextarea) contentTextarea.placeholder = 'Bạn đang nghĩ gì thế? Chia sẻ thảo luận hoặc câu hỏi cho nhóm...';
      if (submitText) submitText.textContent = 'Đăng';
    }
  };

  const openClanComposerModal = (mode = 'discussion') => {
    const clan = AppState.clans.currentClan;
    if (!clan) return;

    // Fill user & group info in modal
    const uName = AppState.user?.name || 'Sinh viên BDU';
    const avatarEl = document.getElementById('clan-modal-author-avatar');
    const nameEl = document.getElementById('clan-modal-author-name');
    const clanTagEl = document.getElementById('clan-modal-group-name');
    const roleTagEl = document.getElementById('clan-modal-role-name');

    if (avatarEl) {
      const photo = AppState.user?.photoUrl || localStorage.getItem('bdu_user_photo');
      if (photo) {
        avatarEl.innerHTML = `<img src="${photo}" alt="${escapeHtml(uName)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;">`;
      } else {
        avatarEl.textContent = uName.charAt(0).toUpperCase();
      }
    }
    if (nameEl) nameEl.textContent = uName;
    if (clanTagEl) clanTagEl.textContent = `👥 ${clan.name || 'Nhóm CLB'}`;
    if (roleTagEl) {
      let roleLabel = 'Thành viên';
      if (clan.my_role === 'leader') roleLabel = '👑 Bang Chủ';
      else if (clan.my_role === 'vice_leader') roleLabel = '🛡️ Phó Bang';
      else if (clan.my_role === 'elder') roleLabel = '⭐ Cốt Cán';
      roleTagEl.textContent = roleLabel;
    }

    // Leader / Vice Leader Pin option
    const isLeaderOrVice = clan.my_role === 'leader' || clan.my_role === 'vice_leader';
    const pinWrapper = document.getElementById('clan-post-pin-wrapper');
    if (pinWrapper) pinWrapper.classList.toggle('hidden', !isLeaderOrVice);

    switchClanModalMode(mode);

    modalClanComposer?.classList.remove('hidden');
    setTimeout(() => document.getElementById('clan-post-title')?.focus(), 80);
  };

  const closeClanComposerModal = () => {
    modalClanComposer?.classList.add('hidden');
  };

  if (quickTrigger) quickTrigger.addEventListener('click', () => openClanComposerModal('discussion'));
  if (openPostModalBtn) openPostModalBtn.addEventListener('click', () => openClanComposerModal('discussion'));
  if (openPollModalBtn) openPollModalBtn.addEventListener('click', () => openClanComposerModal('poll'));

  if (modalTabPostBtn) modalTabPostBtn.addEventListener('click', () => switchClanModalMode('discussion'));
  if (modalTabPollBtn) modalTabPollBtn.addEventListener('click', () => switchClanModalMode('poll'));

  if (closeClanModalBtn) closeClanModalBtn.addEventListener('click', closeClanComposerModal);
  if (modalClanComposer) {
    modalClanComposer.addEventListener('click', (e) => {
      if (e.target === modalClanComposer) closeClanComposerModal();
    });
  }

  document.getElementById('btn-close-clan-document-share')?.addEventListener('click', closeClanDocumentShareModal);
  document.getElementById('btn-cancel-clan-document-share')?.addEventListener('click', closeClanDocumentShareModal);
  documentShareForm?.addEventListener('submit', handleSubmitClanDocument);
  documentShareModal?.addEventListener('click', (event) => {
    if (event.target === documentShareModal) closeClanDocumentShareModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !documentShareModal?.classList.contains('hidden')) {
      closeClanDocumentShareModal();
    }
  });

  if (addPollOptBtn) {
    addPollOptBtn.addEventListener('click', () => {
      const container = document.getElementById('clan-poll-options-container');
      if (!container) return;
      const count = container.querySelectorAll('.poll-option-input-row').length;
      if (count >= 10) {
        showToast('Mỗi cuộc bình chọn tối đa 10 phương án lựa chọn.', 'info');
        return;
      }
      const newRow = document.createElement('div');
      newRow.className = 'poll-option-input-row';
      newRow.innerHTML = `
        <span class="poll-opt-num">${count + 1}</span>
        <input type="text" class="form-input poll-opt-val" maxlength="180" placeholder="Lựa chọn ${count + 1}">
        <button type="button" class="btn-remove-poll-opt" title="Xóa phương án">×</button>
      `;
      newRow.querySelector('.btn-remove-poll-opt')?.addEventListener('click', () => {
        newRow.remove();
        container.querySelectorAll('.poll-option-input-row').forEach((row, idx) => {
          const numEl = row.querySelector('.poll-opt-num');
          if (numEl) numEl.textContent = idx + 1;
        });
      });
      container.appendChild(newRow);
      newRow.querySelector('input')?.focus();
    });
  }

  // Submit Post in Clan
  if (submitClanPostBtn) {
    submitClanPostBtn.addEventListener('click', handleSubmitClanPost);
  }

  // Channel Subtabs Navigation (Bản Tin vs Kho Tài Liệu vs Thành Viên)
  const tabFeedBtn = document.getElementById('tab-btn-clan-feed');
  const tabDocsBtn = document.getElementById('tab-btn-clan-docs');
  const tabMembersBtn = document.getElementById('tab-btn-clan-members');

  if (tabFeedBtn) tabFeedBtn.addEventListener('click', () => switchClanSubtab('feed'));
  if (tabDocsBtn) tabDocsBtn.addEventListener('click', () => switchClanSubtab('docs'));
  if (tabMembersBtn) tabMembersBtn.addEventListener('click', () => switchClanSubtab('members'));

  // Clan Feed Filter Pills (Tất cả bài đăng, Bản tin, Bình chọn, Bài của tôi)
  document.querySelectorAll('.clan-feed-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.clan-feed-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      AppState.clans.feedFilter = pill.getAttribute('data-filter') || 'all';
      if (AppState.clans.currentClan) {
        loadClanPosts(AppState.clans.currentClan.id);
      }
    });
  });

  // Clan Docs Type Filter Pills (Tất cả, Thư mục Drive, File & Đề thi, Video, Link)
  document.querySelectorAll('.clan-doc-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.clan-doc-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      AppState.clans.docFilter = pill.getAttribute('data-type') || 'all';
      if (AppState.clans.currentClan) {
        loadClanDocuments(AppState.clans.currentClan.id);
      }
    });
  });

  // Clan Docs Search Input
  let docSearchTimer = null;
  const docsSearchInput = document.getElementById('clan-docs-search-input');
  if (docsSearchInput) {
    docsSearchInput.addEventListener('input', () => {
      clearTimeout(docSearchTimer);
      docSearchTimer = setTimeout(() => {
        AppState.clans.docSearch = docsSearchInput.value.trim();
        if (AppState.clans.currentClan) {
          loadClanDocuments(AppState.clans.currentClan.id);
        }
      }, 300);
    });
  }

  // Lắng nghe đổi Category trên Composer để tự động check Ẩn danh khi là Confession
  document.querySelectorAll('input[name="clan-post-cat"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isConfession = radio.value === 'confession';
      const anonCheckbox = document.getElementById('clan-post-anon');
      if (anonCheckbox) {
        if (isConfession) {
          anonCheckbox.checked = true;
          anonCheckbox.disabled = true;
        } else {
          anonCheckbox.disabled = false;
        }
      }
    });
  });

  // Clan settings buttons (Chỉ Bang Chủ)
  const btnSaveSettings = document.getElementById('btn-save-clan-settings');
  const btnDisband = document.getElementById('btn-disband-clan');
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', handleSaveClanSettings);
  }
  if (btnDisband) {
    btnDisband.addEventListener('click', handleDisbandClan);
  }
}

async function loadClansDirectory() {
  const grid = document.getElementById('clans-list-grid');
  if (!grid) return;

  try {
    const clans = await BduApi.getClans(AppState.token);
    AppState.clans.list = Array.isArray(clans) ? clans : [];
    renderClansGrid();
  } catch (err) {
    console.error('Lỗi tải danh sách CLB:', err);
    grid.innerHTML = `
      <div class="empty-state-box" style="grid-column: 1 / -1; text-align: center; padding: 40px;">
        <p style="color: var(--text-muted);">${escapeHtml(err.message || 'Chưa thể tải danh sách CLB.')}</p>
        <button class="btn btn-secondary btn-sm" onclick="loadClansDirectory()" style="margin-top: 10px;">Thử lại</button>
      </div>
    `;
  }
}

function renderClansGrid() {
  const grid = document.getElementById('clans-list-grid');
  if (!grid) return;

  const searchVal = (document.getElementById('clan-search-input')?.value || '').trim().toLowerCase();
  const filter = AppState.clans.activeFilter || 'all';

  let filtered = AppState.clans.list || [];
  if (filter === 'mine') {
    filtered = filtered.filter(c => c.is_joined);
  }
  if (searchVal) {
    filtered = filtered.filter(c => 
      (c.name && c.name.toLowerCase().includes(searchVal)) ||
      (c.tag && c.tag.toLowerCase().includes(searchVal)) ||
      (c.code && c.code.toLowerCase().includes(searchVal)) ||
      (c.description && c.description.toLowerCase().includes(searchVal))
    );
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-box" style="grid-column: 1 / -1; text-align: center; padding: 50px 20px;">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5" style="margin-bottom: 12px;">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="8" y1="12" x2="16" y2="12"></line>
        </svg>
        <h4 style="font-weight: 700; color: var(--text-main); margin-bottom: 6px;">Không tìm thấy CLB / Nhóm nào</h4>
        <p style="font-size: 13px; color: var(--text-muted);">${filter === 'mine' ? 'Bạn chưa tham gia CLB nào. Hãy khám phá các CLB bên tab "Tất Cả CLB / Nhóm" nhé!' : 'Hãy thử tìm kiếm với từ khóa khác hoặc bấm nút "Tạo CLB / Nhóm Mới"!'}</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(clan => {
    const isJoined = Boolean(clan.is_joined);
    const roleText = clan.my_role === 'leader' ? '👑 Bang Chủ' : (clan.my_role === 'vice_leader' ? '⭐ Phó Bang' : (isJoined ? '🛡️ Thành Viên' : ''));

    return `
      <div class="clan-card glass-panel clickable-card" data-clan-id="${clan.id}">
        <div>
          <div class="clan-card-top">
            <span class="clan-tag-badge">${escapeHtml(clan.tag || `[${clan.code}]`)}</span>
            <span class="clan-level-badge">Cấp ${clan.level || 1}</span>
          </div>
          <h4 class="clan-card-name">${escapeHtml(clan.name)}</h4>
          <p class="clan-card-desc">${escapeHtml(clan.description || 'Chưa có mô tả chi tiết cho CLB này.')}</p>
        </div>

        <div>
          <div class="clan-card-meta">
            <span class="clan-meta-count">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
              </svg>
              ${clan.member_count || 0} thành viên
            </span>
            ${roleText ? `<span class="clan-my-role-badge">${roleText}</span>` : ''}
          </div>

          <div class="clan-card-hint-row">
            <span>${isJoined ? 'Đã tham gia' : 'Chưa tham gia'}</span>
            <span class="hint-action">${isJoined ? 'Xem bài viết & tài liệu →' : 'Xem thành viên & chức vụ →'}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Attach card click event
  grid.querySelectorAll('.clan-card.clickable-card').forEach(card => {
    card.addEventListener('click', () => {
      const clanId = card.getAttribute('data-clan-id');
      openClanChannel(clanId);
    });
  });
}

async function handleJoinClan(clanId) {
  if (!AppState.token) {
    showToast('Vui lòng đăng nhập để tham gia CLB / Nhóm.', 'warning');
    return;
  }
  try {
    await BduApi.joinClan(AppState.token, clanId);
    showToast('Tham gia CLB thành công!', 'success');
    await loadClansDirectory();
  } catch (err) {
    showToast(err.message || 'Không thể tham gia CLB.', 'error');
  }
}

async function handleLeaveClan(clanId) {
  if (!AppState.token) return;
  if (!confirm('Bạn có chắc muốn rời khỏi CLB / Nhóm này?')) return;
  try {
    await BduApi.leaveClan(AppState.token, clanId);
    showToast('Đã rời khỏi CLB.', 'info');
    await loadClansDirectory();
  } catch (err) {
    showToast(err.message || 'Không thể rời CLB.', 'error');
  }
}

async function handleCreateNewClan() {
  if (!AppState.token) {
    showToast('Vui lòng đăng nhập để tạo CLB.', 'warning');
    return;
  }

  const name = document.getElementById('new-clan-name')?.value?.trim();
  const code = document.getElementById('new-clan-code')?.value?.trim();
  const tag = document.getElementById('new-clan-tag')?.value?.trim();
  const description = document.getElementById('new-clan-desc')?.value?.trim();

  if (!name || !code) {
    showToast('Vui lòng nhập tên và mã định danh cho CLB.', 'warning');
    return;
  }

  try {
    await BduApi.createClan(AppState.token, { name, code, tag, description });
    showToast('Đã thành lập CLB / Nhóm mới thành công!', 'success');
    document.getElementById('modal-create-clan')?.classList.add('hidden');
    // Clear inputs
    if (document.getElementById('new-clan-name')) document.getElementById('new-clan-name').value = '';
    if (document.getElementById('new-clan-code')) document.getElementById('new-clan-code').value = '';
    if (document.getElementById('new-clan-tag')) document.getElementById('new-clan-tag').value = '';
    if (document.getElementById('new-clan-desc')) document.getElementById('new-clan-desc').value = '';
    await loadClansDirectory();
  } catch (err) {
    showToast(err.message || 'Không thể tạo CLB.', 'error');
  }
}

async function openClanChannel(clanId) {
  const clan = (AppState.clans.list || []).find(c => String(c.id) === String(clanId));
  if (!clan) return;

  AppState.clans.currentClan = clan;

  // Update channel header
  const tagEl = document.getElementById('channel-clan-tag');
  const nameEl = document.getElementById('channel-clan-name');
  const descEl = document.getElementById('channel-clan-desc');
  const levelEl = document.getElementById('channel-clan-level');
  const memsEl = document.getElementById('channel-clan-members');

  if (tagEl) tagEl.textContent = clan.tag || `[${clan.code}]`;
  if (nameEl) nameEl.textContent = clan.name;
  if (descEl) descEl.textContent = clan.description || 'Không gian thảo luận, hỏi bài và chia sẻ tài liệu ôn thi.';
  if (levelEl) levelEl.textContent = `Cấp ${clan.level || 1}`;
  if (memsEl) {
    memsEl.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
      </svg>
      ${clan.member_count || 0} Thành viên
    `;
  }

  const roleEl = document.getElementById('channel-clan-role');
  if (roleEl) {
    roleEl.textContent = clan.my_role === 'leader' ? '👑 Bang Chủ' : (clan.is_joined ? '🛡️ Thành Viên' : 'Chưa tham gia');
  }

  const actionBox = document.getElementById('channel-action-box');
  if (actionBox) {
    if (clan.is_joined) {
      if (clan.my_role === 'leader') {
        actionBox.innerHTML = `<span class="badge-leader">👑 Bang Chủ</span>`;
      } else {
        actionBox.innerHTML = `<button class="btn btn-secondary btn-sm" id="btn-channel-leave">Rời nhóm</button>`;
        document.getElementById('btn-channel-leave')?.addEventListener('click', async () => {
          await handleLeaveClan(clan.id);
          document.getElementById('clan-channel-view')?.classList.add('hidden');
          document.getElementById('clan-main-view')?.classList.remove('hidden');
        });
      }
    } else {
      actionBox.innerHTML = `<button class="btn btn-primary btn-sm" id="btn-channel-join">Tham Gia CLB</button>`;
      document.getElementById('btn-channel-join')?.addEventListener('click', async () => {
        await handleJoinClan(clan.id);
        clan.is_joined = true;
        openClanChannel(clan.id);
      });
    }
  }

  // Update Quick Composer avatar and placeholder
  const quickAvatarEl = document.getElementById('clan-quick-composer-avatar');
  const uName = AppState.user?.name || 'Bạn';
  if (quickAvatarEl) {
    const photo = AppState.user?.photoUrl || localStorage.getItem('bdu_user_photo');
    if (photo) {
      quickAvatarEl.innerHTML = `<img src="${photo}" alt="${escapeHtml(uName)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;">`;
    } else {
      quickAvatarEl.textContent = uName.charAt(0).toUpperCase();
    }
  }

  const quickPlaceholder = document.getElementById('clan-quick-composer-placeholder');
  if (quickPlaceholder) {
    quickPlaceholder.textContent = `${uName} ơi, bạn đang nghĩ gì thế?`;
  }

  // Reset composer modal & mode
  document.getElementById('modal-clan-post-composer')?.classList.add('hidden');
  AppState.clans.composerMode = 'discussion';

  // Switch view
  document.getElementById('clan-main-view')?.classList.add('hidden');
  document.getElementById('clan-channel-view')?.classList.remove('hidden');

  const subtabCount = document.getElementById('channel-subtab-mem-count');
  if (subtabCount) subtabCount.textContent = clan.member_count || 0;

  // Clan Settings (Chỉ Bang Chủ)
  const settingsBox = document.getElementById('clan-settings-box');
  if (settingsBox) {
    if (clan.my_role === 'leader') {
      settingsBox.classList.remove('hidden');
      const editName = document.getElementById('edit-clan-name');
      const editTag = document.getElementById('edit-clan-tag');
      const editDesc = document.getElementById('edit-clan-desc');
      if (editName) editName.value = clan.name || '';
      if (editTag) editTag.value = clan.tag || '';
      if (editDesc) editDesc.value = clan.description || '';
    } else {
      settingsBox.classList.add('hidden');
    }
  }

  // Lấy trước số lượng tài liệu để cập nhật badge
  BduApi.getClanDocuments(AppState.token, clan.id).then(res => {
    const docBadge = document.getElementById('channel-subtab-doc-count');
    if (docBadge) docBadge.textContent = res.total || 0;
  }).catch(() => {});

  // Mở subtab mặc định
  if (clan.is_joined) {
    switchClanSubtab('feed');
  } else {
    switchClanSubtab('members');
  }
}

function switchClanSubtab(targetTab) {
  const tabFeedBtn = document.getElementById('tab-btn-clan-feed');
  const tabDocsBtn = document.getElementById('tab-btn-clan-docs');
  const tabMembersBtn = document.getElementById('tab-btn-clan-members');

  const panelFeed = document.getElementById('channel-panel-feed');
  const panelDocs = document.getElementById('channel-panel-docs');
  const panelMembers = document.getElementById('channel-panel-members');

  const currentClan = AppState.clans.currentClan;

  [tabFeedBtn, tabDocsBtn, tabMembersBtn].forEach(btn => btn?.classList.remove('active'));
  [panelFeed, panelDocs, panelMembers].forEach(panel => panel?.classList.add('hidden'));

  if (targetTab === 'feed') {
    tabFeedBtn?.classList.add('active');
    panelFeed?.classList.remove('hidden');
    if (currentClan) {
      if (currentClan.is_joined) {
        const composer = document.querySelector('.clan-composer');
        if (composer) composer.style.display = 'block';
        loadClanPosts(currentClan.id);
      } else {
        renderLockedClanFeed(currentClan);
      }
    }
  } else if (targetTab === 'docs') {
    tabDocsBtn?.classList.add('active');
    panelDocs?.classList.remove('hidden');
    if (currentClan) {
      if (currentClan.is_joined) {
        loadClanDocuments(currentClan.id);
      } else {
        renderLockedClanDocs(currentClan);
      }
    }
  } else if (targetTab === 'members') {
    tabMembersBtn?.classList.add('active');
    panelMembers?.classList.remove('hidden');
    if (currentClan) {
      loadClanMembers(currentClan.id);
    }
  }
}

function renderLockedClanFeed(clan) {
  const container = document.getElementById('clan-posts-feed');
  const composer = document.querySelector('.clan-composer');
  if (composer) composer.style.display = 'none';

  if (container) {
    container.innerHTML = `
      <div class="clan-feed-locked-card glass-panel">
        <svg class="lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <h4 style="font-size: 16px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">Bản Tin Nội Bộ CLB</h4>
        <p style="font-size: 13px; color: var(--text-muted); max-width: 460px; margin: 0 auto 16px;">
          Bạn chưa tham gia CLB này. Hãy tham gia để xem bài viết thảo luận, thông báo và các tài liệu ôn thi được chia sẻ trong nhóm!
        </p>
        <button class="btn btn-primary btn-sm" id="btn-lock-join-clan">Tham Gia CLB Ngay</button>
      </div>
    `;

    document.getElementById('btn-lock-join-clan')?.addEventListener('click', async () => {
      await handleJoinClan(clan.id);
      clan.is_joined = true;
      openClanChannel(clan.id);
    });
  }
}

function renderLockedClanDocs(clan) {
  const grid = document.getElementById('clan-docs-grid');
  if (grid) {
    grid.innerHTML = `
      <div class="clan-feed-locked-card glass-panel" style="grid-column: 1 / -1; text-align: center; padding: 40px 20px;">
        <svg class="lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <h4 style="font-size: 16px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">Kho Tài Liệu Nội Bộ CLB</h4>
        <p style="font-size: 13px; color: var(--text-muted); max-width: 460px; margin: 0 auto 16px;">
          Kho tài liệu chứa toàn bộ folder Google Drive, slide bài giảng, đề thi và video do các thành viên chia sẻ. Hãy tham gia CLB để truy cập!
        </p>
        <button class="btn btn-primary btn-sm" id="btn-lock-join-clan-docs">Tham Gia CLB Ngay</button>
      </div>
    `;
    document.getElementById('btn-lock-join-clan-docs')?.addEventListener('click', async () => {
      await handleJoinClan(clan.id);
      clan.is_joined = true;
      openClanChannel(clan.id);
    });
  }
}

async function loadClanPosts(clanId) {
  const quickComposer = document.querySelector('.clan-quick-composer');
  if (quickComposer && AppState.clans.currentClan?.is_joined) quickComposer.style.display = 'block';

  const container = document.getElementById('clan-posts-feed');
  if (!container) return;

  container.innerHTML = `
    <div class="loading-spinner-box">
      <div class="spinner"></div>
      <p>Đang tải bản tin CLB...</p>
    </div>
  `;

  const currentClan = AppState.clans.currentClan;
  const filter = AppState.clans.feedFilter || 'all';

  try {
    const res = await BduApi.getCommunityPosts(AppState.token, {
      scope: 'clan',
      scopeId: String(clanId),
      filter: ['mine', 'discussion', 'poll'].includes(filter) ? filter : 'all',
      limit: 50
    });
    const posts = res.posts || [];
    AppState.clans.posts = posts;

    if (posts.length === 0) {
      container.innerHTML = `
        <div class="empty-state-box glass-panel" style="text-align: center; padding: 45px 20px; border-radius: var(--radius-lg); border: 1px dashed var(--border-color);">
          <div style="font-size: 36px; margin-bottom: 12px;">📰</div>
          <h4 style="font-weight: 700; color: var(--text-main); margin-bottom: 6px;">Chưa có bài viết nào trong mục này</h4>
          <p style="font-size: 13px; color: var(--text-muted); max-width: 460px; margin: 0 auto 16px;">
            Hãy là người đầu tiên đăng bài bản tin hoặc tạo cuộc bình chọn cho các thành viên trong nhóm nhé!
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = posts.map(post => renderClanPostCardHtml(post, currentClan)).join('');
    attachPostCardEvents(container);
    attachClanPostPinEvents(container, currentClan);
    attachClanPollVoteEvents(container);
  } catch (err) {
    console.error('Lỗi tải bài viết CLB:', err);
    container.innerHTML = `<div class="empty-state-box"><p style="color: var(--color-rose);">${escapeHtml(err.message || 'Không thể tải bài viết.')}</p></div>`;
  }
}

function renderClanPostCardHtml(post, clan) {
  const isLiked = Boolean(post.is_liked);
  const isAnon = Boolean(post.author?.is_anonymous);
  const rawAuthorName = isAnon ? 'Sinh viên giấu tên' : (post.author?.name || 'Thành viên CLB');
  const authorName = escapeHtml(rawAuthorName);
  const avatarContent = isAnon ? '?' : renderIdentityAvatar(post.author, rawAuthorName);
  const currentMssv = AppState.user?.mssv;
  const isCurrentAuthor = Boolean(post.is_mine || (currentMssv && post.author?.mssv === currentMssv));

  const isLeader = clan?.my_role === 'leader';
  const isVice = clan?.my_role === 'vice_leader';
  const canModerate = isLeader || isVice;

  // Identity Badges (Facebook card layout matching screenshot)
  let badgesHtml = '';
  if (isAnon) {
    badgesHtml = `<span class="forum-post-rank-tag is-anon">Ẩn danh</span>`;
  } else if (Array.isArray(post.author?.titles) && post.author.titles.length > 0) {
    badgesHtml = renderIdentityTitleBadges(post.author.titles, 'identity-title-forum');
  } else {
    const r = post.author?.clan_role;
    let roleLabel = 'Thành viên';
    let roleTone = 'tone-member';
    if (r === 'leader') { roleLabel = 'Bang Chủ · VIP'; roleTone = 'tone-leader'; }
    else if (r === 'vice_leader') { roleLabel = 'Phó Bang'; roleTone = 'tone-vice'; }
    else if (r === 'elder') { roleLabel = 'Cốt Cán'; roleTone = 'tone-officer'; }
    badgesHtml = `<span class="identity-title-badge ${roleTone}">${roleLabel}</span><span class="identity-title-badge tone-member">Sinh viên BDU</span>`;
  }

  // Category Tag (Matching screenshot top right badge)
  const isPoll = post.category === 'poll' || Boolean(post.poll);
  let catTagHtml = '';
  if (isPoll) {
    catTagHtml = `<span class="clan-category-tag tag-poll">Bình chọn</span>`;
  } else if (post.category === 'announcement') {
    catTagHtml = `<span class="clan-category-tag tag-announcement">Thông báo</span>`;
  } else {
    catTagHtml = `<span class="clan-category-tag tag-discussion">Bản tin</span>`;
  }

  // Pinned Badge
  const isPinned = Boolean(post.is_pinned);
  const pinnedBadgeHtml = isPinned
    ? `<span class="clan-pinned-badge">📌 Đã ghim</span>`
    : '';

  const relativeTime = formatRelativeTime(post.created_at);

  // Poll Widget HTML
  let pollWidgetHtml = '';
  if (post.poll && Array.isArray(post.poll.options) && post.poll.options.length > 0) {
    const poll = post.poll;
    const totalVotes = Number(poll.total_votes || 0);
    const myVotedId = poll.my_voted_option_id;

    pollWidgetHtml = `
      <div class="clan-poll-widget glass-panel" data-poll-id="${poll.id}">
        <div class="clan-poll-header">
          <div class="clan-poll-question">
            <span class="clan-poll-icon">📊</span>
            <strong>${escapeHtml(poll.question || post.title)}</strong>
          </div>
          <span class="clan-poll-total-votes">${totalVotes} lượt bình chọn</span>
        </div>
        <div class="clan-poll-options-list">
          ${poll.options.map((opt) => {
            const isSelected = Boolean(opt.is_voted || myVotedId === String(opt.id));
            const pct = Number(opt.percentage || 0);
            return `
              <div class="clan-poll-option ${isSelected ? 'is-selected' : ''}" data-poll-id="${poll.id}" data-option-id="${opt.id}" role="button" tabindex="0">
                <div class="poll-option-progress-bar" style="width: ${pct}%;"></div>
                <div class="poll-option-content">
                  <div class="poll-option-left">
                    <span class="poll-radio-dot ${isSelected ? 'checked' : ''}"></span>
                    <span class="poll-option-text">${escapeHtml(opt.text)}</span>
                  </div>
                  <div class="poll-option-right">
                    <span class="poll-option-votes">${opt.vote_count} phiếu</span>
                    <span class="poll-option-pct">${pct}%</span>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  return `
    <div class="clan-post-card glass-panel ${isPinned ? 'is-pinned-card' : ''}" data-post-id="${post.id}">
      ${isPinned ? `
        <div class="clan-post-pinned-banner">
          <span>📌 Bài viết đáng chú ý được ghim bởi Ban Quản Trị CLB</span>
        </div>
      ` : ''}

      <div class="clan-post-header">
        <div class="clan-user-col">
          <div class="clan-avatar ${isAnon ? 'anon' : ''}">${avatarContent}</div>
          <div class="clan-user-details">
            <div class="clan-author-name-line">
              <strong class="clan-author-name">${authorName}</strong>
              ${badgesHtml}
            </div>
            <span class="clan-post-time">${relativeTime}</span>
          </div>
        </div>

        <div class="clan-post-header-actions">
          ${catTagHtml}
          ${pinnedBadgeHtml}
          ${canModerate ? `
            <button type="button" class="btn-clan-pin-post ${isPinned ? 'pinned-active' : ''}" data-post-id="${post.id}" title="${isPinned ? 'Bỏ ghim bài viết' : 'Ghim bài viết lên đầu nhóm'}">
              <span>${isPinned ? 'Bỏ ghim' : 'Ghim'}</span>
            </button>
          ` : ''}
          ${(isCurrentAuthor || canModerate) ? `
            <button type="button" class="btn-delete-post" data-post-id="${post.id}" title="Xóa bài viết" aria-label="Xóa bài viết">
              <span>Xóa</span>
            </button>
          ` : ''}
        </div>
      </div>

      <h4 class="clan-post-title">${escapeHtml(post.title)}</h4>
      <div class="clan-post-body">${escapeHtml(post.content)}</div>

      ${pollWidgetHtml}

      <!-- Bottom action row matching screenshot -->
      <div class="clan-post-bottom-bar">
        <div class="clan-actions-left">
          <button class="clan-action-btn btn-toggle-like ${isLiked ? 'liked' : ''}" data-id="${post.id}">
            <span>${isLiked ? 'Đã thích' : 'Thích'}</span>
          </button>
          <button class="clan-action-btn btn-toggle-comments" data-id="${post.id}">
            <span>Bình luận</span>
          </button>
        </div>
        <div class="clan-counts-right">
          <span class="like-count-num">${post.like_count || 0}</span> lượt thích • <span class="comment-count-num">${post.comment_count || 0}</span> bình luận
        </div>
      </div>

      <!-- Comments Thread -->
      <div class="clan-comments-wrapper hidden" id="comments-section-${post.id}">
        <div class="comment-input-row">
          <input type="text" class="form-input comment-text-input" maxlength="2000" placeholder="Viết bình luận..." data-post-id="${post.id}">
          <button class="btn btn-primary btn-sm btn-submit-comment" data-post-id="${post.id}">Gửi</button>
        </div>
        <div class="comments-list" id="comments-list-${post.id}">
          <!-- Comments loaded dynamically -->
        </div>
      </div>
    </div>
  `;
}

function attachClanPollVoteEvents(container) {
  if (!container) return;
  container.querySelectorAll('.clan-poll-option').forEach(optionEl => {
    optionEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!AppState.token) {
        showToast('Vui lòng đăng nhập để bình chọn.', 'warning');
        return;
      }
      const pollId = optionEl.getAttribute('data-poll-id');
      const optionId = optionEl.getAttribute('data-option-id');
      if (!pollId || !optionId) return;

      const widget = optionEl.closest('.clan-poll-widget');
      try {
        optionEl.style.opacity = '0.7';
        const updatedPoll = await BduApi.voteClanPoll(AppState.token, pollId, optionId);
        showToast('Đã ghi nhận bình chọn của bạn!', 'success');

        if (widget && updatedPoll && Array.isArray(updatedPoll.options)) {
          const totalVotes = Number(updatedPoll.total_votes || 0);
          const myVotedId = String(updatedPoll.my_voted_option_id);
          const totalEl = widget.querySelector('.clan-poll-total-votes');
          if (totalEl) totalEl.textContent = `${totalVotes} lượt bình chọn`;

          const optionsList = widget.querySelector('.clan-poll-options-list');
          if (optionsList) {
            optionsList.innerHTML = updatedPoll.options.map(opt => {
              const isSelected = Boolean(opt.is_voted || myVotedId === String(opt.id));
              const pct = Number(opt.percentage || 0);
              return `
                <div class="clan-poll-option ${isSelected ? 'is-selected' : ''}" data-poll-id="${updatedPoll.id}" data-option-id="${opt.id}" role="button" tabindex="0">
                  <div class="poll-option-progress-bar" style="width: ${pct}%;"></div>
                  <div class="poll-option-content">
                    <div class="poll-option-left">
                      <span class="poll-radio-dot ${isSelected ? 'checked' : ''}"></span>
                      <span class="poll-option-text">${escapeHtml(opt.text)}</span>
                    </div>
                    <div class="poll-option-right">
                      <span class="poll-option-votes">${opt.vote_count} phiếu</span>
                      <span class="poll-option-pct">${pct}%</span>
                    </div>
                  </div>
                </div>
              `;
            }).join('');
            attachClanPollVoteEvents(widget);
          }
        }
      } catch (err) {
        showToast(err.message || 'Không thể thực hiện bình chọn.', 'error');
      } finally {
        optionEl.style.opacity = '1';
      }
    });
  });
}

function attachClanPostPinEvents(container, clan) {
  container.querySelectorAll('.btn-clan-pin-post').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!AppState.token) {
        showToast('Vui lòng đăng nhập.', 'warning');
        return;
      }
      const postId = btn.getAttribute('data-post-id');
      if (!postId) return;
      btn.disabled = true;
      try {
        const res = await BduApi.toggleClanPostPin(AppState.token, postId);
        showToast(res.is_pinned ? 'Đã ghim bài viết lên đầu nhóm!' : 'Đã bỏ ghim bài viết.', 'success');
        if (clan) {
          await loadClanPosts(clan.id);
        }
      } catch (err) {
        showToast(err.message || 'Không thể thay đổi trạng thái ghim.', 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function loadClanDocuments(clanId) {
  const grid = document.getElementById('clan-docs-grid');
  const statsEl = document.getElementById('clan-docs-stats');
  const countBadge = document.getElementById('channel-subtab-doc-count');
  if (!grid) return;

  grid.innerHTML = `
    <div class="loading-spinner-box" style="grid-column: 1 / -1;">
      <div class="spinner"></div>
      <p>Đang tải kho tài liệu CLB...</p>
    </div>
  `;

  try {
    const res = await BduApi.getClanDocuments(AppState.token, clanId, {
      type: AppState.clans.docFilter || 'all',
      search: AppState.clans.docSearch || ''
    });

    const docs = res.documents || [];
    AppState.clans.documents = docs;

    if (countBadge) countBadge.textContent = res.total || 0;

    // Render Stats Badges
    if (statsEl && res.stats) {
      const s = res.stats;
      statsEl.innerHTML = `
        <span class="doc-stat-pill">📁 ${s.folders} Thư mục Drive</span>
        <span class="doc-stat-pill">📄 ${s.files} File & Đề thi</span>
        <span class="doc-stat-pill">🎥 ${s.videos} Video bài giảng</span>
        <span class="doc-stat-pill">🔗 ${s.links} Liên kết</span>
      `;
    }

    if (docs.length === 0) {
      grid.innerHTML = `
        <div class="empty-state-box glass-panel" style="grid-column: 1 / -1; text-align: center; padding: 45px 20px;">
          <div style="font-size: 38px; margin-bottom: 12px;">📁</div>
          <h4 style="font-weight: 700; color: var(--text-main); margin-bottom: 6px;">Chưa tìm thấy tài liệu phù hợp</h4>
          <p style="font-size: 13px; color: var(--text-muted); max-width: 480px; margin: 0 auto 16px;">
            Thành viên có thể chia sẻ folder Google Drive, slide bài giảng hoặc link video qua Bản Tin để tài liệu xuất hiện tại đây!
          </p>
          <button class="btn btn-primary btn-sm" id="btn-quick-add-doc">Chia Sẻ Tài Liệu Ngay</button>
        </div>
      `;
      document.getElementById('btn-quick-add-doc')?.addEventListener('click', () => {
        openClanDocumentShareModal();
      });
      return;
    }

    grid.innerHTML = docs.map(doc => renderClanDocumentCardHtml(doc)).join('');

    // Attach click event for "Xem bài viết" buttons
    grid.querySelectorAll('.btn-doc-view-post').forEach(btn => {
      btn.addEventListener('click', async () => {
        const postId = btn.getAttribute('data-post-id');
        switchClanSubtab('feed');
        setTimeout(() => {
          const card = document.querySelector(`.clan-post-card[data-post-id="${postId}"]`);
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('highlight-pulse');
            setTimeout(() => card.classList.remove('highlight-pulse'), 2500);
          }
        }, 300);
      });
    });

  } catch (err) {
    console.error('Lỗi tải kho tài liệu CLB:', err);
    grid.innerHTML = `
      <div class="empty-state-box" style="grid-column: 1 / -1; text-align: center; padding: 30px;">
        <p style="color: var(--color-rose);">${escapeHtml(err.message || 'Không thể tải kho tài liệu.')}</p>
        <button class="btn btn-secondary btn-sm" onclick="loadClanDocuments('${clanId}')" style="margin-top: 10px;">Thử lại</button>
      </div>
    `;
  }
}

function openClanDocumentShareModal() {
  if (!AppState.token) {
    showToast('Vui lòng đăng nhập để chia sẻ tài liệu.', 'warning');
    return;
  }
  if (!AppState.clans.currentClan) return;

  const modal = document.getElementById('modal-clan-document-share');
  const form = document.getElementById('clan-document-share-form');
  if (!modal) return;

  form?.reset();
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => document.getElementById('clan-document-name')?.focus(), 80);
}

function closeClanDocumentShareModal() {
  const modal = document.getElementById('modal-clan-document-share');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

async function handleSubmitClanDocument(event) {
  event?.preventDefault();

  const currentClan = AppState.clans.currentClan;
  const nameInput = document.getElementById('clan-document-name');
  const descriptionInput = document.getElementById('clan-document-description');
  const urlInput = document.getElementById('clan-document-url');
  const title = nameInput?.value?.trim() || '';
  const content = descriptionInput?.value?.trim() || '';
  const url = urlInput?.value?.trim() || '';

  if (!AppState.token) {
    showToast('Vui lòng đăng nhập để chia sẻ tài liệu.', 'warning');
    return;
  }
  if (!currentClan) return;
  if (!title) {
    showToast('Vui lòng nhập tên tài liệu.', 'warning');
    nameInput?.focus();
    return;
  }
  if (!content) {
    showToast('Vui lòng nhập mô tả tài liệu.', 'warning');
    descriptionInput?.focus();
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    showToast('Vui lòng nhập link tài liệu hợp lệ.', 'warning');
    urlInput?.focus();
    return;
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    showToast('Link tài liệu phải bắt đầu bằng http:// hoặc https://.', 'warning');
    urlInput?.focus();
    return;
  }
  if (!getSupportedResourceSource(parsedUrl.href)) {
    showToast('Chỉ hỗ trợ link YouTube, Google Drive hoặc GitHub.', 'warning');
    urlInput?.focus();
    return;
  }

  const submitBtn = document.getElementById('btn-submit-clan-document-share');
  const originalContent = submitBtn?.innerHTML;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Đang chia sẻ...</span>';
  }

  try {
    await BduApi.createCommunityPost(AppState.token, {
      title,
      content,
      scope: 'clan',
      scopeId: String(currentClan.id),
      category: 'material',
      attachments: [{ url: parsedUrl.href, title }]
    });

    closeClanDocumentShareModal();
    showToast('Đã chia sẻ tài liệu vào kho của CLB!', 'success');
    await Promise.all([
      loadClanDocuments(currentClan.id),
      loadClanPosts(currentClan.id)
    ]);
  } catch (err) {
    showToast(err.message || 'Không thể chia sẻ tài liệu.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalContent;
    }
  }
}

function renderClanDocumentCardHtml(doc) {
  let iconSvg = '';
  let badgeLabel = 'Tài liệu';
  let badgeClass = 'tag-file';

  if (doc.type === 'drive_folder') {
    badgeLabel = 'Thư mục Drive';
    badgeClass = 'tag-folder';
    iconSvg = `
      <svg class="classroom-drive-icon" width="36" height="32" viewBox="0 0 87.3 78">
        <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
        <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
        <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
        <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
        <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
        <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
      </svg>
    `;
  } else if (doc.type === 'drive_file') {
    badgeLabel = 'Tài liệu Drive';
    badgeClass = 'tag-file';
    iconSvg = `
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
      </svg>
    `;
  } else if (doc.type === 'drive_video' || doc.type === 'youtube') {
    badgeLabel = doc.type === 'youtube' ? 'Video YouTube' : 'Video bài giảng';
    badgeClass = 'tag-video';
    iconSvg = `
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2">
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
        <polygon points="10 8 16 12 10 16 10 8" fill="#ef4444"></polygon>
      </svg>
    `;
  } else {
    badgeLabel = 'Liên kết ngoài';
    badgeClass = 'tag-link';
    iconSvg = `
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
      </svg>
    `;
  }

  const relativeTime = formatRelativeTime(doc.created_at);

  return `
    <div class="clan-doc-card glass-panel" data-doc-id="${doc.id}">
      <div class="clan-doc-card-top">
        <div class="clan-doc-icon-box">
          ${iconSvg}
        </div>
        <span class="clan-doc-type-badge ${badgeClass}">${badgeLabel}</span>
      </div>

      <div class="clan-doc-card-body">
        <h5 class="clan-doc-card-title" title="${escapeHtml(doc.title)}">${escapeHtml(doc.title)}</h5>
        <p class="clan-doc-card-origin">
          Được chia sẻ bởi: <strong>${escapeHtml(doc.author_name)}</strong>
        </p>
        <p class="clan-doc-card-post-ref" title="${escapeHtml(doc.post_title)}">
          Bài viết: <em>"${escapeHtml(doc.post_title)}"</em>
        </p>
        <span class="clan-doc-card-time">${relativeTime}</span>
      </div>

      <div class="clan-doc-card-actions">
        ${doc.download_url ? `
          <a href="${escapeHtml(doc.download_url)}" target="_blank" rel="noopener noreferrer" class="btn-doc-link btn-doc-download" title="Tải tệp về máy">
            Tải về
          </a>
        ` : ''}
        <a href="${escapeHtml(doc.direct_url)}" target="_blank" rel="noopener noreferrer" class="btn-doc-link btn-doc-primary" title="Mở liên kết">
          Mở Drive ↗
        </a>
        <button type="button" class="btn-doc-link btn-doc-view-post" data-post-id="${doc.post_id}" title="Xem bài thảo luận gốc">
          Thảo luận 💬
        </button>
      </div>
    </div>
  `;
}

// Hàm render đính kèm chuẩn Classroom cho Drive Folder/Files và nhúng Video Player
function renderSingleAttachmentHtml(att) {
  if (!att) return '';

  // 1. Google Drive Folder -> Hiển thị chuẩn thẻ đính kèm Google Classroom
  if (att.type === 'drive_folder') {
    const targetUrl = att.direct_url || att.url || '#';
    const folderTitle = att.title || 'Thư mục Google Drive';

    return `
      <div class="classroom-attachment-card" title="Nhấp để mở thư mục trong Google Drive">
        <a href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener noreferrer" class="classroom-card-main-link">
          <div class="classroom-card-thumb">
            <svg class="classroom-drive-icon" width="36" height="32" viewBox="0 0 87.3 78">
              <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
              <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
              <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
              <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
              <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
              <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
            </svg>
          </div>
          <div class="classroom-card-details">
            <h5 class="classroom-card-title">${escapeHtml(folderTitle)}</h5>
            <div class="classroom-card-sub">
              <span class="classroom-card-type">Thư mục Google Drive</span>
              <span class="classroom-card-dot">•</span>
              <span class="classroom-card-domain">drive.google.com</span>
            </div>
          </div>
          <div class="classroom-card-action">
            <span class="btn-classroom-open">
              Mở Drive
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </span>
          </div>
        </a>
      </div>
    `;
  }

  // 2. Google Drive File -> Classroom File Card
  if (att.type === 'drive_file') {
    const targetUrl = att.direct_url || att.url || '#';
    const fileTitle = att.title || 'Tài liệu Google Drive';

    return `
      <div class="classroom-attachment-card classroom-file-card" title="Xem tài liệu">
        <div class="classroom-card-main-link">
          <a href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener noreferrer" class="classroom-card-content-link">
            <div class="classroom-card-thumb">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.8">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
            </div>
            <div class="classroom-card-details">
              <h5 class="classroom-card-title">${escapeHtml(fileTitle)}</h5>
              <div class="classroom-card-sub">
                <span class="classroom-card-type">Tài liệu Google Drive</span>
                <span class="classroom-card-dot">•</span>
                <span class="classroom-card-domain">drive.google.com</span>
              </div>
            </div>
          </a>
          <div class="classroom-card-action">
            ${att.download_url ? `<a href="${escapeHtml(att.download_url)}" target="_blank" rel="noopener noreferrer" class="btn-classroom-download" title="Tải về">Tải về</a>` : ''}
            <a href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener noreferrer" class="btn-classroom-open">
              Xem
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </a>
          </div>
        </div>
      </div>
    `;
  }

  // 3. Liên kết web thông thường
  if (att.type === 'link') {
    const targetUrl = att.direct_url || att.url || '#';
    return `
      <div class="classroom-attachment-card" title="Mở liên kết đính kèm">
        <a href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener noreferrer" class="classroom-card-main-link">
          <div class="classroom-card-thumb is-link"><span class="attachment-text-mark">LINK</span></div>
          <div class="classroom-card-details">
            <h5 class="classroom-card-title">${escapeHtml(att.title || 'Liên kết tham khảo')}</h5>
            <div class="classroom-card-sub"><span class="classroom-card-type">Liên kết ngoài</span></div>
          </div>
          <div class="classroom-card-action"><span class="btn-classroom-open">Mở ↗</span></div>
        </a>
      </div>
    `;
  }

  // 4. Video (YouTube hoặc Video Drive)
  const typeLabel = att.type === 'youtube' ? 'Video YouTube' : 'Video Drive';
  let previewFrame = '';
  if (att.embed_url) {
    previewFrame = `
      <div class="embed-iframe-wrapper">
        <iframe src="${escapeHtml(att.embed_url)}" allowfullscreen loading="lazy"></iframe>
      </div>
    `;
  }

  return `
    <div class="attachment-preview-box">
      <div class="attachment-preview-header">
        <span class="attachment-type-badge">${typeLabel}</span>
        <span class="attachment-title">${escapeHtml(att.title || 'Video đính kèm')}</span>
        <div class="attachment-actions">
          ${att.download_url ? `<a href="${escapeHtml(att.download_url)}" target="_blank" rel="noopener noreferrer" class="attachment-action-link">Tải về</a>` : ''}
          ${att.direct_url ? `<a href="${escapeHtml(att.direct_url)}" target="_blank" rel="noopener noreferrer" class="attachment-action-link">Mở Drive ↗</a>` : ''}
        </div>
      </div>
      ${previewFrame}
    </div>
  `;
}

function renderCommunityPostHtml(post) {
  const isLiked = Boolean(post.is_liked);
  const isAnon = Boolean(post.author?.is_anonymous);
  const authorName = isAnon ? 'Sinh viên giấu tên' : escapeHtml(post.author?.name || 'Thành viên CLB');
  const avatarInitial = isAnon ? '?' : (authorName.charAt(0).toUpperCase() || 'S');

  // Attachments rendering
  let attachmentsHtml = '';
  if (Array.isArray(post.attachments) && post.attachments.length > 0) {
    attachmentsHtml = `
      <div class="post-attachments-list">
        ${post.attachments.map(att => renderSingleAttachmentHtml(att)).join('')}
      </div>
    `;
  }

  const timeStr = new Date(post.created_at).toLocaleString('vi-VN', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric'
  });

  return `
    <div class="community-post-card glass-panel" data-post-id="${post.id}">
      <div class="post-header">
        <div class="post-author-box">
          <div class="post-avatar ${isAnon ? 'anon' : ''}">${avatarInitial}</div>
          <div class="post-author-meta">
            <span class="post-author-name">${authorName} ${isAnon ? '<span style="font-size: 11px; color: var(--text-dim); font-weight: normal;">(Confession)</span>' : ''}</span>
            <span class="post-time">${timeStr}</span>
          </div>
        </div>
        ${post.is_mine ? `
          <button type="button" class="btn-delete-post" data-post-id="${post.id}" title="Xóa bài viết" aria-label="Xóa bài viết">
            <span>Xóa</span>
          </button>
        ` : ''}
      </div>

      <h4 class="post-title">${escapeHtml(post.title)}</h4>
      <p class="post-content">${escapeHtml(post.content)}</p>

      ${attachmentsHtml}

      <div class="post-actions-bar">
        <button class="btn-post-action btn-toggle-like ${isLiked ? 'liked' : ''}" data-id="${post.id}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
          </svg>
          <span class="like-count-num">${post.like_count || 0}</span> Thích
        </button>

        <button class="btn-post-action btn-toggle-comments" data-id="${post.id}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <span class="comment-count-num">${post.comment_count || 0}</span> Bình luận
        </button>
      </div>

      <!-- Comments Thread -->
      <div class="post-comments-section hidden" id="comments-section-${post.id}">
        <div class="comment-input-row">
          <input type="text" class="form-input comment-text-input" maxlength="2000" placeholder="Viết bình luận hoặc trao đổi..." data-post-id="${post.id}">
          <button class="btn btn-primary btn-sm btn-submit-comment" data-post-id="${post.id}">Gửi</button>
        </div>
        <div class="comments-list" id="comments-list-${post.id}">
          <!-- Comments loaded dynamically -->
        </div>
      </div>
    </div>
  `;
}

function attachPostCardEvents(container) {
  // Toggle Like
  container.querySelectorAll('.btn-toggle-like').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!AppState.token) {
        showToast('Vui lòng đăng nhập để thích bài viết.', 'warning');
        return;
      }
      const postId = btn.getAttribute('data-id');
      btn.disabled = true;
      try {
        const res = await BduApi.toggleCommunityPostLike(AppState.token, postId);
        btn.classList.toggle('liked', res.liked);
        const postCard = btn.closest('[data-post-id]');
        const countEl = btn.querySelector('.like-count-num') || postCard?.querySelector('.forum-counts-right .like-count-num');
        if (countEl) countEl.textContent = res.like_count;
        if (btn.classList.contains('forum-action-btn')) {
          const label = btn.querySelector('span');
          if (label) label.textContent = res.liked ? 'Đã thích' : 'Thích';
        }
        [AppState.confession.posts, AppState.clans.posts].forEach(posts => {
          const post = (posts || []).find(item => String(item.id) === String(postId));
          if (post) {
            post.is_liked = res.liked;
            post.like_count = res.like_count;
          }
        });
      } catch (err) {
        showToast(err.message || 'Không thể tương tác Like.', 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });

  // Nút chỉ hiển thị với bài của chính người dùng; API vẫn kiểm tra quyền lần nữa.
  container.querySelectorAll('.btn-delete-post').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!AppState.token) {
        showToast('Vui lòng đăng nhập lại để xóa bài viết.', 'warning');
        return;
      }
      const postId = btn.getAttribute('data-post-id');
      if (!postId) return;
      const postCard = btn.closest('[data-post-id]');
      const postTitle = postCard?.querySelector('.forum-post-title, .post-title, .clan-post-title')?.textContent?.trim();
      const confirmed = await requestDeletePostConfirmation(postTitle, btn);
      if (!confirmed) return;

      btn.disabled = true;
      try {
        await BduApi.deleteCommunityPost(AppState.token, postId);
        closeDeletePostModal();
        AppState.confession.posts = (AppState.confession.posts || []).filter(post => String(post.id) !== String(postId));
        AppState.clans.posts = (AppState.clans.posts || []).filter(post => String(post.id) !== String(postId));
        showToast('Đã xóa bài viết.', 'success');

        if (container.id === 'confession-feed-stream') {
          await loadConfessions();
        } else if (container.id === 'clan-posts-feed' && AppState.clans.currentClan) {
          await loadClanPosts(AppState.clans.currentClan.id);
          loadClanDocuments(AppState.clans.currentClan.id).catch(() => {});
        } else {
          btn.closest('[data-post-id]')?.remove();
        }
      } catch (err) {
        closeDeletePostModal();
        btn.disabled = false;
        showToast(err.message || 'Không thể xóa bài viết.', 'error');
      }
    });
  });

  // Toggle Comments
  container.querySelectorAll('.btn-toggle-comments').forEach(btn => {
    btn.addEventListener('click', async () => {
      const postId = btn.getAttribute('data-id');
      const section = document.getElementById(`comments-section-${postId}`);
      if (!section) return;

      const isHidden = section.classList.contains('hidden');
      if (isHidden) {
        section.classList.remove('hidden');
        await loadCommentsForPost(postId);
      } else {
        section.classList.add('hidden');
      }
    });
  });

  // Submit comment
  container.querySelectorAll('.btn-submit-comment').forEach(btn => {
    btn.addEventListener('click', async () => {
      const postId = btn.getAttribute('data-id') || btn.getAttribute('data-post-id');
      const input = container.querySelector(`.comment-text-input[data-post-id="${postId}"]`);
      const content = input?.value?.trim();
      if (!content) return;

      if (!AppState.token) {
        showToast('Vui lòng đăng nhập để bình luận.', 'warning');
        return;
      }

      try {
        btn.disabled = true;
        await BduApi.addCommunityPostComment(AppState.token, postId, { content });
        input.value = '';
        await loadCommentsForPost(postId);
        // Increment comment counter on post
        const postCard = btn.closest('[data-post-id]');
        const countEls = postCard?.querySelectorAll('.comment-count-num, .comments-count-inline') || [];
        countEls.forEach(el => {
          el.textContent = Number(el.textContent || 0) + 1;
        });
        [AppState.confession.posts, AppState.clans.posts].forEach(posts => {
          const post = (posts || []).find(item => String(item.id) === String(postId));
          if (post) post.comment_count = Number(post.comment_count || 0) + 1;
        });
      } catch (err) {
        showToast(err.message || 'Không thể gửi bình luận.', 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function loadCommentsForPost(postId) {
  const listEl = document.getElementById(`comments-list-${postId}`);
  if (!listEl) return;

  try {
    const comments = await BduApi.getCommunityPostComments(AppState.token, postId);
    if (!comments || comments.length === 0) {
      listEl.innerHTML = `<p style="font-size: 12.5px; color: var(--text-dim); text-align: center; padding: 14px 10px;">Chưa có bình luận nào. Hãy là người đầu tiên bình luận!</p>`;
      return;
    }

    listEl.innerHTML = comments.map(c => {
      const isAnon = Boolean(c.is_anonymous);
      const rawName = isAnon ? 'Sinh viên giấu tên' : (c.author?.name || 'Thành viên BDU');
      const name = escapeHtml(rawName);
      const relativeTime = typeof formatRelativeTime === 'function' ? formatRelativeTime(c.created_at) : 'Vừa xong';
      const titles = isAnon
        ? renderIdentityTitleBadges([{ label: 'Ẩn danh', tone: 'member' }])
        : renderIdentityTitleBadges(c.author?.titles, 'identity-title-comment');

      return `
        <div class="comment-card-item">
          <div class="comment-card-layout">
            <div class="comment-card-avatar ${isAnon ? 'anon' : ''}">${isAnon ? '?' : renderIdentityAvatar(c.author, rawName)}</div>
            <div class="comment-card-copy">
              <div class="comment-card-top">
                <span class="comment-author-name ${isAnon ? 'anon' : ''}">${name} ${titles}</span>
                <span class="comment-time">${relativeTime}</span>
              </div>
              <div class="comment-body-text">${escapeHtml(c.content)}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    listEl.innerHTML = `<p style="font-size: 12px; color: var(--color-rose); padding: 10px;">${escapeHtml(err.message || 'Lỗi tải bình luận.')}</p>`;
  }
}

async function handleSubmitClanPost() {
  if (!AppState.token) {
    showToast('Vui lòng đăng nhập để đăng bài.', 'warning');
    return;
  }
  const currentClan = AppState.clans.currentClan;
  if (!currentClan) return;

  const mode = AppState.clans.composerMode || 'discussion';
  const title = document.getElementById('clan-post-title')?.value?.trim();
  const content = document.getElementById('clan-post-content')?.value?.trim();
  const isPinned = Boolean(document.getElementById('clan-post-pin')?.checked);

  if (!title) {
    showToast('Vui lòng nhập tiêu đề bài viết.', 'warning');
    return;
  }
  if (!content) {
    showToast('Vui lòng nhập nội dung bài viết.', 'warning');
    return;
  }

  let pollPayload = null;
  let category = 'discussion';

  if (mode === 'poll') {
    category = 'poll';
    const optInputs = document.querySelectorAll('#clan-poll-options-container .poll-opt-val');
    const options = Array.from(optInputs).map(i => i.value.trim()).filter(Boolean);
    if (options.length < 2) {
      showToast('Cuộc bình chọn phải có ít nhất 2 phương án lựa chọn.', 'warning');
      return;
    }
    pollPayload = {
      question: title,
      options
    };
  }

  const submitBtn = document.getElementById('btn-submit-clan-post');
  if (submitBtn) submitBtn.disabled = true;

  try {
    await BduApi.createCommunityPost(AppState.token, {
      title,
      content,
      scope: 'clan',
      scopeId: String(currentClan.id),
      category,
      isPinned,
      poll: pollPayload
    });

    showToast(mode === 'poll' ? 'Đã tạo cuộc bình chọn thành công!' : 'Đã đăng bài bản tin thành công!', 'success');

    // Reset fields & collapse composer
    if (document.getElementById('clan-post-title')) document.getElementById('clan-post-title').value = '';
    if (document.getElementById('clan-post-content')) document.getElementById('clan-post-content').value = '';
    if (document.getElementById('clan-post-pin')) document.getElementById('clan-post-pin').checked = false;

    // Reset poll options to default 2 rows
    const pollContainer = document.getElementById('clan-poll-options-container');
    if (pollContainer) {
      pollContainer.innerHTML = `
        <div class="poll-option-input-row">
          <span class="poll-opt-num">1</span>
          <input type="text" class="form-input poll-opt-val" maxlength="180" placeholder="Lựa chọn 1 (vd: Thứ 7 sinh hoạt)">
        </div>
        <div class="poll-option-input-row">
          <span class="poll-opt-num">2</span>
          <input type="text" class="form-input poll-opt-val" maxlength="180" placeholder="Lựa chọn 2 (vd: Chủ Nhật sinh hoạt)">
        </div>
      `;
    }

    document.getElementById('modal-clan-post-composer')?.classList.add('hidden');

    // Reload posts
    await loadClanPosts(currentClan.id);
  } catch (err) {
    showToast(err.message || 'Không thể đăng bài viết.', 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function loadClanMembers(clanId) {
  const tbody = document.getElementById('clan-members-tbody');
  const statsEl = document.getElementById('clan-members-stats');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 25px; color: var(--text-muted);">Đang tải danh sách thành viên...</td></tr>`;

  try {
    const res = await fetch(`/api/community/clans/${encodeURIComponent(clanId)}/members`);
    const json = await res.json();
    const members = json.data || [];

    const currentClan = AppState.clans.currentClan;
    const isLeader = currentClan?.my_role === 'leader';
    const isVice = currentClan?.my_role === 'vice_leader';

    // Update count in subtab badge
    const subtabCount = document.getElementById('channel-subtab-mem-count');
    if (subtabCount) subtabCount.textContent = members.length;

    // Update stats
    const activeCount = members.filter(m => m.is_active).length;
    if (statsEl) {
      statsEl.innerHTML = `
        <span class="stat-pill">Tổng: ${members.length} thành viên</span>
        <span class="stat-pill active-pill">🟢 ${activeCount} Đã kích hoạt web</span>
      `;
    }

    if (members.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 25px; color: var(--text-muted);">Chưa có thành viên nào trong nhóm.</td></tr>`;
      return;
    }

    tbody.innerHTML = members.map(m => {
      const isAct = Boolean(m.is_active);
      const name = escapeHtml(m.full_name || 'Sinh viên BDU');
      const avatarInitial = name.charAt(0).toUpperCase() || 'S';
      
      let roleHtml = '<span class="role-badge role-badge-member">🛡️ Thành Viên</span>';
      if (m.role === 'leader') {
        roleHtml = '<span class="role-badge role-badge-leader">👑 Bang Chủ</span>';
      } else if (m.role === 'vice_leader') {
        roleHtml = '<span class="role-badge role-badge-vice">⭐ Phó Bang</span>';
      }

      const joinDate = m.joined_at ? new Date(m.joined_at).toLocaleDateString('vi-VN') : 'Mới đây';

      // Actions
      let actionsHtml = '<span style="color: var(--text-dim); font-size: 11.5px;">-</span>';
      if (isLeader) {
        if (m.role === 'leader') {
          actionsHtml = '<span style="color: #f59e0b; font-size: 12px; font-weight: 700;">Bang Chủ</span>';
        } else {
          actionsHtml = `
            <div class="member-action-cell">
              <select class="member-role-select" data-mssv="${m.mssv}">
                <option value="member" ${m.role === 'member' ? 'selected' : ''}>Thành Viên</option>
                <option value="vice_leader" ${m.role === 'vice_leader' ? 'selected' : ''}>Phó Bang</option>
                <option value="leader">Nhượng Bang Chủ</option>
              </select>
              <button class="btn-kick-member" data-mssv="${m.mssv}" title="Khai trừ khỏi CLB">Khai trừ</button>
            </div>
          `;
        }
      } else if (isVice && m.role === 'member') {
        actionsHtml = `
          <div class="member-action-cell">
            <button class="btn-kick-member" data-mssv="${m.mssv}" title="Mời ra khỏi nhóm">Mời ra</button>
          </div>
        `;
      }

      return `
        <tr data-mssv="${m.mssv}">
          <td>
            <div class="member-user-cell">
              <div class="member-avatar-circle">${avatarInitial}</div>
              <span class="member-name-text">${name}</span>
            </div>
          </td>
          <td style="font-family: monospace; font-weight: 600; color: var(--text-main);">${escapeHtml(m.mssv)}</td>
          <td>${roleHtml}</td>
          <td>
            <span class="status-badge ${isAct ? 'active-user' : 'inactive-user'}">
              <span class="status-dot"></span>
              ${isAct ? 'Đã kích hoạt' : 'Chưa kích hoạt'}
            </span>
          </td>
          <td style="color: var(--text-muted); font-size: 12px;">${joinDate}</td>
          <td>${actionsHtml}</td>
        </tr>
      `;
    }).join('');

    // Attach role change event
    tbody.querySelectorAll('.member-role-select').forEach(select => {
      select.addEventListener('change', async (e) => {
        const targetMssv = select.getAttribute('data-mssv');
        const newRole = select.value;
        const confirmMsg = newRole === 'leader' 
          ? `Bạn có CHẮC CHẮN muốn nhượng lại toàn bộ quyền Bang Chủ cho sinh viên MSSV ${targetMssv}? Bạn sẽ trở thành thành viên bình thường.`
          : `Bạn có muốn đổi vai trò của ${targetMssv} thành ${newRole === 'vice_leader' ? 'Phó Bang' : 'Thành Viên'}?`;

        if (!confirm(confirmMsg)) {
          await loadClanMembers(clanId);
          return;
        }

        try {
          await BduApi.updateClanMemberRole(AppState.token, clanId, targetMssv, newRole);
          showToast('Cập nhật quyền thành viên thành công!', 'success');
          await loadClansDirectory();
          // Reload clan details
          const updatedClan = AppState.clans.list.find(c => String(c.id) === String(clanId));
          if (updatedClan) {
            AppState.clans.currentClan = updatedClan;
            openClanChannel(clanId);
          }
          await loadClanMembers(clanId);
        } catch (err) {
          showToast(err.message || 'Không thể đổi chức vụ.', 'error');
          await loadClanMembers(clanId);
        }
      });
    });

    // Attach kick event
    tbody.querySelectorAll('.btn-kick-member').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetMssv = btn.getAttribute('data-mssv');
        if (!confirm(`Bạn có chắc muốn khai trừ sinh viên MSSV ${targetMssv} ra khỏi CLB?`)) return;

        try {
          await BduApi.kickClanMember(AppState.token, clanId, targetMssv);
          showToast('Đã mời thành viên ra khỏi nhóm.', 'info');
          await loadClanMembers(clanId);
          await loadClansDirectory();
        } catch (err) {
          showToast(err.message || 'Không thể khai trừ thành viên.', 'error');
        }
      });
    });

  } catch (err) {
    console.error('Lỗi tải thành viên CLB:', err);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--color-rose);">${escapeHtml(err.message || 'Không thể tải danh sách thành viên.')}</td></tr>`;
  }
}

async function handleSaveClanSettings() {
  const currentClan = AppState.clans.currentClan;
  if (!currentClan || !AppState.token) return;

  const name = document.getElementById('edit-clan-name')?.value?.trim();
  const tag = document.getElementById('edit-clan-tag')?.value?.trim();
  const description = document.getElementById('edit-clan-desc')?.value?.trim();

  if (!name) {
    showToast('Tên CLB không được để trống.', 'warning');
    return;
  }

  try {
    const updated = await BduApi.updateClan(AppState.token, currentClan.id, { name, tag, description });
    showToast('Cập nhật thông tin CLB thành công!', 'success');
    await loadClansDirectory();
    currentClan.name = updated.name;
    currentClan.tag = updated.tag;
    currentClan.description = updated.description;
    openClanChannel(currentClan.id);
  } catch (err) {
    showToast(err.message || 'Không thể cập nhật thông tin CLB.', 'error');
  }
}

async function handleDisbandClan() {
  const currentClan = AppState.clans.currentClan;
  if (!currentClan || !AppState.token) return;

  const confirmPrompt = prompt(`CẢNH BÁO NGUY HIỂM: Giải tán CLB sẽ xóa vĩnh viễn toàn bộ bài viết và thành viên của nhóm "${currentClan.name}".\\n\\nNhập chữ "GIẢI TÁN" để xác nhận:`);
  if (confirmPrompt !== 'GIẢI TÁN') {
    showToast('Đã hủy thao tác giải tán CLB.', 'info');
    return;
  }

  try {
    await BduApi.disbandClan(AppState.token, currentClan.id);
    showToast('Đã giải tán CLB thành công.', 'info');
    document.getElementById('clan-channel-view')?.classList.add('hidden');
    document.getElementById('clan-main-view')?.classList.remove('hidden');
    AppState.clans.currentClan = null;
    await loadClansDirectory();
  } catch (err) {
    showToast(err.message || 'Không thể giải tán CLB.', 'error');
  }
}

// ============================================================================
// BDU CONFESSION & DIỄN ĐÀN SINH VIÊN (NGỌC RỒNG / DRAGON BOY FORUM STYLE)
// ============================================================================
AppState.confession = {
  posts: [],
  activeScope: 'school',
  activeCategory: 'all',
  activeFilter: 'all', // 'all' | 'mine' | 'anon'
  requestId: 0,
  framePreview: (function() {
    try { return localStorage.getItem('bdu_custom_frame_preview') || null; } catch(e) { return null; }
  })()
};

let deletePostConfirmation = null;
let deletePostCloseTimer = null;

function setDeletePostModalLoading(isLoading) {
  const confirmBtn = document.getElementById('btn-confirm-delete-post');
  const cancelBtn = document.getElementById('btn-cancel-delete-post');
  const closeBtn = document.getElementById('btn-close-delete-post');
  if (confirmBtn) {
    confirmBtn.disabled = isLoading;
    confirmBtn.classList.toggle('is-loading', isLoading);
    const label = confirmBtn.querySelector('span');
    if (label) label.textContent = isLoading ? 'Đang xóa...' : 'Xóa bài viết';
  }
  if (cancelBtn) cancelBtn.disabled = isLoading;
  if (closeBtn) closeBtn.disabled = isLoading;
}

function closeDeletePostModal(result = false) {
  const modal = document.getElementById('modal-delete-post');
  if (!modal || modal.classList.contains('hidden')) return;

  modal.classList.add('is-closing');
  const pending = deletePostConfirmation;
  deletePostConfirmation = null;
  if (pending && !pending.settled) {
    pending.settled = true;
    pending.resolve(result);
  }

  clearTimeout(deletePostCloseTimer);
  deletePostCloseTimer = setTimeout(() => {
    modal.classList.add('hidden');
    modal.classList.remove('is-closing');
    document.body.classList.remove('modal-lock');
    setDeletePostModalLoading(false);
    if (pending?.trigger?.isConnected) pending.trigger.focus();
    deletePostCloseTimer = null;
  }, 160);
}

function requestDeletePostConfirmation(postTitle, trigger) {
  const modal = document.getElementById('modal-delete-post');
  if (!modal) return Promise.resolve(false);

  clearTimeout(deletePostCloseTimer);
  deletePostCloseTimer = null;

  if (deletePostConfirmation && !deletePostConfirmation.settled) {
    deletePostConfirmation.settled = true;
    deletePostConfirmation.resolve(false);
  }

  const titleEl = document.getElementById('delete-post-title');
  if (titleEl) titleEl.textContent = postTitle || 'Bài viết của bạn';
  setDeletePostModalLoading(false);
  modal.classList.remove('hidden', 'is-closing');
  document.body.classList.add('modal-lock');

  return new Promise(resolve => {
    deletePostConfirmation = { resolve, trigger, settled: false };
    requestAnimationFrame(() => document.getElementById('btn-cancel-delete-post')?.focus());
  });
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return 'Vừa xong';
  const now = new Date();
  const past = new Date(dateStr);
  const diffSec = Math.floor((now - past) / 1000);

  if (diffSec < 60) return 'Vừa xong';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} ngày trước`;
  return past.toLocaleDateString('vi-VN');
}

function initConfessionModule() {
  // 1. Filter Tabs (Tất cả, Bài của tôi, Confession ẩn danh)
  const filterPills = document.querySelectorAll('.forum-filter-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', async () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      AppState.confession.activeFilter = pill.getAttribute('data-filter') || 'all';
      await loadConfessions();
    });
  });

  // 3. Quick Composer Trigger -> Mở Modal phong cách Facebook
  const quickTrigger = document.getElementById('quick-composer-trigger');
  if (quickTrigger) {
    quickTrigger.addEventListener('click', () => {
      openCreateConfessionModal('content');
    });
  }

  // Quick Composer tag helpers
  document.getElementById('btn-quick-attach-drive')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openCreateConfessionModal('drive');
  });

  document.getElementById('btn-quick-anon-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const anonCheckbox = document.getElementById('cfs-post-anon');
    if (anonCheckbox) anonCheckbox.checked = true;
    openCreateConfessionModal('content');
  });

  document.getElementById('btn-quick-scope-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const scopeSelect = document.getElementById('cfs-post-scope');
    if (scopeSelect) {
      scopeSelect.value = scopeSelect.value === 'school' ? 'faculty' : 'school';
    }
    openCreateConfessionModal('content');
  });

  // Modal Close events
  document.getElementById('btn-close-cfs-modal')?.addEventListener('click', closeCreateConfessionModal);
  
  const cfsModal = document.getElementById('modal-create-confession');
  if (cfsModal) {
    cfsModal.addEventListener('click', (e) => {
      if (e.target === cfsModal) {
        closeCreateConfessionModal();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !cfsModal.classList.contains('hidden')) {
        closeCreateConfessionModal();
      }
    });
  }

  const deleteModal = document.getElementById('modal-delete-post');
  document.getElementById('btn-close-delete-post')?.addEventListener('click', () => closeDeletePostModal(false));
  document.getElementById('btn-cancel-delete-post')?.addEventListener('click', () => closeDeletePostModal(false));
  document.getElementById('btn-confirm-delete-post')?.addEventListener('click', () => {
    if (!deletePostConfirmation || deletePostConfirmation.settled) return;
    deletePostConfirmation.settled = true;
    deletePostConfirmation.resolve(true);
    setDeletePostModalLoading(true);
  });
  deleteModal?.addEventListener('click', event => {
    if (event.target === deleteModal && !document.getElementById('btn-confirm-delete-post')?.disabled) {
      closeDeletePostModal(false);
    }
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && deleteModal && !deleteModal.classList.contains('hidden') && !document.getElementById('btn-confirm-delete-post')?.disabled) {
      closeDeletePostModal(false);
    }
  });

  // Toggle Anon mode in Facebook modal
  const toggleAnonMode = () => {
    const anonCheckbox = document.getElementById('cfs-post-anon');
    if (anonCheckbox) {
      anonCheckbox.checked = !anonCheckbox.checked;
      syncFbModalAnonUI();
    }
  };
  document.getElementById('fb-btn-toggle-anon')?.addEventListener('click', toggleAnonMode);
  document.getElementById('fb-tool-anon')?.addEventListener('click', toggleAnonMode);

  // Modal Toolbar shortcuts for Drive and YouTube
  document.getElementById('fb-tool-drive')?.addEventListener('click', () => {
    document.getElementById('cfs-post-drive-url')?.focus();
  });
  document.getElementById('fb-tool-youtube')?.addEventListener('click', () => {
    document.getElementById('cfs-post-drive-url')?.focus();
  });

  // Submit button
  const submitBtn = document.getElementById('btn-submit-cfs');
  if (submitBtn) {
    submitBtn.addEventListener('click', handleSubmitConfession);
  }

  // Sync user profile widgets
  updateForumUserWidgets();
}

function openCreateConfessionModal(focusTarget = 'content') {
  const modal = document.getElementById('modal-create-confession');
  if (!modal) return;

  const user = AppState.user;
  const name = user?.name || user?.fullName || 'Sinh viên BDU';
  const authorNameEl = document.getElementById('fb-modal-author-name');
  if (authorNameEl) authorNameEl.textContent = name;

  const contentTextarea = document.getElementById('cfs-post-content');
  if (contentTextarea) {
    contentTextarea.placeholder = `${name} ơi, bạn đang nghĩ gì thế? Chia sẻ câu hỏi ôn thi, review môn học, tài liệu hoặc tâm sự...`;
  }

  syncFbModalAnonUI();
  modal.classList.remove('hidden');

  setTimeout(() => {
    if (focusTarget === 'drive') {
      document.getElementById('cfs-post-drive-url')?.focus();
    } else if (focusTarget === 'title') {
      document.getElementById('cfs-post-title')?.focus();
    } else {
      contentTextarea?.focus();
    }
  }, 60);
}

function closeCreateConfessionModal() {
  const modal = document.getElementById('modal-create-confession');
  if (modal) modal.classList.add('hidden');
}

function syncFbModalAnonUI() {
  const anonCheckbox = document.getElementById('cfs-post-anon');
  const isAnon = anonCheckbox ? Boolean(anonCheckbox.checked) : true;
  const avatarEl = document.getElementById('fb-modal-avatar');
  const authorNameEl = document.getElementById('fb-modal-author-name');
  const anonPill = document.getElementById('fb-btn-toggle-anon');
  const anonIcon = document.getElementById('fb-anon-icon');
  const anonLabel = document.getElementById('fb-anon-label');

  const user = AppState.user;
  const name = user?.name || user?.fullName || 'Sinh viên BDU';
  const initial = (name.charAt(0) || 'S').toUpperCase();
  const photoUrl = user?.photoUrl || localStorage.getItem('bdu_user_photo') || '';

  if (isAnon) {
    if (avatarEl) {
      avatarEl.className = 'fb-author-avatar anon';
      avatarEl.textContent = 'AD';
    }
    if (authorNameEl) authorNameEl.textContent = 'Sinh viên giấu tên (Confession)';
    if (anonPill) anonPill.classList.add('active');
    if (anonIcon) anonIcon.textContent = '';
    if (anonLabel) anonLabel.textContent = 'Ẩn danh: Bật';
  } else {
    if (avatarEl) {
      avatarEl.className = 'fb-author-avatar';
      avatarEl.innerHTML = photoUrl
        ? `<img src="${photoUrl}" alt="${escapeHtml(name)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;">`
        : initial;
    }
    if (authorNameEl) authorNameEl.textContent = name;
    if (anonPill) anonPill.classList.remove('active');
    if (anonIcon) anonIcon.textContent = '';
    if (anonLabel) anonLabel.textContent = 'Công khai';
  }
}

function normalizeFacultyCode(source) {
  const rawCode = typeof source === 'string'
    ? source
    : (source?.ma_khoa || source?.faculty_code || source?.facultyCode || '');
  return String(rawCode).trim().toUpperCase();
}

function isThFaculty(source) {
  return normalizeFacultyCode(source) === 'TH';
}

const FULL_FRAME_PREVIEW_MSSV = new Set(['24050126']);

function hasFullFramePreviewAccess(user = AppState.user) {
  const mssv = String(user?.mssv || '').trim().toUpperCase();
  return FULL_FRAME_PREVIEW_MSSV.has(mssv);
}

function buildScopeFrameConfig(scope, rank, totalStudents, facultyCode = '') {
  const isTop1 = (Number(rank) === 1);
  const r = Number(rank) || 1;
  const schoolTier = r === 1 ? 'top-1' : (r === 2 ? 'top-2' : (r === 3 ? 'top-3' : 'top-6-10'));
  const schoolFrameSvg = r === 1
    ? 'assets/frames/frame-truong-top-1.svg'
    : (r === 2
      ? 'assets/frames/frame-truong-top-2.svg'
      : (r === 3 ? 'assets/frames/frame-truong-top-3.svg' : 'assets/frames/frame-truong-top.svg'));
  const schoolTitle = r === 1
    ? 'Thiên Cực Đế Tinh BDU'
    : (r === 2 ? 'Song Nguyệt Tinh Vân BDU' : (r === 3 ? 'Tam Tinh Xích Quang BDU' : `Tinh Tú Top ${r} BDU`));
  let scopeCode = 'truong';
  const s = String(scope || 'truong').toLowerCase();
  if (s.includes('vien') || s.includes('institute')) scopeCode = 'vien';
  else if (s.includes('khoa') || s.includes('faculty')) scopeCode = 'khoa';
  else if (s.includes('lop') || s.includes('class')) scopeCode = 'lop';

  const scopeConfig = {
    truong: {
      scopeLabel: 'Toàn Trường',
      scopeUpper: 'TOÀN TRƯỜNG',
      icon: r === 1 ? '✦' : (r === 2 ? '☾' : (r === 3 ? '△' : '✧')),
      title: schoolTitle,
      frameSvg: schoolFrameSvg,
      tier: schoolTier,
      badgeText: r === 1 ? '✦ #1 TOÀN TRƯỜNG' : (r === 2 ? '☾ #2 TOÀN TRƯỜNG' : (r === 3 ? '△ #3 TOÀN TRƯỜNG' : `✧ #${r} TOÀN TRƯỜNG`))
    },
    vien: {
      scopeLabel: 'Viện',
      scopeUpper: 'VIỆN',
      icon: isTop1 ? '👑' : (r === 2 ? '🥈' : '🥈'),
      title: isTop1 ? 'Quán Quân Viện' : (r === 2 ? 'Á Quân 1 Viện' : `Top ${r} Viện`),
      frameSvg: isTop1 ? 'assets/frames/frame-vien-top-1.svg' : 'assets/frames/frame-vien-top.svg',
      tier: 'top-2',
      badgeText: isTop1 ? '👑 #1 VIỆN' : (r === 2 ? '🥈 #2 VIỆN' : `🥈 #${r} VIỆN`)
    },
    khoa: {
      scopeLabel: 'Khoa',
      scopeUpper: 'KHOA',
      icon: isTop1 ? '🏆' : '💎',
      title: isTop1 ? 'Quán Quân Khoa' : `Top ${r} Khoa`,
      frameSvg: isTop1 ? 'assets/frames/frame-khoa-top-1.svg' : 'assets/frames/frame-khoa-top.svg',
      tier: 'top-4-5',
      badgeText: isTop1 ? '🏆 #1 KHOA' : `💎 #${r} KHOA`
    },
    lop: {
      scopeLabel: 'Lớp',
      scopeUpper: 'LỚP',
      icon: isTop1 ? '🔥' : '🥉',
      title: isTop1 ? 'Quán Quân Lớp' : `Top ${r} Lớp`,
      frameSvg: isTop1 ? 'assets/frames/frame-lop-top-1.svg' : 'assets/frames/frame-lop-top.svg',
      tier: 'top-3',
      badgeText: isTop1 ? '🔥 #1 LỚP' : (r === 3 ? '🥉 #3 LỚP' : `🥉 #${r} LỚP`)
    }
  };

  const thFacultyFrame = scopeCode === 'khoa' && isThFaculty(facultyCode);
  const thFacultyConfig = r === 1
    ? {
      scopeLabel: 'Khoa TH',
      scopeUpper: 'KHOA TH',
      icon: '⌁',
      title: 'Quantum Compiler Crown',
      frameSvg: 'assets/frames/frame-khoa-th-top-1.svg',
      tier: 'top-1',
      badgeText: '⌁ #1 KHOA TH',
      introEffect: 'th-quantum-compile',
      themeKey: 'khoa-th-1'
    }
    : (r === 2
      ? {
        scopeLabel: 'Khoa TH',
        scopeUpper: 'KHOA TH',
        icon: 'Ⅱ',
        title: 'Dual-Core Synapse',
        frameSvg: 'assets/frames/frame-khoa-th-top-2.svg',
        tier: 'top-2',
        badgeText: 'Ⅱ #2 KHOA TH',
        introEffect: 'th-dual-synapse',
        themeKey: 'khoa-th-2'
      }
      : (r === 3
        ? {
          scopeLabel: 'Khoa TH',
          scopeUpper: 'KHOA TH',
          icon: 'Ⅲ',
          title: 'Ternary Data Stack',
          frameSvg: 'assets/frames/frame-khoa-th-top-3.svg',
          tier: 'top-3',
          badgeText: 'Ⅲ #3 KHOA TH',
          introEffect: 'th-ternary-boot',
          themeKey: 'khoa-th-3'
        }
        : {
          scopeLabel: 'Khoa TH',
          scopeUpper: 'KHOA TH',
          icon: '⌘',
          title: `Protocol Bracket #${r}`,
          frameSvg: 'assets/frames/frame-khoa-th-top-4-10.svg',
          tier: 'top-6-10',
          badgeText: `⌘ #${r} KHOA TH`,
          introEffect: 'th-protocol-lock',
          themeKey: 'khoa-th-4-10'
        }));

  const cfg = thFacultyFrame ? { ...scopeConfig.khoa, ...thFacultyConfig } : (scopeConfig[scopeCode] || scopeConfig.truong);
  const topOneEffects = {
    truong: 'constellation-forge',
    vien: 'crystal-wings',
    khoa: 'mecha-assemble',
    lop: 'phoenix-rise'
  };
  const introEffect = thFacultyFrame
    ? thFacultyConfig.introEffect
    : (scopeCode === 'truong'
    ? (r === 1 ? 'constellation-forge' : (r === 2 ? 'binary-eclipse' : (r === 3 ? 'triad-supernova' : 'orbit-lock')))
    : (r === 1
      ? topOneEffects[scopeCode]
      : (r === 2 ? 'runner-up-dual' : (r === 3 ? 'blade-cross' : 'elite-pulse'))));

  return {
    rank: r,
    scope: scopeCode,
    scopeLabel: cfg.scopeLabel,
    scopeUpper: cfg.scopeUpper,
    totalStudents: totalStudents || 0,
    tier: cfg.tier,
    frameSvg: cfg.frameSvg,
    introEffect,
    themeKey: thFacultyFrame ? thFacultyConfig.themeKey : null,
    frameFamily: thFacultyFrame ? 'khoa-th' : null,
    facultyCode: normalizeFacultyCode(facultyCode),
    icon: cfg.icon,
    title: cfg.title,
    badgeText: cfg.badgeText
  };
}

function buildAnimeSignatureFrameConfig(key) {
  const frames = {
    'anime-gojo': {
      rank: 0,
      scope: 'anime',
      scopeLabel: 'Anime Signature',
      scopeUpper: 'VÔ HẠN • LỤC NHÃN',
      totalStudents: 0,
      tier: 'anime-gojo',
      frameSvg: 'assets/images/frame-gojo-limitless-art.png',
      frameArt: 'assets/images/frame-gojo-limitless-art.png',
      awakeningAsset: 'assets/images/gojo-six-eyes-awakening.png',
      awakeningClosedAsset: 'assets/images/gojo-six-eyes-closed-v2.png',
      awakeningHalfAsset: 'assets/images/gojo-six-eyes-half-v2.png',
      characterAsset: 'assets/images/chibi-gojo-signature.png',
      characterSide: 'left',
      introEffect: 'gojo-limitless-awaken',
      themeKey: 'anime-gojo',
      frameFamily: 'anime-gojo',
      icon: '∞',
      title: 'Vô Hạn Lục Nhãn',
      badgeText: '∞ GOJO SIGNATURE',
      rankLabel: 'LIMITLESS • SIX EYES'
    },
    'anime-itachi': {
      rank: 0,
      scope: 'anime',
      scopeLabel: 'Anime Signature',
      scopeUpper: 'ẢO NGUYỆT • HẮC VIÊM',
      totalStudents: 0,
      tier: 'anime-itachi',
      frameSvg: 'assets/images/frame-itachi-genjutsu-art.png',
      frameArt: 'assets/images/frame-itachi-genjutsu-art.png',
      awakeningAsset: 'assets/images/itachi-sharingan-awakening.png',
      awakeningClosedAsset: 'assets/images/itachi-sharingan-closed-v2.png',
      awakeningHalfAsset: 'assets/images/itachi-sharingan-half-v2.png',
      characterAsset: 'assets/images/chibi-itachi-signature.png',
      characterSide: 'right',
      introEffect: 'itachi-crow-genjutsu',
      themeKey: 'anime-itachi',
      frameFamily: 'anime-itachi',
      icon: '●',
      title: 'Ảo Nguyệt Hắc Viêm',
      badgeText: '● ITACHI SIGNATURE',
      rankLabel: 'SHARINGAN • AMATERASU'
    }
  };
  return frames[key] || null;
}

function getAcademicAvatarFrame(rankingData) {
  // 1. Kiểm tra nếu người dùng đang chủ động chọn thử khung (Preview Mode)
  const previewTier = AppState.confession?.framePreview;
  const previewFacultyCode = hasFullFramePreviewAccess() ? 'TH' : normalizeFacultyCode(rankingData);
  const getPreviewRank = (scope, fallbackRank) => {
    const actualRank = Number(getStudentAcademicUnlockedFrames()?.[`${scope}-top`]?.currentRank);
    return actualRank >= 2 && actualRank <= 10 ? actualRank : fallbackRank;
  };
  if (previewTier && previewTier !== 'real') {
    if (previewTier === 'anime-gojo' || previewTier === 'anime-itachi') {
      if (hasFullFramePreviewAccess()) return buildAnimeSignatureFrameConfig(previewTier);
    } else if (previewTier === 'truong-1' || previewTier === 'top-1') {
      return buildScopeFrameConfig('truong', 1, 1800);
    } else if (previewTier === 'truong-2') {
      return buildScopeFrameConfig('truong', 2, 1800);
    } else if (previewTier === 'truong-3') {
      return buildScopeFrameConfig('truong', 3, 1800);
    } else if (previewTier === 'truong-top') {
      return buildScopeFrameConfig('truong', getPreviewRank('truong', 5), 1800);
    } else if (previewTier === 'vien-1') {
      return buildScopeFrameConfig('vien', 1, 450);
    } else if (previewTier === 'vien-top' || previewTier === 'top-2') {
      return buildScopeFrameConfig('vien', getPreviewRank('vien', 2), 450);
    } else if (previewTier === 'khoa-1') {
      return buildScopeFrameConfig('khoa', 1, 180, previewFacultyCode);
    } else if (previewTier === 'khoa-2') {
      return buildScopeFrameConfig('khoa', 2, 180, previewFacultyCode);
    } else if (previewTier === 'khoa-3') {
      return buildScopeFrameConfig('khoa', 3, 180, previewFacultyCode);
    } else if (previewTier === 'khoa-top' || previewTier === 'top-4-5') {
      const previewRank = getPreviewRank('khoa', 4);
      return buildScopeFrameConfig('khoa', previewRank < 4 ? 4 : previewRank, 180, previewFacultyCode);
    } else if (previewTier === 'lop-1') {
      return buildScopeFrameConfig('lop', 1, 60);
    } else if (previewTier === 'lop-top' || previewTier === 'top-3') {
      return buildScopeFrameConfig('lop', getPreviewRank('lop', 3), 60);
    } else if (previewTier === 'top-6-10') {
      return buildScopeFrameConfig('truong', 8, 1800);
    }
  }

  // 2. Chế độ thực tế: Tính toán dựa trên bảng xếp hạng học thuật của sinh viên
  if (!rankingData) return null;

  // Thu thập các thứ hạng nổi bật từ các chỉ số
  const candidates = [
    rankingData?.xep_hang_noi_bat?.tong_hop,
    rankingData?.xep_hang_noi_bat?.gpa_tich_luy,
    rankingData?.xep_hang_noi_bat?.tin_chi_tich_luy
  ].filter(r => r && Number.isFinite(Number(r.hang)) && Number(r.hang) >= 1);

  if (candidates.length === 0) return null;

  // Ưu tiên hạng nhỏ nhất (Top 1 > 2 > 3...), cùng hạng thì ưu tiên phạm vi rộng nhất (Toàn trường > Viện > Khoa > Lớp)
  const scopeWeights = { truong: 4, vien: 3, khoa: 2, lop: 1 };
  candidates.sort((a, b) => {
    const rankA = Number(a.hang);
    const rankB = Number(b.hang);
    if (rankA !== rankB) return rankA - rankB;
    return (scopeWeights[b.scope] || 1) - (scopeWeights[a.scope] || 1);
  });

  const best = candidates[0];
  const rank = Number(best.hang);

  // Chỉ các thứ hạng từ Top 1 đến 10 mới có khung avatar vinh danh
  if (rank > 10) return null;

  return buildScopeFrameConfig(best.scope, rank, best.tong_sinh_vien, rankingData?.ma_khoa);
}

// Định nghĩa danh mục các khung vinh danh học thuật
const ACADEMIC_FRAME_COLLECTION = [
  {
    key: 'truong-1',
    scope: 'truong',
    tier: 'top-1',
    svg: 'assets/frames/frame-truong-top-1.svg',
    icon: '✦',
    tag: '🏫 TOP 1 TOÀN TRƯỜNG',
    title: 'Thiên Cực Đế Tinh BDU',
    desc: 'Cực quang ba tầng, đế ấn Bắc Cực, tám tinh thạch và ba vành thiên cầu dành riêng cho vị trí độc tôn.'
  },
  {
    key: 'truong-2',
    scope: 'truong',
    tier: 'top-2',
    svg: 'assets/frames/frame-truong-top-2.svg',
    icon: '☾',
    tag: '🏫 TOP 2 TOÀN TRƯỜNG',
    title: 'Song Nguyệt Tinh Vân BDU',
    desc: 'Cặp nguyệt thực bạc–lam, hai vệ tinh danh dự và dải ngân hà song hành của ngôi Á quân.'
  },
  {
    key: 'truong-3',
    scope: 'truong',
    tier: 'top-3',
    svg: 'assets/frames/frame-truong-top-3.svg',
    icon: '△',
    tag: '🏫 TOP 3 TOÀN TRƯỜNG',
    title: 'Tam Tinh Xích Quang BDU',
    desc: 'Ba sao chủ đỏ tím liên kết thành tam giác quyền lực, kèm đuôi sao chổi và lõi xích quang.'
  },
  {
    key: 'truong-top',
    scope: 'truong',
    tier: 'top-6-10',
    svg: 'assets/frames/frame-truong-top.svg',
    icon: '✧',
    tag: '🏫 TOP 4 - 10 TOÀN TRƯỜNG',
    title: 'Kinh Tuyến Tinh Tú BDU',
    desc: 'Khung học thuật đa giác dùng chung cho Top 4–10, với một quỹ đạo lam ngọc và phù hiệu BDU tối giản.'
  },
  {
    key: 'vien-1',
    scope: 'vien',
    tier: 'top-2',
    svg: 'assets/frames/frame-vien-top-1.svg',
    icon: '👑',
    tag: '🎓 TOP 1 VIỆN',
    title: 'Bạch Kim Sapphire Viện Trưởng',
    desc: 'Bộ 4 cánh thiên thần pha lê tuyết, vầng trăng khuyết và ngôi sao bắc đẩu lam băng.'
  },
  {
    key: 'vien-top',
    scope: 'vien',
    tier: 'top-2',
    svg: 'assets/frames/frame-vien-top.svg',
    icon: '🥈',
    tag: '🎓 TOP 2 - 10 VIỆN',
    title: 'Băng Tinh Lam Vũ Sapphire',
    desc: 'Cánh pha lê Valkyrie sải rộng thanh khiết, hào quang cực quang phát sáng nhịp nhàng.'
  },
  {
    key: 'khoa-1',
    scope: 'khoa',
    tier: 'top-4-5',
    svg: 'assets/frames/frame-khoa-top-1.svg',
    icon: '🏆',
    tag: '🏛️ TOP 1 KHOA',
    title: 'Chiến Tướng Khiên Vàng Lục Bảo',
    desc: 'Giáp Mecha Gundam titan góc cạnh, song kiếm laser năng lượng và kính ngắm HUD.'
  },
  {
    key: 'khoa-top',
    scope: 'khoa',
    tier: 'top-4-5',
    svg: 'assets/frames/frame-khoa-top.svg',
    icon: '💎',
    tag: '🏛️ TOP 2 - 10 KHOA',
    title: 'Cyber Knight Emerald',
    desc: 'Khe tản nhiệt phản lực plasma xanh neon, mạch điện tử và lưỡi kiếm cyber sắc lẹm.'
  },
  {
    key: 'lop-1',
    scope: 'lop',
    tier: 'top-3',
    svg: 'assets/frames/frame-lop-top-1.svg',
    icon: '🔥',
    tag: '🎖️ TOP 1 LỚP',
    title: 'Phượng Hoàng Hoàng Kim Lửa',
    desc: 'Song đại đao răng cưa rực lửa bắt chéo chữ X, dây xích sắt và nham thạch nứt toác.'
  },
  {
    key: 'lop-top',
    scope: 'lop',
    tier: 'top-3',
    svg: 'assets/frames/frame-lop-top.svg',
    icon: '🥉',
    tag: '🎖️ TOP 2 - 10 LỚP',
    title: 'Hoàng Đồng Hổ Phách Nung',
    desc: 'Song đao chiến binh giác đấu, tàn tro lửa đỏ bập bùng và bệ đá dung nham nung nóng.'
  }
];

const KHOA_TH_FRAME_COLLECTION = [
  {
    key: 'khoa-1',
    scope: 'khoa',
    family: 'khoa-th',
    tier: 'top-1',
    svg: 'assets/frames/frame-khoa-th-top-1.svg',
    icon: '⌁',
    tag: '⌁ TOP 1 KHOA TH',
    title: 'Quantum Compiler Crown',
    desc: 'Bộ biên dịch lượng tử mười cạnh, memory bank đa tầng và computing crown tự tái cấu hình quanh lõi dữ liệu.'
  },
  {
    key: 'khoa-2',
    scope: 'khoa',
    family: 'khoa-th',
    tier: 'top-2',
    svg: 'assets/frames/frame-khoa-th-top-2.svg',
    icon: 'Ⅱ',
    tag: 'Ⅱ TOP 2 KHOA TH',
    title: 'Dual-Core Synapse',
    desc: 'Hai lõi xử lý bạch kim liên kết bởi cầu dữ liệu đồng bộ và clock-node trung tâm.'
  },
  {
    key: 'khoa-3',
    scope: 'khoa',
    family: 'khoa-th',
    tier: 'top-3',
    svg: 'assets/frames/frame-khoa-th-top-3.svg',
    icon: 'Ⅲ',
    tag: 'Ⅲ TOP 3 KHOA TH',
    title: 'Ternary Data Stack',
    desc: 'Ba data-pylon công nghiệp khởi động tuần tự và hợp nhất tín hiệu tại bảng trạng thái 01–02–03.'
  },
  {
    key: 'khoa-top',
    scope: 'khoa',
    family: 'khoa-th',
    tier: 'top-6-10',
    svg: 'assets/frames/frame-khoa-th-top-4-10.svg',
    icon: '⌘',
    tag: '⌘ TOP 4–10 KHOA TH',
    title: 'Protocol Bracket',
    desc: 'Cặp protocol bracket gunmetal, bốn node trạng thái và bảng hạng tối giản dành cho nhóm Top 4–10.'
  }
];

const ANIME_SIGNATURE_FRAME_COLLECTION = [
  {
    key: 'anime-gojo',
    scope: 'anime',
    family: 'anime-gojo',
    tier: 'anime-gojo',
    svg: 'assets/images/frame-gojo-limitless-art.png',
    art: 'assets/images/frame-gojo-limitless-art.png',
    character: 'assets/images/chibi-gojo-signature.png',
    characterSide: 'left',
    icon: '∞',
    tag: 'ĐỘC QUYỀN • GOJO',
    title: 'Vô Hạn Lục Nhãn',
    desc: 'Không gian bị nén thành sáu lớp dữ liệu, bẻ cong thành khung vô hạn rồi khai mở Lục Nhãn lam quang.'
  },
  {
    key: 'anime-itachi',
    scope: 'anime',
    family: 'anime-itachi',
    tier: 'anime-itachi',
    svg: 'assets/images/frame-itachi-genjutsu-art.png',
    art: 'assets/images/frame-itachi-genjutsu-art.png',
    character: 'assets/images/chibi-itachi-signature.png',
    characterSide: 'right',
    icon: '●',
    tag: 'ĐỘC QUYỀN • ITACHI',
    title: 'Ảo Nguyệt Hắc Viêm',
    desc: 'Đàn quạ tan thành mực đen, kết ấn Mangekyō rồi để Amaterasu bò dọc khung như ngọn lửa sống.'
  }
];

function getAcademicFrameCollection(rankingData) {
  if (!isThFaculty(rankingData) && !hasFullFramePreviewAccess()) {
    return [...ANIME_SIGNATURE_FRAME_COLLECTION, ...ACADEMIC_FRAME_COLLECTION];
  }
  return [...ANIME_SIGNATURE_FRAME_COLLECTION, ...ACADEMIC_FRAME_COLLECTION.flatMap(item => {
    if (item.key === 'khoa-1') return KHOA_TH_FRAME_COLLECTION;
    if (item.key === 'khoa-top') return [];
    return [item];
  })];
}

// Hàm kiểm tra các khung sinh viên được phép xài dựa trên thứ hạng thực tế
function getStudentAcademicUnlockedFrames() {
  const rankingData = AppState.academicRanking;
  const thFaculty = isThFaculty(rankingData);
  const getBestRankForScope = (scope) => {
    if (!rankingData) {
      // Fallback nếu đang có thứ hạng Á Quân Viện (#2 Viện) từ giao diện
      if (scope === 'vien') return 2;
      if (scope === 'khoa') return 2;
      if (scope === 'lop') return 1;
      return 9999;
    }
    const ranks = [];
    ['tong_hop', 'gpa_tich_luy', 'tin_chi_tich_luy'].forEach(metric => {
      const val = rankingData?.xep_hang?.[metric]?.[scope]?.hang;
      if (Number.isFinite(Number(val))) ranks.push(Number(val));
      const nb = rankingData?.xep_hang_noi_bat?.[metric];
      if (nb && nb.scope === scope && Number.isFinite(Number(nb.hang))) {
        ranks.push(Number(nb.hang));
      }
    });
    return ranks.length ? Math.min(...ranks) : 9999;
  };

  const truongRank = getBestRankForScope('truong');
  const vienRank = getBestRankForScope('vien');
  const khoaRank = getBestRankForScope('khoa');
  const lopRank = getBestRankForScope('lop');

  const unlockedFrames = {
    'anime-gojo': { unlocked: false, currentRank: 0, req: 'Khung độc quyền' },
    'anime-itachi': { unlocked: false, currentRank: 0, req: 'Khung độc quyền' },
    'truong-1': { unlocked: truongRank === 1, currentRank: truongRank, req: 'Top 1 Toàn Trường' },
    'truong-2': { unlocked: truongRank === 2, currentRank: truongRank, req: 'Top 2 Toàn Trường' },
    'truong-3': { unlocked: truongRank === 3, currentRank: truongRank, req: 'Top 3 Toàn Trường' },
    'truong-top': { unlocked: truongRank >= 4 && truongRank <= 10, currentRank: truongRank, req: 'Top 4-10 Toàn Trường' },
    'vien-1': { unlocked: vienRank === 1, currentRank: vienRank, req: 'Top 1 Viện' },
    'vien-top': { unlocked: vienRank <= 10, currentRank: vienRank, req: 'Top 2-10 Viện' },
    'khoa-1': { unlocked: khoaRank === 1, currentRank: khoaRank, req: thFaculty ? 'Top 1 Khoa TH' : 'Top 1 Khoa' },
    'khoa-2': { unlocked: thFaculty && khoaRank === 2, currentRank: khoaRank, req: 'Top 2 Khoa TH' },
    'khoa-3': { unlocked: thFaculty && khoaRank === 3, currentRank: khoaRank, req: 'Top 3 Khoa TH' },
    'khoa-top': { unlocked: khoaRank >= (thFaculty ? 4 : 2) && khoaRank <= 10, currentRank: khoaRank, req: thFaculty ? 'Top 4-10 Khoa TH' : 'Top 2-10 Khoa' },
    'lop-1': { unlocked: lopRank === 1, currentRank: lopRank, req: 'Top 1 Lớp' },
    'lop-top': { unlocked: lopRank <= 10, currentRank: lopRank, req: 'Top 2-10 Lớp' },
    'real': { unlocked: true, currentRank: 1, req: 'Mặc định học thuật' }
  };

  if (hasFullFramePreviewAccess()) {
    Object.values(unlockedFrames).forEach(frame => {
      frame.unlocked = true;
      frame.req = 'Tài khoản kiểm thử toàn bộ khung';
    });
  }

  return unlockedFrames;
}

// Khởi tạo và kết xuất giao diện bộ sưu tập khung vinh danh
function renderFrameCollectionModal() {
  const grid = document.getElementById('frame-picker-grid');
  const summaryEl = document.getElementById('frame-picker-user-rank-summary');
  if (!grid) return;

  const unlockedMap = getStudentAcademicUnlockedFrames();
  const storedEquipped = AppState.confession?.framePreview || 'real';
  const currentEquipped = storedEquipped === 'real' || unlockedMap[storedEquipped]?.unlocked
    ? storedEquipped
    : 'real';
  const naturalFrame = getAcademicAvatarFrame(AppState.academicRanking);
  const naturalKey = naturalFrame
    ? (naturalFrame.scope === 'truong' && naturalFrame.rank <= 3
      ? `truong-${naturalFrame.rank}`
      : (naturalFrame.frameFamily === 'khoa-th' && naturalFrame.rank <= 3
        ? `khoa-${naturalFrame.rank}`
      : `${naturalFrame.scope}-${naturalFrame.rank === 1 ? '1' : 'top'}`)
      )
    : 'real';

  if (summaryEl) {
    if (naturalFrame) {
      summaryEl.innerHTML = `🥈 Thành tích cao nhất: <strong>#${naturalFrame.rank} ${naturalFrame.scopeUpper}</strong> (${naturalFrame.title})`;
    } else {
      summaryEl.innerHTML = `🎓 Thành viên Diễn đàn BDU`;
    }
  }

  let html = '';

  // 1. Thẻ Tự động theo Bảng xếp hạng thật (Luôn mở khóa)
  const isRealActive = (currentEquipped === 'real');
  html += `
    <div class="frame-option-card is-unlocked ${isRealActive ? 'is-active' : ''}" onclick="selectAvatarFramePreview('real')">
      <div class="frame-mini-preview">
        <div class="mini-avatar-wrap">
          <div class="mini-avatar-circle" style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); font-size: 20px;">🎓</div>
        </div>
      </div>
      <div class="frame-option-info">
        <span class="frame-tag tier-member">🎓 TỰ ĐỘNG THEO XẾP HẠNG</span>
        <h4>Khung Theo Thành Tích Thật</h4>
        <p>Hệ thống tự động gán khung cao quý nhất bạn đạt được (Toàn trường, Viện, Khoa, Lớp).</p>
        <div style="margin-top: 6px;">
          ${isRealActive 
            ? '<span class="frame-status-badge status-active">🌟 ĐANG TRANG BỊ</span>' 
            : '<span class="frame-status-badge status-unlocked">✅ ĐƯỢC PHÉP DÙNG</span>'}
        </div>
      </div>
    </div>
  `;

  // 2. Duyệt qua các loại khung xếp hạng theo phạm vi
  getAcademicFrameCollection(AppState.academicRanking).forEach(item => {
    const status = unlockedMap[item.key] || { unlocked: false, req: 'Chưa đủ điều kiện' };
    const isUnlocked = status.unlocked;
    const isActive = isUnlocked && ((currentEquipped === item.key) || (currentEquipped === 'real' && naturalKey === item.key));

    let statusBadgeHtml = '';
    if (isActive) {
      statusBadgeHtml = '<span class="frame-status-badge status-active">🌟 ĐANG TRANG BỊ</span>';
    } else if (isUnlocked) {
      statusBadgeHtml = '<span class="frame-status-badge status-unlocked">✅ ĐƯỢC PHÉP DÙNG</span>';
    } else {
      statusBadgeHtml = `<span class="frame-status-badge status-locked">🔒 Yêu cầu: ${escapeHtml(status.req)}</span>`;
    }

    html += `
      <div class="frame-option-card ${isUnlocked ? 'is-unlocked' : 'is-locked'} ${isActive ? 'is-active' : ''}" 
           onclick="handleFrameCardClick('${item.key}', ${isUnlocked}, '${escapeHtml(status.req)}')">
        <div class="frame-mini-preview">
          <div class="mini-avatar-wrap has-frame-${item.tier} has-frame-scope-${item.scope} ${item.family ? `has-frame-${item.family}` : ''}">
            <div class="avatar-energy-ring"></div>
            <div class="mini-avatar-circle">${item.icon}</div>
            <img class="avatar-frame-overlay ${item.art ? 'anime-frame-art-mini' : ''}" src="${item.art || item.svg}" alt="${escapeHtml(item.title)}">
            ${item.character ? `<img class="anime-frame-character is-${item.characterSide}" src="${item.character}" alt="" loading="lazy" decoding="async">` : ''}
          </div>
        </div>
        <div class="frame-option-info">
          <span class="frame-tag tier-${item.tier}">${item.tag}</span>
          <h4>${escapeHtml(item.title)}</h4>
          <p>${escapeHtml(item.desc)}</p>
          <div style="margin-top: 6px;">
            ${statusBadgeHtml}
          </div>
        </div>
      </div>
    `;
  });

  grid.innerHTML = html;
}

// Xử lý khi người dùng nhấp vào thẻ khung
window.handleFrameCardClick = function(key, isUnlocked, reqText) {
  if (!isUnlocked) {
    if (typeof showToast === 'function') {
      showToast(`🔒 Bạn chưa đạt điều kiện mở khóa khung này! Yêu cầu: ${reqText}. Hãy tiếp tục nâng cao GPA và tín chỉ để đạt chuẩn!`, 'warning');
    }
    return;
  }
  selectAvatarFramePreview(key);
};

// Global modal handlers cho bộ sưu tập khung
window.openFramePreviewModal = function() {
  const modal = document.getElementById('modal-frame-preview');
  if (modal) {
    modal.classList.remove('hidden');
    renderFrameCollectionModal();
  }
};

window.closeFramePreviewModal = function() {
  const modal = document.getElementById('modal-frame-preview');
  if (modal) modal.classList.add('hidden');
};

window.selectAvatarFramePreview = function(tier) {
  const access = getStudentAcademicUnlockedFrames()?.[tier];
  if (tier !== 'real' && (!access || !access.unlocked)) {
    if (typeof showToast === 'function') {
      showToast('🔒 Khung này hiện là vật phẩm độc quyền và tài khoản của bạn chưa sở hữu.', 'warning');
    }
    return;
  }

  AppState.confession.framePreview = tier;
  try {
    if (tier === 'real') {
      localStorage.removeItem('bdu_custom_frame_preview');
    } else {
      localStorage.setItem('bdu_custom_frame_preview', tier);
    }
  } catch (e) {}

  updateForumUserWidgets();
  renderForumFeed();
  renderFrameCollectionModal();
  triggerFrameIntroAnimation();

  const labels = {
    'anime-gojo': '∞ Anime Signature - Vô Hạn Lục Nhãn',
    'anime-itachi': '● Anime Signature - Ảo Nguyệt Hắc Viêm',
    'truong-1': '✦ Top 1 Toàn Trường - Thiên Cực Đế Tinh BDU',
    'truong-2': '☾ Top 2 Toàn Trường - Song Nguyệt Tinh Vân BDU',
    'truong-3': '△ Top 3 Toàn Trường - Tam Tinh Xích Quang BDU',
    'truong-top': '✧ Top 4-10 Toàn Trường - Kinh Tuyến Tinh Tú BDU',
    'vien-1': '👑 Top 1 Viện - Bạch Kim Sapphire Viện Trưởng',
    'vien-top': '🥈 Top 2-10 Viện - Băng Tinh Lam Vũ Sapphire',
    'khoa-1': '🏆 Top 1 Khoa - Chiến Tướng Khiên Vàng Lục Bảo',
    'khoa-top': '💎 Top 2-10 Khoa - Cyber Knight Emerald',
    'lop-1': '🔥 Top 1 Lớp - Phượng Hoàng Hoàng Kim Lửa',
    'lop-top': '🥉 Top 2-10 Lớp - Hoàng Đồng Hổ Phách Nung',
    'real': '🎓 Tự động theo Bảng Xếp Hạng Thực Tế'
  };
  if (isThFaculty(AppState.academicRanking) || hasFullFramePreviewAccess()) {
    Object.assign(labels, {
      'khoa-1': '⌁ Top 1 Khoa TH - Quantum Compiler Crown',
      'khoa-2': 'Ⅱ Top 2 Khoa TH - Dual-Core Synapse',
      'khoa-3': 'Ⅲ Top 3 Khoa TH - Ternary Data Stack',
      'khoa-top': '⌘ Top 4-10 Khoa TH - Protocol Bracket'
    });
  }
  if (typeof showToast === 'function') {
    showToast(`Đã trang bị: ${labels[tier] || tier}`, 'success');
  }
};

const FRAME_CINEMATIC_THEMES = {
  'truong-1': {
    primary: '#22d3ee',
    secondary: '#8b5cf6',
    highlight: '#fef3c7',
    rgb: '34, 211, 238',
    rarity: 'SOVEREIGN'
  },
  'truong-2': {
    primary: '#60a5fa',
    secondary: '#6366f1',
    highlight: '#f8fafc',
    rgb: '96, 165, 250',
    rarity: 'CELESTIAL'
  },
  'truong-3': {
    primary: '#fb7185',
    secondary: '#c026d3',
    highlight: '#ffe4e6',
    rgb: '251, 113, 133',
    rarity: 'ASTRAL'
  },
  truong: {
    primary: '#22d3ee',
    secondary: '#8b5cf6',
    highlight: '#f8fafc',
    rgb: '34, 211, 238',
    rarity: 'LEGENDARY'
  },
  vien: {
    primary: '#38bdf8',
    secondary: '#6366f1',
    highlight: '#e0f2fe',
    rgb: '56, 189, 248',
    rarity: 'MYTHIC'
  },
  khoa: {
    primary: '#34d399',
    secondary: '#14b8a6',
    highlight: '#d1fae5',
    rgb: '52, 211, 153',
    rarity: 'EPIC'
  },
  'khoa-th-1': {
    primary: '#00e5ff',
    secondary: '#8b5cf6',
    highlight: '#ffd166',
    rgb: '0, 229, 255',
    rarity: 'QUANTUM PRIME'
  },
  'khoa-th-2': {
    primary: '#64d8ff',
    secondary: '#315ef5',
    highlight: '#e6eef7',
    rgb: '100, 216, 255',
    rarity: 'DUAL CORE'
  },
  'khoa-th-3': {
    primary: '#ff9f43',
    secondary: '#6d5dfb',
    highlight: '#d9e2ec',
    rgb: '255, 159, 67',
    rarity: 'TERNARY'
  },
  'khoa-th-4-10': {
    primary: '#22d3ee',
    secondary: '#475569',
    highlight: '#cbd5e1',
    rgb: '34, 211, 238',
    rarity: 'PROTOCOL'
  },
  'anime-gojo': {
    primary: '#67e8f9',
    secondary: '#8b5cf6',
    highlight: '#f0f9ff',
    rgb: '103, 232, 249',
    rarity: 'LIMITLESS'
  },
  'anime-itachi': {
    primary: '#ef4444',
    secondary: '#0a0a0f',
    highlight: '#fecaca',
    rgb: '239, 68, 68',
    rarity: 'GENJUTSU'
  },
  lop: {
    primary: '#fb923c',
    secondary: '#ef4444',
    highlight: '#ffedd5',
    rgb: '251, 146, 60',
    rarity: 'ELITE'
  }
};

const FRAME_INTRO_EFFECTS = [
  'constellation-forge', 'binary-eclipse', 'triad-supernova', 'orbit-lock', 'dragon-awaken', 'crystal-wings', 'mecha-assemble', 'phoenix-rise',
  'runner-up-dual', 'blade-cross', 'elite-pulse', 'th-quantum-compile', 'th-dual-synapse', 'th-ternary-boot', 'th-protocol-lock',
  'gojo-limitless-awaken', 'itachi-crow-genjutsu'
];

let frameIntroTimer = null;

function prepareFrameCinematic(frameInfo) {
  const heroAvatarWrap = document.getElementById('cfs-hero-avatar-wrap');
  const banner = heroAvatarWrap?.closest('.forum-hero-banner');
  const announcement = document.getElementById('frame-unlock-announcement');
  const particleField = document.getElementById('frame-particle-field');
  if (!heroAvatarWrap || !banner || !frameInfo) return;

  announcement?.classList.add('is-persistent');

  const schoolThemeKey = frameInfo.themeKey || (frameInfo.scope === 'truong' && frameInfo.rank <= 3 ? `truong-${frameInfo.rank}` : frameInfo.scope);
  const theme = FRAME_CINEMATIC_THEMES[schoolThemeKey] || FRAME_CINEMATIC_THEMES.truong;
  const effectClass = `frame-effect-${frameInfo.introEffect || 'elite-pulse'}`;
  [heroAvatarWrap, banner].forEach(element => {
    element.classList.remove(...FRAME_INTRO_EFFECTS.map(effect => `frame-effect-${effect}`));
    element.classList.add(effectClass);
  });
  [heroAvatarWrap, banner, announcement].filter(Boolean).forEach(element => {
    element.style.setProperty('--frame-primary', theme.primary);
    element.style.setProperty('--frame-secondary', theme.secondary);
    element.style.setProperty('--frame-highlight', theme.highlight);
    element.style.setProperty('--frame-rgb', theme.rgb);
  });

  const title = document.getElementById('frame-unlock-title');
  const rank = document.getElementById('frame-unlock-rank');
  const kicker = announcement?.querySelector('.frame-unlock-kicker');
  if (title) title.textContent = frameInfo.title;
  if (rank) rank.textContent = frameInfo.rankLabel || `#${frameInfo.rank} ${frameInfo.scopeUpper}`;
  const rarity = theme.rarity || (frameInfo.rank === 1 ? 'LEGENDARY' : (frameInfo.rank === 2 ? 'MYTHIC' : (frameInfo.rank === 3 ? 'EPIC' : 'ELITE')));
  if (kicker) kicker.textContent = `${rarity} • VINH DANH HỌC THUẬT`;

  if (!particleField || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const particles = document.createDocumentFragment();
  const desktopParticleCount = frameInfo.frameFamily?.startsWith('anime-')
    ? 46
    : frameInfo.frameFamily === 'khoa-th'
    ? (frameInfo.rank === 1 ? 42 : (frameInfo.rank === 2 ? 34 : (frameInfo.rank === 3 ? 28 : 18)))
    : (frameInfo.scope === 'truong'
    ? (frameInfo.rank === 1 ? 64 : (frameInfo.rank === 2 ? 50 : (frameInfo.rank === 3 ? 44 : 30)))
    : 38);
  const particleCount = window.innerWidth <= 480 ? Math.ceil(desktopParticleCount * .62) : desktopParticleCount;
  for (let index = 0; index < particleCount; index += 1) {
    const angle = (Math.PI * 2 * index / particleCount) + ((Math.random() - 0.5) * 0.34);
    const prestigeDistance = frameInfo.scope === 'truong' && frameInfo.rank <= 3 ? (4 - frameInfo.rank) * 18 : 0;
    const distance = 82 + prestigeDistance + Math.random() * 105;
    const particle = document.createElement('i');
    const particleKind = frameInfo.frameFamily === 'anime-itachi'
      ? (index % 3 === 0 ? 'shard' : 'spark')
      : (frameInfo.frameFamily === 'anime-gojo'
        ? (index % 2 === 0 ? 'star' : 'spark')
      : frameInfo.frameFamily === 'khoa-th'
      ? (index % 4 === 0 ? 'shard' : 'spark')
      : (frameInfo.introEffect === 'constellation-forge'
        ? (index % 3 === 0 ? 'star' : (index % 7 === 0 ? 'shard' : 'spark'))
        : (frameInfo.introEffect === 'triad-supernova'
          ? (index % 2 === 0 ? 'shard' : 'star')
          : (index % 5 === 0 ? 'shard' : (index % 3 === 0 ? 'star' : 'spark')))));
    particle.className = `frame-particle frame-particle-${particleKind}`;
    particle.style.setProperty('--particle-x', `${Math.cos(angle) * distance}px`);
    particle.style.setProperty('--particle-y', `${Math.sin(angle) * distance}px`);
    particle.style.setProperty('--particle-delay', `${80 + Math.random() * 300}ms`);
    particle.style.setProperty('--particle-duration', `${680 + Math.random() * 620}ms`);
    particle.style.setProperty('--particle-size', `${2 + Math.random() * 5}px`);
    particle.style.setProperty('--particle-spin', `${180 + Math.random() * 540}deg`);
    particles.appendChild(particle);
  }
  particleField.replaceChildren(particles);
}

function renderAcademicFrameMarkup(frameInfo) {
  const safeTitle = escapeHtml(frameInfo.title);
  const safeSvg = escapeHtml(frameInfo.frameSvg);
  const wingEffects = new Set(['dragon-awaken', 'crystal-wings', 'phoenix-rise']);
  const openingHalves = wingEffects.has(frameInfo.introEffect)
    ? `<img class="frame-opening-half frame-opening-left" src="${safeSvg}" alt=""><img class="frame-opening-half frame-opening-right" src="${safeSvg}" alt="">`
    : '';
  const characterMarkup = frameInfo.characterAsset
    ? `<img class="anime-frame-character is-${frameInfo.characterSide === 'right' ? 'right' : 'left'}" src="${escapeHtml(frameInfo.characterAsset)}" alt="Nhân vật chibi của khung ${safeTitle}" decoding="async">`
    : '';
  if (frameInfo.frameArt) {
    const safeArt = escapeHtml(frameInfo.frameArt);
    const awakeningMarkup = frameInfo.awakeningAsset && frameInfo.awakeningClosedAsset && frameInfo.awakeningHalfAsset
      ? `<div class="anime-awakening-stage is-${frameInfo.frameFamily === 'anime-itachi' ? 'itachi' : 'gojo'}" aria-hidden="true">
        <img class="anime-eye-state anime-eye-state-closed" src="${escapeHtml(frameInfo.awakeningClosedAsset)}" alt="">
        <img class="anime-eye-state anime-eye-state-half" src="${escapeHtml(frameInfo.awakeningHalfAsset)}" alt="">
        <img class="anime-eye-state anime-eye-state-open" src="${escapeHtml(frameInfo.awakeningAsset)}" alt="">
        <span class="anime-eye-burst"></span>
        <span class="anime-awakening-pressure"></span>
      </div>`
      : '';
    return `<div class="anime-frame-art-stack" aria-label="${safeTitle}">
      <img class="anime-frame-art anime-art-base" src="${safeArt}" alt="Khung ${safeTitle}" decoding="async">
      <img class="anime-frame-art anime-art-fragment anime-art-fragment-a" src="${safeArt}" alt="" aria-hidden="true">
      <img class="anime-frame-art anime-art-fragment anime-art-fragment-b" src="${safeArt}" alt="" aria-hidden="true">
      <img class="anime-frame-art anime-art-fragment anime-art-fragment-c" src="${safeArt}" alt="" aria-hidden="true">
    </div>${characterMarkup}${awakeningMarkup}`;
  }
  return `<img class="avatar-frame-overlay" src="${safeSvg}" alt="${safeTitle}">${openingHalves}${characterMarkup}`;
}

// Cinematic mở khóa: dựng portal, tia sáng, hạt năng lượng và title reveal kiểu game.
window.triggerFrameIntroAnimation = function() {
  const heroAvatarWrap = document.getElementById('cfs-hero-avatar-wrap');
  const banner = heroAvatarWrap?.closest('.forum-hero-banner');
  const announcement = document.getElementById('frame-unlock-announcement');
  const frameInfo = getAcademicAvatarFrame(AppState.academicRanking);
  if (!heroAvatarWrap || !banner || !frameInfo) return;

  prepareFrameCinematic(frameInfo);
  clearTimeout(frameIntroTimer);
  heroAvatarWrap.classList.remove('frame-intro-burst');
  banner.classList.remove('frame-cinematic-active');
  announcement?.classList.remove('is-revealing');
  void heroAvatarWrap.offsetWidth; // Khởi động lại toàn bộ timeline CSS khi đổi khung liên tiếp.
  heroAvatarWrap.classList.add('frame-intro-burst');
  banner.classList.add('frame-cinematic-active');
  announcement?.classList.add('is-revealing');
  frameIntroTimer = setTimeout(() => {
    heroAvatarWrap.classList.remove('frame-intro-burst');
    banner.classList.remove('frame-cinematic-active');
    announcement?.classList.remove('is-revealing');
  }, 2800);
};

function updateForumUserWidgets() {
  const user = AppState.user;
  const name = user?.name || user?.fullName || 'Sinh viên BDU';
  const mssv = user?.mssv || '';
  const initial = (name.charAt(0) || 'S').toUpperCase();
  let photoUrl = user?.photoUrl || localStorage.getItem('bdu_user_photo') || '';

  // Fallback: check if #user-avatar has an already rendered img
  if (!photoUrl) {
    const existingImg = document.querySelector('#user-avatar img');
    if (existingImg && existingImg.src) {
      photoUrl = existingImg.src;
      if (user) user.photoUrl = photoUrl;
      try { localStorage.setItem('bdu_user_photo', photoUrl); } catch(e) {}
    }
  }

  const heroAvatarWrap = document.getElementById('cfs-hero-avatar-wrap');
  const heroAvatar = document.getElementById('cfs-hero-avatar');
  const heroFrameContainer = document.getElementById('cfs-hero-frame-container');
  const heroBadge = document.getElementById('cfs-hero-badge');
  const heroName = document.getElementById('cfs-hero-username');
  const heroSub = document.getElementById('cfs-hero-sub');
  const composerAvatar = document.getElementById('cfs-composer-avatar');
  const widgetAvatar = document.getElementById('widget-user-avatar');
  const widgetName = document.getElementById('widget-user-name');
  const widgetMssv = document.getElementById('widget-user-mssv');

  if (heroName) heroName.textContent = name;
  if (widgetName) widgetName.textContent = name;
  if (widgetMssv) widgetMssv.textContent = mssv ? `MSSV: ${mssv}` : 'MSSV: --';

  // Khung Avatar Ranking Top 1 - 10
  const frameInfo = getAcademicAvatarFrame(AppState.academicRanking);

  if (heroAvatarWrap) {
    heroAvatarWrap.classList.remove(
      'has-frame-top-1', 'has-frame-top-2', 'has-frame-top-3', 'has-frame-top-4-5', 'has-frame-top-6-10',
      'has-frame-scope-truong', 'has-frame-scope-vien', 'has-frame-scope-khoa', 'has-frame-scope-lop', 'has-frame-scope-anime',
      'has-frame-khoa-th', 'has-frame-anime-gojo', 'has-frame-anime-itachi'
    );
  }

  if (frameInfo && heroFrameContainer) {
    heroFrameContainer.innerHTML = renderAcademicFrameMarkup(frameInfo);
    if (heroAvatarWrap) {
      heroAvatarWrap.classList.add(`has-frame-${frameInfo.tier}`, `has-frame-scope-${frameInfo.scope}`);
      if (frameInfo.frameFamily) heroAvatarWrap.classList.add(`has-frame-${frameInfo.frameFamily}`);
    }
    prepareFrameCinematic(frameInfo);
    if (heroBadge) {
      heroBadge.className = `avatar-hero-rank-badge tier-${frameInfo.tier}`;
      heroBadge.textContent = frameInfo.badgeText;
      heroBadge.title = frameInfo.rankLabel
        ? `${frameInfo.title} • ${frameInfo.scopeLabel}`
        : `Hạng ${frameInfo.rank}/${frameInfo.totalStudents} sinh viên ${frameInfo.scopeLabel}`;
      heroBadge.style.display = 'none';
    }
    if (heroSub) {
      heroSub.textContent = mssv ? `MSSV: ${mssv} • ${frameInfo.title} • Đại học Bình Dương` : `${frameInfo.title} • Đại học Bình Dương`;
    }
    if (heroAvatarWrap && !heroAvatarWrap.dataset.introPlayed) {
      heroAvatarWrap.dataset.introPlayed = 'true';
      setTimeout(() => {
        if (typeof window.triggerFrameIntroAnimation === 'function') {
          window.triggerFrameIntroAnimation();
        }
      }, 200);
    }
  } else {
    if (heroFrameContainer) heroFrameContainer.innerHTML = '';
    document.getElementById('frame-unlock-announcement')?.classList.remove('is-persistent', 'is-revealing');
    if (heroBadge) {
      heroBadge.className = 'avatar-hero-rank-badge tier-member';
      heroBadge.textContent = '🎓 Sinh viên BDU';
      heroBadge.removeAttribute('title');
      heroBadge.style.display = 'none';
    }
    if (heroSub) {
      heroSub.textContent = mssv ? `MSSV: ${mssv} • K24 • Đại học Bình Dương` : 'Thành viên Diễn Đàn & Tự Học Số';
    }
  }

  const avatarContent = photoUrl 
    ? `<img src="${photoUrl}" alt="${escapeHtml(name)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;">` 
    : initial;

  if (heroAvatar) heroAvatar.innerHTML = avatarContent;
  if (composerAvatar) composerAvatar.innerHTML = avatarContent;
  if (widgetAvatar) widgetAvatar.innerHTML = avatarContent;
  updateIdentityPresentationUI();

  const placeholderEl = document.getElementById('cfs-composer-placeholder-text');
  if (placeholderEl) {
    placeholderEl.textContent = (name && name !== 'Sinh viên BDU') ? `${name} ơi, bạn đang nghĩ gì thế?` : 'Bạn đang nghĩ gì? Chia sẻ ngay...';
  }

  // Proactively fetch student image from BDU API if missing
  if (!photoUrl && AppState.token && mssv) {
    const idsv = user?.idsv || user?.id_sinh_vien || '';
    BduApi.getProfile(AppState.token, idsv, mssv).then(profileRes => {
      const pUrl = profileRes?.student_image || profileRes?.data?.[0]?.hinh_anh || profileRes?.data?.hinh_anh || '';
      if (pUrl) {
        let full = pUrl;
        if (!full.startsWith('http') && !full.startsWith('data:')) {
          full = (full.startsWith('/') ? 'https://sv.bdu.edu.vn' : 'https://sv.bdu.edu.vn/') + full;
        }
        if (user) user.photoUrl = full;
        try { localStorage.setItem('bdu_user_photo', full); } catch(e) {}
        updateForumUserWidgets();
        renderForumFeed();
      }
    }).catch(() => {});
  }
}

async function loadConfessions() {
  updateForumUserWidgets();
  const container = document.getElementById('confession-feed-stream');
  if (!container) return;

  const requestId = ++AppState.confession.requestId;
  const requestedFilter = AppState.confession.activeFilter || 'all';

  container.innerHTML = `
    <div class="loading-spinner-box">
      <div class="spinner"></div>
      <p>Đang tải dòng tin Diễn Đàn & Confession...</p>
    </div>
  `;

  try {
    // `forum` gồm bài toàn trường + Viện/Khoa, nhưng không trộn bài nội bộ CLB.
    // Lọc ở server để "Bài của tôi" không bị giới hạn trong trang 20 bài mới nhất.
    const res = await BduApi.getCommunityPosts(AppState.token, {
      scope: 'forum',
      filter: requestedFilter,
      limit: 50
    });
    if (requestId !== AppState.confession.requestId || requestedFilter !== AppState.confession.activeFilter) return;
    const posts = res.posts || [];
    AppState.confession.posts = posts;
    renderForumFeed();
  } catch (err) {
    if (requestId !== AppState.confession.requestId) return;
    console.error('Lỗi tải forum confessions:', err);
    container.innerHTML = `
      <div class="empty-state-box" style="text-align: center; padding: 30px;">
        <p style="color: var(--color-rose);">${escapeHtml(err.message || 'Không thể tải Diễn Đàn.')}</p>
        <button class="btn btn-secondary btn-sm" onclick="loadConfessions()" style="margin-top: 10px;">Thử lại</button>
      </div>
    `;
  }
}

function renderForumFeed() {
  const container = document.getElementById('confession-feed-stream');
  if (!container) return;

  const currentFilter = AppState.confession.activeFilter || 'all';
  let filtered = AppState.confession.posts || [];

  // Phòng hờ dữ liệu cache cũ; nguồn dữ liệu chính đã được lọc ở server.
  if (currentFilter === 'mine') {
    filtered = filtered.filter(p => p.is_mine);
  } else if (currentFilter === 'anon') {
    filtered = filtered.filter(p => p.author?.is_anonymous);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state-box glass-panel" style="text-align: center; padding: 50px 20px;">
        <h4 style="font-weight: 800; color: var(--text-main); margin-bottom: 6px;">Chưa có bài viết nào trong mục này</h4>
        <p style="font-size: 13px; color: var(--text-muted); max-width: 480px; margin: 0 auto 16px;">
          Hãy là người đầu tiên chia sẻ cảm xúc, hỏi tài liệu ôn thi hoặc đăng tâm sự ẩn danh cùng cộng đồng sinh viên BDU nhé!
        </p>
        <button class="btn btn-primary btn-sm" onclick="openCreateConfessionModal('content')">
          Chia Sẻ Bài Viết Đầu Tiên
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(post => renderConfessionCardHtml(post)).join('');
  attachPostCardEvents(container);
}

function renderConfessionCardHtml(post) {
  const isLiked = Boolean(post.is_liked);
  const isAnon = Boolean(post.author?.is_anonymous);
  const rawAuthorName = isAnon ? 'Sinh viên giấu tên' : (post.author?.name || 'Sinh viên BDU');
  const authorName = escapeHtml(rawAuthorName);
  const avatarContent = isAnon ? '?' : renderIdentityAvatar(post.author, rawAuthorName);
  const currentMssv = AppState.user?.mssv;
  const isCurrentAuthor = Boolean(post.is_mine || (currentMssv && post.author?.mssv === currentMssv));

  // Khung & nhãn xếp hạng học thuật (thay thế hoàn toàn 14 sao)
  const frameInfo = getAcademicAvatarFrame(AppState.academicRanking);
  let rankTagHtml = '';
  if (isAnon) {
    rankTagHtml = `<span class="forum-post-rank-tag is-anon">Ẩn danh</span>`;
  } else if (Array.isArray(post.author?.titles)) {
    rankTagHtml = renderIdentityTitleBadges(post.author.titles, 'identity-title-forum');
  } else if (isCurrentAuthor && frameInfo) {
    rankTagHtml = `<span class="forum-post-rank-tag tier-${frameInfo.tier}">${frameInfo.rankLabel || `#${frameInfo.rank} ${frameInfo.scopeUpper}`}</span>`;
  } else {
    rankTagHtml = `<span class="forum-post-rank-tag tier-member">Sinh viên BDU</span>`;
  }

  let scopeLabel = 'Toàn trường';
  if (post.scope === 'faculty') scopeLabel = 'Viện / Khoa';
  else if (post.scope === 'institute') scopeLabel = 'Viện';
  else if (post.scope === 'clan') scopeLabel = 'CLB / Nhóm';

  // Attachments
  let attachmentsHtml = '';
  if (Array.isArray(post.attachments) && post.attachments.length > 0) {
    attachmentsHtml = `
      <div class="post-attachments-list">
        ${post.attachments.map(att => renderSingleAttachmentHtml(att)).join('')}
      </div>
    `;
  }

  const relativeTime = formatRelativeTime(post.created_at);

  return `
    <div class="forum-post-card glass-panel" data-post-id="${post.id}">
      <div class="forum-post-header">
        <div class="forum-user-col">
          <div class="forum-avatar ${isAnon ? 'anon' : ''}">${avatarContent}</div>
          <div class="forum-user-details">
            <div class="forum-author-name-line">
              <strong class="forum-author-name">${authorName}</strong>
              ${rankTagHtml}
            </div>
            <span class="forum-post-time">${relativeTime}</span>
          </div>
        </div>
        <div class="forum-post-header-actions">
          <span class="forum-post-scope-pill">${scopeLabel}</span>
          ${post.is_mine ? `
            <button type="button" class="btn-delete-post" data-post-id="${post.id}" title="Xóa bài viết" aria-label="Xóa bài viết">
              <span>Xóa</span>
            </button>
          ` : ''}
        </div>
      </div>

      <h4 class="forum-post-title">${escapeHtml(post.title)}</h4>
      <div class="forum-post-body">${escapeHtml(post.content)}</div>

      ${attachmentsHtml}

      <!-- Bottom action row styled matching screenshots 1 & 2 -->
      <div class="forum-post-bottom-bar">
        <div class="forum-actions-left">
          <button class="forum-action-btn btn-toggle-like ${isLiked ? 'liked' : ''}" data-id="${post.id}">
            <span>${isLiked ? 'Đã thích' : 'Thích'}</span>
          </button>

          <button class="forum-action-btn btn-toggle-comments" data-id="${post.id}">
            <span>Bình luận</span>
          </button>
        </div>

        <div class="forum-counts-right">
          <span class="like-count-num">${post.like_count || 0}</span> lượt thích • <span class="comment-count-num">${post.comment_count || 0}</span> bình luận
        </div>
      </div>

      <!-- Expandable Comments Thread (matching screenshot 3) -->
      <div class="forum-comments-wrapper hidden" id="comments-section-${post.id}">
        <h5 class="comments-header-title">
          Tất cả bình luận (<span class="comments-count-inline">${post.comment_count || 0}</span>)
        </h5>

        <div class="comment-composer-inline">
          <input type="text" class="form-input comment-text-input" maxlength="2000" placeholder="Viết bình luận cho bài đăng này..." data-post-id="${post.id}">
          <button class="btn btn-primary btn-sm btn-submit-comment" data-post-id="${post.id}">Gửi</button>
        </div>

        <div class="comments-feed-list" id="comments-list-${post.id}"></div>
      </div>
    </div>
  `;
}

async function handleSubmitConfession() {
  if (!AppState.token) {
    showToast('Vui lòng đăng nhập để gửi bài.', 'warning');
    return;
  }

  const rawTitle = document.getElementById('cfs-post-title')?.value?.trim();
  const content = document.getElementById('cfs-post-content')?.value?.trim();
  const scope = document.getElementById('cfs-post-scope')?.value || 'school';
  const driveUrl = document.getElementById('cfs-post-drive-url')?.value?.trim();
  const driveTitle = document.getElementById('cfs-post-drive-title')?.value?.trim();
  const isAnonymous = Boolean(document.getElementById('cfs-post-anon')?.checked);

  if (!content) {
    showToast('Vui lòng nhập nội dung bài viết trước khi đăng.', 'warning');
    document.getElementById('cfs-post-content')?.focus();
    return;
  }

  // Tự động trích xuất tiêu đề nếu người dùng không nhập (tương tự Facebook)
  const firstLine = content.split('\n')[0].trim();
  const title = rawTitle || (firstLine.length > 50 ? firstLine.substring(0, 50) + '...' : firstLine) || 'Tâm sự BDU';

  const attachments = [];
  if (driveUrl) {
    attachments.push({
      url: driveUrl,
      title: driveTitle || 'Tài liệu / Video đính kèm'
    });
  }

  const submitBtn = document.getElementById('btn-submit-cfs');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <div class="spinner" style="width: 14px; height: 14px; border-width: 2px;"></div>
      <span>Đang đăng...</span>
    `;
  }

  try {
    await BduApi.createCommunityPost(AppState.token, {
      title,
      content,
      scope,
      isAnonymous,
      attachments
    });

    showToast('Đăng bài lên Diễn Đàn thành công!', 'success');

    // Reset fields & đóng modal Facebook
    if (document.getElementById('cfs-post-title')) document.getElementById('cfs-post-title').value = '';
    if (document.getElementById('cfs-post-content')) document.getElementById('cfs-post-content').value = '';
    if (document.getElementById('cfs-post-drive-url')) document.getElementById('cfs-post-drive-url').value = '';
    if (document.getElementById('cfs-post-drive-title')) document.getElementById('cfs-post-drive-title').value = '';
    
    closeCreateConfessionModal();

    await loadConfessions();
  } catch (err) {
    showToast(err.message || 'Không thể đăng bài.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Đăng';
    }
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
