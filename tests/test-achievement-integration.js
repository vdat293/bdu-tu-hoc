import assert from 'node:assert/strict';
import { AchievementService } from '../src/services/achievement.service.js';
import { closeDatabase, query } from '../src/db/database.js';

const TEST_MSSV = 'CODEX_ACHIEVEMENT_TEST';
const gradePayload = {
  data: {
    ds_diem_hocky: [
      { hoc_ky: '20241', dtb_hk_he4: '3.60', xep_loai_hoc_ky: 'Xuất sắc', so_tin_chi_dat_hk: '20' },
      { hoc_ky: '20242', dtb_hk_he4: '3.70', xep_loai_hoc_ky: 'Xuất sắc', so_tin_chi_dat_hk: '20' },
      { hoc_ky: '20243', dtb_hk_he4: '3.90', xep_loai_hoc_ky: 'Xuất sắc', so_tin_chi_dat_hk: '21' }
    ]
  }
};

try {
  await query(`
    INSERT INTO students (mssv, full_name, is_active)
    VALUES ($1, 'Achievement integration test', FALSE)
    ON CONFLICT (mssv) DO UPDATE SET is_active = FALSE;
  `, [TEST_MSSV]);

  const inactive = await AchievementService.syncFromGrades(TEST_MSSV, gradePayload);
  assert.equal(inactive.reason, 'student_not_active');
  const inactiveRows = await query(
    'SELECT COUNT(*)::int AS count FROM student_semester_results WHERE mssv = $1',
    [TEST_MSSV]
  );
  assert.equal(inactiveRows.rows[0].count, 0, 'Sinh viên inactive không được lưu kết quả/thành tựu');

  await query('UPDATE students SET is_active = TRUE WHERE mssv = $1', [TEST_MSSV]);
  const active = await AchievementService.syncFromGrades(TEST_MSSV, gradePayload);
  assert.equal(active.skipped, false);
  assert.ok(active.newlyUnlocked.includes('scholar'));
  assert.ok(active.newlyUnlocked.includes('academic_king'));
  assert.ok(active.newlyUnlocked.includes('rising_student'));
  assert.ok(active.newlyUnlocked.includes('credit_warrior'));
  assert.ok(active.newlyUnlocked.includes('breaking_limits'));

  const unlocked = await query(`
    SELECT achievement_id, evidence
    FROM student_achievement_unlocks
    WHERE mssv = $1
    ORDER BY achievement_id;
  `, [TEST_MSSV]);
  const rising = unlocked.rows.find((row) => row.achievement_id === 'rising_student');
  assert.deepEqual(rising.evidence.deltas.map((item) => item.delta_gpa_4), [0.1, 0.2]);

  await query(`
    INSERT INTO achievement_definitions (
      id, label, description, rule_type, rule_config, is_active
    ) VALUES (
      'integration_disabled', '#Disabled test', 'Không được mở khóa',
      'any_semester_min_gpa', '{"minGpa": 1}', FALSE
    ) ON CONFLICT (id) DO UPDATE SET is_active = FALSE;
  `);
  await AchievementService.syncFromGrades(TEST_MSSV, {
    data: { ds_diem_hocky: [
      { hoc_ky: '20241', dtb_hk_he4: '3.20' },
      { hoc_ky: '20242', dtb_hk_he4: '3.80' }
    ] }
  });
  const inactiveDefinitionUnlock = await query(`
    SELECT COUNT(*)::int AS count
    FROM student_achievement_unlocks
    WHERE mssv = $1 AND achievement_id = 'integration_disabled';
  `, [TEST_MSSV]);
  assert.equal(inactiveDefinitionUnlock.rows[0].count, 0);

  await query(`
    INSERT INTO achievement_definitions (
      id, label, description, rule_type, rule_config, is_active
    ) VALUES (
      'integration_manual', '#Manual test', 'Cấp thủ công',
      'manual_assignment', '{}'::jsonb, TRUE
    ) ON CONFLICT (id) DO UPDATE SET is_active = TRUE;
  `);
  await query(`
    INSERT INTO manual_achievement_grants (achievement_id, mssv, granted_by, is_active)
    VALUES ('integration_manual', $1, 'integration_test', TRUE)
    ON CONFLICT (achievement_id, mssv) DO UPDATE SET is_active = TRUE;
  `, [TEST_MSSV]);
  const manualSync = await AchievementService.syncFromGrades(TEST_MSSV, gradePayload);
  assert.ok(manualSync.newlyUnlocked.includes('integration_manual'));

  console.log('✓ PostgreSQL chỉ lưu thành tựu cho sinh viên và định nghĩa đang active.');
} finally {
  await query('DELETE FROM students WHERE mssv = $1', [TEST_MSSV]).catch(() => {});
  await query("DELETE FROM achievement_definitions WHERE id = 'integration_disabled'").catch(() => {});
  await query("DELETE FROM achievement_definitions WHERE id = 'integration_manual'").catch(() => {});
  await closeDatabase();
}
