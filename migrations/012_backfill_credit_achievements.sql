-- Migration 012: Mở khóa hai danh hiệu tín chỉ từ lịch sử học kỳ đã lưu.

WITH qualifying AS (
  SELECT
    results.mssv,
    JSONB_BUILD_OBJECT(
      'minimum_credits', 18,
      'credits_operator', 'at_least',
      'threshold_gpa_4', 3.2,
      'semesters', JSONB_AGG(JSONB_BUILD_OBJECT(
        'semester_code', results.semester_code,
        'semester_name', COALESCE(results.semester_name, results.semester_code),
        'semester_gpa_4', results.semester_gpa_4,
        'semester_classification', results.semester_classification,
        'earned_credits', results.earned_credits
      ) ORDER BY results.semester_code)
    ) AS evidence
  FROM student_semester_results results
  JOIN students ON students.mssv = results.mssv AND students.is_active = TRUE
  WHERE results.earned_credits >= 18
    AND results.semester_gpa_4 >= 3.2
  GROUP BY results.mssv
)
INSERT INTO student_achievement_unlocks (mssv, achievement_id, evidence)
SELECT qualifying.mssv, definitions.id, qualifying.evidence
FROM qualifying
JOIN achievement_definitions definitions
  ON definitions.id = 'credit_warrior' AND definitions.is_active = TRUE
ON CONFLICT (mssv, achievement_id) DO NOTHING;

WITH qualifying AS (
  SELECT
    results.mssv,
    JSONB_BUILD_OBJECT(
      'minimum_credits', 20,
      'credits_operator', 'greater_than',
      'threshold_gpa_4', 3.2,
      'semesters', JSONB_AGG(JSONB_BUILD_OBJECT(
        'semester_code', results.semester_code,
        'semester_name', COALESCE(results.semester_name, results.semester_code),
        'semester_gpa_4', results.semester_gpa_4,
        'semester_classification', results.semester_classification,
        'earned_credits', results.earned_credits
      ) ORDER BY results.semester_code)
    ) AS evidence
  FROM student_semester_results results
  JOIN students ON students.mssv = results.mssv AND students.is_active = TRUE
  WHERE results.earned_credits > 20
    AND results.semester_gpa_4 >= 3.2
  GROUP BY results.mssv
)
INSERT INTO student_achievement_unlocks (mssv, achievement_id, evidence)
SELECT qualifying.mssv, definitions.id, qualifying.evidence
FROM qualifying
JOIN achievement_definitions definitions
  ON definitions.id = 'breaking_limits' AND definitions.is_active = TRUE
ON CONFLICT (mssv, achievement_id) DO NOTHING;

