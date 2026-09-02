import assert from 'node:assert/strict';
import { closeDatabase, query } from '../src/db/database.js';
import { AcademicRankingService } from '../src/services/academic-ranking.service.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the ranking integration test.');
}

const database = await query('SELECT current_database() AS name');
const databaseName = database.rows[0]?.name || '';
if (!/(dev|test)/i.test(databaseName)) {
  throw new Error(`Refusing to seed non-dev database: ${databaseName}`);
}

await query('TRUNCATE academic_rankings, academic_ranking_sync_runs RESTART IDENTITY CASCADE');
const run = await query(`
  INSERT INTO academic_ranking_sync_runs (
    status, trigger_source, completed_at, target_nkhk,
    current_activity_nkhk, activity_terms, cohorts, student_count
  ) VALUES (
    'succeeded', 'manual', NOW(), 25262, 25263,
    ARRAY[25261, 25262, 25263], ARRAY[25, 26, 27, 28, 29], 3
  ) RETURNING id
`);

const rankings = {
  gpa_tich_luy: {
    lop: { hang: 2, tong_sinh_vien: 40, gia_tri: 3.42 },
    khoa: { hang: 8, tong_sinh_vien: 240, gia_tri: 3.42 },
    vien: { hang: 15, tong_sinh_vien: 420, gia_tri: 3.42 },
    truong: { hang: 51, tong_sinh_vien: 1800, gia_tri: 3.42 }
  },
  tin_chi_tich_luy: {
    lop: { hang: 1, tong_sinh_vien: 40, gia_tri: 82 },
    khoa: { hang: 4, tong_sinh_vien: 240, gia_tri: 82 },
    vien: { hang: 7, tong_sinh_vien: 420, gia_tri: 82 },
    truong: { hang: 24, tong_sinh_vien: 1800, gia_tri: 82 }
  }
};

await query(`
  INSERT INTO academic_rankings (
    sync_run_id, mssv, full_name, class_code, faculty_code, institute_code,
    cohort, presence_status, semester_code, semester_gpa_4, cumulative_gpa_4,
    cumulative_classification, semester_classification, semester_earned_credits,
    cumulative_earned_credits, cumulative_credit_source, rankings
  ) VALUES (
    $1, '24050001', 'Sinh viên Dev', '27TH01', 'TH', 'TH-DT',
    27, 'Đang học', 25262, 3.5, 3.42, 'Giỏi', 'Giỏi', 18, 82,
    'tong_mon_dat', $2::jsonb
  )
`, [run.rows[0].id, JSON.stringify(rankings)]);

await query(`
  INSERT INTO academic_rankings (
    sync_run_id, mssv, full_name, class_code, faculty_code, institute_code,
    cohort, presence_status, semester_code, semester_gpa_4, cumulative_gpa_4,
    cumulative_classification, semester_classification, semester_earned_credits,
    cumulative_earned_credits, cumulative_credit_source, rankings
  ) VALUES (
    $1, '24050002', 'Sinh viên Xếp hạng', '27TH01', 'TH', 'TH-DT',
    27, 'Đang học', 25262, 3.8, 3.8, 'Xuất sắc', 'Xuất sắc', 18, 78,
    'tong_mon_dat', '{}'::jsonb
  )
`, [run.rows[0].id]);

await query(`
  INSERT INTO academic_rankings (
    sync_run_id, mssv, full_name, class_code, faculty_code, institute_code,
    cohort, presence_status, semester_code, semester_gpa_4, cumulative_gpa_4,
    cumulative_classification, semester_classification, semester_earned_credits,
    cumulative_earned_credits, cumulative_credit_source, rankings
  ) VALUES (
    $1, '24060003', 'Sinh viên Khác khoa', '27HQ01', 'HQ', 'KINH-TE',
    27, 'Đang học', 25262, 3.9, 3.9, 'Xuất sắc', 'Xuất sắc', 18, 80,
    'tong_mon_dat', '{}'::jsonb
  )
`, [run.rows[0].id]);

const stored = await AcademicRankingService.getLatestByMssv(' 24050001 ');
assert.equal(stored.mssv, '24050001');
assert.equal(stored.gpa_tich_luy_he_4, 3.42);
assert.equal(stored.xep_hang.gpa_tich_luy.truong.hang, 51);

BduIdentityService.register('dev-ranking-token', '24050001');
process.env.PORT = process.env.PORT || '3102';
const { default: server } = await import('../server.js');

try {
  if (!server.listening) {
    await new Promise((resolve) => server.once('listening', resolve));
  }
  const response = await fetch(`http://127.0.0.1:${process.env.PORT}/api/rankings/me`, {
    headers: { Authorization: 'Bearer dev-ranking-token' }
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(payload.result, true);
  assert.equal(payload.data.mssv, '24050001');
  assert.equal(payload.data.xep_hang.tin_chi_tich_luy.lop.hang, 1);
  assert.equal(payload.data.xep_hang_noi_bat.gpa_tich_luy.scope, 'lop');
  assert.equal(payload.data.xep_hang.tong_hop.lop.hang, 2);
  assert.equal('gia_tri' in payload.data.xep_hang.tong_hop.lop, false);
  assert.equal(payload.data.xep_hang_noi_bat.tong_hop.scope, 'truong');

  const classResponse = await fetch(
    `http://127.0.0.1:${process.env.PORT}/api/rankings/leaderboard?scope=class&metric=gpa`,
    { headers: { Authorization: 'Bearer dev-ranking-token' } }
  );
  const classPayload = await classResponse.json();
  assert.equal(classResponse.status, 200);
  assert.equal(classPayload.data.students.length, 2);
  assert.ok(classPayload.data.students.every((student) => student.ma_lop === '27TH01'));
  assert.equal(classPayload.data.students[0].hang, 1);
  assert.equal(classPayload.data.students[1].hang, 2);

  const facultyResponse = await fetch(
    `http://127.0.0.1:${process.env.PORT}/api/rankings/leaderboard?scope=faculty&metric=gpa`,
    { headers: { Authorization: 'Bearer dev-ranking-token' } }
  );
  const facultyPayload = await facultyResponse.json();
  assert.equal(facultyPayload.data.students.length, 2);
  assert.ok(facultyPayload.data.students.every((student) => student.ma_khoa === 'TH'));

  const schoolResponse = await fetch(
    `http://127.0.0.1:${process.env.PORT}/api/rankings/leaderboard?scope=school&metric=gpa`,
    { headers: { Authorization: 'Bearer dev-ranking-token' } }
  );
  const schoolPayload = await schoolResponse.json();
  assert.equal(schoolPayload.data.students.length, 3);
  assert.match(schoolPayload.data.students[0].mssv, /•/);

  const overallResponse = await fetch(
    `http://127.0.0.1:${process.env.PORT}/api/rankings/leaderboard?scope=school&metric=overall`,
    { headers: { Authorization: 'Bearer dev-ranking-token' } }
  );
  const overallPayload = await overallResponse.json();
  assert.equal(overallResponse.status, 200);
  assert.equal(overallPayload.data.metric, 'overall');
  assert.equal(overallPayload.data.students[0].gpa_tich_luy, 3.9);
  assert.equal(overallPayload.data.students[0].tin_chi_tich_luy, 80);
  assert.equal('gia_tri' in overallPayload.data.students[0], false);
  console.log('✓ PostgreSQL migration, ranking lookup and authenticated API integration');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
}
