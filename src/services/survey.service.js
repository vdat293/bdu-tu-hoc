const BDU_BASE_URL = 'https://sv.bdu.edu.vn/public/api';
const FORM_ENDPOINT = `${BDU_BASE_URL}/zms/w-locdsformdanhgia`;
const QUESTIONS_ENDPOINT = `${BDU_BASE_URL}/zms/w-locdscauhoidanhgia`;
const SUBMIT_ENDPOINT = `${BDU_BASE_URL}/zms/w-luutraloidanhgia`;

const DEFAULT_FEEDBACK = 'Giảng viên dạy nhiệt tình, phương pháp sinh động, tài liệu đầy đủ và hỗ trợ giải đáp thắc mắc của sinh viên rất tốt.';

function bearer(token) {
  const value = String(token || '').trim();
  return value.startsWith('Bearer ') ? value : `Bearer ${value}`;
}

function firstValue(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== null && value !== undefined && String(value).trim()) return value;
  }
  return null;
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (value === null || value === undefined) return false;
  return ['1', 'true', 'yes', 'y', 'đã khảo sát', 'da khao sat'].includes(String(value).trim().toLowerCase());
}

function apiError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isExpiredPayload(payload, status) {
  return status === 401 || status === 402 || payload?.code === 401 || payload?.code === 402
    || payload?.message === 'loggedoff' || /logged.?off|hết hạn|expired/i.test(String(payload?.message || ''));
}

async function postJson(url, token, body) {
  if (!token) throw apiError('Thiếu mã xác thực (Token). Vui lòng đăng nhập lại.', 401);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: bearer(token),
        Accept: 'application/json, text/plain, */*',
        idpc: '0',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
  } catch (cause) {
    const error = apiError('Không thể kết nối máy chủ khảo sát BDU.', 503);
    error.cause = cause;
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    const error = apiError('BDU trả về dữ liệu khảo sát không hợp lệ.', 502);
    error.cause = cause;
    throw error;
  }

  if (isExpiredPayload(payload, response.status)) throw apiError('Phiên đăng nhập BDU đã hết hạn. Vui lòng đăng nhập lại.', 401);
  if (!response.ok || (payload && payload.result === false) || (payload?.code && payload.code !== 200)) {
    throw apiError(payload?.message || 'BDU không xử lý được yêu cầu khảo sát.', response.status || 400);
  }
  return payload;
}

function normalizeCourse(record, context = {}) {
  const formId = firstValue(record, ['id_form_danh_gia', 'id_form', 'form_id']) || context.formId;
  const subjectId = firstValue(record, ['id_ds_doi_tuong', 'id_doi_tuong', 'id_doi_tuong_danh_gia']) || context.subjectId;
  if (formId === null || subjectId === null) return null;

  const completed = booleanValue(firstValue(record, [
    'da_khao_sat', 'is_da_khao_sat', 'is_tra_loi', 'da_tra_loi', 'is_danh_gia'
  ]));
  const formCode = firstValue(record, ['ma_form_danh_gia', 'ma_form', 'form_code']) || context.formCode || '';
  const formName = firstValue(record, ['ten_form_danh_gia', 'ten_form', 'form_name']) || context.formName || '';
  const courseCode = firstValue(record, ['ma_doi_tuong', 'ma_mon_hoc', 'ma_mon', 'ma_mh', 'ma_hoc_phan']) || '';
  const courseName = firstValue(record, ['ten_doi_tuong', 'ten_mon_hoc', 'ten_mon', 'ten_mh', 'ten_hoc_phan']) || '';
  const lecturer = firstValue(record, ['ten_bo_sung', 'ten_giang_vien', 'ten_cb_gd', 'ten_gv', 'giang_vien']) || '';

  return {
    surveyKey: `${formId}::${subjectId}`,
    formId: String(formId),
    subjectId: String(subjectId),
    respondentId: firstValue(record, ['id_ds_dap_vien', 'id_dap_vien']) || context.respondentId || null,
    formCode: String(formCode),
    formName: String(formName),
    courseCode: String(courseCode),
    courseName: String(courseName),
    lecturer: String(lecturer),
    semester: String(firstValue(record, ['ten_hoc_ky', 'hoc_ky', 'ky_danh_gia']) || ''),
    startDate: String(firstValue(record, ['ngay_bat_dau', 'ngay_bd', 'tu_ngay']) || ''),
    endDate: String(firstValue(record, ['ngay_ket_thuc', 'ngay_kt', 'den_ngay']) || ''),
    completed,
    raw: record
  };
}

