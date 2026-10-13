import assert from 'node:assert/strict';
import {
  DEFAULT_MESSAGE,
  DEFAULT_TITLE,
  LOCKABLE_GROUPS,
  MAX_MESSAGE_LENGTH,
  MAX_TITLE_LENGTH,
  SERVICE_LOCK_SETTING_KEY,
  ServiceLockService
} from '../src/services/service-lock.service.js';
import { LOCKABLE_FEATURE_IDS } from '../src/config/feature-groups.js';
import { SystemSettingsService } from '../src/services/system-settings.service.js';

// Test đơn vị cho ServiceLockService theo nhóm: monkey-patch
// SystemSettingsService để không cần DB. Mỗi ca in một dòng ✓/✗; cuối cùng
// đặt exitCode=1 nếu có ca đỏ để `node tests/test-service-lock.service.js`
// fail-closed đúng cách.

const originalGet = SystemSettingsService.get;
const originalSet = SystemSettingsService.set;
const originalGetRecord = SystemSettingsService.getRecord;

// Ghi lại mọi lần gọi set để khẳng định service lưu đúng shape và không ghi khi dữ liệu sai.
const setCalls = [];

// Ghi lại mọi lần gọi get/getRecord để khẳng định service đọc đúng key.
const getCalls = [];

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

function stubGet(value) {
  SystemSettingsService.get = async (...args) => {
    getCalls.push(args);
    return value;
  };
}

function stubGetError(error) {
  SystemSettingsService.get = async (...args) => {
    getCalls.push(args);
    throw error;
  };
}

function stubSet(record) {
  SystemSettingsService.set = async (...args) => {
    setCalls.push(args);
    return record;
  };
}

function stubGetRecord(record) {
  SystemSettingsService.getRecord = async () => record;
}

function resetCalls() {
  setCalls.length = 0;
  getCalls.length = 0;
}

