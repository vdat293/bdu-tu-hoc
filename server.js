/**
 * BDU Tự Học - Unified Express Server
 * Monolithic backend for Portal, Word Formatting, Auto Survey, and Learning Hub
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import apiRoutes from './src/routes/api.routes.js';
import { WordFmtService } from './src/services/wordfmt.service.js';
import { RankingSchedulerService } from './src/services/ranking-scheduler.service.js';
import { closeDatabase } from './src/db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
  res.status(500).json({
    result: false,
    message: err.message || 'Lỗi xử lý máy chủ nội bộ.'
  });
});

const server = app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🎓 BDU Tự Học - Cổng Tiện Ích & Tự Động Hóa Sinh Viên`);
  console.log(`🌐 Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`⚙️  Môi trường: ${process.env.NODE_ENV || 'development'}`);
  console.log(`======================================================\n`);
  RankingSchedulerService.start();
});

async function shutdown(signal) {
  console.log(`[server] Nhận ${signal}, đang dừng an toàn...`);
  RankingSchedulerService.stop();
  server.close(async () => {
    await closeDatabase().catch(() => {});
    process.exit(0);
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

export default server;
