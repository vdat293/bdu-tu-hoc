/**
 * ttcds-student.service.js — Chi tiết "Sinh viên của tôi" (Trung tâm CĐS) đọc
 * từ kho ODP local (`odp_*`, migration 059) thay cho proxy Dashboard BE.
 *
 * Giữ ĐÚNG 3 method + shape mà `ttcds.controller.js` (và frontend) đang dùng:
 *   - `searchStudents(q, { limit })`
 *   - `getStudent(mssv)`
 *   - `getAttendance(mssv, { ma_mon_hoc, ma_nhom, nkhk })`
 *
 * Quy ước lỗi: lỗi mang `.status` (400 khi truy vấn tìm kiếm quá ngắn, 404 khi
 * không có sinh viên / không có nhật ký điểm danh) — controller passthrough
 * `.status` sẵn nên đổi nguồn không đổi mã lỗi HTTP.
 *
 * Nhãn học kỳ suy trực tiếp từ `nkhk` bằng `hocKyLabel` của Task 1 (một công
 * thức duy nhất), KHÔNG viết bản thứ hai.
 *
 * Quy tắc điểm danh: "có mặt" chỉ tính `Có`/`Sớm`/`Trễ`/`Phép`; `Vắng` tách
 * riêng và tuyệt đối không lọt vào `di_hoc`.
 */
import { query } from '../db/database.js';
import { hocKyLabel } from './odp-sync.service.js';

/** Trạng thái điểm danh được tính là "có mặt" (KHÔNG gồm `Vắng`). */
const DI_HOC_STATUSES = ['Có', 'Sớm', 'Trễ', 'Phép'];
const VANG_STATUS = 'Vắng';
const DI_HOC_SQL_LIST = `'${DI_HOC_STATUSES.join("', '")}'`;

const SEARCH_MIN_LENGTH = 2;
const DEFAULT_SEARCH_LIMIT = 30;
const MAX_SEARCH_LIMIT = 100;

/** MSSV là BIGINT; so khớp dạng text để MSSV lạ/không phải số trả 404 thay vì lỗi cast. */
const MSSV_MATCH = 'mssv::text = $1';

function statusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function blankToNull(value) {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}

/** Gộp nhãn học kỳ (`hoc_ky`, `nien_khoa`, `ten_nien_khoa`, `ten_hoc_ky`) vào dòng. */
function withTermLabel(row) {
  return { ...row, ...hocKyLabel(row.nkhk) };
}

/** Mã môn của `odp_bang_diem` không có cột riêng → suy từ tiền tố `ma_nhom` (`INF0873_25262_01`). */
function courseCodeFromNhom(maNhom) {
  const text = String(maNhom ?? '').trim();
  return text ? text.split('_')[0] : null;
}

/** Nhãn thứ trong tuần từ `thu_kieu_so` (8 = Chủ nhật), khớp cách hiển thị của frontend. */
function weekdayLabel(thuKieuSo) {
  const value = Number(thuKieuSo);
  if (!Number.isInteger(value) || value < 1) return null;
  return value === 8 ? 'Chủ nhật' : `Thứ ${value}`;
}

