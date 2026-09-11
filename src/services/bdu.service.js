/**
 * BDU Core Portal Service
 * Handles communication with BDU API and processes academic data
 */

const BDU_BASE_URL = 'https://sv.bdu.edu.vn/public/api';
const DEFAULT_PROFILE_TIMEOUT_MS = 20_000;
const SCHEDULE_TIMEZONE = 'Asia/Ho_Chi_Minh';

// The portal normally provides period numbers rather than clock times. Keep
// this mapping close to the schedule normaliser so an occurrence always has a
// real start/end instant even when the upstream response omits time fields.
const BDU_PERIOD_TIMES = {
  1: ['07:00', '07:45'],
  2: ['07:45', '08:30'],
  3: ['08:30', '09:15'],
  4: ['09:15', '10:00'],
  5: ['10:00', '10:45'],
  6: ['13:00', '13:45'],
  7: ['13:45', '14:30'],
  8: ['14:30', '15:15'],
  9: ['15:15', '16:00'],
  10: ['16:00', '16:45'],
  // The evening block starts after the 16:45–17:45 break. Keep subsequent
  // periods as well, so a valid late class is not silently dropped when BDU
  // provides period numbers but no explicit clock time.
  11: ['17:45', '18:30'],
  12: ['18:30', '19:15'],
  13: ['19:15', '20:00'],
  14: ['20:00', '20:45'],
  15: ['20:45', '21:30']
};

const WEEK_START_KEYS = ['ngay_bat_dau', 'ngay_bat_dau_tuan', 'ngay_bd', 'ngay_bd_tuan', 'tu_ngay', 'tu_ngay_hoc', 'ngay_tu', 'start_date', 'startDate', 'date_start'];
const WEEK_END_KEYS = ['ngay_ket_thuc', 'ngay_ket_thuc_tuan', 'ngay_kt', 'ngay_kt_tuan', 'den_ngay', 'den_ngay_hoc', 'ngay_den', 'end_date', 'endDate', 'date_end'];
const SESSION_DATE_KEYS = ['ngay_hoc', 'ngay_day', 'ngay_hoc_thuc_te', 'ngay', 'study_date', 'studyDate', 'date'];
const START_TIME_KEYS = ['gio_bat_dau', 'gio_bd', 'start_time', 'startTime', 'thoi_gian_bat_dau', 'ngay_gio_bat_dau'];
const END_TIME_KEYS = ['gio_ket_thuc', 'gio_kt', 'end_time', 'endTime', 'thoi_gian_ket_thuc', 'ngay_gio_ket_thuc'];

function firstValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== null && value !== undefined && String(value).trim()) return value;
  }
  return null;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

// BDU date strings are commonly dd/MM/yyyy or yyyy-MM-dd. Parsing the
// calendar portion ourselves avoids a UTC conversion moving a Vietnamese date
// to the previous day on a server in another timezone.
function parseScheduleDate(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const viMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (viMatch) return `${viMatch[3]}-${pad2(viMatch[2])}-${pad2(viMatch[1])}`;
  return null;
}

function parseScheduleTime(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const match = raw.match(/(?:T|\s|^)(\d{1,2})[:h](\d{2})(?::\d{2})?/i) || raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return `${pad2(hour)}:${pad2(minute)}`;
}

function addDays(isoDate, offset) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function dayOfWeekFromItem(item) {
  const numeric = Number.parseInt(item?.thu_kieu_so || item?.thu_so || item?.dayOfWeek, 10);
  if (numeric >= 2 && numeric <= 8) return numeric;
  const day = String(item?.thu || item?.day || '').toLowerCase();
  if (day.includes('chủ nhật') || day.includes('chu nhat') || day.includes('sunday')) return 8;
  const match = day.match(/(?:thứ|thu|day)\s*(\d)/i);
  const parsed = Number.parseInt(match?.[1], 10);
  return parsed >= 2 && parsed <= 8 ? parsed : null;
}

function vietnamDayLabel(dayOfWeek) {
  return dayOfWeek === 8 ? 'Chủ Nhật' : `Thứ ${dayOfWeek}`;
}

function hcmNow(now = new Date()) {
  if (typeof now === 'string') {
    const date = parseScheduleDate(now);
    const time = parseScheduleTime(now);
    if (date && time) return { date, time, key: `${date}T${time}` };
  }

  const instant = now instanceof Date ? now : new Date(now);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHEDULE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(Number.isNaN(instant.getTime()) ? new Date() : instant);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const time = `${get('hour')}:${get('minute')}`;
  return { date, time, key: `${date}T${time}` };
}

function dateLabel(isoDate) {
  if (!isoDate) return '';
  const [, month, day] = isoDate.split('-');
  return `${day}/${month}`;
}

