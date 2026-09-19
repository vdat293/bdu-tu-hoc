-- Migration 042: đánh dấu ngày thuộc (known_at) + lịch ôn tập Leitner 1/7/30 ngày.
--
-- vocab_progress giờ lưu vết:
--   known_at         : lần đầu user đánh dấu "đã thuộc" (giữ nguyên khi bấm lại)
--   review_stage     : 0 = vừa thuộc, 1 = đã ôn ngày, 2 = đã ôn tuần, 3 = đã ôn tháng (thành thạo)
--   next_review_at   : mốc đến hạn ôn kế tiếp (NULL = đã thành thạo, không nhắc nữa)
--   last_reviewed_at : lần ôn gần nhất
--
-- LƯU Ý: migrate.js chạy lại toàn bộ file mỗi lần deploy -> phải idempotent.

ALTER TABLE vocab_progress
  ADD COLUMN IF NOT EXISTS known_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_stage SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_review_at TIMESTAMPTZ;

-- Backfill: từ đã thuộc trước migration lấy updated_at làm ngày thuộc và
-- đưa vào đợt ôn đầu tiên ngay khi deploy.
-- Chỉ chạy cho dòng chưa có known_at (dòng cũ); nhờ vậy từ đã thành thạo
-- (next_review_at = NULL) không bị lên lịch lại mỗi lần deploy.
UPDATE vocab_progress
SET known_at = updated_at,
    next_review_at = NOW()
WHERE status = 'known' AND known_at IS NULL;

CREATE INDEX IF NOT EXISTS vocab_progress_due_idx
  ON vocab_progress (mssv, next_review_at)
  WHERE status = 'known' AND next_review_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS vocab_progress_known_at_idx
  ON vocab_progress (mssv, known_at)
  WHERE known_at IS NOT NULL;
