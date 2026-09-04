import { isDatabaseConfigured, query } from '../db/database.js';

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

function httpError(message, status = 403) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Phân quyền hệ thống (System-level Capabilities)
 */
export const SYSTEM_ROLE_CAPABILITIES = {
  owner: ['*'], // Quản trị viên tối cao: toàn quyền
  identity_admin: [
    'identity:view',
    'identity:grant',
    'identity:revoke',
    'identity:catalog_sync',
    'identity:item_create',
    'identity:item_update',
    'identity:item_delete'
  ],
  moderator: [
    'community:mod_access',
    'community:post_delete_any',
    'community:comment_delete_any',
    'community:pin_global'
  ]
};

/**
 * Phân quyền cấp CLB / Nhóm (Clan-level Capabilities)
 */
export const CLAN_ROLE_CAPABILITIES = {
  leader: [
    'clan:*',
    'clan:edit',
    'clan:disband',
    'clan:review_join',
    'clan:role_assign',
    'clan:kick',
    'clan:announcement_create',
    'clan:post_create',
    'clan:post_pin',
    'clan:post_delete_any',
    'clan:comment_delete_any',
    'clan:doc_upload',
    'clan:poll_create',
    'clan:poll_vote'
  ],
  vice_leader: [
    'clan:review_join',
    'clan:kick',
    'clan:announcement_create',
    'clan:post_create',
    'clan:post_pin',
    'clan:post_delete_any',
    'clan:comment_delete_any',
    'clan:doc_upload',
    'clan:poll_create',
    'clan:poll_vote'
  ],
  elder: [
    'clan:post_create',
    'clan:post_pin',
    'clan:doc_upload',
    'clan:poll_create',
    'clan:poll_vote'
  ],
  member: [
    'clan:post_create',
    'clan:doc_upload',
    'clan:poll_vote'
  ],
  recruit: [
    'clan:poll_vote'
  ]
};

/**
 * Bản đồ dự phòng: Nametag / Danh hiệu đặc thù gắn với Capability
 * (Ngay cả khi metadata trong DB chưa kịp đồng bộ)
 */
export const NAMETAG_CAPABILITIES_MAP = {
  'title:ttcds': ['clan:create', 'clan:verified_tag'],
  'ttcds': ['clan:create', 'clan:verified_tag'],
  'achievement:ttcds': ['clan:create', 'clan:verified_tag']
};

/**
 * Kiểm tra xem một tập hợp capabilities có match với targetCapability không
 * Hỗ trợ wildcard: e.g. '*' hoặc 'clan:*' match với 'clan:create'
 */
function matchCapability(grantedCaps, targetCap) {
  if (grantedCaps.has('*')) return true;
  if (grantedCaps.has(targetCap)) return true;

  const colonIdx = targetCap.indexOf(':');
  if (colonIdx > 0) {
    const resource = targetCap.slice(0, colonIdx);
    if (grantedCaps.has(`${resource}:*`)) return true;
  }
  return false;
}

