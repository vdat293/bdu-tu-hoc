/** Lazy dashboard feature bundle. Loaded only when a heavy view is opened. */
const runtime = window.BDUAppRuntime || {};
const { AppState, BduApi, ensureFeatureInitialized, bootApplication, initTheme, ensureChartJs, updateThemeIcons, showToast, escapeHtml, renderIdentityTitleBadges, renderIdentityAvatar, initTitleCustomizer, openTitleCustomizer, closeTitleCustomizer, renderTitleCustomizerOptions, formatAchievementUnlockDate, formatAchievementEvidence, handleTitleSelectionChange, updateTitleSelectionCount, saveTitleCustomizer, initIdentityAdmin, updateIdentityPresentationUI, getResolvedAvatarUrl, syncAllCurrentUserAvatars, applyResolvedAvatarToCurrentUser, applyCurrentUserPresentationToFeeds, initLoginCharacters, initAuth, handleLogout, connectCommunityRealtime, communityRealtimeSubscribe, handleCommunityRealtimeMessage, getTokenExpTime, checkTokenExpiration, setButtonLoading, switchToDashboard, getInitials, initNavigation, loadAllDashboardData, flushCommunityRealtime, loadScheduleData, loadLearningData, loadAcademicRanking, renderAcademicRanking, initLeaderboard, updateLeaderboardSegments, formatLeaderboardValue, formatOverallGpa, formatOverallCredits, updateStickyCurrentRankDetails, loadAcademicLeaderboard, renderAcademicLeaderboard, updateMiniHallOfFame, renderStudentOverview, calculateRank, formatScore, getGradeLetterClass, renderCharts, populateSemesterDropdown, initGradeFilters, renderGradeTable, exportGradesToCSV, renderProfile, initScheduleTab, renderSchedule } = runtime;

// CLB & NHÓM HỌC TẬP (CLAN & GUILD MODULE)
// ============================================================================
AppState.clans = {
  list: [],
  canCreate: false,
  activeFilter: 'all',
  currentClan: null,
  posts: [],
  feedFilter: 'all',
  composerMode: 'discussion',
  documents: [],
  docFilter: 'all',
  docSearch: ''
};

function checkHasTtcds(presentation = AppState.identityPresentation) {
  if (AppState.clans?.canCreate) return true;
  if (!presentation) return false;
  if (presentation.can_create_clan) return true;
  const titles = [
    ...(presentation.available_titles || []),
    ...(presentation.selected_titles || [])
  ];
  return titles.some((t) => 
    t.id === 'title:ttcds' || 
    t.id === 'achievement:ttcds' || 
    String(t.label || '').toUpperCase().includes('TTCDS')
  );
}

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

  if (openCreateBtn) {
    openCreateBtn.addEventListener('click', () => {
      if (!AppState.token) {
        showToast('Vui lòng đăng nhập để tạo CLB / Nhóm.', 'warning');
        return;
      }
      const canCreate = AppState.clans?.canCreate || checkHasTtcds(AppState.identityPresentation);
      if (!canCreate) {
        showToast('Chỉ những thành viên sở hữu danh hiệu #TTCDS mới có quyền thành lập CLB / Nhóm mới.', 'warning');
        return;
      }
      openModal();
    });
  }
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

  // Channel Subtabs Navigation (Bản Tin vs Kho Tài Liệu vs Thành Viên vs Yêu Cầu Gia Nhập)
  const tabFeedBtn = document.getElementById('tab-btn-clan-feed');
  const tabDocsBtn = document.getElementById('tab-btn-clan-docs');
  const tabMembersBtn = document.getElementById('tab-btn-clan-members');
  const tabRequestsBtn = document.getElementById('tab-btn-clan-requests');

  if (tabFeedBtn) tabFeedBtn.addEventListener('click', () => switchClanSubtab('feed'));
  if (tabDocsBtn) tabDocsBtn.addEventListener('click', () => switchClanSubtab('docs'));
  if (tabMembersBtn) tabMembersBtn.addEventListener('click', () => switchClanSubtab('members'));
  if (tabRequestsBtn) tabRequestsBtn.addEventListener('click', () => switchClanSubtab('requests'));

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
    AppState.clans.canCreate = clans.can_create_clan ?? checkHasTtcds(AppState.identityPresentation);
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
    const hasPending = Boolean(clan.has_pending_request);
    let roleText = '';
    if (clan.my_role === 'leader') roleText = '👑 Bang Chủ';
    else if (clan.my_role === 'vice_leader') roleText = '⭐ Phó Bang';
    else if (isJoined) roleText = '🛡️ Thành Viên';
    else if (hasPending) roleText = '⏳ Đang Chờ Duyệt';

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
            ${roleText ? `<span class="clan-my-role-badge ${hasPending ? 'pending' : ''}">${roleText}</span>` : ''}
          </div>

          <div class="clan-card-hint-row">
            <span>${isJoined ? 'Đã tham gia' : (hasPending ? 'Đang chờ duyệt' : 'Chưa tham gia')}</span>
            <span class="hint-action">${isJoined ? 'Xem bài viết & tài liệu →' : (hasPending ? 'Xem trạng thái →' : 'Xem thành viên & xin gia nhập →')}</span>
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
    const res = await BduApi.joinClan(AppState.token, clanId);
    showToast(res.message || 'Đã gửi yêu cầu tham gia tới Trưởng CLB. Vui lòng chờ phê duyệt!', 'success');
    const clan = (AppState.clans.list || []).find(c => String(c.id) === String(clanId));
    if (clan) {
      clan.has_pending_request = true;
    }
    await loadClansDirectory();
    if (AppState.clans.currentClan && String(AppState.clans.currentClan.id) === String(clanId)) {
      AppState.clans.currentClan.has_pending_request = true;
      openClanChannel(clanId);
    }
  } catch (err) {
    showToast(err.message || 'Không thể gửi yêu cầu tham gia CLB.', 'error');
  }
}

