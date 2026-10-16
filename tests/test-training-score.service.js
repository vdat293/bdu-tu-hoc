import assert from 'node:assert/strict';
import { TrainingScoreServiceInternals } from '../src/modules/training/training-score.service.js';

const { normalizeSemesters, normalizeCriteria, detectMuc5Selection, applyMuc5Selection, describeSelection } = TrainingScoreServiceInternals;
const { mapSemesterToCdsCode, applyScores, buildMuc5Scores, buildBonusScores } = TrainingScoreServiceInternals;
const { parseEventParticipants, summarizeStudentEvents, buildEventsCriterion, formatEventDate } = TrainingScoreServiceInternals;

// --- normalizeSemesters ------------------------------------------------------
const semesters = normalizeSemesters({
  data: {
    ds_hoc_ky: [
      { hoc_ky: 20252, ten_hoc_ky: 'Học kỳ 2', hiendiensv: 1, ngay_bat_dau_hk: '05/01/2026' },
      { hoc_ky: 20251, ten_hoc_ky: 'Học kỳ 1', hiendiensv: 0 },
      { hoc_ky: null, ten_hoc_ky: 'Rác' }
    ]
  }
});
assert.equal(semesters.length, 2, 'Bỏ học kỳ thiếu mã');
assert.equal(semesters[0].hocKy, 20252);
assert.equal(semesters[0].hienThiDiem, true, 'hiendiensv=1 -> đang mở');
assert.equal(semesters[1].hienThiDiem, false);

// --- criteria fixture --------------------------------------------------------
const makeCriteria = () => ({
  hoc_ky: 20252,
  is_ReadOnly: false,
  id_ket_qua_dgrl: 'abc',
  ghi_chu_sv: 'ghi chú',
  xep_loai_ren_luyen: 'Tốt',
  diem_ren_luyen: 0,
  ds_nhom_cau_hoi: [
    {
      so_thu_tu: '1',
      noi_dung: 'Học tập',
      tong_diem_toi_da: 20,
      tong_diem_tu_danh_gia: 20,
      ds_cau_hoi: [{ so_thu_tu: '1.1', noi_dung: 'Mặc định', diem_toi_da: 20, diem_tu_danh_gia: 20, is_enable: false }]
    },
    {
      so_thu_tu: '5',
      noi_dung: 'Cán bộ lớp',
      tong_diem_toi_da: 10,
      tong_diem_tu_danh_gia: 10,
      ds_cau_hoi: [
        { so_thu_tu: '5.1', noi_dung: 'Cấp trường', diem_toi_da: 10, diem_tu_danh_gia: 0, is_enable: true },
        { so_thu_tu: '5.2', noi_dung: 'Lớp trưởng', diem_toi_da: 8, diem_tu_danh_gia: 0, is_enable: true },
        { so_thu_tu: '5.3', noi_dung: 'Lớp phó', diem_toi_da: 7, diem_tu_danh_gia: 7, is_enable: true },
        { so_thu_tu: '5.4', noi_dung: 'Thành viên CLB', diem_toi_da: 3, diem_tu_danh_gia: 3, is_enable: true },
        { so_thu_tu: '5.5', noi_dung: 'Không hoàn thành nhiệm vụ', diem_toi_da: 0, diem_tu_danh_gia: 0, is_enable: true }
      ]
    }
  ]
});

const summary = normalizeCriteria(makeCriteria());
assert.equal(summary.total, 30, 'Tổng = 20 (mục 1) + 10 (mục 5)');
assert.equal(summary.muc5.diem, 10);
assert.equal(summary.groups.length, 2);

// --- detectMuc5Selection -----------------------------------------------------
const detected = detectMuc5Selection(makeCriteria());
assert.deepEqual(detected.roles, ['5.3', '5.4'], 'Đọc đúng chức vụ đang có điểm');
assert.equal(detected.penalty, false, '5.5 = 0 -> không vi phạm');

