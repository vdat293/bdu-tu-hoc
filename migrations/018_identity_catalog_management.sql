-- Migration 018: Dynamic catalog management and flexible audit actions
-- Ensures future item additions/edits/deletions never require schema changes or DB backups.

-- 1. Nới lỏng ràng buộc audit action để hỗ trợ các thao tác quản trị mở rộng
ALTER TABLE identity_entitlement_audit
  DROP CONSTRAINT IF EXISTS identity_entitlement_audit_action_check;

-- 2. Đảm bảo bảng identity_items có các chỉ mục phục vụ tìm kiếm và lọc trạng thái
CREATE INDEX IF NOT EXISTS identity_items_active_idx
  ON identity_items (is_active, item_type, sort_order);

CREATE INDEX IF NOT EXISTS identity_items_metadata_gin_idx
  ON identity_items USING GIN (metadata);

-- 3. Cập nhật metadata cho các item đã có để đánh dấu item cấp thủ công
UPDATE identity_items
SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{manual_grantable}', 'true'::jsonb, true)
WHERE id IN ('title:ttcds', 'frame:anime-gojo', 'frame:anime-itachi');
