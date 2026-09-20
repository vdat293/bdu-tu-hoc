-- Migration 045: Thống kê thắng/thua của Game Hub và marker chống tính trùng mỗi ván.
-- game_match_results chỉ tồn tại trong vòng đời phòng (cascade khi phòng đóng) và
-- đóng vai trò idempotency: mỗi (room, state_version, ghế) chỉ được cộng stat 1 lần.

CREATE TABLE IF NOT EXISTS game_player_stats (
  mssv VARCHAR(32) PRIMARY KEY REFERENCES students(mssv) ON DELETE CASCADE,
  games_played INTEGER NOT NULL DEFAULT 0 CHECK (games_played >= 0),
  wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
  draws INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_match_results (
  room_id BIGINT NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  state_version BIGINT NOT NULL CHECK (state_version > 0),
  seat SMALLINT NOT NULL CHECK (seat IN (1, 2)),
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  game_type TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('win', 'loss', 'draw')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, state_version, seat)
);

CREATE INDEX IF NOT EXISTS game_player_stats_leaderboard_idx
  ON game_player_stats (wins DESC, games_played DESC);
