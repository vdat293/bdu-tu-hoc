import { isDatabaseConfigured, query, transaction } from '../db/database.js';
import { isCourseFailed } from './learning.service.js';

function cleanText(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function semesterSort(left, right) {
  return String(left.semesterCode).localeCompare(String(right.semesterCode), 'vi', {
    numeric: true,
    sensitivity: 'base'
  });
}

function getGradeSemesters(payload) {
  const root = payload?.data ?? payload ?? {};
  if (Array.isArray(root?.ds_diem_hocky)) return root.ds_diem_hocky;
  return Array.isArray(root) ? root : [];
}

export function extractSemesterResults(payload) {
  return getGradeSemesters(payload)
    .map((semester) => {
      const semesterCode = cleanText(
        semester?.hoc_ky ?? semester?.ma_hoc_ky ?? semester?.semester_code,
        32
      );
      const semesterGpa = numberOrNull(
        semester?.dtb_hk_he4
        ?? semester?.dtb_hk_he_4
        ?? semester?.semester_gpa_4
        ?? semester?.gpa_hoc_ky_he_4
      );
      if (!semesterCode || semesterGpa === null || semesterGpa <= 0 || semesterGpa > 4) return null;
      return {
        semesterCode,
        semesterName: cleanText(
          semester?.ten_hoc_ky ?? semester?.semester_name ?? semesterCode,
          180
        ),
        semesterGpa: Number(semesterGpa.toFixed(2)),
        classification: cleanText(
          semester?.xep_loai_hoc_ky
          ?? semester?.xep_loai_hoc_ki
          ?? semester?.xep_loai_tkb_hk
          ?? semester?.xep_loai_tkb_hk_eg,
          100
        ),
        earnedCredits: numberOrNull(
          semester?.so_tin_chi_dat_hk
          ?? semester?.tin_chi_dat_hoc_ky
          ?? semester?.semester_earned_credits
        )
      };
    })
    .filter(Boolean)
    .sort(semesterSort);
}

function normalizedClassification(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi');
}

function semesterEvidence(semester) {
  return {
    semester_code: semester.semesterCode,
    semester_name: semester.semesterName || semester.semesterCode,
    semester_gpa_4: semester.semesterGpa,
    semester_classification: semester.classification || null,
    earned_credits: semester.earnedCredits
  };
}

function gpaDeltas(semesters) {
  return semesters.slice(1).map((semester, index) => {
    const previous = semesters[index];
    return {
      from_semester: previous.semesterCode,
      to_semester: semester.semesterCode,
      previous_gpa_4: previous.semesterGpa,
      current_gpa_4: semester.semesterGpa,
      delta_gpa_4: Number((semester.semesterGpa - previous.semesterGpa).toFixed(2))
    };
  });
}

export function evaluateAchievement(definition, semesterRows) {
  const semesters = [...semesterRows].sort(semesterSort);
  const config = definition.rule_config || definition.ruleConfig || {};
  const type = definition.rule_type || definition.ruleType;
  if (!semesters.length) return null;

  if (type === 'all_semesters_min_gpa') {
    const minGpa = Number(config.minGpa);
    const minSemesters = Number(config.minSemesters || 1);
    if (semesters.length < minSemesters || semesters.some((item) => item.semesterGpa < minGpa)) return null;
    return { threshold_gpa_4: minGpa, semester_count: semesters.length, semesters: semesters.map(semesterEvidence) };
  }

  if (type === 'excellent_semester_count') {
    const count = Number(config.count || 1);
    const excellentGpa = Number(config.excellentGpa || 3.6);
    const qualifying = semesters.filter((item) => {
      const classification = normalizedClassification(item.classification);
      return classification
        ? classification.includes('xuat sac')
        : item.semesterGpa >= excellentGpa;
    });
    if (qualifying.length < count) return null;
    return { required_count: count, qualifying_count: qualifying.length, semesters: qualifying.map(semesterEvidence) };
  }

  if (type === 'latest_consecutive_gpa_increases') {
    const increaseCount = Number(config.increaseCount || 1);
    const minDelta = Number(config.minDelta || 0.01);
    const recent = semesters.slice(-(increaseCount + 1));
    if (recent.length < increaseCount + 1) return null;
    const deltas = gpaDeltas(recent);
    if (deltas.some((item) => item.delta_gpa_4 < minDelta)) return null;
    return { increase_count: increaseCount, minimum_delta_gpa_4: minDelta, semesters: recent.map(semesterEvidence), deltas };
  }

  if (type === 'any_semester_min_gpa') {
    const minGpa = Number(config.minGpa);
    const qualifying = semesters.filter((item) => item.semesterGpa >= minGpa);
    if (!qualifying.length) return null;
    return { threshold_gpa_4: minGpa, semesters: qualifying.map(semesterEvidence) };
  }

  if (type === 'latest_gpa_delta') {
    if (semesters.length < 2) return null;
    const pair = semesters.slice(-2);
    const delta = gpaDeltas(pair)[0];
    const minDelta = Number(config.minDelta);
    if (!delta || delta.delta_gpa_4 < minDelta) return null;
    return { minimum_delta_gpa_4: minDelta, semesters: pair.map(semesterEvidence), deltas: [delta] };
  }

  if (type === 'semester_min_gpa_count') {
    const count = Number(config.count || 1);
    const minGpa = Number(config.minGpa);
    const qualifying = semesters.filter((item) => item.semesterGpa >= minGpa);
    if (qualifying.length < count) return null;
    return { required_count: count, threshold_gpa_4: minGpa, qualifying_count: qualifying.length, semesters: qualifying.map(semesterEvidence) };
  }

  if (type === 'semester_credits_with_gpa') {
    const minCredits = Number(config.minCredits);
    const minGpa = Number(config.minGpa);
    const strictCredits = config.strictCredits === true;
    const qualifying = semesters.filter((item) => (
      item.earnedCredits !== null
      && (strictCredits ? item.earnedCredits > minCredits : item.earnedCredits >= minCredits)
      && item.semesterGpa >= minGpa
    ));
    if (!qualifying.length) return null;
    return {
      minimum_credits: minCredits,
      credits_operator: strictCredits ? 'greater_than' : 'at_least',
      threshold_gpa_4: minGpa,
      semesters: qualifying.map(semesterEvidence)
    };
  }

  return null;
}

function mapStoredSemester(row) {
  return {
    semesterCode: row.semester_code,
    semesterName: row.semester_name,
    semesterGpa: Number(row.semester_gpa_4),
    classification: row.semester_classification,
    earnedCredits: row.earned_credits === null ? null : Number(row.earned_credits)
  };
}

export const AchievementService = {
  hasDatabase() {
    return isDatabaseConfigured();
  },

  async syncFromGrades(mssv, gradePayload) {
    if (!isDatabaseConfigured()) return { skipped: true, reason: 'database_not_configured' };
    const cleanMssv = cleanText(mssv, 32).toUpperCase();
    const extracted = extractSemesterResults(gradePayload);
    if (!cleanMssv) return { skipped: true, reason: 'missing_mssv' };

    return transaction(async (client) => {
      const studentResult = await client.query(
        'SELECT is_active FROM students WHERE mssv = $1 FOR UPDATE',
        [cleanMssv]
      );
      if (studentResult.rows[0]?.is_active !== true) {
        return { skipped: true, reason: 'student_not_active' };
      }

      for (const semester of extracted) {
        await client.query(`
          INSERT INTO student_semester_results (
            mssv, semester_code, semester_name, semester_gpa_4,
            semester_classification, earned_credits, source
          ) VALUES ($1, $2, $3, $4, $5, $6, 'bdu_grades')
          ON CONFLICT (mssv, semester_code) DO UPDATE SET
            semester_name = EXCLUDED.semester_name,
            semester_gpa_4 = EXCLUDED.semester_gpa_4,
            semester_classification = COALESCE(
              NULLIF(EXCLUDED.semester_classification, ''),
              student_semester_results.semester_classification
            ),
            earned_credits = COALESCE(
              EXCLUDED.earned_credits,
              student_semester_results.earned_credits
            ),
            source = EXCLUDED.source,
            updated_at = NOW();
        `, [
          cleanMssv,
          semester.semesterCode,
          semester.semesterName || null,
          semester.semesterGpa,
          semester.classification || null,
          semester.earnedCredits
        ]);
      }

      const rootPayload = gradePayload?.data ?? gradePayload ?? {};
      const semestersList = Array.isArray(rootPayload?.ds_diem_hocky) ? rootPayload.ds_diem_hocky : (Array.isArray(rootPayload) ? rootPayload : []);
      const hasFailed = semestersList.some((s) => Array.isArray(s?.ds_diem_mon_hoc) && s.ds_diem_mon_hoc.some(isCourseFailed));
      if (hasFailed) {
        await client.query(
          'UPDATE students SET has_failed_course = TRUE, updated_at = NOW() WHERE mssv = $1',
          [cleanMssv]
        );
      }

      const [definitionsResult, semestersResult] = await Promise.all([
        client.query(`
          SELECT id, rule_type, rule_config
          FROM achievement_definitions
          WHERE is_active = TRUE
          ORDER BY sort_order, id;
        `),
        client.query(`
          SELECT semester_code, semester_name, semester_gpa_4,
                 semester_classification, earned_credits
          FROM student_semester_results
          WHERE mssv = $1
          ORDER BY semester_code;
        `, [cleanMssv])
      ]);
      const semesters = semestersResult.rows.map(mapStoredSemester).sort(semesterSort);
      const newlyUnlocked = [];

      for (const definition of definitionsResult.rows) {
        const evidence = evaluateAchievement(definition, semesters);
        if (!evidence) continue;
        const inserted = await client.query(`
          INSERT INTO student_achievement_unlocks (mssv, achievement_id, evidence)
          SELECT $1::varchar, $2::text, $3::jsonb
          WHERE EXISTS (
            SELECT 1 FROM students WHERE mssv = $1::varchar AND is_active = TRUE
          ) AND EXISTS (
            SELECT 1 FROM achievement_definitions WHERE id = $2::text AND is_active = TRUE
          )
          ON CONFLICT (mssv, achievement_id) DO NOTHING
          RETURNING achievement_id;
        `, [cleanMssv, definition.id, JSON.stringify(evidence)]);
        if (inserted.rowCount) newlyUnlocked.push(definition.id);
      }

      const manualGrantsResult = await client.query(`
        SELECT grants.achievement_id, grants.granted_by,
               grants.note, grants.granted_at
        FROM manual_achievement_grants grants
        JOIN achievement_definitions definitions
          ON definitions.id = grants.achievement_id
         AND definitions.is_active = TRUE
        WHERE grants.mssv = $1
          AND grants.is_active = TRUE;
      `, [cleanMssv]);

      for (const grant of manualGrantsResult.rows) {
        const evidence = {
          grant_type: 'manual',
          granted_by: grant.granted_by,
          note: grant.note,
          granted_at: grant.granted_at
        };
        const inserted = await client.query(`
          INSERT INTO student_achievement_unlocks (mssv, achievement_id, evidence)
          SELECT $1::varchar, $2::text, $3::jsonb
          WHERE EXISTS (
            SELECT 1 FROM students WHERE mssv = $1::varchar AND is_active = TRUE
          ) AND EXISTS (
            SELECT 1 FROM achievement_definitions WHERE id = $2::text AND is_active = TRUE
          )
          ON CONFLICT (mssv, achievement_id) DO NOTHING
          RETURNING achievement_id;
        `, [cleanMssv, grant.achievement_id, JSON.stringify(evidence)]);
        if (inserted.rowCount) newlyUnlocked.push(grant.achievement_id);
      }

      return {
        skipped: false,
        semesterCount: semesters.length,
        newlyUnlocked
      };
    });
  }
};

export const AchievementInternals = {
  evaluateAchievement,
  extractSemesterResults,
  gpaDeltas,
  semesterSort
};
