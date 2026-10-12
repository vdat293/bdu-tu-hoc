import { WordFmtService } from '../../services/wordfmt.service.js';
import { CommunityRealtime } from '../../services/community-realtime.service.js';
import { ServiceLockService } from '../../services/service-lock.service.js';
import path from 'node:path';
import fs from 'node:fs';

// Vite emits dist/client/build.json on every production build. Reading it here
// lets an open tab compare its embedded __BUILD_ID__ with the deployed one.
let cachedBuildId = null;
let cachedBuildMtimeMs = 0;
function resolveBuildId() {
  const envBuildId = String(process.env.BUILD_ID || '').trim();
  if (envBuildId) return envBuildId;
  const buildFile = path.join(process.cwd(), 'dist', 'client', 'build.json');
  try {
    // Cache theo mtime: một lần build lại giữa chừng phải đổi build_id ngay,
    // nếu không mọi tab đang mở sẽ so với bản cũ và kẹt ở banner "cập nhật".
    const mtimeMs = fs.statSync(buildFile).mtimeMs;
    if (cachedBuildId && mtimeMs === cachedBuildMtimeMs) return cachedBuildId;
    cachedBuildId = String(JSON.parse(fs.readFileSync(buildFile, 'utf8'))?.build_id || '').trim() || null;
    cachedBuildMtimeMs = mtimeMs;
  } catch {
    cachedBuildId = null;
    cachedBuildMtimeMs = 0;
  }
  return cachedBuildId;
}

export const MetaController = {
  // 10. System: Queue Status & Metrics
  getQueueStatus(req, res) {
    return res.json({
      result: true,
      timestamp: new Date().toISOString(),
      wordFmtQueue: WordFmtService.getQueueStats(),
      communityRealtime: CommunityRealtime.getStatus()
    });
  },

  // 10a. System: deployed build id for the "có bản mới" client banner
  getVersion(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ result: true, build_id: resolveBuildId() });
  },

  // 10b. System: trạng thái khóa dịch vụ bảo trì (endpoint công khai /api/status).
  // Trả ĐÚNG 3 khoá locked/title/message; không trả updated_at/updated_by vì đó
  // là thông tin nội bộ chỉ dành cho admin. getStatus fail-open (không bao giờ
  // ném lỗi) nên endpoint này luôn trả 200 kể cả khi DB tạm hỏng.
  async getServiceStatus(req, res) {
    const status = await ServiceLockService.getStatus();
    return res.json({
      result: true,
      data: {
        locked: status.locked,
        title: status.title,
        message: status.message
      }
    });
  },
};