const withPenalty = detectMuc5Selection((() => {
  const data = makeCriteria();
  data.ds_nhom_cau_hoi[1].ds_cau_hoi[4].diem_tu_danh_gia = -10;
  return data;
})());
assert.equal(withPenalty.penalty, true, '5.5 < 0 -> có vi phạm');

// --- applyMuc5Selection ------------------------------------------------------
const original = makeCriteria();
const applied = applyMuc5Selection(original, { roles: ['5.2'], penalty: false });
assert.notEqual(applied, original, 'Phải trả bản sao, không sửa dữ liệu gốc');
assert.equal(original.ds_nhom_cau_hoi[1].ds_cau_hoi[2].diem_tu_danh_gia, 7, 'Dữ liệu gốc không bị đổi');

const g5 = applied.ds_nhom_cau_hoi[1];
const valueOf = (group, so) => group.ds_cau_hoi.find((q) => q.so_thu_tu === so).diem_tu_danh_gia;
assert.equal(valueOf(g5, '5.2'), 8, '5.2 nhận điểm tối đa của câu');
assert.equal(valueOf(g5, '5.3'), 0, 'Chức vụ không chọn bị xoá điểm');
assert.equal(valueOf(g5, '5.4'), 0);
assert.equal(g5.tong_diem_tu_danh_gia, 8, 'Tổng nhóm = min(8, 10)');
assert.equal(applied.ds_nhom_cau_hoi[0].ds_cau_hoi[0].diem_tu_danh_gia, 20, 'Mục 1 giữ nguyên');
assert.equal(applied.ghi_chu_sv, 'ghi chú', 'Giữ ghi_chu_sv để cổng không mất ghi chú');

// Nhiều chức vụ -> tổng nhóm bị chặn ở điểm tối đa nhóm.
const capped = applyMuc5Selection(makeCriteria(), { roles: ['5.1', '5.2'], penalty: false });
assert.equal(capped.ds_nhom_cau_hoi[1].tong_diem_tu_danh_gia, 10, 'Tổng nhóm chặn ở 10');

// Có vi phạm 5.5 -> trừ điểm.
const penalised = applyMuc5Selection(makeCriteria(), { roles: ['5.2'], penalty: true });
const g5p = penalised.ds_nhom_cau_hoi[1];
assert.equal(valueOf(g5p, '5.5'), -10, '5.5 = -10 khi tick vi phạm');
assert.equal(g5p.tong_diem_tu_danh_gia, -2, '8 - 10 = -2, không bị chặn dưới');

// --- describeSelection -------------------------------------------------------
assert.equal(describeSelection({ roles: ['5.2'], penalty: false }), '5.2');
assert.equal(describeSelection({ roles: [], penalty: false }), 'không giữ chức vụ');
assert.match(describeSelection({ roles: ['5.1'], penalty: true }), /vi phạm 5\.5/);

// --- mapSemesterToCdsCode ----------------------------------------------------
assert.equal(mapSemesterToCdsCode(20252), '25262', 'HK2 2025-2026 -> 25262');
assert.equal(mapSemesterToCdsCode(20253), '25263', 'HK3 2025-2026 -> 25263');
assert.equal(mapSemesterToCdsCode(20251), '25261');
assert.equal(mapSemesterToCdsCode(20243), '24253');
assert.equal(mapSemesterToCdsCode(''), null);

// --- Tiêu chí 6.16 từ kho sự kiện ODP (dim_su_kien_odp) -----------------------
assert.deepEqual(parseEventParticipants('[24050122, 24050008]'), ['24050122', '24050008'], 'chuỗi JSON array MSSV');
assert.deepEqual(parseEventParticipants([24050122, ' 24050008 ']), ['24050122', '24050008'], 'array số/chuỗi');
assert.deepEqual(parseEventParticipants('24050122;24050008'), ['24050122', '24050008'], 'chuỗi phân tách');
assert.deepEqual(parseEventParticipants(null), [], 'null -> rỗng');
assert.deepEqual(parseEventParticipants('[not-json'), [], 'không parse được -> rỗng');

