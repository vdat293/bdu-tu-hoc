-- Migration 016: moderation metadata and server-owned identity entitlements.

ALTER TABLE community_posts
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by_mssv VARCHAR(32),
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE community_post_comments
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by_mssv VARCHAR(32),
  ADD COLUMN IF NOT EXISTS delete_reason TEXT,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS equipped_frame_id TEXT,
  ADD COLUMN IF NOT EXISTS cosmetic_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS identity_items (
  id TEXT PRIMARY KEY,
  item_type TEXT NOT NULL CHECK (item_type IN ('frame', 'title', 'capability')),
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rarity TEXT NOT NULL DEFAULT 'common' CHECK (rarity IN ('common', 'rare', 'epic', 'legendary', 'vip')),
  asset_key TEXT,
  display_policy TEXT NOT NULL DEFAULT 'optional'
    CHECK (display_policy IN ('optional', 'auto_equip', 'mandatory')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS identity_entitlement_grants (
  id BIGSERIAL PRIMARY KEY,
  mssv VARCHAR(32) NOT NULL,
  item_id TEXT NOT NULL REFERENCES identity_items(id) ON DELETE RESTRICT,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'achievement', 'ranking', 'clan', 'campaign', 'migration')),
  granted_by_mssv VARCHAR(32),
  reason TEXT,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by_mssv VARCHAR(32),
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT identity_grants_expiry_check CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_entitlement_active_unique_idx
  ON identity_entitlement_grants (mssv, item_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS identity_entitlement_mssv_idx
  ON identity_entitlement_grants (mssv, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS identity_entitlement_audit (
  id BIGSERIAL PRIMARY KEY,
  grant_id BIGINT REFERENCES identity_entitlement_grants(id) ON DELETE SET NULL,
  mssv VARCHAR(32) NOT NULL,
  item_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('grant', 'revoke', 'equip', 'select_title')),
  actor_mssv VARCHAR(32),
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS identity_entitlement_audit_mssv_idx
  ON identity_entitlement_audit (mssv, created_at DESC);

CREATE TABLE IF NOT EXISTS system_roles (
  mssv VARCHAR(32) NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'identity_admin', 'moderator')),
  granted_by_mssv VARCHAR(32),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mssv, role)
);

CREATE INDEX IF NOT EXISTS system_roles_active_idx
  ON system_roles (mssv, role) WHERE is_active = TRUE;

INSERT INTO identity_items (id, item_type, label, description, rarity, asset_key, display_policy, sort_order)
VALUES
  ('title:ttcds', 'title', '#TTCDS', 'Trung tâm Chuyển đổi số', 'vip', 'ttcds', 'auto_equip', 5),
  ('frame:anime-gojo', 'frame', 'Thiên Thượng Thiên Hạ', 'Khung Anime Signature Gojo.', 'legendary', 'anime-gojo', 'optional', 10),
  ('frame:anime-itachi', 'frame', 'Ảo Nguyệt Hắc Viêm', 'Khung Anime Signature Itachi.', 'legendary', 'anime-itachi', 'optional', 11),
  ('frame:truong-1', 'frame', 'Thiên Cực Đế Tinh BDU', 'Khung Top 1 toàn trường.', 'legendary', 'truong-1', 'optional', 20),
  ('frame:truong-2', 'frame', 'Song Nguyệt Tinh Vân BDU', 'Khung Top 2 toàn trường.', 'epic', 'truong-2', 'optional', 21),
  ('frame:truong-3', 'frame', 'Tam Tinh Xích Quang BDU', 'Khung Top 3 toàn trường.', 'epic', 'truong-3', 'optional', 22),
  ('frame:truong-top', 'frame', 'Kinh Tuyến Tinh Tú BDU', 'Khung Top 4-10 toàn trường.', 'rare', 'truong-top', 'optional', 23),
  ('frame:vien-1', 'frame', 'Bạch Kim Sapphire Viện Trưởng', 'Khung Top 1 viện.', 'epic', 'vien-1', 'optional', 30),
  ('frame:vien-top', 'frame', 'Băng Tinh Lam Vũ Sapphire', 'Khung Top 2-10 viện.', 'rare', 'vien-top', 'optional', 31),
  ('frame:khoa-1', 'frame', 'Chiến Tướng Khiên Vàng Lục Bảo', 'Khung Top 1 khoa.', 'epic', 'khoa-1', 'optional', 40),
  ('frame:khoa-2', 'frame', 'Dual-Core Synapse', 'Khung Top 2 khoa TH.', 'rare', 'khoa-2', 'optional', 41),
  ('frame:khoa-3', 'frame', 'Ternary Data Stack', 'Khung Top 3 khoa TH.', 'rare', 'khoa-3', 'optional', 42),
  ('frame:khoa-top', 'frame', 'Cyber Knight Emerald', 'Khung Top 4-10 khoa.', 'rare', 'khoa-top', 'optional', 43),
  ('frame:lop-1', 'frame', 'Phượng Hoàng Hoàng Kim Lửa', 'Khung Top 1 lớp.', 'epic', 'lop-1', 'optional', 50),
  ('frame:lop-top', 'frame', 'Hoàng Đồng Hổ Phách Nung', 'Khung Top 2-10 lớp.', 'rare', 'lop-top', 'optional', 51),
  ('capability:frame-preview-all', 'capability', 'Toàn bộ bộ sưu tập khung', 'Mở khóa toàn bộ khung hiện có và khung mới.', 'vip', 'frame-preview-all', 'optional', 1)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  rarity = EXCLUDED.rarity,
  asset_key = EXCLUDED.asset_key,
  display_policy = EXCLUDED.display_policy,
  updated_at = NOW();

