import { isDatabaseConfigured, query } from '../db/database.js';
import { PermissionService } from './permission.service.js';

export const CLAN_ROLE_KEYS = ['leader', 'vice_leader', 'elder', 'member', 'recruit'];

export const DEFAULT_ROLE_LABELS = {
  leader: { display_name: 'Bang chủ', color: '#b45309' },
  vice_leader: { display_name: 'Phó bang', color: '#2563eb' },
  elder: { display_name: 'Trưởng lão', color: '#6d28d9' },
  member: { display_name: 'Thành viên', color: '#475569' },
  recruit: { display_name: 'Tân thành viên', color: '#78716c' }
};

const ROLE_ORDER_CASE = `CASE role_key
  WHEN 'leader' THEN 1
  WHEN 'vice_leader' THEN 2
  WHEN 'elder' THEN 3
  WHEN 'member' THEN 4
  ELSE 5
END`;

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeClanId(clanId) {
  const clean = String(clanId ?? '').trim();
  if (!/^\d+$/.test(clean)) {
    throw httpError('ID CLB không hợp lệ.', 400);
  }
  return clean;
}

/**
 * Chuẩn hoá + validate danh sách role labels.
 * Chấp nhận mảng [{ role_key, display_name, color? }].
 * Trả về mảng đã trim. Ném Error status 400 khi không hợp lệ.
 */
export function validateRoleLabels(roles) {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw httpError('Danh sách tên chức danh không được để trống.', 400);
  }
  const seen = new Set();
  const normalized = roles.map((item) => {
    const roleKey = String(item?.role_key ?? item?.role ?? item?.key ?? '').trim();
    if (!CLAN_ROLE_KEYS.includes(roleKey)) {
      throw httpError(`role_key không hợp lệ: ${roleKey || '(trống)'}.`, 400);
    }
    const displayName = String(item?.display_name ?? item?.name ?? item?.label ?? '').trim();
    if (displayName.length < 2 || displayName.length > 20) {
      throw httpError(`Tên hiển thị của "${roleKey}" phải từ 2-20 ký tự.`, 400);
    }
    const lowered = displayName.toLowerCase();
    if (seen.has(lowered)) {
      throw httpError('Tên hiển thị các chức danh không được trùng nhau.', 400);
    }
    seen.add(lowered);

    const rawColor = item?.color;
    let color = null;
    if (rawColor !== undefined && rawColor !== null && String(rawColor).trim() !== '') {
      color = String(rawColor).trim();
      if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
        throw httpError(`Màu của "${roleKey}" phải dạng hex #RRGGBB.`, 400);
      }
    }
    return { role_key: roleKey, display_name: displayName, color };
  });
  return normalized;
}

/**
 * Đảm bảo mỗi CLB có đủ 5 dòng labels mặc định rồi trả về đầy đủ.
 */
export async function getRoleLabels(clanId) {
  const cleanClanId = normalizeClanId(clanId);
  if (!isDatabaseConfigured()) {
    return CLAN_ROLE_KEYS.map((roleKey) => ({
      role_key: roleKey,
      display_name: DEFAULT_ROLE_LABELS[roleKey].display_name,
      color: DEFAULT_ROLE_LABELS[roleKey].color
    }));
  }

  const clanRes = await query('SELECT id FROM clans WHERE id = $1', [cleanClanId]);
  if (clanRes.rows.length === 0) {
    throw httpError('Không tìm thấy CLB.', 404);
  }

  const values = [];
  const placeholders = CLAN_ROLE_KEYS.map((roleKey, idx) => {
    const base = idx * 4;
    values.push(cleanClanId, roleKey, DEFAULT_ROLE_LABELS[roleKey].display_name, DEFAULT_ROLE_LABELS[roleKey].color);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
  });
  await query(
    `INSERT INTO clan_role_labels (clan_id, role_key, display_name, color)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT DO NOTHING;`,
    values
  );

  const res = await query(
    `SELECT role_key, display_name, color, updated_by, updated_at
     FROM clan_role_labels
     WHERE clan_id = $1
     ORDER BY ${ROLE_ORDER_CASE};`,
    [cleanClanId]
  );
  const byKey = new Map((res.rows || []).map((row) => [row.role_key, row]));
  return CLAN_ROLE_KEYS.map((roleKey) => {
    const row = byKey.get(roleKey);
    if (row) return row;
    return {
      role_key: roleKey,
      display_name: DEFAULT_ROLE_LABELS[roleKey].display_name,
      color: DEFAULT_ROLE_LABELS[roleKey].color
    };
  });
}

/**
 * Cập nhật tên hiển thị per-CLB (chỉ leader: 'clan:role_assign').
 * Upsert từng role rồi trả về danh sách đầy đủ.
 */
export async function updateRoleLabels(clanId, requesterMssv, roles) {
  const cleanClanId = normalizeClanId(clanId);
  const cleanRequester = normalizeMssv(requesterMssv);
  if (!cleanRequester) {
    throw httpError('Thiếu thông tin người yêu cầu.', 401);
  }
  if (!isDatabaseConfigured()) throw new Error('Database chưa được cấu hình.');

  const normalized = validateRoleLabels(roles);

  await PermissionService.requireInClan(
    cleanRequester,
    cleanClanId,
    'clan:role_assign'
  );

  const clanRes = await query('SELECT id FROM clans WHERE id = $1', [cleanClanId]);
  if (clanRes.rows.length === 0) {
    throw httpError('Không tìm thấy CLB.', 404);
  }

  try {
    for (const item of normalized) {
      await query(
        `INSERT INTO clan_role_labels (clan_id, role_key, display_name, color, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (clan_id, role_key)
         DO UPDATE SET display_name = EXCLUDED.display_name, color = EXCLUDED.color,
                       updated_by = EXCLUDED.updated_by, updated_at = NOW();`,
        [cleanClanId, item.role_key, item.display_name, item.color, cleanRequester]
      );
    }
  } catch (err) {
    if (err?.code === '23505') {
      throw httpError('Tên hiển thị các chức danh không được trùng nhau trong cùng CLB.', 400);
    }
    throw err;
  }

  const res = await query(
    `SELECT role_key, display_name, color, updated_by, updated_at
     FROM clan_role_labels
     WHERE clan_id = $1
     ORDER BY ${ROLE_ORDER_CASE};`,
    [cleanClanId]
  );
  const byKey = new Map((res.rows || []).map((row) => [row.role_key, row]));
  return CLAN_ROLE_KEYS.map((roleKey) => {
    const row = byKey.get(roleKey);
    if (row) return row;
    return {
      role_key: roleKey,
      display_name: DEFAULT_ROLE_LABELS[roleKey].display_name,
      color: DEFAULT_ROLE_LABELS[roleKey].color
    };
  });
}

export const ClanRoleService = {
  getRoleLabels,
  validateRoleLabels,
  updateRoleLabels
};

export default ClanRoleService;
