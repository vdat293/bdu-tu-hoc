/**
 * Broadcast domain controller (gửi thông báo cập nhật qua Discord DM từ Admin Tool).
 *
 * Tách từ `src/controllers/api.controller.js` (STEP 2) — thân method giữ
 * nguyên văn, chỉ dịch đường dẫn import.
 */

import { BroadcastService } from '../../services/broadcast.service.js';

export const BroadcastController = {
  // 10d. Thông báo cập nhật website qua Discord DM (gửi từ Admin Tool)
  async getAdminBroadcast(req, res) {
    try {
      const [recipients, recent] = await Promise.all([
        BroadcastService.getRecipients(),
        BroadcastService.listRecent(8)
      ]);
      return res.json({ result: true, data: { recipients, recent } });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('getAdminBroadcast error:', err.message);
      return res.status(status).json({ result: false, message: err.message || 'Không thể tải thông tin thông báo.' });
    }
  },

  async sendAdminBroadcast(req, res) {
    try {
      const { text, key } = req.body || {};
      const data = await BroadcastService.enqueue({ text, key, actor: req.identityAdminMssv || null });
      return res.json({ result: true, data });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('sendAdminBroadcast error:', err.message);
      return res.status(status).json({ result: false, message: err.message || 'Không thể gửi thông báo.' });
    }
  }
};
