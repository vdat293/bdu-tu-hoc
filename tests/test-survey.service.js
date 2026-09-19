import assert from 'node:assert/strict';
import { SurveyServiceInternals } from '../src/services/survey.service.js';

const groups = [
  {
    thang_do: {
      ds_thang_diem: [
        { thu_tu_thang_diem: 0, gia_tri_thang_diem: 0 },
        { thu_tu_thang_diem: 1, gia_tri_thang_diem: 1 },
        { thu_tu_thang_diem: 3, gia_tri_thang_diem: 3 },
        { thu_tu_thang_diem: 5, gia_tri_thang_diem: 5 }
      ]
    },
    ds_cau_hoi: [
      { thu_tu_cau_hoi: 1, kieu_tra_loi: 5 },
      { thu_tu_cau_hoi: 3, kieu_tra_loi: 5 },
      { thu_tu_cau_hoi: 40, kieu_tra_loi: 5, is_y_kien_khac: true }
    ]
  },
  {
    is_thang_do: false,
    ds_cau_hoi: [
      { thu_tu_cau_hoi: 41, kieu_tra_loi: 6 },
      { thu_tu_cau_hoi: 42, kieu_tra_loi: 6, is_y_kien_khac: true }
    ]
  }
];

const answers = SurveyServiceInternals.buildAnswers(groups, {
  ratingLevel: '3',
  genderLevel: '0',
  attendanceLevel: '1',
  feedback: 'Nội dung cũ không được phép dùng'
});

assert.equal(answers[1].tra_loi_danh_gia, 0, 'Câu giới tính vẫn dùng mức đã nhận diện');
assert.equal(answers[2].tra_loi_danh_gia, 3, 'Câu đánh giá vẫn dùng mức cấu hình');
assert.equal(answers[3].tra_loi_danh_gia, 3, 'Câu thang điểm kèm ý kiến khác vẫn giữ mức cấu hình');
assert.equal(answers[3].tra_loi_khac, 'Không', 'Ô ý kiến khác của câu thang điểm trả lời Không');
assert.equal(answers[4].tra_loi_danh_gia, 'Không', 'Câu tự luận (kieu_tra_loi=6) phải điền Không vào tra_loi_danh_gia');
assert.equal(answers[5].tra_loi_danh_gia, 'Không', 'Câu tự luận có is_y_kien_khac cũng điền Không');
assert.equal(answers[5].tra_loi_khac, 'Không', 'Câu tự luận có is_y_kien_khac điền Không ở cả hai trường');
assert.notEqual(answers[4].tra_loi_danh_gia, 5, 'Câu tự luận không được nhận điểm 5 mặc định');

console.log('✓ Survey answers keep per-course ratings and force open-ended answers to "Không".');
