-- Migration 019: Quản lý yêu cầu xin gia nhập CLB / Nhóm và phân quyền duyệt thành viên.

CREATE TABLE IF NOT EXISTS clan_join_requests (
  id BIGSERIAL PRIMARY KEY,
  clan_id BIGINT NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  message TEXT,
  reviewed_by_mssv VARCHAR(32) REFERENCES students(mssv) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Một sinh viên chỉ có tối đa 1 yêu cầu pending trong cùng 1 CLB tại một thời điểm
CREATE UNIQUE INDEX IF NOT EXISTS clan_join_requests_pending_unique_idx
  ON clan_join_requests (clan_id, mssv)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS clan_join_requests_clan_status_idx
  ON clan_join_requests (clan_id, status);

CREATE INDEX IF NOT EXISTS clan_join_requests_mssv_status_idx
  ON clan_join_requests (mssv, status);