/** Tách danh sách MSSV (chuỗi JSON `[24050126, ...]` hoặc bất kỳ text) thành Set. */
function participantSet(danhSachSv) {
  const matches = String(danhSachSv ?? '').match(/\d{6,12}/g) || [];
  return new Set(matches);
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

async function buildStudentDetail(key) {
  const profileResult = await query(
    `SELECT mssv, ten_day_du, ma_lop, ten_lop, ma_khoa, ten_khoa, ma_nganh, ten_nganh,
            ma_chuyen_nganh, ten_chuyen_nganh, hien_dien, nk
     FROM odp_sinh_vien
     WHERE ${MSSV_MATCH}`,
    [key]
  );
  if (profileResult.rows.length === 0) {
    throw statusError('Không tìm thấy sinh viên.', 404);
  }
  const profile = profileResult.rows[0];
  const hoSo = {
    mssv: String(profile.mssv),
    ten_day_du: profile.ten_day_du,
    ma_lop: profile.ma_lop,
    ten_lop: profile.ten_lop,
    ma_khoa: profile.ma_khoa,
    ten_khoa: profile.ten_khoa,
    ma_nganh: profile.ma_nganh,
    ten_nganh: profile.ten_nganh,
    ma_chuyen_nganh: profile.ma_chuyen_nganh,
    ten_chuyen_nganh: profile.ten_chuyen_nganh,
    hien_dien: profile.hien_dien,
    nien_khoa: profile.nk
  };

  const [gpa, bangDiem, diemDanh, diemDanhMon, renLuyen, thoiKhoaBieu, suKien] = await Promise.all([
    query(
      `SELECT nkhk, dtb_hk_he_4, dtb_hk_he_10, dtb_tich_luy_he_4, dtb_tich_luy_he_10,
              so_tin_chi_dat_hk, so_tin_chi_dat_tich_luy, xep_loai_hoc_ki
       FROM odp_tbhk
       WHERE ${MSSV_MATCH}
       ORDER BY nkhk`,
      [key]
    ),
    query(
      // `odp_bang_diem.tin_chi` luôn NULL (nguồn không có cột) → lấy từ `odp_mon_hoc`
      // theo mã môn suy từ prefix `ma_nhom` (cùng quy tắc `courseCode()` của
      // academic-ranking.service.js: phần trước dấu `_` đầu tiên). So khớp KHÔNG
      // phân biệt hoa/thường ở cả hai vế để mã môn nguồn lệch case vẫn nối được.
      `SELECT d.nkhk, d.ma_nhom, d.ten_mon_hoc, d.diem_hp, d.diem_hp_4, d.diem_chu_hp, d.dat_hp,
              COALESCE(d.tin_chi, m.tin_chi) AS tin_chi
       FROM odp_bang_diem d
       LEFT JOIN odp_mon_hoc m
         ON upper(trim(m.ma_mon_hoc)) = upper(trim(split_part(d.ma_nhom, '_', 1)))
       WHERE d.mssv::text = $1
       ORDER BY d.nkhk, d.ma_nhom`,
      [key]
    ),
    query(
      `SELECT nkhk,
              COUNT(*) FILTER (WHERE diem_danh IN (${DI_HOC_SQL_LIST}))::int AS di_hoc,
              COUNT(*) FILTER (WHERE diem_danh = '${VANG_STATUS}')::int AS vang,
              COUNT(*) FILTER (WHERE diem_danh IS NULL)::int AS chua
       FROM odp_diem_danh
       WHERE ${MSSV_MATCH}
       GROUP BY nkhk
       ORDER BY nkhk`,
      [key]
    ),
    query(
      `SELECT nkhk, ma_mon_hoc,
              COUNT(*)::int AS so_buoi,
              COUNT(*) FILTER (WHERE diem_danh IN (${DI_HOC_SQL_LIST}))::int AS di_hoc,
              COUNT(*) FILTER (WHERE diem_danh = '${VANG_STATUS}')::int AS vang,
              COUNT(*) FILTER (WHERE diem_danh IS NULL)::int AS chua,
              MAX(ten_mon_hoc) AS ten_mon_hoc
       FROM odp_diem_danh
       WHERE ${MSSV_MATCH}
       GROUP BY nkhk, ma_mon_hoc
       ORDER BY nkhk, ma_mon_hoc`,
      [key]
    ),
    query(
      `SELECT nkhk, hoc_ki, lop, diem_ren_luyen, xep_loai
       FROM odp_ren_luyen
       WHERE ${MSSV_MATCH}
       ORDER BY nkhk`,
      [key]
    ),
    query(
      `SELECT id, nkhk, ma_nhom, ma_mon_hoc, ten_mon_hoc, nhom_hoc, ma_giang_vien,
              ten_giang_vien, ma_phong, buoi_thu, thu_kieu_so, tiet_bat_dau, so_tiet,
              ngay_hoc::text AS ngay_hoc, tuan_bat_dau, tuan_ket_thuc, danh_sach_sv
       FROM odp_thoi_khoa_bieu
       WHERE danh_sach_sv LIKE '%' || $1 || '%'
       ORDER BY nkhk, ngay_hoc, tiet_bat_dau`,
      [key]
    ),
    query(
      `SELECT id, ten_su_kien, loai, the_loai, ngay_dien_ra::text AS ngay_dien_ra, nkhk, danh_sach_sv
       FROM odp_su_kien
       WHERE danh_sach_sv LIKE '%' || $1 || '%'
       ORDER BY ngay_dien_ra DESC`,
      [key]
    )
  ]);

  return {
    tim_thay: true,
    ho_so: hoSo,
    gpa_hoc_ky: gpa.rows.map((row) => withTermLabel({
      nkhk: row.nkhk,
      dtb_hk_he_4: toNumber(row.dtb_hk_he_4),
      dtb_hk_he_10: toNumber(row.dtb_hk_he_10),
      dtb_tich_luy_he_4: toNumber(row.dtb_tich_luy_he_4),
      dtb_tich_luy_he_10: toNumber(row.dtb_tich_luy_he_10),
      so_tin_chi_dat_hk: toNumber(row.so_tin_chi_dat_hk),
      so_tin_chi_dat_tich_luy: toNumber(row.so_tin_chi_dat_tich_luy),
      xep_loai_hoc_ki: row.xep_loai_hoc_ki
    })),
    bang_diem: bangDiem.rows.map((row) => {
      const credits = row.tin_chi === null || row.tin_chi === undefined ? null : toNumber(row.tin_chi);
      const grade10 = toNumber(row.diem_hp);
      const grade4 = toNumber(row.diem_hp_4);
      return withTermLabel({
        nkhk: row.nkhk,
        ma_nhom: row.ma_nhom,
        ma_mon_hoc: courseCodeFromNhom(row.ma_nhom),
        ten_mon_hoc: row.ten_mon_hoc,
        ten_mon: row.ten_mon_hoc,
        tin_chi: credits,
        so_tin_chi: credits,
        diem_hp: grade10,
        diem: grade10,
        diem_hp_4: grade4,
        diem_he_4: grade4,
        diem_chu_hp: row.diem_chu_hp,
        diem_chu: row.diem_chu_hp,
        dat_hp: row.dat_hp
      });
    }),
    diem_danh: diemDanh.rows.map((row) => withTermLabel({
      nkhk: row.nkhk,
      di_hoc: row.di_hoc,
      vang: row.vang,
      chua: row.chua
    })),
    diem_danh_mon: diemDanhMon.rows.map((row) => withTermLabel({
      nkhk: row.nkhk,
      ma_mon_hoc: row.ma_mon_hoc,
      so_buoi: row.so_buoi,
      di_hoc: row.di_hoc,
      vang: row.vang,
      chua: row.chua,
      ten_mon_hoc: row.ten_mon_hoc
    })),
    thoi_khoa_bieu: thoiKhoaBieu.rows
      .filter((row) => participantSet(row.danh_sach_sv).has(key))
      .map((row) => withTermLabel({
        id: row.id,
        nkhk: row.nkhk,
        ma_nhom: row.ma_nhom,
        ma_mon_hoc: row.ma_mon_hoc,
        ten_mon_hoc: row.ten_mon_hoc,
        ten_mon: row.ten_mon_hoc,
        nhom_hoc: row.nhom_hoc,
        ma_giang_vien: row.ma_giang_vien,
        ten_giang_vien: row.ten_giang_vien,
        giang_vien: row.ten_giang_vien,
        ma_phong: row.ma_phong,
        phong: row.ma_phong,
        buoi_thu: row.buoi_thu,
        thu_kieu_so: row.thu_kieu_so,
        thu: weekdayLabel(row.thu_kieu_so),
        tiet_bat_dau: row.tiet_bat_dau,
        so_tiet: row.so_tiet,
        ngay_hoc: row.ngay_hoc,
        tuan_bat_dau: row.tuan_bat_dau,
        tuan_ket_thuc: row.tuan_ket_thuc
      })),
    ren_luyen: renLuyen.rows.map((row) => withTermLabel({
      nkhk: row.nkhk,
      hoc_ki: row.hoc_ki,
      lop: row.lop,
      diem_ren_luyen: toNumber(row.diem_ren_luyen),
      xep_loai: row.xep_loai
    })),
    su_kien: suKien.rows
      .filter((row) => participantSet(row.danh_sach_sv).has(key))
      .map((row) => withTermLabel({
        id: row.id,
        ten_su_kien: row.ten_su_kien,
        loai: row.loai,
        the_loai: row.the_loai,
        ngay_dien_ra: row.ngay_dien_ra,
        ngay: row.ngay_dien_ra,
        nkhk: row.nkhk
      }))
  };
}

export const TtcdsStudentService = {
  /** Tìm sinh viên theo tiền tố MSSV hoặc tên (ILIKE). Trả `{ ket_qua }` như Dashboard cũ. */
  async searchStudents(q, { limit } = {}) {
    const term = String(q ?? '').trim();
    if (term.length < SEARCH_MIN_LENGTH) {
      throw statusError('Nhập ít nhất 2 ký tự để tìm kiếm.', 400);
    }
    const parsed = Number.parseInt(limit, 10);
    const size = Math.min(
      Math.max(Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SEARCH_LIMIT, 1),
      MAX_SEARCH_LIMIT
    );
    const escaped = escapeLike(term);
    const result = await query(
      `SELECT mssv, ten_day_du, ma_lop, ma_khoa, ten_khoa, hien_dien
       FROM odp_sinh_vien
       WHERE mssv::text LIKE $1 OR ten_day_du ILIKE $2
       ORDER BY mssv
       LIMIT $3`,
      [`${escaped}%`, `%${escaped}%`, size]
    );
    return {
      ket_qua: result.rows.map((row) => ({
        mssv: String(row.mssv),
        ten_day_du: row.ten_day_du,
        ma_lop: row.ma_lop,
        ma_khoa: row.ma_khoa,
        ten_khoa: row.ten_khoa,
        hien_dien: row.hien_dien
      }))
    };
  },

  /**
   * Chi tiết sinh viên (`traCuuSinhVien`): `ho_so, gpa_hoc_ky, bang_diem,
   * diem_danh, diem_danh_mon, thoi_khoa_bieu, ren_luyen, su_kien`.
   * Không có trong `odp_sinh_vien` → 404.
   */
  async getStudent(mssv) {
    return buildStudentDetail(String(mssv ?? '').trim());
  },

  /**
   * Nhật ký điểm danh theo môn/nhóm/kỳ. Không có bản ghi khớp → 404.
   * Trả `{ tong_so_buoi, so_buoi_vang, nhat_ky }` (shape NhatKyDiemDanh cũ).
   */
  async getAttendance(mssv, { ma_mon_hoc, ma_nhom, nkhk } = {}) {
    const key = String(mssv ?? '').trim();
    const mon = blankToNull(ma_mon_hoc);
    const nhom = blankToNull(ma_nhom);
    const parsedTerm = Number.parseInt(nkhk, 10);
    const term = Number.isInteger(parsedTerm) ? parsedTerm : null;
    const result = await query(
      `SELECT ngay::text AS ngay, buoi, ma_nhom, ma_mon_hoc, ten_mon_hoc, nkhk, diem_danh, gio_co_mat
       FROM odp_diem_danh
       WHERE ${MSSV_MATCH}
         AND ($2::text IS NULL OR ma_mon_hoc = $2)
         AND ($3::text IS NULL OR ma_nhom = $3)
         AND ($4::int IS NULL OR nkhk = $4)
       ORDER BY ngay, buoi`,
      [key, mon, nhom, term]
    );
    if (result.rows.length === 0) {
      throw statusError('Không tìm thấy nhật ký điểm danh.', 404);
    }
    return {
      tong_so_buoi: result.rows.length,
      so_buoi_vang: result.rows.filter((row) => row.diem_danh === VANG_STATUS).length,
      nhat_ky: result.rows.map((row) => ({
        ngay: row.ngay,
        buoi: row.buoi,
        ma_nhom: row.ma_nhom,
        ma_mon_hoc: row.ma_mon_hoc,
        ten_mon_hoc: row.ten_mon_hoc,
        nkhk: row.nkhk,
        diem_danh: row.diem_danh,
        gio_co_mat: row.gio_co_mat,
        co_mat: DI_HOC_STATUSES.includes(row.diem_danh)
      }))
    };
  }
};
