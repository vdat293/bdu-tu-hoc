-- Migration 044: Mở rộng phòng giải trí cho bộ game mới (battleship/checkers/backgammon),
-- đồng hồ mỗi nước, cờ chat và các kết quả timeout/forfeit.
-- Toàn bộ câu lệnh phải idempotent vì scripts/migrate.js chạy lại mọi file mỗi lần.

ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS game_rooms_game_type_check;
ALTER TABLE game_rooms ADD CONSTRAINT game_rooms_game_type_check
  CHECK (game_type IN ('caro', 'tic_tac_toe', 'chess', 'xiangqi', 'go', 'connect4', 'battleship', 'checkers', 'backgammon'));

ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS game_rooms_result_check;
ALTER TABLE game_rooms ADD CONSTRAINT game_rooms_result_check
  CHECK (result IS NULL OR result IN ('win', 'draw', 'resigned', 'expired', 'cancelled', 'timeout', 'forfeit'));

-- turn_seconds = 0/NULL nghĩa là không giới hạn thời gian mỗi nước.
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS turn_seconds INTEGER;
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS turn_deadline TIMESTAMPTZ;
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS allow_chat BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS game_rooms_turn_seconds_check;
ALTER TABLE game_rooms ADD CONSTRAINT game_rooms_turn_seconds_check
  CHECK (turn_seconds IS NULL OR turn_seconds = 0 OR (turn_seconds >= 10 AND turn_seconds <= 600));

-- Sweeper quét phòng active quá hạn lượt; partial index giữ nhỏ.
CREATE INDEX IF NOT EXISTS game_rooms_turn_deadline_idx
  ON game_rooms (turn_deadline)
  WHERE status = 'active' AND turn_deadline IS NOT NULL;
