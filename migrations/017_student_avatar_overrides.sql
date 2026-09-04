-- Migration 017: admin-managed local avatar overrides with BDU fallback.

CREATE TABLE IF NOT EXISTS student_avatar_overrides (
  mssv VARCHAR(32) PRIMARY KEY REFERENCES students(mssv) ON DELETE CASCADE,
  url_img TEXT,
  storage_key TEXT,
  original_filename TEXT,
  mime_type TEXT,
  file_size INTEGER CHECK (file_size IS NULL OR file_size >= 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  content_hash TEXT,
  updated_by_mssv VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT student_avatar_override_storage_check CHECK (
    (deleted_at IS NOT NULL)
    OR (NULLIF(url_img, '') IS NOT NULL AND NULLIF(storage_key, '') IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS student_avatar_overrides_active_idx
  ON student_avatar_overrides (updated_at DESC)
  WHERE deleted_at IS NULL AND NULLIF(url_img, '') IS NOT NULL;

CREATE TABLE IF NOT EXISTS student_avatar_override_audit (
  id BIGSERIAL PRIMARY KEY,
  mssv VARCHAR(32) NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('upload', 'remove')),
  actor_mssv VARCHAR(32) NOT NULL,
  url_img TEXT,
  storage_key TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS student_avatar_override_audit_mssv_idx
  ON student_avatar_override_audit (mssv, created_at DESC);

