export function getSemesters(response) {
  const raw = response?.data || response;
  return raw?.ds_diem_hocky || (Array.isArray(raw) ? raw : []);
}

export function formatScore(value) {
  if (value === undefined || value === null || value === '' || value === '--') return '--';
  const number = Number.parseFloat(value);
  return Number.isNaN(number) ? String(value) : number.toFixed(2);
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
      const passed = course.ket_qua == 1 || (course.diem_tk_chu && String(course.diem_tk_chu).toUpperCase() !== 'F');
      const matchesStatus = status === 'PASS' ? passed : status === 'FAIL' ? !passed : true;
      const haystack = `${course.ma_mon || ''} ${course.ten_mon || ''}`.toLocaleLowerCase('vi-VN');
      return matchesStatus && (!normalizedQuery || haystack.includes(normalizedQuery));
    }).map((course) => ({ ...course, semesterLabel: sem.ten_hoc_ky || sem.hoc_ky }));
  });
}

export function latestSummary(semesters) {
  const latest = semesters.find((sem) => sem.dtb_tich_luy_he_10 !== undefined && sem.dtb_tich_luy_he_10 !== '') || semesters[0] || {};
  const gpa10 = latest.dtb_tich_luy_he_10 ?? latest.dtb_hk_he10;
  const gpa4 = latest.dtb_tich_luy_he_4 ?? latest.dtb_hk_he4;
  return { gpa10: formatScore(gpa10), gpa4: formatScore(gpa4), credits: latest.so_tin_chi_dat_tich_luy ?? latest.so_tin_chi_dat_hk ?? 0, rank: latest.xep_loai_tkb_hk || calculateRank(gpa10, gpa4) };
}

export function buildGradesCsv(semesters, filters = {}) {
  const rows = [['Học Kỳ', 'Mã Môn', 'Tên Môn Học', 'Số Tín Chỉ', 'Điểm GK', 'Điểm Thi', 'Điểm TK (10)', 'Điểm Hệ 4', 'Điểm Chữ', 'Kết Quả']];
  semesters.forEach((sem) => {
    const id = String(sem.hoc_ky ?? sem.ten_hoc_ky ?? '');
    if (filters.semester && filters.semester !== 'ALL' && id !== String(filters.semester)) return;
    (sem.ds_diem_mon_hoc || []).forEach((course) => {
      const passed = course.ket_qua == 1 || (course.diem_tk_chu && String(course.diem_tk_chu).toUpperCase() !== 'F');
      if (filters.status === 'PASS' && !passed || filters.status === 'FAIL' && passed) return;
      const values = [sem.ten_hoc_ky || sem.hoc_ky, course.ma_mon || '', course.ten_mon || '', course.so_tin_chi || 0, course.diem_giua_ky || '', course.diem_thi || '', course.diem_tk || '', course.diem_tk_so || '', course.diem_tk_chu || '', passed ? 'Đạt' : 'Chưa đạt'];
      rows.push(values.map((value) => `"${String(value).replaceAll('"', '""')}"`));
    });
  });
  return `\uFEFF${rows.map((row) => row.join(',')).join('\n')}`;
}
