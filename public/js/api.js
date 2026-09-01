/**
 * BDU Hub Unified API Client
 */

const BduApi = {
  /**
   * Helper xử lý response và bắt lỗi 401 hết hạn token
   */
  async handleResponse(response, defaultErrorMsg = 'Thao tác không thành công.') {
    let data;
    try {
      data = await response.json();
    } catch (e) {
      data = { result: false, message: response.statusText || defaultErrorMsg };
    }

    // Nếu mã lỗi là 401 hoặc thông báo hết hạn phiên
    if (response.status === 401 || (data && data.code === 401) || (data && typeof data.message === 'string' && data.message.includes('hết hạn'))) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('bdu:session_expired', {
          detail: { message: data.message || 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' }
        }));
      }
      throw new Error(data.message || 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    }

    if (!response.ok || (data && data.result === false)) {
      throw new Error(data.message || defaultErrorMsg);
    }

    return data;
  },

  /**
   * Đăng nhập sinh viên
   */
  async login(username, password) {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (!response.ok || !data.result) {
      throw new Error(data.message || 'Đăng nhập không thành công.');
    }
    return data;
  },

  /**
   * Lấy danh sách điểm
   */
  async getGrades(token) {
    const response = await fetch('/api/grades', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await this.handleResponse(response, 'Không thể tải bảng điểm.');
    return data.data || data;
  },

  /**
   * Lấy lý lịch / thông tin sinh viên & ảnh thẻ
   */
  async getProfile(token, idsv = '', maSV = '') {
    const query = new URLSearchParams();
    if (idsv) query.append('IDSV', idsv);
    if (maSV) query.append('MaSV', maSV);
    const queryString = query.toString() ? `?${query.toString()}` : '';

    const response = await fetch(`/api/profile${queryString}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token, idsv, maSV })
    });

    const data = await this.handleResponse(response, 'Không thể tải thông tin sinh viên.');
    return data;
  },

  /**
   * Lấy thời khóa biểu (hỗ trợ chọn mã học kỳ và token xác thực)
   */
  async getSchedule(token = '', hocKy = null) {
    const query = new URLSearchParams();
    if (hocKy) query.append('hoc_ky', hocKy);
    const queryString = query.toString() ? `?${query.toString()}` : '';

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`/api/schedule${queryString}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ token, hoc_ky: hocKy })
    });

    const data = await this.handleResponse(response, 'Không thể tải thời khóa biểu.');
    return data.data || data;
  },

  /**
   * Định dạng file DOCX chuẩn BDU
   */
  async formatDocx(formData) {
    const response = await fetch('/api/wordfmt/format', {
      method: 'POST',
      body: formData
    });

    const data = await this.handleResponse(response, 'Định dạng file thất bại.');
    return data;
  },

  async loginEnglish(credentials) {
    const response = await fetch('/api/english/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    const data = await this.handleResponse(response, 'Không thể đăng nhập Moodle.');
    return data.data;
  },

  async getEnglishActivities(sessionId, courseId) {
    const query = new URLSearchParams({ courseId });
    const response = await fetch(`/api/english/${encodeURIComponent(sessionId)}/activities?${query}`);
    const data = await this.handleResponse(response, 'Không thể quét danh sách bài tập.');
    return data.data;
  },

  async startEnglishExercise(sessionId, options) {
    const response = await fetch(`/api/english/${encodeURIComponent(sessionId)}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });
    const data = await this.handleResponse(response, 'Không thể khởi chạy bài tập.');
    return data.data;
  },

  async stopEnglishExercise(sessionId) {
    const response = await fetch(`/api/english/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' });
    return this.handleResponse(response, 'Không thể dừng tiến trình.');
  },

  async closeEnglishSession(sessionId) {
    const response = await fetch(`/api/english/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    return this.handleResponse(response, 'Không thể đóng phiên Moodle.');
  },

  async getEnglishAnswers() {
    const response = await fetch('/api/english/answers');
    const data = await this.handleResponse(response, 'Không thể tải ngân hàng đáp án.');
    return data.data;
  },

  async saveEnglishAnswer(question, correctAnswer) {
    const response = await fetch('/api/english/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, correctAnswer })
    });
    const data = await this.handleResponse(response, 'Không thể lưu đáp án.');
    return data.data;
  },

  async deleteEnglishAnswer(id) {
    const response = await fetch(`/api/english/answers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return this.handleResponse(response, 'Không thể xóa đáp án.');
  },

  /**
   * Lấy danh mục tài liệu & video tự học
   */
  async getLearningResources() {
    const response = await fetch('/api/learning/resources');
    const data = await this.handleResponse(response, 'Không thể tải danh mục tự học.');
    return data.data;
  }
};
