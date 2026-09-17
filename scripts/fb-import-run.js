/**
 * Chạy một lượt kéo bài từ nhóm Facebook về Confession (không cần bật scheduler).
 *
 *   npm run fb:import
 *
 * Yêu cầu: đã chạy `npm run fb:login` ít nhất một lần.
 */

import { importConfig, runOnce } from '../src/services/facebook-import.service.js';

const config = importConfig();

if (!config.enabled) {
  console.warn('[fb-import] FB_IMPORT_ENABLED đang là false — vẫn chạy thủ công một lượt.');
}

console.log(`[fb-import] Nhóm: ${config.groupUrl}`);
console.log(`[fb-import] Tối đa ${config.maxPostsPerRun} bài/lượt, cuộn ${config.maxScrolls} lần.`);

try {
  const result = await runOnce({ trigger: 'cli' });
  if (result.skipped) {
    console.log(`[fb-import] Bỏ qua: ${result.reason}.`);
    process.exit(0);
  }
  console.log(
    `[fb-import] Hoàn tất run ${result.runId}: `
    + `${result.imported} bài mới, ${result.duplicates} bài trùng, ${result.failed} bài lỗi.`
  );
  process.exit(0);
} catch (error) {
  console.error(`[fb-import] Thất bại: ${error.message}`);
  process.exit(1);
}
