/**
 * BDU Tự Học - Server Bootstrap
 * Tầng khởi tạo tiến trình: dựng http server từ `createApp()`, gắn realtime,
 * start/stop các job nền và xử lý tín hiệu dừng an toàn.
 */

import { createServer } from 'node:http';
import { createApp } from './src/app.js';
import { startJobs, stopJobs } from './src/jobs/index.js';
import { closeDatabase } from './src/db/database.js';
import { CommunityRealtime } from './src/services/community-realtime.service.js';
import { EntertainmentGameService } from './src/services/entertainment-game.service.js';
import { TrafficService } from './src/services/traffic.service.js';
import { FacebookImportService } from './src/services/facebook-import.service.js';

const app = createApp();
const PORT = process.env.PORT || 3000;

const server = createServer(app);
CommunityRealtime.attach(server);
EntertainmentGameService.start({
  onEvent(event) {
    CommunityRealtime.publishGameExpiry(event);
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🎓 BDU Tự Học - Cổng Tiện Ích & Tự Động Hóa Sinh Viên`);
  console.log(`🌐 Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`⚙️  Môi trường: ${process.env.NODE_ENV || 'development'}`);
  console.log(`======================================================\n`);
  startJobs();
});

async function shutdown(signal) {
  console.log(`[server] Nhận ${signal}, đang dừng an toàn...`);
  stopJobs();
  await FacebookImportService.stop().catch(() => {});
  CommunityRealtime.close();
  await TrafficService.flush().catch(() => {});
  server.close(async () => {
    await closeDatabase().catch(() => { });
    process.exit(0);
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

export default server;
