/**
 * BDU Portal API Client
 */
const BduApi = {
  /**
   * Đăng nhập sinh viên
   * @param {string} username - MSSV
   * @param {string} password - Mật khẩu
   */
  async login(username, password) {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (!response.ok || !data.result) {
      throw new Error(data.message || 'Đăng nhập không thành công.');
    }

    return data;
  },

  /**
   * Lấy danh sách điểm sinh viên
   * @param {string} token - Bearer Token
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
  }
};
