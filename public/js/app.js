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
  bduSchoolPhoto: null,
  titleSelectionDraft: [],
  leaderboard: {
    scope: 'school',
    metric: 'gpa',
    loaded: false,
    loading: false,
    reloadRequested: false,
    controller: null
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
  communityRealtime: null,
  communityRealtimeReconnectTimer: null,
  communityRealtimeReconnectAttempt: 0,
  communityRealtimeEvents: new Set(),
  communityRealtimeDirty: new Set(),
  scheduleController: null,
  learningController: null,
  dashboardController: null,
  englishActivities: [],
  learning: {
    courses: [],
    activeCourse: null,
    posts: [],
    lastTrigger: null,
    lastComposerTrigger: null
  },
  // Community features are lazy-loaded, but core dashboard hydration can
  // receive identity data before that module is initialized. Keep the small
  // shared state shape available so a delayed feature cannot break boot.
  confession: {
    posts: [],
    activeScope: 'school',
    activeCategory: 'all',
    activeFilter: 'all',
    requestId: 0,
    loadingPromise: null,
    loadingFilter: null,
    controller: null,
    loadedFilter: null,
    total: 0,
    loadingMore: false,
    refreshTimer: null,
    profilePhotoRequest: null,
    profilePhotoRequestedFor: null,
    framePreview: null
  },
  scheduleLoaded: false,
  learningLoaded: false,
  initializedFeatures: new Set()
};

// ============================================================================
// INITIALIZATION
// ============================================================================
const featureModules = {
  'tab-wordfmt': './features/automation.js?v=20260905-perf-v22',
  'tab-survey': './features/automation.js?v=20260905-perf-v22',
  'tab-english': './features/automation.js?v=20260905-perf-v22',
  'tab-learning': './features/learning.js?v=20260905-perf-v22',
  'tab-clans': './features/community.js?v=20260905-perf-v22',
  'tab-confession': './features/community.js?v=20260905-perf-v22'
};
const featureModulePromises = new Map();
const featureInitPromises = new Map();

async function ensureFeatureInitialized(tabId) {
  if (AppState.initializedFeatures.has(tabId)) return true;
  if (featureInitPromises.has(tabId)) return featureInitPromises.get(tabId);
  const moduleUrl = featureModules[tabId];
  if (!moduleUrl) return true;
  const initPromise = (async () => {
    if (!featureModulePromises.has(moduleUrl)) {
      featureModulePromises.set(moduleUrl, import(moduleUrl));
    }
    try {
      const featureModule = await featureModulePromises.get(moduleUrl);
      const initialized = featureModule.initialize(tabId);
      if (initialized) AppState.initializedFeatures.add(tabId);
      return Boolean(initialized);
    } catch (error) {
      featureModulePromises.delete(moduleUrl);
      console.error(`Không thể khởi tạo mục ${tabId}:`, error);
      showToast('Không thể khởi tạo mục này. Vui lòng thử lại.', 'error');
      return false;
    } finally {
      featureInitPromises.delete(tabId);
    }
  })();
  featureInitPromises.set(tabId, initPromise);
  return initPromise;
}

function bootApplication() {
  if (window.__BDU_APP_BOOTED) return;
  window.__BDU_APP_BOOTED = true;
  initTheme();
  initAuth();
  initLoginCharacters();
  initNavigation();
  initGradeFilters();
  initScheduleTab();
  initModals();
  initTitleCustomizer();
  initIdentityAdmin();
}

window.BDUAppBoot = bootApplication;
if (!document.readyState || document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootApplication, { once: true });
else bootApplication();

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

  const motionBtn = document.getElementById('btn-motion-toggle');
  const syncMotionButton = () => {
    if (!motionBtn) return;
    const mode = window.BDUMotion?.mode || 'balanced';
    const effectiveMode = window.BDUMotion?.effectiveMode || mode;
    motionBtn.dataset.motionMode = mode;
    motionBtn.setAttribute('aria-pressed', String(effectiveMode === 'reduced'));
    motionBtn.title = mode === 'full' ? 'Hiệu ứng đầy đủ (bấm để chuyển sang giảm)' : mode === 'reduced' ? 'Giảm hiệu ứng (bấm để chuyển sang cân bằng)' : 'Hiệu ứng cân bằng (bấm để chuyển sang đầy đủ)';
    motionBtn.textContent = mode === 'full' ? '✦' : mode === 'reduced' ? '◉' : '◌';
  };
  motionBtn?.addEventListener('click', () => {
    const mode = window.BDUMotion?.mode || 'balanced';
    const next = mode === 'balanced' ? 'full' : mode === 'full' ? 'reduced' : 'balanced';
    window.BDUMotion?.setMode(next);
    syncMotionButton();
  });
  window.addEventListener('bdu:motionchange', syncMotionButton);
  syncMotionButton();
}

