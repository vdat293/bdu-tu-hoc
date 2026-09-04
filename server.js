/**
 * BDU Tự Học - Unified Express Server
 * Monolithic backend for Portal, Word Formatting, Auto Survey, and Learning Hub
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'url';
import apiRoutes from './src/routes/api.routes.js';
import { WordFmtService } from './src/services/wordfmt.service.js';
import { RankingSchedulerService } from './src/services/ranking-scheduler.service.js';
import { closeDatabase } from './src/db/database.js';
import { CommunityRealtime } from './src/services/community-realtime.service.js';
import { AvatarOverrideService } from './src/services/avatar-override.service.js';
import { IdentityAdminService } from './src/services/identity-admin.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const avatarStorageDir = AvatarOverrideService.getStorageDir();

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}
if (!fs.existsSync(avatarStorageDir)) {
  fs.mkdirSync(avatarStorageDir, { recursive: true, mode: 0o750 });
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/media/avatars', express.static(avatarStorageDir, {
  dotfiles: 'deny',
  immutable: true,
  maxAge: '1y',
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));
app.use('/media/avatars', (req, res) => res.status(404).json({ result: false, message: 'Không tìm thấy ảnh đại diện.' }));
app.use(express.static(path.join(__dirname, 'public')));

// Dedicated server-side guarded administration surface. The page itself is
// public static HTML; every data mutation is still protected by API roles.
app.get(['/admin-tool', '/admin-tool/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-tool.html'));
});

// Mount API routes
app.use('/api', apiRoutes);

// Fallback SPA routing
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ result: false, message: 'API Endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Periodic temp file cleanup every 15 minutes
const tempCleanupTimer = setInterval(() => {
  WordFmtService.cleanOldTempFiles();
}, 15 * 60 * 1000);
tempCleanupTimer.unref?.();

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  const isUploadLimit = err?.code === 'LIMIT_FILE_SIZE';
  res.status(isUploadLimit ? 413 : (err.status || 500)).json({
    result: false,
    message: isUploadLimit ? 'Ảnh vượt quá dung lượng cho phép.' : (err.message || 'Lỗi xử lý máy chủ nội bộ.')
  });
});

const server = createServer(app);
CommunityRealtime.attach(server);

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🎓 BDU Tự Học - Cổng Tiện Ích & Tự Động Hóa Sinh Viên`);
  console.log(`🌐 Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`⚙️  Môi trường: ${process.env.NODE_ENV || 'development'}`);
  console.log(`======================================================\n`);
  RankingSchedulerService.start();
  IdentityAdminService.syncCatalogFromJson().then((res) => {
    if (res?.synced) {
      console.log(`[catalog-sync] Đã đồng bộ ${res.synced} items từ identity-items.json vào database.`);
    }
  }).catch((err) => {
    console.warn('[catalog-sync] Lỗi đồng bộ catalog:', err.message);
  });
});

async function shutdown(signal) {
  console.log(`[server] Nhận ${signal}, đang dừng an toàn...`);
  RankingSchedulerService.stop();
  CommunityRealtime.close();
  server.close(async () => {
    await closeDatabase().catch(() => {});
    process.exit(0);
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

export default server;
