/**
 * BDU Grade Viewer - Main Frontend Logic
 */

// Application State
const state = {
  user: null,
  token: null,
  semesters: [],
  selectedSemester: 'ALL',
  filterStatus: 'ALL',
  searchQuery: '',
  charts: {
    gpaTrend: null,
    gradeDist: null
  }
};

// DOM Elements
const elements = {
  // Views
  loginView: document.getElementById('login-view'),
  dashboardView: document.getElementById('dashboard-view'),

  // Login
  loginForm: document.getElementById('login-form'),
  usernameInput: document.getElementById('username'),
  passwordInput: document.getElementById('password'),
  togglePasswordBtn: document.getElementById('toggle-password'),
  rememberMeCheckbox: document.getElementById('remember-me'),
  btnLogin: document.getElementById('btn-login'),

  // Navbar
  navUserName: document.getElementById('nav-user-name'),
  navUserMssv: document.getElementById('nav-user-mssv'),
  userAvatar: document.getElementById('user-avatar'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnPrint: document.getElementById('btn-print'),
  btnExportCsv: document.getElementById('btn-export-csv'),
  btnLogout: document.getElementById('btn-logout'),

  // Hero
  heroAvatar: document.getElementById('hero-avatar'),
  heroName: document.getElementById('hero-name'),
  heroMssv: document.getElementById('hero-mssv'),
  heroEmail: document.getElementById('hero-email'),
  heroRole: document.getElementById('hero-role'),
  statGpa10: document.getElementById('stat-gpa-10'),
  statGpa4: document.getElementById('stat-gpa-4'),
  statCredits: document.getElementById('stat-credits'),
  statRank: document.getElementById('stat-rank'),

  // Controls & Table
  semesterSelect: document.getElementById('semester-select'),
  statusFilter: document.getElementById('status-filter'),
  searchSubject: document.getElementById('search-subject'),
  semesterGroupsContainer: document.getElementById('semester-groups-container'),
  tableEmpty: document.getElementById('table-empty'),
  visibleCoursesCount: document.getElementById('visible-courses-count'),
  visibleCreditsCount: document.getElementById('visible-credits-count'),

  // Modal
  detailModal: document.getElementById('detail-modal'),
  modalClose: document.getElementById('modal-close'),
  modalBtnDismiss: document.getElementById('modal-btn-dismiss'),
  modalCourseName: document.getElementById('modal-course-name'),
  modalCourseCode: document.getElementById('modal-course-code'),
  modalCredits: document.getElementById('modal-credits'),
  modalTk10: document.getElementById('modal-tk-10'),
  modalTk4: document.getElementById('modal-tk-4'),
  modalLetter: document.getElementById('modal-letter'),
  modalComponentsBody: document.getElementById('modal-components-body'),

  // Toast
  toastContainer: document.getElementById('toast-container')
};

/* ==========================================================================
   INITIALIZATION & EVENT LISTENERS
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
});

function initApp() {
  // Check remembered credentials
  const savedMssv = localStorage.getItem('bdu_saved_mssv');
  if (savedMssv) {
    elements.usernameInput.value = savedMssv;
    elements.rememberMeCheckbox.checked = true;
  }

  // Check existing session
  const savedToken = sessionStorage.getItem('bdu_token');
  const savedUser = sessionStorage.getItem('bdu_user');
  if (savedToken && savedUser) {
    state.token = savedToken;
    state.user = JSON.parse(savedUser);
    switchToDashboard();
    fetchGradeData();
  }
}

function setupEventListeners() {
  // Toggle password visibility
  elements.togglePasswordBtn.addEventListener('click', () => {
    const isPassword = elements.passwordInput.type === 'password';
    elements.passwordInput.type = isPassword ? 'text' : 'password';
    elements.togglePasswordBtn.querySelector('.eye-open').classList.toggle('hidden', isPassword);
    elements.togglePasswordBtn.querySelector('.eye-closed').classList.toggle('hidden', !isPassword);
  });

  // Login Form Submit
  elements.loginForm.addEventListener('submit', handleLogin);

  // Logout
  elements.btnLogout.addEventListener('click', handleLogout);

  // Refresh
  elements.btnRefresh.addEventListener('click', () => {
    if (state.token) {
      showToast('Đang làm mới dữ liệu bảng điểm...', 'info');
      fetchGradeData();
    }
  });

  // Print
  elements.btnPrint.addEventListener('click', () => {
    window.print();
  });

  // Export CSV
  elements.btnExportCsv.addEventListener('click', exportToCsv);

  // Filters & Search
  elements.semesterSelect.addEventListener('change', (e) => {
    state.selectedSemester = e.target.value;
    renderGradeTable();
  });

  elements.statusFilter.addEventListener('change', (e) => {
    state.filterStatus = e.target.value;
    renderGradeTable();
  });

  elements.searchSubject.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderGradeTable();
  });

  // Modal events
  elements.modalClose.addEventListener('click', closeModal);
  elements.modalBtnDismiss.addEventListener('click', closeModal);
  elements.detailModal.addEventListener('click', (e) => {
    if (e.target === elements.detailModal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !elements.detailModal.classList.contains('hidden')) {
      closeModal();
    }
  });
}

/* ==========================================================================
   AUTHENTICATION HANDLERS
   ========================================================================== */

async function handleLogin(e) {
  e.preventDefault();
  const username = elements.usernameInput.value.trim();
  const password = elements.passwordInput.value;

  if (!username || !password) {
    showToast('Vui lòng điền MSSV và Mật khẩu', 'error');
    return;
  }

  setLoginLoading(true);

  try {
    const authData = await BduApi.login(username, password);

    // Save remember me
    if (elements.rememberMeCheckbox.checked) {
      localStorage.setItem('bdu_saved_mssv', username);
    } else {
      localStorage.removeItem('bdu_saved_mssv');
    }

    // Set state & session
    state.token = authData.token;
    state.user = {
      name: authData.name,
      mssv: authData.mssv,
      email: authData.email,
      roles: authData.roles
    };

    sessionStorage.setItem('bdu_token', state.token);
    sessionStorage.setItem('bdu_user', JSON.stringify(state.user));

    showToast(`Chào mừng, ${authData.name}!`, 'success');
    switchToDashboard();
    await fetchGradeData();

  } catch (error) {
    console.error('Login error:', error);
    showToast(error.message || 'Đăng nhập thất bại. Vui lòng kiểm tra lại.', 'error');
  } finally {
    setLoginLoading(false);
  }
}

function handleLogout() {
  state.user = null;
  state.token = null;
  state.semesters = [];
  sessionStorage.removeItem('bdu_token');
  sessionStorage.removeItem('bdu_user');

  elements.dashboardView.classList.add('hidden');
  elements.dashboardView.classList.remove('active');
  elements.loginView.classList.remove('hidden');
  elements.loginView.classList.add('active');

  elements.passwordInput.value = '';
  showToast('Đã đăng xuất thành công', 'info');
}

function switchToDashboard() {
  elements.loginView.classList.add('hidden');
  elements.loginView.classList.remove('active');
  elements.dashboardView.classList.remove('hidden');
  elements.dashboardView.classList.add('active');

  // Populate user profile info
  if (state.user) {
    const initials = getInitials(state.user.name);
    elements.userAvatar.textContent = initials;
    elements.heroAvatar.textContent = initials;
    elements.navUserName.textContent = state.user.name;
    elements.navUserMssv.textContent = state.user.mssv;
    elements.heroName.textContent = state.user.name;
    elements.heroMssv.textContent = state.user.mssv;
    elements.heroEmail.textContent = state.user.email || `${state.user.mssv}@student.bdu.edu.vn`;
  }
}

function setLoginLoading(isLoading) {
  elements.btnLogin.disabled = isLoading;
  const btnText = elements.btnLogin.querySelector('.btn-text');
  const btnLoader = elements.btnLogin.querySelector('.btn-loader');

  if (isLoading) {
    btnText.classList.add('hidden');
    btnLoader.classList.remove('hidden');
  } else {
    btnText.classList.remove('hidden');
    btnLoader.classList.add('hidden');
  }
}

/* ==========================================================================
   GRADE DATA RETRIEVAL & RENDERING
   ========================================================================== */

async function fetchGradeData() {
  try {
    const data = await BduApi.getGrades(state.token);
    state.semesters = data.ds_diem_hocky || [];

    if (state.semesters.length === 0) {
      showToast('Chưa có dữ liệu bảng điểm nào cho tài khoản này.', 'info');
    }

    renderStudentOverview();
    populateSemesterDropdown();
    renderCharts();
    renderGradeTable();
  } catch (error) {
    console.error('Fetch grades error:', error);
    showToast(error.message || 'Không thể tải bảng điểm', 'error');
  }
}

function renderStudentOverview() {
  if (state.semesters.length === 0) return;

  // Tìm học kỳ mới nhất có thông tin điểm tích lũy (BDU trả danh sách từ học kỳ mới nhất ở index 0)
  const latestCumulativeSem = state.semesters.find(s => s.dtb_tich_luy_he_10 && s.dtb_tich_luy_he_10.toString().trim() !== '')
    || state.semesters.find(s => s.so_tin_chi_dat_tich_luy && s.so_tin_chi_dat_tich_luy.toString().trim() !== '')
    || state.semesters[0];

  const gpa10 = latestCumulativeSem.dtb_tich_luy_he_10 || latestCumulativeSem.dtb_hk_he10 || '--';
  const gpa4 = latestCumulativeSem.dtb_tich_luy_he_4 || latestCumulativeSem.dtb_hk_he4 || '--';
  const credits = latestCumulativeSem.so_tin_chi_dat_tich_luy || latestCumulativeSem.so_tin_chi_dat_hk || '--';
  const rank = latestCumulativeSem.xep_loai_tkb_hk || latestCumulativeSem.xep_loai_tkb_hk_eg || calculateRank(parseFloat(gpa10), parseFloat(gpa4));

  elements.statGpa10.textContent = gpa10;
  elements.statGpa4.textContent = gpa4;
  elements.statCredits.textContent = credits;
  elements.statRank.textContent = rank;
}

function populateSemesterDropdown() {
  elements.semesterSelect.innerHTML = '<option value="ALL">📁 Tất cả các học kỳ</option>';

  state.semesters.forEach((sem) => {
    const option = document.createElement('option');
    option.value = sem.hoc_ky;
    option.textContent = `📅 ${sem.ten_hoc_ky || ('Học kỳ ' + sem.hoc_ky)}`;
    elements.semesterSelect.appendChild(option);
  });
}

function renderGradeTable() {
  elements.semesterGroupsContainer.innerHTML = '';

  let totalVisibleCourses = 0;
  let totalVisibleCredits = 0;

  state.semesters.forEach(sem => {
    if (state.selectedSemester !== 'ALL' && sem.hoc_ky !== state.selectedSemester) {
      return;
    }

    let courses = sem.ds_diem_mon_hoc || [];

    // Filter courses
    if (state.filterStatus === 'PASS') {
      courses = courses.filter(c => c.ket_qua == 1 || (c.diem_tk_chu && c.diem_tk_chu.toUpperCase() !== 'F'));
    } else if (state.filterStatus === 'FAIL') {
      courses = courses.filter(c => c.ket_qua == 0 || (c.diem_tk_chu && c.diem_tk_chu.toUpperCase() === 'F'));
    }

    if (state.searchQuery) {
      courses = courses.filter(c => {
        const name = (c.ten_mon || '').toLowerCase();
        const code = (c.ma_mon || '').toLowerCase();
        return name.includes(state.searchQuery) || code.includes(state.searchQuery);
      });
    }

    // If searching or filtering and no course matches in this semester, don't show the card
    if (courses.length === 0 && (state.searchQuery || state.filterStatus !== 'ALL')) {
      return;
    }

    const semCredits = courses.reduce((sum, c) => sum + (parseInt(c.so_tin_chi) || 0), 0);
    totalVisibleCourses += courses.length;
    totalVisibleCredits += semCredits;

    const groupCard = document.createElement('div');
    groupCard.className = 'semester-group-card glass-panel';

    // Header
    const semTitle = sem.ten_hoc_ky || `Học kỳ ${sem.hoc_ky}`;
    const rankText = sem.xep_loai_tkb_hk || (sem.dtb_hk_he10 ? calculateRank(parseFloat(sem.dtb_hk_he10), parseFloat(sem.dtb_hk_he4)) : '');

    let headerHtml = `
      <div class="semester-group-header">
        <div class="sem-header-title">
          <span class="sem-header-icon">📅</span>
          <span class="sem-title-text">${semTitle}</span>
        </div>
        <div class="sem-header-badges">
          <span class="sem-badge">Môn học: <strong>${courses.length}</strong></span>
          <span class="sem-badge">Tín chỉ HK: <strong>${sem.so_tin_chi_dat_hk || semCredits}</strong></span>
          ${rankText ? `<span class="sem-badge">Xếp loại: <strong>${rankText}</strong></span>` : ''}
        </div>
      </div>
    `;

    // Table
    let tableRowsHtml = '';
    if (courses.length === 0) {
      tableRowsHtml = `
        <tr>
          <td colspan="12" style="text-align: center; color: var(--text-muted); padding: 24px;">
            Chưa có dữ liệu môn học cho học kỳ này.
          </td>
        </tr>
      `;
    } else {
      courses.forEach((course, index) => {
        const isPass = course.ket_qua == 1 || (course.diem_tk_chu && course.diem_tk_chu.toUpperCase() !== 'F');
        const letterClass = getGradeLetterClass(course.diem_tk_chu);
        const courseJson = encodeURIComponent(JSON.stringify({
          ...course,
          sem_name: semTitle
        }));

        tableRowsHtml += `
          <tr>
            <td class="col-stt">${index + 1}</td>
            <td class="col-code">${course.ma_mon || '--'}</td>
            <td class="col-group">${course.nhom_to || '--'}</td>
            <td class="col-name">${course.ten_mon || '--'}</td>
            <td class="col-credits">${course.so_tin_chi || '0'}</td>
            <td class="col-mid">${formatScore(course.diem_giua_ky)}</td>
            <td class="col-final">${formatScore(course.diem_thi)}</td>
            <td class="col-total10"><strong>${formatScore(course.diem_tk)}</strong></td>
            <td class="col-total4">${formatScore(course.diem_tk_so)}</td>
            <td class="col-letter"><span class="grade-pill ${letterClass}">${course.diem_tk_chu || '--'}</span></td>
            <td class="col-status">
              <span class="status-badge ${isPass ? 'status-pass' : 'status-fail'}">
                ${isPass ? '✓ Đạt' : '✗ Học lại'}
              </span>
            </td>
            <td class="col-detail">
              <button class="btn-detail" onclick="showCourseDetail('${courseJson}')">
                Chi tiết
              </button>
            </td>
          </tr>
        `;
      });
    }

    const tableHtml = `
      <div class="table-responsive">
        <table class="grade-table">
          <thead>
            <tr>
              <th class="col-stt">STT</th>
              <th class="col-code">Mã MH</th>
              <th class="col-group">Nhóm/Tổ</th>
              <th class="col-name">Tên Môn Học</th>
              <th class="col-credits">Số TC</th>
              <th class="col-mid">Giữa Kỳ</th>
              <th class="col-final">Cuối Kỳ</th>
              <th class="col-total10">Điểm TK</th>
              <th class="col-total4">Điểm Hệ 4</th>
              <th class="col-letter">Điểm Chữ</th>
              <th class="col-status">Kết Quả</th>
              <th class="col-detail">Chi Tiết</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
      </div>
    `;

    // Red/Rose summary box matching BDU specification
    const summaryBoxHtml = `
      <div class="semester-summary-box">
        <div class="summary-col">
          <div class="summary-item">
            <span class="s-label">Điểm trung bình học kỳ hệ 4:</span>
            <span class="s-val">${formatScore(sem.dtb_hk_he4)}</span>
          </div>
          <div class="summary-item">
            <span class="s-label">Điểm trung bình học kỳ hệ 10:</span>
            <span class="s-val">${formatScore(sem.dtb_hk_he10)}</span>
          </div>
          <div class="summary-item">
            <span class="s-label">Số tín chỉ đạt học kỳ:</span>
            <span class="s-val">${formatScore(sem.so_tin_chi_dat_hk)}</span>
          </div>
          ${sem.diemrl_hk ? `
          <div class="summary-item">
            <span class="s-label">Điểm rèn luyện học kỳ:</span>
            <span class="s-val">${formatScore(sem.diemrl_hk)}</span>
          </div>` : ''}
          ${sem.phan_loai_rl_hk || sem.xep_loai_tkb_hk ? `
          <div class="summary-item">
            <span class="s-label">Xếp loại học lực học kỳ:</span>
            <span class="s-val highlight-green">${sem.xep_loai_tkb_hk || sem.phan_loai_rl_hk || '--'}</span>
          </div>` : ''}
        </div>
        <div class="summary-col">
          <div class="summary-item">
            <span class="s-label">Điểm trung bình tích lũy hệ 4:</span>
            <span class="s-val highlight-green">${formatScore(sem.dtb_tich_luy_he_4)}</span>
          </div>
          <div class="summary-item">
            <span class="s-label">Điểm trung bình tích lũy hệ 10:</span>
            <span class="s-val highlight-green">${formatScore(sem.dtb_tich_luy_he_10)}</span>
          </div>
          <div class="summary-item">
            <span class="s-label">Số tín chỉ tích lũy:</span>
            <span class="s-val highlight-blue">${formatScore(sem.so_tin_chi_dat_tich_luy)}</span>
          </div>
        </div>
      </div>
    `;

    groupCard.innerHTML = headerHtml + tableHtml + summaryBoxHtml;
    elements.semesterGroupsContainer.appendChild(groupCard);
  });

  // Update counts
  elements.visibleCoursesCount.textContent = totalVisibleCourses;
  elements.visibleCreditsCount.textContent = totalVisibleCredits;

  if (totalVisibleCourses === 0) {
    elements.tableEmpty.classList.remove('hidden');
  } else {
    elements.tableEmpty.classList.add('hidden');
  }
}

/* ==========================================================================
   CHARTS & VISUAL ANALYTICS (CHART.JS)
   ========================================================================== */

function renderCharts() {
  if (state.semesters.length === 0) return;

  renderGpaTrendChart();
  renderGradeDistChart();
}

function renderGpaTrendChart() {
  const ctx = document.getElementById('gpaTrendChart');
  if (!ctx) return;

  if (state.charts.gpaTrend) {
    state.charts.gpaTrend.destroy();
  }

  // Sắp xếp theo thứ tự thời gian tăng dần (từ học kỳ đầu đến học kỳ hiện tại)
  // và chỉ lấy các học kỳ đã có điểm tổng kết
  const validSemesters = [...state.semesters]
    .reverse()
    .filter(s => s.dtb_hk_he10 && s.dtb_hk_he10.toString().trim() !== '' && !isNaN(parseFloat(s.dtb_hk_he10)));

  if (validSemesters.length === 0) return;

  const labels = validSemesters.map(s => {
    if (!s.ten_hoc_ky) return `HK ${s.hoc_ky}`;
    return s.ten_hoc_ky
      .replace('Học kỳ ', 'HK')
      .replace('Năm học ', '')
      .replace(' - ', ' ');
  });

  const gpa10Data = validSemesters.map(s => parseFloat(s.dtb_hk_he10) || 0);
  const gpa4Data = validSemesters.map(s => parseFloat(s.dtb_hk_he4) || 0);

  state.charts.gpaTrend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'ĐTB Hệ 10',
          data: gpa10Data,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.15)',
          fill: true,
          tension: 0.35,
          borderWidth: 3,
          pointBackgroundColor: '#818cf8',
          pointRadius: 5,
          pointHoverRadius: 7,
          yAxisID: 'y1'
        },
        {
          label: 'ĐTB Hệ 4',
          data: gpa4Data,
          borderColor: '#10b981',
          borderDash: [5, 5],
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.35,
          borderWidth: 2,
          pointBackgroundColor: '#34d399',
          pointRadius: 5,
          pointHoverRadius: 7,
          yAxisID: 'y2'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          labels: {
            color: '#94a3b8',
            font: { family: 'Plus Jakarta Sans', size: 12 }
          }
        },
        tooltip: {
          backgroundColor: '#1e293b',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          callbacks: {
            label: function(context) {
              if (context.datasetIndex === 1) {
                return `ĐTB Hệ 4: ${context.parsed.y.toFixed(2)}`;
              }
              return `ĐTB Hệ 10: ${context.parsed.y.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        y1: {
          type: 'linear',
          display: true,
          position: 'left',
          min: 0,
          max: 10,
          title: {
            display: true,
            text: 'Thang 10',
            color: '#6366f1',
            font: { size: 11, weight: '600' }
          },
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#64748b', font: { family: 'JetBrains Mono' } }
        },
        y2: {
          type: 'linear',
          display: true,
          position: 'right',
          min: 0,
          max: 4,
          title: {
            display: true,
            text: 'Thang 4',
            color: '#10b981',
            font: { size: 11, weight: '600' }
          },
          grid: { drawOnChartArea: false },
          ticks: { color: '#10b981', font: { family: 'JetBrains Mono' } }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 11 } }
        }
      }
    }
  });
}

function renderGradeDistChart() {
  const ctx = document.getElementById('gradeDistChart');
  if (!ctx) return;

  if (state.charts.gradeDist) {
    state.charts.gradeDist.destroy();
  }

  // Count letter grades
  const counts = { 'A': 0, 'B+': 0, 'B': 0, 'C+': 0, 'C': 0, 'D+': 0, 'D': 0, 'F': 0 };

  state.semesters.forEach(sem => {
    (sem.ds_diem_mon_hoc || []).forEach(course => {
      const letter = (course.diem_tk_chu || '').trim().toUpperCase();
      if (counts.hasOwnProperty(letter)) {
        counts[letter]++;
      }
    });
  });

  state.charts.gradeDist = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(counts),
      datasets: [{
        data: Object.values(counts),
        backgroundColor: [
          '#10b981', // A
          '#06b6d4', // B+
          '#3b82f6', // B
          '#8b5cf6', // C+
          '#f59e0b', // C
          '#f97316', // D+
          '#ea580c', // D
          '#ef4444'  // F
        ],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#cbd5e1',
            font: { family: 'JetBrains Mono', size: 11 },
            boxWidth: 12
          }
        }
      },
      cutout: '68%'
    }
  });
}

/* ==========================================================================
   MODAL COMPONENT GRADES VIEW
   ========================================================================== */

window.showCourseDetail = function(encodedData) {
  try {
    const course = JSON.parse(decodeURIComponent(encodedData));

    elements.modalCourseName.textContent = course.ten_mon || 'Chi Tiết Môn Học';
    elements.modalCourseCode.textContent = course.ma_mon || '--';
    elements.modalCredits.textContent = course.so_tin_chi || '0';
    elements.modalTk10.textContent = formatScore(course.diem_tk);
    elements.modalTk4.textContent = formatScore(course.diem_tk_so);

    elements.modalLetter.textContent = course.diem_tk_chu || '--';
    elements.modalLetter.className = `grade-pill ${getGradeLetterClass(course.diem_tk_chu)}`;

    elements.modalComponentsBody.innerHTML = '';

    const components = course.ds_diem_thanh_phan || [];
    if (components.length === 0) {
      elements.modalComponentsBody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">
            Không có dữ liệu điểm thành phần chi tiết cho môn học này.
          </td>
        </tr>
      `;
    } else {
      components.forEach(comp => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${comp.ten_thanh_phan || comp.ten_tp || 'Thành phần'}</strong></td>
          <td style="font-family: var(--font-mono);">${comp.trong_so || comp.ty_le || '--'}%</td>
          <td style="font-family: var(--font-mono); color: #38bdf8; font-weight: 700;">${formatScore(comp.diem || comp.diem_tp)}</td>
          <td style="color: var(--text-muted);">${comp.ghi_chu || '--'}</td>
        `;
        elements.modalComponentsBody.appendChild(tr);
      });
    }

    elements.detailModal.classList.remove('hidden');
  } catch (err) {
    console.error('Show detail error:', err);
  }
};

function closeModal() {
  elements.detailModal.classList.add('hidden');
}

/* ==========================================================================
   CSV EXPORT HELPER
   ========================================================================== */

function exportToCsv() {
  if (state.semesters.length === 0) {
    showToast('Không có dữ liệu để xuất', 'error');
    return;
  }

  const rows = [
    ['Học Kỳ', 'Mã Môn', 'Tên Môn Học', 'Số Tín Chỉ', 'Điểm GK', 'Điểm Thi', 'Điểm TK (10)', 'Điểm Hệ 4', 'Điểm Chữ', 'Kết Quả']
  ];

  state.semesters.forEach(sem => {
    if (state.selectedSemester !== 'ALL' && sem.hoc_ky !== state.selectedSemester) {
      return;
    }
    const courses = sem.ds_diem_mon_hoc || [];
    courses.forEach(c => {
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
        isPass ? 'Đạt' : 'Học lại'
      ]);
    });
  });

  const csvContent = '\uFEFF' + rows.map(e => e.join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `BangDiem_BDU_${state.user ? state.user.mssv : 'SinhVien'}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('Đã tải xuống file CSV thành công!', 'success');
}

/* ==========================================================================
   UTILITY FUNCTIONS
   ========================================================================== */

function getInitials(name) {
  if (!name) return 'SV';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getGradeLetterClass(letter) {
  if (!letter) return '';
  const l = letter.trim().toUpperCase();
  if (l === 'A') return 'grade-a';
  if (l === 'B+') return 'grade-b-plus';
  if (l === 'B') return 'grade-b';
  if (l === 'C+') return 'grade-c-plus';
  if (l === 'C') return 'grade-c';
  if (l === 'D+') return 'grade-d-plus';
  if (l === 'D') return 'grade-d';
  if (l === 'F') return 'grade-f';
  return '';
}

function calculateRank(gpa10, gpa4) {
  if (gpa4 !== undefined && !isNaN(gpa4) && gpa4 > 0) {
    if (gpa4 >= 3.6) return 'Xuất sắc';
    if (gpa4 >= 3.2) return 'Giỏi';
    if (gpa4 >= 2.5) return 'Khá';
    if (gpa4 >= 2.0) return 'Trung bình';
    return 'Yếu';
  }
  if (gpa10 !== undefined && !isNaN(gpa10) && gpa10 > 0) {
    if (gpa10 >= 9.0) return 'Xuất sắc';
    if (gpa10 >= 8.0) return 'Giỏi';
    if (gpa10 >= 6.5) return 'Khá';
    if (gpa10 >= 5.0) return 'Trung bình';
    return 'Yếu';
  }
  return 'Đang cập nhật';
}

function formatScore(val) {
  if (val === undefined || val === null || val === '') return '--';
  return val;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
    <span>${message}</span>
  `;

  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
