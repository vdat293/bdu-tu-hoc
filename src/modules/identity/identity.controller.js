/**
 * Identity domain controller (hồ sơ, danh hiệu hiển thị, khung, quyền admin).
 *
 * Tách từ `src/controllers/api.controller.js` (STEP 2) — thân method giữ
 * nguyên văn, chỉ dịch đường dẫn import. Bản sao inline trong `getProfile`
 * đã dùng chung `bearerToken()`.
 */

import { BduService } from '../../services/bdu.service.js';
import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { IdentityPresentationService } from '../../services/identity-presentation.service.js';
import { IdentityAdminService } from '../../services/identity-admin.service.js';
import { CommunityRealtime } from '../../services/community-realtime.service.js';
import { AcademicSnapshotService } from '../../services/academic-snapshot.service.js';
import { AcademicRankingService } from '../../services/academic-ranking.service.js';
import { StudentService } from '../../services/student.service.js';
import { PermissionService } from '../../services/permission.service.js';
import { bearerToken } from '../_shared/bearer-token.js';
import { safeApiErrorMessage } from '../_shared/safe-api-error.js';

export const IdentityController = {
  // 3. Student: Profile
  async getProfile(req, res) {
    try {
      const headerToken = bearerToken(req);
      const bodyToken = String(req.body?.token || '').trim();
      if (headerToken && bodyToken && headerToken !== bodyToken) {
        return res.status(400).json({
          result: false,
          code: 'PROFILE_TOKEN_MISMATCH',
          message: 'Token xác thực không nhất quán.'
        });
      }
      const token = headerToken || bodyToken;
      const requestedMssv = req.query?.MaSV || req.query?.maSV || req.query?.mssv || req.body?.maSV || req.body?.mssv || req.body?.userName || '';

      if (!token) {
        return res.status(401).json({ result: false, message: 'Thiếu mã xác thực (Token). Vui lòng đăng nhập lại.' });
      }

      // This endpoint is the authenticated user's own profile. Never allow a
      // client-supplied MaSV/IDSV to choose the upstream lookup or the local
      // record that receives profile data.
      const verifiedMssv = await BduIdentityService.resolveVerifiedMssv(token);
      const cleanRequestedMssv = String(requestedMssv || '').trim().toUpperCase();
      if (cleanRequestedMssv && cleanRequestedMssv !== verifiedMssv) {
        return res.status(403).json({
          result: false,
          code: 'PROFILE_OWNER_MISMATCH',
          message: 'Không thể truy cập hồ sơ của sinh viên khác.'
        });
      }

      const profileData = await BduService.getProfile(token, '', verifiedMssv);
      try {
        await IdentityPresentationService.recordProfile(verifiedMssv, profileData);
      } catch (profileSyncError) {
        console.warn('[IdentityPresentation] Không thể lưu ảnh hồ sơ:', profileSyncError.message);
      }
      return res.json(profileData);
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  async getMyIdentityPresentation(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityPresentationService.getPresentation(mssv);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải danh hiệu hiển thị.'
      });
    }
  },

  // Catalog khung cho site độc lập /games: cần đăng nhập nhưng không cần quyền admin.
  async getIdentityFrames(req, res) {
    try {
      await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const frames = await IdentityPresentationService.listFrameCatalog();
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.json({ result: true, data: { frames } });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        code: err.code || 'IDENTITY_FRAMES_FAILED',
        message: err.message || 'Không thể tải danh sách khung.'
      });
    }
  },

  /**
   * Hồ sơ công khai của một sinh viên (mở từ tag @MSSV trong Confession):
   * presentation (tên, avatar, khung, danh hiệu, clan) + học lực tích lũy
   * (GPA hệ 10/4, tín chỉ đạt, xếp loại) kèm thứ hạng nổi bật.
   */
  async getStudentProfile(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      const requesterMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const mssv = String(req.params.mssv || '').trim().toUpperCase();
      if (!mssv) {
        return res.status(400).json({ result: false, message: 'Thiếu MSSV cần xem hồ sơ.' });
      }
      const presentation = await IdentityPresentationService.getPresentation(mssv);
      let snapshot = await AcademicSnapshotService.getSnapshot(mssv).catch(() => null);
      // Chính chủ mở hồ sơ mà chưa có snapshot (user cũ chưa đăng nhập lại):
      // chụp ngay từ payload điểm BDU đang có token, để GPA hệ 10 không trống.
      if (!snapshot && requesterMssv === mssv) {
        try {
          const grades = await BduService.getGrades(req.headers.authorization);
          snapshot = await AcademicSnapshotService.saveFromGrades(mssv, grades, { source: 'profile_view' });
        } catch (snapshotError) {
          console.warn('[AcademicSnapshot] Không thể chụp học lực khi mở hồ sơ:', snapshotError.message);
        }
      }
      const ranking = AcademicRankingService.hasDatabase()
        ? await AcademicRankingService.getLatestByMssv(mssv).catch(() => null)
        : null;
      const toNumberOrNull = (value) => {
        const number = Number(value);
        return value === null || value === undefined || !Number.isFinite(number) ? null : number;
      };
      const academic = {
        gpa_10: toNumberOrNull(snapshot?.gpa_10),
        gpa_4: toNumberOrNull(snapshot?.gpa_4) ?? toNumberOrNull(ranking?.gpa_tich_luy_he_4),
        earned_credits: toNumberOrNull(snapshot?.earned_credits) ?? toNumberOrNull(ranking?.tin_chi_dat_tich_luy),
        classification: snapshot?.classification || ranking?.xep_loai_tich_luy || null,
        semester_code: snapshot?.semester_code || ranking?.nkhk || null,
        updated_at: snapshot?.updated_at || ranking?.dong_bo_luc || null,
        source: snapshot ? 'snapshot' : (ranking ? 'ranking' : null),
        rank_gpa: ranking?.xep_hang_noi_bat?.gpa_tich_luy || null,
        rank_credits: ranking?.xep_hang_noi_bat?.tin_chi_tich_luy || null
      };
      return res.json({ result: true, data: { ...presentation, academic } });
    } catch (err) {
      console.error('Get student profile error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải hồ sơ sinh viên.'
      });
    }
  },

  async updateMyIdentityPresentation(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityPresentationService.updateSelectedTitles(
        mssv,
        req.body?.selectedTitleIds
      );
      CommunityRealtime.publishIdentityChanged(mssv);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể cập nhật danh hiệu hiển thị.'
      });
    }
  },

  async updateMyEquippedFrame(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityPresentationService.updateEquippedFrame(mssv, req.body?.frameId);
      CommunityRealtime.publishIdentityChanged(mssv);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Update equipped frame error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể cập nhật khung hiển thị.'
      });
    }
  },

  async requireIdentityAdmin(req, res, next) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await IdentityAdminService.requireRole(actor);
      req.identityAdminMssv = actor;
      return next();
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không có quyền quản trị.' });
    }
  },

  async requireCommunityModerator(req, res, next) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await PermissionService.require(actor, 'community:mod_access', 'Bạn không có quyền kiểm duyệt bảng tin.');
      req.communityModeratorMssv = actor;
      return next();
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không có quyền kiểm duyệt.' });
    }
  },

  async getAdminIdentityItems(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await IdentityAdminService.requireRole(actor);
      const data = await IdentityAdminService.listItems({
        type: req.query.type,
        includeInactive: req.query.includeInactive === 'true'
      });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể tải catalog quyền hiển thị.' });
    }
  },


  async createAdminIdentityItem(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityAdminService.createItem({ ...req.body, actorMssv: actor });
      return res.status(201).json({ result: true, data });
    } catch (err) {
      console.error('Create identity item error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể tạo item mới.' });
    }
  },


  async updateAdminIdentityItem(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityAdminService.updateItem({ ...req.body, id: req.params.id, actorMssv: actor });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Update identity item error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể cập nhật item.' });
    }
  },


  async deleteAdminIdentityItem(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityAdminService.deleteItem({ id: req.params.id, actorMssv: actor, reason: req.body?.reason });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Delete identity item error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể xóa item.' });
    }
  },


  async getAdminIdentityGrants(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await IdentityAdminService.requireRole(actor);
      const data = await IdentityAdminService.listGrants(req.params.mssv);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể tải grant.' });
    }
  },


  async createAdminIdentityGrant(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await IdentityAdminService.requireRole(actor);
      const data = await IdentityAdminService.grant({
        ...req.body,
        actorMssv: actor
      });
      CommunityRealtime.publishIdentityChanged(data.mssv);
      return res.status(201).json({ result: true, data });
    } catch (err) {
      console.error('Create identity grant error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể cấp quyền hiển thị.' });
    }
  },


  async revokeAdminIdentityGrant(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await IdentityAdminService.requireRole(actor);
      const data = await IdentityAdminService.revoke({
        grantId: req.params.grantId,
        actorMssv: actor,
        reason: req.body?.reason
      });
      CommunityRealtime.publishIdentityChanged(data.mssv);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Revoke identity grant error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể thu hồi quyền hiển thị.' });
    }
  },


  async getAdminIdentityAudit(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await IdentityAdminService.requireRole(actor);
      const data = await IdentityAdminService.listAudit({ mssv: req.query.mssv, limit: req.query.limit });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể tải audit log.' });
    }
  },


  async grantAdminSystemRole(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityAdminService.grantRole({ ...req.body, actorMssv: actor });
      return res.status(201).json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể cấp role quản trị.' });
    }
  },


  async revokeAdminSystemRole(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await IdentityAdminService.revokeRole({
        mssv: req.params.mssv,
        role: req.params.role,
        actorMssv: actor
      });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể thu hồi role quản trị.' });
    }
  },


  async searchActiveStudents(req, res) {
    try {
      await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await StudentService.searchActiveStudents(req.query?.q, req.query?.limit);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Search active students error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tìm kiếm sinh viên.'
      });
    }
  },
};
