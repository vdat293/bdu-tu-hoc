export function getSemesters(response) {
  const raw = response?.data || response;
  return raw?.ds_diem_hocky || (Array.isArray(raw) ? raw : []);
}

export function formatScore(value) {
  if (value === undefined || value === null || value === '' || value === '--') return '--';
  const number = Number.parseFloat(value);
  return Number.isNaN(number) ? String(value) : number.toFixed(2);
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '' && String(value).trim() !== '--';
}

function numericValue(value) {
  if (!hasValue(value)) return Number.NaN;
  const parsed = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function numericCredits(value, fallback = 0) {
  const parsed = numericValue(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * BDU sends either an explicit result, a letter, or a final numeric score.
 * Empty result fields mean the course is still ungraded and must not be shown
 * as failed just because it has not been published yet.
 */
export function getCourseResult(course = {}) {
  const letter = String(course.diem_tk_chu ?? course.diem_chu_hp_4 ?? course.diem_chu ?? '').trim().toUpperCase();
  const knownLetter = /^(?:A|B\+?|C\+?|D\+?|F\+?|P|I|X)$/.test(letter);
  const hasPublishedNumeric = hasValue(course.diem_tk ?? course.diem_hp) || hasValue(course.diem_tk_so ?? course.diem_hp_4);
  const hasPublishedGrade = knownLetter || hasPublishedNumeric;
  const rawResult = course.dat_hp ?? course.ket_qua;
  if (hasValue(rawResult)) {
    const normalized = String(rawResult).trim().toLocaleLowerCase('vi-VN');
    if (rawResult === true || ['1', 'true', 'đạt', 'dat', 'pass', 'passed'].includes(normalized)) {
      return { status: 'passed', passed: true, graded: true };
    }
    const isDefaultFailure = (rawResult === false || normalized === '0' || normalized === 'false') && !hasPublishedGrade;
    if (!isDefaultFailure && (rawResult === false || ['0', 'false', 'không đạt', 'khong dat', 'rớt', 'rot', 'fail', 'failed'].includes(normalized))) {
      return { status: 'failed', passed: false, graded: true };
    }
  }

  if (knownLetter) {
    const failed = ['F', 'F+', 'I', 'X'].includes(letter);
    return { status: failed ? 'failed' : 'passed', passed: !failed, graded: true };
  }

  const grade10 = numericValue(course.diem_tk ?? course.diem_hp);
  if (Number.isFinite(grade10)) {
    const passed = grade10 >= 4;
    return { status: passed ? 'passed' : 'failed', passed, graded: true };
  }

  const grade4 = numericValue(course.diem_tk_so ?? course.diem_hp_4);
  if (Number.isFinite(grade4)) {
    const passed = grade4 >= 1;
    return { status: passed ? 'passed' : 'failed', passed, graded: true };
  }

  return { status: 'ungraded', passed: false, graded: false };
}

export function calculateRank(gpa10, gpa4) {
  const four = Number.parseFloat(gpa4);
  const ten = Number.parseFloat(gpa10);
  if (!Number.isNaN(four) && four > 0) return four >= 3.6 ? 'Xuất sắc' : four >= 3.2 ? 'Giỏi' : four >= 2.5 ? 'Khá' : four >= 2 ? 'Trung bình' : 'Yếu';
  if (!Number.isNaN(ten) && ten > 0) return ten >= 9 ? 'Xuất sắc' : ten >= 8 ? 'Giỏi' : ten >= 6.5 ? 'Khá' : ten >= 5 ? 'Trung bình' : 'Yếu';
  return 'Đang học';
}

export function coursesForFilters(semesters, { semester = 'ALL', status = 'ALL', query = '' } = {}) {
  const normalizedQuery = query.trim().toLocaleLowerCase('vi-VN');
  return semesters.flatMap((sem) => {
    const id = String(sem.hoc_ky ?? sem.ten_hoc_ky ?? '');
    if (semester !== 'ALL' && id !== String(semester)) return [];
    return (sem.ds_diem_mon_hoc || []).filter((course) => {
      const result = getCourseResult(course);
      const matchesStatus = status === 'PASS' ? result.status === 'passed' : status === 'FAIL' ? result.status === 'failed' : true;
      const haystack = `${course.ma_mon || ''} ${course.ten_mon || ''}`.toLocaleLowerCase('vi-VN');
      return matchesStatus && (!normalizedQuery || haystack.includes(normalizedQuery));
    }).map((course) => ({ ...course, semesterLabel: sem.ten_hoc_ky || sem.hoc_ky }));
  });
}

export function latestSummary(semesters) {
  const latest = semesters.find((sem) => sem.dtb_tich_luy_he_10 !== undefined && sem.dtb_tich_luy_he_10 !== '') || semesters[0] || {};
  const gpa10 = latest.dtb_tich_luy_he_10 ?? latest.dtb_hk_he10;
  const gpa4 = latest.dtb_tich_luy_he_4 ?? latest.dtb_hk_he4;
  return { gpa10: formatScore(gpa10), gpa4: formatScore(gpa4), credits: numericCredits(latest.so_tin_chi_dat_tich_luy ?? latest.so_tin_chi_dat_hk), rank: latest.xep_loai_tkb_hk || calculateRank(gpa10, gpa4) };
}

export function buildGradesCsv(semesters, filters = {}) {
  const rows = [['Học Kỳ', 'Mã Môn', 'Tên Môn Học', 'Số Tín Chỉ', 'Điểm GK', 'Điểm Thi', 'Điểm TK (10)', 'Điểm Hệ 4', 'Điểm Chữ', 'Kết Quả']];
  const normalizedQuery = String(filters.query || '').trim().toLocaleLowerCase('vi-VN');
  semesters.forEach((sem) => {
    const id = String(sem.hoc_ky ?? sem.ten_hoc_ky ?? '');
    if (filters.semester && filters.semester !== 'ALL' && id !== String(filters.semester)) return;
    (sem.ds_diem_mon_hoc || []).forEach((course) => {
      const result = getCourseResult(course);
      if (filters.status === 'PASS' && result.status !== 'passed' || filters.status === 'FAIL' && result.status !== 'failed') return;
      const haystack = `${course.ma_mon || ''} ${course.ten_mon || ''}`.toLocaleLowerCase('vi-VN');
      if (normalizedQuery && !haystack.includes(normalizedQuery)) return;
      const values = [sem.ten_hoc_ky || sem.hoc_ky, course.ma_mon ?? '', course.ten_mon ?? '', course.so_tin_chi ?? 0, course.diem_giua_ky ?? '', course.diem_thi ?? '', course.diem_tk ?? '', course.diem_tk_so ?? '', course.diem_tk_chu ?? '', result.status === 'passed' ? 'Đạt' : result.status === 'failed' ? 'Chưa đạt' : 'Chưa có điểm'];
      rows.push(values.map((value) => `"${String(value).replaceAll('"', '""')}"`));
    });
  });
  return `\uFEFF${rows.map((row) => row.join(',')).join('\n')}`;
}
