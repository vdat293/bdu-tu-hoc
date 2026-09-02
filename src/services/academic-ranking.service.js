import https from 'node:https';
import { Buffer } from 'node:buffer';
import { isDatabaseConfigured, query, withAdvisoryLock } from '../db/database.js';

const DEFAULT_ENDPOINTS = {
  gpa: 'https://cds.bdu.edu.vn/data/fact_bang_diem_tbhk_odp',
  profiles: 'https://cds.bdu.edu.vn/data/fact_ho_so_sinh_vien_odp',
  details: 'https://cds.bdu.edu.vn/data/dim_bang_diem_odp',
  courses: 'https://cds.bdu.edu.vn/data/dim_mon_hoc_odp',
  timetable: 'https://cds.bdu.edu.vn/data/dim_thoi_khoa_bieu_odp'
};

const SYNC_LOCK_ID = 2_030_036_021;
const MIN_CLASS_COHORT = 25;
const DEFAULT_LATEST_COHORT = 29;
const SUPPORTED_FACULTIES = new Set(['TH', 'DT']);

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function studentKey(value) {
  return String(value ?? '').trim().toUpperCase();
}

function rowValue(row, ...aliases) {
  const lowered = Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [key.toLowerCase(), value])
  );
  for (const alias of aliases) {
    const value = lowered[alias.toLowerCase()];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const normalized = String(value).trim().replace(',', '.');
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function toInteger(value) {
  const number = toNumber(value);
  return number === null ? null : Math.trunc(number);
}

function compactNumber(value) {
  return Number.isInteger(value) ? value : Number(value.toFixed(2));
}

function cohortFromMssv(value) {
  const match = studentKey(value).match(/^(\d{2})\d{6}$/);
  return match ? Number(match[1]) + 3 : null;
}

function classCohort(value) {
  const match = String(value ?? '').trim().match(/^(\d{2})/);
  return match ? Number(match[1]) : null;
}

function gpaLevel(value) {
  if (value >= 3.6) return 'Xuất sắc';
  if (value >= 3.2) return 'Giỏi';
  if (value >= 2.5) return 'Khá';
  if (value >= 2.0) return 'Trung bình';
  return 'Yếu';
}

function courseCode(row) {
  const direct = studentKey(rowValue(row, 'ma_mon_hoc', 'ma_mon'));
  if (direct) return direct;
  const group = studentKey(rowValue(row, 'ma_nhom', 'nhom_to'));
  return group ? group.split('_', 1)[0] : '';
}

function passedCourse(row) {
  const result = rowValue(row, 'dat_hp', 'ket_qua');
  if (result !== null) {
    return new Set(['1', 'true', 'đạt', 'dat', 'pass', 'passed'])
      .has(String(result).trim().toLocaleLowerCase('vi'));
  }
  const letter = studentKey(rowValue(row, 'diem_chu_hp_4', 'diem_chu_hp', 'diem_tk_chu'));
  if (letter) return !new Set(['F', 'F+', 'I', 'X']).has(letter);
  const grade4 = toNumber(rowValue(row, 'diem_hp_4', 'diem_tk_so'));
  return grade4 !== null && grade4 >= 1;
}

function earnedCreditTotals(detailRows, courseRows) {
  const creditsByCourse = new Map();
  for (const row of courseRows) {
    const code = courseCode(row);
    const credits = toNumber(rowValue(row, 'tin_chi', 'so_tin_chi'));
    if (code && credits > 0) creditsByCourse.set(code, credits);
  }

  const passed = new Map();
  for (const row of detailRows) {
    const mssv = studentKey(rowValue(row, 'mssv', 'ma_sinh_vien'));
    const code = courseCode(row);
    if (!mssv || !code || !passedCourse(row)) continue;
    const credits = toNumber(rowValue(row, 'tin_chi', 'so_tin_chi')) ?? creditsByCourse.get(code);
    if (!credits || credits <= 0) continue;
    if (!passed.has(mssv)) passed.set(mssv, new Map());
    const courses = passed.get(mssv);
    courses.set(code, Math.max(courses.get(code) || 0, credits));
  }

  return new Map(
    [...passed].map(([mssv, courses]) => [
      mssv,
      compactNumber([...courses.values()].reduce((sum, value) => sum + value, 0))
    ])
  );
}

function instituteKey(profile) {
  const explicit = rowValue(profile, 'ma_vien', 'ten_vien', 'ma_don_vi', 'ten_don_vi');
  if (explicit !== null) return String(explicit).trim();
  const faculty = studentKey(rowValue(profile, 'ma_khoa'));
  if (SUPPORTED_FACULTIES.has(faculty)) return 'TH-DT';
  return faculty || null;
}

function profileIndex(profileRows) {
  const profiles = new Map();
  for (const row of profileRows) {
    const mssv = studentKey(rowValue(row, 'mssv', 'ma_sinh_vien', 'ma_sv'));
    if (!mssv) continue;
    const current = profiles.get(mssv);
    if (!current || (current.hien_dien !== 'Đang học' && row.hien_dien === 'Đang học')) {
      profiles.set(mssv, row);
    }
  }
  return profiles;
}

function normalizedStudent(gpaRow, profile, earnedCredits) {
  const cumulativeGpa = toNumber(rowValue(gpaRow, 'dtb_tich_luy_he_4'));
  const sourceCredits = toNumber(rowValue(gpaRow, 'so_tin_chi_dat_tich_luy'));
  const cumulativeCredits = earnedCredits ?? sourceCredits;
  const mssv = studentKey(rowValue(gpaRow, 'mssv', 'ma_sinh_vien'));
  return {
    mssv,
    ho_ten: rowValue(gpaRow, 'ten_sinh_vien') || rowValue(profile, 'ten_day_du', 'ho_ten'),
    ma_lop: rowValue(gpaRow, 'ma_lop') || rowValue(profile, 'ma_lop'),
    ma_khoa: studentKey(rowValue(profile, 'ma_khoa')) || null,
    ma_vien: instituteKey(profile),
    khoa_hoc: cohortFromMssv(mssv),
    hien_dien: rowValue(profile, 'hien_dien'),
    nkhk: toInteger(rowValue(gpaRow, 'nkhk')),
    gpa_hoc_ky_he_4: toNumber(rowValue(gpaRow, 'dtb_hk_he_4')),
    gpa_tich_luy_he_4: cumulativeGpa,
    xep_loai_tich_luy: cumulativeGpa === null ? null : gpaLevel(cumulativeGpa),
    xep_loai_hoc_ky: rowValue(gpaRow, 'xep_loai_hoc_ki'),
    tin_chi_dat_hoc_ky: toInteger(rowValue(gpaRow, 'so_tin_chi_dat_hk')),
    tin_chi_dat_tich_luy: cumulativeCredits === null ? null : compactNumber(cumulativeCredits),
    nguon_tin_chi_tich_luy: earnedCredits === undefined ? 'gpa_tong_hop' : 'tong_mon_dat'
  };
}

function preferGpaRow(current, candidate) {
  if (!current) return candidate;
  const score = (row) => [
    toInteger(rowValue(row, 'so_tin_chi_dat_tich_luy')) ?? -1,
    toInteger(rowValue(row, 'so_tin_chi_dat_hk')) ?? -1
  ];
  const left = score(current);
  const right = score(candidate);
  return right[0] > left[0] || (right[0] === left[0] && right[1] > left[1])
    ? candidate
    : current;
}

function prepareRankingStudents(gpaRows, profileRows, targetNkhk, creditTotals) {
  const profiles = profileIndex(profileRows);
  const selected = new Map();
  for (const row of gpaRows) {
    const mssv = studentKey(rowValue(row, 'mssv', 'ma_sinh_vien'));
    const semester = toInteger(rowValue(row, 'nkhk', 'ma_nkhk'));
    if (!mssv || !profiles.has(mssv) || semester === null || semester > targetNkhk) continue;
    const current = selected.get(mssv);
    const currentSemester = current ? toInteger(rowValue(current, 'nkhk', 'ma_nkhk')) : null;
    if (!current || currentSemester === null || semester > currentSemester) {
      selected.set(mssv, row);
    } else if (semester === currentSemester) {
      selected.set(mssv, preferGpaRow(current, row));
    }
  }

  return [...profiles].map(([mssv, profile]) => normalizedStudent(
    selected.get(mssv) || { mssv, ma_lop: rowValue(profile, 'ma_lop'), nkhk: null },
    profile,
    creditTotals.get(mssv)
  ));
}

function recentActivity(gpaRows, detailRows, timetableRows, termCount = 3) {
  const studentsByTerm = new Map();
  const add = (term, mssv) => {
    if (term === null || !mssv) return;
    if (!studentsByTerm.has(term)) studentsByTerm.set(term, new Set());
    studentsByTerm.get(term).add(mssv);
  };

  for (const rows of [gpaRows, detailRows]) {
    for (const row of rows) {
      add(
        toInteger(rowValue(row, 'nkhk', 'ma_nkhk')),
        studentKey(rowValue(row, 'mssv', 'ma_sinh_vien'))
      );
    }
  }
  for (const row of timetableRows) {
    const term = toInteger(rowValue(row, 'nkhk', 'ma_nkhk'));
    const participants = String(row.danh_sach_sv || '').match(/\b\d{6,12}\b/g) || [];
    for (const mssv of participants) add(term, studentKey(mssv));
  }

  const terms = [...studentsByTerm]
    .filter(([, students]) => students.size > 0)
    .map(([term]) => term)
    .sort((a, b) => b - a)
    .slice(0, termCount)
    .sort((a, b) => a - b);
  if (!terms.length) throw new Error('Không xác định được học kỳ hoạt động từ dữ liệu CDS.');
  const activeMssv = new Set(terms.flatMap((term) => [...studentsByTerm.get(term)]));
  return { terms, activeMssv };
}

function rollingCohortWindow(students, latestCohort, size = 5) {
  if (!latestCohort) {
    const matched = students
      .filter((row) => Number.isInteger(row.khoa_hoc) && classCohort(row.ma_lop) === row.khoa_hoc)
      .map((row) => row.khoa_hoc);
    const available = matched.length
      ? matched
      : students.filter((row) => row.khoa_hoc >= MIN_CLASS_COHORT && row.khoa_hoc <= 60)
        .map((row) => row.khoa_hoc);
    if (!available.length) throw new Error('Không xác định được khóa từ hồ sơ sinh viên.');
    latestCohort = available.reduce(
      (latest, cohort) => Math.max(latest, cohort),
      DEFAULT_LATEST_COHORT
    );
  }
  if (latestCohort < MIN_CLASS_COHORT) throw new Error('Khóa mới nhất không hợp lệ.');
  return Array.from({ length: size }, (_, index) => latestCohort - size + index + 1);
}

function rankPartition(students, metric, groupFields) {
  const groups = new Map();
  for (const row of students) {
    const group = groupFields.map((field) => row[field]);
    if (group.some((value) => value === null || value === undefined || value === '')) continue;
    const key = JSON.stringify(group);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const result = new Map();
  for (const members of groups.values()) {
    const valid = members.filter((row) => typeof row[metric] === 'number' && row[metric] > 0);
    const values = [...new Set(valid.map((row) => row[metric]))].sort((a, b) => b - a);
    const ranks = new Map(values.map((value, index) => [value, index + 1]));
    for (const row of members) {
      const rank = ranks.get(row[metric]) ?? null;
      result.set(row.mssv, {
        hang: rank,
        tong_sinh_vien: valid.length,
        gia_tri: rank === null ? null : row[metric]
      });
    }
  }
  return result;
}

function rankAllStudents(students) {
  const rows = students.map((row) => ({ ...row }));
  const scopes = {
    lop: ['khoa_hoc', 'ma_lop'],
    khoa: ['khoa_hoc', 'ma_khoa'],
    vien: ['khoa_hoc', 'ma_vien'],
    truong: ['khoa_hoc']
  };
  const metrics = {
    gpa_tich_luy: 'gpa_tich_luy_he_4',
    tin_chi_tich_luy: 'tin_chi_dat_tich_luy'
  };
  const maps = {};
  for (const [metricName, metric] of Object.entries(metrics)) {
    maps[metricName] = {};
    for (const [scope, fields] of Object.entries(scopes)) {
      maps[metricName][scope] = rankPartition(rows, metric, fields);
    }
  }
  for (const row of rows) {
    row.xep_hang = {};
    for (const metricName of Object.keys(metrics)) {
      row.xep_hang[metricName] = {};
      for (const scope of Object.keys(scopes)) {
        row.xep_hang[metricName][scope] = maps[metricName][scope].get(row.mssv)
          || { hang: null, tong_sinh_vien: 0, gia_tri: null };
      }
    }
  }
  return rows;
}

const HIGHLIGHT_SCOPES = {
  lop: { label: 'trong lớp', breadth: 1 },
  khoa: { label: 'trong khoa', breadth: 2 },
  vien: { label: 'trong viện', breadth: 3 },
  truong: { label: 'toàn trường', breadth: 4 }
};

function rankingQualityBucket(rank) {
  if (rank <= 3) return 0;
  if (rank <= 10) return 1;
  if (rank <= 50) return 2;
  if (rank <= 100) return 3;
  return 4;
}

function chooseHighlightedRanking(rankingsByScope = {}) {
  const candidates = Object.entries(HIGHLIGHT_SCOPES)
    .map(([scope, config]) => {
      const item = rankingsByScope?.[scope];
      const rank = Number(item?.hang);
      const total = Number(item?.tong_sinh_vien);
      if (!Number.isFinite(rank) || rank < 1 || !Number.isFinite(total) || total < 1) {
        return null;
      }
      return {
        scope,
        pham_vi: config.label,
        hang: rank,
        tong_sinh_vien: total,
        gia_tri: item.gia_tri ?? null,
        top_phan_tram: Number((rank * 100 / total).toFixed(2)),
        qualityBucket: rankingQualityBucket(rank),
        breadth: config.breadth
      };
    })
    .filter(Boolean);

  candidates.sort((left, right) => (
    left.qualityBucket - right.qualityBucket
    || right.breadth - left.breadth
    || left.hang - right.hang
    || left.top_phan_tram - right.top_phan_tram
  ));
  const best = candidates[0];
  if (!best) return null;
  const { qualityBucket, breadth, ...publicResult } = best;
  return publicResult;
}

function normalizeLeaderboardScope(value) {
  const aliases = {
    class: 'class', lop: 'class',
    faculty: 'faculty', khoa: 'faculty',
    institute: 'institute', vien: 'institute',
    school: 'school', truong: 'school'
  };
  return aliases[String(value || '').toLowerCase()] || null;
}

function normalizeLeaderboardMetric(value) {
  const aliases = {
    gpa: 'gpa', gpa_tich_luy: 'gpa',
    credits: 'credits', credit: 'credits',
    tin_chi: 'credits', tin_chi_tich_luy: 'credits'
  };
  return aliases[String(value || '').toLowerCase()] || null;
}

function maskMssv(mssv, isCurrentStudent) {
  if (isCurrentStudent) return mssv;
  if (mssv.length <= 4) return '••••';
  return `${mssv.slice(0, 2)}${'•'.repeat(Math.max(2, mssv.length - 4))}${mssv.slice(-2)}`;
}

function buildLeaderboard(rows, { scope, metric, viewerMssv }) {
  const metricField = metric === 'credits' ? 'cumulative_earned_credits' : 'cumulative_gpa_4';
  const members = rows
    .map((row) => ({ row, value: numberOrNull(row[metricField]) }))
    .filter((member) => member.value !== null && member.value > 0);
  const values = [...new Set(members.map((member) => member.value))].sort((a, b) => b - a);
  const ranks = new Map(values.map((value, index) => [value, index + 1]));
  const entries = members.map((member) => {
    const isCurrentStudent = member.row.mssv === viewerMssv;
    return {
      hang: ranks.get(member.value),
      tong_sinh_vien_trong_nhom: members.length,
      mssv: maskMssv(member.row.mssv, isCurrentStudent),
      ho_ten: member.row.full_name,
      ma_lop: member.row.class_code,
      ma_khoa: member.row.faculty_code,
      ma_vien: member.row.institute_code,
      khoa_hoc: member.row.cohort,
      gia_tri: member.value,
      la_sinh_vien_hien_tai: isCurrentStudent
    };
  });

  entries.sort((left, right) => (
    left.hang - right.hang
    || right.gia_tri - left.gia_tri
    || String(left.ho_ten || '').localeCompare(String(right.ho_ten || ''), 'vi')
  ));
  return entries;
}

function fetchRows(url, user, password) {
  const timeout = Number.parseInt(process.env.RANKING_SYNC_TIMEOUT_MS || '180000', 10);
  const rejectUnauthorized = !envBool('CDS_INSECURE_TLS', false);
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'BDU-Hub-Ranking-Sync/1.0'
      },
      rejectUnauthorized,
      timeout
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode === 401) return reject(new Error('Sai tài khoản hoặc mật khẩu CDS.'));
        if (!response.statusCode || response.statusCode >= 400) {
          return reject(new Error(`CDS trả HTTP ${response.statusCode} cho ${url}.`));
        }
        try {
          const payload = JSON.parse(body);
          const rows = Array.isArray(payload) ? payload : payload?.data;
          if (!Array.isArray(rows)) throw new Error('Nguồn không trả về danh sách JSON.');
          resolve(rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row)));
        } catch (error) {
          reject(new Error(`JSON không hợp lệ từ ${url}: ${error.message}`));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error(`Hết thời gian tải ${url}.`)));
    request.on('error', reject);
  });
}