function collectCourses(node, context, output) {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectCourses(item, context, output));
    return;
  }
  if (typeof node !== 'object') return;

  const nextContext = { ...context };
  const nodeFormId = firstValue(node, ['id_form_danh_gia', 'id_form', 'form_id']);
  if (nodeFormId !== null) nextContext.formId = nodeFormId;
  const nodeSubjectId = firstValue(node, ['id_ds_doi_tuong', 'id_doi_tuong', 'id_doi_tuong_danh_gia']);
  if (nodeSubjectId !== null) nextContext.subjectId = nodeSubjectId;
  const nodeFormCode = firstValue(node, ['ma_form_danh_gia', 'ma_form', 'form_code']);
  const nodeFormName = firstValue(node, ['ten_form_danh_gia', 'ten_form', 'form_name']);
  if (nodeFormCode !== null) nextContext.formCode = nodeFormCode;
  if (nodeFormName !== null) nextContext.formName = nodeFormName;

  const course = normalizeCourse(node, nextContext);
  if (course && (course.courseCode || course.courseName || course.lecturer)) output.push(course);

  for (const [key, value] of Object.entries(node)) {
    if (/header|footer|html/i.test(key)) continue;
    collectCourses(value, nextContext, output);
  }
}

function dedupeCourses(courses) {
  const map = new Map();
  for (const course of courses) {
    const previous = map.get(course.surveyKey);
    if (!previous || (!previous.courseName && course.courseName) || (!previous.lecturer && course.lecturer)) {
      map.set(course.surveyKey, course);
    } else if (course.completed) {
      map.set(course.surveyKey, { ...previous, completed: true });
    }
  }
  return [...map.values()];
}

function extractGroups(payload) {
  return payload?.data?.ds_nhom_cau_hoi || payload?.ds_nhom_cau_hoi || [];
}

function chooseScaleValue(scale, preferred, fallback = null) {
  const options = Array.isArray(scale) ? scale : [];
  const exact = options.find((item) => Number(item?.gia_tri_thang_diem) === Number(preferred));
  if (exact) return exact.gia_tri_thang_diem;
  const defaultOption = options.find((item) => Number(item?.thu_tu_thang_diem) === Number(preferred));
  if (defaultOption) return defaultOption.gia_tri_thang_diem;
  return options.length > 0 ? options[options.length - 1].gia_tri_thang_diem : fallback;
}

function buildAnswers(groups, { ratingLevel = '5', genderLevel = '0', attendanceLevel = '1', feedback = DEFAULT_FEEDBACK } = {}) {
  const answers = [{}];
  const rating = Number(ratingLevel) || 5;
  const gender = Number.isFinite(Number(genderLevel)) ? Number(genderLevel) : 0;
  const attendance = Number.isFinite(Number(attendanceLevel)) ? Number(attendanceLevel) : 1;
  const comment = String(feedback || DEFAULT_FEEDBACK).trim() || DEFAULT_FEEDBACK;

  for (const group of groups) {
    const scale = group?.thang_do?.ds_thang_diem || [];
    for (const question of group?.ds_cau_hoi || []) {
      const order = Number(question?.thu_tu_cau_hoi);
      const isText = booleanValue(question?.is_y_kien_khac) || booleanValue(group?.thang_do?.is_y_kien_khac);
      let value = '';
      let other = '';

      if (isText) {
        other = comment;
      } else if (order === 1) {
        value = chooseScaleValue(scale, gender, 0);
      } else if (order === 2) {
        value = chooseScaleValue(scale, attendance, 1);
      } else {
        value = chooseScaleValue(scale, rating, rating);
      }

      answers.push({
        thu_tu_cau_hoi: question?.thu_tu_cau_hoi,
        tra_loi_danh_gia: value,
        tra_loi_khac: other
      });
    }
  }
  return answers;
}

