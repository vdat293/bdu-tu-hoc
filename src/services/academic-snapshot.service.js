import { isDatabaseConfigured, query } from '../db/database.js';
import { gpaLevel } from './academic-ranking.service.js';

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

function toNumber(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const normalized = String(value).trim().replace(',', '.');
  if (!normalized || normalized === '--') return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '' && String(value).trim() !== '--';
}

function pickClassification(semester, gpa4) {
  const raw = semester?.xep_loai_tkb_hk
    ?? semester?.xep_loai_tkb_hk_eg
    ?? semester?.xep_loai_tich_luy;
  const text = String(raw ?? '').trim();
  if (text && text !== '--') return text;
  return gpaLevel(gpa4);
}

/**
 * Trích học lực tích lũy mới nhất từ payload điểm BDU (/srm/w-locdsdiemsinhvien).
 * Bám sát logic client `latestSummary` (client/src/features/gpa/grades.js) để số
 * liệu hiển thị giữa trang GPA và hồ sơ không lệch nhau.
 *
 * Trả về null khi payload không có dữ liệu học kỳ nào.
 */
export function extractAcademicSnapshot(payload) {
  const raw = payload?.data || payload;
  const semesters = Array.isArray(raw?.ds_diem_hocky)
    ? raw.ds_diem_hocky
    : (Array.isArray(raw) ? raw : []);
  if (!semesters.length) return null;

  const latest = semesters.find((semester) => hasValue(semester?.dtb_tich_luy_he_10)) || semesters[0] || {};
  const gpa10 = toNumber(latest.dtb_tich_luy_he_10 ?? latest.dtb_hk_he10);
  const gpa4 = toNumber(latest.dtb_tich_luy_he_4 ?? latest.dtb_hk_he4);
  const earnedCredits = toNumber(latest.so_tin_chi_dat_tich_luy ?? latest.so_tin_chi_dat_hk);

  if (gpa10 === null && gpa4 === null && earnedCredits === null) return null;

  const semesterCode = latest.hoc_ky ?? latest.ma_hoc_ky ?? latest.ten_hoc_ky ?? null;

  return {
    gpa_10: gpa10,
    gpa_4: gpa4,
    earned_credits: earnedCredits,
    classification: pickClassification(latest, gpa4),
    semester_code: semesterCode === null ? null : String(semesterCode)
  };
}

export const AcademicSnapshotService = {
  extractAcademicSnapshot,

  hasDatabase() {
    return isDatabaseConfigured();
  },

  /**
   * Lưu snapshot học lực. Chỉ ghi đè field nào payload có dữ liệu để payload
   * thiếu (BDU trả partial) không xoá mất số liệu đã lưu trước đó.
   */
  async saveFromGrades(mssv, gradePayload, { source = 'bdu_login' } = {}) {
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanMssv || !isDatabaseConfigured()) return null;
    const summary = extractAcademicSnapshot(gradePayload);
    if (!summary) return null;

    const result = await query(`
      INSERT INTO student_academic_snapshots (
        mssv, gpa_10, gpa_4, earned_credits, classification, semester_code, source, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (mssv) DO UPDATE SET
        gpa_10 = COALESCE(EXCLUDED.gpa_10, student_academic_snapshots.gpa_10),
        gpa_4 = COALESCE(EXCLUDED.gpa_4, student_academic_snapshots.gpa_4),
        earned_credits = COALESCE(EXCLUDED.earned_credits, student_academic_snapshots.earned_credits),
        classification = COALESCE(EXCLUDED.classification, student_academic_snapshots.classification),
        semester_code = COALESCE(EXCLUDED.semester_code, student_academic_snapshots.semester_code),
        source = EXCLUDED.source,
        updated_at = NOW()
      RETURNING *;
    `, [
      cleanMssv,
      summary.gpa_10,
      summary.gpa_4,
      summary.earned_credits,
      summary.classification,
      summary.semester_code,
      String(source || 'bdu_login').slice(0, 40)
    ]);
    return result.rows[0] || null;
  },

  async getSnapshot(mssv) {
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanMssv || !isDatabaseConfigured()) return null;
    const result = await query(
      'SELECT * FROM student_academic_snapshots WHERE mssv = $1 LIMIT 1',
      [cleanMssv]
    );
    return result.rows[0] || null;
  }
};