async function collectRankings() {
  const user = process.env.CDS_USER || process.env.CRAWL_USER;
  const password = process.env.CDS_PASSWORD || process.env.CRAWL_PASS;
  if (!user || !password) throw new Error('Chưa cấu hình CDS_USER và CDS_PASSWORD.');

  const urls = Object.fromEntries(
    Object.entries(DEFAULT_ENDPOINTS).map(([key, fallback]) => [
      key,
      process.env[`CDS_${key.toUpperCase()}_URL`] || fallback
    ])
  );
  const required = await Promise.all([
    fetchRows(urls.gpa, user, password),
    fetchRows(urls.profiles, user, password)
  ]);
  const warnings = [];
  const optional = await Promise.all(['details', 'courses', 'timetable'].map(async (key) => {
    try {
      return await fetchRows(urls[key], user, password);
    } catch (error) {
      warnings.push(`${key}: ${error.message}`);
      return [];
    }
  }));

  const [gpaRows, profileRows] = required;
  const [detailRows, courseRows, timetableRows] = optional;
  const creditTotals = earnedCreditTotals(detailRows, courseRows);
  const activity = recentActivity(gpaRows, detailRows, timetableRows, 3);
  const rankingTargetNkhk = activity.terms.at(-1);
  const rankingPool = prepareRankingStudents(
    gpaRows,
    profileRows,
    rankingTargetNkhk,
    creditTotals
  );
  const activePool = rankingPool.filter((row) => activity.activeMssv.has(row.mssv));
  const latestCohort = toInteger(process.env.RANKING_LATEST_COHORT);
  const cohorts = rollingCohortWindow(activePool, latestCohort, 5);
  const selected = activePool.filter((row) => cohorts.includes(row.khoa_hoc));
  const ranked = rankAllStudents(selected).sort((a, b) => (
    (a.khoa_hoc - b.khoa_hoc)
    || String(a.ma_lop || '').localeCompare(String(b.ma_lop || ''))
    || a.mssv.localeCompare(b.mssv)
  ));
  const minimumStudentCount = Number.parseInt(
    process.env.RANKING_MIN_STUDENT_COUNT || '1',
    10
  );
  if (ranked.length < Math.max(1, minimumStudentCount)) {
    throw new Error(
      `Snapshot chỉ có ${ranked.length} sinh viên, thấp hơn ngưỡng an toàn `
      + `${Math.max(1, minimumStudentCount)}.`
    );
  }
  const latestGpaNkhk = gpaRows.reduce((latest, row) => {
    const term = toInteger(rowValue(row, 'nkhk', 'ma_nkhk'));
    return term !== null && term <= rankingTargetNkhk ? Math.max(latest, term) : latest;
  }, Number.NEGATIVE_INFINITY);
  const cohortSet = new Set(cohorts);

  return {
    targetNkhk: Number.isFinite(latestGpaNkhk) ? latestGpaNkhk : rankingTargetNkhk,
    currentActivityNkhk: rankingTargetNkhk,
    activityTerms: activity.terms,
    cohorts,
    excludedNoRecentActivityCount: rankingPool.filter(
      (row) => cohortSet.has(row.khoa_hoc) && !activity.activeMssv.has(row.mssv)
    ).length,
    warnings,
    sourceCounts: {
      gpa: gpaRows.length,
      profiles: profileRows.length,
      details: detailRows.length,
      courses: courseRows.length,
      timetable: timetableRows.length
    },
    students: ranked
  };
}

