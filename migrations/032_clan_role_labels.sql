-- Migration 032: Custom display labels per-CLB cho role_key ổn định.
-- role_key giữ nguyên 5 keys (leader, vice_leader, elder, member, recruit);
-- display_name + color cho phép mỗi CLB đặt tên hiển thị riêng.

CREATE TABLE IF NOT EXISTS clan_role_labels (
  clan_id BIGINT NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL CHECK (role_key IN ('leader', 'vice_leader', 'elder', 'member', 'recruit')),
  display_name TEXT NOT NULL CHECK (char_length(display_name) >= 2 AND char_length(display_name) <= 20),
  color TEXT CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  updated_by VARCHAR(32),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (clan_id, role_key)
);

CREATE INDEX IF NOT EXISTS clan_role_labels_clan_idx
  ON clan_role_labels (clan_id);

-- Cấm trùng tên hiển thị trong cùng 1 CLB (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS clan_role_labels_clan_name_unique_idx
  ON clan_role_labels (clan_id, lower(display_name));
