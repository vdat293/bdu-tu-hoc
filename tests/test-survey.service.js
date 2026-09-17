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
      { thu_tu_cau_hoi: 1 },
      { thu_tu_cau_hoi: 3 },
      { thu_tu_cau_hoi: 41, is_y_kien_khac: true }
    ]
  },
  {
    thang_do: { is_y_kien_khac: true },
    ds_cau_hoi: [{ thu_tu_cau_hoi: 42 }]
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
assert.equal(answers[3].tra_loi_khac, 'Không', 'Câu 41 phải mặc định là Không');
assert.equal(answers[4].tra_loi_khac, 'Không', 'Câu 42 phải mặc định là Không');
assert.equal(answers[3].tra_loi_danh_gia, '', 'Câu tự luận không gửi giá trị thang điểm');
assert.equal(answers[4].tra_loi_danh_gia, '', 'Câu tự luận không gửi giá trị thang điểm');

console.log('✓ Survey answers keep per-course ratings and force open-ended answers to "Không".');
