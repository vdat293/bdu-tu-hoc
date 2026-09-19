import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_DIR = path.join('data', 'client-assets');
const DEFAULT_KEEP_DAYS = 30;
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;

function resolveDir() {
  return path.resolve(process.env.CLIENT_ASSET_HISTORY_DIR || path.join(process.cwd(), DEFAULT_DIR));
}

function keepDays() {
  const days = Number(process.env.CLIENT_ASSET_HISTORY_DAYS);
  return Number.isFinite(days) && days > 0 ? days : DEFAULT_KEEP_DAYS;
}

function isEnabled() {
  return String(process.env.CLIENT_ASSET_HISTORY_ENABLED || 'true').toLowerCase() !== 'false';
}

async function listFiles(dir) {
  const found = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await listFiles(fullPath));
    else if (entry.isFile()) found.push(fullPath);
  }
  return found;
}

async function archiveMissing(sourceDir, targetDir) {
  let copied = 0;
  for (const sourceFile of await listFiles(sourceDir)) {
    const targetFile = path.join(targetDir, path.relative(sourceDir, sourceFile));
    if (fs.existsSync(targetFile)) continue;
    await fsp.mkdir(path.dirname(targetFile), { recursive: true });
    await fsp.copyFile(sourceFile, targetFile);
    copied += 1;
  }
  return copied;
}

async function pruneOlderThan(targetDir, maxAgeDays) {
  const cutoff = Date.now() - maxAgeDays * RUN_INTERVAL_MS;
  let removed = 0;
  for (const file of await listFiles(targetDir)) {
    const stats = await fsp.stat(file).catch(() => null);
    if (!stats || stats.mtimeMs >= cutoff) continue;
    await fsp.unlink(file).catch(() => {});
    removed += 1;
  }
  return removed;
}

// Vite xoá chunk cũ mỗi lần build. Nếu tầng cache phía trước (browser/CDN/WAF)
// còn giữ HTML cũ, các chunk đó 404 và tab lỗi cho tới khi cache hết hạn. Lưu
// bản sao asset vào volume bền vững giúp HTML cũ vẫn tải được chunk cũ; file
// trùng tên là trùng nội dung (tên có hash) nên chỉ copy phần còn thiếu.
export const AssetHistoryService = {
  getDir: resolveDir,
  isEnabled,

  async runOnce({ sourceDir = path.join(process.cwd(), 'dist', 'client', 'app-assets'), maxAgeDays = keepDays() } = {}) {
    if (!isEnabled()) return { enabled: false, copied: 0, removed: 0 };
    const targetDir = resolveDir();
    if (!fs.existsSync(sourceDir)) return { enabled: true, copied: 0, removed: 0 };
    await fsp.mkdir(targetDir, { recursive: true, mode: 0o750 });
    const copied = await archiveMissing(sourceDir, targetDir);
    const removed = await pruneOlderThan(targetDir, maxAgeDays);
    return { enabled: true, copied, removed, dir: targetDir };
  },

  start() {
    if (!isEnabled()) return;
    const run = () => {
      this.runOnce()
        .then((result) => {
          if (result.copied || result.removed) {
            console.log(`[asset-history] Giữ ${result.copied} asset cũ, dọn ${result.removed} asset hết hạn.`);
          }
        })
        .catch((error) => console.warn('[asset-history] Lỗi lưu asset cũ:', error.message));
    };
    run();
    this.timer = setInterval(run, RUN_INTERVAL_MS);
    this.timer.unref?.();
  },

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
};