function parseSelected(selectedSurveys) {
  if (!Array.isArray(selectedSurveys)) return null;
  return new Set(selectedSurveys.map((item) => {
    if (typeof item === 'string') return item;
    return item?.surveyKey || `${item?.formId}::${item?.subjectId}`;
  }).filter(Boolean));
}

export const SurveyService = {
  async listAvailableSurveys({ token } = {}) {
    const payload = await postJson(FORM_ENDPOINT, token, {
      filter: { hoc_ky: 0, is_english: false, ma_form_danh_gia: null, ten_form_danh_gia: null },
      additional: { paging: { limit: 99999, page: 1 }, ordering: [{ name: null, order_type: null }] }
    });
    const courses = [];
    collectCourses(payload?.data ?? payload, {}, courses);
    return { items: dedupeCourses(courses), raw: payload };
  },

  async getQuestions({ token, formId, subjectId, respondentId } = {}) {
    const payload = await postJson(QUESTIONS_ENDPOINT, token, {
      filter: {
        is_english: true,
        id_form_danh_gia: formId,
        id_ds_doi_tuong: subjectId,
        ...(respondentId ? { id_ds_dap_vien: respondentId } : {})
      },
      additional: { pagin: { limit: 99999, page: 1 }, ordering: [{ name: '', order_type: 2 }] }
    });
    const groups = extractGroups(payload);
    if (!groups.length) throw apiError('Không tìm thấy câu hỏi cho môn khảo sát này.', 422);
    return { payload, groups };
  },

  async submitAnswers({ token, survey, answers } = {}) {
    const filter = {
      is_tieng_anh: true,
      id_form_danh_gia: survey.formId,
      id_ds_doi_tuong: survey.subjectId,
      ...(survey.respondentId ? { id_ds_dap_vien: survey.respondentId } : {})
    };
    return postJson(SUBMIT_ENDPOINT, token, { filter, ds_tra_loi: answers });
  },

  async runAutoSurvey({ token, mssv, ratingLevel = '5', genderLevel = '0', attendanceLevel = '1', feedback, feedbackScenarios, feedbackMode = 'random', courseRatings = {}, selectedSurveys, onLog }) {
    const log = (message, type = 'info') => {
      if (onLog) onLog({ message, type, timestamp: new Date().toLocaleTimeString('vi-VN') });
    };

    log(`🚀 Khởi động khảo sát cho MSSV: ${mssv || 'Sinh viên BDU'}...`);
    if (!token) {
      log('⚠️ Không tìm thấy phiên làm việc (Token). Vui lòng đăng nhập tài khoản BDU trước.', 'warning');
      return { success: false, processed: 0, total: 0, message: 'Thiếu mã xác thực (Token).' };
    }

    log('🔍 Đang lấy danh sách form và môn học cần khảo sát từ cổng BDU...');
    let listing;
    try {
      listing = await this.listAvailableSurveys({ token });
    } catch (error) {
      log(`⚠️ Không thể tải danh sách form khảo sát: ${error.message}`, 'warning');
      return { success: false, processed: 0, total: 0, message: error.message };
    }
    const pending = listing.items.filter((item) => !item.completed);
    const listedNames = listing.items.map((item) => item.courseCode || item.courseName || item.subjectId).filter(Boolean);
    log(`📡 w-locdsformdanhgia → nhận ${listing.items.length} môn: ${listedNames.join(', ') || 'không có dữ liệu'}`, 'muted');
    const selected = parseSelected(selectedSurveys);
    const targets = selected ? pending.filter((item) => selected.has(item.surveyKey)) : pending;

    if (!listing.items.length) {
      log('ℹ️ Cổng BDU không trả về môn nào trong đợt khảo sát hiện tại.');
      return { success: true, processed: 0, total: 0, message: 'Không có môn khảo sát đang mở.' };
    }
    if (!targets.length) {
      log(selected ? 'ℹ️ Không có môn nào trong lựa chọn đang chờ khảo sát.' : 'ℹ️ Tất cả môn trong đợt này đã được khảo sát.', 'info');
      return { success: true, processed: 0, total: pending.length, message: 'Không có môn khảo sát cần gửi.' };
    }

    log(`📚 Có ${pending.length} môn chờ khảo sát; sẽ xử lý ${targets.length} môn đã chọn.`);
    targets.forEach((item, index) => {
      const targetRating = courseRatings?.[item.surveyKey] || courseRatings?.[item.subjectId] || ratingLevel;
      log(`  🔹 [${index + 1}/${targets.length}] ${item.courseName || item.courseCode || item.subjectId}${item.lecturer ? ` - GV: ${item.lecturer}` : ''} (${targetRating} ⭐)`, 'muted');
    });

    let processed = 0;
    const failures = [];
    const comments = Array.isArray(feedbackScenarios) && feedbackScenarios.length > 0
      ? feedbackScenarios.filter((item) => String(item || '').trim())
      : [feedback || DEFAULT_FEEDBACK];
    for (const [index, survey] of targets.entries()) {
      try {
        const subjectLabel = survey.courseName || survey.courseCode || survey.subjectId;
        const effectiveRating = String(courseRatings?.[survey.surveyKey] || courseRatings?.[survey.subjectId] || ratingLevel || '5');
        log(`➡️ Mở môn ${index + 1}/${targets.length}: ${subjectLabel} (${survey.formId}::${survey.subjectId})`, 'info');
        log(`📡 w-locdscauhoidanhgia → lấy câu hỏi của ${subjectLabel}...`, 'muted');
        const { groups } = await this.getQuestions({ token, formId: survey.formId, subjectId: survey.subjectId, respondentId: survey.respondentId });
        const questionCount = groups.reduce((sum, group) => sum + (group.ds_cau_hoi?.length || 0), 0);
        const answers = buildAnswers(groups, {
          ratingLevel: effectiveRating,
          genderLevel,
          attendanceLevel,
          feedback: feedbackMode === 'random'
            ? comments[Math.floor(Math.random() * comments.length)]
            : comments[index % comments.length]
        });
        log(`📋 Mức đánh giá: ${effectiveRating} ⭐ | Đã nhận ${questionCount} câu hỏi, dựng ds_tra_loi; đang gửi phiếu...`, 'muted');
        await this.submitAnswers({ token, survey, answers });
        processed += 1;
        log(`✅ w-luutraloidanhgia → hoàn thành môn ${subjectLabel} (${effectiveRating} ⭐).`, 'success');
      } catch (error) {
        failures.push({ survey, message: error.message });
        log(`⚠️ Không thể gửi ${survey.courseName || survey.courseCode || survey.subjectId}: ${error.message}`, 'warning');
      }
    }

    const success = failures.length === 0;
    const message = success
      ? `Đã hoàn tất ${processed}/${targets.length} môn khảo sát.`
      : `Đã gửi ${processed}/${targets.length} môn; còn ${failures.length} môn chưa gửi được.`;
    log(`🏁 ${message}`, success ? 'success' : 'warning');
    return { success, processed, total: targets.length, failures, message };
  }
};

export const SurveyServiceInternals = { buildAnswers, dedupeCourses, normalizeCourse, parseSelected };
