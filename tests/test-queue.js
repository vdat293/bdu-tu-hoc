/**
 * Automated Test Suite for Concurrency Queue & Load Resilience
 */

import { AsyncQueue } from '../src/utils/async-queue.js';
import { WordFmtService } from '../src/services/wordfmt.service.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    failed++;
    throw new Error(message);
  } else {
    console.log(`✅ PASSED: ${message}`);
    passed++;
  }
}

async function runTestSuite() {
  console.log(`\n======================================================`);
  console.log(`🧪 BẮT ĐẦU KIỂM THỬ HÀNG ĐỢI (CONCURRENCY QUEUE TEST)`);
  console.log(`======================================================\n`);

  // Test 1: Concurrency Cap Verification (30 concurrent tasks, max concurrency = 3)
  console.log(`--- [Test 1] Kiểm tra giới hạn Concurrency (30 tác vụ đồng thời, Max = 3) ---`);
  const queue = new AsyncQueue({ concurrency: 3, name: 'TestQueue-1' });
  let maxActiveObserved = 0;
  const totalTasks = 30;
  const completedOrder = [];

  const taskPromises = Array.from({ length: totalTasks }, (_, i) => {
    return queue.enqueue(async () => {
      if (queue.activeCount > maxActiveObserved) {
        maxActiveObserved = queue.activeCount;
      }
      // Giả lập thời gian xử lý 50ms cho mỗi tác vụ
      await sleep(50);
      completedOrder.push(i);
      return `Result-${i}`;
    });
  });

  const results = await Promise.all(taskPromises);

  assert(maxActiveObserved <= 3, `Số tiến trình chạy đồng thời tối đa không vượt quá 3 (Thực tế quan sát: ${maxActiveObserved})`);
  assert(results.length === 30, `Tất cả 30 tác vụ hoàn thành đầy đủ kết quả`);
  assert(queue.getStats().totalProcessed === 30, `Thống kê totalProcessed chính xác (30/30)`);
  assert(queue.activeCount === 0 && queue.queue.length === 0, `Hàng đợi và số active về 0 sau khi hoàn tất`);

  // Test 2: Error Resilience (Lỗi của 1 tác vụ không làm nghẽn hàng đợi)
  console.log(`\n--- [Test 2] Kiểm tra khả năng phục hồi khi có tác vụ bị lỗi ---`);
  const errorQueue = new AsyncQueue({ concurrency: 2, name: 'ErrorQueue' });
  const mixedResults = [];

  const p1 = errorQueue.enqueue(async () => {
    await sleep(30);
    return 'OK-1';
  });

  const p2 = errorQueue.enqueue(async () => {
    await sleep(20);
    throw new Error('Lỗi cố tình tạo để test');
  });

  const p3 = errorQueue.enqueue(async () => {
    await sleep(30);
    return 'OK-3';
  });

  const [r1, r2, r3] = await Promise.allSettled([p1, p2, p3]);

  assert(r1.status === 'fulfilled' && r1.value === 'OK-1', `Tác vụ 1 hoàn thành bình thường`);
  assert(r2.status === 'rejected' && r2.reason.message === 'Lỗi cố tình tạo để test', `Tác vụ 2 bắt lỗi chuẩn xác`);
  assert(r3.status === 'fulfilled' && r3.value === 'OK-3', `Tác vụ 3 tiếp tục chạy trơn tru sau khi tác vụ 2 lỗi`);
  assert(errorQueue.getStats().totalProcessed === 2, `Số tác vụ thành công là 2`);
  assert(errorQueue.getStats().totalFailed === 1, `Số tác vụ lỗi ghi nhận là 1`);

  // Test 3: WordFmtService Integration Check
  console.log(`\n--- [Test 3] Kiểm tra tích hợp WordFmtService Queue Stats ---`);
  const wordFmtStats = WordFmtService.getQueueStats();
  console.log(`📊 WordFmt Queue Stats:`, wordFmtStats);
  assert(wordFmtStats.name === 'WordFmtQueue', `Tên hàng đợi dịch vụ WordFmt chính xác`);
  assert(wordFmtStats.concurrency >= 1, `Giới hạn concurrency hợp lệ (${wordFmtStats.concurrency})`);
  assert(wordFmtStats.activeCount === 0, `Trạng thái ban đầu active = 0`);

  console.log(`\n======================================================`);
  console.log(`🏁 TỔNG KẾT KIỂM THỬ: ${passed} Passed, ${failed} Failed`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Lỗi khi chạy test suite:', err);
  process.exit(1);
});
