import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { IdentityAdminService } from '../../services/identity-admin.service.js';
import { AvatarOverrideService } from '../../services/avatar-override.service.js';
import { MediaUploadService } from '../../services/media-upload.service.js';
import { CommunityRealtime } from '../../services/community-realtime.service.js';

export const MediaController = {
  async getAdminAvatars(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await IdentityAdminService.requireRole(actor);
      const data = await AvatarOverrideService.list({ search: req.query.search, limit: req.query.limit });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể tải danh sách avatar.' });
    }
  },

  async getAdminAvatar(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await IdentityAdminService.requireRole(actor);
      const data = await AvatarOverrideService.getByMssv(req.params.mssv);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể tải avatar sinh viên.' });
    }
  },

  async uploadMyAvatar(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await AvatarOverrideService.upload({
        mssv: actor,
        actorMssv: actor,
        file: req.file
      });
      CommunityRealtime.publishIdentityChanged(data.mssv, {
        avatarUrl: data.resolved_url,
        avatarSource: data.source
      });
      return res.status(201).json({ result: true, data });
    } catch (err) {
      console.error('Upload my avatar error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể cập nhật ảnh đại diện.' });
    }
  },

  async deleteMyAvatar(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await AvatarOverrideService.remove({ mssv: actor, actorMssv: actor });
      CommunityRealtime.publishIdentityChanged(data.mssv, {
        avatarUrl: data.resolved_url,
        avatarSource: data.source
      });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Delete my avatar error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể gỡ ảnh đại diện.' });
    }
  },

  async uploadCommunityMedia(req, res) {
    try {
      const actor = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const kind = String(req.body?.kind || '').trim().toLowerCase() === 'comment' ? 'comment' : 'post';
      const data = await MediaUploadService.uploadImage({ mssv: actor, file: req.file, kind });
      return res.status(201).json({ result: true, data });
    } catch (err) {
      console.error('Upload community media error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể tải ảnh lên.' });
    }
  },

  async deleteAdminAvatar(req, res) {
    try {
      const actor = req.identityAdminMssv || await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await AvatarOverrideService.remove({ mssv: req.params.mssv, actorMssv: actor });
      CommunityRealtime.publishIdentityChanged(data.mssv, {
        avatarUrl: data.resolved_url,
        avatarSource: data.source
      });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Delete avatar override error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể gỡ ảnh đại diện.' });
    }
  },
};
