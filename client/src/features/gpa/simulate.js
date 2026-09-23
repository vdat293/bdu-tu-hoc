import { calculateRank, numericCredits } from './grades.js';

/**
 * Logic "Tính thử điểm còn thiếu" (giả lập GPA) — chạy 100% phía trình duyệt.
 * Không gửi điểm nhập thử lên server, không thay đổi bảng điểm thật.
 *
 * Công thức BDU hiện tại: TK = 0.4 × GK + 0.6 × CK (thang 10).
 */

export const MIDTERM_WEIGHT = 0.4;
export const FINAL_WEIGHT = 0.6;

/** Cách tính điểm tổng kết theo từng môn (sinh viên tự chọn khi tính thử). */
export const FORMULAS = Object.freeze([
  { id: '46', gkWeight: 0.4, finalWeight: 0.6, needsGk: true, label: 'Giữa kỳ 40% + Thi 60%' },
  { id: '55', gkWeight: 0.5, finalWeight: 0.5, needsGk: true, label: 'Giữa kỳ 50% + Thi 50%' },
  { id: '100', gkWeight: 0, finalWeight: 1, needsGk: false, label: 'Chỉ điểm thi (100%)' }
]);

const FORMULA_MAP = new Map(FORMULAS.map((formula) => [formula.id, formula]));

export function getFormula(id) {
  return FORMULA_MAP.get(String(id ?? '')) || FORMULA_MAP.get('46');
}

export function isKnownFormula(id) {
  return FORMULA_MAP.has(String(id ?? ''));
}

/** Câu giải thích ngắn cho sinh viên, ví dụ "Tổng kết = 40% giữa kỳ + 60% thi". */
export function formulaDescription(id) {
  const formula = getFormula(id);
  if (!formula.needsGk) return 'Tổng kết = điểm thi';
  return `Tổng kết = ${Math.round(formula.gkWeight * 100)}% giữa kỳ + ${Math.round(formula.finalWeight * 100)}% thi`;
}

/** Các môn điều kiện: vẫn xét Đạt/Chưa đạt nhưng KHÔNG cộng vào GPA. */
export const EXCLUDED_FROM_GPA = Object.freeze([
  'SKI0011',
  'SKI0021',
  'SKI0061',
  'SKI0071',
  'SKI0091',
  'MIL0013',
  'MIL0022',
  'MIL0032',
  'MIL0072',
  'PHE0251',
  'PHE0261',
  'PHE271'
]);

const EXCLUDED_SET = new Set(EXCLUDED_FROM_GPA);

export function normalizeCourseCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function isExcludedCourse(course = {}) {
  return EXCLUDED_SET.has(normalizeCourseCode(course.ma_mon));
}

export function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '' && String(value).trim() !== '--';
}