async function insertStudents(client, runId, students) {
  const records = students.map((row) => ({
    mssv: row.mssv,
    full_name: row.ho_ten,
    class_code: row.ma_lop,
    faculty_code: row.ma_khoa,
    institute_code: row.ma_vien,
    cohort: row.khoa_hoc,
    presence_status: row.hien_dien,
    semester_code: row.nkhk,
    semester_gpa_4: row.gpa_hoc_ky_he_4,
    cumulative_gpa_4: row.gpa_tich_luy_he_4,
    cumulative_classification: row.xep_loai_tich_luy,
    semester_classification: row.xep_loai_hoc_ky,
    semester_earned_credits: row.tin_chi_dat_hoc_ky,
    cumulative_earned_credits: row.tin_chi_dat_tich_luy,
    cumulative_credit_source: row.nguon_tin_chi_tich_luy,
    rankings: row.xep_hang
  }));

  await client.query(`
    INSERT INTO academic_rankings (
      sync_run_id, mssv, full_name, class_code, faculty_code, institute_code,
      cohort, presence_status, semester_code, semester_gpa_4, cumulative_gpa_4,
      cumulative_classification, semester_classification, semester_earned_credits,
      cumulative_earned_credits, cumulative_credit_source, rankings
    )
    SELECT $1, item.mssv, item.full_name, item.class_code, item.faculty_code,
           item.institute_code, item.cohort, item.presence_status, item.semester_code,
           item.semester_gpa_4, item.cumulative_gpa_4,
           item.cumulative_classification, item.semester_classification,
           item.semester_earned_credits, item.cumulative_earned_credits,
           item.cumulative_credit_source, item.rankings
    FROM jsonb_to_recordset($2::jsonb) AS item(
      mssv VARCHAR(32), full_name TEXT, class_code TEXT, faculty_code TEXT,
      institute_code TEXT, cohort INTEGER, presence_status TEXT, semester_code INTEGER,
      semester_gpa_4 NUMERIC(5,2), cumulative_gpa_4 NUMERIC(5,2),
      cumulative_classification TEXT, semester_classification TEXT,
      semester_earned_credits NUMERIC(8,2), cumulative_earned_credits NUMERIC(8,2),
      cumulative_credit_source TEXT, rankings JSONB
    )
  `, [runId, JSON.stringify(records)]);
}

