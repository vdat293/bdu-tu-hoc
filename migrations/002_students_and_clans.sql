-- Migration 002: Bảng Quản lý Sinh viên, Clan/Guild/CLB và Trạng thái Active

CREATE TABLE IF NOT EXISTS students (
  mssv VARCHAR(32) PRIMARY KEY,
  full_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  first_login_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clans (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name TEXT NOT NULL,
  tag VARCHAR(12),
  description TEXT,
  avatar_url TEXT,
  leader_mssv VARCHAR(32) REFERENCES students(mssv) ON DELETE SET NULL,
  level INTEGER NOT NULL DEFAULT 1,
  xp BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_clans (
  id BIGSERIAL PRIMARY KEY,
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  clan_id BIGINT NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'vice_leader', 'elder', 'member', 'recruit')),
  contribution_points BIGINT NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_clans_mssv_clan_unique UNIQUE (mssv, clan_id)
);

-- Tối ưu hóa truy vấn
CREATE INDEX IF NOT EXISTS students_is_active_idx
  ON students (is_active);

CREATE INDEX IF NOT EXISTS student_clans_mssv_idx
  ON student_clans (mssv);

CREATE INDEX IF NOT EXISTS student_clans_clan_id_idx
  ON student_clans (clan_id);

CREATE INDEX IF NOT EXISTS clans_code_idx
  ON clans (code);

-- Đồng bộ sinh viên từ academic_rankings nếu đã có dữ liệu từ trước
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'academic_rankings') THEN
    INSERT INTO students (mssv, full_name, is_active, created_at, updated_at)
    SELECT DISTINCT mssv, full_name, FALSE, NOW(), NOW()
    FROM academic_rankings
    WHERE mssv IS NOT NULL
    ON CONFLICT (mssv) DO NOTHING;
  END IF;
END $$;
