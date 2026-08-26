/**
 * Simulated Load & HTTP Concurrency Test
 * Simulates 30 concurrent users hitting the API endpoints
 */

import http from 'http';
import { AsyncQueue } from '../src/utils/async-queue.js';

const PORT = 3099; // Isolated test port
process.env.PORT = PORT;
process.env.WORDFMT_CONCURRENCY = '3';

// Dynamically start a test instance of the server
const serverApp = (await import('../server.js')).default;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${PORT}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
  });
}

async function runHttpStressTest() {
  console.log(`\n======================================================`);
  console.log(`🚀 KIỂM THỬ TẢI HTTP (SIMULATING 30 CONCURRENT USERS)`);
  console.log(`======================================================\n`);

  await sleep(1000); // Give server a second to bind

  console.log(`⚡ Gửi đồng thời 30 request kiểm tra trạng thái máy chủ & hàng đợi...`);
  const start = Date.now();

  const userRequests = Array.from({ length: 30 }, (_, i) => {
    const endpoint = i % 2 === 0 ? '/api/health' : '/api/queue-status';
    return makeRequest(endpoint);
  });

  const responses = await Promise.all(userRequests);
  const duration = Date.now() - start;

  const successful = responses.filter(r => r.status === 200).length;

  console.log(`⏱️ Thời gian hoàn tất 30 requests: ${duration}ms (Trung bình: ${(duration / 30).toFixed(2)}ms/req)`);
  console.log(`📊 Số request thành công (HTTP 200): ${successful}/30`);

  if (successful === 30) {
    console.log(`\n✅ TOÀN BỘ 30 NGƯỜI DÙNG TRUY CẬP ĐỒNG THỜI ĐỀU THÀNH CÔNG VỚI ĐỘ TRỄ THẤP!\n`);
    process.exit(0);
  } else {
    console.error(`\n❌ CÓ REQUEST BỊ LỖI!\n`);
    process.exit(1);
  }
}

runHttpStressTest().catch(err => {
  console.error('Lỗi khi chạy HTTP stress test:', err);
  process.exit(1);
});