function normalizeWeekRange(week) {
  const startDate = parseScheduleDate(firstValue(week, WEEK_START_KEYS));
  const endDate = parseScheduleDate(firstValue(week, WEEK_END_KEYS));
  if (!startDate || !endDate || endDate < startDate) return null;
  return { startDate, endDate };
}

function periodTimes(item) {
  const startPeriod = Number.parseInt(item?.tiet_bat_dau || item?.tiet_bd, 10);
  const count = Number.parseInt(item?.so_tiet, 10);
  const endPeriod = Number.isInteger(startPeriod) && Number.isInteger(count) && count > 0
    ? startPeriod + count - 1
    : startPeriod;
  return {
    startPeriod: Number.isInteger(startPeriod) ? startPeriod : null,
    count: Number.isInteger(count) && count > 0 ? count : null,
    endPeriod: Number.isInteger(endPeriod) ? endPeriod : null,
    startTime: BDU_PERIOD_TIMES[startPeriod]?.[0] || null,
    endTime: BDU_PERIOD_TIMES[endPeriod]?.[1] || null
  };
}

function weekItems(week) {
  const candidates = [week?.ds_thoi_khoa_bieu, week?.ds_chi_tiet_tkb, week?.items, week?.data];
  return candidates.find(Array.isArray) || [];
}

function normalizeRoom(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Chưa xếp phòng';

  // The portal occasionally repeats a room code as a range, for example
  // "AVI.1.G-AVI.1.G". It does not communicate extra information, and showing
  // it verbatim makes the room chip look like corrupt data.
  const repeatedRoom = raw.match(/^(.+?)\s*-\s*\1$/u);
  return repeatedRoom ? repeatedRoom[1].trim() : raw;
}

