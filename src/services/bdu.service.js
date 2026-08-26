/**
 * BDU Core Portal Service
 * Handles communication with BDU API and processes academic data
 */

const BDU_BASE_URL = 'https://sv.bdu.edu.vn/public/api';

export const BduService = {
  /**
   * Proxy login request to BDU server
   */
  async login(username, password) {
    if (!username || !password) {
      throw new Error('Vui lòng nhập đầy đủ mã số sinh viên và mật khẩu.');
    }

    const params = new URLSearchParams({
      grant_type: 'password',
      username: username.trim(),
      password: password
    });

    const response = await fetch(`${BDU_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const data = await response.json();

    if (!data.access_token) {
      const msg = data.message || 'Đăng nhập không thành công. Vui lòng kiểm tra lại tài khoản hoặc mật khẩu.';
      const err = new Error(msg);
      err.status = response.status === 200 ? 401 : response.status;
      throw err;
    }

    return {
      result: true,
      token: data.access_token,
      name: data.name,
      mssv: data.userName,
      email: data.principal,
      roles: data.roles,
      expires_in: data.expires_in
    };
  },

  /**
   * Fetch gradebook data from BDU server
   */
  async getGrades(token) {
    if (!token) {
      const err = new Error('Thiếu mã xác thực (Token). Vui lòng đăng nhập lại.');
      err.status = 401;
      throw err;
    }

    const response = await fetch(`${BDU_BASE_URL}/srm/w-locdsdiemsinhvien?hien_thi_mon_theo_hkdk=false`, {
      method: 'POST',
      headers: {
        'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    const data = await response.json();

    if (!data.result && data.code !== 200) {
      if (data.code === 400 || data.code === 401 || data.code === 402) {
        const err = new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        err.status = 401;
        throw err;
      }
      const err = new Error(data.message || 'Không thể lấy dữ liệu bảng điểm.');
      err.status = 400;
      throw err;
    }

    return data;
  },

  /**
   * Fetch student photo (base64) from BDU API
   */
  async getStudentImage(token, maSV) {
    if (!token || !maSV) {
      return null;
    }

    try {
      const response = await fetch(`${BDU_BASE_URL}/sms/w-locthongtinimagesinhvien?MaSV=${encodeURIComponent(maSV.toString().trim())}`, {
        method: 'POST',
        headers: {
          'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
          'Accept': 'application/json, text/plain, */*',
          'idpc': '0',
          'Content-Type': 'text/plain'
        }
      });

      const data = await response.json();
      if (data?.data?.thong_tin_sinh_vien?.image) {
        const rawImage = data.data.thong_tin_sinh_vien.image;
        const base64 = rawImage.startsWith('data:') ? rawImage : `data:image/jpeg;base64,${rawImage}`;
        return base64;
      }
    } catch (e) {
      console.error('Error fetching student image:', e);
    }
    return null;
  },

  /**
   * Fetch student profile information directly from BDU API
   */
  async getProfile(token, idsv = '', maSV = '') {
    if (!token) {
      const err = new Error('Thiếu mã xác thực (Token). Vui lòng đăng nhập lại.');
      err.status = 401;
      throw err;
    }

    const queryParam = idsv ? `?IDSV=${encodeURIComponent(idsv)}` : '';
    
    // Fetch profile and photo in parallel
    const [profileRes, imageBase64] = await Promise.all([
      fetch(`${BDU_BASE_URL}/sms/w-locdsthongtinhhscanhan${queryParam}`, {
        method: 'GET',
        headers: {
          'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
          'Accept': 'application/json, text/plain, */*',
          'idpc': '0'
        }
      }).then(r => r.json()).catch(err => ({ result: false, message: err.message })),
      maSV ? this.getStudentImage(token, maSV) : Promise.resolve(null)
    ]);

    const data = profileRes || {};

    if (!data.result && data.code !== 200) {
      if (data.code === 401 || data.code === 400) {
        const err = new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        err.status = 401;
        throw err;
      }
    }

    // Attach student photo if fetched
    if (imageBase64) {
      data.student_image = imageBase64;
      if (data.data) {
        if (Array.isArray(data.data) && data.data.length > 0) {
          data.data[0].hinh_anh = imageBase64;
        } else if (typeof data.data === 'object') {
          data.data.hinh_anh = imageBase64;
        }
      }
    }

    return data;
  },

  /**
   * Fetch available schedule semesters list from BDU API
   * POST /public/api/sch/w-locdsdoituongthoikhoabieu
   */
  async getScheduleSemesters(token) {
    if (!token) return { result: false, message: 'Thiếu mã xác thực (Token).' };

    try {
      const response = await fetch(`${BDU_BASE_URL}/sch/w-locdsdoituongthoikhoabieu`, {
        method: 'POST',
        headers: {
          'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
          'Accept': 'application/json, text/plain, */*',
          'idpc': '0',
          'Content-Type': 'text/plain'
        }
      });

      const data = await response.json();
      return data;
    } catch (err) {
      console.error('Error fetching schedule semesters:', err);
      return { result: false, message: err.message };
    }
  },

  /**
   * Fetch detailed weekly schedule for a specific semester from BDU API
   * POST /public/api/sch/w-locdstkbtuanusertheohocky
   */
  async getScheduleBySemester(token, hocKy = 20261) {
    if (!token) return { result: false, message: 'Thiếu mã xác thực (Token).' };

    try {
      const numericHocKy = parseInt(hocKy, 10) || 20261;
      const response = await fetch(`${BDU_BASE_URL}/sch/w-locdstkbtuanusertheohocky`, {
        method: 'POST',
        headers: {
          'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
          'Accept': 'application/json, text/plain, */*',
          'idpc': '0',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filter: {
            hoc_ky: numericHocKy,
            ten_hoc_ky: ''
          },
          additional: {
            paging: { limit: 100, page: 1 },
            ordering: [{ name: null, order_type: null }]
          }
        })
      });

      const data = await response.json();
      return data;
    } catch (err) {
      console.error('Error fetching schedule by semester:', err);
      return { result: false, message: err.message };
    }
  },

  /**
   * Get unified schedule (fetches real BDU schedule if token provided, otherwise returns mock structure)
   */
  async getSchedule(token = '', hocKy = null) {
    const defaultSemesters = [
      { hoc_ky: 20261, ten_hoc_ky: 'Học kỳ 1 - Năm học 2026-2027' },
      { hoc_ky: 20252, ten_hoc_ky: 'Học kỳ 2 - Năm học 2025-2026' },
      { hoc_ky: 20251, ten_hoc_ky: 'Học kỳ 1 - Năm học 2025-2026' }
    ];

    const defaultItems = [
      {
        id: 1,
        day: 'Thứ 2',
        dayOfWeek: 2,
        courseCode: 'INT1340',
        courseName: 'Lập Trình Web Nâng Cao & Node.js',
        credits: 3,
        periods: 'Tiết 1 - 3 (07:00 - 09:30)',
        room: 'Phòng Lab 302 - Khu A',
        lecturer: 'TS. Trần Hoàng Nam',
        status: 'upcoming'
      },
      {
        id: 2,
        day: 'Thứ 3',
        dayOfWeek: 3,
        courseCode: 'INT1352',
        courseName: 'Kiến Trúc & Thiết Kế Phần Mềm',
        credits: 3,
        periods: 'Tiết 4 - 6 (09:45 - 12:15)',
        room: 'Phòng Lý Thuyết A2.10',
        lecturer: 'ThS. Nguyễn Hồ Hải',
        status: 'upcoming'
      },
      {
        id: 3,
        day: 'Thứ 5',
        dayOfWeek: 5,
        courseCode: 'INT1360',
        courseName: 'Cơ Sở Dữ Liệu Phân Tán & NoSQL',
        credits: 3,
        periods: 'Tiết 1 - 3 (07:00 - 09:30)',
        room: 'Phòng Lab 401 - Khu B',
        lecturer: 'TS. Lê Thị Mai',
        status: 'upcoming'
      },
      {
        id: 4,
        day: 'Thứ 6',
        dayOfWeek: 6,
        courseCode: 'INT1388',
        courseName: 'Thực Tập Chuyên Ngành & Đồ Án',
        credits: 4,
        periods: 'Tiết 7 - 9 (13:00 - 15:30)',
        room: 'Phòng Hội Thảo B1.05',
        lecturer: 'ThS. Nguyễn Hồ Hải',
        status: 'upcoming'
      }
    ];

    if (token) {
      try {
        // Step 1: Fetch list of semesters
        const semRes = await this.getScheduleSemesters(token);
        let semestersList = [];

        if (semRes && semRes.code !== 402 && semRes.code !== 401 && semRes.result !== false) {
          if (semRes?.data?.ds_hoc_ky) {
            semestersList = semRes.data.ds_hoc_ky;
          } else if (semRes?.data?.ds_doituong_tkb) {
            semestersList = semRes.data.ds_doituong_tkb;
          } else if (Array.isArray(semRes?.data)) {
            semestersList = semRes.data;
          } else if (Array.isArray(semRes)) {
            semestersList = semRes;
          }
        }

        if (semestersList.length === 0) {
          semestersList = defaultSemesters;
        }

        // Determine target semester
        let targetHocKy = hocKy;
        if (!targetHocKy) {
          targetHocKy = semestersList[0]?.hoc_ky || 20261;
        }

        // Step 2: Fetch detailed weekly schedule
        const detailRes = await this.getScheduleBySemester(token, targetHocKy);

        if (detailRes && detailRes.code !== 402 && detailRes.code !== 401 && detailRes.result !== false) {
          const rawData = detailRes.data || detailRes;
          let extractedItems = [];

          if (Array.isArray(rawData)) {
            extractedItems = rawData;
          } else if (Array.isArray(rawData.ds_thoi_khoa_bieu)) {
            extractedItems = rawData.ds_thoi_khoa_bieu;
          } else if (Array.isArray(rawData.ds_lop_hoc_phan)) {
            extractedItems = rawData.ds_lop_hoc_phan;
          } else if (Array.isArray(rawData.ds_tuan_tkb)) {
            // Flatten schedule across weeks
            for (const week of rawData.ds_tuan_tkb) {
              const weekSchedule = week.ds_thoi_khoa_bieu || week.ds_chi_tiet_tkb || [];
              if (Array.isArray(weekSchedule) && weekSchedule.length > 0) {
                extractedItems.push(...weekSchedule);
              }
            }
          }

          // Format & Deduplicate items by subject + period + day
          if (extractedItems.length > 0) {
            const formattedItems = [];
            const seenKeys = new Set();

            for (const it of extractedItems) {
              const code = it.ma_mon_hoc || it.ma_mon || it.ma_hp || it.ma_lop_hoc_phan || '--';
              const name = it.ten_mon_hoc || it.ten_mon || it.ten_hp || 'Môn học';
              const day = it.thu || (it.thu_kieu_so ? `Thứ ${it.thu_kieu_so}` : 'Thứ 2');
              const startPeriod = it.tiet_bat_dau || it.tiet_bd || '1';
              const count = it.so_tiet || '3';
              const endPeriod = parseInt(startPeriod) + parseInt(count) - 1;
              const periods = it.tiet_hoc || `Tiết ${startPeriod} - ${endPeriod} (${count} tiết)`;
              const room = it.phong_hoc || it.ten_phong || it.ten_phong_hoc || 'Phòng học';
              const lecturer = it.ten_giang_vien || it.giang_vien || it.cb_giang_day || 'Bộ môn BDU';
              const credits = it.so_tin_chi || 3;

              const uniqueKey = `${code}-${day}-${startPeriod}`;
              if (!seenKeys.has(uniqueKey)) {
                seenKeys.add(uniqueKey);
                formattedItems.push({
                  courseCode: code,
                  courseName: name,
                  day,
                  periods,
                  room,
                  lecturer,
                  credits,
                  status: 'active'
                });
              }
            }

            return {
              isRealData: true,
              semesters: semestersList,
              selectedHocKy: targetHocKy,
              items: formattedItems
            };
          }
        }
      } catch (e) {
        console.error('Failed to fetch real schedule from BDU, falling back to local dataset:', e);
      }
    }

    // Fallback Structure
    return {
      isRealData: false,
      selectedHocKy: hocKy ? parseInt(hocKy, 10) : 20261,
      semesters: defaultSemesters,
      semester: 'Học kỳ 1 (2026 - 2027)',
      currentWeek: 1,
      totalWeeks: 15,
      items: defaultItems
    };
  },

  /**
   * Get learning hub catalog (courses, documents, and videos)
   */
  getLearningResources() {
    return {
      categories: ['Tất cả', 'Công Nghệ Thông Tin', 'Kỹ Năng Mềm', 'Đại Cương'],
      documents: [
        {
          id: 'doc-1',
          title: 'Giáo trình Cấu Trúc Dữ Liệu & Giải Thuật (Chuẩn BDU)',
          course: 'Cấu Trúc Dữ Liệu & Giải Thuật',
          category: 'Công Nghệ Thông Tin',
          format: 'PDF',
          size: '12.4 MB',
          downloads: 1420,
          downloadUrl: '#',
          updatedAt: '2026-02-15'
        },
        {
          id: 'doc-2',
          title: 'Mẫu Báo Cáo Tiểu Luận & Khóa Luận Tốt Nghiệp BDU (Word chuẩn)',
          course: 'Đồ Án & Tiểu Luận',
          category: 'Công Nghệ Thông Tin',
          format: 'DOCX',
          size: '2.1 MB',
          downloads: 3890,
          downloadUrl: '#',
          updatedAt: '2026-03-01'
        },
        {
          id: 'doc-3',
          title: 'Tổng Hợp Đề Thi & Bài Tập Cơ Sở Dữ Liệu (Có lời giải)',
          course: 'Hệ Quản Trị CSDL',
          category: 'Công Nghệ Thông Tin',
          format: 'PDF',
          size: '8.7 MB',
          downloads: 2150,
          downloadUrl: '#',
          updatedAt: '2026-01-20'
        },
        {
          id: 'doc-4',
          title: 'Slide Bài Giảng Lập Trình Web Toàn Diện (Express + Vue/React)',
          course: 'Lập Trình Web',
          category: 'Công Nghệ Thông Tin',
          format: 'PPTX',
          size: '24.5 MB',
          downloads: 1980,
          downloadUrl: '#',
          updatedAt: '2026-02-28'
        }
      ],
      videos: [
        {
          id: 'vid-1',
          title: 'Học Lập Trình Web Fullstack: Xây Dựng REST API với Node.js & Express',
          lecturer: 'ThS. Nguyễn Hồ Hải',
          course: 'Lập Trình Web',
          duration: '45:30',
          source: 'Google Drive Embed',
          driveId: '1AbCdEfGhIjKlMnOpQrStUvWxYz12345',
          thumbnail: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=600&auto=format&fit=crop&q=80',
          description: 'Bài giảng chuyên sâu về cách thiết kế REST API chuẩn kiến trúc MVC, xử lý JWT Auth và middleware.'
        },
        {
          id: 'vid-2',
          title: 'Hướng Dẫn Chuẩn Hóa Văn Bản Tiểu Luận & Báo Cáo Theo Quy Chuẩn BDU',
          lecturer: 'Bộ Môn Hệ Thống Thông Tin',
          course: 'Kỹ Năng Học Thuật',
          duration: '32:15',
          source: 'Google Drive Embed',
          driveId: '2BcDeFgHiJkLmNoPqRsTuVwXyZ56789',
          thumbnail: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=600&auto=format&fit=crop&q=80',
          description: 'Quy chuẩn lề A4, hệ thống heading H1-H4, danh mục hình ảnh, bảng biểu tự động và trang bìa theo chuẩn khoa.'
        }
      ]
    };
  }
};
