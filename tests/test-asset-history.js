import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AssetHistoryService } from '../src/services/asset-history.service.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-asset-history-test-'));
const sourceDir = path.join(root, 'dist', 'app-assets');
const historyDir = path.join(root, 'data', 'client-assets');
process.env.CLIENT_ASSET_HISTORY_DIR = historyDir;

fs.mkdirSync(path.join(sourceDir, 'nested'), { recursive: true });
fs.writeFileSync(path.join(sourceDir, 'index-abc.js'), 'new build');
fs.writeFileSync(path.join(sourceDir, 'nested', 'chunk-def.css'), 'nested asset');
fs.mkdirSync(historyDir, { recursive: true });
fs.writeFileSync(path.join(historyDir, 'GpaPage-old.js'), 'old chunk');
const expired = path.join(historyDir, 'expired-old.js');
fs.writeFileSync(expired, 'stale');
const oldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
fs.utimesSync(expired, oldTime, oldTime);

const first = await AssetHistoryService.runOnce({ sourceDir, maxAgeDays: 30 });
assert.equal(first.copied, 2, 'phải copy asset mới còn thiếu');
assert.equal(first.removed, 1, 'phải dọn asset quá hạn');
assert.equal(fs.readFileSync(path.join(historyDir, 'index-abc.js'), 'utf8'), 'new build');
assert.equal(fs.readFileSync(path.join(historyDir, 'nested', 'chunk-def.css'), 'utf8'), 'nested asset');
assert.ok(fs.existsSync(path.join(historyDir, 'GpaPage-old.js')), 'chunk cũ trong hạn phải được giữ');
assert.equal(fs.existsSync(expired), false, 'asset quá hạn phải bị xóa');

const second = await AssetHistoryService.runOnce({ sourceDir, maxAgeDays: 30 });
assert.equal(second.copied, 0, 'lần chạy sau không copy lại file đã có');
assert.equal(second.removed, 0);

const missingSource = path.join(root, 'dist', 'missing');
const noSource = await AssetHistoryService.runOnce({ sourceDir: missingSource });
assert.equal(noSource.copied, 0, 'không có build thì bỏ qua an toàn');

process.env.CLIENT_ASSET_HISTORY_ENABLED = 'false';
assert.equal(AssetHistoryService.isEnabled(), false);
const disabled = await AssetHistoryService.runOnce({ sourceDir });
assert.equal(disabled.enabled, false, 'tắt qua env thì không đụng tới volume');
assert.equal(fs.existsSync(path.join(root, 'data', 'client-assets', 'expired-old.js')), false);

delete process.env.CLIENT_ASSET_HISTORY_DIR;
delete process.env.CLIENT_ASSET_HISTORY_ENABLED;
fs.rmSync(root, { recursive: true, force: true });
console.log('✓ Asset history giữ chunk cũ qua deploy, dọn theo tuổi và tôn trọng công tắc env.');
