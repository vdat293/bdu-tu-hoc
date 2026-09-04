import fs from 'node:fs/promises';
import path from 'node:path';
import { isDatabaseConfigured, query, transaction } from '../db/database.js';

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireDatabase() {
  if (!isDatabaseConfigured()) throw httpError('Database chưa được cấu hình.', 503);
}

function cleanReason(value) {
  return String(value || '').trim().slice(0, 500) || null;
}

function parseDate(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw httpError(`${fieldName} không hợp lệ.`);
  return date.toISOString();
}

function envOwnerMssv() {
  return normalizeMssv(process.env.SYSTEM_OWNER_MSSV);
}

export const IdentityAdminService = {
  async hasRole(mssv, role = 'identity_admin') {
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanMssv) return false;
    if ((role === 'owner' || role === 'identity_admin') && envOwnerMssv() === cleanMssv) return true;
    if (!isDatabaseConfigured()) return false;
    const result = await query(
      'SELECT 1 FROM system_roles WHERE mssv = $1 AND role = $2 AND is_active = TRUE LIMIT 1',
      [cleanMssv, role]
    );
    return result.rowCount > 0;
  },

  async requireRole(mssv, role = 'identity_admin') {
    if (!(await this.hasRole(mssv, role))) {
      throw httpError('Bạn không có quyền quản trị danh hiệu/khung.', 403);
    }
    return true;
  },

  async grantRole({ mssv, role, actorMssv }) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    const cleanActor = normalizeMssv(actorMssv);
    const allowedRoles = new Set(['owner', 'identity_admin', 'moderator']);
    if (!/^[A-Z0-9]{6,32}$/.test(cleanMssv) || !allowedRoles.has(role)) throw httpError('Thông tin role không hợp lệ.');
    await this.requireRole(cleanActor, 'owner');
    await query(`
      INSERT INTO students (mssv, full_name, is_active)
      VALUES ($1, '', FALSE)
      ON CONFLICT (mssv) DO NOTHING;
    `, [cleanMssv]);
    const result = await query(`
      INSERT INTO system_roles (mssv, role, granted_by_mssv, is_active)
      VALUES ($1, $2, $3, TRUE)
      ON CONFLICT (mssv, role) DO UPDATE SET
        granted_by_mssv = EXCLUDED.granted_by_mssv,
        is_active = TRUE,
        updated_at = NOW()
      RETURNING *;
    `, [cleanMssv, role, cleanActor]);
    await query(`
      INSERT INTO identity_entitlement_audit (mssv, item_id, action, actor_mssv, reason, metadata)
      VALUES ($1, $2, 'grant', $3, 'system_role', $4::jsonb);
    `, [cleanMssv, `system-role:${role}`, cleanActor, JSON.stringify({ role })]);
    return result.rows[0];
  },

  async revokeRole({ mssv, role, actorMssv }) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    const cleanActor = normalizeMssv(actorMssv);
    if (!cleanMssv || !['owner', 'identity_admin', 'moderator'].includes(role)) throw httpError('Thông tin role không hợp lệ.');
    await this.requireRole(cleanActor, 'owner');
    if (envOwnerMssv() === cleanMssv && role === 'owner') throw httpError('Không thể thu hồi owner bootstrap từ giao diện.');
    const result = await query(
      'UPDATE system_roles SET is_active = FALSE, updated_at = NOW() WHERE mssv = $1 AND role = $2 RETURNING *',
      [cleanMssv, role]
    );
    if (!result.rowCount) throw httpError('Không tìm thấy role đang hoạt động.', 404);
    await query(`
      INSERT INTO identity_entitlement_audit (mssv, item_id, action, actor_mssv, reason, metadata)
      VALUES ($1, $2, 'revoke', $3, 'system_role', $4::jsonb);
    `, [cleanMssv, `system-role:${role}`, cleanActor, JSON.stringify({ role })]);
    return result.rows[0];
  },

  async listItems({ type = null, includeInactive = false } = {}) {
    requireDatabase();
    const params = [];
    const conditions = [];
    if (type) {
      params.push(String(type).trim().toLowerCase());
      conditions.push(`item_type = $${params.length}`);
    }
    if (!includeInactive) conditions.push('is_active = TRUE');
    const result = await query(`
      SELECT id, item_type, label, description, rarity, asset_key,
             display_policy, metadata, is_active, sort_order, created_at, updated_at
      FROM identity_items
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY sort_order, id;
    `, params);
    return result.rows;
  },

  async syncCatalogFromJson(customPath = null) {
    if (!isDatabaseConfigured()) return { synced: 0 };
    const filePath = customPath || path.resolve(process.cwd(), 'src', 'config', 'identity-items.json');
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const items = JSON.parse(content);
      if (!Array.isArray(items)) return { synced: 0 };

      let count = 0;
      for (const item of items) {
        if (!item.id || !item.item_type || !item.label) continue;
        await query(`
          INSERT INTO identity_items (
            id, item_type, label, description, rarity, asset_key,
            display_policy, sort_order, metadata, is_active, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, TRUE, NOW())
          ON CONFLICT (id) DO UPDATE SET
            label = EXCLUDED.label,
            description = EXCLUDED.description,
            rarity = EXCLUDED.rarity,
            asset_key = EXCLUDED.asset_key,
            display_policy = EXCLUDED.display_policy,
            sort_order = EXCLUDED.sort_order,
            metadata = identity_items.metadata || EXCLUDED.metadata,
            updated_at = NOW()
          WHERE COALESCE(identity_items.metadata->>'source', '') != 'admin_ui';
        `, [
          item.id,
          item.item_type,
          item.label,
          item.description || '',
          item.rarity || 'common',
          item.asset_key || null,
          item.display_policy || 'optional',
          Number(item.sort_order) || 100,
          JSON.stringify(item.metadata || { source: 'config' })
        ]);
        count++;
      }
      return { synced: count };
    } catch (err) {
      console.warn('[identity-catalog] Không thể đồng bộ từ JSON:', err.message);
      return { synced: 0, error: err.message };
    }
  },

  async createItem({ id, itemType, label, description, rarity, assetKey, displayPolicy, metadata = {}, sortOrder = 100, actorMssv }) {
    requireDatabase();
    const cleanActor = normalizeMssv(actorMssv);
    if (!cleanActor) throw httpError('Thiếu người thực hiện.', 401);
    await this.requireRole(cleanActor, 'identity_admin');

    const cleanId = String(id || '').trim().toLowerCase();
    const cleanType = String(itemType || '').trim().toLowerCase();
    const cleanLabel = String(label || '').trim().slice(0, 200);
    const cleanDesc = String(description || '').trim().slice(0, 1000);
    const cleanRarity = String(rarity || 'common').trim().toLowerCase();
    const cleanAssetKey = String(assetKey || '').trim() || null;
    const cleanPolicy = String(displayPolicy || 'optional').trim().toLowerCase();
    const safeOrder = Number(sortOrder) || 100;

    if (!/^(frame|title|capability):[a-z0-9_-]{2,64}$/i.test(cleanId)) {
      throw httpError('Mã ID không hợp lệ. Phải có tiền tố frame: hoặc title: hoặc capability: (ví dụ: frame:anime-sukuna)');
    }
    if (!['frame', 'title', 'capability'].includes(cleanType)) {
      throw httpError('Loại item phải là frame, title hoặc capability.');
    }
    if (!cleanLabel) throw httpError('Tên hiển thị không được để trống.');
    if (!['common', 'rare', 'epic', 'legendary', 'vip', 'youth', 'ai', 'charm'].includes(cleanRarity)) {
      throw httpError('Độ hiếm không hợp lệ (phải là common, rare, epic, legendary, vip, youth, ai hoặc charm).');
    }
    if (!['optional', 'auto_equip', 'mandatory'].includes(cleanPolicy)) {
      throw httpError('Chính sách hiển thị không hợp lệ.');
    }

    const existing = await query('SELECT 1 FROM identity_items WHERE id = $1', [cleanId]);
    if (existing.rowCount > 0) {
      throw httpError(`Item với mã ${cleanId} đã tồn tại trong hệ thống.`);
    }

    const itemMeta = {
      ...metadata,
      manual_grantable: metadata.manual_grantable !== false,
      source: 'admin_ui',
      created_by: cleanActor
    };

    const result = await query(`
      INSERT INTO identity_items (
        id, item_type, label, description, rarity, asset_key,
        display_policy, sort_order, metadata, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, TRUE, NOW(), NOW())
      RETURNING *;
    `, [cleanId, cleanType, cleanLabel, cleanDesc, cleanRarity, cleanAssetKey, cleanPolicy, safeOrder, JSON.stringify(itemMeta)]);

    await query(`
      INSERT INTO identity_entitlement_audit (mssv, item_id, action, actor_mssv, reason, metadata)
      VALUES ($1, $2, 'create_item', $3, $4, $5::jsonb);
    `, [cleanActor, cleanId, cleanActor, 'Tạo item mới từ Admin Tool', JSON.stringify({ label: cleanLabel, item_type: cleanType, rarity: cleanRarity })]);

    return result.rows[0];
  },

  async updateItem({ id, label, description, rarity, assetKey, displayPolicy, metadata, sortOrder, isActive, actorMssv }) {
    requireDatabase();
    const cleanActor = normalizeMssv(actorMssv);
    if (!cleanActor) throw httpError('Thiếu người thực hiện.', 401);
    await this.requireRole(cleanActor, 'identity_admin');

    const cleanId = String(id || '').trim();
    if (!cleanId) throw httpError('Mã ID không hợp lệ.');

    const current = await query('SELECT * FROM identity_items WHERE id = $1', [cleanId]);
    if (!current.rowCount) throw httpError('Không tìm thấy item cần sửa.', 404);
    const existing = current.rows[0];

    const cleanLabel = label !== undefined ? String(label || '').trim().slice(0, 200) : existing.label;
    const cleanDesc = description !== undefined ? String(description || '').trim().slice(0, 1000) : existing.description;
    const cleanRarity = rarity !== undefined ? String(rarity || 'common').trim().toLowerCase() : existing.rarity;
    const cleanAssetKey = assetKey !== undefined ? (String(assetKey || '').trim() || null) : existing.asset_key;
    const cleanPolicy = displayPolicy !== undefined ? String(displayPolicy || 'optional').trim().toLowerCase() : existing.display_policy;
    const safeOrder = sortOrder !== undefined ? (Number(sortOrder) || 100) : existing.sort_order;
    const safeActive = isActive !== undefined ? Boolean(isActive) : existing.is_active;

    const mergedMeta = {
      ...(existing.metadata || {}),
      ...(metadata || {}),
      updated_by: cleanActor
    };

    const result = await query(`
      UPDATE identity_items
      SET label = $1, description = $2, rarity = $3, asset_key = $4,
          display_policy = $5, sort_order = $6, metadata = $7::jsonb,
          is_active = $8, updated_at = NOW()
      WHERE id = $9
      RETURNING *;
    `, [cleanLabel, cleanDesc, cleanRarity, cleanAssetKey, cleanPolicy, safeOrder, JSON.stringify(mergedMeta), safeActive, cleanId]);

    await query(`
      INSERT INTO identity_entitlement_audit (mssv, item_id, action, actor_mssv, reason, metadata)
      VALUES ($1, $2, 'update_item', $3, $4, $5::jsonb);
    `, [cleanActor, cleanId, cleanActor, 'Cập nhật item từ Admin Tool', JSON.stringify({ label: cleanLabel, is_active: safeActive })]);

    return result.rows[0];
  },

  async deleteItem({ id, actorMssv, reason = '' }) {
    requireDatabase();
    const cleanActor = normalizeMssv(actorMssv);
    if (!cleanActor) throw httpError('Thiếu người thực hiện.', 401);
    await this.requireRole(cleanActor, 'identity_admin');

    const cleanId = String(id || '').trim();
    if (!cleanId) throw httpError('Mã ID không hợp lệ.');

    const current = await query('SELECT * FROM identity_items WHERE id = $1', [cleanId]);
    if (!current.rowCount) throw httpError('Không tìm thấy item cần xóa.', 404);

    const grantCheck = await query('SELECT COUNT(*) AS cnt FROM identity_entitlement_grants WHERE item_id = $1', [cleanId]);
    const grantCount = Number(grantCheck.rows[0]?.cnt || 0);

    if (grantCount > 0) {
      await query(`
        UPDATE identity_items
        SET is_active = FALSE, updated_at = NOW()
        WHERE id = $1;
      `, [cleanId]);

      await query(`
        INSERT INTO identity_entitlement_audit (mssv, item_id, action, actor_mssv, reason, metadata)
        VALUES ($1, $2, 'delete_item', $3, $4, $5::jsonb);
      `, [cleanActor, cleanId, cleanActor, cleanReason(reason) || 'Tắt item (đã có lịch sử cấp quyền)', JSON.stringify({ soft_deleted: true, grant_count: grantCount })]);

      return { id: cleanId, deleted: true, soft: true, grant_count: grantCount };
    }

    await query('DELETE FROM identity_items WHERE id = $1', [cleanId]);

    await query(`
      INSERT INTO identity_entitlement_audit (mssv, item_id, action, actor_mssv, reason, metadata)
      VALUES ($1, $2, 'delete_item', $3, $4, $5::jsonb);
    `, [cleanActor, cleanId, cleanActor, cleanReason(reason) || 'Xóa hoàn toàn item', JSON.stringify({ hard_deleted: true })]);

    return { id: cleanId, deleted: true, soft: false };
  },

  async listGrants(mssv) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanMssv) throw httpError('MSSV không hợp lệ.');
    const result = await query(`
      SELECT grants.id, grants.mssv, grants.item_id, grants.source,
             grants.granted_by_mssv, grants.reason, grants.starts_at,
             grants.expires_at, grants.revoked_at, grants.revoked_by_mssv,
             grants.revoke_reason, grants.created_at, grants.updated_at,
             items.item_type, items.label, items.rarity, items.asset_key
      FROM identity_entitlement_grants grants
      JOIN identity_items items ON items.id = grants.item_id
      WHERE grants.mssv = $1
      ORDER BY grants.revoked_at NULLS FIRST, grants.created_at DESC;
    `, [cleanMssv]);
    return result.rows;
  },

  async grant({ mssv, itemId, actorMssv, reason, startsAt, expiresAt }) {
    requireDatabase();
    const cleanMssv = normalizeMssv(mssv);
    const cleanItemId = String(itemId || '').trim();
    const cleanActor = normalizeMssv(actorMssv);
    if (!/^[A-Z0-9]{6,32}$/.test(cleanMssv)) throw httpError('MSSV không hợp lệ.');
    if (!cleanItemId) throw httpError('Item cần cấp là bắt buộc.');
    if (!cleanActor) throw httpError('Thiếu người cấp quyền.', 401);
    const cleanStartsAt = parseDate(startsAt, 'Thời điểm bắt đầu') || new Date().toISOString();
    const cleanExpiresAt = parseDate(expiresAt, 'Thời điểm hết hạn');
    if (cleanExpiresAt && new Date(cleanExpiresAt) <= new Date(cleanStartsAt)) {
      throw httpError('Thời điểm hết hạn phải sau thời điểm bắt đầu.');
    }

    return transaction(async (client) => {
      const item = await client.query(
        'SELECT id, item_type, display_policy FROM identity_items WHERE id = $1 AND is_active = TRUE',
        [cleanItemId]
      );
      if (!item.rowCount) throw httpError('Không tìm thấy item đang hoạt động.', 404);

      await client.query(`
        INSERT INTO students (mssv, full_name, is_active)
        VALUES ($1, '', FALSE)
        ON CONFLICT (mssv) DO NOTHING;
      `, [cleanMssv]);

      const grant = await client.query(`
        INSERT INTO identity_entitlement_grants
          (mssv, item_id, source, granted_by_mssv, reason, starts_at, expires_at)
        VALUES ($1, $2, 'manual', $3, $4, $5, $6)
        ON CONFLICT (mssv, item_id) WHERE revoked_at IS NULL
        DO UPDATE SET
          granted_by_mssv = EXCLUDED.granted_by_mssv,
          reason = EXCLUDED.reason,
          starts_at = EXCLUDED.starts_at,
          expires_at = EXCLUDED.expires_at,
          updated_at = NOW()
        RETURNING *;
      `, [cleanMssv, cleanItemId, cleanActor, cleanReason(reason), cleanStartsAt, cleanExpiresAt]);
      const row = grant.rows[0];
      if (item.rows[0].item_type === 'title' && ['auto_equip', 'mandatory'].includes(item.rows[0].display_policy)) {
        const selected = await client.query('SELECT displayed_title_ids FROM students WHERE mssv = $1 FOR UPDATE', [cleanMssv]);
        const current = Array.isArray(selected.rows[0]?.displayed_title_ids)
          ? selected.rows[0].displayed_title_ids.map(String)
          : [];
        if (!current.includes(cleanItemId)) {
          await client.query(`
            UPDATE students
            SET displayed_title_ids = $2::jsonb, updated_at = NOW()
            WHERE mssv = $1;
          `, [cleanMssv, JSON.stringify([cleanItemId, ...current].slice(0, 4))]);
        }
      }
      await client.query(`
        INSERT INTO identity_entitlement_audit
          (grant_id, mssv, item_id, action, actor_mssv, reason, metadata)
        VALUES ($1, $2, $3, 'grant', $4, $5, $6::jsonb);
      `, [row.id, cleanMssv, cleanItemId, cleanActor, cleanReason(reason), JSON.stringify({ starts_at: cleanStartsAt, expires_at: cleanExpiresAt })]);
      return row;
    });
  },

  async revoke({ grantId, actorMssv, reason }) {
    requireDatabase();
    const id = String(grantId || '').trim();
    const cleanActor = normalizeMssv(actorMssv);
    if (!/^\d+$/.test(id)) throw httpError('Grant ID không hợp lệ.');
    if (!cleanActor) throw httpError('Thiếu người thu hồi quyền.', 401);
    return transaction(async (client) => {
      const current = await client.query(
        'SELECT id, mssv, item_id, revoked_at FROM identity_entitlement_grants WHERE id = $1 FOR UPDATE',
        [id]
      );
      if (!current.rowCount) throw httpError('Không tìm thấy grant.', 404);
      const row = current.rows[0];
      if (!row.revoked_at) {
        await client.query(`
          UPDATE identity_entitlement_grants
          SET revoked_at = NOW(), revoked_by_mssv = $2, revoke_reason = $3, updated_at = NOW()
          WHERE id = $1;
        `, [id, cleanActor, cleanReason(reason)]);
        await client.query(`
          INSERT INTO identity_entitlement_audit
            (grant_id, mssv, item_id, action, actor_mssv, reason)
          VALUES ($1, $2, $3, 'revoke', $4, $5);
        `, [id, row.mssv, row.item_id, cleanActor, cleanReason(reason)]);
      }
      return { id: Number(id), revoked: true, mssv: row.mssv, item_id: row.item_id };
    });
  },

  async listAudit({ mssv = null, limit = 100 } = {}) {
    requireDatabase();
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 100));
    const params = [];
    let where = '';
    if (mssv) {
      params.push(normalizeMssv(mssv));
      where = `WHERE audit.mssv = $${params.length}`;
    }
    params.push(safeLimit);
    const result = await query(`
      SELECT audit.*
      FROM (
        SELECT id::text AS event_id, grant_id, mssv, item_id, action,
               actor_mssv, reason, metadata, created_at
        FROM identity_entitlement_audit
        UNION ALL
        SELECT ('avatar-' || id::text) AS event_id, NULL::bigint AS grant_id,
               mssv, 'avatar:override'::text AS item_id, action,
               actor_mssv, metadata->>'original_filename' AS reason,
               metadata, created_at
        FROM student_avatar_override_audit
      ) audit
      ${where}
      ORDER BY audit.created_at DESC
      LIMIT $${params.length};
    `, params);
    return result.rows;
  }
};

export const IdentityAdminInternals = { normalizeMssv, parseDate };
