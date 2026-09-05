/** Lazy dashboard feature bundle. Loaded only when a heavy view is opened. */
const runtime = window.BDUAppRuntime || {};
const { AppState, BduApi, ensureFeatureInitialized, bootApplication, initTheme, ensureChartJs, updateThemeIcons, showToast, escapeHtml, renderIdentityTitleBadges, renderIdentityAvatar, initTitleCustomizer, openTitleCustomizer, closeTitleCustomizer, renderTitleCustomizerOptions, formatAchievementUnlockDate, formatAchievementEvidence, handleTitleSelectionChange, updateTitleSelectionCount, saveTitleCustomizer, initIdentityAdmin, updateIdentityPresentationUI, getResolvedAvatarUrl, syncAllCurrentUserAvatars, applyResolvedAvatarToCurrentUser, applyCurrentUserPresentationToFeeds, initLoginCharacters, initAuth, handleLogout, connectCommunityRealtime, communityRealtimeSubscribe, handleCommunityRealtimeMessage, getTokenExpTime, checkTokenExpiration, setButtonLoading, switchToDashboard, getInitials, initNavigation, loadAllDashboardData, flushCommunityRealtime, loadScheduleData, loadLearningData, loadAcademicRanking, renderAcademicRanking, initLeaderboard, updateLeaderboardSegments, formatLeaderboardValue, formatOverallGpa, formatOverallCredits, updateStickyCurrentRankDetails, loadAcademicLeaderboard, renderAcademicLeaderboard, updateMiniHallOfFame, renderStudentOverview, calculateRank, formatScore, getGradeLetterClass, renderCharts, populateSemesterDropdown, initGradeFilters, renderGradeTable, exportGradesToCSV, renderProfile, initScheduleTab, renderSchedule } = runtime;

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

  const documentTypeSelect = document.getElementById('wf-document-type');
  const courseDefaults = {};
  const syncDocumentType = () => {
    const graduation = documentTypeSelect?.value === 'do_an_tot_nghiep';
    const title = document.getElementById('wf-doc-title');
    title.value = graduation ? 'ĐỒ ÁN TỐT NGHIỆP' : (courseDefaults.title || 'TIỂU LUẬN MÔN HỌC');
    title.readOnly = graduation;
    for (const name of ['cover', 'comments']) {
      const checkbox = document.getElementById(`wf-include-${name}`);
      checkbox.checked = graduation ? true : (courseDefaults[name] ?? true);
      checkbox.disabled = graduation;
    }
    document.getElementById('wf-cover-label').textContent = graduation
      ? 'Hai trang bìa: bìa chính và bìa phụ; chỉ thêm bìa còn thiếu.'
      : 'Trang bìa: Khung viền chuẩn BDU, đề tài, GVHD, SVTH, Lớp, MSSV';
    document.getElementById('wf-comments-label').textContent = graduation
      ? 'Hai trang nhận xét: giảng viên hướng dẫn và giảng viên phản biện, có chỗ ký tên.'
      : 'Nhận xét giảng viên: Trang có vùng trống để giảng viên ghi nhận xét';
    document.getElementById('wf-document-type-hint').textContent = graduation
      ? 'Chuẩn hóa đầu đề cương; giữ nguyên khung nội dung và ký duyệt. Bổ sung hai trang nhận xét theo mẫu đồ án.'
      : 'Định dạng tiểu luận theo cấu hình hiện tại.';
    document.getElementById('wf-document-mode').querySelector('[value="binding_package"]').textContent = graduation
      ? 'Bản phục vụ đóng quyển (giữ hai trang bìa)'
      : 'Bản phục vụ đóng quyển (thêm trang trắng và bản sao bìa)';
    document.getElementById('wf-binding-hint').textContent = graduation
      ? 'Đồ án có hai trang bìa ở cả hai chế độ xuất; không thêm trang trắng hoặc bìa trùng.'
      : 'Khi chọn bản đóng quyển: in một mặt trên A4, dùng bìa cứng xanh dương và tờ bìa sau cùng màu.';
  };
  documentTypeSelect?.addEventListener('change', () => {
    if (documentTypeSelect.value === 'do_an_tot_nghiep') {
      courseDefaults.title = document.getElementById('wf-doc-title').value;
      for (const name of ['cover', 'comments']) courseDefaults[name] = document.getElementById(`wf-include-${name}`).checked;
    }
    syncDocumentType();
  });

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
      const institution = document.getElementById('wf-institution')?.value.trim() || '';
      const faculty = document.getElementById('wf-faculty')?.value.trim() || '';
      const course = document.getElementById('wf-course')?.value.trim() || '';
      const location = document.getElementById('wf-location')?.value.trim() || '';
      const documentMode = document.getElementById('wf-document-mode')?.value || 'digital_document';
      const month = document.getElementById('wf-month')?.value.trim() || '';
      const year = document.getElementById('wf-year')?.value.trim() || '';

      const frontSections = [];
      if (document.getElementById('wf-include-cover')?.checked) frontSections.push('cover');
      if (document.getElementById('wf-include-comments')?.checked) frontSections.push('comments');
      if (document.getElementById('wf-include-thanks')?.checked) frontSections.push('thanks');
      const frontMatter = frontSections.join(',');

      const onlyExistingCaptions = document.getElementById('wf-only-existing-captions')?.checked ? 'true' : 'false';
      const skipProposal = document.getElementById('wf-skip-proposal')?.checked ? 'true' : 'false';

      const formData = new FormData();
      formData.append('document', AppState.selectedFile);
      formData.append('instructor', instructor);
      formData.append('student', student);
      if (studentId) formData.append('studentId', studentId);
      if (className) formData.append('className', className);
      if (topic) formData.append('topic', topic);
      if (docTitle) formData.append('documentTitle', docTitle);
      if (institution) formData.append('institution', institution);
      if (faculty) formData.append('faculty', faculty);
      if (course) formData.append('course', course);
      if (location) formData.append('location', location);
      formData.append('documentMode', documentMode);
      formData.append('documentType', documentTypeSelect?.value || 'tieu_luan');
      if (month) formData.append('month', month);
      if (year) formData.append('year', year);
      formData.append('frontMatter', frontMatter);
      formData.append('onlyExistingCaptions', onlyExistingCaptions);
      formData.append('skipProposal', skipProposal);

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
          const normalization = res.report?.outputNormalization || {};
          const compliance = normalization.compliance || {};
          const structure = res.report?.structure;
          const checks = [
            ['Khổ giấy A4 hướng dọc', compliance.a4Portrait],
            ['Lề trên 2cm, dưới 2cm, trái 3cm, phải 2cm', compliance.margins],
            ['Body Before 6pt, After 0pt, line spacing 1.2', compliance.bodySpacing],
            ['Bảo toàn cấu trúc danh sách', compliance.listsPreserved],
            ['Đã gỡ hyperlink trong Tài liệu tham khảo', compliance.referenceHyperlinksRemoved],
            ['Không tự đổi dấu ngoặc kép', compliance.smartQuotesPreserved],
            ['Đã chuẩn hóa en dash/em dash thành dấu -', compliance.longDashesNormalized],
            ['Bảng nằm trong chiều rộng trang A4 dọc', compliance.wideTablesFitPortrait]
          ];
          if (structure) checks.push(
            ['Số chương thực được bảo toàn', compliance.headingStructure],
            ['Thụt lề Heading 3/4 theo mẫu đã chọn', compliance.headingIndentation]
          );
          const checkLines = checks.map(([label, passed]) => (
            `<div class="diag-line ${passed ? 'diag-pass' : 'diag-warn'}">${passed ? 'Đạt' : 'Cảnh báo'}: ${label}</div>`
          )).join('');
          const changeLines = [
            normalization.enDashesReplaced ? `Đã sửa ${normalization.enDashesReplaced} dấu gạch dài` : '',
            normalization.hyperlinksRemoved ? `Đã gỡ ${normalization.hyperlinksRemoved} hyperlink ở Tài liệu tham khảo` : '',
            normalization.frontMatterReordered ? 'Đã sắp lại Lời cảm ơn trước Mục lục' : '',
            normalization.headersNormalized ? `Đã chuẩn hóa ${normalization.headersNormalized} header theo section` : ''
          ].filter(Boolean).map(text => `<div class="diag-line diag-info">Đã sửa: ${text}</div>`).join('');
          const structureLines = structure ? [
            `Nhận diện ${Number(structure.chapterCount)} chương thực; ${Number(structure.protectedIndexParagraphs)} đoạn mục lục được bảo vệ.`,
            structure.hasProposal ? 'Đề cương: giữ nguyên nội dung và định dạng nguồn; không tính vào số chương.' : '',
            structure.hasIntroduction ? 'Mở đầu được xử lý riêng, không đánh số chương.' : '',
            structure.hasParts ? 'Giữ tiêu đề PHẦN NỘI DUNG; các chương bên trong dùng hệ Heading 1–4.' : '',
            structure.chapterSummariesPreserved ? `Giữ ${Number(structure.chapterSummariesPreserved)} đoạn giới thiệu chương là nội dung thường.` : '',
            'Mức thụt lề theo ảnh mẫu là quy ước trình bày đã chọn.'
          ].filter(Boolean).map(text => `<div class="diag-line diag-info">${text}</div>`).join('') : '';
          diagContainer.innerHTML = `${structureLines}${checkLines}${changeLines}<div class="diag-line diag-info">File size: ${(res.fileSize / 1024).toFixed(1)} KB</div>`;
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


const featureInitializers = {
  'tab-wordfmt': initWordFmtTool,
  'tab-survey': initSurveyBot,
  'tab-english': initEnglishExerciseBot
};

export function initialize(tabId) {
  const initializer = featureInitializers[tabId];
  if (!initializer) return false;
  initializer();
  return true;
}

Object.assign(window, {
  initWordFmtTool,
  initSurveyBot,
  addTerminalLog,
  initEnglishExerciseBot,
  connectEnglishLogStream,
  renderEnglishActivities,
  updateEnglishStartAvailability,
  setEnglishRunning,
  setEnglishConnectionState,
  appendEnglishLog,
  loadEnglishAnswers
});
