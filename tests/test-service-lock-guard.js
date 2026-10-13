import assert from 'node:assert/strict';
import { createServiceLockGuard } from '../src/utils/service-lock-guard.js';
import { FEATURE_GROUPS, OTHER_FEATURE } from '../src/config/feature-groups.js';

// Test đơn vị cho cửa chặn bảo trì theo NHÓM tính năng: không cần DB, không
// import service thật. `getStatus` được truyền vào dưới dạng hàm giả để kiểm cả
// nhánh lỗi (fail-open).
//
// Vì sao test theo nhóm chứ không theo danh sách miễn trừ cứng: hợp đồng mới là
// "guard hỏi taxonomy xem path thuộc nhóm nào rồi mới chặn", nên các ca phải
// khẳng định kết luận nhóm (portal không chặn, /community/clans thuộc clubs chứ
// không phải community...). Mỗi ca in một dòng ✓/✗; cuối cùng đặt exitCode=1 nếu
// có ca đỏ để `node tests/test-service-lock-guard.js` fail-closed đúng cách.

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

// Trạng thái dạng map nhóm, đúng shape `getStatus()` của ServiceLockService.
function statusFor(groups) {
  return { groups };
}

const LOCKED_ENTRY = {
  locked: true,
  title: 'Bảo trì định kỳ',
  message: 'Vui lòng quay lại sau ít phút.'
};

// Map "mọi nhóm lockable đều khoá" — dùng để khẳng định portal/meta vẫn đi qua
// dù không còn nhóm nào khác mở.
function allLockableLocked() {
  const groups = {};
  for (const group of FEATURE_GROUPS) {
    if (group.lockable) groups[group.id] = { ...LOCKED_ENTRY };
  }
  return groups;
}

try {
  await check('cho qua nhóm không khoá', async () => {
    const guard = createServiceLockGuard({
      getStatus: async () => statusFor({ wordfmt: { locked: false, title: '', message: '' } })
    });
    const res = response();
    const next = makeNext();
    await guard(request('/wordfmt/format'), res, next);
    assert.equal(next.calls, 1, 'nhóm mở phải gọi next()');
    assert.equal(res.statusCalls, 0, 'nhóm mở không được chạm response');
  });

  await check('chặn nhóm khoá (path còn tiền tố /api)', async () => {
    const guard = createServiceLockGuard({
      getStatus: async () => statusFor({ wordfmt: { ...LOCKED_ENTRY } })
    });
    const res = response();
    const next = makeNext();
    await guard(request('/api/wordfmt/format'), res, next);
    assert.equal(res.statusCode, 503, 'nhóm khoá phải trả 503');
    assert.deepEqual(res.body, {
      result: false,
      code: 'MAINTENANCE',
      group: 'wordfmt',
      title: LOCKED_ENTRY.title,
      message: LOCKED_ENTRY.message
    });
    assert.equal(next.calls, 0, 'đã chặn thì không gọi next()');
  });

  for (const path of ['/login', '/profile', '/grades', '/schedule', '/rankings/me']) {
    await check(`portal không bao giờ chặn: ${path}`, async () => {
      const guard = createServiceLockGuard({
        getStatus: async () => statusFor(allLockableLocked())
      });
      const res = response();
      const next = makeNext();
      await guard(request(path), res, next);
      assert.equal(next.calls, 1, `${path} phải đi qua dù mọi nhóm đang khoá`);
      assert.equal(res.statusCalls, 0, `${path} không được trả 503`);
    });
  }

  for (const path of ['/health', '/version', '/status', '/admin/dashboard/login']) {
    await check(`meta/admin không chặn: ${path}`, async () => {
      const guard = createServiceLockGuard({
        getStatus: async () => statusFor(allLockableLocked())
      });
      const res = response();
      const next = makeNext();
      await guard(request(path), res, next);
      assert.equal(next.calls, 1, `${path} phải đi qua`);
      assert.equal(res.statusCalls, 0, `${path} không được trả 503`);
    });
  }

  // Ca then chốt: /community/clans thuộc nhóm `clubs` (tiền tố dài nhất thắng),
  // nên khoá `community` KHÔNG được chặn oan CLB.
  for (const path of ['/community/clans', '/community/clans/5', '/api/community/clans']) {
    await check(`khoá community không chặn oan CLB: ${path}`, async () => {
      const guard = createServiceLockGuard({
        getStatus: async () => statusFor({ community: { ...LOCKED_ENTRY } })
      });
      const res = response();
      const next = makeNext();
      await guard(request(path), res, next);
      assert.equal(next.calls, 1, `${path} thuộc clubs nên phải đi qua`);
      assert.equal(res.statusCalls, 0, `${path} không được trả 503`);
    });
  }

  await check('community chặn đúng bài viết', async () => {
    const guard = createServiceLockGuard({
      getStatus: async () => statusFor({ community: { ...LOCKED_ENTRY } })
    });
    const res = response();
    const next = makeNext();
    await guard(request('/community/posts/1'), res, next);
    assert.equal(res.statusCode, 503, 'bài viết community phải bị chặn');
    assert.equal(res.body.group, 'community', 'phải báo đúng nhóm bị chặn');
    assert.equal(res.body.code, 'MAINTENANCE');
    assert.equal(next.calls, 0, 'đã chặn thì không gọi next()');
  });

  await check('clubs chặn đúng CLB', async () => {
    const guard = createServiceLockGuard({
      getStatus: async () => statusFor({ clubs: { ...LOCKED_ENTRY } })
    });
    const res = response();
    const next = makeNext();
    await guard(request('/community/clans'), res, next);
    assert.equal(res.statusCode, 503, 'CLB phải bị chặn khi nhóm clubs khoá');
    assert.equal(res.body.group, 'clubs', 'phải báo đúng nhóm clubs');
    assert.equal(next.calls, 0, 'đã chặn thì không gọi next()');
  });

  await check('fail-open khi getStatus ném lỗi', async () => {
    const guard = createServiceLockGuard({
      getStatus: async () => {
        throw new Error('DB đang lỗi');
      }
    });
    const res = response();
    const next = makeNext();
    await guard(request('/community/posts/1'), res, next);
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
    await guard(request('/community/posts/1'), res, next);
    assert.equal(next.calls, 1, 'vẫn phải fail-open dù res không đủ API');
  });

  // Ca bổ sung: nhóm khoá nhưng response không đủ API (thiếu json) — thà cho qua
  // còn hơn để middleware ném lỗi ra ngoài.
  await check('res thiếu json nhưng nhóm khoá vẫn cho qua', async () => {
    const guard = createServiceLockGuard({
      getStatus: async () => statusFor({ community: { ...LOCKED_ENTRY } })
    });
    const res = {
      status() {
        return this;
      }
    };
    const next = makeNext();
    await guard(request('/community/posts/1'), res, next);
    assert.equal(next.calls, 1, 'thiếu json phải fail-open qua next()');
  });

  await check('OTHER_FEATURE không bao giờ bị chặn', async () => {
    const guard = createServiceLockGuard({
      getStatus: async () => statusFor(allLockableLocked())
    });
    const res = response();
    const next = makeNext();
    await guard(request('/unknown/thing'), res, next);
    assert.equal(next.calls, 1, 'path không thuộc nhóm nào phải đi qua');
    assert.equal(res.statusCalls, 0, 'không được trả 503');
    assert.equal(OTHER_FEATURE.lockable, undefined, 'other không có cờ lockable');
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
