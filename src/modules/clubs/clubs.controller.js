/**
 * Module: Clubs & Guilds (CLB / Nhóm Học Tập)
 */

import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { StudentService } from '../../services/student.service.js';
import { PermissionService } from '../../services/permission.service.js';
import { getClanQuiz, saveClanQuiz } from '../../services/clan-quiz.service.js';
import { ClanRoleService } from '../../services/clan-role.service.js';

export const ClubsController = {
  // 12. CLB / Nhóm Học Tập (Clans & Guilds)
  async getClans(req, res) {
    try {
      let viewerMssv = null;
      if (req.headers.authorization) {
        try {
          viewerMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
        } catch {}
      }
      const [clans, canCreate] = await Promise.all([
        StudentService.listClans(viewerMssv),
        viewerMssv ? StudentService.canCreateClan(viewerMssv) : Promise.resolve(false)
      ]);
      return res.json({ result: true, data: clans, can_create_clan: canCreate });
    } catch (err) {
      console.error('Get clans error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải danh sách CLB / Nhóm.'
      });
    }
  },

  async createClan(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const canCreate = await StudentService.canCreateClan(mssv);
      if (!canCreate) {
        return res.status(403).json({
          result: false,
          message: 'Chỉ những thành viên có danh hiệu #TTCDS mới được phép tạo CLB / Nhóm.'
        });
      }

      const { code, name, tag, description, avatarUrl } = req.body || {};
      const clan = await StudentService.createClan({
        code,
        name,
        tag,
        description,
        avatarUrl,
        leaderMssv: mssv,
        enforcePermission: true
      });
      return res.status(201).json({ result: true, data: clan });
    } catch (err) {
      console.error('Create clan error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tạo CLB / Nhóm.'
      });
    }
  },

  async joinClan(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const result = await StudentService.requestJoinClan(mssv, req.params.id, req.body?.message, req.body?.answers);
      return res.json({
        result: true,
        data: result,
        status: result.status,
        message: result.status === 'approved'
          ? 'Bạn đã vượt qua quiz và được tự động duyệt vào CLB.'
          : 'Yêu cầu tham gia đã được gửi tới Trưởng CLB và đang chờ phê duyệt.'
      });
    } catch (err) {
      console.error('Join clan error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể gửi yêu cầu tham gia CLB / Nhóm.'
      });
    }
  },

  async getClanJoinRequests(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const requesterMssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const requests = await StudentService.getPendingJoinRequests(req.params.id, requesterMssv);
      return res.json({ result: true, data: requests });
    } catch (err) {
      console.error('Get clan join requests error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể tải danh sách yêu cầu gia nhập.'
      });
    }
  },

  async reviewClanJoinRequest(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const reviewerMssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const { action } = req.body || {};
      const result = await StudentService.reviewJoinRequest(req.params.id, reviewerMssv, req.params.requestId, action);
      return res.json({ result: true, data: result });
    } catch (err) {
      console.error('Review clan join request error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể xử lý yêu cầu gia nhập.'
      });
    }
  },

  async cancelClanJoinRequest(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const success = await StudentService.cancelJoinRequest(mssv, req.params.id);
      return res.json({ result: true, cancelled: success });
    } catch (err) {
      console.error('Cancel clan join request error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể hủy yêu cầu gia nhập.'
      });
    }
  },

  async leaveClan(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const success = await StudentService.leaveClan(mssv, req.params.id);
      return res.json({ result: true, left: success });
    } catch (err) {
      console.error('Leave clan error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể rời CLB / Nhóm.'
      });
    }
  },

  async getClanMembers(req, res) {
    try {
      const viewerMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization || '');
      const isMember = await StudentService.isClanMember(req.params.id, viewerMssv);
      const isModerator = await PermissionService.can(viewerMssv, 'community:mod_access');
      if (!isMember && !isModerator) {
        return res.status(403).json({
          result: false,
          code: 'CLAN_MEMBERS_FORBIDDEN',
          message: 'Bạn không có quyền xem danh sách thành viên của CLB này.'
        });
      }
      const members = await StudentService.getClanMembers(req.params.id);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      return res.json({ result: true, data: members });
    } catch (err) {
      console.error('Get clan members error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải danh sách thành viên.'
      });
    }
  },

  async updateClanMemberRole(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const requesterMssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const { role } = req.body || {};
      const result = await StudentService.updateMemberRole(req.params.id, requesterMssv, req.params.mssv, role);
      return res.json({ result: true, data: result });
    } catch (err) {
      console.error('Update clan member role error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể cập nhật quyền thành viên.'
      });
    }
  },

  async kickClanMember(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const requesterMssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const result = await StudentService.kickMember(req.params.id, requesterMssv, req.params.mssv);
      return res.json({ result: true, data: result });
    } catch (err) {
      console.error('Kick clan member error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể mời thành viên ra khỏi nhóm.'
      });
    }
  },

  async updateClan(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const requesterMssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const clan = await StudentService.updateClanInfo(req.params.id, requesterMssv, req.body || {});
      return res.json({ result: true, data: clan });
    } catch (err) {
      console.error('Update clan error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể cập nhật thông tin CLB.'
      });
    }
  },

  async getClanQuiz(req, res) {
    try {
      await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const quiz = await getClanQuiz(req.params.id);
      return res.json({ result: true, data: quiz });
    } catch (err) {
      console.error('Get clan quiz error:', err.message);
      return res.status(err.status || 500).json({ result: false, code: err.code, message: err.message || 'Không thể tải quiz CLB.' });
    }
  },

  async getClanRoles(req, res) {
    try {
      await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await ClanRoleService.getRoleLabels(req.params.id);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Get clan roles error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải tên chức danh CLB.'
      });
    }
  },

  async updateClanRoles(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const roles = Array.isArray(req.body) ? req.body : (req.body?.roles ?? []);
      const data = await ClanRoleService.updateRoleLabels(req.params.id, mssv, roles);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Update clan roles error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể cập nhật tên chức danh CLB.'
      });
    }
  },

  async updateClanQuiz(req, res) {
    try {
      const requesterMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const quiz = await saveClanQuiz(req.params.id, requesterMssv, req.body || {});
      return res.json({ result: true, data: quiz });
    } catch (err) {
      console.error('Update clan quiz error:', err.message);
      return res.status(err.status || 400).json({ result: false, code: err.code, message: err.message || 'Không thể lưu cấu hình quiz CLB.' });
    }
  },

  async disbandClan(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const requesterMssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const result = await StudentService.disbandClan(req.params.id, requesterMssv);
      return res.json({ result: true, data: result });
    } catch (err) {
      console.error('Disband clan error:', err.message);
      return res.status(err.status || 400).json({
        result: false,
        message: err.message || 'Không thể giải tán CLB.'
      });
    }
  },
};
