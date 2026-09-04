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
   * Lấy snapshot xếp hạng của chính sinh viên đã được phiên BDU xác minh
   */
  async getMyAcademicRanking(token) {
    const response = await fetch('/api/rankings/me', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    const data = await this.handleResponse(response, 'Không thể tải dữ liệu xếp hạng.');
    return data.data;
  },

  async getAcademicLeaderboard(token, options = {}) {
    const query = new URLSearchParams();
    query.set('scope', options.scope || 'school');
    query.set('metric', options.metric || 'gpa');
    const response = await fetch(`/api/rankings/leaderboard?${query.toString()}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    const data = await this.handleResponse(response, 'Chưa thể tải bảng xếp hạng.');
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
  async getLearningResources(token) {
    const response = await fetch('/api/learning/resources', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    const data = await this.handleResponse(response, 'Không thể tải danh mục tự học.');
    return data.data;
  },

  async getCourseLearningPosts(token, courseCode) {
    const response = await fetch(`/api/learning/courses/${encodeURIComponent(courseCode)}/posts`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    const data = await this.handleResponse(response, 'Không thể tải không gian môn học.');
    return data.data;
  },

  async createCourseLearningPost(token, courseCode, postData) {
    const response = await fetch(`/api/learning/courses/${encodeURIComponent(courseCode)}/posts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(postData)
    });
    const data = await this.handleResponse(response, 'Không thể đăng nội dung cho môn học.');
    return data.data;
  },

  async deleteCourseLearningPost(token, courseCode, postId) {
    const response = await fetch(`/api/learning/courses/${encodeURIComponent(courseCode)}/posts/${encodeURIComponent(postId)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await this.handleResponse(response, 'Không thể xóa bài viết.');
    return data.data;
  },

  async toggleCourseLearningPostLike(token, courseCode, postId) {
    const response = await fetch(`/api/learning/courses/${encodeURIComponent(courseCode)}/posts/${encodeURIComponent(postId)}/like`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await this.handleResponse(response, 'Không thể cập nhật lượt thích.');
    return data.data;
  },

  async getCourseLearningPostComments(token, courseCode, postId) {
    const response = await fetch(`/api/learning/courses/${encodeURIComponent(courseCode)}/posts/${encodeURIComponent(postId)}/comments`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    const data = await this.handleResponse(response, 'Không thể tải bình luận.');
    return data.data || [];
  },

  async addCourseLearningPostComment(token, courseCode, postId, commentData) {
    const response = await fetch(`/api/learning/courses/${encodeURIComponent(courseCode)}/posts/${encodeURIComponent(postId)}/comments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commentData)
    });
    const data = await this.handleResponse(response, 'Không thể gửi bình luận.');
    return data.data;
  },

  async getMyIdentityPresentation(token) {
    const response = await fetch('/api/students/me/presentation', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    const data = await this.handleResponse(response, 'Không thể tải danh hiệu hiển thị.');
    return data.data;
  },

  async updateMyIdentityPresentation(token, selectedTitleIds) {
    const response = await fetch('/api/students/me/presentation', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ selectedTitleIds })
    });
    const data = await this.handleResponse(response, 'Không thể cập nhật danh hiệu hiển thị.');
    return data.data;
  },

  /**
   * CLB / Nhóm Học Tập (Clans/Guilds) & Góc Tự Học Số
   */
  async getClans(token) {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch('/api/community/clans', { headers });
    const data = await this.handleResponse(response, 'Không thể tải danh sách CLB / Nhóm.');
    return data.data || [];
  },

  async createClan(token, clanData) {
    const response = await fetch('/api/community/clans', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(clanData)
    });
    const data = await this.handleResponse(response, 'Không thể tạo CLB / Nhóm mới.');
    return data.data;
  },

  async joinClan(token, clanId) {
    const response = await fetch(`/api/community/clans/${encodeURIComponent(clanId)}/join`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await this.handleResponse(response, 'Không thể tham gia CLB / Nhóm.');
    return data.data;
  },

  async leaveClan(token, clanId) {
    const response = await fetch(`/api/community/clans/${encodeURIComponent(clanId)}/leave`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await this.handleResponse(response, 'Không thể rời CLB / Nhóm.');
    return data.data;
  },

  async getClanMembers(clanId) {
    const response = await fetch(`/api/community/clans/${encodeURIComponent(clanId)}/members`);
    const data = await this.handleResponse(response, 'Không thể tải danh sách thành viên.');
    return data.data || [];
  },

  async getCommunityPosts(token, { scope = 'school', scopeId = null, filter = 'all', limit = 20, offset = 0 } = {}) {
    const params = new URLSearchParams();
    if (scope) params.set('scope', scope);
    if (scopeId) params.set('scopeId', scopeId);
    if (filter && filter !== 'all') params.set('filter', filter);
    params.set('limit', limit);
    params.set('offset', offset);

    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`/api/community/posts?${params.toString()}`, { headers });
    const data = await this.handleResponse(response, 'Không thể tải bài viết.');
    return data.data || { total: 0, posts: [] };
  },

  async createCommunityPost(token, postData) {
    const response = await fetch('/api/community/posts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(postData)
    });
    const data = await this.handleResponse(response, 'Không thể đăng bài viết.');
    return data.data;
  },

  async deleteCommunityPost(token, postId) {
    const response = await fetch(`/api/community/posts/${encodeURIComponent(postId)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await this.handleResponse(response, 'Không thể xóa bài viết.');
    return data.data;
  },

  async toggleCommunityPostLike(token, postId) {
    const response = await fetch(`/api/community/posts/${encodeURIComponent(postId)}/like`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await this.handleResponse(response, 'Không thể tương tác Like.');
    return data.data;
  },

  async getCommunityPostComments(token, postId) {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`/api/community/posts/${encodeURIComponent(postId)}/comments`, { headers });
    const data = await this.handleResponse(response, 'Không thể tải bình luận.');
    return data.data || [];
  },

  async addCommunityPostComment(token, postId, commentData) {
    const response = await fetch(`/api/community/posts/${encodeURIComponent(postId)}/comments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commentData)
    });
    const data = await this.handleResponse(response, 'Không thể gửi bình luận.');
    return data.data;
  },

  async updateClanMemberRole(token, clanId, mssv, role) {
    const response = await fetch(`/api/community/clans/${encodeURIComponent(clanId)}/members/${encodeURIComponent(mssv)}/role`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role })
    });
    const data = await this.handleResponse(response, 'Không thể cập nhật quyền thành viên.');
    return data.data;
  },

  async kickClanMember(token, clanId, mssv) {
    const response = await fetch(`/api/community/clans/${encodeURIComponent(clanId)}/members/${encodeURIComponent(mssv)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await this.handleResponse(response, 'Không thể mời thành viên ra khỏi nhóm.');
    return data.data;
  },

  async updateClan(token, clanId, updateData) {
    const response = await fetch(`/api/community/clans/${encodeURIComponent(clanId)}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updateData)
    });
    const data = await this.handleResponse(response, 'Không thể cập nhật thông tin CLB.');
    return data.data;
  },

  async disbandClan(token, clanId) {
    const response = await fetch(`/api/community/clans/${encodeURIComponent(clanId)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await this.handleResponse(response, 'Không thể giải tán CLB.');
    return data.data;
  },

  async toggleClanPostPin(token, postId) {
    const response = await fetch(`/api/community/posts/${encodeURIComponent(postId)}/pin`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await this.handleResponse(response, 'Không thể ghim bài viết.');
    return data.data;
  },

  async getClanDocuments(token, clanId, { type = 'all', search = '', limit = 50, offset = 0 } = {}) {
    const params = new URLSearchParams();
    if (type && type !== 'all') params.set('type', type);
    if (search && search.trim()) params.set('search', search.trim());
    params.set('limit', limit);
    params.set('offset', offset);

    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`/api/community/clans/${encodeURIComponent(clanId)}/documents?${params.toString()}`, { headers });
    const data = await this.handleResponse(response, 'Không thể tải kho tài liệu CLB.');
    return data.data || { total: 0, documents: [], stats: { total_files: 0, folders: 0, files: 0, videos: 0, links: 0 } };
  },

  async voteClanPoll(token, pollId, optionId) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`/api/community/polls/${encodeURIComponent(pollId)}/vote`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ optionId })
    });
    const data = await this.handleResponse(response, 'Không thể thực hiện bình chọn.');
    return data.data;
  }
};
