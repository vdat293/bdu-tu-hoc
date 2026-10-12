import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CommunityRealtime } from '../src/services/community-realtime.service.js';
import { ServiceLockService } from '../src/services/service-lock.service.js';

// Test đơn vị cho phần WebSocket của công tắc khóa bảo trì:
//   1. disconnectAllForMaintenance() đóng mọi client đang mở, chịu được client
//      đã chết và không sập khi tập client rỗng.
//   2. Cửa chặn 'upgrade' từ chối kết nối mới khi đang khóa (trả 503 ở tầng
//      socket), cho qua khi mở, và fail-open khi đọc trạng thái lỗi.
//
// Không cần DB: ServiceLockService.getStatus được monkey-patch theo từng ca.
// Mỗi ca in một dòng ✓/✗; cuối cùng đặt exitCode=1 nếu có ca đỏ để
// `node tests/test-community-realtime-maintenance.js` fail-closed đúng cách.

let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`✗ ${name}`);
    console.log(`    ${error && error.message ? error.message : error}`);
  }
}

// Chờ một vòng microtask + macrotask để handler 'upgrade' (async) chạy xong.
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Socket tối giản ghi lại những gì đã ghi và có bị destroy() hay không.
function makeSocket() {
  return {
    written: [],
    destroyed: false,
    write(chunk) {
      this.written.push(String(chunk));
      return true;
    },
    destroy() {
      this.destroyed = true;
    }
  };
}

function upgradeRequest() {
  return { url: '/ws/community', headers: { host: 'localhost' } };
}

const originalGetStatus = ServiceLockService.getStatus;

try {
  // --- Phần 1: disconnectAllForMaintenance() ---

  await check('đóng hết client đang mở', () => {
    const calls = [];
    const originalClients = CommunityRealtime.clients;
    CommunityRealtime.clients = new Set([
      { ws: { close: (...args) => calls.push(args) } },
      { ws: { close: (...args) => calls.push(args) } }
    ]);
    try {
      CommunityRealtime.disconnectAllForMaintenance();
    } finally {
      CommunityRealtime.clients = originalClients;
    }
    assert.equal(calls.length, 2, 'cả hai client phải được đóng');
    assert.deepEqual(calls[0], [1001, 'Dich vu dang bao tri'], 'đóng client 1 với mã 1001');
    assert.deepEqual(calls[1], [1001, 'Dich vu dang bao tri'], 'đóng client 2 với mã 1001');
  });

  await check('client đã chết không làm sập, client còn lại vẫn được đóng', () => {
    let survivorClosed = false;
    const originalClients = CommunityRealtime.clients;
    CommunityRealtime.clients = new Set([
      { ws: { close: () => { throw new Error('socket đã chết'); } } },
      { ws: { close: () => { survivorClosed = true; } } }
    ]);
    try {
      assert.doesNotThrow(
        () => CommunityRealtime.disconnectAllForMaintenance(),
        'client ném lỗi không được làm sập vòng lặp'
      );
    } finally {
      CommunityRealtime.clients = originalClients;
    }
    assert.equal(survivorClosed, true, 'client còn lại vẫn phải được đóng');
  });

  await check('set rỗng không ném', () => {
    const originalClients = CommunityRealtime.clients;
    CommunityRealtime.clients = new Set();
    try {
      assert.doesNotThrow(() => CommunityRealtime.disconnectAllForMaintenance());
    } finally {
      CommunityRealtime.clients = originalClients;
    }
  });

  // --- Phần 2: cửa chặn 'upgrade' ---
  // Dùng EventEmitter làm httpServer giả để không cần bind cổng thật. attach()
  // chỉ chạy một lần trong tiến trình test này.
  const fakeServer = new EventEmitter();
  CommunityRealtime.attach(fakeServer);

  const originalHandleUpgrade = CommunityRealtime.wss.handleUpgrade;
  let upgradeCalls = 0;
  CommunityRealtime.wss.handleUpgrade = () => { upgradeCalls += 1; };

  try {
    await check('từ chối upgrade khi đang khóa (503 ở tầng socket)', async () => {
      ServiceLockService.getStatus = async () => ({
        locked: true,
        title: 'Bảo trì định kỳ',
        message: 'Quay lại sau.'
      });
      upgradeCalls = 0;
      const socket = makeSocket();
      fakeServer.emit('upgrade', upgradeRequest(), socket, Buffer.alloc(0));
      await flush();
      assert.equal(socket.destroyed, true, 'socket phải bị destroy() khi đang khóa');
      assert.ok(
        socket.written.some((line) => line.startsWith('HTTP/1.1 503')),
        'phải ghi phản hồi 503 ở tầng socket'
      );
      assert.equal(upgradeCalls, 0, 'không được handleUpgrade khi đã destroy() socket');
    });

    await check('cho upgrade khi không khóa', async () => {
      ServiceLockService.getStatus = async () => ({ locked: false });
      upgradeCalls = 0;
      const socket = makeSocket();
      fakeServer.emit('upgrade', upgradeRequest(), socket, Buffer.alloc(0));
      await flush();
      assert.equal(upgradeCalls, 1, 'phải handleUpgrade khi không khóa');
      assert.equal(socket.destroyed, false, 'không được đóng socket khi không khóa');
    });

    await check('fail-open khi getStatus ném (vẫn cho upgrade)', async () => {
      ServiceLockService.getStatus = async () => {
        throw new Error('DB đang lỗi');
      };
      upgradeCalls = 0;
      const socket = makeSocket();
      fakeServer.emit('upgrade', upgradeRequest(), socket, Buffer.alloc(0));
      await flush();
      assert.equal(upgradeCalls, 1, 'lỗi đọc trạng thái phải fail-open, không chặn realtime');
      assert.equal(socket.destroyed, false, 'fail-open không được đóng socket');
    });
  } finally {
    CommunityRealtime.wss.handleUpgrade = originalHandleUpgrade;
  }
} finally {
  ServiceLockService.getStatus = originalGetStatus;
}

// Dọn tài nguyên attach() đã tạo (heartbeat + wss). clients đã được khôi phục về
// Set gốc rỗng nên close() không gặp stub thiếu trường.
CommunityRealtime.close();

if (failed > 0) {
  console.log(`✗ CommunityRealtime maintenance: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ CommunityRealtime maintenance: toàn bộ ca đạt.');
}