try {
  await check('LOCKABLE_GROUPS khớp 10 nhóm lockable của taxonomy', async () => {
    assert.deepEqual(
      LOCKABLE_GROUPS.map((g) => g.id),
      LOCKABLE_FEATURE_IDS
    );
    assert.equal(LOCKABLE_GROUPS.length, 10);
    assert.ok(
      LOCKABLE_GROUPS.every((g) => typeof g.id === 'string' && typeof g.label === 'string')
    );
    assert.ok(!LOCKABLE_GROUPS.some((g) => g.id === 'portal'));
  });

  await check('getStatus mặc định đủ 10 khoá khi chưa có bản ghi', async () => {
    resetCalls();
    stubGet(null);
    const status = await ServiceLockService.getStatus();
    assert.deepEqual(Object.keys(status.groups).sort(), [...LOCKABLE_FEATURE_IDS].sort());
    for (const id of LOCKABLE_FEATURE_IDS) {
      assert.deepEqual(status.groups[id], {
        locked: false,
        title: DEFAULT_TITLE,
        message: DEFAULT_MESSAGE
      });
    }
  });

  await check('getStatus chuẩn hoá nhóm thiếu trường', async () => {
    resetCalls();
    stubGet({ groups: { wordfmt: { locked: true } } });
    const status = await ServiceLockService.getStatus();
    assert.deepEqual(status.groups.wordfmt, {
      locked: true,
      title: DEFAULT_TITLE,
      message: DEFAULT_MESSAGE
    });
    // Nhóm còn lại giữ mặc định mở, không bị lây trạng thái khoá.
    assert.equal(status.groups.vocab.locked, false);
  });

  await check('getStatus fail-open khi DB lỗi', async () => {
    resetCalls();
    stubGetError(new Error('DB đang lỗi'));
    const status = await ServiceLockService.getStatus();
    assert.deepEqual(Object.keys(status.groups).sort(), [...LOCKABLE_FEATURE_IDS].sort());
    for (const id of LOCKABLE_FEATURE_IDS) {
      assert.equal(status.groups[id].locked, false);
    }
  });

  await check('getStatus coi bản ghi legacy như cả 10 nhóm đang khoá', async () => {
    resetCalls();
    stubGet({ locked: true, title: 'T', message: 'M' });
    const status = await ServiceLockService.getStatus();
    assert.equal(Object.keys(status.groups).length, 10);
    for (const id of LOCKABLE_FEATURE_IDS) {
      assert.deepEqual(status.groups[id], { locked: true, title: 'T', message: 'M' });
    }
  });

  await check('getAdminStatus trả groups + catalog + metadata', async () => {
    resetCalls();
    stubGetRecord({
      key: SERVICE_LOCK_SETTING_KEY,
      value: { groups: { vocab: { locked: true, title: 'Bảo trì', message: 'Chờ chút' } } },
      updated_at: '2026-10-12T00:00:00.000Z',
      updated_by: 'ADMIN_1'
    });
    const data = await ServiceLockService.getAdminStatus();
    assert.equal(data.updated_at, '2026-10-12T00:00:00.000Z');
    assert.equal(data.updated_by, 'ADMIN_1');
    assert.deepEqual(data.groups.vocab, { locked: true, title: 'Bảo trì', message: 'Chờ chút' });
    assert.equal(data.groups.wordfmt.locked, false);
    assert.equal(data.catalog.length, 10);
    assert.deepEqual(
      data.catalog.map((g) => g.id),
      LOCKABLE_FEATURE_IDS
    );
  });

  await check('setGroupStatus ghi đúng nhóm và trim chuỗi', async () => {
    resetCalls();
    stubGet({ groups: {} });
    stubSet({
      key: SERVICE_LOCK_SETTING_KEY,
      value: { groups: { vocab: { locked: true, title: 'A', message: 'M' } } },
      updated_at: '2026-10-12T00:00:00.000Z',
      updated_by: 'ADMIN'
    });
    const result = await ServiceLockService.setGroupStatus(
      { group: 'vocab', locked: true, title: ' A ', message: 'M' },
      'ADMIN'
    );
    assert.deepEqual(setCalls[0], [
      SERVICE_LOCK_SETTING_KEY,
      { groups: { vocab: { locked: true, title: 'A', message: 'M' } } },
      'ADMIN'
    ]);
    assert.equal(result.updated_by, 'ADMIN');
    assert.deepEqual(result.groups.vocab, { locked: true, title: 'A', message: 'M' });
  });

  await check('setGroupStatus giữ nguyên nhóm khác', async () => {
    resetCalls();
    stubGet({
      groups: { wordfmt: { locked: true, title: 'W', message: 'Wm' } }
    });
    stubSet({ value: {}, updated_at: null, updated_by: 'ADMIN' });
    await ServiceLockService.setGroupStatus({ group: 'vocab', locked: true }, 'ADMIN');
    const saved = setCalls[0][1];
    assert.equal(saved.groups.wordfmt.locked, true);
    assert.equal(saved.groups.wordfmt.title, 'W');
    assert.equal(saved.groups.vocab.locked, true);
  });

  await check('setGroupStatus từ chối group lạ (portal và xxx)', async () => {
    resetCalls();
    stubSet({});
    await assert.rejects(
      () => ServiceLockService.setGroupStatus({ group: 'portal', locked: true }, 'X'),
      (error) => error.status === 400
    );
    await assert.rejects(
      () => ServiceLockService.setGroupStatus({ group: 'xxx', locked: true }, 'X'),
      (error) => error.status === 400
    );
    assert.equal(setCalls.length, 0, 'không được gọi set khi group lạ');
  });

  await check('setGroupStatus từ chối locked không phải boolean', async () => {
    resetCalls();
    stubSet({});
    await assert.rejects(
      () => ServiceLockService.setGroupStatus({ group: 'vocab', locked: 'true' }, 'X'),
      (error) => error.status === 400
    );
    assert.equal(setCalls.length, 0, 'không được gọi set khi locked sai kiểu');
  });

  await check('setGroupStatus từ chối title quá dài', async () => {
    resetCalls();
    stubSet({});
    await assert.rejects(
      () =>
        ServiceLockService.setGroupStatus(
          { group: 'vocab', locked: true, title: 'a'.repeat(MAX_TITLE_LENGTH + 1) },
          'X'
        ),
      (error) => error.status === 400
    );
    assert.equal(setCalls.length, 0, 'không được gọi set khi title quá dài');
  });

  await check('setGroupStatus từ chối message quá dài', async () => {
    resetCalls();
    stubSet({});
    await assert.rejects(
      () =>
        ServiceLockService.setGroupStatus(
          { group: 'vocab', locked: true, message: 'a'.repeat(MAX_MESSAGE_LENGTH + 1) },
          'X'
        ),
      (error) => error.status === 400
    );
    assert.equal(setCalls.length, 0, 'không được gọi set khi message quá dài');
  });

  await check('setGroupStatus điền default khi thiếu nội dung', async () => {
    resetCalls();
    stubGet({ groups: {} });
    stubSet({ value: {} });
    await ServiceLockService.setGroupStatus({ group: 'vocab', locked: true }, 'X');
    assert.deepEqual(setCalls[0][1].groups.vocab, {
      locked: true,
      title: DEFAULT_TITLE,
      message: DEFAULT_MESSAGE
    });
  });
} finally {
  SystemSettingsService.get = originalGet;
  SystemSettingsService.set = originalSet;
  SystemSettingsService.getRecord = originalGetRecord;
}

if (failed > 0) {
  console.log(`✗ ServiceLockService: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ ServiceLockService: toàn bộ ca đạt.');
}