let chartJsPromise = null;
function ensureChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (chartJsPromise) return chartJsPromise;
  chartJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
    script.async = true;
    script.onload = () => window.Chart ? resolve(window.Chart) : reject(new Error('Chart.js không khả dụng.'));
    script.onerror = () => reject(new Error('Không thể tải thư viện biểu đồ.'));
    document.head.appendChild(script);
  });
  return chartJsPromise;
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
  const allowedTones = new Set(['member', 'gold', 'silver', 'bronze', 'blue', 'emerald', 'violet', 'youth', 'chatgpt', 'charm', 'ai']);
  const allowedRarities = new Set(['rare', 'epic', 'legendary', 'vip', 'youth', 'ai', 'charm']);
  return `
    <span class="identity-title-badges ${escapeHtml(extraClass)}">
      ${titles.slice(0, 4).map((title) => {
        const tone = allowedTones.has(title?.tone) ? title.tone : 'member';
        const rarity = allowedRarities.has(title?.rarity) ? ` rarity-${title.rarity}` : '';
        const rawKey = String(title?.asset_key || title?.id || '').replace(/^(title|achievement):/, '').trim().toLowerCase();
        const safeKey = rawKey.replace(/[^a-z0-9_-]/g, '-');
        const customClass = safeKey ? ` title-${safeKey}` : '';
        const isChatgpt = safeKey === 'chatgpt' || String(title?.label || '').toUpperCase().includes('CHATGPT');
        const isYouth = safeKey === 'pho-bi-thu-doan' || String(title?.label || '').includes('Phó bí thư đoàn');
        const isTop1 = safeKey === 'khong-doi-thu' || String(title?.label || '').includes('Không đối thủ');
        const isNamVuong = safeKey === 'nam-vuong' || String(title?.label || '').includes('Nam vương');
        const isHocTai = safeKey === 'hoc-tai-thi-phan' || String(title?.label || '').includes('Học tài thi phận');
        const isHocThan = safeKey === 'hoc-than' || String(title?.label || '').includes('Học thần');
        const isTinhHoa = safeKey === 'tinh-hoa-bdu' || String(title?.label || '').includes('Tinh hoa BDU');
        const isBatBai = safeKey === 'bat-bai-mon-phai' || String(title?.label || '').includes('Bất bại môn phái');
        const isConNhaNguoiTa = safeKey === 'con-nha-nguoi-ta' || String(title?.label || '').includes('Con nhà người ta');
        const isThoSan = safeKey === 'tho-san-tin-chi' || String(title?.label || '').includes('Thợ săn tín chỉ');
        const isCuDem = safeKey === 'cu-dem-luyen-thi' || String(title?.label || '').includes('Cú đêm luyện thi');
        const isTayTo = safeKey === 'tay-to-ganh-team' || String(title?.label || '').includes('Tay to gánh team');
        const iconPrefix = isChatgpt
          ? `<svg class="identity-title-icon-chatgpt" viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1683a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4947zm-9.66-4.1354a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1402-1.6564zm-1.6712-9.4042a4.485 4.485 0 0 1 2.3418-1.9729v.1656l.0047 5.5164a.7806.7806 0 0 0 .388.686l5.8144 3.3543-2.02 1.1683a.0757.0757 0 0 1-.071 0l-4.8303-2.7866a4.4992 4.4992 0 0 1-1.6276-6.131zm16.5708 3.0657l-5.8144-3.3543 2.02-1.1683a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4304-.7007zm2.0152-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L8.6888 8.9882V6.6558a.0852.0852 0 0 1 .0332-.0615L13.7196 3.799a4.504 4.504 0 0 1 6.1876 2.4045v.0047zm-10.2312 4.1638l2.3994-1.3867 2.3994 1.3867v2.7735l-2.3994 1.3867-2.3994-1.3867z"/></svg>`
          : isYouth
            ? `<span class="identity-title-icon-youth" aria-hidden="true">★</span>`
            : isTop1
              ? `<span class="identity-title-icon-top1" aria-hidden="true">⚔️</span>`
              : isNamVuong
                ? `<span class="identity-title-icon-namvuong" aria-hidden="true">👑</span>`
                : isHocTai
                  ? `<span class="identity-title-icon-hoctai" aria-hidden="true">🍂</span>`
                  : isHocThan
                    ? `<span class="identity-title-icon-hocthan" aria-hidden="true">⚡</span>`
                    : isTinhHoa
                      ? `<span class="identity-title-icon-tinhhoa" aria-hidden="true">🎓</span>`
                      : isBatBai
                        ? `<span class="identity-title-icon-batbai" aria-hidden="true">🛡️</span>`
                        : isConNhaNguoiTa
                          ? `<span class="identity-title-icon-connha" aria-hidden="true">✨</span>`
                          : isThoSan
                            ? `<span class="identity-title-icon-thosan" aria-hidden="true">🎯</span>`
                            : isCuDem
                              ? `<span class="identity-title-icon-cudem" aria-hidden="true">🦉</span>`
                              : isTayTo
                                ? `<span class="identity-title-icon-tayto" aria-hidden="true">💪</span>`
                                : '';
        return `<span class="identity-title-badge tone-${tone}${rarity}${customClass}" data-title-id="${escapeHtml(title?.id || '')}" title="${escapeHtml(title?.detail || title?.label || '')}">${iconPrefix}${escapeHtml(title?.label || '')}</span>`;
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
  const maxTitles = Number(AppState.identityPresentation?.max_titles || 4);
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
  const maxTitles = Number(AppState.identityPresentation?.max_titles || 4);
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