const eventRows = [
  { id: 1, ten_su_kien: 'Seminar A', diem_cong: 1, nkhk: 25262, ngay_dien_ra: 'Sun, 16 Mar 2025 00:00:00 GMT', danh_sach_sv: '[24050122, 24050008]', the_loai: null },
  { id: 2, ten_su_kien: 'Event B', diem_cong: 4, nkhk: 25262, ngay_dien_ra: 'Tue, 18 Mar 2025 00:00:00 GMT', danh_sach_sv: '[24050008]', the_loai: null },
  { id: 3, ten_su_kien: 'Kỳ khác', diem_cong: 1, nkhk: 25261, ngay_dien_ra: 'Tue, 18 Mar 2025 00:00:00 GMT', danh_sach_sv: '[24050122]', the_loai: null }
];
const sum25262 = summarizeStudentEvents(eventRows, { hocKy: 20252, mssv: '24050122' });
assert.equal(sum25262.nkhk, '25262', 'cổng 20252 -> nkhk ODP 25262');
assert.equal(sum25262.total, 1, 'chỉ cộng sự kiện cùng kỳ có tên mình');
assert.equal(sum25262.events.length, 1);
assert.equal(sum25262.events[0].ten, 'Seminar A');

const sumOther = summarizeStudentEvents(eventRows, { hocKy: 20252, mssv: '99999999' });
assert.equal(sumOther.total, 0, 'không tham gia -> 0 điểm');
assert.deepEqual(sumOther.events, []);

const sumBad = summarizeStudentEvents(eventRows, { hocKy: '', mssv: '24050122' });
assert.equal(sumBad.total, 0, 'học kỳ không hợp lệ -> 0 điểm');

assert.equal(formatEventDate('Sun, 16 Mar 2025 00:00:00 GMT'), '16-03-2025');
assert.equal(formatEventDate('không phải ngày'), '');

const crit616 = buildEventsCriterion({ nkhk: '25262', total: 5, events: [{ id: 1, ten: 'A', diemCong: 1, ngay: '16-03-2025', theLoai: null }] });
assert.equal(crit616.so, '6.16');
assert.equal(crit616.diemThucTe, 5, 'giữ tổng điểm thô ODP để hiển thị');
assert.equal(crit616.minhChung.length, 1);
assert.match(crit616.minhChung[0].giaTri, /\+1/);

// --- applyScores gộp mục 5 và 6.16 -------------------------------------------
const withBonus = makeCriteria();
withBonus.ds_nhom_cau_hoi.push({
  so_thu_tu: '6',
  noi_dung: 'Điểm cộng trong học kỳ',
  tong_diem_toi_da: 100,
  tong_diem_tu_danh_gia: 0,
  ds_cau_hoi: [{ so_thu_tu: '6.16', diem_toi_da: 4, diem_tu_danh_gia: 0 }]
});
const merged = applyScores(withBonus, {
  ...buildMuc5Scores(withBonus, { roles: ['5.3'], penalty: false }),
  ...buildBonusScores(withBonus, 9)
});
const g6 = merged.ds_nhom_cau_hoi.find((group) => group.so_thu_tu === '6');
assert.equal(g6.ds_cau_hoi[0].diem_tu_danh_gia, 9, 'bonus 6.16 lấy nguyên điểm thô CDS (9)');
assert.equal(g6.tong_diem_tu_danh_gia, 9, 'tổng nhóm 6 = 9');
assert.equal(merged.ds_nhom_cau_hoi[1].ds_cau_hoi.find((q) => q.so_thu_tu === '5.3').diem_tu_danh_gia, 7);
assert.deepEqual(buildBonusScores(withBonus, ''), {}, 'không đồng bộ -> không thêm điểm');
assert.equal(buildBonusScores(withBonus, -5)['6.16'], 0, 'điểm âm kéo về 0');

console.log('✓ Điểm rèn luyện: chỉ chấm mục 5, chặn tổng nhóm, giữ nguyên các mục khác.');