async function handleCancelJoinRequest(clanId) {
  if (!AppState.token) return;
  if (!confirm('Bạn có chắc muốn hủy yêu cầu tham gia CLB này?')) return;
  try {
    await BduApi.cancelClanJoinRequest(AppState.token, clanId);
    showToast('Đã hủy yêu cầu tham gia.', 'info');
    const clan = (AppState.clans.list || []).find(c => String(c.id) === String(clanId));
    if (clan) {
      clan.has_pending_request = false;
    }
    await loadClansDirectory();
    if (AppState.clans.currentClan && String(AppState.clans.currentClan.id) === String(clanId)) {
      AppState.clans.currentClan.has_pending_request = false;
      openClanChannel(clanId);
    }
  } catch (err) {
    showToast(err.message || 'Không thể hủy yêu cầu tham gia.', 'error');
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

  const canCreate = AppState.clans?.canCreate || checkHasTtcds(AppState.identityPresentation);
  if (!canCreate) {
    showToast('Chỉ những thành viên sở hữu danh hiệu #TTCDS mới có quyền thành lập CLB / Nhóm mới.', 'warning');
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
    roleEl.textContent = clan.my_role === 'leader' ? '👑 Bang Chủ' : (clan.my_role === 'vice_leader' ? '⭐ Phó Bang' : (clan.is_joined ? '🛡️ Thành Viên' : (clan.has_pending_request ? '⏳ Đang chờ duyệt' : 'Chưa tham gia')));
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
    } else if (clan.has_pending_request) {
      actionBox.innerHTML = `
        <div style="display:flex;gap:8px;align-items:center;">
          <span class="badge-pending">⏳ Đang chờ duyệt</span>
          <button class="btn btn-secondary btn-sm" id="btn-channel-cancel-request">Hủy yêu cầu</button>
        </div>
      `;
      document.getElementById('btn-channel-cancel-request')?.addEventListener('click', async () => {
        await handleCancelJoinRequest(clan.id);
      });
    } else {
      actionBox.innerHTML = `<button class="btn btn-primary btn-sm" id="btn-channel-join">Xin Tham Gia CLB</button>`;
      document.getElementById('btn-channel-join')?.addEventListener('click', async () => {
        await handleJoinClan(clan.id);
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

  // Clan Requests Subtab (Chỉ dành cho Trưởng CLB)
  const isLeader = clan.my_role === 'leader';
  const tabReqBtn = document.getElementById('tab-btn-clan-requests');
  if (tabReqBtn) {
    tabReqBtn.classList.toggle('hidden', !isLeader);
    if (isLeader) {
      BduApi.getClanJoinRequests(AppState.token, clan.id).then(reqs => {
        const count = Array.isArray(reqs) ? reqs.length : 0;
        const countBadge = document.getElementById('channel-subtab-req-count');
        if (countBadge) countBadge.textContent = count;
      }).catch(() => {});
    }
  }

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
  const tabRequestsBtn = document.getElementById('tab-btn-clan-requests');

  const panelFeed = document.getElementById('channel-panel-feed');
  const panelDocs = document.getElementById('channel-panel-docs');
  const panelMembers = document.getElementById('channel-panel-members');
  const panelRequests = document.getElementById('channel-panel-requests');

  const currentClan = AppState.clans.currentClan;

  [tabFeedBtn, tabDocsBtn, tabMembersBtn, tabRequestsBtn].forEach(btn => btn?.classList.remove('active'));
  [panelFeed, panelDocs, panelMembers, panelRequests].forEach(panel => panel?.classList.add('hidden'));

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
  } else if (targetTab === 'requests') {
    tabRequestsBtn?.classList.add('active');
    panelRequests?.classList.remove('hidden');
    if (currentClan) {
      loadClanRequests(currentClan.id);
    }
  }
}

async function loadClanRequests(clanId) {
  const container = document.getElementById('clan-requests-list');
  const countBadge = document.getElementById('clan-requests-count-badge');
  const subtabBadge = document.getElementById('channel-subtab-req-count');
  if (!container) return;

  container.innerHTML = `
    <div style="text-align: center; padding: 24px; color: var(--text-muted);">
      <span>Đang tải danh sách yêu cầu gia nhập...</span>
    </div>
  `;

  try {
    const requests = await BduApi.getClanJoinRequests(AppState.token, clanId);
    const list = Array.isArray(requests) ? requests : [];
    if (countBadge) countBadge.textContent = `${list.length} yêu cầu chờ duyệt`;
    if (subtabBadge) subtabBadge.textContent = list.length;

    if (list.length === 0) {
      container.innerHTML = `
        <div class="empty-state-box" style="text-align: center; padding: 40px;">
          <div style="font-size: 32px; margin-bottom: 8px;">🎉</div>
          <h4 style="font-weight: 700; margin-bottom: 4px;">Không có yêu cầu chờ duyệt</h4>
          <p style="font-size: 13px; color: var(--text-muted);">Hiện tại chưa có sinh viên nào đang gửi yêu cầu xin gia nhập CLB.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = list.map(req => {
      const name = req.full_name || req.mssv;
      const initial = (name.charAt(0) || 'S').toUpperCase();
      const avatarHtml = req.avatar_url
        ? `<img src="${escapeHtml(req.avatar_url)}" alt="${escapeHtml(name)}" loading="lazy" decoding="async">`
        : initial;
      const dateStr = req.created_at ? new Date(req.created_at).toLocaleString('vi-VN') : '';

      return `
        <div class="clan-request-card" data-req-id="${req.id}">
          <div class="clan-request-user">
            <div class="clan-request-avatar">${avatarHtml}</div>
            <div class="clan-request-info">
              <span class="clan-request-name">${escapeHtml(name)}</span>
              <div class="clan-request-meta">
                <span>MSSV: <strong>${escapeHtml(req.mssv)}</strong></span>
                <span>•</span>
                <span>${dateStr}</span>
                ${req.message ? `<span>• Lời nhắn: "${escapeHtml(req.message)}"</span>` : ''}
              </div>
            </div>
          </div>
          <div class="clan-request-actions">
            <button class="btn-approve-request" data-req-id="${req.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              Duyệt
            </button>
            <button class="btn-reject-request" data-req-id="${req.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="18" x2="18" y2="18"></line>
              </svg>
              Từ chối
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Gắn sự kiện duyệt / từ chối
    container.querySelectorAll('.btn-approve-request').forEach(btn => {
      btn.addEventListener('click', async () => {
        const requestId = btn.getAttribute('data-req-id');
        btn.disabled = true;
        try {
          await BduApi.reviewClanJoinRequest(AppState.token, clanId, requestId, 'approve');
          showToast('Đã phê duyệt thành viên vào CLB thành công!', 'success');
          const current = AppState.clans.currentClan;
          if (current) current.member_count = (current.member_count || 0) + 1;
          const memCountEl = document.getElementById('channel-clan-members');
          if (memCountEl && current) {
            memCountEl.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg> ${current.member_count} Thành viên`;
          }
          const subtabMemCount = document.getElementById('channel-subtab-mem-count');
          if (subtabMemCount && current) subtabMemCount.textContent = current.member_count;
          await loadClanRequests(clanId);
        } catch (err) {
          showToast(err.message || 'Không thể phê duyệt yêu cầu.', 'error');
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('.btn-reject-request').forEach(btn => {
      btn.addEventListener('click', async () => {
        const requestId = btn.getAttribute('data-req-id');
        btn.disabled = true;
        try {
          await BduApi.reviewClanJoinRequest(AppState.token, clanId, requestId, 'reject');
          showToast('Đã từ chối yêu cầu gia nhập.', 'info');
          await loadClanRequests(clanId);
        } catch (err) {
          showToast(err.message || 'Không thể từ chối yêu cầu.', 'error');
          btn.disabled = false;
        }
      });
    });

  } catch (err) {
    console.error('Lỗi tải danh sách yêu cầu gia nhập:', err);
    container.innerHTML = `
      <div class="empty-state-box" style="text-align: center; padding: 24px; color: var(--text-muted);">
        <p>${escapeHtml(err.message || 'Không thể tải danh sách yêu cầu gia nhập.')}</p>
        <button class="btn btn-secondary btn-sm" onclick="loadClanRequests('${clanId}')" style="margin-top: 8px;">Thử lại</button>
      </div>
    `;
  }
}

function renderLockedClanFeed(clan) {
  const container = document.getElementById('clan-posts-feed');
  const composer = document.querySelector('.clan-composer');
  if (composer) composer.style.display = 'none';

  if (container) {
    const hasPending = Boolean(clan.has_pending_request);
    container.innerHTML = `
      <div class="clan-feed-locked-card glass-panel">
        <svg class="lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <h4 style="font-size: 16px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">Bản Tin Nội Bộ CLB</h4>
        <p style="font-size: 13px; color: var(--text-muted); max-width: 460px; margin: 0 auto 16px;">
          ${hasPending ? 'Yêu cầu tham gia của bạn đang chờ Trưởng CLB phê duyệt. Sau khi được duyệt, bạn sẽ xem được toàn bộ bài viết thảo luận và tài liệu trong nhóm!' : 'Bạn chưa tham gia CLB này. Hãy gửi yêu cầu xin gia nhập để xem bài viết thảo luận, thông báo và các tài liệu ôn thi được chia sẻ trong nhóm!'}
        </p>
        ${hasPending ? `
          <div style="display:inline-flex;gap:10px;align-items:center;">
            <span class="badge-pending">⏳ Đang Chờ Phê Duyệt</span>
            <button class="btn btn-secondary btn-sm" id="btn-lock-cancel-request">Hủy yêu cầu</button>
          </div>
        ` : `
          <button class="btn btn-primary btn-sm" id="btn-lock-join-clan">Xin Tham Gia CLB Ngay</button>
        `}
      </div>
    `;

    document.getElementById('btn-lock-join-clan')?.addEventListener('click', async () => {
      await handleJoinClan(clan.id);
    });
    document.getElementById('btn-lock-cancel-request')?.addEventListener('click', async () => {
      await handleCancelJoinRequest(clan.id);
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
        communityRealtimeSubscribe(`post:${postId}`);
        ensureCommunityReplyContext(section);
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
        await BduApi.addCommunityPostComment(AppState.token, postId, {
          content,
          parentId: input.dataset.parentId || null
        });
        input.value = '';
        resetCommunityReplyComposer(btn.closest('.forum-comments-wrapper, .post-comments-section, .clan-comments-wrapper'));
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

    listEl.innerHTML = renderCommunityCommentsTree(comments);
    attachCommunityCommentEvents(listEl, postId);
  } catch (err) {
    listEl.innerHTML = `<p style="font-size: 12px; color: var(--color-rose); padding: 10px;">${escapeHtml(err.message || 'Lỗi tải bình luận.')}</p>`;
  }
}

function renderCommunityCommentsTree(comments) {
  const list = Array.isArray(comments) ? comments : [];
  const byId = new Map(list.map((comment) => [String(comment.id), comment]));
  const rootIdFor = (comment) => {
    let current = comment;
    const visited = new Set([String(comment.id)]);
    while (current?.parent_id && byId.has(String(current.parent_id))) {
      const parentId = String(current.parent_id);
      if (visited.has(parentId)) break;
      visited.add(parentId);
      current = byId.get(parentId);
    }
    return String(current?.id || comment.id);
  };
  const roots = list.filter((comment) => !comment.parent_id || !byId.has(String(comment.parent_id)));
  const rootIds = new Set(roots.map((comment) => String(comment.id)));
  const repliesByRoot = new Map();
  list.forEach((comment) => {
    if (rootIds.has(String(comment.id))) return;
    const rootId = rootIdFor(comment);
    if (!repliesByRoot.has(rootId)) repliesByRoot.set(rootId, []);
    repliesByRoot.get(rootId).push(comment);
  });

  const renderComment = (comment, rootId, isReply = false) => {
    const isAnon = Boolean(comment.is_anonymous);
    const rawName = isAnon ? 'Sinh viên giấu tên' : (comment.author?.name || 'Thành viên BDU');
    const safeName = escapeHtml(rawName);
    const relativeTime = typeof formatRelativeTime === 'function' ? formatRelativeTime(comment.created_at) : 'Vừa xong';
    const titles = isAnon
      ? renderIdentityTitleBadges([{ label: 'Ẩn danh', tone: 'member' }])
      : renderIdentityTitleBadges(comment.author?.titles, 'identity-title-comment');
    const actionHtml = comment.is_deleted ? '' : `
      <div class="comment-card-actions">
        <button type="button" class="comment-inline-action" data-community-reply="${comment.id}" data-community-root="${rootId}" data-comment-author="${safeName}">Trả lời</button>
        ${comment.can_edit ? `<button type="button" class="comment-inline-action" data-community-edit="${comment.id}">Sửa</button>` : ''}
        ${comment.can_delete ? `<button type="button" class="comment-inline-action is-danger" data-community-delete="${comment.id}">Xóa</button>` : ''}
      </div>`;
    return `
      <article class="comment-card-item ${isReply ? 'is-reply' : ''} ${comment.is_deleted ? 'is-deleted' : ''}" style="--comment-depth: ${isReply ? 1 : 0}" data-comment-id="${comment.id}" data-comment-root-id="${rootId}">
        <div class="comment-card-layout">
          <div class="comment-card-avatar ${isAnon ? 'anon' : ''}">${isAnon ? '?' : renderIdentityAvatar(comment.author, rawName)}</div>
          <div class="comment-card-copy">
            <div class="comment-card-top">
              <span class="comment-author-name ${isAnon ? 'anon' : ''}">${safeName} ${titles}</span>
              <span class="comment-time">${relativeTime}${comment.edited_at ? ' · đã sửa' : ''}</span>
            </div>
            <div class="comment-body-text">${escapeHtml(comment.content)}</div>
            ${actionHtml}
          </div>
        </div>
      </article>
    `;
  };
  return roots.map((root) => {
    const rootId = String(root.id);
    const replies = repliesByRoot.get(rootId) || [];
    return renderComment(root, rootId) + replies.map((reply) => renderComment(reply, rootId, true)).join('');
  }).join('');
}

function ensureCommunityReplyContext(section) {
  if (!section) return null;
  let context = section.querySelector('[data-community-reply-context]');
  if (!context) {
    context = document.createElement('div');
    context.dataset.communityReplyContext = 'true';
    context.className = 'community-reply-context hidden';
    context.innerHTML = '<span></span><button type="button" data-community-cancel-reply>Hủy trả lời</button>';
    section.querySelector('.comment-composer-inline, .comment-input-row')?.before(context);
  }
  return context;
}

function resetCommunityReplyComposer(section) {
  const input = section?.querySelector('.comment-text-input');
  if (input) {
    delete input.dataset.parentId;
    input.placeholder = 'Viết bình luận cho bài đăng này...';
  }
  const context = section?.querySelector('[data-community-reply-context]');
  context?.classList.add('hidden');
}

function attachCommunityCommentEvents(listEl, postId) {
  const section = listEl.closest('.forum-comments-wrapper, .post-comments-section, .clan-comments-wrapper');
  listEl.querySelectorAll('[data-community-reply]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = section?.querySelector('.comment-text-input');
      if (!input) return;
      input.dataset.parentId = button.dataset.communityRoot || button.dataset.communityReply;
      input.placeholder = `Trả lời ${button.dataset.commentAuthor || 'bình luận này'}...`;
      const context = ensureCommunityReplyContext(section);
      if (context) {
        context.querySelector('span').textContent = `Đang trả lời ${button.dataset.commentAuthor || 'bình luận này'}`;
        context.classList.remove('hidden');
      }
      input.focus();
    });
  });
  section?.querySelector('[data-community-cancel-reply]')?.addEventListener('click', () => resetCommunityReplyComposer(section));
  listEl.querySelectorAll('[data-community-edit]').forEach((button) => {
    button.addEventListener('click', async () => {
      const card = button.closest('[data-comment-id]');
      const current = card?.querySelector('.comment-body-text')?.textContent?.trim();
      const next = window.prompt('Chỉnh sửa bình luận:', current || '');
      if (next === null || !next.trim() || next.trim() === current) return;
      try {
        await BduApi.editCommunityPostComment(AppState.token, postId, button.dataset.communityEdit, next.trim());
        await loadCommentsForPost(postId);
      } catch (err) {
        showToast(err.message || 'Không thể sửa bình luận.', 'error');
      }
    });
  });
  listEl.querySelectorAll('[data-community-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      const commentCard = button.closest('[data-comment-id]');
      const deletesThread = String(commentCard?.dataset.commentId) === String(commentCard?.dataset.commentRootId);
      const message = deletesThread
        ? 'Xóa bình luận gốc và toàn bộ phản hồi trong thread này?'
        : 'Xóa bình luận này?';
      if (!window.confirm(message)) return;
      button.disabled = true;
      try {
        const result = await BduApi.deleteCommunityPostComment(AppState.token, postId, button.dataset.communityDelete);
        await loadCommentsForPost(postId);
        const card = button.closest('[data-post-id]');
        card?.querySelectorAll('.comment-count-num, .comments-count-inline').forEach((el) => {
          el.textContent = result.comment_count;
        });
        const post = [...(AppState.confession.posts || []), ...(AppState.clans.posts || [])]
          .find((item) => String(item.id) === String(postId));
        if (post) post.comment_count = result.comment_count;
        showToast('Đã xóa bình luận.', 'success');
      } catch (err) {
        button.disabled = false;
        showToast(err.message || 'Không thể xóa bình luận.', 'error');
      }
    });
  });
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
  loadingPromise: null,
  loadingFilter: null,
  controller: null,
  loadedFilter: null,
  total: 0,
  loadingMore: false,
  refreshTimer: null,
  profilePhotoRequest: null,
  profilePhotoRequestedFor: null,
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

function hasFullFramePreviewAccess(user = AppState.user) {
  if (user !== AppState.user) return false;
  return Boolean(AppState.identityPresentation?.frame_access?.all);
}

function hasAnimeFrameAccess(user = AppState.user) {
  if (user !== AppState.user) return false;
  const access = AppState.identityPresentation?.frame_access;
  return Boolean(access?.all || access?.keys?.includes('anime-gojo') || access?.keys?.includes('anime-itachi'));
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
  // PNG source files remain in the catalog as compatibility fallbacks; the runtime uses WebP variants.
  // Legacy assets: frame-gojo-limitless-art.png, frame-itachi-genjutsu-art.png, chibi-gojo-signature.png, chibi-itachi-signature.png
  const frames = {
    'anime-gojo': {
      rank: 0,
      scope: 'anime',
      scopeLabel: 'Anime Signature',
      scopeUpper: 'THIÊN THƯỢNG THIÊN HẠ',
      totalStudents: 0,
      tier: 'anime-gojo',
      frameSvg: 'assets/images/frame-gojo-limitless-art-512.webp',
      frameArt: 'assets/images/frame-gojo-limitless-art-512.webp',
      awakeningAsset: 'assets/images/gojo-six-eyes-awakening-512.webp',
      awakeningClosedAsset: 'assets/images/gojo-six-eyes-closed-v2-512.webp',
      awakeningHalfAsset: 'assets/images/gojo-six-eyes-half-v2-512.webp',
      characterAsset: 'assets/images/chibi-gojo-signature-512.webp',
      characterSide: 'left',
      introEffect: 'gojo-limitless-awaken',
      themeKey: 'anime-gojo',
      frameFamily: 'anime-gojo',
      icon: '∞',
      title: 'Thiên Thượng Thiên Hạ',
      badgeText: '∞ GOJO SIGNATURE',
      rankLabel: '#tochancauduockhong'
    },
    'anime-itachi': {
      rank: 0,
      scope: 'anime',
      scopeLabel: 'Anime Signature',
      scopeUpper: 'ẢO NGUYỆT • HẮC VIÊM',
      totalStudents: 0,
      tier: 'anime-itachi',
      frameSvg: 'assets/images/frame-itachi-genjutsu-art-512.webp',
      frameArt: 'assets/images/frame-itachi-genjutsu-art-512.webp',
      awakeningAsset: 'assets/images/itachi-sharingan-awakening-512.webp',
      awakeningClosedAsset: 'assets/images/itachi-sharingan-closed-v2-512.webp',
      awakeningHalfAsset: 'assets/images/itachi-sharingan-half-v2-512.webp',
      characterAsset: 'assets/images/chibi-itachi-signature-512.webp',
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

function buildAidtiSignatureFrameConfig() {
  return {
    rank: 0,
    scope: 'aidti',
    scopeLabel: 'Viện Trí tuệ Nhân tạo và Chuyển đổi số',
    scopeUpper: 'AIDTI • BDU',
    totalStudents: 0,
    tier: 'aidti-bdu',
    frameSvg: 'assets/images/frame-aidti-bdu-chibi-v2.png',
    frameArt: 'assets/images/frame-aidti-bdu-chibi-v2.png',
    introEffect: 'aidti-data-awaken',
    themeKey: 'aidti-bdu',
    frameFamily: 'aidti-bdu',
    icon: 'AI',
    title: 'AIDTI',
    badgeText: 'AI • AIDTI BDU',
    rankLabel: 'TRUNG TÂM CHUYỂN ĐỔI SỐ'
  };
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
    const previewKey = previewTier === 'top-1' ? 'truong-1'
      : (previewTier === 'top-2' ? 'vien-top' : (previewTier === 'top-4-5' ? 'khoa-top' : (previewTier === 'top-3' ? 'lop-top' : (previewTier === 'top-6-10' ? 'truong-top' : previewTier))));
    const previewAccess = getStudentAcademicUnlockedFrames()?.[previewKey];
    if (!previewAccess?.unlocked) return null;
    if (previewTier === 'aidti-bdu') {
      return buildAidtiSignatureFrameConfig();
    } else if (previewTier === 'anime-gojo' || previewTier === 'anime-itachi') {
      return buildAnimeSignatureFrameConfig(previewTier);
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
    svg: 'assets/images/frame-gojo-limitless-art-256.webp',
    art: 'assets/images/frame-gojo-limitless-art-256.webp',
    character: 'assets/images/chibi-gojo-signature-256.webp',
    characterSide: 'left',
    icon: '∞',
    tag: 'ĐỘC QUYỀN • GOJO',
    title: 'Thiên Thượng Thiên Hạ',
    desc: 'Không gian bị nén thành sáu lớp dữ liệu, bẻ cong thành khung vô hạn rồi khai mở Lục Nhãn lam quang.'
  },
  {
    key: 'anime-itachi',
    scope: 'anime',
    family: 'anime-itachi',
    tier: 'anime-itachi',
    svg: 'assets/images/frame-itachi-genjutsu-art-256.webp',
    art: 'assets/images/frame-itachi-genjutsu-art-256.webp',
    character: 'assets/images/chibi-itachi-signature-256.webp',
    characterSide: 'right',
    icon: '●',
    tag: 'ĐỘC QUYỀN • ITACHI',
    title: 'Ảo Nguyệt Hắc Viêm',
    desc: 'Đàn quạ tan thành mực đen, kết ấn Mangekyō rồi để Amaterasu bò dọc khung như ngọn lửa sống.'
  }
];

const AIDTI_SIGNATURE_FRAME_COLLECTION = [
  {
    key: 'aidti-bdu',
    scope: 'aidti',
    family: 'aidti-bdu',
    tier: 'aidti-bdu',
    svg: 'assets/images/frame-aidti-bdu-chibi-v2.png',
    art: 'assets/images/frame-aidti-bdu-chibi-v2.png',
    icon: 'AI',
    tag: 'ĐỘC QUYỀN • AIDTI BDU',
    title: 'AIDTI',
    desc: 'Sinh viên BDU chibi, mạch dữ liệu đỏ–lam, node AI và hiệu ứng quét số dành riêng cho Viện Trí tuệ Nhân tạo và Chuyển đổi số.'
  }
];

function getAcademicFrameCollection(rankingData) {
  if (!isThFaculty(rankingData) && !hasFullFramePreviewAccess()) {
    return [...AIDTI_SIGNATURE_FRAME_COLLECTION, ...ANIME_SIGNATURE_FRAME_COLLECTION, ...ACADEMIC_FRAME_COLLECTION];
  }
  return [...AIDTI_SIGNATURE_FRAME_COLLECTION, ...ANIME_SIGNATURE_FRAME_COLLECTION, ...ACADEMIC_FRAME_COLLECTION.flatMap(item => {
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
    'aidti-bdu': { unlocked: false, currentRank: 0, req: 'Khung độc quyền AIDTI' },
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

  if (hasAnimeFrameAccess()) {
    unlockedFrames['anime-gojo'].unlocked = true;
    unlockedFrames['anime-gojo'].req = 'Độc quyền Signature';
    unlockedFrames['anime-itachi'].unlocked = true;
    unlockedFrames['anime-itachi'].req = 'Độc quyền Signature';
  }

  if (hasFullFramePreviewAccess()) {
    Object.values(unlockedFrames).forEach(frame => {
      frame.unlocked = true;
      frame.req = 'Tài khoản kiểm thử toàn bộ khung';
    });
  }

  const grantedFrameKeys = AppState.identityPresentation?.frame_access?.keys || [];
  grantedFrameKeys.forEach((key) => {
    if (unlockedFrames[key]) {
      unlockedFrames[key].unlocked = true;
      unlockedFrames[key].req = 'Được cấp quyền đặc biệt';
    }
  });

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
            ${item.family === 'aidti-bdu'
              ? `<img class="avatar-frame-overlay aidti-frame-art-mini" src="${item.art || item.svg}" alt="${escapeHtml(item.title)}">`
              : `<img class="avatar-frame-overlay ${item.art ? 'anime-frame-art-mini' : ''}" src="${item.art || item.svg}" alt="${escapeHtml(item.title)}">`}
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

  const previous = AppState.confession.framePreview || 'real';
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

  if (AppState.token) {
    BduApi.updateMyEquippedFrame(AppState.token, tier)
      .then((presentation) => {
        AppState.identityPresentation = presentation;
        updateIdentityPresentationUI();
      })
      .catch((error) => {
        AppState.confession.framePreview = previous;
        try {
          if (previous === 'real') localStorage.removeItem('bdu_custom_frame_preview');
          else localStorage.setItem('bdu_custom_frame_preview', previous);
        } catch (e) {}
        updateForumUserWidgets();
        renderForumFeed();
        renderFrameCollectionModal();
        showToast(error.message || 'Không thể trang bị khung này.', 'error');
      });
  }

  const labels = {
    'aidti-bdu': 'AIDTI - Trung tâm Chuyển đổi số',
    'anime-gojo': '∞ Anime Signature - Thiên Thượng Thiên Hạ',
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
  'aidti-bdu': {
    primary: '#ef233c',
    secondary: '#2563eb',
    highlight: '#ffffff',
    rgb: '239, 35, 60',
    rarity: 'AIDTI SIGNATURE'
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
  'gojo-limitless-awaken', 'itachi-crow-genjutsu', 'aidti-data-awaken'
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
  const isAidtiFrame = frameInfo.frameFamily === 'aidti-bdu';
  const desktopParticleCount = isAidtiFrame
    ? 18
    : frameInfo.frameFamily?.startsWith('anime-')
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
    const distance = isAidtiFrame
      ? 64 + Math.random() * 54
      : 82 + prestigeDistance + Math.random() * 105;
    const particle = document.createElement('i');
    const particleKind = frameInfo.frameFamily === 'aidti-bdu'
      ? (index % 4 === 0 ? 'star' : 'spark')
      : frameInfo.frameFamily === 'anime-itachi'
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
    particle.style.setProperty('--particle-delay', `${isAidtiFrame ? 180 + Math.random() * 520 : 80 + Math.random() * 300}ms`);
    particle.style.setProperty('--particle-duration', `${isAidtiFrame ? 1500 + Math.random() * 900 : 680 + Math.random() * 620}ms`);
    particle.style.setProperty('--particle-size', `${isAidtiFrame ? 1.5 + Math.random() * 2.5 : 2 + Math.random() * 5}px`);
    particle.style.setProperty('--particle-spin', `${isAidtiFrame ? 20 + Math.random() * 80 : 180 + Math.random() * 540}deg`);
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
  if (frameInfo.frameFamily === 'aidti-bdu') {
    const safeArt = escapeHtml(frameInfo.frameArt || frameInfo.frameSvg);
    return `<div class="aidti-frame-stage" aria-label="${safeTitle}">
      <span class="aidti-circuit-ring" aria-hidden="true"></span>
      <span class="aidti-data-scan" aria-hidden="true"></span>
      <img class="aidti-frame-art" src="${safeArt}" alt="Khung ${safeTitle}" decoding="async">
      <span class="aidti-node aidti-node-a" aria-hidden="true"></span>
      <span class="aidti-node aidti-node-b" aria-hidden="true"></span>
      <span class="aidti-node aidti-node-c" aria-hidden="true"></span>
    </div>`;
  }
  if (frameInfo.frameArt) {
    const safeArt = escapeHtml(frameInfo.frameArt);
    const awakeningMarkup = frameInfo.awakeningAsset && frameInfo.awakeningClosedAsset && frameInfo.awakeningHalfAsset
      ? `<div class="anime-awakening-stage is-${frameInfo.frameFamily === 'anime-itachi' ? 'itachi' : 'gojo'}" aria-hidden="true">
        <img class="anime-eye-state anime-eye-state-closed" src="${escapeHtml(frameInfo.awakeningClosedAsset)}" alt="" width="512" height="512" loading="lazy" decoding="async">
        <img class="anime-eye-state anime-eye-state-half" src="${escapeHtml(frameInfo.awakeningHalfAsset)}" alt="" width="512" height="512" loading="lazy" decoding="async">
        <img class="anime-eye-state anime-eye-state-open" src="${escapeHtml(frameInfo.awakeningAsset)}" alt="" width="512" height="512" loading="lazy" decoding="async">
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
      'has-frame-scope-aidti', 'has-frame-khoa-th', 'has-frame-anime-gojo', 'has-frame-anime-itachi', 'has-frame-aidti-bdu'
    );
  }

  if (frameInfo && heroFrameContainer) {
    const frameRenderKey = `${frameInfo.tier || ''}:${frameInfo.frameSvg || ''}:${frameInfo.frameArt || ''}`;
    const frameChanged = heroFrameContainer.dataset.frameRenderKey !== frameRenderKey;
    if (frameChanged) {
      heroFrameContainer.innerHTML = renderAcademicFrameMarkup(frameInfo);
      heroFrameContainer.dataset.frameRenderKey = frameRenderKey;
    }
    if (heroAvatarWrap) {
      heroAvatarWrap.classList.add(`has-frame-${frameInfo.tier}`, `has-frame-scope-${frameInfo.scope}`);
      if (frameInfo.frameFamily) heroAvatarWrap.classList.add(`has-frame-${frameInfo.frameFamily}`);
    }
    if (frameChanged) prepareFrameCinematic(frameInfo);
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
    if (heroFrameContainer && heroFrameContainer.dataset.frameRenderKey) {
      heroFrameContainer.innerHTML = '';
      delete heroFrameContainer.dataset.frameRenderKey;
    }
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
    ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(name)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;">`
    : initial;
  const avatarRenderKey = photoUrl ? `photo:${photoUrl}` : `initial:${initial}`;
  [heroAvatar, composerAvatar, widgetAvatar].filter(Boolean).forEach((element) => {
    if (element.dataset?.avatarRenderKey === avatarRenderKey) return;
    element.innerHTML = avatarContent;
    if (element.dataset) element.dataset.avatarRenderKey = avatarRenderKey;
  });
  updateIdentityPresentationUI();

  const placeholderEl = document.getElementById('cfs-composer-placeholder-text');
  if (placeholderEl) {
    placeholderEl.textContent = (name && name !== 'Sinh viên BDU') ? `${name} ơi, bạn đang nghĩ gì thế?` : 'Bạn đang nghĩ gì? Chia sẻ ngay...';
  }

  // Proactively fetch student image from BDU API if missing
  if (!photoUrl && AppState.token && mssv
      && AppState.confession.profilePhotoRequestedFor !== mssv
      && !AppState.confession.profilePhotoRequest) {
    const idsv = user?.idsv || user?.id_sinh_vien || '';
    AppState.confession.profilePhotoRequestedFor = mssv;
    AppState.confession.profilePhotoRequest = BduApi.getProfile(AppState.token, idsv, mssv).then(profileRes => {
      const pUrl = profileRes?.student_image || profileRes?.data?.[0]?.hinh_anh || profileRes?.data?.hinh_anh || '';
      if (pUrl) {
        let full = pUrl;
        if (!full.startsWith('http') && !full.startsWith('data:')) {
          if (full.startsWith('/9j/') || full.length > 500) {
            full = `data:image/jpeg;base64,${full.replace(/\s+/g, '')}`;
          } else {
            full = (full.startsWith('/') ? 'https://sv.bdu.edu.vn' : 'https://sv.bdu.edu.vn/') + full;
          }
        }
        AppState.bduSchoolPhoto = full;
        if (user && AppState.identityPresentation?.avatar_source !== 'override') user.photoUrl = full;
        try { localStorage.setItem('bdu_user_photo', full); } catch(e) {}
        updateForumUserWidgets();
      }
    }).catch(() => {}).finally(() => {
      AppState.confession.profilePhotoRequest = null;
    });
  }
}

function scheduleConfessionRefresh() {
  if (!document.getElementById('tab-confession')?.classList.contains('active')) return;
  clearTimeout(AppState.confession.refreshTimer);
  AppState.confession.refreshTimer = setTimeout(() => {
    AppState.confession.refreshTimer = null;
    loadConfessions().catch(() => {});
  }, 250);
}

async function loadConfessions({ append = false } = {}) {
  updateForumUserWidgets();
  const container = document.getElementById('confession-feed-stream');
  if (!container) return;

  const requestedFilter = AppState.confession.activeFilter || 'all';
  if (AppState.confession.loadingPromise && AppState.confession.loadingFilter === requestedFilter) {
    return AppState.confession.loadingPromise;
  }

  const requestId = ++AppState.confession.requestId;
  AppState.confession.controller?.abort();
  const controller = new AbortController();
  AppState.confession.controller = controller;
  AppState.confession.loadingFilter = requestedFilter;
  const offset = append && AppState.confession.loadedFilter === requestedFilter
    ? AppState.confession.posts.length : 0;
  if (append) AppState.confession.loadingMore = true;

  if (!append && (!AppState.confession.posts.length || AppState.confession.loadedFilter !== requestedFilter)) {
    container.innerHTML = `
      <div class="loading-spinner-box">
        <div class="spinner"></div>
        <p>Đang tải dòng tin Diễn Đàn & Confession...</p>
      </div>
    `;
  }

  const loadingPromise = (async () => {
    // `forum` gồm bài toàn trường + Viện/Khoa, nhưng không trộn bài nội bộ CLB.
    // Lọc ở server để "Bài của tôi" không bị giới hạn trong trang 20 bài mới nhất.
    const res = await BduApi.getCommunityPosts(AppState.token, {
      scope: 'forum',
      filter: requestedFilter,
      limit: 20,
      offset,
      signal: controller.signal
    });
    if (requestId !== AppState.confession.requestId || requestedFilter !== AppState.confession.activeFilter) return;
    const posts = res.posts || [];
    AppState.confession.posts = append ? [...AppState.confession.posts, ...posts] : posts;
    AppState.confession.total = Number(res.total || AppState.confession.posts.length);
    AppState.confession.loadedFilter = requestedFilter;
    AppState.confession.loadingMore = false;
    renderForumFeed();
  })();
  AppState.confession.loadingPromise = loadingPromise;

  try {
    await loadingPromise;
  } catch (err) {
    if (requestId !== AppState.confession.requestId) return;
    if (err?.name === 'AbortError') return;
    console.error('Lỗi tải forum confessions:', err);
    container.innerHTML = `
      <div class="empty-state-box" style="text-align: center; padding: 30px;">
        <p style="color: var(--color-rose);">${escapeHtml(err.message || 'Không thể tải Diễn Đàn.')}</p>
        <button class="btn btn-secondary btn-sm" onclick="loadConfessions()" style="margin-top: 10px;">Thử lại</button>
      </div>
    `;
  } finally {
    if (AppState.confession.loadingPromise === loadingPromise) {
      AppState.confession.loadingPromise = null;
      AppState.confession.loadingFilter = null;
      AppState.confession.loadingMore = false;
      if (AppState.confession.controller === controller) AppState.confession.controller = null;
    }
  }
}

function captureForumInteractionState(container) {
  const state = new Map();
  container.querySelectorAll('[data-post-id]').forEach((card) => {
    const postId = card.dataset.postId;
    const section = card.querySelector('.forum-comments-wrapper');
    if (!postId || !section) return;
    const input = section.querySelector('.comment-text-input');
    const list = section.querySelector('.comments-feed-list');
    const replyContext = section.querySelector('[data-community-reply-context] span');
    if (section.classList.contains('hidden') && !input?.value) return;
    state.set(postId, {
      open: !section.classList.contains('hidden'),
      value: input?.value || '',
      parentId: input?.dataset.parentId || '',
      replyText: replyContext?.textContent || '',
      commentsHtml: list?.innerHTML || '',
      focused: document.activeElement === input
    });
  });
  return state;
}

function restoreForumInteractionState(container, state) {
  state.forEach((saved, postId) => {
    const card = [...container.querySelectorAll('[data-post-id]')]
      .find((item) => String(item.dataset.postId) === String(postId));
    const section = card?.querySelector('.forum-comments-wrapper');
    if (!section) return;
    const input = section.querySelector('.comment-text-input');
    const list = section.querySelector('.comments-feed-list');
    if (saved.open) {
      section.classList.remove('hidden');
      communityRealtimeSubscribe(`post:${postId}`);
    }
    if (input) {
      input.value = saved.value;
      if (saved.parentId) input.dataset.parentId = saved.parentId;
    }
    if (saved.parentId) {
      const context = ensureCommunityReplyContext(section);
      if (context) {
        context.querySelector('span').textContent = saved.replyText;
        context.classList.remove('hidden');
      }
    }
    if (list && saved.commentsHtml) {
      list.innerHTML = saved.commentsHtml;
      attachCommunityCommentEvents(list, postId);
    }
    if (saved.focused) requestAnimationFrame(() => input?.focus());
  });
}

function renderForumFeed() {
  const container = document.getElementById('confession-feed-stream');
  if (!container) return;
  const interactionState = captureForumInteractionState(container);

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
  restoreForumInteractionState(container, interactionState);
  if (AppState.confession.posts.length < AppState.confession.total) {
    const loadMore = document.createElement('button');
    loadMore.type = 'button';
    loadMore.className = 'btn btn-secondary btn-sm forum-load-more';
    loadMore.dataset.loadMoreConfessions = 'true';
    loadMore.textContent = AppState.confession.loadingMore ? 'Đang tải thêm…' : 'Tải thêm bài viết';
    loadMore.disabled = AppState.confession.loadingMore;
    loadMore.addEventListener('click', () => loadConfessions({ append: true }));
    container.appendChild(loadMore);
  }
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




const featureInitializers = {
  'tab-clans': initClansModule,
  'tab-confession': initConfessionModule
};

export function initialize(tabId) {
  const initializer = featureInitializers[tabId];
  if (!initializer) return false;
  initializer();
  return true;
}

Object.assign(window, {
  checkHasTtcds,
  initClansModule,
  loadClansDirectory,
  renderClansGrid,
  handleJoinClan,
  handleCancelJoinRequest,
  handleLeaveClan,
  handleCreateNewClan,
  openClanChannel,
  switchClanSubtab,
  loadClanRequests,
  renderLockedClanFeed,
  renderLockedClanDocs,
  loadClanPosts,
  renderClanPostCardHtml,
  attachClanPollVoteEvents,
  attachClanPostPinEvents,
  loadClanDocuments,
  openClanDocumentShareModal,
  closeClanDocumentShareModal,
  handleSubmitClanDocument,
  renderClanDocumentCardHtml,
  renderSingleAttachmentHtml,
  renderCommunityPostHtml,
  attachPostCardEvents,
  loadCommentsForPost,
  renderCommunityCommentsTree,
  ensureCommunityReplyContext,
  resetCommunityReplyComposer,
  attachCommunityCommentEvents,
  handleSubmitClanPost,
  loadClanMembers,
  handleSaveClanSettings,
  handleDisbandClan,
  setDeletePostModalLoading,
  closeDeletePostModal,
  requestDeletePostConfirmation,
  formatRelativeTime,
  initConfessionModule,
  openCreateConfessionModal,
  closeCreateConfessionModal,
  syncFbModalAnonUI,
  normalizeFacultyCode,
  isThFaculty,
  hasFullFramePreviewAccess,
  hasAnimeFrameAccess,
  buildScopeFrameConfig,
  buildAnimeSignatureFrameConfig,
  buildAidtiSignatureFrameConfig,
  getAcademicAvatarFrame,
  getAcademicFrameCollection,
  getStudentAcademicUnlockedFrames,
  renderFrameCollectionModal,
  prepareFrameCinematic,
  renderAcademicFrameMarkup,
  updateForumUserWidgets,
  scheduleConfessionRefresh,
  loadConfessions,
  captureForumInteractionState,
  restoreForumInteractionState,
  renderForumFeed,
  renderConfessionCardHtml,
  handleSubmitConfession
});
