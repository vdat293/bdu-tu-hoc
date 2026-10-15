import { isDatabaseConfigured, query, transaction } from '../db/database.js';
import { PermissionService } from './permission.service.js';

/**
 * MSSV người dùng dán vào ô "add" có thể kèm space/xuống dòng và chữ thường.
 * Chuẩn hóa UPPER-trim NGAY tại biên service để group không lưu 2 bản ghi
 * của cùng một sinh viên.
 */
export function normalizeTtcdsMssv(value) {
  return String(value ?? '').trim().toUpperCase();
}

/** Lỗi HTTP mang `status` (cùng pattern `httpError` của permission.service.js). */
function httpError(message, status = 403) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Nhóm quan tâm "Sinh viên của tôi" của Trung tâm Chuyển đổi số.
 * Group là riêng tư theo người tạo: list mặc định chỉ trả group của chính mình.
 * Quyền view/create nằm ở bảng ttcds_permissions (chưa có dòng = 'view').
 */
export const TtcdsService = {
  /**
   * Danh sách group kèm số lượng thành viên.
   * `includeAll` dành cho admin/owner quản lý toàn bộ group.
   */
  async listGroups(ownerMssv, { includeAll = false } = {}) {
    const cleanOwner = normalizeTtcdsMssv(ownerMssv);
    if (!isDatabaseConfigured()) return [];
    if (!includeAll && !cleanOwner) return [];

    const result = await query(`
      SELECT
        g.id,
        g.name,
        g.nien_khoa,
        g.description,
        g.mentor,
        g.owner_mssv,
        g.created_at,
        COUNT(m.id)::int AS member_count
      FROM ttcds_groups g
      LEFT JOIN ttcds_group_members m ON m.group_id = g.id
      ${includeAll ? '' : 'WHERE g.owner_mssv = $1'}
      GROUP BY g.id
      ORDER BY g.created_at DESC, g.name ASC;
    `, includeAll ? [] : [cleanOwner]);

    return result.rows;
  },

  /** Tạo group mới; trả về null khi thiếu tên hoặc owner. */
  async createGroup({ name, mentor, nienKhoa, description, ownerMssv } = {}) {
    const cleanName = String(name ?? '').trim();
    const cleanOwner = normalizeTtcdsMssv(ownerMssv);
    if (!cleanName || !cleanOwner || !isDatabaseConfigured()) return null;

    const result = await query(`
      INSERT INTO ttcds_groups (name, mentor, nien_khoa, description, owner_mssv)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `, [
      cleanName,
      String(mentor ?? '').trim().slice(0, 120) || null,
      String(nienKhoa ?? '').trim() || null,
      String(description ?? '').trim() || null,
      cleanOwner
    ]);

    return result.rows[0] || null;
  },

  /**
   * Thêm sinh viên vào group. Seed `students` trước (copy cách
   * `StudentService.joinClan`) để MSSV chưa từng đăng nhập vẫn resolve được tên.
   * Thêm lại cùng MSSV là idempotent: cập nhật note/added_by, không nhân bản.
   */
  async addMember(groupId, mssv, { addedBy = null, note = null } = {}) {
    const cleanMssv = normalizeTtcdsMssv(mssv);
    if (!groupId || !cleanMssv || !isDatabaseConfigured()) return null;

    return transaction(async (client) => {
      await client.query(`
        INSERT INTO students (mssv, full_name, is_active)
        VALUES ($1, '', FALSE)
        ON CONFLICT (mssv) DO NOTHING;
      `, [cleanMssv]);

      const result = await client.query(`
        INSERT INTO ttcds_group_members (group_id, mssv, added_by_mssv, note)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (group_id, mssv) DO UPDATE SET
          added_by_mssv = EXCLUDED.added_by_mssv,
          note = EXCLUDED.note
        RETURNING *;
      `, [
        groupId,
        cleanMssv,
        normalizeTtcdsMssv(addedBy) || null,
        String(note ?? '').trim() || null
      ]);

      return result.rows[0] || null;
    });
  },

  /** Xoá sinh viên khỏi group; trả về true/false theo số dòng bị xoá. */
  async removeMember(groupId, mssv) {
    const cleanMssv = normalizeTtcdsMssv(mssv);
    if (!groupId || !cleanMssv || !isDatabaseConfigured()) return false;

    const result = await query(
      'DELETE FROM ttcds_group_members WHERE group_id = $1 AND mssv = $2',
      [groupId, cleanMssv]
    );
    return result.rowCount > 0;
  },

  /** Thành viên của group, sắp xếp theo MSSV để kết quả ổn định. */
  async listMembers(groupId) {
    if (!groupId || !isDatabaseConfigured()) return [];

    const result = await query(`
      SELECT mssv, note, added_by_mssv, created_at
      FROM ttcds_group_members
      WHERE group_id = $1
      ORDER BY mssv ASC;
    `, [groupId]);

    return result.rows;
  },

  /**
   * Chưa có dòng trong ttcds_permissions nghĩa là 'view' (mặc định an toàn),
   * TRỪ owner hệ thống (`system_roles` role owner): luôn 'create' — admin vừa
   * có nametag vừa quản trị thì không phải tự cấp quyền cho chính mình.
   */
  async getLevel(mssv) {
    const cleanMssv = normalizeTtcdsMssv(mssv);
    if (!cleanMssv || !isDatabaseConfigured()) return 'view';

    if (await PermissionService.isSystemOwner(cleanMssv)) return 'create';
    const result = await query('SELECT level FROM ttcds_permissions WHERE mssv = $1', [cleanMssv]);
    return result.rows[0]?.level === 'create' ? 'create' : 'view';
  },

  /** Cấp/đổi nấc quyền; CHECK constraint của DB là nguồn duy nhất cho view/create. */
  async setLevel({ mssv, level, grantedBy = null, note = null } = {}) {
    const cleanMssv = normalizeTtcdsMssv(mssv);
    if (!cleanMssv || !isDatabaseConfigured()) return null;

    const result = await query(`
      INSERT INTO ttcds_permissions (mssv, level, granted_by, note)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (mssv) DO UPDATE SET
        level = EXCLUDED.level,
        granted_by = EXCLUDED.granted_by,
        note = EXCLUDED.note,
        updated_at = NOW()
      RETURNING *;
    `, [
      cleanMssv,
      String(level ?? '').trim(),
      normalizeTtcdsMssv(grantedBy) || null,
      String(note ?? '').trim() || null
    ]);

    return result.rows[0] || null;
  },

  /**
   * Cổng 1: phải còn nametag #TTCDS (capability `ttcds:access`) mới được vào Trung tâm.
   * Mất nametag = mất cả Trung tâm (spec §3), nên ném 403 thay vì trả boolean.
   */
  async requireAccess(mssv) {
    const allowed = await PermissionService.can(mssv, 'ttcds:access');
    if (!allowed) {
      throw httpError('Bạn không thuộc Trung tâm Chuyển đổi số.', 403);
    }
    return true;
  },

  /**
   * Cổng 2: phải có nấc `create` mới được tạo group/add thành viên (view 403).
   * Chỉ đọc — không ghi DB.
   */
  async requireCreate(mssv) {
    await this.requireAccess(mssv);

    const level = await this.getLevel(mssv);
    if (level !== 'create') {
      throw httpError('Bạn không có quyền tạo nhóm. Vui lòng liên hệ admin.', 403);
    }
    return true;
  }
};
