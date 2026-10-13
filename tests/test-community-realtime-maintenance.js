import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter, once } from 'node:events';
import WebSocket from 'ws';
import { CommunityRealtime } from '../src/services/community-realtime.service.js';
import { ServiceLockService } from '../src/services/service-lock.service.js';

// Test cho phần WebSocket của công tắc khóa bảo trì:
//   1. disconnectAllForMaintenance() đóng mọi client đang mở, chịu được client
//      đã chết và không sập khi tập client rỗng.
//   2. Cửa chặn 'upgrade' chỉ từ chối kết nối mới khi nhóm `community` đang khóa
//      (nhóm khác khóa vẫn cho qua), cho qua khi mở, và fail-open khi đọc trạng
//      thái lỗi (dùng httpServer giả để chạy nhanh).
//   3. Hồi quy thật: http server + client `ws` thật phải nhận HTTP 503 sạch chứ
//      không phải lỗi mạng kiểu hang-up/ECONNRESET — bắt đúng lỗi khi ai đó quay
//      lại dùng write()+destroy() thay vì end().
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

// Socket tối giản ghi lại những gì đã ghi/end và có bị destroy() hay không.
function makeSocket() {
  return {
    written: [],
    ended: false,
    destroyed: false,
    write(chunk) {
      this.written.push(String(chunk));
      return true;
    },
    end(chunk) {
      if (chunk !== undefined) this.written.push(String(chunk));
      this.ended = true;
      return this;
    },
    destroy() {
      this.destroyed = true;
    }
  };
}

function upgradeRequest() {
  return { url: '/ws/community', headers: { host: 'localhost' } };
}

// Mở một kết nối ws thật tới server đang khóa và phân loại kết cục:
//   - { statusCode: 503 } nếu handshake bị từ chối bằng HTTP 503 (đúng).
//   - { error } nếu rơi vào lỗi mạng/ECONNRESET/hang-up (hỏng).
function probeUpgrade(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch {}
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ statusCode: null, error: new Error('timeout: không nhận phản hồi nào') }),
      3000
    );
    timer.unref?.();
    // Khi có listener 'unexpected-response', ws không tự abort — ta tự đọc mã
    // trạng thái rồi đóng, nên lấy được đúng 503 mà không cần parse chuỗi lỗi.
    ws.once('unexpected-response', (req, res) => {
      res.resume();
      finish({ statusCode: res.statusCode, error: null });
    });
    ws.once('error', (error) => finish({ statusCode: null, error }));
    ws.once('open', () => finish({ statusCode: null, error: new Error('kết nối đã mở dù đang khóa') }));
  });
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

  // --- Phần 2: cửa chặn 'upgrade' (httpServer giả) ---
  const fakeServer = new EventEmitter();
  CommunityRealtime.attach(fakeServer);

  const originalHandleUpgrade = CommunityRealtime.wss.handleUpgrade;
  let upgradeCalls = 0;
  CommunityRealtime.wss.handleUpgrade = () => { upgradeCalls += 1; };

  try {
    await check('từ chối upgrade chỉ khi nhóm community khóa (503 ở tầng socket)', async () => {
      ServiceLockService.getStatus = async () => ({
        groups: {
          community: { locked: true, title: 'Bảo trì định kỳ', message: 'Quay lại sau.' },
          wordfmt: { locked: false, title: '', message: '' }
        }
      });
      upgradeCalls = 0;
      const socket = makeSocket();
      fakeServer.emit('upgrade', upgradeRequest(), socket, Buffer.alloc(0));
      await flush();
      assert.equal(socket.ended, true, 'socket phải được end() khi community khóa');
      assert.ok(
        socket.written.some((line) => line.startsWith('HTTP/1.1 503')),
        'phải ghi phản hồi 503 ở tầng socket'
      );
      assert.equal(upgradeCalls, 0, 'không được handleUpgrade khi đã từ chối');
    });

    await check('nhóm khác khóa (wordfmt) vẫn cho upgrade community', async () => {
      // Vì sao cần ca này: realtime phục vụ Community, khóa nhóm khác không được
      // chặn oan kết nối realtime của Community.
      ServiceLockService.getStatus = async () => ({
        groups: {
          community: { locked: false, title: '', message: '' },
          wordfmt: { locked: true, title: 'Wordfmt bảo trì', message: 'Thử lại sau.' }
        }
      });
      upgradeCalls = 0;
      const socket = makeSocket();
      fakeServer.emit('upgrade', upgradeRequest(), socket, Buffer.alloc(0));
      await flush();
      assert.equal(upgradeCalls, 1, 'khóa nhóm khác không được chặn realtime community');
      assert.equal(socket.ended, false, 'không được end() socket khi community không khóa');
    });

    await check('cho upgrade khi không khóa', async () => {
      ServiceLockService.getStatus = async () => ({
        groups: {
          community: { locked: false, title: '', message: '' },
          wordfmt: { locked: false, title: '', message: '' }
        }
      });
      upgradeCalls = 0;
      const socket = makeSocket();
      fakeServer.emit('upgrade', upgradeRequest(), socket, Buffer.alloc(0));
      await flush();
      assert.equal(upgradeCalls, 1, 'phải handleUpgrade khi không khóa');
      assert.equal(socket.ended, false, 'không được end() socket khi không khóa');
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
      assert.equal(socket.ended, false, 'fail-open không được end() socket');
    });
  } finally {
    CommunityRealtime.wss.handleUpgrade = originalHandleUpgrade;
  }

  // Nhả gateway khỏi httpServer giả để attach() lần nữa với HTTP server thật.
  CommunityRealtime.close();

  // --- Phần 3: hồi quy với http server + client ws thật ---
  const httpServer = createServer();
  CommunityRealtime.attach(httpServer);
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const { port } = httpServer.address();

  try {
    await check('ws thật nhận HTTP 503 sạch, không phải hang-up/ECONNRESET', async () => {
      ServiceLockService.getStatus = async () => ({
        groups: {
          community: { locked: true, title: 'Bảo trì', message: 'Thử lại sau.' }
        }
      });
      const result = await probeUpgrade(`ws://127.0.0.1:${port}/ws/community`);
      if (result.statusCode == null) {
        // Nếu 'unexpected-response' không bắn, ít nhất lỗi phải nhắc tới 503,
        // tuyệt đối không được là hang-up/ECONNRESET (dấu hiệu mất 503).
        const message = String(result.error && result.error.message);
        assert.match(message, /503/, `phải nhận 503, thực nhận: ${message}`);
        assert.doesNotMatch(
          message,
          /ECONNRESET|socket hang up/i,
          `không được hang-up/ECONNRESET, thực nhận: ${message}`
        );
      } else {
        assert.equal(result.statusCode, 503, `phải nhận đúng 503, thực nhận ${result.statusCode}`);
      }
    });
  } finally {
    CommunityRealtime.close();
    await new Promise((resolve) => httpServer.close(resolve));
  }
} finally {
  ServiceLockService.getStatus = originalGetStatus;
}

if (failed > 0) {
  console.log(`✗ CommunityRealtime maintenance: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ CommunityRealtime maintenance: toàn bộ ca đạt.');
}
