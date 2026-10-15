/**
 * Module: Trung tam Chuyen doi so — "Sinh vien cua toi".
 *
 * Mọi route đều yêu cầu đăng nhập qua `BduIdentityService.resolveVerifiedMssv`
 * rồi qua cổng `TtcdsService.requireAccess` (mất nametag #TTCDS = mất cả
 * Trung tâm). Các thao tác ghi thêm cổng `TtcdsService.requireCreate`.
 * Gọi TtcdsService DƯỚI DẠNG bound (`TtcdsService.*`), không destructure.
 */

import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { PermissionService } from '../../services/permission.service.js';
import { TtcdsService, normalizeTtcdsMssv } from '../../services/ttcds.service.js';
import { TtcdsStudentService } from '../../services/ttcds-student.service.js';
import { query } from '../../db/database.js';

function sendError(res, err, fallbackStatus = 500, fallbackMessage = 'Đã có lỗi xảy ra.') {
  const body = { result: false, message: err?.message || fallbackMessage };
  if (err?.code) body.code = err.code;
  return res.status(err?.status || fallbackStatus).json(body);
}

function isAllFlag(value) {
  return String(value ?? '') === '1';
}

async function loadGroupOr404(groupId) {
  const result = await query('SELECT id, name, owner_mssv FROM ttcds_groups WHERE id = $1', [groupId]);
  return result.rows[0] || null;
}

async function assertGroupOwnership(group, requesterMssv, message) {
  if (normalizeTtcdsMssv(group.owner_mssv) === normalizeTtcdsMssv(requesterMssv)) return;
  if (await PermissionService.isSystemOwner(requesterMssv)) return;
  const err = new Error(message);
  err.status = 403;
  throw err;
}

/**
 * Sinh viên phải thuộc một group của chính người xem (trừ system owner
 * kèm `?all=1`), nếu không 403. Dùng một query JOIN thay vì N+1 listMembers.
 */
async function assertStudentInScope(requesterMssv, targetMssv, req) {
  if (isAllFlag(req.query?.all) && await PermissionService.isSystemOwner(requesterMssv)) return;
  const hit = await query(
    `SELECT 1 FROM ttcds_group_members m
     JOIN ttcds_groups g ON g.id = m.group_id
     WHERE g.owner_mssv = $1 AND m.mssv = $2
     LIMIT 1`,
    [normalizeTtcdsMssv(requesterMssv), normalizeTtcdsMssv(targetMssv)]
  );
  if (hit.rows.length === 0) {
    const err = new Error('Bạn không có quyền xem sinh viên này.');
    err.status = 403;
    throw err;
  }
}

async function assertSystemOwner(requesterMssv) {
  if (await PermissionService.isSystemOwner(requesterMssv)) return;
  const err = new Error('Chỉ quản trị viên hệ thống mới được thực hiện thao tác này.');
  err.status = 403;
  throw err;
}

