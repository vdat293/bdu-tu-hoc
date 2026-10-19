/**
 * BDU Tự Học - Express Application
 * Toàn bộ tầng HTTP: middleware, static mounts, mount /api, fallback SPA và
 * error handler. Không chứa job nền, không tạo http server — `createApp()` trả
 * về app để `server.js` (tầng bootstrap) quyết định port và vòng đời tiến trình.
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'url';
import apiRoutes from './routes/api.routes.js';
import { WordFmtService } from './services/wordfmt.service.js';
import { MediaStorageService } from './services/media-storage.service.js';
import { AssetHistoryService } from './services/asset-history.service.js';
import { TrafficService } from './services/traffic.service.js';
import { ServiceLockService } from './services/service-lock.service.js';
import { createServiceLockGuard } from './utils/service-lock-guard.js';
import { attachRequestContext } from './utils/request-context.js';
import { globalLimiter, authLimiter, heavyLimiter } from './utils/rate-limit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// server.js nằm ở ROOT nên `__dirname` của nó trỏ thẳng repo root. File này
// nằm trong `src/`, nên mọi đường dẫn tài nguyên phải bù thêm một cấp để không
// đổi hành vi so với file gốc.
const ROOT_DIR = path.resolve(__dirname, '..');

const clientDistDir = path.join(ROOT_DIR, 'dist', 'client');
const clientIndexPath = path.join(clientDistDir, 'index.html');
const hasReactClientBuild = fs.existsSync(clientIndexPath);

// Ensure temp directory exists
const tempDir = path.join(ROOT_DIR, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}
// Chunk cũ của các bản build trước được giữ trong volume để HTML còn cache
// không bị 404; serve-static cần thư mục tồn tại ngay từ request đầu tiên.
const assetHistoryDir = AssetHistoryService.getDir();
if (AssetHistoryService.isEnabled() && !fs.existsSync(assetHistoryDir)) {
  fs.mkdirSync(assetHistoryDir, { recursive: true, mode: 0o750 });
}

export function createApp() {
  const app = express();

  // Middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(attachRequestContext);
  app.use(TrafficService.middleware());
  // Ảnh/avatar người dùng nằm trên Cloudflare R2 (không ghi file runtime xuống
  // máy chủ). Khi bucket chưa gắn custom domain/r2.dev, route này stream object từ R2
  // và cache mạnh ở tầng CDN phía trước. Khi có R2_PUBLIC_BASE_URL, URL ảnh mới
  // sẽ trỏ thẳng CDN còn route này vẫn phục vụ các URL cũ đã lưu trong DB.
  app.get('/media/r2/*', async (req, res) => {
    try {
      const object = await MediaStorageService.getObject(req.params[0] || '');
      res.setHeader('Content-Type', object.contentType);
      if (object.contentLength) res.setHeader('Content-Length', String(object.contentLength));
      if (object.etag) res.setHeader('ETag', object.etag);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const body = object.body;
      // AWS SDK v3 trả Node Readable ở runtime Node; chỉ chuyển đổi khi gặp
      // web ReadableStream (ví dụ môi trường có fetch stream).
      if (body && typeof body.pipe === 'function') body.pipe(res);
      else Readable.fromWeb(body).pipe(res);
    } catch (error) {
      if (error?.status === 404) {
        return res.status(404).json({ result: false, message: 'Không tìm thấy ảnh.' });
      }
      if (error?.status === 503) {
        return res.status(503).json({ result: false, message: error.message });
      }
      console.error('[media] Lỗi stream ảnh R2:', error.message);
      if (!res.headersSent) return res.status(502).json({ result: false, message: 'Không thể tải ảnh.' });
      res.destroy?.();
    }
  });
  // Chặn cuối cho /media/*: ảnh phải đến từ R2 (`/media/r2/*` hoặc CDN
  // img.bdu.io.vn). Media cũ đã mất file phải trả 404, TUYỆT ĐỐI không rơi vào
  // fallback SPA — nếu không request ảnh sẽ nhận index.html (200) và browser
  // hiện icon ảnh vỡ khắp nơi.
  app.use('/media', (req, res) => {
    res.status(404).json({ result: false, message: 'Không tìm thấy ảnh.' });
  });
  // The React build has its own immutable namespace. Legacy public assets and
  // the standalone admin surface remain available during the migration.
  // Dist được ưu tiên; nếu tầng cache phía trước còn giữ HTML cũ, request chunk
  // cũ rơi xuống bản lưu trong volume (AssetHistoryService) thay vì 404.
  app.use('/app-assets', express.static(path.join(clientDistDir, 'app-assets'), {
    immutable: true,
    maxAge: '1y',
    fallthrough: true,
    redirect: false,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
  }));
  app.use('/app-assets', express.static(AssetHistoryService.getDir(), {
    immutable: true,
    maxAge: '1y',
    fallthrough: false,
    redirect: false,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
  }));

  // Giải trí is a separate site, not a portal sidebar route. The portal only
  // links to this entry point; the wildcard keeps room/challenge deep links
  // working after a refresh on the server.
  const gamesSiteDir = path.join(ROOT_DIR, 'public', 'games');
  app.use('/games', express.static(gamesSiteDir, {
    index: false,
    // Không để serve-static tự 301 `/games` → `/games/`: mỗi vòng redirect là một
    // cơ hội để proxy/CDN phía trước lặp chuyển hướng với người dùng thật.
    redirect: false,
    fallthrough: true,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }));
  app.get(['/games', '/games/', '/games/*'], (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(gamesSiteDir, 'index.html'));
  });

  // Dedicated server-side guarded administration surface. The page itself is
  // public static HTML; every data mutation is still protected by API roles.
  app.get(['/admin-tool', '/admin-tool/'], (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'public', 'admin-tool.html'));
  });

  // Killer Sudoku Game - Standalone Web Edition
  const sudokuSiteDir = path.join(ROOT_DIR, 'public', 'killer-sudoku');
  app.use('/killer-sudoku', express.static(sudokuSiteDir, {
    index: false,
    redirect: false,
    fallthrough: true,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
  }));
  app.get(['/killer-sudoku', '/killer-sudoku/', '/killer-sudoku/*'], (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(sudokuSiteDir, 'index.html'));
  });

  // Admin Dashboard - Standalone Traffic & Logs site (completely independent from portal)
  const adminSiteDir = path.join(ROOT_DIR, 'public', 'admin');
  app.use('/admin', express.static(adminSiteDir, {
    index: false,
    redirect: false,
    fallthrough: true,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }));
  app.get(['/admin', '/admin/', '/admin/*'], (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(adminSiteDir, 'index.html'));
  });

  // Mount public chung phải đứng SAU các mount chuyên biệt (/games, /admin,
  // /admin-tool, media). Nếu đứng trước, serve-static sẽ tự 301 `/games` →
  // `/games/` trước khi handler riêng kịp chạy; 301 là redirect cacheable nên
  // proxy/CDN phía trước có thể nhân bản và lặp vô hạn với người dùng thật.
  // Asset legacy không có hash trong tên nên phải revalidate: browser/CDN nhận
  // 304 qua ETag, còn file đổi nội dung sẽ được phục vụ ngay sau deploy.
  app.use(express.static(path.join(ROOT_DIR, 'public'), {
    index: false,
    redirect: false,
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.html' || ext === '.js' || ext === '.css') {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
  }));

  // Cửa chặn bảo trì phải đứng SAU mọi mount static (để SPA, /app-assets và
  // màn hình bảo trì vẫn tải được khi đang khóa) và TRƯỚC app.use('/api',
  // apiRoutes) (để chặn mọi request /api mà không phải sửa thứ tự route bên
  // trong api.routes.js). Các path miễn trừ /health, /version, /status và
  // /admin/dashboard được guard tự bỏ qua.
  // Rate limiting (Phase A): broad protection + stricter limits on auth and
  // heavy endpoints. Must run before the routes so every /api call is counted.
  app.use('/api/login', authLimiter);
  app.use('/api/rankings', heavyLimiter);
  app.use('/api/odp', heavyLimiter);
  app.use('/api/vocab', heavyLimiter);
  app.use('/api', globalLimiter);

  app.use('/api', createServiceLockGuard({ getStatus: () => ServiceLockService.getStatus() }));

  // Mount API routes
  app.use('/api', apiRoutes);

  // Fallback SPA routing
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ result: false, message: 'API Endpoint not found' });
    }
    // Request tài nguyên tĩnh đã "miss" ở các mount phía trên (có phần mở rộng
    // file như .jpg/.webp/.js) phải trả 404, không trả index.html — nếu không,
    // ảnh/asset thiếu sẽ được phục vụ như HTML và hiện icon vỡ.
    if (path.extname(req.path)) {
      return res.status(404).json({ result: false, message: 'Resource not found' });
    }
    if (!req.accepts('html')) {
      return res.status(404).json({ result: false, message: 'Resource not found' });
    }
    const indexPath = hasReactClientBuild ? clientIndexPath : path.join(ROOT_DIR, 'public', 'index.html');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(indexPath);
  });

  // Periodic temp file cleanup every 15 minutes
  const tempCleanupTimer = setInterval(() => {
    WordFmtService.cleanOldTempFiles();
  }, 15 * 60 * 1000);
  tempCleanupTimer.unref?.();

  // Global Error Handler
  app.use((err, req, res, next) => {
    if (err.status !== 404) console.error('Unhandled server error:', err);
    if (err.status === 404) {
      return res.status(404).json({ result: false, message: 'Resource not found' });
    }
    const isUploadLimit = err?.code === 'LIMIT_FILE_SIZE';
    res.status(isUploadLimit ? 413 : (err.status || 500)).json({
      result: false,
      message: isUploadLimit ? 'Ảnh vượt quá dung lượng cho phép.' : (err.message || 'Lỗi xử lý máy chủ nội bộ.')
    });
  });

  return app;
}