export const PermissionService = {
  /**
   * Kiểm tra MSSV có phải là Owner hệ thống (từ ENV hoặc system_roles)
   */
  async isSystemOwner(mssv) {
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanMssv) return false;

    if (process.env.SYSTEM_OWNER_MSSV && cleanMssv === normalizeMssv(process.env.SYSTEM_OWNER_MSSV)) {
      return true;
    }

    if (!isDatabaseConfigured()) return false;
    const res = await query(
      "SELECT 1 FROM system_roles WHERE mssv = $1 AND role = 'owner' AND is_active = TRUE LIMIT 1",
      [cleanMssv]
    );
    return (res.rowCount ?? 0) > 0;
  },

  /**
   * Lấy toàn bộ capabilities toàn cục của một sinh viên (System Roles + Nametag grants)
   */
  async getGlobalCapabilities(mssv) {
    const cleanMssv = normalizeMssv(mssv);
    const caps = new Set();
    if (!cleanMssv || !isDatabaseConfigured()) return caps;

    // 1. Kiểm tra Owner
    if (await this.isSystemOwner(cleanMssv)) {
      caps.add('*');
      return caps;
    }

    // 2. Lấy System Roles từ DB
    const roleRows = await query(
      'SELECT role FROM system_roles WHERE mssv = $1 AND is_active = TRUE',
      [cleanMssv]
    );
    for (const row of roleRows.rows) {
      const roleCaps = SYSTEM_ROLE_CAPABILITIES[row.role] || [];
      roleCaps.forEach((c) => caps.add(c));
    }

    // 3. Lấy Nametag / Entitlements từ identity_entitlement_grants
    const grantRows = await query(`
      SELECT items.id AS item_id, items.metadata
      FROM identity_entitlement_grants grants
      JOIN identity_items items ON items.id = grants.item_id AND items.is_active = TRUE
      WHERE grants.mssv = $1
        AND grants.revoked_at IS NULL
        AND grants.starts_at <= NOW()
        AND (grants.expires_at IS NULL OR grants.expires_at > NOW());
    `, [cleanMssv]);

    for (const row of grantRows.rows) {
      // Từ metadata.capabilities
      const itemCaps = Array.isArray(row.metadata?.capabilities) ? row.metadata.capabilities : [];
      itemCaps.forEach((c) => caps.add(c));

      // Từ default mapping
      const mappedCaps = NAMETAG_CAPABILITIES_MAP[row.item_id] || [];
      mappedCaps.forEach((c) => caps.add(c));
    }

    // 4. Kiểm tra manual_achievement_grants và student_achievement_unlocks (fallback cho legacy ttcds)
    const achRes = await query(`
      SELECT achievement_id FROM manual_achievement_grants
      WHERE mssv = $1 AND is_active = TRUE
      UNION
      SELECT achievement_id FROM student_achievement_unlocks
      WHERE mssv = $1;
    `, [cleanMssv]);

    for (const row of achRes.rows) {
      const mappedCaps = NAMETAG_CAPABILITIES_MAP[row.achievement_id] || [];
      mappedCaps.forEach((c) => caps.add(c));
    }

    // 5. Kiểm tra displayed_title_ids
    const studentRes = await query('SELECT displayed_title_ids FROM students WHERE mssv = $1', [cleanMssv]);
    const titles = Array.isArray(studentRes.rows[0]?.displayed_title_ids) ? studentRes.rows[0].displayed_title_ids : [];
    for (const titleId of titles) {
      const mappedCaps = NAMETAG_CAPABILITIES_MAP[titleId] || [];
      mappedCaps.forEach((c) => caps.add(c));
    }

    return caps;
  },

  /**
   * Kiểm tra xem sinh viên có capability toàn hệ thống không (ví dụ: 'clan:create')
   */
  async can(mssv, capability) {
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanMssv) return false;

    const caps = await this.getGlobalCapabilities(cleanMssv);
    return matchCapability(caps, capability);
  },

  /**
   * Kiểm tra capability trong ngữ cảnh một CLB cụ thể (ví dụ: 'clan:review_join', 'clan:disband')
   */
  async canInClan(mssv, clanId, capability) {
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanMssv || !clanId || !isDatabaseConfigured()) return false;

    // 1. Nếu có quyền toàn hệ thống (như Owner hoặc clan:* toàn cục), cho phép luôn
    if (await this.can(cleanMssv, capability)) return true;

    // 2. Lấy thông tin CLB và vai trò của sinh viên trong CLB
    const [clanRes, memberRes] = await Promise.all([
      query('SELECT leader_mssv FROM clans WHERE id = $1', [clanId]),
      query('SELECT role FROM student_clans WHERE clan_id = $1 AND mssv = $2', [clanId, cleanMssv])
    ]);

    if (clanRes.rows.length === 0) return false;

    const isLeader = clanRes.rows[0].leader_mssv === cleanMssv;
    const effectiveRole = isLeader ? 'leader' : memberRes.rows[0]?.role;

    if (!effectiveRole) return false;

    const roleCaps = new Set(CLAN_ROLE_CAPABILITIES[effectiveRole] || []);
    return matchCapability(roleCaps, capability);
  },

  /**
   * Đòi hỏi sinh viên phải có capability toàn cục; nếu không, ném lỗi HTTP 403
   */
  async require(mssv, capability, message = null) {
    const allowed = await this.can(mssv, capability);
    if (!allowed) {
      throw httpError(message || `Bạn không có quyền thực hiện hành động này (${capability}).`, 403);
    }
    return true;
  },

  /**
   * Đòi hỏi sinh viên phải có capability trong CLB; nếu không, ném lỗi HTTP 403
   */
  async requireInClan(mssv, clanId, capability, message = null) {
    const allowed = await this.canInClan(mssv, clanId, capability);
    if (!allowed) {
      throw httpError(message || `Bạn không có quyền thực hiện hành động này trong CLB (${capability}).`, 403);
    }
    return true;
  },

  /**
   * Lấy danh sách toàn bộ capabilities hiệu lực dưới dạng mảng (phục vụ frontend hoặc debug)
   */
  async getEffectiveCapabilities(mssv, clanId = null) {
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanMssv) return [];

    const caps = await this.getGlobalCapabilities(cleanMssv);

    if (clanId && isDatabaseConfigured()) {
      const [clanRes, memberRes] = await Promise.all([
        query('SELECT leader_mssv FROM clans WHERE id = $1', [clanId]),
        query('SELECT role FROM student_clans WHERE clan_id = $1 AND mssv = $2', [clanId, cleanMssv])
      ]);
      if (clanRes.rows.length > 0) {
        const isLeader = clanRes.rows[0].leader_mssv === cleanMssv;
        const role = isLeader ? 'leader' : memberRes.rows[0]?.role;
        if (role && CLAN_ROLE_CAPABILITIES[role]) {
          CLAN_ROLE_CAPABILITIES[role].forEach((c) => caps.add(c));
        }
      }
    }

    return Array.from(caps);
  }
};
