import { isDatabaseConfigured, query, transaction } from '../db/database.js';
import { PermissionService } from './permission.service.js';

function normalizeMssv(mssv) {
  return String(mssv || '').trim().toUpperCase();
}

export const StudentService = {
  /**
   * Ghi nhận đăng nhập của sinh viên:
   * Kích hoạt is_active = true, ghi nhận first_login_at và last_login_at
   */
  async recordLogin(mssv, fullName = '') {
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanMssv || !isDatabaseConfigured()) return null;

    const sql = `
      INSERT INTO students (mssv, full_name, is_active, first_login_at, last_login_at, updated_at)
      VALUES ($1, $2, TRUE, NOW(), NOW(), NOW())
      ON CONFLICT (mssv) DO UPDATE SET
        full_name = COALESCE(NULLIF($2, ''), students.full_name),
        is_active = TRUE,
        first_login_at = COALESCE(students.first_login_at, NOW()),
        last_login_at = NOW(),
        updated_at = NOW()
      RETURNING *;
    `;
    const result = await query(sql, [cleanMssv, fullName?.trim() || null]);
    return result.rows[0] || null;
  },

  /**
   * Lấy thông tin sinh viên kèm danh sách các nhóm/CLB (Clan) đã tham gia
   */
  async getStudent(mssv) {
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanMssv || !isDatabaseConfigured()) return null;

    const sql = `
      SELECT 
        s.mssv,
        s.full_name,
        s.is_active,
        s.first_login_at,
        s.last_login_at,
        s.created_at,
        s.updated_at,
        COALESCE(
          json_agg(
            json_build_object(
              'clan_id', c.id,
              'code', c.code,
              'name', c.name,
              'tag', c.tag,
              'description', c.description,
              'avatar_url', c.avatar_url,
              'level', c.level,
              'role', sc.role,
              'contribution_points', sc.contribution_points,
              'joined_at', sc.joined_at
            ) ORDER BY sc.joined_at ASC
          ) FILTER (WHERE c.id IS NOT NULL),
          '[]'::json
        ) AS clans
      FROM students s
      LEFT JOIN student_clans sc ON s.mssv = sc.mssv
      LEFT JOIN clans c ON sc.clan_id = c.id
      WHERE s.mssv = $1
      GROUP BY s.mssv;
    `;
    const result = await query(sql, [cleanMssv]);
    return result.rows[0] || null;
  },

  /**
   * Kiểm tra sinh viên có quyền tạo CLB hay không (sở hữu nametag #TTCDS hoặc là Owner)
   */
  async canCreateClan(mssv) {
    return PermissionService.can(mssv, 'clan:create');
  },

  /**
   * Tạo một Clan/CLB mới và gán người tạo làm Leader
   */
  async createClan({ code, name, tag = null, description = null, avatarUrl = null, leaderMssv = null, enforcePermission = false }) {
    if (!isDatabaseConfigured()) throw new Error('Database chưa được cấu hình.');
    const cleanCode = String(code || '').trim().toUpperCase();
    const cleanName = String(name || '').trim();
    const cleanLeaderMssv = leaderMssv ? normalizeMssv(leaderMssv) : null;

    if (!cleanCode || !cleanName) {
      throw new Error('Mã clan và tên clan là bắt buộc.');
    }

    if (enforcePermission) {
      if (!cleanLeaderMssv) {
        throw new Error('Yêu cầu thông tin MSSV người tạo CLB.');
      }
      await PermissionService.require(
        cleanLeaderMssv,
        'clan:create',
        'Chỉ những thành viên có danh hiệu #TTCDS mới được phép tạo CLB / Nhóm.'
      );
    }

    return transaction(async (client) => {
      // Đảm bảo leader tồn tại trong bảng students nếu có
      if (cleanLeaderMssv) {
        await client.query(`
          INSERT INTO students (mssv, full_name, is_active)
          VALUES ($1, '', FALSE)
          ON CONFLICT (mssv) DO NOTHING;
        `, [cleanLeaderMssv]);
      }

      const insertClanSql = `
        INSERT INTO clans (code, name, tag, description, avatar_url, leader_mssv)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *;
      `;
      const clanResult = await client.query(insertClanSql, [
        cleanCode,
        cleanName,
        tag?.trim() || null,
        description?.trim() || null,
        avatarUrl?.trim() || null,
        cleanLeaderMssv
      ]);
      const clan = clanResult.rows[0];

      if (cleanLeaderMssv) {
        await client.query(`
          INSERT INTO student_clans (mssv, clan_id, role)
          VALUES ($1, $2, 'leader')
          ON CONFLICT (mssv, clan_id) DO UPDATE SET role = 'leader';
        `, [cleanLeaderMssv, clan.id]);
      }

      return clan;
    });
  },

  /**
   * Tham gia Clan/CLB trực tiếp (hàm nội bộ hoặc dùng khi leader duyệt)
   */
  async joinClan(mssv, clanId, role = 'member') {
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanMssv || !clanId || !isDatabaseConfigured()) return null;

    // Đảm bảo sinh viên tồn tại trong bảng students
    await query(`
      INSERT INTO students (mssv, full_name, is_active)
      VALUES ($1, '', FALSE)
      ON CONFLICT (mssv) DO NOTHING;
    `, [cleanMssv]);

    const sql = `
      INSERT INTO student_clans (mssv, clan_id, role, joined_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (mssv, clan_id) DO UPDATE SET role = EXCLUDED.role
      RETURNING *;
    `;
    const result = await query(sql, [cleanMssv, clanId, role]);
    return result.rows[0];
  },

  /**
   * Gửi yêu cầu xin tham gia Clan/CLB (trạng thái pending chờ Trưởng CLB duyệt)
   */
  async requestJoinClan(mssv, clanId, message = null) {
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanMssv || !clanId || !isDatabaseConfigured()) {
      throw new Error('Dữ liệu yêu cầu không hợp lệ.');
    }

    // Đảm bảo sinh viên tồn tại trong bảng students
    await query(`
      INSERT INTO students (mssv, full_name, is_active)
      VALUES ($1, '', FALSE)
      ON CONFLICT (mssv) DO NOTHING;
    `, [cleanMssv]);

    // Kiểm tra CLB có tồn tại không
    const clanRes = await query('SELECT id, name, leader_mssv FROM clans WHERE id = $1', [clanId]);
    if (clanRes.rows.length === 0) {
      const err = new Error('Không tìm thấy CLB.');
      err.status = 404;
      throw err;
    }

    // Kiểm tra xem đã là thành viên hay chưa
    const memberRes = await query('SELECT role FROM student_clans WHERE clan_id = $1 AND mssv = $2', [clanId, cleanMssv]);
    if (memberRes.rows.length > 0) {
      const err = new Error('Bạn đã là thành viên của CLB này rồi.');
      err.status = 400;
      throw err;
    }

    // Kiểm tra xem đã có yêu cầu pending hay chưa
    const pendingRes = await query(
      'SELECT id FROM clan_join_requests WHERE clan_id = $1 AND mssv = $2 AND status = $3',
      [clanId, cleanMssv, 'pending']
    );
    if (pendingRes.rows.length > 0) {
      const err = new Error('Bạn đã gửi yêu cầu tham gia CLB này và đang chờ Trưởng CLB phê duyệt.');
      err.status = 400;
      throw err;
    }

    const cleanMessage = message ? String(message).trim().slice(0, 500) : null;
    const insertSql = `
      INSERT INTO clan_join_requests (clan_id, mssv, status, message, created_at, updated_at)
      VALUES ($1, $2, 'pending', $3, NOW(), NOW())
      RETURNING *;
    `;
    const result = await query(insertSql, [clanId, cleanMssv, cleanMessage]);
    return result.rows[0];
  },

  /**
   * Hủy yêu cầu xin tham gia CLB của chính mình
   */
  async cancelJoinRequest(mssv, clanId) {
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanMssv || !clanId || !isDatabaseConfigured()) return false;

    const sql = `
      UPDATE clan_join_requests
      SET status = 'cancelled', updated_at = NOW()
      WHERE clan_id = $1 AND mssv = $2 AND status = 'pending'
      RETURNING id;
    `;
    const res = await query(sql, [clanId, cleanMssv]);
    return (res.rowCount ?? 0) > 0;
  },

  /**
   * Lấy danh sách yêu cầu gia nhập đang chờ duyệt (Dành cho Trưởng CLB)
   */
  async getPendingJoinRequests(clanId, requesterMssv) {
    const cleanRequester = normalizeMssv(requesterMssv);
    if (!clanId || !cleanRequester || !isDatabaseConfigured()) return [];

    const clanRes = await query('SELECT leader_mssv FROM clans WHERE id = $1', [clanId]);
    if (clanRes.rows.length === 0) {
      const err = new Error('Không tìm thấy CLB.');
      err.status = 404;
      throw err;
    }

    await PermissionService.requireInClan(
      cleanRequester,
      clanId,
      'clan:review_join',
      'Chỉ Trưởng CLB (Bang Chủ) mới có quyền xem danh sách yêu cầu gia nhập.'
    );

    const sql = `
      SELECT 
        cjr.id,
        cjr.clan_id,
        cjr.mssv,
        cjr.status,
        cjr.message,
        cjr.created_at,
        s.full_name,
        COALESCE(sao.url_img, s.avatar_url) AS avatar_url
      FROM clan_join_requests cjr
      JOIN students s ON cjr.mssv = s.mssv
      LEFT JOIN student_avatar_overrides sao 
        ON sao.mssv = s.mssv AND sao.deleted_at IS NULL AND NULLIF(sao.url_img, '') IS NOT NULL
      WHERE cjr.clan_id = $1 AND cjr.status = 'pending'
      ORDER BY cjr.created_at ASC;
    `;
    const result = await query(sql, [clanId]);
    return result.rows;
  },

  /**
   * Phê duyệt hoặc Từ chối yêu cầu xin gia nhập (Chỉ Trưởng CLB)
   */
  async reviewJoinRequest(clanId, reviewerMssv, requestId, action) {
    const cleanReviewer = normalizeMssv(reviewerMssv);
    const cleanAction = String(action || '').trim().toLowerCase();
    if (!clanId || !cleanReviewer || !requestId || !['approve', 'reject'].includes(cleanAction) || !isDatabaseConfigured()) {
      throw new Error('Dữ liệu yêu cầu phê duyệt không hợp lệ.');
    }

    const clanRes = await query('SELECT leader_mssv FROM clans WHERE id = $1', [clanId]);
    if (clanRes.rows.length === 0) {
      const err = new Error('Không tìm thấy CLB.');
      err.status = 404;
      throw err;
    }

    await PermissionService.requireInClan(
      cleanReviewer,
      clanId,
      'clan:review_join',
      'Chỉ Trưởng CLB mới có quyền phê duyệt hoặc từ chối yêu cầu gia nhập.'
    );

    const reqRes = await query(
      'SELECT id, clan_id, mssv, status FROM clan_join_requests WHERE id = $1 AND clan_id = $2',
      [requestId, clanId]
    );
    if (reqRes.rows.length === 0) {
      const err = new Error('Không tìm thấy yêu cầu gia nhập.');
      err.status = 404;
      throw err;
    }
    const joinReq = reqRes.rows[0];
    if (joinReq.status !== 'pending') {
      const err = new Error(`Yêu cầu này đã được xử lý trước đó (trạng thái: ${joinReq.status}).`);
      err.status = 400;
      throw err;
    }

    return transaction(async (client) => {
      const newStatus = cleanAction === 'approve' ? 'approved' : 'rejected';
      await client.query(`
        UPDATE clan_join_requests
        SET status = $1, reviewed_by_mssv = $2, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = $3;
      `, [newStatus, cleanReviewer, requestId]);

      if (cleanAction === 'approve') {
        await client.query(`
          INSERT INTO student_clans (mssv, clan_id, role, joined_at)
          VALUES ($1, $2, 'member', NOW())
          ON CONFLICT (mssv, clan_id) DO UPDATE SET role = EXCLUDED.role;
        `, [joinReq.mssv, clanId]);
      }

      return {
        success: true,
        requestId,
        status: newStatus,
        mssv: joinReq.mssv,
        message: cleanAction === 'approve' ? 'Đã duyệt thành viên vào CLB thành công.' : 'Đã từ chối yêu cầu gia nhập.'
      };
    });
  },

  /**
   * Rời khỏi Clan/CLB
   */
  async leaveClan(mssv, clanId) {
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanMssv || !clanId || !isDatabaseConfigured()) return false;

    const sql = `DELETE FROM student_clans WHERE mssv = $1 AND clan_id = $2;`;
    const result = await query(sql, [cleanMssv, clanId]);
    return (result.rowCount ?? 0) > 0;
  },

  /**
   * Lấy danh sách thành viên của một Clan/CLB
   */
  async getClanMembers(clanId) {
    if (!clanId || !isDatabaseConfigured()) return [];

    const sql = `
      SELECT 
        sc.clan_id,
        sc.mssv,
        s.full_name,
        s.is_active,
        s.last_login_at,
        sc.role,
        sc.contribution_points,
        sc.joined_at
      FROM student_clans sc
      JOIN students s ON sc.mssv = s.mssv
      WHERE sc.clan_id = $1
      ORDER BY 
        CASE sc.role
          WHEN 'leader' THEN 1
          WHEN 'vice_leader' THEN 2
          WHEN 'elder' THEN 3
          WHEN 'member' THEN 4
          ELSE 5
        END,
        sc.contribution_points DESC,
        sc.joined_at ASC;
    `;
    const result = await query(sql, [clanId]);
    return result.rows;
  },

  /**
   * Lấy danh sách tất cả các CLB / Nhóm kèm số lượng thành viên, vai trò của người xem,
   * trạng thái yêu cầu chờ duyệt và số yêu cầu pending (dành cho Leader)
   */
  async listClans(viewerMssv = null) {
    if (!isDatabaseConfigured()) return [];

    const cleanViewerMssv = viewerMssv ? normalizeMssv(viewerMssv) : null;

    const sql = `
      WITH clan_members_agg AS (
        SELECT 
          clan_id,
          COUNT(mssv)::int AS member_count,
          MAX(CASE WHEN mssv = $1::text THEN role ELSE NULL END) AS my_role,
          COALESCE(BOOL_OR(mssv = $1::text), false) AS is_joined
        FROM student_clans
        GROUP BY clan_id
      ), clan_requests_agg AS (
        SELECT 
          clan_id,
          COALESCE(BOOL_OR(mssv = $1::text AND status = 'pending'), false) AS has_pending_request,
          COUNT(CASE WHEN status = 'pending' THEN 1 ELSE NULL END)::int AS pending_request_count
        FROM clan_join_requests
        GROUP BY clan_id
      )
      SELECT 
        c.id,
        c.code,
        c.name,
        c.tag,
        c.description,
        c.avatar_url,
        c.leader_mssv,
        c.level,
        c.xp,
        c.created_at,
        COALESCE(cma.member_count, 0) AS member_count,
        cma.my_role,
        COALESCE(cma.is_joined, false) AS is_joined,
        COALESCE(cra.has_pending_request, false) AS has_pending_request,
        COALESCE(cra.pending_request_count, 0) AS pending_request_count
      FROM clans c
      LEFT JOIN clan_members_agg cma ON c.id = cma.clan_id
      LEFT JOIN clan_requests_agg cra ON c.id = cra.clan_id
      ORDER BY member_count DESC, c.level DESC, c.name ASC;
    `;
    const result = await query(sql, [cleanViewerMssv]);
    return result.rows;
  },

  /**
   * Cập nhật vai trò thành viên trong Clan (chỉ Bang Chủ)
   */
  async updateMemberRole(clanId, requesterMssv, targetMssv, newRole) {
    const cleanRequester = normalizeMssv(requesterMssv);
    const cleanTarget = normalizeMssv(targetMssv);
    if (!cleanRequester || !cleanTarget || !clanId || !isDatabaseConfigured()) {
      throw new Error('Dữ liệu yêu cầu không hợp lệ.');
    }

    const clanRes = await query('SELECT leader_mssv FROM clans WHERE id = $1', [clanId]);
    if (clanRes.rows.length === 0) throw new Error('Không tìm thấy CLB.');
    await PermissionService.requireInClan(
      cleanRequester,
      clanId,
      'clan:role_assign',
      'Chỉ Bang Chủ mới có quyền phân quyền thành viên.'
    );

    const validRoles = ['leader', 'vice_leader', 'elder', 'member'];
    if (!validRoles.includes(newRole)) throw new Error('Vai trò không hợp lệ.');

    if (newRole === 'leader') {
      await query('UPDATE student_clans SET role = $1 WHERE clan_id = $2 AND mssv = $3', ['member', clanId, cleanRequester]);
      await query('UPDATE student_clans SET role = $1 WHERE clan_id = $2 AND mssv = $3', ['leader', clanId, cleanTarget]);
      await query('UPDATE clans SET leader_mssv = $1, updated_at = NOW() WHERE id = $2', [cleanTarget, clanId]);
      return { success: true, message: 'Đã chuyển giao quyền Bang Chủ thành công.' };
    }

    const res = await query(
      'UPDATE student_clans SET role = $1 WHERE clan_id = $2 AND mssv = $3 RETURNING *',
      [newRole, clanId, cleanTarget]
    );
    if (res.rowCount === 0) throw new Error('Thành viên không thuộc CLB này.');
    return { success: true, role: newRole };
  },

  /**
   * Khai trừ thành viên ra khỏi Clan (Bang Chủ hoặc Phó Bang)
   */
  async kickMember(clanId, requesterMssv, targetMssv) {
    const cleanRequester = normalizeMssv(requesterMssv);
    const cleanTarget = normalizeMssv(targetMssv);
    if (!cleanRequester || !cleanTarget || !clanId || !isDatabaseConfigured()) {
      throw new Error('Dữ liệu yêu cầu không hợp lệ.');
    }

    const clanRes = await query('SELECT leader_mssv FROM clans WHERE id = $1', [clanId]);
    if (clanRes.rows.length === 0) throw new Error('Không tìm thấy CLB.');

    await PermissionService.requireInClan(
      cleanRequester,
      clanId,
      'clan:kick',
      'Bạn không có quyền quản lý thành viên trong CLB này.'
    );

    if (cleanTarget === clanRes.rows[0].leader_mssv) {
      throw new Error('Không thể khai trừ Bang Chủ.');
    }

    const delRes = await query('DELETE FROM student_clans WHERE clan_id = $1 AND mssv = $2', [clanId, cleanTarget]);
    if (delRes.rowCount === 0) throw new Error('Thành viên không thuộc CLB này.');
    return { success: true, message: 'Đã mời thành viên ra khỏi nhóm.' };
  },

  /**
   * Cập nhật thông tin CLB (Tên, Tag, Mô tả)
   */
  async updateClanInfo(clanId, requesterMssv, { name, tag, description }) {
    const cleanRequester = normalizeMssv(requesterMssv);
    if (!cleanRequester || !clanId || !isDatabaseConfigured()) {
      throw new Error('Dữ liệu yêu cầu không hợp lệ.');
    }

    const clanRes = await query('SELECT leader_mssv FROM clans WHERE id = $1', [clanId]);
    if (clanRes.rows.length === 0) throw new Error('Không tìm thấy CLB.');
    await PermissionService.requireInClan(
      cleanRequester,
      clanId,
      'clan:edit',
      'Chỉ Bang Chủ mới có quyền thay đổi thông tin CLB.'
    );

    const updates = [];
    const values = [];
    let idx = 1;

    if (name && name.trim()) {
      updates.push(`name = $${idx++}`);
      values.push(name.trim());
    }
    if (tag && tag.trim()) {
      updates.push(`tag = $${idx++}`);
      values.push(tag.trim().toUpperCase());
    }
    if (description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(description.trim());
    }

    if (updates.length === 0) return clanRes.rows[0];

    updates.push(`updated_at = NOW()`);
    values.push(clanId);

    const sql = `UPDATE clans SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *;`;
    const res = await query(sql, values);
    return res.rows[0];
  },

  /**
   * Giải tán CLB (Chỉ Bang Chủ)
   */
  async disbandClan(clanId, requesterMssv) {
    const cleanRequester = normalizeMssv(requesterMssv);
    if (!cleanRequester || !clanId || !isDatabaseConfigured()) {
      throw new Error('Dữ liệu yêu cầu không hợp lệ.');
    }

    const clanRes = await query('SELECT leader_mssv FROM clans WHERE id = $1', [clanId]);
    if (clanRes.rows.length === 0) throw new Error('Không tìm thấy CLB.');
    await PermissionService.requireInClan(
      cleanRequester,
      clanId,
      'clan:disband',
      'Chỉ Bang Chủ mới có quyền giải tán CLB.'
    );

    await query('DELETE FROM clans WHERE id = $1', [clanId]);
    return { success: true, message: 'Đã giải tán CLB thành công.' };
  }
};
