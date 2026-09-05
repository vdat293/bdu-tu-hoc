/** Lazy dashboard feature bundle. Loaded only when a heavy view is opened. */
const runtime = window.BDUAppRuntime || {};
const { AppState, BduApi, ensureFeatureInitialized, bootApplication, initTheme, ensureChartJs, updateThemeIcons, showToast, escapeHtml, renderIdentityTitleBadges, renderIdentityAvatar, initTitleCustomizer, openTitleCustomizer, closeTitleCustomizer, renderTitleCustomizerOptions, formatAchievementUnlockDate, formatAchievementEvidence, handleTitleSelectionChange, updateTitleSelectionCount, saveTitleCustomizer, initIdentityAdmin, updateIdentityPresentationUI, getResolvedAvatarUrl, syncAllCurrentUserAvatars, applyResolvedAvatarToCurrentUser, applyCurrentUserPresentationToFeeds, initLoginCharacters, initAuth, handleLogout, connectCommunityRealtime, communityRealtimeSubscribe, handleCommunityRealtimeMessage, getTokenExpTime, checkTokenExpiration, setButtonLoading, switchToDashboard, getInitials, initNavigation, loadAllDashboardData, flushCommunityRealtime, loadScheduleData, loadLearningData, loadAcademicRanking, renderAcademicRanking, initLeaderboard, updateLeaderboardSegments, formatLeaderboardValue, formatOverallGpa, formatOverallCredits, updateStickyCurrentRankDetails, loadAcademicLeaderboard, renderAcademicLeaderboard, updateMiniHallOfFame, renderStudentOverview, calculateRank, formatScore, getGradeLetterClass, renderCharts, populateSemesterDropdown, initGradeFilters, renderGradeTable, exportGradesToCSV, renderProfile, initScheduleTab, renderSchedule } = runtime;

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


const featureInitializers = {
  'tab-learning': initLearningHub
};

export function initialize(tabId) {
  const initializer = featureInitializers[tabId];
  if (!initializer) return false;
  initializer();
  return true;
}

Object.assign(window, {
  initLearningHub,
  renderLearningHub,
  renderLearningCourseDirectory,
  getLearningCourseSemesters,
  compareLearningSemesters,
  renderLearningCourseCard,
  openLearningCourse,
  closeLearningCourse,
  openLearningComposer,
  closeLearningComposer,
  handleLearningComposerKeydown,
  updateLearningComposerForKind,
  submitLearningPost,
  getSupportedResourceSource,
  renderLearningSourceLogo,
  getLearningAttachmentMeta,
  renderLearningCoursePosts,
  handleLearningPostClick,
  handleLearningCommentSubmit,
  resetLearningReplyComposer,
  loadLearningPostComments,
  renderLearningCommentsTree,
  formatLearningPostTime
});
