(() => {
  let sessionToken = localStorage.getItem('bdu_token') || sessionStorage.getItem('bdu_token');
  const savedUser = localStorage.getItem('bdu_user') || sessionStorage.getItem('bdu_user');
  let currentMssv = null;
  let items = [];
  let selectedAvatarFile = null;
  let selectedAvatarObjectUrl = null;

  const $ = (selector) => document.querySelector(selector);
  const alertBox = $('#admin-alert');

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  const showAlert = (message, isError = false) => {
    if (!alertBox) return;
    alertBox.textContent = message || '';
    alertBox.classList.toggle('is-error', isError);
    if (!message) {
      alertBox.style.display = 'none';
    } else {
      alertBox.style.display = 'block';
    }
  };

  const setAuthenticatedUi = (authenticated) => {
    $('#admin-login-card')?.classList.toggle('is-authenticated', authenticated);
    document.querySelectorAll('.admin-protected').forEach((element) => {
      element.classList.toggle('is-locked', !authenticated);
    });
    $('#admin-logout-btn')?.classList.toggle('is-hidden', !authenticated);
  };

  const logout = (message = '', isError = true) => {
    sessionToken = null;
    currentMssv = null;
    localStorage.removeItem('bdu_token');
    localStorage.removeItem('bdu_user');
    sessionStorage.removeItem('bdu_token');
    sessionStorage.removeItem('bdu_user');

    setAuthenticatedUi(false);
    $('#admin-identity').textContent = 'Chưa đăng nhập';
    $('#student-status-panel')?.classList.add('is-hidden');
    $('#student-actions-panel')?.classList.add('is-hidden');
    if (message) {
      showAlert(message, isError);
    }
  };

  if (savedUser) {
    try {
      const user = JSON.parse(savedUser);
      $('#admin-identity').textContent = `${user.name || 'Quản trị viên'} · ${user.mssv || ''}`;
    } catch {}
  }

  const renderCatalog = () => {
    const list = $('#catalog-list');
    if (list) {
      $('#catalog-count').textContent = String(items.length);
      list.innerHTML = items.map((item) => `
        <div class="catalog-row ${item.is_active ? '' : 'is-inactive'}">
          <div class="catalog-copy">
            <div class="catalog-title-row">
              <strong>${escapeHtml(item.label)}</strong>
              <span class="rarity-badge rarity-${escapeHtml(item.rarity || 'common')}">${escapeHtml(item.rarity || 'thường')}</span>
              ${item.is_active ? '' : '<span class="status-inactive-badge">Đã tắt</span>'}
            </div>
            <small>${escapeHtml(item.id)} · ${escapeHtml(item.description || 'Chưa có mô tả')}</small>
          </div>
          <div class="catalog-actions-cell">
            <span class="catalog-type catalog-type-${escapeHtml(item.item_type)}">${escapeHtml(item.item_type)}</span>
            <button class="btn-catalog-edit" type="button" data-edit-item="${escapeHtml(item.id)}">Sửa</button>
            <button class="btn-catalog-delete ${item.is_active ? '' : 'is-reactivate'}" type="button" data-delete-item="${escapeHtml(item.id)}" title="${item.is_active ? 'Tắt hoặc xóa item' : 'Kích hoạt lại'}">
              ${item.is_active ? 'Tắt' : 'Bật'}
            </button>
          </div>
        </div>
      `).join('');

      list.querySelectorAll('[data-edit-item]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = items.find((i) => i.id === btn.dataset.editItem);
          if (item) openItemEditor('edit', item);
        });
      });

      list.querySelectorAll('[data-delete-item]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const item = items.find((i) => i.id === btn.dataset.deleteItem);
          if (!item) return;
          if (item.is_active) {
            if (!window.confirm(`Bạn có chắc muốn tắt item "${item.label}" (${item.id})? (Sinh viên đang sở hữu sẽ không bị mất dữ liệu).`)) return;
            try {
              await BduApi.deleteAdminIdentityItem(sessionToken, item.id, 'Tắt item từ Admin Tool');
              showAlert(`Đã tắt item "${item.label}".`);
              await refreshCatalog();
              await loadAudit();
            } catch (err) {
              showAlert(err.message || 'Không thể tắt item.', true);
            }
          } else {
            try {
              await BduApi.updateAdminIdentityItem(sessionToken, item.id, { isActive: true });
              showAlert(`Đã kích hoạt lại item "${item.label}".`);
              await refreshCatalog();
              await loadAudit();
            } catch (err) {
              showAlert(err.message || 'Không thể kích hoạt lại item.', true);
            }
          }
        });
      });
    }

    // Phân loại danh hiệu và khung vào 2 form cấp quyền riêng biệt (chỉ lấy item đang active)
    const activeItems = items.filter((item) => item.is_active !== false);
    const titleSelect = $('#grant-title-item');
    if (titleSelect) {
      const titleItems = activeItems.filter((item) => item.item_type === 'title');
      titleSelect.innerHTML = '<option value="">-- Chọn danh hiệu cần cấp --</option>' + titleItems.map((item) =>
        `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)} (${escapeHtml(item.rarity || 'thường')})</option>`
      ).join('');
    }

    const frameSelect = $('#grant-frame-item');
    if (frameSelect) {
      const showRanking = Boolean($('#toggle-ranking-frames')?.checked);
      const isRankingFrame = (id) => /^frame:(truong|vien|khoa|lop)-/.test(id);
      const manualFrames = activeItems.filter((item) => item.item_type === 'frame' && !isRankingFrame(item.id));
      const rankingFrames = activeItems.filter((item) => item.item_type === 'frame' && isRankingFrame(item.id));

      let optionsHtml = '<option value="">-- Chọn khung cần cấp --</option>';
      if (manualFrames.length) {
        optionsHtml += `<optgroup label="Khung Đặc Biệt / Thủ công (${manualFrames.length})">` +
          manualFrames.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)} (${escapeHtml(item.rarity || 'thường')})</option>`).join('') +
          `</optgroup>`;
      }
      if (showRanking && rankingFrames.length) {
        optionsHtml += `<optgroup label="Khung Học Thuật / Ranking (${rankingFrames.length})">` +
          rankingFrames.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)} (${escapeHtml(item.rarity || 'thường')})</option>`).join('') +
          `</optgroup>`;
      }
      frameSelect.innerHTML = optionsHtml;
    }
  };

  const refreshCatalog = async () => {
    items = await BduApi.getAdminIdentityItems(sessionToken, { includeInactive: true });
    renderCatalog();
  };

  const openItemEditor = (mode = 'create', item = null) => {
    const card = $('#item-editor-card');
    const title = $('#item-editor-title');
    const modeInput = $('#item-editor-mode');
    const idInput = $('#item-editor-id');
    const typeInput = $('#item-editor-type');
    const labelInput = $('#item-editor-label');
    const rarityInput = $('#item-editor-rarity');
    const assetInput = $('#item-editor-asset');
    const policyInput = $('#item-editor-policy');
    const descInput = $('#item-editor-desc');
    const manualInput = $('#item-editor-manual');

    if (!card) return;
    modeInput.value = mode;

    if (mode === 'edit' && item) {
      title.textContent = `Chỉnh sửa Item: ${item.id}`;
      idInput.value = item.id;
      idInput.disabled = true;
      typeInput.value = item.item_type;
      typeInput.disabled = true;
      labelInput.value = item.label || '';
      rarityInput.value = item.rarity || 'common';
      assetInput.value = item.asset_key || '';
      policyInput.value = item.display_policy || 'optional';
      descInput.value = item.description || '';
      manualInput.checked = item.metadata?.manual_grantable !== false;
    } else {
      title.textContent = 'Tạo Khung / Danh hiệu mới';
      idInput.disabled = false;
      idInput.value = 'frame:';
      typeInput.disabled = false;
      typeInput.value = 'frame';
      labelInput.value = '';
      rarityInput.value = 'legendary';
      assetInput.value = '';
      policyInput.value = 'optional';
      descInput.value = '';
      manualInput.checked = true;
    }

    card.classList.remove('is-hidden');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const closeItemEditor = () => {
    $('#item-editor-card')?.classList.add('is-hidden');
  };

  const renderAvatarPreview = (record, previewUrl = null) => {
    const preview = $('#avatar-preview');
    const circlePreview = $('#status-avatar-circle');
    const source = $('#avatar-preview-source');
    const resolvedUrl = previewUrl || record?.resolved_url || '';
    const name = record?.name || record?.mssv || currentMssv || 'Sinh viên';

    const avatarHtml = resolvedUrl
      ? `<img src="${escapeHtml(resolvedUrl)}" alt="Ảnh của ${escapeHtml(name)}">`
      : escapeHtml((name.charAt(0) || 'S').toUpperCase());

    if (preview) preview.innerHTML = avatarHtml;
    if (circlePreview) circlePreview.innerHTML = avatarHtml;

    if ($('#avatar-preview-name')) $('#avatar-preview-name').textContent = name;
    if ($('#status-student-name')) $('#status-student-name').textContent = name;

    const sourceVal = previewUrl ? 'preview' : (record?.source || 'initials');
    let sourceText = 'Chưa có ảnh (Initials)';
    let badgeClass = '';
    if (sourceVal === 'override') {
      sourceText = 'Ảnh VPS';
      badgeClass = 'is-override';
    } else if (sourceVal === 'bdu') {
      sourceText = 'Ảnh API BDU';
      badgeClass = 'is-bdu';
    } else if (sourceVal === 'preview') {
      sourceText = 'Ảnh chờ tải lên';
    }

    if (source) {
      source.textContent = sourceText;
      source.className = `avatar-source-badge ${badgeClass}`;
    }
    if ($('#stat-avatar-source-label')) {
      $('#stat-avatar-source-label').textContent = sourceText;
    }

    if ($('#avatar-preview-url')) {
      $('#avatar-preview-url').textContent = previewUrl
        ? selectedAvatarFile?.name || 'Ảnh vừa chọn từ máy'
        : (record?.override_url || record?.bdu_url || 'Chưa cài đặt URL ảnh; đang hiển thị chữ cái đầu tên.');
    }

    const hasOverride = !previewUrl && record?.source === 'override';
    $('#avatar-override-actions')?.classList.toggle('is-hidden', !hasOverride);
    const removeBtn = $('#avatar-remove');
    if (removeBtn) removeBtn.disabled = !hasOverride;
  };

  const checkStudentStatus = async (targetMssv) => {
    const cleanMssv = String(targetMssv || '').trim().toUpperCase();
    if (!cleanMssv) {
      showAlert('Vui lòng nhập MSSV sinh viên.', true);
      return;
    }

    const btn = $('#btn-check-status');
    if (btn) btn.disabled = true;
    showAlert(`Đang tải trạng thái của sinh viên ${cleanMssv}…`);

    try {
      const [grants, avatarRecord] = await Promise.all([
        BduApi.getAdminIdentityGrants(sessionToken, cleanMssv).catch((err) => {
          console.warn('Lỗi tải grants:', err);
          return [];
        }),
        BduApi.getAdminAvatar(sessionToken, cleanMssv).catch((err) => {
          console.warn('Lỗi tải avatar:', err);
          return { mssv: cleanMssv, name: cleanMssv, source: 'initials' };
        })
      ]);

      currentMssv = cleanMssv;
      $('#avatar-mssv').value = cleanMssv;
      $('#status-mssv-badge').textContent = `MSSV: ${cleanMssv}`;
      $('#actions-target-label').textContent = `Áp dụng cho MSSV: ${cleanMssv}`;

      // 1. Phân loại và hiển thị Danh hiệu đang sở hữu
      const activeTitles = grants.filter((g) => g.item_type === 'title' && !g.revoked_at);
      $('#current-titles-count').textContent = String(activeTitles.length);
      $('#stat-titles-count').textContent = String(activeTitles.length);
      const titlesList = $('#current-titles-list');
      if (titlesList) {
        titlesList.innerHTML = activeTitles.length ? activeTitles.map((g) => `
          <div class="status-item-row">
            <div class="status-item-copy">
              <div class="status-item-header">
                <strong>${escapeHtml(g.label || g.item_id)}</strong>
                <span class="rarity-badge rarity-${escapeHtml(g.rarity || 'common')}">${escapeHtml(g.rarity || 'thường')}</span>
              </div>
              <small>${escapeHtml(g.item_id)}${g.reason ? ` · Lý do: ${escapeHtml(g.reason)}` : ''}</small>
            </div>
            <button class="btn-revoke" type="button" data-revoke-grant="${g.id}">Thu hồi</button>
          </div>
        `).join('') : '<p class="admin-empty">Sinh viên chưa sở hữu danh hiệu nào.</p>';
      }

      // 2. Phân loại và hiển thị Khung đang sở hữu
      const activeFrames = grants.filter((g) => g.item_type === 'frame' && !g.revoked_at);
      $('#current-frames-count').textContent = String(activeFrames.length);
      $('#stat-frames-count').textContent = String(activeFrames.length);
      const framesList = $('#current-frames-list');
      if (framesList) {
        framesList.innerHTML = activeFrames.length ? activeFrames.map((g) => `
          <div class="status-item-row">
            <div class="status-item-copy">
              <div class="status-item-header">
                <strong>${escapeHtml(g.label || g.item_id)}</strong>
                <span class="rarity-badge rarity-${escapeHtml(g.rarity || 'common')}">${escapeHtml(g.rarity || 'thường')}</span>
              </div>
              <small>${escapeHtml(g.item_id)}${g.reason ? ` · Lý do: ${escapeHtml(g.reason)}` : ''}</small>
            </div>
            <button class="btn-revoke" type="button" data-revoke-grant="${g.id}">Thu hồi</button>
          </div>
        `).join('') : '<p class="admin-empty">Sinh viên chưa sở hữu khung nào.</p>';
      }

      // Gắn sự kiện thu hồi
      document.querySelectorAll('[data-revoke-grant]').forEach((button) => {
        button.addEventListener('click', async () => {
          const reason = window.prompt('Lý do thu hồi quyền:', 'Điều chỉnh quyền hiển thị từ Admin');
          if (reason === null) return;
          try {
            await BduApi.revokeAdminIdentityGrant(sessionToken, button.dataset.revokeGrant, reason);
            showAlert('Đã thu hồi quyền hiển thị thành công.');
            await Promise.all([checkStudentStatus(currentMssv), loadAudit()]);
          } catch (error) {
            showAlert(error.message || 'Không thể thu hồi quyền.', true);
          }
        });
      });

      // 3. Hiển thị trạng thái avatar hiện tại
      renderAvatarPreview(avatarRecord);

      // Hiển thị 2 section Bước 2 và Bước 3
      $('#student-status-panel')?.classList.remove('is-hidden');
      $('#student-actions-panel')?.classList.remove('is-hidden');

      showAlert(`Đã nạp đầy đủ thông tin của sinh viên ${cleanMssv}.`);
    } catch (error) {
      showAlert(error.message || 'Không thể tải thông tin sinh viên.', true);
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  const loadAvatarList = async () => {
    const list = $('#avatar-list');
    if (!list) return;
    try {
      const rows = await BduApi.getAdminAvatars(sessionToken, { limit: 100 });
      $('#avatar-count').textContent = String(rows.length);
      list.innerHTML = rows.length ? rows.map((row) => `
        <div class="avatar-list-row">
          <div class="avatar-list-thumb"><img src="${escapeHtml(row.override_url)}" alt=""></div>
          <div class="avatar-list-copy">
            <strong>${escapeHtml(row.mssv)} · ${escapeHtml(row.name || '')}</strong>
            <small>${escapeHtml(row.override_url || '')}</small>
          </div>
          <button type="button" data-avatar-select="${escapeHtml(row.mssv)}">Xem trạng thái</button>
        </div>
      `).join('') : '<p class="admin-empty">Chưa có ảnh override trên VPS.</p>';

      list.querySelectorAll('[data-avatar-select]').forEach((button) => {
        button.addEventListener('click', async () => {
          const mssv = button.dataset.avatarSelect;
          $('#target-mssv').value = mssv;
          await checkStudentStatus(mssv);
          window.scrollTo({ top: $('#student-status-panel')?.offsetTop - 80 || 0, behavior: 'smooth' });
        });
      });
    } catch (error) {
      list.innerHTML = `<p class="admin-empty">${escapeHtml(error.message || 'Không thể tải avatar.')}</p>`;
    }
  };

  const loadAudit = async () => {
    try {
      const rows = await BduApi.getAdminIdentityAudit(sessionToken, { limit: 100 });
      const body = $('#audit-body');
      if (!body) return;
      body.innerHTML = rows.length ? rows.map((row) => `
        <tr>
          <td>${escapeHtml(new Date(row.created_at).toLocaleString('vi-VN'))}</td>
          <td><strong>${escapeHtml(row.mssv)}</strong></td>
          <td>${escapeHtml(row.item_id)}</td>
          <td><span class="audit-action-tag audit-action-${escapeHtml(row.action)}">${escapeHtml(row.action)}</span></td>
          <td>${escapeHtml(row.actor_mssv || '—')}</td>
          <td>${escapeHtml(row.reason || '')}</td>
        </tr>
      `).join('') : '<tr><td colspan="6" class="admin-empty">Chưa có audit log nào.</td></tr>';
    } catch (error) {
      $('#audit-body').innerHTML = `<tr><td colspan="6" class="admin-empty">${escapeHtml(error.message || 'Không thể tải audit.')}</td></tr>`;
    }
  };

  // Xác thực quyền quản trị của session hiện tại
  const verifyAndLoad = async () => {
    if (!sessionToken) {
      setAuthenticatedUi(false);
      $('#admin-identity').textContent = 'Chưa đăng nhập';
      return;
    }

    try {
      // Thử gọi API lấy danh mục quyền quản trị để kiểm tra token & role (kèm cả item đã tắt)
      items = await BduApi.getAdminIdentityItems(sessionToken, { includeInactive: true });
      setAuthenticatedUi(true);
      renderCatalog();
      await Promise.all([loadAudit(), loadAvatarList()]);
      showAlert('Kết nối thành công với quyền quản trị viên.');
    } catch (error) {
      console.warn('Xác thực quyền quản trị thất bại:', error.message);
      // "Nếu không phải user được cấp quyền tự động log out"
      logout('Tài khoản của bạn không có quyền quản trị. Hệ thống đã tự động đăng xuất.', true);
    }
  };

  // 1. Submit Form Tra cứu sinh viên
  $('#student-search-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const mssv = $('#target-mssv')?.value?.trim();
    await checkStudentStatus(mssv);
  });

  // 2. Submit Form Cấp Danh Hiệu
  $('#grant-title-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentMssv) {
      showAlert('Vui lòng tra cứu MSSV sinh viên trước khi cấp danh hiệu.', true);
      return;
    }
    const itemId = $('#grant-title-item')?.value;
    const reason = $('#grant-title-reason')?.value?.trim() || '';
    if (!itemId) {
      showAlert('Vui lòng chọn danh hiệu cần cấp.', true);
      return;
    }

    try {
      await BduApi.createAdminIdentityGrant(sessionToken, {
        mssv: currentMssv,
        itemId,
        reason
      });
      showAlert(`Đã cấp danh hiệu thành công cho sinh viên ${currentMssv}.`);
      $('#grant-title-reason').value = '';
      await Promise.all([checkStudentStatus(currentMssv), loadAudit()]);
    } catch (error) {
      showAlert(error.message || 'Không thể cấp danh hiệu.', true);
    }
  });

  // 3. Submit Form Cấp Khung
  $('#grant-frame-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentMssv) {
      showAlert('Vui lòng tra cứu MSSV sinh viên trước khi cấp khung.', true);
      return;
    }
    const itemId = $('#grant-frame-item')?.value;
    const reason = $('#grant-frame-reason')?.value?.trim() || '';
    if (!itemId) {
      showAlert('Vui lòng chọn khung avatar cần cấp.', true);
      return;
    }

    try {
      await BduApi.createAdminIdentityGrant(sessionToken, {
        mssv: currentMssv,
        itemId,
        reason
      });
      showAlert(`Đã cấp khung avatar thành công cho sinh viên ${currentMssv}.`);
      $('#grant-frame-reason').value = '';
      await Promise.all([checkStudentStatus(currentMssv), loadAudit()]);
    } catch (error) {
      showAlert(error.message || 'Không thể cấp khung.', true);
    }
  });

  // 4. File input & Dropzone cho Avatar
  const avatarFileInput = $('#avatar-file');
  const avatarStatusBox = $('#avatar-file-selected-status');
  const avatarFileName = $('#avatar-file-name');

  const onAvatarFileSelected = (file) => {
    if (!file) return;
    selectedAvatarFile = file;
    if (selectedAvatarObjectUrl) URL.revokeObjectURL(selectedAvatarObjectUrl);
    selectedAvatarObjectUrl = URL.createObjectURL(file);
    renderAvatarPreview(null, selectedAvatarObjectUrl);

    if (avatarStatusBox && avatarFileName) {
      avatarFileName.textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
      avatarStatusBox.classList.remove('is-hidden');
    }
  };

  avatarFileInput?.addEventListener('change', () => {
    onAvatarFileSelected(avatarFileInput.files?.[0]);
  });

  const dropzone = $('.avatar-dropzone');
  ['dragenter', 'dragover'].forEach((type) => dropzone?.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  }));
  ['dragleave', 'drop'].forEach((type) => dropzone?.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
  }));
  dropzone?.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) onAvatarFileSelected(file);
  });

  // 5. Submit Form Cập nhật Avatar
  $('#avatar-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentMssv) {
      showAlert('Vui lòng tra cứu MSSV sinh viên trước khi cập nhật ảnh.', true);
      return;
    }
    if (!selectedAvatarFile) {
      showAlert('Vui lòng chọn file ảnh JPG, PNG hoặc WebP cần tải lên.', true);
      return;
    }

    const button = $('#avatar-upload');
    button.disabled = true;
    showAlert(`Đang tải ảnh đại diện cho sinh viên ${currentMssv}…`);

    try {
      const record = await BduApi.uploadAdminAvatar(sessionToken, currentMssv, selectedAvatarFile);
      renderAvatarPreview(record);
      showAlert(`Đã cập nhật ảnh đại diện thành công cho sinh viên ${currentMssv}.`);
      selectedAvatarFile = null;
      avatarFileInput.value = '';
      avatarStatusBox?.classList.add('is-hidden');
      if (selectedAvatarObjectUrl) URL.revokeObjectURL(selectedAvatarObjectUrl);
      selectedAvatarObjectUrl = null;
      await Promise.all([loadAvatarList(), loadAudit()]);
    } catch (error) {
      showAlert(error.message || 'Không thể cập nhật ảnh đại diện.', true);
    } finally {
      button.disabled = false;
    }
  });

  // 6. Gỡ ảnh VPS (Dùng lại ảnh BDU)
  $('#avatar-remove')?.addEventListener('click', async () => {
    if (!currentMssv) return;
    if (!window.confirm(`Gỡ ảnh VPS của sinh viên ${currentMssv} và dùng lại ảnh từ cổng BDU?`)) return;

    try {
      const record = await BduApi.deleteAdminAvatar(sessionToken, currentMssv);
      renderAvatarPreview(record);
      showAlert(`Đã gỡ ảnh VPS của sinh viên ${currentMssv} và chuyển về ảnh BDU.`);
      await Promise.all([loadAvatarList(), loadAudit()]);
    } catch (error) {
      showAlert(error.message || 'Không thể gỡ ảnh đại diện.', true);
    }
  });

  // 7. Đăng nhập Admin form
  $('#admin-login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#admin-login-submit');
    button.disabled = true;
    showAlert('Đang xác thực tài khoản quản trị…');

    try {
      const result = await BduApi.login(
        $('#admin-login-username').value.trim(),
        $('#admin-login-password').value
      );

      // Kiểm tra ngay xem tài khoản này có quyền quản trị không
      try {
        items = await BduApi.getAdminIdentityItems(result.token);
      } catch (roleErr) {
        // "Nếu không phải user được cấp quyền tự động log out"
        logout('Tài khoản này không có quyền quản trị. Đã tự động đăng xuất.', true);
        return;
      }

      sessionToken = result.token;
      const user = { name: result.name, mssv: result.mssv, email: result.email, roles: result.roles };
      const remember = $('#admin-login-remember').checked;
      const storage = remember ? localStorage : sessionStorage;
      const otherStorage = remember ? sessionStorage : localStorage;
      storage.setItem('bdu_token', result.token);
      storage.setItem('bdu_user', JSON.stringify(user));
      otherStorage.removeItem('bdu_token');
      otherStorage.removeItem('bdu_user');

      $('#admin-login-password').value = '';
      $('#admin-identity').textContent = `${result.name || 'Quản trị viên'} · ${result.mssv || ''}`;
      setAuthenticatedUi(true);
      renderCatalog();
      await Promise.all([loadAudit(), loadAvatarList()]);
      showAlert('Đăng nhập thành công với quyền quản trị viên.');
    } catch (error) {
      showAlert(error.message || 'Đăng nhập không thành công. Vui lòng kiểm tra lại tài khoản và mật khẩu.', true);
      setAuthenticatedUi(false);
    } finally {
      button.disabled = false;
    }
  });

  // Nút hành động trên Header
  $('#admin-logout-btn')?.addEventListener('click', () => {
    if (window.confirm('Bạn có chắc chắn muốn đăng xuất khỏi trang Quản trị Admin?')) {
      logout('Đã đăng xuất tài khoản quản trị thành công.', false);
    }
  });

  $('#admin-refresh')?.addEventListener('click', async () => {
    await verifyAndLoad();
    if (currentMssv) {
      await checkStudentStatus(currentMssv);
    }
  });

  $('#avatar-refresh')?.addEventListener('click', loadAvatarList);
  $('#toggle-ranking-frames')?.addEventListener('change', renderCatalog);

  // 8. Quản lý Item Editor (Thêm mới, Chỉnh sửa, Đóng form)
  $('#btn-open-create-item')?.addEventListener('click', () => openItemEditor('create'));
  $('#btn-close-item-editor')?.addEventListener('click', closeItemEditor);
  $('#btn-cancel-item-editor')?.addEventListener('click', closeItemEditor);

  $('#item-editor-type')?.addEventListener('change', (e) => {
    const idInput = $('#item-editor-id');
    if ($('#item-editor-mode')?.value === 'create' && idInput) {
      const currentSuffix = idInput.value.replace(/^(frame|title|capability):/, '');
      idInput.value = `${e.target.value}:${currentSuffix || ''}`;
    }
  });

  $('#item-editor-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = $('#item-editor-mode')?.value;
    const itemId = $('#item-editor-id')?.value.trim();
    const itemType = $('#item-editor-type')?.value;
    const label = $('#item-editor-label')?.value.trim();
    const rarity = $('#item-editor-rarity')?.value;
    const assetKey = $('#item-editor-asset')?.value.trim() || null;
    const displayPolicy = $('#item-editor-policy')?.value;
    const description = $('#item-editor-desc')?.value.trim();
    const manualGrantable = Boolean($('#item-editor-manual')?.checked);

    const btn = $('#btn-submit-item-editor');
    btn.disabled = true;
    showAlert('Đang lưu thông tin item…');

    try {
      if (mode === 'create') {
        await BduApi.createAdminIdentityItem(sessionToken, {
          id: itemId,
          itemType,
          label,
          rarity,
          assetKey,
          displayPolicy,
          description,
          metadata: { manual_grantable: manualGrantable }
        });
        showAlert(`Đã tạo thành công item "${label}" (${itemId}).`);
      } else {
        await BduApi.updateAdminIdentityItem(sessionToken, itemId, {
          label,
          rarity,
          assetKey,
          displayPolicy,
          description,
          metadata: { manual_grantable: manualGrantable }
        });
        showAlert(`Đã cập nhật thành công item "${label}".`);
      }
      closeItemEditor();
      await refreshCatalog();
      await loadAudit();
    } catch (err) {
      showAlert(err.message || 'Không thể lưu item.', true);
    } finally {
      btn.disabled = false;
    }
  });

  // Khởi động trang: kiểm tra quyền và tải dữ liệu
  verifyAndLoad();
})();
