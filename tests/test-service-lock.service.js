import assert from 'node:assert/strict';
import {
  DEFAULT_MESSAGE,
  DEFAULT_TITLE,
  MAX_MESSAGE_LENGTH,
  MAX_TITLE_LENGTH,
  SERVICE_LOCK_SETTING_KEY,
  ServiceLockService
} from '../src/services/service-lock.service.js';
import { SystemSettingsService } from '../src/services/system-settings.service.js';

// Test đơn vị cho ServiceLockService: monkey-patch SystemSettingsService để
// không cần DB. Mỗi ca in một dòng ✓/✗; cuối cùng đặt exitCode=1 nếu có ca đỏ
// để `node tests/test-service-lock.service.js` fail-closed đúng cách.

const originalGet = SystemSettingsService.get;
const originalSet = SystemSettingsService.set;

// Ghi lại mọi lần gọi set để khẳng định service lưu đúng shape và không ghi khi dữ liệu sai.
const setCalls = [];

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
  SystemSettingsService.get = async () => value;
}

function stubGetError(error) {
  SystemSettingsService.get = async () => {
    throw error;
  };
}

function stubSet(record) {
  SystemSettingsService.set = async (...args) => {
    setCalls.push(args);
    return record;
  };
}

try {
  await check('getStatus trả mặc định khi chưa có bản ghi', async () => {
    stubGet(null);
    const status = await ServiceLockService.getStatus();
    assert.deepEqual(status, {
      locked: false,
      title: DEFAULT_TITLE,
      message: DEFAULT_MESSAGE
    });
  });

  await check('getStatus chuẩn hoá bản ghi thiếu trường', async () => {
    stubGet({ locked: true });
    const status = await ServiceLockService.getStatus();
    assert.equal(status.locked, true);
    assert.equal(status.title, DEFAULT_TITLE);
    assert.equal(status.message, DEFAULT_MESSAGE);
    assert.notEqual(status.title, undefined);
    assert.notEqual(status.message, undefined);
  });

  await check('getStatus fail-open khi DB lỗi', async () => {
    stubGetError(new Error('DB đang lỗi'));
    const status = await ServiceLockService.getStatus();
    assert.equal(status.locked, false);
    assert.equal(status.title, DEFAULT_TITLE);
    assert.equal(status.message, DEFAULT_MESSAGE);
  });

  await check('setStatus lưu đúng shape và updatedBy', async () => {
    setCalls.length = 0;
    stubSet({
      key: SERVICE_LOCK_SETTING_KEY,
      value: { locked: true, title: 'T', message: 'M' },
      updated_at: '2026-10-12T00:00:00.000Z',
      updated_by: 'TESTADMIN'
    });
    const record = await ServiceLockService.setStatus(
      { locked: true, title: 'T', message: 'M' },
      'TESTADMIN'
    );
    assert.deepEqual(setCalls[0], [
      SERVICE_LOCK_SETTING_KEY,
      { locked: true, title: 'T', message: 'M' },
      'TESTADMIN'
    ]);
    assert.deepEqual(record, {
      locked: true,
      title: 'T',
      message: 'M',
      updated_at: '2026-10-12T00:00:00.000Z',
      updated_by: 'TESTADMIN'
    });
  });

  await check('setStatus điền default khi thiếu nội dung', async () => {
    setCalls.length = 0;
    stubSet({ value: {} });
    await ServiceLockService.setStatus({ locked: true }, 'X');
    assert.deepEqual(setCalls[0][1], {
      locked: true,
      title: DEFAULT_TITLE,
      message: DEFAULT_MESSAGE
    });
  });

  await check('setStatus từ chối locked không phải boolean', async () => {
    setCalls.length = 0;
    stubSet({});
    await assert.rejects(
      () => ServiceLockService.setStatus({ locked: 'true' }, 'X'),
      (error) => error.status === 400
    );
    assert.equal(setCalls.length, 0, 'không được gọi set khi locked sai kiểu');
  });

  await check('setStatus từ chối title quá dài', async () => {
    setCalls.length = 0;
    stubSet({});
    await assert.rejects(
      () =>
        ServiceLockService.setStatus(
          { locked: true, title: 'a'.repeat(MAX_TITLE_LENGTH + 1) },
          'X'
        ),
      (error) => error.status === 400
    );
    assert.equal(setCalls.length, 0, 'không được gọi set khi title quá dài');
  });

  await check('setStatus từ chối message quá dài', async () => {
    setCalls.length = 0;
    stubSet({});
    await assert.rejects(
      () =>
        ServiceLockService.setStatus(
          { locked: true, message: 'a'.repeat(MAX_MESSAGE_LENGTH + 1) },
          'X'
        ),
      (error) => error.status === 400
    );
    assert.equal(setCalls.length, 0, 'không được gọi set khi message quá dài');
  });

  await check('setStatus trim chuỗi trước khi lưu', async () => {
    setCalls.length = 0;
    stubSet({});
    await ServiceLockService.setStatus(
      { locked: false, title: '  A  ', message: '  B  ' },
      'X'
    );
    assert.equal(setCalls[0][1].title, 'A');
    assert.equal(setCalls[0][1].message, 'B');
  });
} finally {
  SystemSettingsService.get = originalGet;
  SystemSettingsService.set = originalSet;
}

if (failed > 0) {
  console.log(`✗ ServiceLockService: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ ServiceLockService: toàn bộ ca đạt.');
}