function normalizeOccurrence(item, week, weekRange) {
  const periods = periodTimes(item);
  const dayOfWeek = dayOfWeekFromItem(item);
  const explicitDate = parseScheduleDate(firstValue(item, SESSION_DATE_KEYS));
  const date = explicitDate || (weekRange && dayOfWeek
    ? addDays(weekRange.startDate, dayOfWeek === 8 ? 6 : dayOfWeek - 2)
    : null);
  if (!date) return null;

  const startTime = parseScheduleTime(firstValue(item, START_TIME_KEYS)) || periods.startTime;
  const endTime = parseScheduleTime(firstValue(item, END_TIME_KEYS)) || periods.endTime;
  if (!startTime || !endTime) return null;

  const courseCode = item.ma_mon || item.ma_mon_hoc || item.ma_hp || item.ma_lop_hoc_phan || '--';
  const courseName = item.ten_mon || item.ten_mon_hoc || item.ten_hp || 'Môn học';
  const room = normalizeRoom(item.ma_phong || item.phong_hoc || item.ten_phong || item.ten_phong_hoc);
  const lecturer = item.ten_giang_vien || (item.ma_giang_vien ? `GV: ${item.ma_giang_vien}` : (item.giang_vien || item.cb_giang_day || 'Bộ môn BDU'));
  const credits = item.so_tin_chi ? Number.parseInt(item.so_tin_chi, 10) : (item.credits || 3);
  const group = item.ma_nhom || '';
  const className = item.ma_lop || item.lop_hoc_phan || '';
  const occurrenceKey = [courseCode, date, startTime, endTime, room, lecturer, group, className].join('|');
  const resolvedDay = dayOfWeek || (weekRange
    ? (() => {
      const offset = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${weekRange.startDate}T00:00:00Z`)) / 86_400_000);
      return offset === 6 ? 8 : offset + 2;
    })()
    : null);
  const endPeriod = periods.endPeriod;
  const periodLabel = item.tiet_hoc || (periods.startPeriod && endPeriod
    ? `Tiết ${periods.startPeriod} - ${endPeriod} (${startTime} - ${endTime})`
    : `${startTime} - ${endTime}`);

  return {
    courseCode,
    courseName,
    ma_mon_hoc: courseCode,
    ten_mon_hoc: courseName,
    day: resolvedDay ? vietnamDayLabel(resolvedDay) : 'Ngày học',
    dayOfWeek: resolvedDay,
    date,
    displayDate: dateLabel(date),
    startTime,
    endTime,
    startAt: `${date}T${startTime}:00+07:00`,
    endAt: `${date}T${endTime}:00+07:00`,
    periods: periodLabel,
    room,
    phong_hoc: room,
    lecturer,
    ten_giang_vien: lecturer,
    credits: Number.isNaN(credits) ? 3 : credits,
    so_tin_chi: Number.isNaN(credits) ? 3 : credits,
    group,
    className,
    occurrenceKey,
    weekNumber: week?.tuan_hoc_ky || week?.tuan || week?.so_tuan || null,
    status: 'upcoming'
  };
}

function scheduleWeekMetadata(week, range) {
  const number = week?.tuan_hoc_ky || week?.tuan || week?.so_tuan || null;
  return {
    number,
    startDate: range.startDate,
    endDate: range.endDate,
    startLabel: dateLabel(range.startDate),
    endLabel: dateLabel(range.endDate),
    label: week?.ten_tuan || (number ? `Tuần ${number}` : 'Tuần học')
  };
}

function exactOccurrenceKey(item) {
  return item.occurrenceKey;
}

function selectRelevantSchedule(rawData, now) {
  const rawWeeks = Array.isArray(rawData?.ds_tuan_tkb) ? rawData.ds_tuan_tkb : [];
  const datedWeeks = rawWeeks.map((week) => ({
    week,
    range: normalizeWeekRange(week)
  })).filter(({ range }) => range);

  // A response without an explicit week range cannot be safely related to the
  // student's real calendar. Do not fall back to weekday-only cards: that was
  // the source of stale, all-semester schedules being presented as current.
  if (datedWeeks.length === 0) {
    return {
      scheduleStatus: 'date_range_unavailable',
      isLiveSchedule: false,
      isCurrentWeek: false,
      week: null,
      items: [],
      nextOccurrence: null,
      upcomingOccurrence: null
    };
  }

  const orderedWeeks = [...datedWeeks].sort((a, b) => a.range.startDate.localeCompare(b.range.startDate));
  const activeWeek = orderedWeeks.find(({ range }) => range.startDate <= now.date && now.date <= range.endDate) || null;

  const occurrencesFor = ({ week, range }) => {
    const seen = new Set();
    return weekItems(week)
      .map((item) => normalizeOccurrence(item, week, range))
      .filter(Boolean)
      .filter((item) => {
        const key = exactOccurrenceKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  };

  const availableFor = (candidate) => occurrencesFor(candidate).filter((item) => `${item.date}T${item.endTime}` > now.key);
  let selected = activeWeek;
  let items = selected ? availableFor(selected) : [];

  // If there is no current week, or every session in it has finished, show the
  // nearest future week with a session. This avoids returning stale sessions
  // on a Sunday evening or after the final class of the week.
  if (items.length === 0) {
    const futureWeeks = orderedWeeks.filter(({ range }) => range.startDate > now.date);
    for (const candidate of futureWeeks) {
      const candidateItems = availableFor(candidate);
      if (candidateItems.length > 0) {
        selected = candidate;
        items = candidateItems;
        break;
      }
    }
  }

  if (!selected || items.length === 0) {
    return {
      scheduleStatus: 'no_upcoming',
      isLiveSchedule: Boolean(activeWeek),
      isCurrentWeek: Boolean(activeWeek),
      week: activeWeek ? scheduleWeekMetadata(activeWeek.week, activeWeek.range) : null,
      items: [],
      nextOccurrence: null,
      upcomingOccurrence: null
    };
  }

  const isCurrentWeek = selected === activeWeek;
  items = items.map((item) => ({
    ...item,
    status: `${item.date}T${item.startTime}` <= now.key && now.key < `${item.date}T${item.endTime}`
      ? 'ongoing'
      : 'upcoming'
  })).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'ongoing' ? -1 : 1;
    return a.startAt.localeCompare(b.startAt);
  });

  const ongoingOccurrence = items.find((item) => item.status === 'ongoing') || null;
  const upcomingOccurrence = items.find((item) => item.status === 'upcoming') || null;

  return {
    scheduleStatus: items[0].status === 'ongoing' ? 'ongoing' : 'upcoming',
    isLiveSchedule: isCurrentWeek,
    isCurrentWeek,
    week: scheduleWeekMetadata(selected.week, selected.range),
    items,
    // Keep this field backwards-compatible as the first remaining occurrence
    // (which can be a class already in progress). The UI must use
    // upcomingOccurrence to label the class a student should prepare for next.
    nextOccurrence: ongoingOccurrence || upcomingOccurrence,
    upcomingOccurrence
  };
}

function profileTimeoutSignal() {
  const configured = Number.parseInt(process.env.BDU_PROFILE_TIMEOUT_MS || '', 10);
  const timeoutMs = Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_PROFILE_TIMEOUT_MS;
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
}

function invalidSessionError() {
  const error = new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  error.status = 401;
  error.code = 'AUTH_INVALID';
  return error;
}

// A response from the upstream portal is the only authority that can tell us a
// BDU token is invalid. In particular, do not turn a DNS/TLS failure, a BDU
// 5xx, or a HTML maintenance page into a 401: callers would log the student
// out even though retrying later is the correct action.
function profileUnavailableError(message = 'Dịch vụ BDU tạm thời không phản hồi. Vui lòng thử lại.') {
  const error = new Error(message);
  error.status = 503;
  error.code = 'AUTH_UNAVAILABLE';
  error.retryable = true;
  return error;
}

async function fetchProfilePayload(url, options) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: profileTimeoutSignal() });
  } catch (cause) {
    const error = profileUnavailableError();
    error.cause = cause;
    throw error;
  }

  const status = Number(response?.status);
  // Some existing unit-test doubles do not include a status. A real Fetch
  // Response always does, so treat an omitted status as the successful shape
  // these backwards-compatible doubles intend.
  const effectiveStatus = Number.isFinite(status) && status > 0 ? status : 200;
  if (effectiveStatus === 400 || effectiveStatus === 401) throw invalidSessionError();
  if (effectiveStatus < 200 || effectiveStatus >= 300) throw profileUnavailableError();

  let data;
  try {
    data = await response.json();
  } catch (cause) {
    const error = profileUnavailableError('Dịch vụ BDU trả về dữ liệu không hợp lệ. Vui lòng thử lại.');
    error.cause = cause;
    throw error;
  }

  if (!data || typeof data !== 'object') {
    throw profileUnavailableError('Dịch vụ BDU trả về dữ liệu không hợp lệ. Vui lòng thử lại.');
  }
  if (data.code === 400 || data.code === 401) throw invalidSessionError();
  if (data.result === false) {
    throw profileUnavailableError(data.message || 'Dịch vụ BDU tạm thời không phản hồi. Vui lòng thử lại.');
  }
  return data;
}

function normalizeStudentImageValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^data:image\/[a-z0-9+.-]+;base64,/i.test(raw)) return raw;

  const compact = raw.replace(/\s+/g, '');
  if (compact.length >= 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    const mime = compact.startsWith('iVBOR')
      ? 'image/png'
      : (compact.startsWith('UklGR') ? 'image/webp' : (compact.startsWith('R0lGO') ? 'image/gif' : 'image/jpeg'));
    return `data:${mime};base64,${compact}`;
  }

  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/') && raw.length < 2048 && !raw.startsWith('/9j/')) {
    return raw;
  }

  return null;
}

function findStudentImage(payload, depth = 0) {
  if (payload === null || payload === undefined || depth > 8) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        const found = findStudentImage(parsed, depth + 1);
        if (found) return found;
      } catch {}
    }
    return normalizeStudentImageValue(payload);
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findStudentImage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof payload !== 'object') return null;

  const preferredKeys = [
    'image', 'student_image', 'hinh_anh', 'url_hinh_anh', 'avatar',
    'anh_the', 'duong_dan', 'photo', 'picture', 'file_anh', 'str_image',
    'image_base64', 'anh_sinh_vien'
  ];
  for (const preferred of preferredKeys) {
    for (const [key, value] of Object.entries(payload)) {
      if (key.toLowerCase() !== preferred) continue;
      const found = findStudentImage(value, depth + 1);
      if (found) return found;
    }
  }
  for (const value of Object.values(payload)) {
    const found = findStudentImage(value, depth + 1);
    if (found) return found;
  }
  return null;
}

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
        },
        body: ''
      });

      if (!response.ok) return null;
      let data;
      if (typeof response.text === 'function') {
        const text = await response.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      } else if (typeof response.json === 'function') {
        data = await response.json();
      }
      return findStudentImage(data);
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
      fetchProfilePayload(profileUrl, {
        method: profileMethod,
        headers: {
          'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
          'Accept': 'application/json, text/plain, */*',
          'idpc': '0',
          ...(profileMethod === 'POST' ? { 'Content-Type': 'text/plain' } : {})
        },
        ...(profileMethod === 'POST' ? { body: '' } : {})
      }),
      maSV ? this.getStudentImage(token, maSV) : Promise.resolve(null)
    ]);

    const data = profileRes || {};

    // Attach student photo if fetched or found in payload
    const finalImage = imageBase64 || findStudentImage(data);

    if (finalImage) {
      data.student_image = finalImage;
      if (data.data) {
        if (Array.isArray(data.data) && data.data.length > 0) {
          data.data[0].hinh_anh = finalImage;
        } else if (typeof data.data === 'object') {
          data.data.hinh_anh = finalImage;
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
  async getSchedule(token = '', hocKy = null, options = {}) {
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
            const relevantSchedule = selectRelevantSchedule(rawData, hcmNow(options.now));

            return {
              isRealData: true,
              semesters: semestersList,
              selectedHocKy: parseInt(targetHocKy, 10),
              ...relevantSchedule
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

export const BduServiceInternals = { findStudentImage, normalizeStudentImageValue };
