-- Migration 026: Phòng giải trí online, challenge có hạn dùng và lịch sử nước đi.
-- State trong game_rooms là server-authoritative; game_room_moves là audit/recovery log.

CREATE TABLE IF NOT EXISTS game_rooms (
  id BIGSERIAL PRIMARY KEY,
  room_code VARCHAR(16) NOT NULL UNIQUE,
  name VARCHAR(80),
  game_type TEXT NOT NULL CHECK (game_type IN ('caro', 'tic_tac_toe', 'chess', 'xiangqi', 'go', 'connect4')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  allow_spectators BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'finished', 'expired', 'cancelled')),
  created_by_mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  state JSONB NOT NULL,
  state_version BIGINT NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  winner_seat SMALLINT CHECK (winner_seat IS NULL OR winner_seat IN (1, 2)),
  result TEXT CHECK (result IS NULL OR result IN ('win', 'draw', 'resigned', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS name VARCHAR(80);
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS allow_spectators BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS game_rooms_game_type_check;
ALTER TABLE game_rooms ADD CONSTRAINT game_rooms_game_type_check
  CHECK (game_type IN ('caro', 'tic_tac_toe', 'chess', 'xiangqi', 'go', 'connect4'));

CREATE TABLE IF NOT EXISTS game_room_players (
  room_id BIGINT NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  seat SMALLINT NOT NULL CHECK (seat IN (1, 2)),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  PRIMARY KEY (room_id, mssv),
  UNIQUE (room_id, seat)
);

CREATE INDEX IF NOT EXISTS game_rooms_browse_idx
  ON game_rooms (status, visibility, game_type, created_at DESC);

CREATE INDEX IF NOT EXISTS game_rooms_expiry_idx
  ON game_rooms (expires_at)
  WHERE status IN ('waiting', 'active');

CREATE INDEX IF NOT EXISTS game_room_players_mssv_idx
  ON game_room_players (mssv, joined_at DESC);

CREATE TABLE IF NOT EXISTS game_room_moves (
  id BIGSERIAL PRIMARY KEY,
  room_id BIGINT NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  move_number BIGINT NOT NULL CHECK (move_number > 0),
  actor_mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  move JSONB NOT NULL,
  resulting_state JSONB NOT NULL,
  client_move_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, move_number),
  UNIQUE (room_id, client_move_id)
);

CREATE INDEX IF NOT EXISTS game_room_moves_room_idx
  ON game_room_moves (room_id, move_number ASC);

CREATE TABLE IF NOT EXISTS game_challenges (
  id UUID PRIMARY KEY,
  room_id BIGINT NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  created_by_mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  challenged_mssv VARCHAR(32) REFERENCES students(mssv) ON DELETE SET NULL,
  invite_code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  confession_post_id BIGINT REFERENCES community_posts(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_by_mssv VARCHAR(32) REFERENCES students(mssv) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS game_challenges_room_status_idx
  ON game_challenges (room_id, status, expires_at);

CREATE INDEX IF NOT EXISTS game_challenges_target_status_idx
  ON game_challenges (challenged_mssv, status, expires_at)
  WHERE challenged_mssv IS NOT NULL;

CREATE INDEX IF NOT EXISTS game_challenges_expiry_idx
  ON game_challenges (expires_at)
  WHERE status = 'pending';