-- Preserve the existing #TTCDS grants without requiring future SQL edits.
INSERT INTO identity_entitlement_grants (mssv, item_id, source, granted_by_mssv, reason, created_at, updated_at)
SELECT grants.mssv, 'title:ttcds', 'migration', NULL, grants.note, grants.granted_at, grants.updated_at
FROM manual_achievement_grants grants
WHERE grants.achievement_id = 'ttcds'
  AND grants.is_active = TRUE
ON CONFLICT DO NOTHING;

-- Preserve the existing Anime Signature allow-list as data. 24050126 keeps its
-- all-frame preview capability instead of a frontend-only allow-list.
INSERT INTO identity_entitlement_grants (mssv, item_id, source, reason)
VALUES
  ('24050126', 'capability:frame-preview-all', 'migration', 'Chuyển quyền preview toàn bộ khung từ frontend sang server'),
  ('21050008', 'frame:anime-gojo', 'migration', 'Chuyển quyền Anime Signature từ frontend sang server'),
  ('21050008', 'frame:anime-itachi', 'migration', 'Chuyển quyền Anime Signature từ frontend sang server'),
  ('21050011', 'frame:anime-gojo', 'migration', 'Chuyển quyền Anime Signature từ frontend sang server'),
  ('21050011', 'frame:anime-itachi', 'migration', 'Chuyển quyền Anime Signature từ frontend sang server'),
  ('21050044', 'frame:anime-gojo', 'migration', 'Chuyển quyền Anime Signature từ frontend sang server'),
  ('21050044', 'frame:anime-itachi', 'migration', 'Chuyển quyền Anime Signature từ frontend sang server'),
  ('22050068', 'frame:anime-gojo', 'migration', 'Chuyển quyền Anime Signature từ frontend sang server'),
  ('22050068', 'frame:anime-itachi', 'migration', 'Chuyển quyền Anime Signature từ frontend sang server'),
  ('22050090', 'frame:anime-gojo', 'migration', 'Chuyển quyền Anime Signature từ frontend sang server'),
  ('22050090', 'frame:anime-itachi', 'migration', 'Chuyển quyền Anime Signature từ frontend sang server'),
  ('22050101', 'frame:anime-gojo', 'migration', 'Chuyển quyền Anime Signature từ frontend sang server'),
  ('22050101', 'frame:anime-itachi', 'migration', 'Chuyển quyền Anime Signature từ frontend sang server')
ON CONFLICT DO NOTHING;

-- Keep grants addressable even before a recipient's first login. The normal
-- login/profile flow will later fill the verified name and activate the row.
INSERT INTO students (mssv, full_name, is_active)
SELECT DISTINCT mssv, '', FALSE
FROM identity_entitlement_grants
WHERE source = 'migration'
ON CONFLICT (mssv) DO NOTHING;

-- Keep the legacy selected title id readable while the API migrates it.
UPDATE students
SET displayed_title_ids = (
  SELECT COALESCE(jsonb_agg(CASE WHEN value = 'achievement:ttcds' THEN 'title:ttcds' ELSE value END), '[]'::jsonb)
  FROM jsonb_array_elements_text(displayed_title_ids) AS entries(value)
),
updated_at = NOW()
WHERE displayed_title_ids @> '["achievement:ttcds"]'::jsonb;
