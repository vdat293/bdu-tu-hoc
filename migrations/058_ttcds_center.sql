-- Migration 058: Trung tâm Chuyển đổi số — nhóm quan tâm "Sinh viên của tôi".
-- Group riêng tư theo người tạo (owner_mssv); MSSV chuẩn hóa UPPER ở service layer.
-- Quyền trong Trung tâm chỉ 2 nấc view/create; chưa có dòng = 'view'.
-- ttcds_audit_logs giữ bằng chứng tạo group / thêm-bớt SV / cấp quyền.

-- gen_random_uuid() cần pgcrypto (031 đã tạo trên DB cũ; giữ idempotent cho DB trắng).
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS ttcds_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  nien_khoa TEXT,
  description TEXT,
  owner_mssv VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ttcds_group_members (
  id BIGSERIAL PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES ttcds_groups(id) ON DELETE CASCADE,
  mssv VARCHAR(32) NOT NULL,
  added_by_mssv VARCHAR(32),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ttcds_group_members_group_mssv_unique UNIQUE (group_id, mssv)
);

CREATE TABLE IF NOT EXISTS ttcds_permissions (
  mssv VARCHAR(32) PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'view' CHECK (level IN ('view', 'create')),
  granted_by TEXT,
  note TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Không FK tới ttcds_groups: xoá group vẫn phải giữ audit làm bằng chứng.
CREATE TABLE IF NOT EXISTS ttcds_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_mssv VARCHAR(32),
  action TEXT NOT NULL,
  target_group_id UUID,
  target_mssv VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ttcds_groups_owner_mssv_idx
  ON ttcds_groups (owner_mssv);

CREATE INDEX IF NOT EXISTS ttcds_group_members_mssv_idx
  ON ttcds_group_members (mssv);
