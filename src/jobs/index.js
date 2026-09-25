/**
 * BDU Tự Học - Background jobs lifecycle
 * Gom các scheduler/service chạy nền vào một chỗ để bootstrap chỉ còn gọi
 * `startJobs()` lúc listen và `stopJobs()` lúc shutdown.
 *
 * `EntertainmentGameService.start()` không nằm ở đây: service đó cần callback
 * realtime nên được start ở tầng server (nơi đã gắn `CommunityRealtime` vào http
 * server). Phần `stop()` vẫn thuộc vòng đời job nên nằm cùng `stopJobs()`.
 */

import { RankingSchedulerService } from '../services/ranking-scheduler.service.js';
import { ReminderSchedulerService } from '../services/reminder-scheduler.service.js';
import { OutboxMailerService } from '../services/outbox-mailer.service.js';
import { MediaCleanupService } from '../services/media-cleanup.service.js';
import { IdentityAdminService } from '../services/identity-admin.service.js';
import { EntertainmentGameService } from '../services/entertainment-game.service.js';
import { TrafficService } from '../services/traffic.service.js';
import { FacebookImportService } from '../services/facebook-import.service.js';
import { AssetHistoryService } from '../services/asset-history.service.js';

export function startJobs() {
  RankingSchedulerService.start();
  ReminderSchedulerService.start();
  OutboxMailerService.start();
  TrafficService.start();
  FacebookImportService.start();
  AssetHistoryService.start();
  MediaCleanupService.start();
  IdentityAdminService.syncCatalogFromJson().then((res) => {
    if (res?.synced) {
      console.log(`[catalog-sync] Đã đồng bộ ${res.synced} items từ identity-items.json vào database.`);
    }
  }).catch((err) => {
    console.warn('[catalog-sync] Lỗi đồng bộ catalog:', err.message);
  });
}

export function stopJobs() {
  RankingSchedulerService.stop();
  ReminderSchedulerService.stop();
  OutboxMailerService.stop();
  TrafficService.stop();
  EntertainmentGameService.stop();
  AssetHistoryService.stop();
  MediaCleanupService.stop();
}
