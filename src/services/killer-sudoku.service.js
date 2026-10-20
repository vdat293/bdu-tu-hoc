import { isDatabaseConfigured, query } from '../db/database.js';

export class KillerSudokuService {
  /**
   * Lấy tiến độ các màn đã giải của sinh viên
   * @param {string} mssv
   * @param {string} [difficulty]
   */
  static async getProgress(mssv, difficulty = null) {
    if (!mssv) {
      const err = new Error('Yêu cầu đăng nhập để xem tiến độ.');
      err.status = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    if (!isDatabaseConfigured()) {
      return { solvedByDifficulty: {}, list: [] };
    }

    let sql = `
      SELECT difficulty, level_id, best_time_seconds, mistakes, solve_count, completed_at
      FROM killer_sudoku_progress
      WHERE mssv = $1
    `;
    const params = [String(mssv).trim().toUpperCase()];

    if (difficulty) {
      sql += ` AND LOWER(difficulty) = LOWER($2)`;
      params.push(String(difficulty).trim());
    }

    sql += ` ORDER BY completed_at DESC`;

    const res = await query(sql, params);
    const rows = res?.rows || [];

    // Nhóm theo difficulty -> { [diff]: { [levelId]: record } }
    const solvedMap = {};
    for (const r of rows) {
      const diff = r.difficulty.toLowerCase();
      if (!solvedMap[diff]) solvedMap[diff] = {};
      solvedMap[diff][r.level_id] = {
        bestTimeSeconds: Number(r.best_time_seconds) || 0,
        mistakes: Number(r.mistakes) || 0,
        solveCount: Number(r.solve_count) || 1,
        completedAt: r.completed_at
      };
    }

    return {
      solvedByDifficulty: solvedMap,
      list: rows.map(r => ({
        difficulty: r.difficulty,
        levelId: r.level_id,
        bestTimeSeconds: Number(r.best_time_seconds) || 0,
        mistakes: Number(r.mistakes) || 0,
        solveCount: Number(r.solve_count) || 1,
        completedAt: r.completed_at
      }))
    };
  }

  /**
   * Ghi nhận hoàn thành màn cờ
   * @param {object} param0
   * @param {string} param0.mssv
   * @param {string} param0.difficulty
   * @param {string|number} param0.levelId
   * @param {number} param0.timeSeconds
   * @param {number} param0.mistakes
   */
  static async recordCompletion({ mssv, difficulty, levelId, timeSeconds = 0, mistakes = 0 }) {
    if (!mssv) {
      const err = new Error('Yêu cầu đăng nhập để lưu tiến độ.');
      err.status = 401;
      err.code = 'UNAUTHORIZED';
      throw err;
    }

    if (!isDatabaseConfigured()) {
      return { success: true, simulated: true };
    }

    const cleanMssv = String(mssv).trim().toUpperCase();
    const cleanDiff = String(difficulty || 'easy').trim().toLowerCase();
    const cleanLevelId = String(levelId || '1').trim();
    const cleanTime = Math.max(0, parseInt(timeSeconds, 10) || 0);
    const cleanMistakes = Math.max(0, parseInt(mistakes, 10) || 0);

    const upsertSql = `
      INSERT INTO killer_sudoku_progress (
        mssv, difficulty, level_id, best_time_seconds, mistakes, solve_count, completed_at
      )
      VALUES ($1, $2, $3, $4, $5, 1, NOW())
      ON CONFLICT (mssv, difficulty, level_id)
      DO UPDATE SET
        best_time_seconds = CASE 
          WHEN killer_sudoku_progress.best_time_seconds <= 0 THEN EXCLUDED.best_time_seconds
          WHEN EXCLUDED.best_time_seconds <= 0 THEN killer_sudoku_progress.best_time_seconds
          ELSE LEAST(killer_sudoku_progress.best_time_seconds, EXCLUDED.best_time_seconds)
        END,
        mistakes = LEAST(killer_sudoku_progress.mistakes, EXCLUDED.mistakes),
        solve_count = killer_sudoku_progress.solve_count + 1,
        completed_at = NOW()
      RETURNING difficulty, level_id, best_time_seconds, mistakes, solve_count, completed_at;
    `;

    const res = await query(upsertSql, [cleanMssv, cleanDiff, cleanLevelId, cleanTime, cleanMistakes]);
    const row = res?.rows?.[0] || null;

    return {
      success: true,
      progress: row ? {
        difficulty: row.difficulty,
        levelId: row.level_id,
        bestTimeSeconds: Number(row.best_time_seconds) || 0,
        mistakes: Number(row.mistakes) || 0,
        solveCount: Number(row.solve_count) || 1,
        completedAt: row.completed_at
      } : null
    };
  }
}
