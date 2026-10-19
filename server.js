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
import { KillerSudokuRealtime } from './src/services/killer-sudoku-realtime.service.js';
import { EntertainmentGameService } from './src/services/entertainment-game.service.js';
import { TrafficService } from './src/services/traffic.service.js';

const app = createApp();
const PORT = process.env.PORT || 3000;

// PM2 cluster đặt NODE_APP_INSTANCE = 0,1,... cho từng worker. Chỉ worker 0 chạy
// job nền: nếu mọi worker cùng startJobs() thì scheduler/poller/đồng bộ kho chạy
// trùng lặp. Chạy 1 tiến trình (npm start / npm run dev, không qua PM2) thì biến
// này không tồn tại → coi như worker chính.
const WORKER_INSTANCE = process.env.NODE_APP_INSTANCE;
const isPrimaryWorker = WORKER_INSTANCE === undefined || WORKER_INSTANCE === '0';

const server = createServer(app);
CommunityRealtime.attach(server);
KillerSudokuRealtime.attach(server);
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
  if (isPrimaryWorker) {
    startJobs();
  } else {
    console.log(`[server] worker phụ (instance ${WORKER_INSTANCE}) — bỏ qua job nền.`);
  }
});

async function shutdown(signal) {
  console.log(`[server] Nhận ${signal}, đang dừng an toàn...`);
  stopJobs();
  CommunityRealtime.close();
  await TrafficService.flush().catch((error) => { console.error('[server] flush traffic failed:', error); });
  server.close(async () => {
    await closeDatabase().catch((error) => { console.error('[server] close DB failed:', error); });
    process.exit(0);
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

export default server;