async function initIdentityAdmin() {
  const panel = document.getElementById('identity-admin-panel');
  if (!panel || !AppState.token || panel.dataset.initialized === 'true') return;
  const status = document.getElementById('identity-admin-status');
  try {
    const items = await BduApi.getAdminIdentityItems(AppState.token);
    panel.dataset.initialized = 'true';
    panel.classList.remove('hidden');
    if (status) status.textContent = 'Quyền truy cập hợp lệ';
    const select = document.getElementById('identity-admin-item');
    if (select) {
      select.innerHTML = items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)} · ${escapeHtml(item.item_type)}</option>`).join('');
    }
    const mssvInput = document.getElementById('identity-admin-mssv');
    const grantsEl = document.getElementById('identity-admin-grants');
    const loadGrants = async () => {
      const mssv = mssvInput?.value?.trim();
      if (!mssv || !grantsEl) return;
      try {
        const grants = await BduApi.getAdminIdentityGrants(AppState.token, mssv);
        grantsEl.innerHTML = grants.length ? grants.map((grant) => `
          <div class="identity-admin-grant-row">
            <span>${escapeHtml(grant.label || grant.item_id)}${grant.revoked_at ? ' · đã thu hồi' : ''}</span>
            ${grant.revoked_at ? '' : `<button type="button" data-identity-revoke="${grant.id}">Thu hồi</button>`}
          </div>`).join('') : '<span class="identity-admin-status">Chưa có grant.</span>';
        grantsEl.querySelectorAll('[data-identity-revoke]').forEach((button) => {
          button.addEventListener('click', async () => {
            const reason = window.prompt('Lý do thu hồi quyền:', 'Điều chỉnh quyền hiển thị') || '';
            try {
              await BduApi.revokeAdminIdentityGrant(AppState.token, button.dataset.identityRevoke, reason);
              await loadGrants();
              showToast('Đã thu hồi quyền hiển thị.', 'success');
            } catch (error) {
              showToast(error.message || 'Không thể thu hồi quyền.', 'error');
            }
          });
        });
      } catch (error) {
        grantsEl.textContent = error.message || 'Không thể tải grant.';
      }
    };
    mssvInput?.addEventListener('change', loadGrants);
    document.getElementById('identity-admin-grant')?.addEventListener('click', async () => {
      const mssv = mssvInput?.value?.trim();
      const itemId = select?.value;
      if (!mssv || !itemId) {
        showToast('Nhập MSSV và chọn item cần cấp.', 'warning');
        return;
      }
      try {
        await BduApi.createAdminIdentityGrant(AppState.token, {
          mssv,
          itemId,
          reason: document.getElementById('identity-admin-reason')?.value?.trim()
        });
        await loadGrants();
        showToast('Đã cấp quyền hiển thị.', 'success');
      } catch (error) {
        showToast(error.message || 'Không thể cấp quyền.', 'error');
      }
    });
  } catch (error) {
    // Non-admin users should not see an empty or broken admin panel.
    panel.classList.add('hidden');
    if (error?.status !== 403) console.info('Identity admin unavailable:', error.message);
  }
}

function updateIdentityPresentationUI() {
  const presentation = AppState.identityPresentation;
  if (!presentation) return;
  applyResolvedAvatarToCurrentUser(presentation);
  const badges = renderIdentityTitleBadges(presentation.selected_titles || []);
  const heroTitles = document.getElementById('cfs-hero-titles');
  const widgetTitles = document.getElementById('widget-user-titles');
  if (heroTitles) heroTitles.innerHTML = badges;
  if (widgetTitles) widgetTitles.innerHTML = badges || '<span class="identity-title-empty">Chưa hiển thị danh hiệu</span>';
}

function getResolvedAvatarUrl(presentation = AppState.identityPresentation) {
  const isOverride = presentation?.avatar_source === 'override' && Boolean(presentation?.avatar_url);
  if (isOverride) {
    return {
      url: presentation.avatar_url,
      source: 'override'
    };
  }

  // Priority 2: presentation BDU avatar URL if present
  if (presentation?.avatar_url) {
    return {
      url: presentation.avatar_url,
      source: presentation.avatar_source || 'bdu'
    };
  }

  // Priority 3: BDU school photo from live API
  if (AppState.bduSchoolPhoto) {
    return {
      url: AppState.bduSchoolPhoto,
      source: 'bdu-api-live'
    };
  }

  // Priority 4: existing profile photo on student card
  const existingCardPhoto = document.getElementById('profile-student-photo')?.src;
  if (existingCardPhoto && !existingCardPhoto.endsWith('/') && !existingCardPhoto.includes('undefined')) {
    return {
      url: existingCardPhoto,
      source: 'bdu-api-live'
    };
  }

  // Priority 5: User state photo or localStorage
  const currentPhoto = AppState.user?.photoUrl || localStorage.getItem('bdu_user_photo') || '';
  if (currentPhoto) {
    return {
      url: currentPhoto,
      source: AppState.user?.avatarSource || 'bdu'
    };
  }

  return {
    url: '',
    source: 'initials'
  };
}

function syncAllCurrentUserAvatars(presentation = AppState.identityPresentation) {
  if (presentation) {
    AppState.identityPresentation = presentation;
  }
  const resolved = getResolvedAvatarUrl(presentation);
  const url = resolved.url;
  const isOverride = resolved.source === 'override';
  const name = presentation?.name || AppState.user?.name || AppState.user?.fullName || 'Sinh viên BDU';
  const initials = getInitials(name);

  if (AppState.user && url) {
    AppState.user.photoUrl = url;
    AppState.user.avatarSource = isOverride ? 'override' : (resolved.source || 'bdu');
  }

  try {
    if (url) localStorage.setItem('bdu_user_photo', url);
  } catch (e) {}

  const markup = url
    ? `<img src="${escapeHtml(url)}" alt="Ảnh của ${escapeHtml(name)}" loading="lazy" decoding="async" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;">`
    : escapeHtml(initials);

  // Sync all circle avatar containers across all tabs:
  // 1. Sidebar bottom left user avatar
  // 2. Tab 01 (Bảng Điểm & GPA) hero avatar
  // 3. Tab 10 (CLB) quick composer avatar & modal author avatar
  // 4. Tab 11 (Confession) hero avatar, composer avatar, right widget avatar
  const avatarIds = [
    'user-avatar',
    'hero-avatar',
    'cfs-hero-avatar',
    'cfs-composer-avatar',
    'widget-user-avatar',
    'clan-quick-composer-avatar',
    'clan-modal-author-avatar'
  ];
  avatarIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = markup;
  });

  // Confession modal avatar (if non-anon)
  const cfsModalAvatar = document.getElementById('fb-modal-avatar');
  const anonCheckbox = document.getElementById('cfs-post-anon');
  const isAnon = anonCheckbox ? Boolean(anonCheckbox.checked) : true;
  if (cfsModalAvatar && !isAnon) {
    cfsModalAvatar.innerHTML = markup;
  }

  // Tab 02: Lý Lịch Sinh Viên (student ID card photo & initials fallback)
  const profilePhoto = document.getElementById('profile-student-photo');
  const profileFallback = document.getElementById('card-avatar');
  if (profilePhoto) {
    if (url) {
      if (profilePhoto.src !== url) {
        profilePhoto.src = url;
      }
      profilePhoto.classList.remove('hidden');
      profileFallback?.classList.add('hidden');
    } else if (!profilePhoto.src || profilePhoto.classList.contains('hidden')) {
      profilePhoto.classList.add('hidden');
      if (profileFallback) {
        profileFallback.classList.remove('hidden');
        profileFallback.textContent = initials;
      }
    }
  }

  // Chỉ đồng bộ các avatar cố định. Không render lại feed ở đây: hàm này được
  // gọi từ onload của ảnh và nhiều luồng tải hồ sơ, nên việc dựng lại toàn bộ
  // danh sách bài có thể làm mất node đang được click.
}

