import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AchievementInternals,
  extractSemesterResults
} from '../src/services/achievement.service.js';

const semesters = extractSemesterResults({
  data: {
    ds_diem_hocky: [
      { hoc_ky: '20243', ten_hoc_ky: 'HK3 2024', dtb_hk_he4: '3.90', xep_loai_hoc_ky: 'Xuất sắc', so_tin_chi_dat_hk: '21' },
      { hoc_ky: '20242', ten_hoc_ky: 'HK2 2024', dtb_hk_he4: '3.70', xep_loai_hoc_ky: 'Xuất sắc', so_tin_chi_dat_hk: '18' },
      { hoc_ky: '20241', ten_hoc_ky: 'HK1 2024', dtb_hk_he4: '3.40', xep_loai_hoc_ky: 'Giỏi', so_tin_chi_dat_hk: '20' },
      { hoc_ky: '20240', ten_hoc_ky: 'HK3 2023', dtb_hk_he4: '3.60', xep_loai_hoc_ky: 'Xuất sắc', so_tin_chi_dat_hk: '19' },
      { hoc_ky: '20250', ten_hoc_ky: 'Đang học', dtb_hk_he4: '', so_tin_chi_dat_hk: '' }
    ]
  }
});

assert.deepEqual(semesters.map((item) => item.semesterCode), ['20240', '20241', '20242', '20243']);
assert.equal(semesters[3].semesterGpa, 3.9);
assert.equal(semesters.some((item) => item.semesterCode === '20250'), false, 'Kỳ chưa có GPA không được tính');

const evaluate = AchievementInternals.evaluateAchievement;

const scholar = evaluate({
  rule_type: 'excellent_semester_count',
  rule_config: { count: 3, excellentGpa: 3.6 }
}, semesters);
assert.equal(scholar.qualifying_count, 3, '#Học bá phải đếm GPA học kỳ/loại học kỳ');

const rising = evaluate({
  rule_type: 'latest_consecutive_gpa_increases',
  rule_config: { increaseCount: 2, minDelta: 0.01 }
}, semesters);
assert.deepEqual(rising.deltas.map((item) => item.delta_gpa_4), [0.3, 0.2]);

const academicKing = evaluate({
  rule_type: 'all_semesters_min_gpa',
  rule_config: { minGpa: 3.2, minSemesters: 2 }
}, semesters);
assert.equal(academicKing.semester_count, 4);

const blockedKing = evaluate({
  rule_type: 'all_semesters_min_gpa',
  rule_config: { minGpa: 3.5, minSemesters: 2 }
}, semesters);
assert.equal(blockedKing, null, '#Vua học thuật không được dùng GPA tích lũy hoặc bỏ qua kỳ thấp');

const breakthrough = evaluate({
  rule_type: 'latest_gpa_delta',
  rule_config: { minDelta: 0.15 }
}, semesters);
assert.equal(breakthrough.deltas[0].delta_gpa_4, 0.2);

const creditWarrior = evaluate({
  rule_type: 'semester_credits_with_gpa',
  rule_config: { minCredits: 18, minGpa: 3.2 }
}, semesters);
assert.ok(creditWarrior, '18 tín chỉ và GPA kỳ 3.20+ phải mở #Chiến thần tín chỉ');

const exactlyTwentyCredits = [{
  semesterCode: '20251', semesterName: 'HK1', semesterGpa: 3.5,
  classification: 'Giỏi', earnedCredits: 20
}];
const overTwentyCredits = [{
  semesterCode: '20252', semesterName: 'HK2', semesterGpa: 3.5,
  classification: 'Giỏi', earnedCredits: 21
}];
const breakingLimitsDefinition = {
  rule_type: 'semester_credits_with_gpa',
  rule_config: { minCredits: 20, minGpa: 3.2 }
};
assert.ok(evaluate(breakingLimitsDefinition, exactlyTwentyCredits), 'Đúng 20 tín chỉ phải mở #Phá vỡ giới hạn');
assert.ok(evaluate(breakingLimitsDefinition, overTwentyCredits), 'Trên 20 tín chỉ vẫn phải mở #Phá vỡ giới hạn');

const migration = fs.readFileSync('migrations/010_student_achievements.sql', 'utf8');
const achievementService = fs.readFileSync('src/services/achievement.service.js', 'utf8');
assert.match(migration, /achievement_definitions/);
assert.match(migration, /student_achievement_unlocks/);
assert.match(achievementService, /is_active = TRUE/);
assert.match(achievementService, /student_not_active/);

const creditTierMigration = fs.readFileSync('migrations/011_credit_achievement_tiers.sql', 'utf8');
assert.match(creditTierMigration, /minCredits.*18/);
assert.match(creditTierMigration, /#Phá vỡ giới hạn/);
assert.match(creditTierMigration, /strictCredits.*true/);

const creditBackfillMigration = fs.readFileSync('migrations/012_backfill_credit_achievements.sql', 'utf8');
assert.match(creditBackfillMigration, /earned_credits >= 18/);
assert.match(creditBackfillMigration, /earned_credits > 20/);
assert.match(creditBackfillMigration, /students\.is_active = TRUE/);

const rarityMigration = fs.readFileSync('migrations/013_achievement_rarity.sql', 'utf8');
const appJs = fs.readFileSync('public/js/app.js', 'utf8');
const styleCss = fs.readFileSync('public/css/style.css', 'utf8');
assert.match(rarityMigration, /rarity IN \('common', 'rare', 'epic', 'legendary'\)/);
assert.match(rarityMigration, /academic_king.*scholar.*perfect_semester.*breaking_limits/);
assert.match(appJs, /rarity-\$\{title\.rarity\}/);
assert.match(styleCss, /\.identity-title-badge\.rarity-legendary/);
assert.match(styleCss, /prefers-reduced-motion: reduce/);

const breakingLimitsMigration = fs.readFileSync('migrations/014_breaking_limits_at_twenty.sql', 'utf8');
assert.match(breakingLimitsMigration, /earned_credits >= 20/);
assert.doesNotMatch(breakingLimitsMigration, /strictCredits/);

const ttcdsMigration = fs.readFileSync('migrations/015_ttcds_vip_title.sql', 'utf8');
assert.match(ttcdsMigration, /'#TTCDS'/);
assert.match(ttcdsMigration, /'Trung tâm Chuyển đổi số'/);
assert.match(ttcdsMigration, /'22050006'/);
assert.match(ttcdsMigration, /'24050126'/);
assert.match(ttcdsMigration, /'manual_assignment'/);
assert.match(ttcdsMigration, /'vip'/);
assert.match(appJs, /'legendary', 'vip'/);
assert.match(styleCss, /\.identity-title-badge\.rarity-vip/);
assert.doesNotMatch(styleCss, /content: 'VIP'/);
assert.match(styleCss, /achievement-ttcds-signal/);
assert.match(styleCss, /achievement-ttcds-scan/);

console.log('✓ Thành tựu dùng GPA từng kỳ, lưu delta và chỉ mở khóa cho cấu hình active.');
