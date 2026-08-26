/**
 * BDU Hub Unified API Client
 */

const BduApi = {
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

    const data = await response.json();
    if (!response.ok || !data.result) {
      throw new Error(data.message || 'Không thể tải bảng điểm.');
    }
    return data.data;
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

    const data = await response.json();
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
    const data = await response.json();
    if (!response.ok || !data.result) {
      throw new Error(data.message || 'Không thể tải thời khóa biểu.');
    }
    return data.data;
  },

  /**
   * Định dạng file DOCX chuẩn BDU
   */
  async formatDocx(formData) {
    const response = await fetch('/api/wordfmt/format', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    if (!response.ok || !data.result) {
      throw new Error(data.message || 'Định dạng file thất bại.');
    }
    return data;
  },

  /**
   * Lấy danh mục tài liệu & video tự học
   */
  async getLearningResources() {
    const response = await fetch('/api/learning/resources');
    const data = await response.json();
    if (!response.ok || !data.result) {
      throw new Error(data.message || 'Không thể tải danh mục tự học.');
    }
    return data.data;
  }
};
