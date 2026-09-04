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
      idsv: data.id ?? data.id_sinh_vien ?? data.idsv ?? data.IDSV ?? '',
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

    // Keep this request aligned with the official student portal. In particular,
    // `idpc` selects the portal context; omitting it can return an incomplete
    // grade list even when the same student sees every course on sv.bdu.edu.vn.
    const response = await fetch(`${BDU_BASE_URL}/srm/w-locdsdiemsinhvien?hien_thi_mon_theo_hkdk=false`, {
      method: 'POST',
      headers: {
        'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
        'Accept': 'application/json, text/plain, */*',
        'idpc': '0',
        'Content-Type': 'text/plain'
      },
      body: ''
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

    const profileUrl = idsv
      ? `${BDU_BASE_URL}/sms/w-locdsthongtinhhscanhan?IDSV=${encodeURIComponent(idsv)}`
      : `${BDU_BASE_URL}/dkmh/w-locsinhvieninfo`;
    const profileMethod = idsv ? 'GET' : 'POST';

    // Fetch profile and photo in parallel. Newer sessions provide IDSV and use
    // the same endpoint as the official profile page; older sessions fall back
    // to the current-user endpoint, which does not require IDSV.
    const [profileRes, imageBase64] = await Promise.all([
      fetch(profileUrl, {
        method: profileMethod,
        headers: {
          'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
          'Accept': 'application/json, text/plain, */*',
          'idpc': '0',
          ...(profileMethod === 'POST' ? { 'Content-Type': 'text/plain' } : {})
        },
        ...(profileMethod === 'POST' ? { body: '' } : {})
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
   * POST /public/api/sch/w-locdshockytkbuser
   */
  async getScheduleSemesters(token) {
    if (!token) return { result: false, message: 'Thiếu mã xác thực (Token).' };

    try {
      const response = await fetch(`${BDU_BASE_URL}/sch/w-locdshockytkbuser`, {
        method: 'POST',
        headers: {
          'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
          'Accept': 'application/json, text/plain, */*',
          'idpc': '0',
          'Content-Type': 'text/plain'
        },
        body: ''
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
   * Get unified schedule (fetches real BDU schedule if token provided, otherwise returns empty structure)
   */
  async getSchedule(token = '', hocKy = null) {
    if (token) {
      try {
        // Step 1: Fetch list of semesters from w-locdshockytkbuser
        const semRes = await this.getScheduleSemesters(token);

        if (semRes && (semRes.code === 401 || semRes.code === 402 || semRes.message === 'loggedoff')) {
          return {
            isRealData: false,
            isSessionExpired: true,
            selectedHocKy: hocKy ? parseInt(hocKy, 10) : null,
            semesters: [],
            items: []
          };
        }

        let semestersList = [];

        if (semRes && semRes.code !== 402 && semRes.code !== 401 && semRes.result !== false) {
          if (Array.isArray(semRes?.data?.ds_hoc_ky)) {
            semestersList = semRes.data.ds_hoc_ky;
          } else if (Array.isArray(semRes?.data?.ds_doituong_tkb)) {
            semestersList = semRes.data.ds_doituong_tkb;
          } else if (Array.isArray(semRes?.data)) {
            semestersList = semRes.data;
          } else if (Array.isArray(semRes)) {
            semestersList = semRes;
          }
        }

        // Determine target semester
        let targetHocKy = hocKy;
        if (!targetHocKy && semestersList.length > 0) {
          targetHocKy = semestersList[0]?.hoc_ky || semestersList[0]?.ma_hoc_ky;
        }

        if (targetHocKy) {
          // Step 2: Fetch detailed weekly schedule
          const detailRes = await this.getScheduleBySemester(token, targetHocKy);

          if (detailRes && (detailRes.code === 401 || detailRes.code === 402 || detailRes.message === 'loggedoff')) {
            return {
              isRealData: false,
              isSessionExpired: true,
              selectedHocKy: parseInt(targetHocKy, 10),
              semesters: semestersList,
              items: []
            };
          }

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

            // Format & Deduplicate items by subject + day + period
            const formattedItems = [];
            const seenKeys = new Set();

            for (const it of extractedItems) {
              const code = it.ma_mon || it.ma_mon_hoc || it.ma_hp || it.ma_lop_hoc_phan || '--';
              const name = it.ten_mon || it.ten_mon_hoc || it.ten_hp || 'Môn học';
              const dayNum = it.thu_kieu_so;
              const day = dayNum === 8 ? 'Chủ Nhật' : (dayNum ? `Thứ ${dayNum}` : (it.thu || 'Thứ 2'));
              const startPeriod = it.tiet_bat_dau || it.tiet_bd || '1';
              const count = it.so_tiet || '3';
              const endPeriod = parseInt(startPeriod, 10) + parseInt(count, 10) - 1;
              const timeStr = parseInt(startPeriod, 10) <= 5 ? '07:00 - 11:30' : '13:00 - 17:30';
              const periods = it.tiet_hoc || `Tiết ${startPeriod} - ${endPeriod} (${timeStr})`;
              const room = it.ma_phong || it.phong_hoc || it.ten_phong || it.ten_phong_hoc || 'Chưa xếp phòng';
              const lecturer = it.ten_giang_vien || (it.ma_giang_vien ? `GV: ${it.ma_giang_vien}` : (it.giang_vien || it.cb_giang_day || 'Bộ môn BDU'));
              const credits = it.so_tin_chi ? parseInt(it.so_tin_chi, 10) : (it.credits || 3);
              const group = it.ma_nhom || '';
              const className = it.ma_lop || '';

              const uniqueKey = `${code}-${day}-${startPeriod}`;
              if (!seenKeys.has(uniqueKey)) {
                seenKeys.add(uniqueKey);
                formattedItems.push({
                  courseCode: code,
                  courseName: name,
                  ma_mon_hoc: code,
                  ten_mon_hoc: name,
                  day,
                  dayOfWeek: dayNum === 8 ? 1 : (dayNum || 2),
                  periods,
                  room,
                  phong_hoc: room,
                  lecturer,
                  ten_giang_vien: lecturer,
                  credits,
                  so_tin_chi: credits,
                  group,
                  className,
                  status: 'active'
                });
              }
            }

            // Sort by day of week
            formattedItems.sort((a, b) => (a.dayOfWeek || 0) - (b.dayOfWeek || 0));

            return {
              isRealData: true,
              semesters: semestersList,
              selectedHocKy: parseInt(targetHocKy, 10),
              items: formattedItems
            };
          }
        }

        return {
          isRealData: semestersList.length > 0,
          semesters: semestersList,
          selectedHocKy: targetHocKy ? parseInt(targetHocKy, 10) : null,
          items: []
        };
      } catch (e) {
        console.error('Failed to fetch real schedule from BDU:', e);
      }
    }

    // Không có token hoặc không có dữ liệu thực: trả về cấu trúc rỗng, không dùng dữ liệu giả
    return {
      isRealData: false,
      selectedHocKy: hocKy ? parseInt(hocKy, 10) : null,
      semesters: [],
      items: []
    };
  }
};