function applyResolvedAvatarToCurrentUser(presentation) {
  syncAllCurrentUserAvatars(presentation);
}

function applyCurrentUserPresentationToFeeds() {
  const presentation = AppState.identityPresentation;
  const mssv = AppState.user?.mssv;
  if (!presentation || !mssv) return;
  [AppState.learning.posts, AppState.confession?.posts, AppState.clans?.posts].forEach((posts) => {
    (posts || []).forEach((post) => {
      if (post.author?.mssv === mssv) {
        post.author.photo_url = presentation.avatar_url || AppState.user?.photoUrl || post.author.photo_url;
        post.author.avatar_source = presentation.avatar_source || AppState.user?.avatarSource || post.author.avatar_source;
        post.author.titles = presentation.selected_titles || [];
        post.author.equipped_frame_id = presentation.equipped_frame_id || null;
      }
    });
  });
  if (AppState.learning.activeCourse && typeof window.renderLearningCoursePosts === 'function') window.renderLearningCoursePosts();
  if (document.getElementById('tab-confession')?.classList.contains('active') && typeof window.renderForumFeed === 'function') window.renderForumFeed();
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
          roles: res.roles,
          idsv: res.idsv || ''
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
        connectCommunityRealtime();
        initIdentityAdmin();
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
      if (document.getElementById('tab-schedule')?.classList.contains('active')) await loadScheduleData(true);
      if (document.getElementById('tab-learning')?.classList.contains('active')) await loadLearningData(true);
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
        if (!AppState.user.photoUrl) {
          const cachedPhoto = localStorage.getItem('bdu_user_photo');
          if (cachedPhoto) {
            AppState.user.photoUrl = cachedPhoto;
            AppState.user.avatarSource = 'bdu-api-live';
          }
        }
        switchToDashboard();
        connectCommunityRealtime();
        initIdentityAdmin();
        loadAllDashboardData();
      } catch (e) {
        handleLogout({ reason: 'Dữ liệu phiên không hợp lệ. Vui lòng đăng nhập lại.', isExpired: true });
      }
    }
  }

  // Định kỳ kiểm tra hết hạn token (mỗi 30 giây và khi quay lại tab)
  setInterval(checkTokenExpiration, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      checkTokenExpiration();
      flushCommunityRealtime();
    }
  });
}

/**
 * Xử lý đăng xuất / kết thúc phiên làm việc
 */