/** Chấp nhận cả dấu phẩy thập phân kiểu Việt Nam ("8,5"). */
export function parseScore(raw) {
  if (!hasValue(raw)) return Number.NaN;
  const parsed = Number.parseFloat(String(raw).trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function isValidScore(raw) {
  const value = parseScore(raw);
  return Number.isFinite(value) && value >= 0 && value <= 10;
}

const KNOWN_FINAL_LETTER = /^(?:A|B\+?|C\+?|D\+?|F\+?)$/;

function hasFinalLetter(course = {}) {
  const letter = String(course.diem_tk_chu ?? course.diem_chu_hp_4 ?? course.diem_chu ?? '').trim().toUpperCase();
  return KNOWN_FINAL_LETTER.test(letter);
}

/**
 * Môn đã có điểm tổng kết (dưới bất kỳ dạng nào: TK thang 10 / hệ 4 / chữ)
 * thì bị KHÓA, không cho tính thử. Có điểm GK/Thi nhưng chưa có TK thì vẫn
 * được tính thử phần còn thiếu.
 */
export function hasFinalGrade(course = {}) {
  return (
    hasValue(course.diem_tk ?? course.diem_hp) ||
    hasValue(course.diem_tk_so ?? course.diem_hp_4) ||
    hasFinalLetter(course)
  );
}

export function isSimulatable(course = {}) {
  return !hasFinalGrade(course);
}

/** Điểm GK thật (nếu portal đã trả về). Dùng để giữ nguyên, không cho sửa. */
export function getRealMidterm(course = {}) {
  const value = parseScore(course.diem_giua_ky ?? course.diem_gk ?? course.diem_qt);
  return Number.isFinite(value) ? value : null;
}

export function calcTK(gk, ck, formulaId = '46') {
  const formula = getFormula(formulaId);
  const result = formula.gkWeight * gk + formula.finalWeight * ck;
  return Math.round(result * 100) / 100;
}

/**
 * Bảng quy đổi TK (thang 10) → hệ 4 / điểm chữ (thang phổ biến của VN).
 * Ngưỡng dưới là bao đóng (ví dụ 8.5 → A, 8.49 → B+).
 */
export function convert10toGrade(tk10) {
  const score = Number(tk10);
  if (!Number.isFinite(score)) return { he4: null, chu: null };
  if (score >= 8.5) return { he4: 4.0, chu: 'A' };
  if (score >= 8.0) return { he4: 3.5, chu: 'B+' };
  if (score >= 7.0) return { he4: 3.0, chu: 'B' };
  if (score >= 6.5) return { he4: 2.5, chu: 'C+' };
  if (score >= 5.5) return { he4: 2.0, chu: 'C' };
  if (score >= 5.0) return { he4: 1.5, chu: 'D+' };
  if (score >= 4.0) return { he4: 1.0, chu: 'D' };
  return { he4: 0, chu: 'F' };
}

/**
 * Giải quyết một môn tính thử: ưu tiên giữ GK thật (khóa), chỉ lấy phần nhập.
 * Cách tính (46/55/100) lấy theo từng môn; môn "chỉ thi" bỏ qua điểm GK.
 * @param course Môn học từ portal.
 * @param simEntry { gk, ck, formula } chuỗi thô từ ô nhập (có thể rỗng).
 */
export function resolveSimulatedCourse(course = {}, simEntry = {}) {
  const formula = getFormula(simEntry.formula);
  const realGk = getRealMidterm(course);
  const inputGk = parseScore(simEntry.gk);
  const inputCk = parseScore(simEntry.ck);
  const gk = formula.needsGk ? (realGk ?? (Number.isFinite(inputGk) ? inputGk : null)) : null;
  const ck = Number.isFinite(inputCk) ? inputCk : null;
  const usesRealGk = formula.needsGk && realGk !== null;
  if (ck === null || (formula.needsGk && gk === null)) {
    return { complete: false, formulaId: formula.id, gk, ck, tk10: null, he4: null, chu: null, passed: false, usesRealGk };
  }
  const tk10 = calcTK(gk ?? 0, ck, formula.id);
  const { he4, chu } = convert10toGrade(tk10);
  return { complete: true, formulaId: formula.id, gk, ck, tk10, he4, chu, passed: tk10 >= 4, usesRealGk };
}

/** Điểm thật đã công bố của một môn (null khi chưa có / không quy được). */
export function getRealGrade(course = {}) {
  const tkRaw = course.diem_tk ?? course.diem_hp;
  const tk10 = parseScore(tkRaw);
  const he4Raw = course.diem_tk_so ?? course.diem_hp_4;
  const he4Parsed = parseScore(he4Raw);
  let he4 = Number.isFinite(he4Parsed) ? he4Parsed : null;
  let chu = hasValue(course.diem_tk_chu ?? course.diem_chu_hp_4 ?? course.diem_chu)
    ? String(course.diem_tk_chu ?? course.diem_chu_hp_4 ?? course.diem_chu).trim().toUpperCase()
    : null;
  if (he4 === null && Number.isFinite(tk10)) {
    const converted = convert10toGrade(tk10);
    he4 = converted.he4;
    chu = chu ?? converted.chu;
  }
  if (!Number.isFinite(tk10) && he4 === null) return { tk10: null, he4: null, chu, graded: false };
  return { tk10: Number.isFinite(tk10) ? tk10 : null, he4, chu, graded: true };
}

function newAccumulator() {
  return { sum10: 0, credits10: 0, sum4: 0, credits4: 0, earnedCredits: 0, countedCourses: 0 };
}

function addToAccumulator(acc, { tk10, he4, credits, passed }) {
  if (Number.isFinite(tk10) && credits > 0) {
    acc.sum10 += tk10 * credits;
    acc.credits10 += credits;
  }
  if (Number.isFinite(he4) && credits > 0) {
    acc.sum4 += he4 * credits;
    acc.credits4 += credits;
  }
  if (passed) acc.earnedCredits += credits;
  acc.countedCourses += 1;
}

function finalizeAccumulator(acc) {
  const gpa10 = acc.credits10 > 0 ? Math.round((acc.sum10 / acc.credits10) * 100) / 100 : null;
  const gpa4 = acc.credits4 > 0 ? Math.round((acc.sum4 / acc.credits4) * 100) / 100 : null;
  return {
    gpa10,
    gpa4,
    rank: gpa10 === null && gpa4 === null ? 'Chưa xếp loại' : calculateRank(gpa10 ?? '', gpa4 ?? ''),
    countedCredits: Math.round(acc.credits4 * 100) / 100,
    earnedCredits: Math.round(acc.earnedCredits * 100) / 100
  };
}

/** Đạt khi TK >= 4 (hoặc hệ 4 >= 1 nếu chỉ có hệ 4); chữ F coi như chưa đạt. */
function derivePass({ tk10, he4, chu }) {
  if (['F', 'F+', 'I', 'X'].includes(String(chu || '').toUpperCase())) return false;
  if (Number.isFinite(tk10)) return tk10 >= 4;
  if (Number.isFinite(he4)) return he4 >= 1;
  return false;
}

/** Cộng điểm thật của một môn vào bộ tích lũy (bỏ qua môn điều kiện). */
function absorbRealCourse(acc, course, credits) {
  const grade = getRealGrade(course);
  if (grade.graded && !isExcludedCourse(course) && credits > 0) {
    addToAccumulator(acc, { tk10: grade.tk10, he4: grade.he4, credits, passed: derivePass(grade) });
  }
}

/**
 * Cộng một môn vào bộ tích lũy tính thử: ưu tiên điểm thử đã nhập đủ,
 * ngược lại dùng điểm thật. Môn điều kiện vẫn xét tín chỉ Đạt.
 */
function absorbSimCourse(acc, course, credits, resolved) {
  const excluded = isExcludedCourse(course);
  if (resolved?.complete) {
    if (!excluded && credits > 0) {
      addToAccumulator(acc, { tk10: resolved.tk10, he4: resolved.he4, credits, passed: resolved.passed });
    } else {
      acc.countedCourses += 1;
      if (resolved.passed) acc.earnedCredits += credits;
    }
    return;
  }
  const grade = getRealGrade(course);
  if (grade.graded && !excluded && credits > 0) {
    addToAccumulator(acc, { tk10: grade.tk10, he4: grade.he4, credits, passed: derivePass(grade) });
  } else if (grade.graded) {
    acc.countedCourses += 1;
  }
}

export function makeSimKey(semId, courseCode) {
  return `${String(semId ?? '')}::${normalizeCourseCode(courseCode)}`;
}

export function getSemesterId(sem = {}) {
  return String(sem.hoc_ky ?? sem.ten_hoc_ky ?? '');
}

/**
 * Tính GPA thực tế + GPA tính thử cho MỘT học kỳ.
 * @param courses Danh sách môn của kỳ.
 * @param simEntries Map key → { gk, ck } (chỉ cần entry của kỳ này).
 * @param semId Id kỳ, dùng để ghép key.
 */
export function computeSemesterSimulation(courses = [], simEntries = {}, semId = '') {
  const real = newAccumulator();
  const sim = newAccumulator();
  let simulatableCount = 0;
  let simulatedCompleteCount = 0;
  let excludedCount = 0;

  for (const course of courses) {
    const credits = numericCredits(course.so_tin_chi, 0);
    const excluded = isExcludedCourse(course);
    if (excluded) excludedCount += 1;

    const realGrade = getRealGrade(course);
    absorbRealCourse(real, course, credits);
    if (realGrade.graded && !excluded && credits <= 0) {
      // Môn có điểm nhưng số tín chỉ = 0: vẫn ghi nhận số môn, bỏ qua trọng số.
      real.countedCourses += 1;
    }

    if (isSimulatable(course)) {
      simulatableCount += 1;
      const key = makeSimKey(semId, course.ma_mon);
      const resolved = resolveSimulatedCourse(course, simEntries[key]);
      if (resolved.complete) simulatedCompleteCount += 1;
      absorbSimCourse(sim, course, credits, resolved.complete ? resolved : null);
    } else {
      absorbSimCourse(sim, course, credits, null);
    }
    // Môn chưa có điểm và chưa nhập thử: bỏ qua ở cả hai vế.
  }

  return {
    simulatableCount,
    simulatedCompleteCount,
    excludedCount,
    hasSimulation: simulatedCompleteCount > 0,
    real: finalizeAccumulator(real),
    sim: finalizeAccumulator(sim)
  };
}

/**
 * Tính GPA tích lũy thực tế + tính thử trên TOÀN BỘ các kỳ đã tải.
 * Đây là ước tính (portal mới là số liệu chuẩn của phòng đào tạo).
 */
export function computeCumulativeSimulation(semesters = [], simEntries = {}) {
  const real = newAccumulator();
  const sim = newAccumulator();

  for (const sem of semesters) {
    const semId = getSemesterId(sem);
    for (const course of sem.ds_diem_mon_hoc || []) {
      const credits = numericCredits(course.so_tin_chi, 0);
      absorbRealCourse(real, course, credits);
      const simulatable = isSimulatable(course);
      const resolved = simulatable ? resolveSimulatedCourse(course, simEntries[makeSimKey(semId, course.ma_mon)]) : null;
      absorbSimCourse(sim, course, credits, resolved?.complete ? resolved : null);
    }
  }

  return { hasSimulation: sim.countedCourses > real.countedCourses || sim.earnedCredits !== real.earnedCredits || sim.sum4 !== real.sum4, real: finalizeAccumulator(real), sim: finalizeAccumulator(sim) };
}

export function simStorageKey(mssv) {
  return `bdu:gpa-sim:${String(mssv || 'guest').trim() || 'guest'}`;
}

/**
 * Tín chỉ dự kiến = tín chỉ thật do trường công bố + số tín chỉ tăng thêm
 * nhờ các môn tính thử Đạt. Trả về null khi không có gì để dự kiến.
 */
export function projectedCredits(portalCredits, cumulative) {
  const base = Number(portalCredits);
  if (!Number.isFinite(base)) return null;
  const delta = (cumulative?.sim?.earnedCredits ?? 0) - (cumulative?.real?.earnedCredits ?? 0);
  if (!(delta > 0)) return null;
  return Math.round((base + delta) * 100) / 100;
}

export function loadSimState(storage, mssv) {
  try {
    const raw = storage?.getItem?.(simStorageKey(mssv));
    if (!raw) return { ack: false, entries: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ack: false, entries: {} };
    const entries = parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
    const clean = {};
    for (const [key, value] of Object.entries(entries)) {
      if (!value || typeof value !== 'object') continue;
      const gk = typeof value.gk === 'string' || typeof value.gk === 'number' ? String(value.gk) : '';
      const ck = typeof value.ck === 'string' || typeof value.ck === 'number' ? String(value.ck) : '';
      const formula = isKnownFormula(value.formula) && String(value.formula) !== '46' ? String(value.formula) : '';
      if (gk === '' && ck === '' && formula === '') continue;
      clean[key] = { gk, ck };
      if (formula) clean[key].formula = formula;
    }
    return { ack: parsed.ack === true, entries: clean };
  } catch {
    return { ack: false, entries: {} };
  }
}

export function saveSimState(storage, mssv, state) {
  try {
    storage?.setItem?.(simStorageKey(mssv), JSON.stringify({ ack: state.ack === true, entries: state.entries || {} }));
  } catch {
    // Bộ nhớ trình duyệt đầy hoặc bị chặn: bỏ qua, tính thử vẫn dùng được trong phiên.
  }
}
