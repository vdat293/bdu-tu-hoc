import assert from 'node:assert/strict';
import { createServiceLockGuard } from '../src/utils/service-lock-guard.js';

// Test đơn vị cho cửa chặn bảo trì: không cần DB, không import service thật.
// `getStatus` được truyền vào dưới dạng hàm giả để kiểm cả nhánh lỗi (fail-open).
// Mỗi ca in một dòng ✓/✗; cuối cùng đặt exitCode=1 nếu có ca đỏ để
// `node tests/test-service-lock-guard.js` fail-closed đúng cách.

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

// Fake `res` theo khuôn `response()` trong tests/test-profile-controller.js, thêm
// bộ đếm `statusCalls` để khẳng định KHÔNG chạm vào response khi cho qua.
function response() {
  return {
    statusCode: 200,
    body: null,
    statusCalls: 0,
    status(code) {
      this.statusCode = code;
      this.statusCalls += 1;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

// Bộ đếm số lần `next()` được gọi, gắn luôn lên chính hàm cho dễ đọc.
function makeNext() {
  const next = () => {
    next.calls += 1;
  };
  next.calls = 0;
  return next;
}

function request(path) {
  return { path, method: 'GET' };
}

const LOCKED = {
  locked: true,
  title: 'Bảo trì định kỳ',
  message: 'Vui lòng quay lại sau ít phút.'
};

try {
  await check('cho qua khi không khóa', async () => {
    const guard = createServiceLockGuard({ getStatus: async () => ({ locked: false }) });
    const res = response();
    const next = makeNext();
    await guard(request('/profile'), res, next);
    assert.equal(next.calls, 1, 'phải gọi next() khi không khóa');
    assert.equal(res.statusCalls, 0, 'không được chạm response khi không khóa');
  });

  await check('chặn path thường khi khóa', async () => {
    const guard = createServiceLockGuard({ getStatus: async () => ({ ...LOCKED }) });
    const res = response();
    const next = makeNext();
    await guard(request('/profile'), res, next);
    assert.equal(res.statusCode, 503, 'bị chặn phải trả 503');
    assert.deepEqual(res.body, {
      result: false,
      code: 'MAINTENANCE',
      title: LOCKED.title,
      message: LOCKED.message
    });
    assert.equal(next.calls, 0, 'không được gọi next() khi đã chặn');
  });

  await check('miễn trừ /health', async () => {
    const guard = createServiceLockGuard({ getStatus: async () => ({ ...LOCKED }) });
    const res = response();
    const next = makeNext();
    await guard(request('/health'), res, next);
    assert.equal(next.calls, 1, '/health phải được miễn trừ');
    assert.equal(res.statusCalls, 0, '/health không được trả 503');
  });

  for (const path of ['/version', '/status']) {
    await check(`miễn trừ ${path}`, async () => {
      const guard = createServiceLockGuard({ getStatus: async () => ({ ...LOCKED }) });
      const res = response();
      const next = makeNext();
      await guard(request(path), res, next);
      assert.equal(next.calls, 1, `${path} phải được miễn trừ`);
      assert.equal(res.statusCalls, 0, `${path} không được trả 503`);
    });
  }

  for (const path of ['/admin/dashboard/login', '/admin/dashboard/overview']) {
    await check(`miễn trừ tiền tố admin: ${path}`, async () => {
      const guard = createServiceLockGuard({ getStatus: async () => ({ ...LOCKED }) });
      const res = response();
      const next = makeNext();
      await guard(request(path), res, next);
      assert.equal(next.calls, 1, `${path} phải được miễn trừ`);
      assert.equal(res.statusCalls, 0, `${path} không được trả 503`);
    });
  }

  await check('miễn trừ khi path còn nguyên tiền tố /api', async () => {
    const guard = createServiceLockGuard({ getStatus: async () => ({ ...LOCKED }) });
    const res = response();
    const next = makeNext();
    await guard(request('/api/health'), res, next);
    assert.equal(next.calls, 1, 'guard phải tự chuẩn hoá /api/health thành /health');
    assert.equal(res.statusCalls, 0, '/api/health không được trả 503');
  });

  await check('chặn path /api/* khác khi khóa', async () => {
    const guard = createServiceLockGuard({ getStatus: async () => ({ ...LOCKED }) });
    const res = response();
    const next = makeNext();
    await guard(request('/api/queue-status'), res, next);
    assert.equal(res.statusCode, 503, '/api/queue-status phải bị chặn');
    assert.equal(res.body.code, 'MAINTENANCE');
    assert.equal(next.calls, 0, 'không được gọi next() khi đã chặn');
  });

  await check('fail-open khi getStatus ném lỗi', async () => {
    const guard = createServiceLockGuard({
      getStatus: async () => {
        throw new Error('DB đang lỗi');
      }
    });
    const res = response();
    const next = makeNext();
    await guard(request('/profile'), res, next);
    assert.equal(next.calls, 1, 'lỗi getStatus phải fail-open qua next()');
    assert.equal(res.statusCalls, 0, 'lỗi getStatus không được trả 503');
  });

  await check('res tối thiểu (không có json) vẫn không sập khi getStatus ném', async () => {
    const guard = createServiceLockGuard({
      getStatus: async () => {
        throw new Error('DB đang lỗi');
      }
    });
    const res = {};
    const next = makeNext();
    await guard(request('/profile'), res, next);
    assert.equal(next.calls, 1, 'vẫn phải fail-open dù res không đủ API');
  });
} finally {
  // Không monkey-patch module nào nên không cần khôi phục.
}

if (failed > 0) {
  console.log(`✗ ServiceLockGuard: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ ServiceLockGuard: toàn bộ ca đạt.');
}