export const TtcdsController = {
  async getCapabilities(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      let can_access = false;
      try {
        await TtcdsService.requireAccess(mssv);
        can_access = true;
      } catch {
        can_access = false;
      }
      // Không có quyền vào Trung tâm thì level luôn null, không bao giờ ném lỗi ở đây.
      const level = can_access ? await TtcdsService.getLevel(mssv) : null;
      return res.json({ result: true, can_access, level });
    } catch (err) {
      return sendError(res, err, err?.status || 500, 'Vui lòng đăng nhập để tiếp tục.');
    }
  },

  async listGroups(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await TtcdsService.requireAccess(mssv);
      // `?all=1` chỉ có hiệu lực khi người xem là system owner, còn lại bỏ qua flag.
      const includeAll = isAllFlag(req.query?.all) && await PermissionService.isSystemOwner(mssv);
      const data = await TtcdsService.listGroups(mssv, { includeAll });
      return res.json({ result: true, data });
    } catch (err) {
      return sendError(res, err, err?.status || 500, 'Không thể tải danh sách nhóm.');
    }
  },

  async createGroup(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await TtcdsService.requireCreate(mssv);
      const { name, nien_khoa, description } = req.body || {};
      if (!String(name ?? '').trim()) {
        return res.status(400).json({ result: false, message: 'Tên nhóm không được để trống.' });
      }
      const group = await TtcdsService.createGroup({
        name,
        nienKhoa: nien_khoa,
        description,
        ownerMssv: mssv
      });
      await query(
        'INSERT INTO ttcds_audit_logs (actor_mssv, action, target_group_id) VALUES ($1, $2, $3)',
        [normalizeTtcdsMssv(mssv), 'group.create', group.id]
      );
      return res.status(201).json({ result: true, data: group });
    } catch (err) {
      return sendError(res, err, err?.status || 500, 'Không thể tạo nhóm.');
    }
  },

  async deleteGroup(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await TtcdsService.requireAccess(mssv);
      const group = await loadGroupOr404(req.params.id);
      if (!group) {
        return res.status(404).json({ result: false, message: 'Không tìm thấy nhóm.' });
      }
      await assertGroupOwnership(group, mssv, 'Bạn không có quyền xóa nhóm này.');
      // Xóa là thao tác phá hủy: chủ group đã bị hạ xuống `view` không được
      // xóa; system owner giữ quyền quản trị đầy đủ nên được miễn cổng create.
      if (!(await PermissionService.isSystemOwner(mssv))) {
        await TtcdsService.requireCreate(mssv);
      }
      // Không có service helper: xóa trực tiếp, members cascade theo migration 057.
      await query('DELETE FROM ttcds_groups WHERE id = $1', [group.id]);
      await query(
        'INSERT INTO ttcds_audit_logs (actor_mssv, action, target_group_id) VALUES ($1, $2, $3)',
        [normalizeTtcdsMssv(mssv), 'group.delete', group.id]
      );
      return res.json({ result: true, deleted: true });
    } catch (err) {
      return sendError(res, err, err?.status || 500, 'Không thể xóa nhóm.');
    }
  },

  async listMembers(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await TtcdsService.requireAccess(mssv);
      const group = await loadGroupOr404(req.params.id);
      if (!group) {
        return res.status(404).json({ result: false, message: 'Không tìm thấy nhóm.' });
      }
      await assertGroupOwnership(group, mssv, 'Bạn không có quyền xem danh sách thành viên của nhóm này.');
      const members = await TtcdsService.listMembers(group.id);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      return res.json({ result: true, data: members });
    } catch (err) {
      return sendError(res, err, err?.status || 500, 'Không thể tải danh sách thành viên.');
    }
  },

  async addMember(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await TtcdsService.requireCreate(mssv);
      const group = await loadGroupOr404(req.params.id);
      if (!group) {
        return res.status(404).json({ result: false, message: 'Không tìm thấy nhóm.' });
      }
      await assertGroupOwnership(group, mssv, 'Bạn không có quyền thêm thành viên vào nhóm này.');
      const target = normalizeTtcdsMssv(req.body?.mssv);
      if (!target) {
        return res.status(400).json({ result: false, message: 'Thiếu MSSV của sinh viên.' });
      }
      const member = await TtcdsService.addMember(group.id, target, {
        addedBy: mssv,
        note: req.body?.note
      });
      await query(
        'INSERT INTO ttcds_audit_logs (actor_mssv, action, target_group_id, target_mssv) VALUES ($1, $2, $3, $4)',
        [normalizeTtcdsMssv(mssv), 'member.add', group.id, target]
      );
      return res.json({ result: true, data: member });
    } catch (err) {
      return sendError(res, err, err?.status || 500, 'Không thể thêm thành viên.');
    }
  },

  async removeMember(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await TtcdsService.requireCreate(mssv);
      const group = await loadGroupOr404(req.params.id);
      if (!group) {
        return res.status(404).json({ result: false, message: 'Không tìm thấy nhóm.' });
      }
      await assertGroupOwnership(group, mssv, 'Bạn không có quyền xóa thành viên khỏi nhóm này.');
      const target = normalizeTtcdsMssv(req.params.mssv);
      const removed = await TtcdsService.removeMember(group.id, target);
      if (removed) {
        await query(
          'INSERT INTO ttcds_audit_logs (actor_mssv, action, target_group_id, target_mssv) VALUES ($1, $2, $3, $4)',
          [normalizeTtcdsMssv(mssv), 'member.remove', group.id, target]
        );
      }
      return res.json({ result: true, removed });
    } catch (err) {
      return sendError(res, err, err?.status || 500, 'Không thể xóa thành viên.');
    }
  },

  async searchStudents(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await TtcdsService.requireAccess(mssv);
      const q = String(req.query?.q ?? '').trim();
      if (q.length < 2) {
        return res.status(400).json({ result: false, message: 'Nhập ít nhất 2 ký tự để tìm kiếm.' });
      }
      const data = await TtcdsStudentService.searchStudents(q, { limit: req.query?.limit });
      return res.json({ result: true, data });
    } catch (err) {
      return sendError(res, err, err?.status || 503, 'Không thể tìm kiếm sinh viên.');
    }
  },

  async getStudent(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await TtcdsService.requireAccess(mssv);
      const target = normalizeTtcdsMssv(req.params.mssv);
      await assertStudentInScope(mssv, target, req);
      const data = await TtcdsStudentService.getStudent(target);
      return res.json({ result: true, data });
    } catch (err) {
      return sendError(res, err, err?.status || 503, 'Không thể tải thông tin sinh viên.');
    }
  },

  async getAttendance(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await TtcdsService.requireAccess(mssv);
      const target = normalizeTtcdsMssv(req.params.mssv);
      await assertStudentInScope(mssv, target, req);
      const data = await TtcdsStudentService.getAttendance(target, {
        ma_mon_hoc: req.query?.ma_mon_hoc,
        ma_nhom: req.query?.ma_nhom,
        nkhk: req.query?.nkhk
      });
      return res.json({ result: true, data });
    } catch (err) {
      return sendError(res, err, err?.status || 503, 'Không thể tải nhật ký điểm danh.');
    }
  },

  async listPermissions(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await TtcdsService.requireAccess(mssv);
      await assertSystemOwner(mssv);
      const result = await query(
        'SELECT mssv, level, granted_by, note, granted_at, updated_at FROM ttcds_permissions ORDER BY mssv ASC'
      );
      return res.json({ result: true, data: result.rows });
    } catch (err) {
      return sendError(res, err, err?.status || 500, 'Không thể tải danh sách phân quyền.');
    }
  },

  async setPermission(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await TtcdsService.requireAccess(mssv);
      await assertSystemOwner(mssv);
      const target = normalizeTtcdsMssv(req.body?.mssv);
      if (!target) {
        return res.status(400).json({ result: false, message: 'Thiếu MSSV được cấp quyền.' });
      }
      // Validate ở JS để trả 400 thân thiện; CHECK của DB không phải lỗi user-facing.
      const level = String(req.body?.level ?? '').trim();
      if (level !== 'view' && level !== 'create') {
        return res.status(400).json({ result: false, message: 'Mức quyền không hợp lệ (view|create).' });
      }
      const data = await TtcdsService.setLevel({
        mssv: target,
        level,
        grantedBy: mssv,
        note: req.body?.note
      });
      await query(
        'INSERT INTO ttcds_audit_logs (actor_mssv, action, target_mssv) VALUES ($1, $2, $3)',
        [normalizeTtcdsMssv(mssv), 'permission.grant', target]
      );
      return res.json({ result: true, data });
    } catch (err) {
      return sendError(res, err, err?.status || 500, 'Không thể cập nhật phân quyền.');
    }
  },

  async listAuditLogs(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await TtcdsService.requireAccess(mssv);
      await assertSystemOwner(mssv);
      const limit = Math.min(Math.max(Number.parseInt(req.query?.limit, 10) || 50, 1), 200);
      const result = await query(
        'SELECT id, actor_mssv, action, target_group_id, target_mssv, created_at FROM ttcds_audit_logs ORDER BY id DESC LIMIT $1',
        [limit]
      );
      return res.json({ result: true, data: result.rows });
    } catch (err) {
      return sendError(res, err, err?.status || 500, 'Không thể tải nhật ký thao tác.');
    }
  }
};
