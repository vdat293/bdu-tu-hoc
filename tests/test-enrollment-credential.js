import assert from 'node:assert/strict';
import { encryptPassword, decryptPassword, isCredentialKeyConfigured } from '../src/modules/enrollment/enrollment-credential.service.js';

console.log('enrollment-credential');

const originalKey = process.env.NOTIFICATION_ENCRYPTION_KEY;
try {
  delete process.env.NOTIFICATION_ENCRYPTION_KEY;
  assert.equal(isCredentialKeyConfigured(), false);
  assert.throws(() => encryptPassword('run-x', 'secret'), /NOTIFICATION_ENCRYPTION_KEY/i);

  process.env.NOTIFICATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  assert.equal(isCredentialKeyConfigured(), true);

  const row = encryptPassword('run-1', 'super-secret');
  assert.notEqual(row.enc_password, 'super-secret');
  assert.equal(decryptPassword('run-1', row), 'super-secret');
  assert.throws(() => decryptPassword('run-2', row), /authenticate|Unsupported state/i, 'AAD phải gắn với run_id');
  console.log('  ok - encrypt/decrypt + AAD + key guard');
} finally {
  if (originalKey === undefined) delete process.env.NOTIFICATION_ENCRYPTION_KEY;
  else process.env.NOTIFICATION_ENCRYPTION_KEY = originalKey;
}

console.log('OK');