async function runSyncWithClient(client, triggerSource) {
  const runResult = await client.query(
    `INSERT INTO academic_ranking_sync_runs (status, trigger_source)
     VALUES ('running', $1) RETURNING id`,
    [triggerSource]
  );
  const runId = runResult.rows[0].id;
  try {
    const report = await collectRankings();
    await client.query('BEGIN');
    try {
      await insertStudents(client, runId, report.students);
      await client.query(`
        UPDATE academic_ranking_sync_runs
        SET status = 'succeeded', completed_at = NOW(), target_nkhk = $2,
            current_activity_nkhk = $3, activity_terms = $4, cohorts = $5,
            student_count = $6, excluded_no_recent_activity_count = $7,
            metadata = $8::jsonb
        WHERE id = $1
      `, [
        runId,
        report.targetNkhk,
        report.currentActivityNkhk,
        report.activityTerms,
        report.cohorts,
        report.students.length,
        report.excludedNoRecentActivityCount,
        JSON.stringify({ warnings: report.warnings, source_counts: report.sourceCounts })
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    return { runId, ...report, students: undefined, studentCount: report.students.length };
  } catch (error) {
    await client.query(`
      UPDATE academic_ranking_sync_runs
      SET status = 'failed', completed_at = NOW(), error_message = $2
      WHERE id = $1
    `, [runId, String(error.message).slice(0, 2000)]).catch(() => {});
    throw error;
  }
}

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

export const AcademicRankingService = {
  hasDatabase() {
    return isDatabaseConfigured();
  },

  isReady() {
    return isDatabaseConfigured()
      && Boolean(process.env.CDS_USER || process.env.CRAWL_USER)
      && Boolean(process.env.CDS_PASSWORD || process.env.CRAWL_PASS);
  },

  async sync(triggerSource = 'scheduler') {
    if (!isDatabaseConfigured()) throw new Error('Chưa cấu hình DATABASE_URL.');
    const result = await withAdvisoryLock(SYNC_LOCK_ID, (client) => (
      runSyncWithClient(client, triggerSource)
    ));
    if (!result.acquired) return { skipped: true, reason: 'sync_already_running' };
    return { skipped: false, ...result.value };
  },

  async getLatestByMssv(mssv) {
    const normalized = studentKey(mssv);
    const result = await query(`
      SELECT ar.*, run.completed_at AS synced_at, run.target_nkhk,
             run.current_activity_nkhk, run.activity_terms, run.cohorts
      FROM academic_rankings ar
      JOIN academic_ranking_sync_runs run ON run.id = ar.sync_run_id
      WHERE ar.mssv = $1 AND run.status = 'succeeded'
      ORDER BY run.completed_at DESC
      LIMIT 1
    `, [normalized]);
    const row = result.rows[0];
    if (!row) return null;
    const rankings = row.rankings || {};
    return {
      mssv: row.mssv,
      ho_ten: row.full_name,
      ma_lop: row.class_code,
      ma_khoa: row.faculty_code,
      ma_vien: row.institute_code,
      khoa_hoc: row.cohort,
      hien_dien: row.presence_status,
      nkhk: row.semester_code,
      gpa_hoc_ky_he_4: numberOrNull(row.semester_gpa_4),
      gpa_tich_luy_he_4: numberOrNull(row.cumulative_gpa_4),
      xep_loai_tich_luy: row.cumulative_classification,
      xep_loai_hoc_ky: row.semester_classification,
      tin_chi_dat_hoc_ky: numberOrNull(row.semester_earned_credits),
      tin_chi_dat_tich_luy: numberOrNull(row.cumulative_earned_credits),
      nguon_tin_chi_tich_luy: row.cumulative_credit_source,
      xep_hang: rankings,
      xep_hang_noi_bat: {
        gpa_tich_luy: chooseHighlightedRanking(rankings.gpa_tich_luy),
        tin_chi_tich_luy: chooseHighlightedRanking(rankings.tin_chi_tich_luy)
      },
      dong_bo_luc: row.synced_at,
      target_nkhk: row.target_nkhk,
      current_activity_nkhk: row.current_activity_nkhk,
      activity_terms: row.activity_terms,
      cohorts: row.cohorts
    };
  },

  async getLeaderboard({ scope = 'school', metric = 'gpa', viewerMssv }) {
    const normalizedScope = normalizeLeaderboardScope(scope);
    const normalizedMetric = normalizeLeaderboardMetric(metric);
    if (!normalizedScope || !normalizedMetric) {
      const error = new Error('Lựa chọn bảng xếp hạng chưa hợp lệ.');
      error.status = 400;
      throw error;
    }

    const latestRun = await query(`
      SELECT id, completed_at, target_nkhk, cohorts
      FROM academic_ranking_sync_runs
      WHERE status = 'succeeded'
      ORDER BY completed_at DESC
      LIMIT 1
    `);
    const run = latestRun.rows[0];
    if (!run) return null;
    const normalizedViewerMssv = studentKey(viewerMssv);
    const viewerResult = await query(`
      SELECT mssv, class_code, faculty_code, institute_code, cohort
      FROM academic_rankings
      WHERE sync_run_id = $1 AND mssv = $2
      LIMIT 1
    `, [run.id, normalizedViewerMssv]);
    const viewer = viewerResult.rows[0];
    if (!viewer) return null;

    const scopeFields = {
      class: 'class_code',
      faculty: 'faculty_code',
      institute: 'institute_code'
    };
    const scopeField = scopeFields[normalizedScope];
    const scopeValue = scopeField ? viewer[scopeField] : null;
    if (scopeField && !scopeValue) {
      const error = new Error('Hồ sơ của bạn chưa đủ thông tin cho phạm vi này.');
      error.status = 400;
      throw error;
    }

    const result = await query(`
      SELECT mssv, full_name, class_code, faculty_code, institute_code, cohort,
             cumulative_gpa_4, cumulative_earned_credits
      FROM academic_rankings
      WHERE sync_run_id = $1 AND cohort = $2
        AND ($3::text IS NULL OR ${scopeField || 'NULL'} = $3)
    `, [run.id, viewer.cohort, scopeValue]);
    const entries = buildLeaderboard(result.rows, {
      scope: normalizedScope,
      metric: normalizedMetric,
      viewerMssv: normalizedViewerMssv
    });
    return {
      scope: normalizedScope,
      metric: normalizedMetric,
      cohort: Number(viewer.cohort),
      context: {
        class_code: viewer.class_code,
        faculty_code: viewer.faculty_code,
        institute_code: viewer.institute_code
      },
      student_count: entries.length,
      synced_at: run.completed_at,
      target_nkhk: run.target_nkhk,
      students: entries
    };
  },

  async getStatus() {
    if (!isDatabaseConfigured()) return { configured: false, latestRun: null };
    const result = await query(`
      SELECT id, status, trigger_source, started_at, completed_at, target_nkhk,
             current_activity_nkhk, activity_terms, cohorts, student_count,
             excluded_no_recent_activity_count, error_message, metadata
      FROM academic_ranking_sync_runs
      ORDER BY started_at DESC
      LIMIT 1
    `);
    return { configured: true, latestRun: result.rows[0] || null };
  }
};

export const AcademicRankingInternals = {
  cohortFromMssv,
  earnedCreditTotals,
  prepareRankingStudents,
  recentActivity,
  rollingCohortWindow,
  rankAllStudents,
  chooseHighlightedRanking,
  buildLeaderboard
};
