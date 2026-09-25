/**
 * In-app notifications (tag/reply confession) và nhắc lịch học opt-in.
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 */
import { ApiController } from './_shared/http-deps.js';

/**
 * Tách 2 hàm vì file gốc xen khối này với identity/broadcast
 * (xem src/routes/api.routes.js): notifications ở dòng 126-130, còn reminders
 * ở dòng 132-140. Giữ 2 hàm riêng để assembler gọi đúng thứ tự dòng gốc.
 */

/** Dòng 126-130: thông báo tag/reply confession. */
export function registerNotificationRoutes(router) {
  // Thông báo tag/reply confession
  router.get('/notifications', ApiController.getNotifications);
  router.get('/notifications/unread-count', ApiController.getUnreadNotificationCount);
  router.post('/notifications/read-all', ApiController.markAllNotificationsRead);
  router.post('/notifications/:id/read', ApiController.markNotificationRead);
}

/** Dòng 132-140: nhắc lịch học opt-in (Email/Discord). */
export function registerReminderRoutes(router) {
  // Nhắc lịch học opt-in (Email/Discord)
  router.get('/reminders/prefs', ApiController.getReminderPrefs);
  router.post('/reminders/consent', ApiController.consentReminders);
  router.delete('/reminders/revoke', ApiController.revokeReminders);
  router.post('/reminders/discord/code', ApiController.createDiscordLinkCode);
  router.post('/reminders/discord/oauth-url', ApiController.createDiscordOAuthUrl);
  router.post('/reminders/discord/oauth-complete', ApiController.completeDiscordOAuth);
  router.post('/reminders/discord/test', ApiController.sendDiscordTest);
  router.delete('/reminders/discord/link', ApiController.unlinkDiscordLink);
}