function handleLogout(options = {}) {
  const { reason = 'Đã đăng xuất tài khoản.', isExpired = false } = options;
  void window.BDUViewLifecycle?.deactivate();
  if (AppState.englishSessionId) {
    BduApi.closeEnglishSession(AppState.englishSessionId).catch(() => { });
  }
  AppState.englishEventSource?.close();
  AppState.eventSource?.close();
  AppState.communityRealtime?.close();
  clearTimeout(AppState.communityRealtimeReconnectTimer);
  AppState.scheduleController?.abort();
  AppState.learningController?.abort();
  AppState.dashboardController?.abort();
  AppState.leaderboard.controller?.abort();
  AppState.confession?.controller?.abort();
  AppState.scheduleController = null;
  AppState.learningController = null;
  AppState.dashboardController = null;
  AppState.communityRealtime = null;
  AppState.communityRealtimeReconnectTimer = null;
  AppState.communityRealtimeReconnectAttempt = 0;
  AppState.communityRealtimeEvents.clear();
  AppState.communityRealtimeDirty.clear();
  window.BDUResourceLoader?.clear();
  if (AppState.confession) {
    clearTimeout(AppState.confession.refreshTimer);
    AppState.confession.refreshTimer = null;
    AppState.confession.loadingPromise = null;
    AppState.confession.loadingFilter = null;
    AppState.confession.controller = null;
    AppState.confession.loadedFilter = null;
    AppState.confession.total = 0;
    AppState.confession.loadingMore = false;
    AppState.confession.profilePhotoRequest = null;
    AppState.confession.profilePhotoRequestedFor = null;
    AppState.confession.posts = [];
    AppState.confession.activeScope = 'school';
    AppState.confession.activeCategory = 'all';
    AppState.confession.activeFilter = 'all';
    AppState.confession.requestId = 0;
  }
  if (AppState.clans) {
    AppState.clans.list = [];
    AppState.clans.canCreate = false;
    AppState.clans.currentClan = null;
    AppState.clans.posts = [];
    AppState.clans.documents = [];
    AppState.clans.activeFilter = 'all';
    AppState.clans.feedFilter = 'all';
    AppState.clans.docFilter = 'all';
    AppState.clans.docSearch = '';
  }
  document.getElementById('identity-admin-panel')?.classList.add('hidden');
  delete document.getElementById('identity-admin-panel')?.dataset.initialized;
  localStorage.removeItem('bdu_token');
  localStorage.removeItem('bdu_user');
  localStorage.removeItem('bdu_token_expires_at');
  sessionStorage.removeItem('bdu_token');
  sessionStorage.removeItem('bdu_user');
  sessionStorage.removeItem('bdu_token_expires_at');

  AppState.user = null;
  AppState.token = null;
  AppState.semesters = [];
  AppState.scheduleLoaded = false;
  AppState.learningLoaded = false;
  AppState.rawGradeData = null;
  AppState.academicRanking = null;
  AppState.identityPresentation = null;
  if (AppState.confession) AppState.confession.framePreview = 'real';
  try { localStorage.removeItem('bdu_custom_frame_preview'); } catch (e) {}
  AppState.leaderboard.loaded = false;
  AppState.leaderboard.controller = null;
  AppState.leaderboard.reloadRequested = false;
  AppState.englishSessionId = null;
  AppState.englishEventSource = null;
  AppState.englishActivities = [];
  AppState.eventSource = null;
  AppState.learning.courses = [];
  AppState.learning.activeCourse = null;
  AppState.learning.posts = [];

  const dashView = document.getElementById('dashboard-view');
  const loginView = document.getElementById('login-view');
  window.BDUClientStyles?.resetLogin();
  if (dashView) dashView.classList.add('hidden');
  if (loginView) loginView.classList.remove('hidden');

  if (isExpired) {
    showToast(reason || 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.', 'warning');
  } else {
    showToast(reason, 'info');
  }
}

function connectCommunityRealtime() {
  if (!AppState.token || typeof WebSocket === 'undefined') return;
  AppState.communityRealtime?.close();
  clearTimeout(AppState.communityRealtimeReconnectTimer);
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws/community`);
  AppState.communityRealtime = socket;
  socket.addEventListener('open', () => {
    AppState.communityRealtimeReconnectAttempt = 0;
    socket.send(JSON.stringify({ type: 'auth', token: AppState.token }));
  });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    handleCommunityRealtimeMessage(message);
  });
  socket.addEventListener('close', () => {
    if (socket !== AppState.communityRealtime || !AppState.token) return;
    const attempt = Math.min(6, AppState.communityRealtimeReconnectAttempt + 1);
    AppState.communityRealtimeReconnectAttempt = attempt;
    AppState.communityRealtimeReconnectTimer = setTimeout(connectCommunityRealtime, Math.min(30_000, 1000 * (2 ** attempt)));
  });
  socket.addEventListener('error', () => {});
}

function communityRealtimeSubscribe(room) {
  const socket = AppState.communityRealtime;
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'subscribe', room }));
}

function handleCommunityRealtimeMessage(message) {
  if (!message || message.type === 'hello' || message.type === 'auth.ok' || message.type === 'subscribed' || message.type === 'pong') return;
  if (message.eventId) {
    if (AppState.communityRealtimeEvents.has(message.eventId)) return;
    AppState.communityRealtimeEvents.add(message.eventId);
    if (AppState.communityRealtimeEvents.size > 500) {
      AppState.communityRealtimeEvents = new Set([...AppState.communityRealtimeEvents].slice(-250));
    }
  }
  const data = message.data || {};
  if (document.hidden) {
    AppState.communityRealtimeDirty.add(`${message.type}:${data.postId || data.scopeId || data.mssv || ''}`);
    return;
  }
  if (message.type === 'community.post.created' || message.type === 'community.post.deleted') {
    if (data.scope === 'clan') {
      if (AppState.clans?.currentClan && String(AppState.clans.currentClan.id) === String(data.scopeId)) {
        if (typeof window.loadClanPosts === 'function') window.loadClanPosts(data.scopeId).catch(() => {});
      }
    } else {
      if (typeof window.scheduleConfessionRefresh === 'function') window.scheduleConfessionRefresh();
    }
    return;
  }
  if (message.type === 'community.comment.created' || message.type === 'community.comment.updated' || message.type === 'community.comment.deleted') {
    const section = document.getElementById(`comments-section-${data.postId}`);
    if (section && !section.classList.contains('hidden') && typeof window.loadCommentsForPost === 'function') window.loadCommentsForPost(data.postId).catch(() => {});
    if (data.commentCount !== null && data.commentCount !== undefined) {
      document.querySelectorAll('[data-post-id]').forEach((card) => {
        if (String(card.dataset.postId) !== String(data.postId)) return;
        card.querySelectorAll('.comment-count-num, .comments-count-inline').forEach((el) => {
          el.textContent = Number(data.commentCount);
        });
      });
    }
    return;
  }
  if (message.type === 'community.reaction.updated') {
    document.querySelectorAll('[data-post-id]').forEach((card) => {
      if (String(card.dataset.postId) !== String(data.postId)) return;
      card.querySelectorAll('.like-count-num').forEach((el) => {
        el.textContent = Number(data.likeCount || 0);
      });
    });
    return;
  }
  if (message.type === 'identity.presentation.changed') {
    const avatarUrl = data.avatarUrl || null;
    const openCommentPostIds = [...document.querySelectorAll('[id^="comments-section-"]:not(.hidden)')]
      .map((section) => section.id.replace('comments-section-', ''))
      .filter(Boolean);
    [AppState.learning.posts, AppState.confession?.posts, AppState.clans?.posts].forEach((posts) => {
      (posts || []).forEach((post) => {
        if (post.author?.mssv === data.mssv && !post.author?.is_anonymous) {
          post.author.photo_url = avatarUrl;
          post.author.avatar_source = data.avatarSource || 'initials';
        }
      });
    });
    if (AppState.learning.activeCourse && typeof window.renderLearningCoursePosts === 'function') window.renderLearningCoursePosts();
    if (document.getElementById('tab-confession')?.classList.contains('active') && typeof window.renderForumFeed === 'function') window.renderForumFeed();
    if (AppState.clans?.currentClan && typeof window.loadClanPosts === 'function') window.loadClanPosts(AppState.clans.currentClan.id).catch(() => {});
    openCommentPostIds.forEach((postId) => {
      const section = document.getElementById(`comments-section-${postId}`);
      section?.classList.remove('hidden');
      if (typeof window.loadCommentsForPost === 'function') window.loadCommentsForPost(postId).catch(() => {});
    });
    if (AppState.user?.mssv === data.mssv) {
      BduApi.getMyIdentityPresentation(AppState.token).then((presentation) => {
        AppState.identityPresentation = presentation;
        updateIdentityPresentationUI();
      }).catch(() => {});
    }
    return;
  }
  if (message.type === 'identity.entitlements.changed' && AppState.user?.mssv === data.mssv) {
    BduApi.getMyIdentityPresentation(AppState.token)
      .then((presentation) => {
      AppState.identityPresentation = presentation;
      if (AppState.confession) AppState.confession.framePreview = presentation.equipped_frame_id
          ? String(presentation.equipped_frame_id).replace(/^frame:/, '')
          : 'real';
        updateIdentityPresentationUI();
        applyCurrentUserPresentationToFeeds();
      })
      .catch(() => {});
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
  void window.BDUClientStyles?.ensureDashboard().catch((error) => {
    console.warn('Không thể tải dashboard stylesheet:', error.message);
  });
  document.getElementById('login-view').classList.add('hidden');
  document.getElementById('dashboard-view').classList.remove('hidden');
  window.dispatchEvent(new CustomEvent('bdu:dashboard-ready'));

  const name = AppState.user?.name || 'Sinh viên BDU';
  const mssv = AppState.user?.mssv || 'MSSV';
  const avatarInitials = getInitials(name);

  const navName = document.getElementById('nav-user-name');
  const navMssv = document.getElementById('nav-user-mssv');
  const navAvatar = document.getElementById('user-avatar');
  if (navName) navName.textContent = name;
  if (navMssv) navMssv.textContent = `MSSV: ${mssv}`;

  const cachedPhoto = AppState.user?.photoUrl || localStorage.getItem('bdu_user_photo') || '';
  const avatarMarkup = cachedPhoto
    ? `<img src="${escapeHtml(cachedPhoto)}" loading="lazy" decoding="async" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`
    : avatarInitials;

  if (navAvatar) navAvatar.innerHTML = avatarMarkup;

  const heroAvatar = document.getElementById('hero-avatar');
  const heroName = document.getElementById('hero-name');
  const heroMssv = document.getElementById('hero-mssv');
  const heroEmail = document.getElementById('hero-email');
  if (heroAvatar) heroAvatar.innerHTML = avatarMarkup;
  if (heroName) heroName.textContent = name;
  if (heroMssv) heroMssv.textContent = mssv;
  if (heroEmail) heroEmail.textContent = AppState.user?.email || `${mssv}@student.bdu.edu.vn`;

  syncAllCurrentUserAvatars();
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

  const viewLifecycle = window.BDUViewLifecycle;
  viewLifecycle?.register('tab-schedule', {
    activate: () => loadScheduleData(),
    deactivate: () => AppState.scheduleController?.abort()
  });
  viewLifecycle?.register('tab-learning', {
    activate: async () => { if (await ensureFeatureInitialized('tab-learning')) return loadLearningData(); },
    deactivate: () => AppState.learningController?.abort()
  });
  viewLifecycle?.register('tab-confession', {
    activate: async () => { if (await ensureFeatureInitialized('tab-confession') && typeof window.loadConfessions === 'function') return window.loadConfessions(); },
    deactivate: () => AppState.confession?.controller?.abort()
  });
  viewLifecycle?.register('tab-leaderboard', {
    activate: async () => {
      if (AppState.leaderboard.loaded) return;
      return loadAcademicLeaderboard();
    }
  });
  for (const tabId of ['tab-wordfmt', 'tab-survey', 'tab-english']) {
    viewLifecycle?.register(tabId, { activate: () => ensureFeatureInitialized(tabId) });
  }
  viewLifecycle?.register('tab-clans', {
    activate: async () => {
      if (!(await ensureFeatureInitialized('tab-clans'))) return;
      if (typeof window.loadClansDirectory === 'function') return window.loadClansDirectory();
    }
  });

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.getAttribute('data-tab');
      if (!tabId) return;

      const activateTab = async () => {
        const targetPane = window.BDUViewFragments?.mount(tabId) || document.getElementById(tabId);
        if (!(await ensureFeatureInitialized(tabId))) return;
        navItems.forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

        item.classList.add('active');
        if (targetPane) targetPane.classList.add('active');

        if (topbarTitle && tabTitles[tabId]) {
          topbarTitle.textContent = tabTitles[tabId];
        }

        if (sidebar && window.innerWidth <= 992) {
          sidebar.classList.remove('open');
        }

        if (tabId === 'tab-confession') {
          setTimeout(() => {
            if (typeof window.triggerFrameIntroAnimation === 'function') {
              window.triggerFrameIntroAnimation();
            }
          }, 150);
        }

        if (['tab-grades', 'tab-profile', 'tab-clans', 'tab-confession'].includes(tabId)) {
          syncAllCurrentUserAvatars();
        }
        void viewLifecycle?.activate(tabId, { pane: targetPane });
      };

      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (document.startViewTransition && !reduceMotion) {
        document.startViewTransition(() => activateTab());
      } else {
        void activateTab();
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

  AppState.dashboardController?.abort();
  const controller = new AbortController();
  AppState.dashboardController = controller;
  const { signal } = controller;

  try {
    // 1. Fetch real grade data from BDU
    const gradeResponse = await BduApi.getGrades(AppState.token, { signal });
    AppState.rawGradeData = gradeResponse;
    const raw = (gradeResponse && gradeResponse.data) ? gradeResponse.data : gradeResponse;
    AppState.semesters = (raw && raw.ds_diem_hocky) ? raw.ds_diem_hocky : (Array.isArray(raw) ? raw : []);

    renderStudentOverview();
    populateSemesterDropdown();
    await ensureChartJs().then(() => renderCharts(AppState.semesters)).catch((error) => {
      console.info('Biểu đồ chưa tải được:', error.message);
    });
    renderGradeTable();

    // Ranking failures must not block grades, profile, schedule or other tools.
    await loadAcademicRanking(signal);

    // 2. Load Profile & Identity Presentation in parallel directly from API
    const maSV = AppState.user?.mssv || '';
    const idsv = AppState.user?.idsv || AppState.user?.id_sinh_vien || '';
    const [profileSettled, presentationSettled] = await Promise.allSettled([
      BduApi.getProfile(AppState.token, idsv, maSV, { signal }),
      BduApi.getMyIdentityPresentation(AppState.token, { signal })
    ]);

    if (presentationSettled.status === 'fulfilled' && presentationSettled.value) {
      AppState.identityPresentation = presentationSettled.value;
      AppState.confession.framePreview = AppState.identityPresentation.equipped_frame_id
        ? String(AppState.identityPresentation.equipped_frame_id).replace(/^frame:/, '')
        : 'real';
      if (!AppState.identityPresentation.equipped_frame_id) {
        try { localStorage.removeItem('bdu_custom_frame_preview'); } catch (e) {}
      }
    } else {
      AppState.identityPresentation = null;
      if (presentationSettled.status === 'rejected') {
        console.info('Chưa tải được danh hiệu hiển thị:', presentationSettled.reason?.message);
      }
    }

    if (profileSettled.status === 'fulfilled' && profileSettled.value) {
      renderProfile(profileSettled.value);
    }
    updateIdentityPresentationUI();

  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error('Failed to load dashboard data:', err);
    showToast(err.message, 'error');
  } finally {
    if (AppState.dashboardController === controller) AppState.dashboardController = null;
  }
}

function flushCommunityRealtime() {
  if (!AppState.token || !AppState.communityRealtimeDirty.size) return;
  AppState.communityRealtimeDirty.clear();
  if (document.getElementById('tab-confession')?.classList.contains('active') && typeof window.loadConfessions === 'function') window.loadConfessions().catch(() => {});
  if (document.getElementById('tab-clans')?.classList.contains('active') && typeof window.loadClansDirectory === 'function') window.loadClansDirectory().catch(() => {});
  if (document.getElementById('tab-learning')?.classList.contains('active')) loadLearningData(true).catch(() => {});
  if (AppState.user?.mssv) {
    BduApi.getMyIdentityPresentation(AppState.token).then((presentation) => {
      AppState.identityPresentation = presentation;
      updateIdentityPresentationUI();
      applyCurrentUserPresentationToFeeds();
    }).catch(() => {});
  }
}

async function loadScheduleData(force = false) {
  if (!AppState.token || (AppState.scheduleLoaded && !force)) return;
  AppState.scheduleController?.abort();
  const controller = new AbortController();
  AppState.scheduleController = controller;
  const statusText = document.getElementById('schedule-status-text');
  if (statusText) statusText.textContent = 'Đang tải...';
  try {
    const schedule = await (window.BDUResourceLoader?.get(`schedule:${AppState.user?.mssv || 'current'}`, () => BduApi.getSchedule(AppState.token, null, { signal: controller.signal }), { force, signal: controller.signal }) || BduApi.getSchedule(AppState.token, null, { signal: controller.signal }));
    renderSchedule(schedule);
    AppState.scheduleLoaded = true;
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.error('Schedule fetch error:', error);
    if (statusText) statusText.textContent = 'Chưa tải được';
    showToast(error.message || 'Không thể tải thời khóa biểu.', 'error');
  } finally {
    if (AppState.scheduleController === controller) AppState.scheduleController = null;
  }
}

async function loadLearningData(force = false) {
  if (!AppState.token || (AppState.learningLoaded && !force)) return;
  AppState.learningController?.abort();
  const controller = new AbortController();
  AppState.learningController = controller;
  try {
    const learning = await (window.BDUResourceLoader?.get(`learning:${AppState.user?.mssv || 'current'}`, () => BduApi.getLearningResources(AppState.token, { signal: controller.signal }), { force, signal: controller.signal }) || BduApi.getLearningResources(AppState.token, { signal: controller.signal }));
    renderLearningHub(learning);
    AppState.learningLoaded = true;
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.error('Learning hub fetch error:', error);
    showToast(error.message || 'Không thể tải kho tài liệu.', 'error');
  } finally {
    if (AppState.learningController === controller) AppState.learningController = null;
  }
}

async function loadAcademicRanking(signal) {
  try {
    AppState.academicRanking = await BduApi.getMyAcademicRanking(AppState.token, { signal });
    renderAcademicRanking(AppState.academicRanking);
    if (typeof window.updateForumUserWidgets === 'function') window.updateForumUserWidgets();
  } catch (error) {
    if (error?.name === 'AbortError') return;
    AppState.academicRanking = null;
    renderAcademicRanking(null, error.message);
    if (typeof window.updateForumUserWidgets === 'function') window.updateForumUserWidgets();
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
    AppState.leaderboard.controller?.abort();
    return;
  }
  const loading = document.getElementById('leaderboard-loading');
  const empty = document.getElementById('leaderboard-empty');
  const tableWrap = document.getElementById('leaderboard-table-wrap');
  AppState.leaderboard.loading = true;
  loading?.classList.remove('hidden');
  empty?.classList.add('hidden');
  tableWrap?.classList.add('hidden');
  const controller = new AbortController();
  AppState.leaderboard.controller = controller;

  try {
    const data = await BduApi.getAcademicLeaderboard(AppState.token, { ...AppState.leaderboard, signal: controller.signal });
    AppState.leaderboard.loaded = true;
    renderAcademicLeaderboard(data);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (loading) loading.classList.add('hidden');
    if (empty) {
      empty.textContent = error.message || 'Chưa thể tải bảng xếp hạng lúc này. Vui lòng thử lại sau.';
      empty.classList.remove('hidden');
    }
  } finally {
    if (AppState.leaderboard.controller === controller) AppState.leaderboard.controller = null;
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
  const isOverrideActive = AppState.identityPresentation?.avatar_source === 'override' && Boolean(AppState.identityPresentation?.avatar_url);

  if (photoUrl && imgEl) {
    let fullPhotoUrl = photoUrl;
    if (!fullPhotoUrl.startsWith('http') && !fullPhotoUrl.startsWith('data:')) {
      if (fullPhotoUrl.startsWith('/9j/') || fullPhotoUrl.length > 500) {
        fullPhotoUrl = `data:image/jpeg;base64,${fullPhotoUrl.replace(/\s+/g, '')}`;
      } else {
        fullPhotoUrl = (fullPhotoUrl.startsWith('/') ? 'https://sv.bdu.edu.vn' : 'https://sv.bdu.edu.vn/') + fullPhotoUrl;
      }
    }
    AppState.bduSchoolPhoto = fullPhotoUrl;

    if (!isOverrideActive && AppState.user) {
      AppState.user.photoUrl = fullPhotoUrl;
      AppState.user.avatarSource = 'bdu-api-live';
      try {
        localStorage.setItem('bdu_user_photo', fullPhotoUrl);
      } catch(e) {}
    }
    if (typeof window.updateForumUserWidgets === 'function') {
      window.updateForumUserWidgets();
    }
    const displayUrl = isOverrideActive ? AppState.identityPresentation.avatar_url : fullPhotoUrl;
    imgEl.src = displayUrl;
    imgEl.onload = () => {
      imgEl.classList.remove('hidden');
      if (avatarPlaceholder) avatarPlaceholder.classList.add('hidden');
      syncAllCurrentUserAvatars();
    };
    imgEl.onerror = () => {
      if (isOverrideActive) return;
      imgEl.classList.add('hidden');
      if (avatarPlaceholder) {
        avatarPlaceholder.classList.remove('hidden');
        avatarPlaceholder.textContent = getInitials(name);
      }
    };
  } else {
    const fallbackPhoto = isOverrideActive ? AppState.identityPresentation.avatar_url : (AppState.user?.photoUrl || localStorage.getItem('bdu_user_photo'));
    if (fallbackPhoto && imgEl) {
      imgEl.src = fallbackPhoto;
      imgEl.classList.remove('hidden');
      if (avatarPlaceholder) avatarPlaceholder.classList.add('hidden');
    } else if (avatarPlaceholder) {
      if (imgEl) imgEl.classList.add('hidden');
      avatarPlaceholder.classList.remove('hidden');
      avatarPlaceholder.textContent = getInitials(name);
    }
  }
  syncAllCurrentUserAvatars();

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
// BDU_FEATURE_BUNDLE_PLACEHOLDER
// Heavy dashboard features are loaded by native import() when their tab is opened.
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

// Explicit bridge for native feature modules. Keeping the shared runtime in a
// small, documented object avoids duplicating state when a feature is loaded.
window.BDUAppState = AppState;
window.BDUAppRuntime = {
  AppState,
  BduApi: window.BduApi,
  ensureFeatureInitialized,
  bootApplication,
  initTheme,
  ensureChartJs,
  updateThemeIcons,
  showToast,
  escapeHtml,
  renderIdentityTitleBadges,
  renderIdentityAvatar,
  initTitleCustomizer,
  openTitleCustomizer,
  closeTitleCustomizer,
  renderTitleCustomizerOptions,
  formatAchievementUnlockDate,
  formatAchievementEvidence,
  handleTitleSelectionChange,
  updateTitleSelectionCount,
  saveTitleCustomizer,
  initIdentityAdmin,
  updateIdentityPresentationUI,
  getResolvedAvatarUrl,
  syncAllCurrentUserAvatars,
  applyResolvedAvatarToCurrentUser,
  applyCurrentUserPresentationToFeeds,
  initLoginCharacters,
  initAuth,
  handleLogout,
  connectCommunityRealtime,
  communityRealtimeSubscribe,
  handleCommunityRealtimeMessage,
  getTokenExpTime,
  checkTokenExpiration,
  setButtonLoading,
  switchToDashboard,
  getInitials,
  initNavigation,
  loadAllDashboardData,
  flushCommunityRealtime,
  loadScheduleData,
  loadLearningData,
  loadAcademicRanking,
  renderAcademicRanking,
  initLeaderboard,
  updateLeaderboardSegments,
  formatLeaderboardValue,
  formatOverallGpa,
  formatOverallCredits,
  updateStickyCurrentRankDetails,
  loadAcademicLeaderboard,
  renderAcademicLeaderboard,
  updateMiniHallOfFame,
  renderStudentOverview,
  calculateRank,
  formatScore,
  getGradeLetterClass,
  renderCharts,
  populateSemesterDropdown,
  initGradeFilters,
  renderGradeTable,
  exportGradesToCSV,
  renderProfile,
  initScheduleTab,
  renderSchedule
};
