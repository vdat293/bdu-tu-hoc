/**
 * Notifications domain controller (thông báo, opt-in nhắc lịch, liên kết Discord).
 *
 * Tách từ `src/controllers/api.controller.js` (STEP 2) — thân method giữ
 * nguyên văn, chỉ dịch đường dẫn import.
 */

import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { NotificationService } from '../../services/notification.service.js';
import { NotificationPrefsService, TokenVaultService } from '../../services/notification-prefs.service.js';
import { ScheduleSnapshotService } from '../../services/schedule-snapshot.service.js';
import { DiscordLinkService } from '../../services/discord-link.service.js';
import { DiscordOAuthService } from '../../services/discord-oauth.service.js';
import { query } from '../../db/database.js';
import { safeApiErrorMessage } from '../_shared/safe-api-error.js';

export const NotificationsController = {
  async getNotifications(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { limit, offset } = req.query || {};
      const { items, total, limit: safeLimit, offset: safeOffset } = await NotificationService.listNotifications(mssv, { limit, offset });
      return res.json({ result: true, data: items, total, limit: safeLimit, offset: safeOffset });
    } catch (err) {
      console.error('Get notifications error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải thông báo.'
      });
    }
  },

  async getUnreadNotificationCount(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const unread = await NotificationService.getUnreadCount(mssv);
      return res.json({ result: true, data: { unread } });
    } catch (err) {
      console.error('Get unread notification count error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải số thông báo chưa đọc.'
      });
    }
  },

  async markNotificationRead(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await NotificationService.markRead(mssv, req.params.id);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Mark notification read error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể đánh dấu đã đọc.'
      });
    }
  },

  async markAllNotificationsRead(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await NotificationService.markAllRead(mssv);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Mark all notifications read error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể đánh dấu đã đọc tất cả.'
      });
    }
  },

  // 11b. Nhắc lịch học opt-in (Email/Discord). Mặc định TẮT.
  async getReminderPrefs(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const prefs = await NotificationPrefsService.get(mssv);
      return res.json({
        result: true,
        data: prefs ? {
          consented: NotificationPrefsService.isConsented(prefs),
          notify_email: prefs.notify_email,
          notify_discord: prefs.notify_discord,
          email: prefs.email,
          email_verified_at: prefs.email_verified_at,
          discord_linked: Boolean(prefs.discord_user_id && prefs.discord_verified_at),
          discord_username: prefs.discord_username || null,
          discord_verified_at: prefs.discord_verified_at,
          discord_dm_blocked: Boolean(prefs.discord_dm_blocked_at),
          discord_invite_url: process.env.DISCORD_INVITE_URL || null,
          remind_offsets: prefs.remind_offsets
        } : { consented: false }
      });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  async consentReminders(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { xac_nhan } = req.body || {};
      const prefs = await NotificationPrefsService.consent(mssv, { xac_nhan });
      // Snapshot ngay bằng token hiện tại để bot có dữ liệu tức thì.
      const token = req.headers.authorization || req.body?.token || '';
      if (token) {
        ScheduleSnapshotService.syncFromToken(mssv, token).catch((err) =>
          console.warn('[ScheduleSnapshot] consent sync fail:', err.message));
        TokenVaultService.save(mssv, String(token).replace(/^Bearer\s+/i, ''), null).catch(() => {});
      }
      return res.json({ result: true, data: { consented: true, consent_at: prefs.consent_at } });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  async revokeReminders(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await NotificationPrefsService.revoke(mssv);
      return res.json({ result: true, data: { consented: false } });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  async createDiscordLinkCode(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const prefs = await NotificationPrefsService.get(mssv);
      if (!NotificationPrefsService.isConsented(prefs)) {
        return res.status(400).json({ result: false, message: 'Bạn cần bật đồng ý nhận nhắc lịch trước.' });
      }
      const data = await DiscordLinkService.createCode(mssv);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  // Discord OAuth 1-click: frontend lấy URL rồi mở popup Authorize.
  async createDiscordOAuthUrl(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const prefs = await NotificationPrefsService.get(mssv);
      if (!NotificationPrefsService.isConsented(prefs)) {
        return res.status(400).json({ result: false, message: 'Bạn cần bật đồng ý nhận nhắc lịch trước.' });
      }
      const data = await DiscordOAuthService.createAuthUrl(mssv);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  // Trang /discord-callback gọi sau khi Discord redirect về kèm ?code&state.
  async completeDiscordOAuth(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { state, code } = req.body || {};
      const data = await DiscordOAuthService.complete({ mssv, state, code });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  // Gỡ liên kết Discord để đổi tài khoản. Giữ consent + snapshot lịch.
  async unlinkDiscordLink(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      await NotificationPrefsService.unlinkDiscord(mssv);
      return res.json({ result: true, data: { linked: false } });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },

  // Bắn 1 tin DM thử để kiểm tra kênh (dùng sau khi user mở kênh DM/server).
  async sendDiscordTest(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const prefs = await NotificationPrefsService.get(mssv);
      if (!NotificationPrefsService.isConsented(prefs)) {
        return res.status(400).json({ result: false, message: 'Bạn cần bật đồng ý nhận nhắc lịch trước.' });
      }
      if (!prefs?.discord_user_id) {
        return res.status(400).json({ result: false, message: 'Bạn chưa liên kết Discord.' });
      }
      await query(`
        INSERT INTO notification_outbox (mssv, channel, type, occurrence_key, remind_offset, scheduled_for, payload, status)
        VALUES ($1, 'discord', 'welcome', $2, 0, NOW(), $3, 'pending')
        ON CONFLICT (mssv, channel, occurrence_key, remind_offset) DO NOTHING;
      `, [
        mssv,
        `test:${Date.now()}`,
        JSON.stringify({ text: '🔔 Tin thử nè! Thấy tin này là kênh nhận tin của bạn đã mở, từ giờ bot sẽ nhắc ở đây nhé.' }).slice(0, 1000)
      ]);
      return res.json({ result: true, data: { queued: true } });
    } catch (err) {
      return res.status(err.status || 500).json({ result: false, message: safeApiErrorMessage(err) });
    }
  },
};
