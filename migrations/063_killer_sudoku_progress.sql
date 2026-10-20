-- Migration 063: Lưu tiến độ giải Killer Sudoku theo tài khoản sinh viên
-- Mỗi tài khoản lưu các màn đã giải thành công theo độ khó, thời gian hoàn thành tốt nhất, số lỗi, số lần giải.

CREATE TABLE IF NOT EXISTS killer_sudoku_progress (
  id BIGSERIAL PRIMARY KEY,
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  difficulty VARCHAR(32) NOT NULL,
  level_id VARCHAR(64) NOT NULL,
  best_time_seconds INTEGER NOT NULL DEFAULT 0,
  mistakes INTEGER NOT NULL DEFAULT 0,
  solve_count INTEGER NOT NULL DEFAULT 1,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_killer_sudoku_user_level UNIQUE (mssv, difficulty, level_id)
);

CREATE INDEX IF NOT EXISTS idx_killer_sudoku_progress_user
  ON killer_sudoku_progress(mssv, difficulty);
